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
import { ROUND_REQUIREMENTS, cardPoints } from '../../game/rules'

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
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [ghostedIds, setGhostedIds] = useState<Set<string>>(new Set())
  const [activeToast, setActiveToast] = useState<{ message: string; style: string; icon?: string } | null>(null)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // Notify host when we reconnect so they re-broadcast state
  const wasConnectedRef = useRef(false)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && view !== null && channel) {
      // Transition from disconnected → connected while we already had a view = reconnection
      channel.send({ type: 'broadcast', event: 'player_reconnected', payload: { seatIndex: mySeatIndex } })
    }
    wasConnectedRef.current = isConnected
  }, [isConnected, channel, mySeatIndex, view])

  // Listen for action rejections
  useEffect(() => {
    if (!channel) return
    return onMessage('action_rejected', (payload: { seatIndex: number; reason: string }) => {
      if (payload.seatIndex === mySeatIndex) {
        console.warn('Action rejected:', payload.reason)
      }
    })
  }, [channel, mySeatIndex, onMessage])

  // Process incoming toast/event notifications from host
  useEffect(() => {
    if (!view) return
    if (view.toast) {
      setActiveToast(view.toast)
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3000)
    }
    if (view.lastEvent) {
      setLastEvent(view.lastEvent)
      if (eventTimerRef.current) clearTimeout(eventTimerRef.current)
      eventTimerRef.current = setTimeout(() => setLastEvent(null), 4000)
    }
  }, [view?.toast?.message, view?.lastEvent]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Hand points calculation
  const handPoints = useMemo(() => myHand.reduce((sum, c) => sum + cardPoints(c.rank), 0), [myHand])

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

  // Determine if in buying phase for pile labels
  const isBuyingPhase = buyingState && buyingState.buyingPhase !== 'hidden'

  // "Final card" edge state
  const isOnTheEdge = view?.myHasLaidDown && myHand.length <= 2 && myHand.length > 0

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

  // Draw/discard pile active state
  const drawActive = isMyTurn && uiPhase === 'draw'
  const discardActive = isMyTurn && uiPhase === 'draw' && !!discardTop

  // Pile label text
  const drawLabel = drawActive ? 'DRAW' : ''
  const discardLabel = isBuyingPhase ? 'FOR SALE' : (discardActive ? 'TAKE' : '')

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
        display: 'grid',
        gridTemplateColumns: '36px 1fr 36px',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {/* Left: Pause button */}
        <button
          onClick={() => setShowPause(true)}
          style={{
            background: 'transparent', border: 'none',
            color: '#6aad7a', cursor: 'pointer', padding: 4,
            justifySelf: 'start',
          }}
        >
          <Pause size={16} />
        </button>

        {/* Center: Round badge + requirement badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}>
          <span style={{
            background: '#0f2218',
            border: '1px solid #2d5a3a',
            borderRadius: 20,
            padding: '4px 10px',
            color: '#a8d0a8',
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            R{currentRound}/7
          </span>
          <span style={{
            background: '#0f2218',
            border: '1px solid #8b6914',
            borderRadius: 20,
            padding: '4px 10px',
            color: '#e2b858',
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {requirement.description}
          </span>
        </div>

        {/* Right: Wifi icon */}
        <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center' }}>
          {isConnected ? <Wifi size={12} style={{ color: '#6aad7a' }} /> : <WifiOff size={12} style={{ color: '#e07a5f' }} />}
        </div>
      </div>

      {/* ── Event notifications ───────────────────────────────────────── */}
      {activeToast && (
        <div style={{
          margin: '4px 12px',
          padding: '8px 14px',
          borderRadius: 10,
          background: activeToast.style === 'celebration' ? 'rgba(45,122,58,0.85)'
            : activeToast.style === 'taunt' ? 'rgba(142,68,173,0.85)'
            : activeToast.style === 'pressure' ? 'rgba(184,50,50,0.85)'
            : activeToast.style === 'drama' ? 'rgba(226,184,88,0.85)'
            : 'rgba(42,53,34,0.85)',
          color: '#ffffff',
          fontSize: 13,
          fontWeight: 700,
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          animation: 'fade-in 0.2s ease-out',
        }}>
          {activeToast.icon && <span>{activeToast.icon}</span>}
          {activeToast.message}
        </div>
      )}
      {lastEvent && !activeToast && (
        <div style={{
          margin: '2px 12px',
          padding: '4px 12px',
          borderRadius: 8,
          background: 'rgba(15,34,24,0.7)',
          color: '#a8d0a8',
          fontSize: 11,
          textAlign: 'center',
        }}>
          {lastEvent}
        </div>
      )}
      {view.raceMessage && (
        <div style={{
          margin: '2px 12px',
          padding: '4px 12px',
          borderRadius: 20,
          background: 'rgba(42,53,34,0.85)',
          border: '1px solid rgba(226,184,88,0.2)',
          color: '#e2b858',
          fontSize: 11,
          fontWeight: 700,
          textAlign: 'center',
        }}>
          {view.raceMessage}
        </div>
      )}
      {view.streakInfo && view.streakInfo.streak >= 2 && (
        <div style={{
          margin: '2px 12px',
          padding: '4px 12px',
          borderRadius: 8,
          background: 'rgba(226,140,50,0.15)',
          border: '1px solid rgba(226,140,50,0.3)',
          color: '#e2b858',
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
        }}>
          {'\uD83D\uDD25'} {view.streakInfo.playerName} on fire! {view.streakInfo.streak} in a row
        </div>
      )}

      {/* ── Zone 2: Opponent strip + table melds ────────────────────────── */}
      <div style={{ flex: '0 0 auto', overflowX: 'auto', padding: '8px 12px' }}>
        {/* Opponent cards strip — tap to toggle scoreboard */}
        <div
          style={{ display: 'flex', gap: 6, marginBottom: 8, cursor: 'pointer' }}
          onClick={() => { setShowScoreboard(prev => !prev); haptic('tap') }}
        >
          {allPlayers.map(p => {
            const isCurrentTurn = p.seatIndex === view.currentPlayerIndex
            const isMe = p.seatIndex === view.myPlayerIndex
            const playerScore = scores[p.seatIndex]
            const totalScore = playerScore ? playerScore.roundScores.reduce((sum, n) => sum + n, 0) : 0
            return (
              <div
                key={p.seatIndex}
                style={{
                  background: isCurrentTurn ? '#1e4a2e' : '#0f2218',
                  border: isCurrentTurn ? '2px solid #e2b858' : '1px solid #2d5a3a',
                  borderRadius: 8,
                  padding: '5px 8px',
                  minWidth: 64,
                  textAlign: 'center',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {/* Current turn gold dot */}
                {isCurrentTurn && (
                  <div style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#e2b858',
                    boxShadow: '0 0 4px rgba(226,184,88,0.6)',
                  }} />
                )}
                <div style={{
                  color: isMe ? '#e2b858' : '#a8d0a8',
                  fontSize: 10,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 72,
                }}>
                  {p.name}{isMe ? ' (you)' : ''}{p.isAI ? ' \uD83E\uDD16' : ''}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  marginTop: 2,
                }}>
                  <span style={{ color: '#6aad7a', fontSize: 9, fontWeight: 600 }}>
                    {p.handSize}
                  </span>
                  {p.hasLaidDown && (
                    <span style={{
                      color: '#2d7a3a',
                      fontSize: 8,
                      fontWeight: 700,
                      background: 'rgba(45,122,58,0.15)',
                      borderRadius: 3,
                      padding: '0 3px',
                    }}>
                      DOWN
                    </span>
                  )}
                </div>
                <div style={{
                  color: '#8b7355',
                  fontSize: 8,
                  marginTop: 1,
                }}>
                  {totalScore} pts
                </div>
              </div>
            )
          })}
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
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 32,
          padding: '8px 12px',
          flexShrink: 0,
          background: '#162e22',
          borderRadius: 10,
          margin: '0 12px',
        }}>
          {/* Draw pile with label */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {drawLabel && (
              <span style={{
                color: '#e2b858',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}>
                {drawLabel}
              </span>
            )}
            {!drawLabel && <div style={{ height: 13 }} />}
            <button
              onClick={() => drawActive && send({ type: 'draw_pile' })}
              disabled={!drawActive}
              style={{
                width: 64, height: 88,
                borderRadius: 8,
                background: '#7a1a2e',
                border: drawActive ? '2px solid #e2b858' : '2px solid #4a1a2e',
                cursor: drawActive ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 4,
                opacity: drawActive ? 1 : 0.5,
                position: 'relative',
                overflow: 'hidden',
                animation: drawActive ? 'ready-pulse 2s ease-in-out infinite' : undefined,
                boxShadow: drawActive ? '0 0 12px rgba(226,184,88,0.3)' : 'none',
              }}
            >
              {/* Card back pattern lines */}
              <div style={{
                position: 'absolute',
                inset: 4,
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.1)',
              }} />
              <div style={{
                position: 'absolute',
                inset: 8,
                borderRadius: 2,
                border: '1px solid rgba(255,255,255,0.06)',
              }} />
              <span style={{ color: '#e8c0c8', fontSize: 12, fontWeight: 700, zIndex: 1 }}>
                {view.drawPileSize}
              </span>
            </button>
          </div>

          {/* Discard pile with label */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {discardLabel && (
              <span style={{
                color: isBuyingPhase ? '#e07a5f' : '#e2b858',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}>
                {discardLabel}
              </span>
            )}
            {!discardLabel && <div style={{ height: 13 }} />}
            <button
              onClick={() => {
                if (discardActive && discardTop) {
                  send({ type: 'take_discard' })
                }
              }}
              disabled={!discardActive || !discardTop}
              style={{
                width: 64, height: 88,
                borderRadius: 8,
                background: discardTop ? '#ffffff' : '#1e4a2e',
                border: discardActive && discardTop ? '2px solid #e2b858' : '2px solid #2d5a3a',
                cursor: discardActive && discardTop ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: discardActive && discardTop ? 1 : 0.6,
                padding: 2,
                animation: discardActive && discardTop ? 'ready-pulse 2s ease-in-out infinite' : undefined,
                boxShadow: discardActive && discardTop ? '0 0 12px rgba(226,184,88,0.3)' : 'none',
              }}
            >
              {discardTop ? (
                <CardComponent card={discardTop} />
              ) : (
                <span style={{ color: '#3a5a3a', fontSize: 9 }}>Empty</span>
              )}
            </button>
          </div>
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

      {/* ── Turn indicator ─────────────────────────────────────────────── */}
      {isMyTurn && uiPhase !== 'round-end' && uiPhase !== 'game-over' && uiPhase !== 'round-start' && (
        <div style={{
          margin: '4px 12px',
          padding: '8px 14px',
          borderRadius: 10,
          background: 'rgba(42,53,34,0.85)',
          border: '2px solid #e2b858',
          textAlign: 'center',
          animation: 'ready-pulse 2s ease-in-out infinite',
        }}>
          <span style={{
            color: '#e2b858',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 1,
          }}>
            YOUR TURN
          </span>
        </div>
      )}
      {!isMyTurn && uiPhase !== 'round-end' && uiPhase !== 'game-over' && uiPhase !== 'round-start' && (
        <div style={{
          margin: '4px 12px',
          padding: '6px 14px',
          borderRadius: 10,
          background: 'rgba(15,34,24,0.6)',
          border: '1px solid #2d5a3a',
          textAlign: 'center',
        }}>
          <span style={{ color: '#a8d0a8', fontSize: 12 }}>
            Waiting for <span style={{ color: '#e2b858', fontWeight: 700 }}>{currentPlayerName}</span>...
          </span>
        </div>
      )}

      {/* ── Zone 4: Hand ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 8px' }}>
        {/* Hand info label */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2px 0 4px',
          gap: 6,
        }}>
          {isOnTheEdge && myHand.length === 1 ? (
            <span style={{
              color: '#e2b858',
              fontSize: 11,
              fontWeight: 700,
            }}>
              Final card — lay it off to go out!
            </span>
          ) : isOnTheEdge ? (
            <span style={{
              color: '#e2b858',
              fontSize: 11,
              fontWeight: 600,
            }}>
              {myHand.length} cards · {handPoints} pts — almost there!
            </span>
          ) : (
            <span style={{
              color: '#6aad7a',
              fontSize: 11,
            }}>
              {myHand.length} cards · {handPoints} pts
            </span>
          )}
        </div>
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

      {/* Scoreboard overlay */}
      {showScoreboard && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowScoreboard(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 49,
              background: 'rgba(0,0,0,0.5)',
            }}
          />
          {/* Bottom sheet */}
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: '#0f2218',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            animation: 'meld-staging-in 0.25s ease-out',
            maxHeight: '70dvh',
            overflowY: 'auto',
          }}>
            {/* Handle bar */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#2d5a3a' }} />
            </div>
            <h3 style={{ color: '#e2b858', fontSize: 15, fontWeight: 700, textAlign: 'center', marginBottom: 12 }}>
              Scoreboard
            </h3>
            {/* Score table */}
            <div style={{ overflowX: 'auto', padding: '0 12px 12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', color: '#6aad7a', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #2d5a3a', whiteSpace: 'nowrap' }}>Player</th>
                    {[1,2,3,4,5,6,7].map(r => (
                      <th key={r} style={{
                        textAlign: 'center', color: r <= currentRound ? '#6aad7a' : '#2d5a3a',
                        fontWeight: 600, padding: '4px 6px', borderBottom: '1px solid #2d5a3a',
                        minWidth: 28,
                      }}>R{r}</th>
                    ))}
                    <th style={{ textAlign: 'right', color: '#e2b858', fontWeight: 700, padding: '4px 8px', borderBottom: '1px solid #2d5a3a' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scores]
                    .map((s, originalIdx) => ({ ...s, originalIdx }))
                    .sort((a, b) => {
                      const totalA = a.roundScores.reduce((sum, n) => sum + n, 0)
                      const totalB = b.roundScores.reduce((sum, n) => sum + n, 0)
                      return totalA - totalB
                    })
                    .map(s => {
                      const total = s.roundScores.reduce((sum, n) => sum + n, 0)
                      const isMe = s.originalIdx === view.myPlayerIndex
                      return (
                        <tr key={s.name}>
                          <td style={{
                            padding: '6px 8px',
                            color: isMe ? '#e2b858' : '#a8d0a8',
                            fontWeight: isMe ? 700 : 400,
                            whiteSpace: 'nowrap',
                            borderBottom: '1px solid #1a3a2a',
                          }}>
                            {s.name}{isMe ? ' (you)' : ''}
                          </td>
                          {[0,1,2,3,4,5,6].map(ri => {
                            const played = ri < s.roundScores.length
                            const val = played ? s.roundScores[ri] : null
                            return (
                              <td key={ri} style={{
                                textAlign: 'center',
                                padding: '6px 4px',
                                color: val === null ? '#2d5a3a' : val === 0 ? '#6aad7a' : '#a8d0a8',
                                fontWeight: val === 0 ? 700 : 400,
                                borderBottom: '1px solid #1a3a2a',
                              }}>
                                {val === null ? '-' : val}
                              </td>
                            )
                          })}
                          <td style={{
                            textAlign: 'right',
                            padding: '6px 8px',
                            color: isMe ? '#e2b858' : '#ffffff',
                            fontWeight: 700,
                            borderBottom: '1px solid #1a3a2a',
                          }}>
                            {total}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

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
