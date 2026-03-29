import { useState, useEffect, useRef, useMemo } from 'react'
import { Pause, Wifi, WifiOff } from 'lucide-react'
import { useMultiplayerChannel } from '../../hooks/useMultiplayerChannel'
import { sendAction } from '../../game/multiplayer-client'
import type { RemoteGameView, PlayerAction } from '../../game/multiplayer-types'
import type { Card as CardType, Meld } from '../../game/types'
import HandDisplay from './HandDisplay'
import TableMelds from './TableMelds'
import CardComponent from './Card'
import MeldBuilder from './MeldBuilder'
import type { MeldBuilderHandle } from './MeldBuilder'
import { haptic } from '../../lib/haptics'
import { ROUND_REQUIREMENTS } from '../../game/rules'

interface Props {
  roomCode: string
  mySeatIndex: number
  onExit: () => void
}

export default function RemoteGameBoard({ roomCode, mySeatIndex, onExit }: Props) {
  const [view, setView] = useState<RemoteGameView | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [handSort, setHandSort] = useState<'rank' | 'suit'>('rank')
  const [showMeldBuilder, setShowMeldBuilder] = useState(false)
  const [showPause, setShowPause] = useState(false)
  const [ghostedIds, setGhostedIds] = useState<Set<string>>(new Set())
  const meldBuilderRef = useRef<MeldBuilderHandle | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const { channel, isConnected, onMessage } = useMultiplayerChannel(roomCode)

  // Listen for state updates from host
  useEffect(() => {
    if (!channel) return
    const unsub = onMessage('game_state', (payload: { targetSeatIndex: number; view: RemoteGameView }) => {
      if (payload.targetSeatIndex === mySeatIndex) {
        setView(payload.view)
        // Haptic when it becomes our turn
        if (payload.view.currentPlayerIndex === payload.view.myPlayerIndex &&
            viewRef.current?.currentPlayerIndex !== payload.view.myPlayerIndex) {
          haptic('tap')
        }
      }
    })
    return unsub
  }, [channel, mySeatIndex, onMessage])

  // Listen for action rejections
  useEffect(() => {
    if (!channel) return
    return onMessage('action_rejected', (payload: { seatIndex: number; reason: string }) => {
      if (payload.seatIndex === mySeatIndex) {
        console.warn('Action rejected:', payload.reason)
      }
    })
  }, [channel, mySeatIndex, onMessage])

  function send(action: PlayerAction) {
    if (!channel) return
    sendAction(channel, mySeatIndex, action)
  }

  // Derived state
  const isMyTurn = view ? view.currentPlayerIndex === view.myPlayerIndex : false
  const myHand = view?.myHand ?? []
  const tableMelds = view?.tableMelds ?? []
  const discardTop = view?.discardTop ?? null
  const currentRound = view?.currentRound ?? 1
  const requirement = view?.roundRequirement ?? ROUND_REQUIREMENTS[0]
  const uiPhase = view?.uiPhase ?? 'round-start'
  const scores = view?.scores ?? []
  const buyingState = view?.buyingState
  const isBuyingMyTurn = buyingState &&
    buyingState.buyerOrder[buyingState.buyerStep] === view?.myPlayerIndex &&
    buyingState.buyingPhase === 'human-turn'
  const hasFreeOffer = view?.pendingFreeOffer && isMyTurn && uiPhase === 'draw'

  // Close meld builder if we leave the action phase or it's no longer our turn
  useEffect(() => {
    if (showMeldBuilder && (!isMyTurn || uiPhase !== 'action')) {
      setShowMeldBuilder(false)
      setGhostedIds(new Set())
    }
  }, [showMeldBuilder, isMyTurn, uiPhase])

  // Round felt color
  const feltColors = ['#1a3a2a', '#1a2f3a', '#2a1a3a', '#1a3a30', '#3a1a24', '#1a2a3a', '#2e2a1a']
  const feltBg = feltColors[(currentRound - 1) % feltColors.length]

  // All players for scoreboard
  const allPlayers = useMemo(() => {
    if (!view) return []
    const me = {
      name: view.scores.find((_, i) => i === view.myPlayerIndex)?.name ?? 'You',
      handSize: myHand.length,
      hasLaidDown: view.myHasLaidDown,
      isAI: false,
      seatIndex: view.myPlayerIndex,
    }
    const opps = view.opponents.map(o => ({
      name: o.name,
      handSize: o.handSize,
      hasLaidDown: o.hasLaidDown,
      isAI: o.isAI,
      seatIndex: o.seatIndex,
    }))
    return [me, ...opps].sort((a, b) => a.seatIndex - b.seatIndex)
  }, [view, myHand.length])

  // ── Waiting for connection ────────────────────────────────────────────────
  if (!view) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: isConnected ? '#6aad7a' : '#e07a5f',
        }}>
          {isConnected ? <Wifi size={20} /> : <WifiOff size={20} />}
          <span style={{ fontSize: 14 }}>
            {isConnected ? 'Connected — waiting for game to start...' : 'Connecting...'}
          </span>
        </div>
        <p style={{ color: '#3a5a3a', fontSize: 12 }}>Room: {roomCode}</p>
        <button
          onClick={onExit}
          style={{
            background: 'transparent',
            border: '1px solid #2d5a3a',
            borderRadius: 8,
            padding: '8px 20px',
            color: '#6aad7a',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Leave
        </button>
      </div>
    )
  }

  // ── Game Over ─────────────────────────────────────────────────────────────
  if (view.gameOver) {
    const sorted = [...scores].sort((a, b) => {
      const totalA = a.roundScores.reduce((s, n) => s + n, 0)
      const totalB = b.roundScores.reduce((s, n) => s + n, 0)
      return totalA - totalB
    })
    return (
      <div style={{
        minHeight: '100dvh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 24,
        paddingTop: 'max(48px, env(safe-area-inset-top))',
      }}>
        <span style={{ color: '#e2b858', fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Game Over</span>
        {view.winner && (
          <span style={{ color: '#6aad7a', fontSize: 16, marginBottom: 24 }}>
            {view.winner} wins!
          </span>
        )}
        <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((s, i) => {
            const total = s.roundScores.reduce((sum, n) => sum + n, 0)
            return (
              <div
                key={s.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#0f2218',
                  borderRadius: 10,
                  padding: '12px 16px',
                  border: i === 0 ? '1px solid #e2b858' : '1px solid #2d5a3a',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#e2b858', fontSize: 14, fontWeight: 700, width: 20 }}>#{i + 1}</span>
                  <span style={{ color: '#ffffff', fontSize: 14 }}>{s.name}</span>
                </div>
                <span style={{ color: '#a8d0a8', fontSize: 16, fontWeight: 700 }}>{total}</span>
              </div>
            )
          })}
        </div>
        <button
          onClick={onExit}
          style={{
            marginTop: 32,
            background: '#e2b858',
            border: 'none',
            borderRadius: 12,
            padding: '14px 40px',
            color: '#2c1810',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Back to Menu
        </button>
      </div>
    )
  }

  // ── Round Announcement (simplified for remote) ──────────────────────────
  if (view.announcementStage && uiPhase === 'round-start') {
    return (
      <div style={{
        minHeight: '100dvh',
        background: feltBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}>
        <span style={{ color: '#e2b858', fontSize: 14, fontWeight: 600 }}>Round {currentRound} of 7</span>
        <span style={{ color: '#ffffff', fontSize: 24, fontWeight: 800 }}>{requirement.description}</span>
        <span style={{ color: '#6aad7a', fontSize: 12 }}>Get ready...</span>
      </div>
    )
  }

  // ── Going Out Cinematic ───────────────────────────────────────────────────
  const showGoingOutFlash = view.goingOutSequence === 'flash'
  const showGoingOutAnnounce = view.goingOutSequence === 'announce'

  // ── Round End ─────────────────────────────────────────────────────────────
  if (uiPhase === 'round-end' && view.roundResults) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: feltBg,
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        paddingTop: 'max(16px, env(safe-area-inset-top))',
      }}>
        <h2 style={{ color: '#e2b858', fontSize: 20, fontWeight: 700, marginBottom: 16, textAlign: 'center' }}>
          Round {currentRound} Complete
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {view.roundResults.map(r => (
            <div
              key={r.playerName}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#0f2218',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div>
                <span style={{ color: '#ffffff', fontSize: 14 }}>{r.playerName}</span>
                {r.shanghaied && (
                  <span style={{ color: '#e07a5f', fontSize: 10, marginLeft: 6 }}>Shanghaied!</span>
                )}
              </div>
              <span style={{
                color: r.wentOut ? '#6aad7a' : '#ffffff',
                fontSize: 16,
                fontWeight: 700,
              }}>
                {r.wentOut ? 'Out!' : r.score}
              </span>
            </div>
          ))}
        </div>
        <p style={{ color: '#3a5a3a', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
          Waiting for next round...
        </p>
      </div>
    )
  }

  // ── Main game board ───────────────────────────────────────────────────────
  const currentPlayerName = allPlayers.find(p => p.seatIndex === view.currentPlayerIndex)?.name ?? '...'

  return (
    <div style={{
      minHeight: '100dvh',
      background: feltBg,
      display: 'flex',
      flexDirection: 'column',
      transition: 'background 3s ease',
      position: 'relative',
    }}>
      {/* Going out flash */}
      {showGoingOutFlash && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(255,255,255,0.9)',
          animation: 'fade-out 400ms ease-out both',
        }} />
      )}
      {showGoingOutAnnounce && view.goingOutPlayerName && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8,
        }}>
          <span style={{ color: '#e2b858', fontSize: 28, fontWeight: 800 }}>
            {view.goingOutPlayerName}
          </span>
          <span style={{ color: '#ffffff', fontSize: 16 }}>GOES OUT!</span>
        </div>
      )}

      {/* ── Zone 1: Top bar ─────────────────────────────────────────────── */}
      <div style={{
        background: '#0f2218',
        paddingTop: 'env(safe-area-inset-top, 44px)',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowPause(true)}
            style={{
              background: 'transparent', border: 'none',
              color: '#6aad7a', cursor: 'pointer', padding: 4,
            }}
          >
            <Pause size={16} />
          </button>
          <span style={{ color: '#a8d0a8', fontSize: 11 }}>
            R{currentRound} — {requirement.description}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isConnected ? <Wifi size={12} style={{ color: '#6aad7a' }} /> : <WifiOff size={12} style={{ color: '#e07a5f' }} />}
        </div>
      </div>

      {/* ── Zone 2: Opponent strip + table melds ────────────────────────── */}
      <div style={{ flex: '0 0 auto', overflowX: 'auto', padding: '8px 12px' }}>
        {/* Opponent cards strip */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {allPlayers.map(p => (
            <div
              key={p.seatIndex}
              style={{
                background: p.seatIndex === view.currentPlayerIndex ? '#1e4a2e' : '#0f2218',
                border: p.seatIndex === view.currentPlayerIndex ? '1px solid #e2b858' : '1px solid #2d5a3a',
                borderRadius: 8,
                padding: '6px 10px',
                minWidth: 70,
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              <div style={{
                color: p.seatIndex === view.myPlayerIndex ? '#e2b858' : '#a8d0a8',
                fontSize: 10,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 80,
              }}>
                {p.name}{p.seatIndex === view.myPlayerIndex ? ' (you)' : ''}
              </div>
              <div style={{ color: '#3a5a3a', fontSize: 9, marginTop: 2 }}>
                {p.handSize} cards{p.hasLaidDown ? ' · Down' : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Table melds */}
        {tableMelds.length > 0 && (
          <TableMelds
            melds={tableMelds}
            currentPlayerId={view.myHand.length > 0 ? `p${view.myPlayerIndex}` : ''}
            onLayOff={view.myHasLaidDown && isMyTurn && uiPhase === 'action' ? (card: CardType, meld: Meld) => {
              send({ type: 'lay_off', cardId: card.id, meldId: meld.id })
            } : undefined}
            onJokerSwap={view.myHasLaidDown && isMyTurn && uiPhase === 'action' ? (card: CardType, meld: Meld) => {
              send({ type: 'joker_swap', cardId: card.id, meldId: meld.id })
            } : undefined}
          />
        )}
      </div>

      {/* ── Zone 3: Draw / discard piles ────────────────────────────────── */}
      {!showMeldBuilder && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: '8px 12px',
          flexShrink: 0,
        }}>
          {/* Draw pile */}
          <button
            onClick={() => isMyTurn && uiPhase === 'draw' && send({ type: 'draw_pile' })}
            disabled={!isMyTurn || uiPhase !== 'draw'}
            style={{
              width: 60, height: 84,
              borderRadius: 8,
              background: '#7a1a2e',
              border: isMyTurn && uiPhase === 'draw' ? '2px solid #e2b858' : '2px solid #4a1a2e',
              cursor: isMyTurn && uiPhase === 'draw' ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a8d0a8',
              fontSize: 10,
              opacity: isMyTurn && uiPhase === 'draw' ? 1 : 0.5,
            }}
          >
            {view.drawPileSize}
          </button>

          {/* Discard pile */}
          <button
            onClick={() => {
              if (isMyTurn && uiPhase === 'draw' && discardTop) {
                if (hasFreeOffer) {
                  send({ type: 'take_discard' })
                } else {
                  send({ type: 'take_discard' })
                }
              }
            }}
            disabled={!isMyTurn || uiPhase !== 'draw' || !discardTop}
            style={{
              width: 60, height: 84,
              borderRadius: 8,
              background: discardTop ? '#ffffff' : '#1e4a2e',
              border: isMyTurn && uiPhase === 'draw' && discardTop ? '2px solid #e2b858' : '2px solid #2d5a3a',
              cursor: isMyTurn && uiPhase === 'draw' && discardTop ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isMyTurn && uiPhase === 'draw' && discardTop ? 1 : 0.6,
              padding: 2,
            }}
          >
            {discardTop ? (
              <CardComponent card={discardTop} />
            ) : (
              <span style={{ color: '#3a5a3a', fontSize: 9 }}>Empty</span>
            )}
          </button>
        </div>
      )}

      {/* ── Meld Builder ──────────────────────────────────────────────── */}
      {showMeldBuilder && (
        <div style={{ padding: '0 8px', animation: 'meld-staging-in 0.25s ease-out' }}>
          <MeldBuilder
            ref={meldBuilderRef}
            hand={myHand}
            requirement={requirement}
            onConfirm={(meldGroups, jokerPositions) => {
              const meldCardIds = meldGroups.map(group => group.map(c => c.id))
              const jp: Record<string, number> = {}
              jokerPositions.forEach((rank, jokerId) => { jp[jokerId] = rank })
              send({
                type: 'meld_confirm',
                meldCardIds,
                jokerPositions: Object.keys(jp).length > 0 ? jp : undefined,
              })
              setShowMeldBuilder(false)
              setGhostedIds(new Set())
            }}
            onClose={() => {
              setShowMeldBuilder(false)
              setGhostedIds(new Set())
            }}
            onAssignedIdsChange={(ids) => setGhostedIds(ids)}
          />
        </div>
      )}

      {/* Free offer banner */}
      {hasFreeOffer && view.pendingFreeOffer && (
        <div style={{
          margin: '0 12px 8px',
          background: '#1e4a2e',
          borderRadius: 10,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ color: '#a8d0a8', fontSize: 12 }}>Take discard for free?</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => send({ type: 'take_discard' })}
              style={{
                background: '#e2b858', border: 'none', borderRadius: 6,
                padding: '6px 14px', color: '#2c1810', fontWeight: 600,
                fontSize: 12, cursor: 'pointer',
              }}
            >
              Take
            </button>
            <button
              onClick={() => send({ type: 'decline_free_offer' })}
              style={{
                background: 'transparent', border: '1px solid #2d5a3a', borderRadius: 6,
                padding: '6px 14px', color: '#6aad7a',
                fontSize: 12, cursor: 'pointer',
              }}
            >
              Pass
            </button>
          </div>
        </div>
      )}

      {/* Buy offer */}
      {isBuyingMyTurn && buyingState && (
        <div style={{
          margin: '0 12px 8px',
          background: '#1e4a2e',
          border: '1px solid #e2b858',
          borderRadius: 10,
          padding: '12px 14px',
        }}>
          <p style={{ color: '#a8d0a8', fontSize: 12, marginBottom: 8 }}>
            Buy this card? (+1 penalty card)
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CardComponent card={buyingState.buyingDiscard} />
            <div style={{ flex: 1, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => send({ type: 'buy', wantsToBuy: true })}
                style={{
                  background: '#e2b858', border: 'none', borderRadius: 8,
                  padding: '10px 20px', color: '#2c1810', fontWeight: 700,
                  fontSize: 14, cursor: 'pointer', minHeight: 44,
                }}
              >
                Buy
              </button>
              <button
                onClick={() => send({ type: 'buy', wantsToBuy: false })}
                style={{
                  background: 'transparent', border: '1px solid #2d5a3a', borderRadius: 8,
                  padding: '10px 20px', color: '#6aad7a',
                  fontSize: 14, cursor: 'pointer', minHeight: 44,
                }}
              >
                Pass
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Turn indicator */}
      {!isMyTurn && uiPhase !== 'round-end' && uiPhase !== 'game-over' && uiPhase !== 'round-start' && (
        <div style={{
          textAlign: 'center',
          padding: '8px 0',
          color: '#6aad7a',
          fontSize: 12,
        }}>
          {currentPlayerName}'s turn...
        </div>
      )}

      {/* ── Zone 4: Hand ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 8px' }}>
        <HandDisplay
          cards={myHand}
          selectedIds={selectedCardIds}
          ghostedIds={showMeldBuilder ? ghostedIds : undefined}
          onToggle={(cardId: string) => {
            if (!isMyTurn) return
            if (uiPhase === 'action') {
              if (showMeldBuilder && meldBuilderRef.current) {
                const card = myHand.find(c => c.id === cardId)
                if (card) meldBuilderRef.current.handleCardTap(card)
                return
              }
              setSelectedCardIds(prev => {
                const next = new Set(prev)
                if (next.has(cardId)) next.delete(cardId)
                else next.add(cardId)
                return next
              })
            }
          }}
          sortMode={handSort}
          onSortChange={setHandSort}
        />
      </div>

      {/* ── Zone 5: Action buttons ──────────────────────────────────────── */}
      <div style={{
        padding: '8px 12px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
      }}>
        {isMyTurn && uiPhase === 'action' && !showMeldBuilder && (
          <>
            {/* Lay Down button */}
            {!view.myHasLaidDown && (
              <button
                onClick={() => setShowMeldBuilder(true)}
                style={{
                  flex: 1,
                  background: '#1e4a2e',
                  border: '1px solid #2d5a3a',
                  borderRadius: 10,
                  padding: '12px',
                  color: '#a8d0a8',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                Lay Down
              </button>
            )}

            {/* Discard button */}
            {selectedCardIds.size === 1 && (
              <button
                onClick={() => {
                  const cardId = [...selectedCardIds][0]
                  send({ type: 'discard', cardId })
                  setSelectedCardIds(new Set())
                }}
                style={{
                  flex: 1,
                  background: '#e2b858',
                  border: 'none',
                  borderRadius: 10,
                  padding: '12px',
                  color: '#2c1810',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                Discard
              </button>
            )}
          </>
        )}
      </div>

      {/* Pause modal */}
      {showPause && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowPause(false)}
        >
          <div
            style={{
              background: '#0f2218',
              borderRadius: 16,
              padding: 24,
              width: 280,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ color: '#ffffff', fontSize: 18, fontWeight: 700, textAlign: 'center' }}>
              Online Game
            </h3>
            <p style={{ color: '#6aad7a', fontSize: 12, textAlign: 'center' }}>
              Room: {roomCode}
            </p>
            <button
              onClick={() => setShowPause(false)}
              style={{
                background: '#1e4a2e', border: '1px solid #2d5a3a',
                borderRadius: 10, padding: 12, color: '#a8d0a8',
                fontSize: 14, cursor: 'pointer',
              }}
            >
              Resume
            </button>
            <button
              onClick={onExit}
              style={{
                background: 'transparent', border: '1px solid #e07a5f',
                borderRadius: 10, padding: 12, color: '#e07a5f',
                fontSize: 14, cursor: 'pointer',
              }}
            >
              Leave Game
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
