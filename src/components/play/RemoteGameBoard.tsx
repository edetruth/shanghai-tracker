import { useState, useEffect, useRef, useMemo } from 'react'
import { Pause, Wifi, WifiOff } from 'lucide-react'
import { useMultiplayerChannel } from '../../hooks/useMultiplayerChannel'
import type { RemoteGameView } from '../../game/multiplayer-types'
import type { Card as CardType, Meld } from '../../game/types'
import HandDisplay from './HandDisplay'
import TableMelds from './TableMelds'
import CardComponent from './Card'
import MeldBuilder from './MeldBuilder'
import type { MeldBuilderHandle } from './MeldBuilder'
import GameToast, { type QueuedToast } from './GameToast'
import BuyingCinematic, { BuyBottomSheet, FreeTakeBottomSheet } from './BuyingCinematic'
import { useHeartbeat } from '../../multiplayer/useHeartbeat'
import { useActionAck } from '../../multiplayer/useActionAck'
import { haptic } from '../../lib/haptics'
import { playSound, preloadSounds, getSfxVolume, getNotifVolume, setSfxVolume, setNotifVolume } from '../../lib/sounds'
import { notifyTurn, notifyRoundOver, notifyGameOver } from '../../lib/notifications'
import { ROUND_REQUIREMENTS, cardPoints } from '../../game/rules'
import type { EmotePayload } from '../../game/multiplayer-types'
import EmoteBar, { EMOTE_MAP } from './EmoteBar'
import EmoteBubble from './EmoteBubble'

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
  const [sfxVol, setSfxVol] = useState(getSfxVolume)
  const [notifVol, setNotifVol] = useState(getNotifVolume)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [ghostedIds, setGhostedIds] = useState<Set<string>>(new Set())
  const [jokerPositionPrompt, setJokerPositionPrompt] = useState<{ card: CardType; meld: Meld } | null>(null)
  const [activeToast, setActiveToast] = useState<QueuedToast | null>(null)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [hostDisconnected, setHostDisconnected] = useState(false)
  const [activeEmotes, setActiveEmotes] = useState<Map<number, string>>(new Map())
  const lastHostMessageRef = useRef(Date.now())
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const meldBuilderRef = useRef<MeldBuilderHandle | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const mpChannel = useMultiplayerChannel(roomCode)
  const { channel, channelRef, isConnected, onMessage } = mpChannel

  // Heartbeat — keep-alive for connection monitoring
  useHeartbeat({
    seatIndex: mySeatIndex,
    isHost: false,
    broadcast: mpChannel.broadcast,
    onMessage: mpChannel.onMessage,
    isConnected: mpChannel.isConnected,
    remoteSeatIndices: [],
  })

  // Action ACKs — track pending state and retry
  const { sendWithAck, isPending, lastError } = useActionAck({
    seatIndex: mySeatIndex,
    broadcast: mpChannel.broadcast,
    onMessage: mpChannel.onMessage,
  })

  // Listen for state updates from host
  useEffect(() => {
    if (!channel) return
    const unsub = onMessage('game_state', (payload: { targetSeatIndex: number; view: RemoteGameView }) => {
      if (payload.targetSeatIndex === mySeatIndex) {
        setView(payload.view)
        lastHostMessageRef.current = Date.now()
        if (hostDisconnected) setHostDisconnected(false)
        // Haptic when it becomes our turn
        if (payload.view.currentPlayerIndex === payload.view.myPlayerIndex &&
            viewRef.current?.currentPlayerIndex !== payload.view.myPlayerIndex) {
          haptic('tap')
        }
      }
    })
    return unsub
  }, [channel, mySeatIndex, onMessage, hostDisconnected])

  // Detect host disconnect — if no game_state received for 15s while channel is connected
  useEffect(() => {
    if (!view || !isConnected) return
    const checkInterval = setInterval(() => {
      if (Date.now() - lastHostMessageRef.current > 15000 && isConnected) {
        setHostDisconnected(true)
      }
    }, 3000)
    return () => clearInterval(checkInterval)
  }, [view, isConnected])

  // Notify host when we reconnect so they re-broadcast state
  // Track reconnections: only send player_reconnected after a genuine disconnect→reconnect,
  // not on the initial connection. hasEverConnectedRef gates the first connection.
  const hasEverConnectedRef = useRef(false)
  const wasConnectedRef = useRef(false)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      if (hasEverConnectedRef.current && view !== null && channelRef.current) {
        // Genuine reconnection — had a previous connection and view
        channelRef.current.send({ type: 'broadcast', event: 'player_reconnected', payload: { seatIndex: mySeatIndex } })
      }
      hasEverConnectedRef.current = true
    }
    wasConnectedRef.current = isConnected
  }, [isConnected, channelRef, mySeatIndex, view])

  // Listen for action rejections
  useEffect(() => {
    if (!channel) return
    return onMessage('action_rejected', (payload: { seatIndex: number; reason: string }) => {
      if (payload.seatIndex === mySeatIndex) {
        console.warn('Action rejected:', payload.reason)
      }
    })
  }, [channel, mySeatIndex, onMessage])

  // Listen for player disconnections — show toast
  useEffect(() => {
    if (!channel) return
    return onMessage('player_disconnected', (payload: { seatIndex: number; playerName: string }) => {
      setActiveToast({
        id: Date.now(),
        message: `${payload.playerName} disconnected`,
        style: 'pressure',
        icon: '📡',
        duration: 4000,
      })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 4000)
    })
  }, [channel, onMessage])

  // Listen for turn skips — show toast
  useEffect(() => {
    if (!channel) return
    return onMessage('turn_skipped', (payload: { seatIndex: number; reason: string }) => {
      const playerName = view?.scores[payload.seatIndex]?.name ?? 'A player'
      const reason = payload.reason === 'disconnected' ? '(disconnected)' : '(timed out)'
      setActiveToast({
        id: Date.now(),
        message: `${playerName}'s turn skipped ${reason}`,
        style: 'neutral',
        icon: '⏭️',
        duration: 3000,
      })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3000)
    })
  }, [channel, onMessage, view?.scores])

  // Process incoming toast/event notifications from host
  useEffect(() => {
    if (!view) return
    if (view.toast) {
      setActiveToast({
        id: Date.now(),
        message: view.toast.message,
        style: view.toast.style as any,
        icon: view.toast.icon,
        duration: 3000,
      })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3000)
    }
    if (view.lastEvent) {
      setLastEvent(view.lastEvent)
      if (eventTimerRef.current) clearTimeout(eventTimerRef.current)
      eventTimerRef.current = setTimeout(() => setLastEvent(null), 4000)
    }
  }, [view?.toast?.message, view?.lastEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Emote system — send and receive ───────────────────────────────────────
  function handleEmoteSend(emoteId: string) {
    if (!isConnected) return
    mpChannel.broadcast('emote', { seatIndex: mySeatIndex, emoteId, timestamp: Date.now() })
    // Show own emote locally
    const emoji = EMOTE_MAP[emoteId] ?? '\u{1F60A}'
    setActiveEmotes(prev => { const next = new Map(prev); next.set(mySeatIndex, emoji); return next })
    setTimeout(() => setActiveEmotes(prev => { const next = new Map(prev); next.delete(mySeatIndex); return next }), 2500)
  }

  useEffect(() => {
    if (!channel) return
    return onMessage('emote', (payload: EmotePayload) => {
      const emoji = EMOTE_MAP[payload.emoteId] ?? '\u{1F60A}'
      setActiveEmotes(prev => { const next = new Map(prev); next.set(payload.seatIndex, emoji); return next })
      setTimeout(() => setActiveEmotes(prev => { const next = new Map(prev); next.delete(payload.seatIndex); return next }), 2500)
    })
  }, [channel, onMessage])

  // sendWithAck() replaced by sendWithAck() from useActionAck

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

  // Preload sound assets
  useEffect(() => { preloadSounds() }, [])

  // Sound effects triggered by remote state changes
  const prevSoundViewRef = useRef<RemoteGameView | null>(null)
  useEffect(() => {
    if (!view) return
    const prev = prevSoundViewRef.current
    prevSoundViewRef.current = view

    if (!prev) return

    // Going out cinematic
    if (view.goingOutSequence === 'flash' && prev.goingOutSequence !== 'flash') {
      playSound('going-out')
      if (view.goingOutPlayerName) {
        notifyRoundOver(view.goingOutPlayerName, roomCode)
      }
    }

    // Game over
    if (view.gameOver && !prev.gameOver && view.winner) {
      notifyGameOver(view.winner, roomCode)
    }

    // Turn notification (when tab is hidden)
    if (view.currentPlayerIndex === view.myPlayerIndex &&
        prev.currentPlayerIndex !== view.myPlayerIndex &&
        document.hidden) {
      playSound('turn-notify')
      notifyTurn(roomCode)
    }

    // Buying phase — someone snatched
    if (view.buyingCinematicPhase === 'snatched' && prev.buyingCinematicPhase !== 'snatched') {
      playSound('buy-ding')
    }

    // Event-based sounds from lastEvent string matching
    if (view.lastEvent && view.lastEvent !== prev.lastEvent) {
      const evt = view.lastEvent.toLowerCase()
      if (evt.includes('drew') || evt.includes('draw')) playSound('card-draw')
      else if (evt.includes('discard') || evt.includes('took')) playSound('card-snap')
      else if (evt.includes('went down') || evt.includes('laid down')) playSound('meld-slam')
      else if (evt.includes('laid off')) playSound('lay-off')
      else if (evt.includes('swapped a joker') || evt.includes('heist')) playSound('joker-swap')
      else if (evt.includes('bought')) playSound('buy-ding')
    }
  }, [view])

  // Round felt color
  const feltBg = view?.feltColor ?? '#1a3a2a'

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
    const isLateRound = currentRound >= 5
    const isFinalRound = currentRound === 7
    const glowColor = [1, 4].includes(currentRound) ? '#e2b858'
      : [3, 7].includes(currentRound) ? '#5b9bd5' : '#b0a060'

    return (
      <div style={{
        minHeight: '100dvh',
        background: isFinalRound ? '#1a1010' : isLateRound ? '#1a1a10' : '#000000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Round number with glow */}
        <div style={{
          fontSize: 72,
          fontWeight: 900,
          color: glowColor,
          textShadow: `0 0 30px ${glowColor}80, 0 0 60px ${glowColor}40`,
          lineHeight: 1,
          letterSpacing: -2,
        }}>
          {currentRound}
        </div>
        <div style={{
          color: '#ffffff',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 2,
          textTransform: 'uppercase',
          opacity: 0.7,
        }}>
          Round {currentRound} of 7
        </div>
        <div style={{
          color: glowColor,
          fontSize: 22,
          fontWeight: 800,
          textAlign: 'center',
          maxWidth: '80vw',
          textShadow: `0 0 20px ${glowColor}40`,
        }}>
          {requirement.description}
        </div>
        {/* Cards dealt info */}
        <div style={{
          color: '#a8d0a8',
          fontSize: 13,
          opacity: 0.6,
          marginTop: 8,
        }}>
          {currentRound <= 4 ? '10' : '12'} cards dealt
        </div>
        {/* Dealer info from announcement data */}
        {view.announcementData?.dealerName && (
          <div style={{
            color: '#6aad7a',
            fontSize: 12,
            marginTop: 4,
          }}>
            Dealer: {view.announcementData.dealerName}
          </div>
        )}
        {/* Final round warning */}
        {isFinalRound && (
          <div style={{
            color: '#e07a5f',
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginTop: 12,
            animation: 'ready-pulse 1.5s ease-in-out infinite',
          }}>
            FINAL ROUND
          </div>
        )}
      </div>
    )
  }

  // ── Going Out Cinematic ───────────────────────────────────────────────────
  const showGoingOutFlash = view.goingOutSequence === 'flash'
  const showGoingOutAnnounce = view.goingOutSequence === 'announce'

  // ── Round End ─────────────────────────────────────────────────────────────
  if (uiPhase === 'round-end' && view.roundResults) {
    const sortedResults = [...view.roundResults].sort((a, b) => a.score - b.score)
    const hasShanghaiVictim = sortedResults.some(r => r.shanghaied)
    return (
      <div style={{
        minHeight: '100dvh',
        background: feltBg,
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        paddingTop: 'max(48px, env(safe-area-inset-top, 44px) + 16px)',
      }}>
        <h2 style={{ color: '#e2b858', fontSize: 22, fontWeight: 800, marginBottom: 4, textAlign: 'center' }}>
          Round {currentRound} Complete
        </h2>
        <p style={{ color: '#6aad7a', fontSize: 12, textAlign: 'center', marginBottom: 20, opacity: 0.7 }}>
          {requirement.description}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sortedResults.map((r, i) => (
            <div
              key={r.playerName}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: r.wentOut ? 'rgba(45,122,58,0.15)' : r.shanghaied ? 'rgba(184,50,50,0.1)' : '#0f2218',
                borderRadius: 10,
                padding: '12px 16px',
                border: r.wentOut ? '1px solid rgba(45,122,58,0.3)' : r.shanghaied ? '1px solid rgba(184,50,50,0.2)' : '1px solid #1a3a2a',
                animation: `meld-staging-in 0.3s ease-out ${i * 0.1}s both`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  color: r.wentOut ? '#6aad7a' : '#a8d0a8',
                  fontSize: 12,
                  fontWeight: 600,
                  width: 20,
                }}>
                  {r.wentOut ? '⭐' : `#${i + 1}`}
                </span>
                <div>
                  <span style={{ color: '#ffffff', fontSize: 14, fontWeight: 600 }}>{r.playerName}</span>
                  {r.shanghaied && (
                    <span
                      className="slam-in"
                      style={{
                        display: 'inline-block',
                        marginLeft: 8,
                        color: '#e07a5f',
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                      }}
                    >
                      Shanghaied!
                    </span>
                  )}
                </div>
              </div>
              <span style={{
                color: r.wentOut ? '#6aad7a' : r.shanghaied ? '#e07a5f' : '#ffffff',
                fontSize: 20,
                fontWeight: 800,
              }}>
                {r.wentOut ? 'OUT!' : r.score}
              </span>
            </div>
          ))}
        </div>
        {hasShanghaiVictim && (
          <p style={{
            color: '#e07a5f',
            fontSize: 11,
            textAlign: 'center',
            marginTop: 12,
            opacity: 0.7,
          }}>
            Shanghaied players receive penalty points for cards in hand
          </p>
        )}
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
        <div
          className="go-impact-flash"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'white',
            pointerEvents: 'none',
          }}
        />
      )}
      {showGoingOutAnnounce && view.goingOutPlayerName && (
        <div
          className="go-backdrop-fade"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 4,
          }}
        >
          <span
            className="slam-in"
            style={{
              color: '#e2b858',
              fontSize: 32,
              fontWeight: 900,
              textShadow: '0 0 30px rgba(226,184,88,0.6)',
              letterSpacing: 2,
            }}
          >
            {view.goingOutPlayerName}
          </span>
          <span
            className="slam-in"
            style={{
              color: '#ffffff',
              fontSize: 18,
              fontWeight: 700,
              animationDelay: '0.15s',
            }}
          >
            GOES OUT!
          </span>
        </div>
      )}

      {/* Final card drama — vignette spotlight */}
      {view.isOnTheEdge && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'radial-gradient(ellipse at center bottom, transparent 30%, rgba(0,0,0,0.4) 100%)',
          pointerEvents: 'none',
          zIndex: 5,
          transition: 'opacity 0.5s ease',
        }} />
      )}

      {/* GameToast overlay */}
      <GameToast toast={activeToast} />

      {/* ── Zone 1: Top bar ─────────────────────────────────────────────── */}
      <div style={{
        background: '#0f2218',
        paddingTop: 'env(safe-area-inset-top, 44px)',
        padding: '8px 12px',
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto',
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

        {/* Right: Emote + Wifi icon */}
        <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 6 }}>
          <EmoteBar onSend={handleEmoteSend} disabled={!isConnected} />
          {isConnected ? <Wifi size={12} style={{ color: '#6aad7a' }} /> : <WifiOff size={12} style={{ color: '#e07a5f' }} />}
        </div>
      </div>

      {/* ── Event notification bar ────────────────────────────────────── */}
      {lastEvent && (
        <div style={{
          position: 'fixed', top: 'max(100px, env(safe-area-inset-top, 44px) + 56px)',
          left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,34,24,0.9)',
          border: '1px solid #2d5a3a',
          borderRadius: 20,
          padding: '6px 16px',
          color: '#a8d0a8',
          fontSize: 11,
          zIndex: 45,
          animation: 'toast-enter 0.3s ease-out',
        }}>
          {lastEvent}
        </div>
      )}

      {/* Action pending indicator */}
      {isPending && (
        <div style={{
          position: 'fixed', bottom: 'max(100px, env(safe-area-inset-bottom, 12px) + 88px)',
          left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,34,24,0.9)',
          border: '1px solid #2d5a3a',
          borderRadius: 20,
          padding: '6px 16px',
          color: '#a8d0a8',
          fontSize: 11,
          zIndex: 30,
          animation: 'ready-pulse 1.5s ease-in-out infinite',
        }}>
          Sending...
        </div>
      )}

      {/* Action error */}
      {lastError && (
        <div style={{
          position: 'fixed', top: 'max(60px, env(safe-area-inset-top, 44px) + 16px)',
          left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(184,50,50,0.9)',
          borderRadius: 10,
          padding: '8px 16px',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          zIndex: 40,
        }}>
          {lastError}
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
                {/* Emote bubble */}
                {activeEmotes.has(p.seatIndex) && (
                  <EmoteBubble emoji={activeEmotes.get(p.seatIndex)!} onDone={() => {}} />
                )}
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
                {/* Disconnected indicator */}
                {view.disconnectedPlayers?.includes(p.seatIndex) && (
                  <div style={{
                    position: 'absolute',
                    top: -3,
                    left: -3,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#e07a5f',
                    boxShadow: '0 0 4px rgba(224,122,95,0.6)',
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
                {/* Turn timer countdown for disconnected player */}
                {isCurrentTurn && view.turnTimeRemaining !== undefined && view.turnTimeRemaining <= 15 && (
                  <div style={{
                    color: view.turnTimeRemaining <= 5 ? '#e07a5f' : '#a8d0a8',
                    fontSize: 9,
                    fontWeight: 700,
                    marginTop: 1,
                  }}>
                    {view.turnTimeRemaining}s
                  </div>
                )}
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

        {/* Table melds — dim during buying phase */}
        {tableMelds.length > 0 && (
          <div style={{ opacity: isBuyingPhase ? 0.75 : 1, transition: 'opacity 0.3s ease' }}>
          <TableMelds
            melds={tableMelds}
            currentPlayerId={view.myHand.length > 0 ? `p${view.myPlayerIndex}` : ''}
            onLayOff={view.myHasLaidDown && isMyTurn && uiPhase === 'action' && !isPending ? (card: CardType, meld: Meld) => {
              if (card.suit === 'joker' && meld.type === 'run') {
                const canLow = (meld.runMin ?? 1) > 1
                const canHigh = (meld.runMax ?? 13) < 14
                if (canLow && canHigh) {
                  setJokerPositionPrompt({ card, meld })
                  return
                }
                const pos: 'low' | 'high' = canLow ? 'low' : 'high'
                sendWithAck({ type: 'lay_off', cardId: card.id, meldId: meld.id, jokerPosition: pos })
                return
              }
              sendWithAck({ type: 'lay_off', cardId: card.id, meldId: meld.id })
            } : undefined}
            onJokerSwap={view.myHasLaidDown && isMyTurn && uiPhase === 'action' ? (card: CardType, meld: Meld) => {
              sendWithAck({ type: 'joker_swap', cardId: card.id, meldId: meld.id })
            } : undefined}
          />
          </div>
        )}
      </div>

      {/* ── Zone 3: Draw / discard piles (hidden during buy window + meld building) */}
      {!showMeldBuilder && !isBuyingPhase && (
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
            <div style={{ position: 'relative', width: 64, height: 88 }}>
              {/* Stacked pile depth — bottom card */}
              <div style={{
                position: 'absolute', top: -3, left: 3, width: 64, height: 88,
                borderRadius: 8, background: '#5a1220', border: '1px solid #3a0e18',
              }} />
              {/* Stacked pile depth — middle card */}
              <div style={{
                position: 'absolute', top: -1.5, left: 1.5, width: 64, height: 88,
                borderRadius: 8, background: '#6a1828', border: '1px solid #4a1420',
              }} />
              {/* Top card (interactive) */}
              <button
                onClick={() => drawActive && !isPending && sendWithAck({ type: 'draw_pile' })}
                disabled={!drawActive || isPending}
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
                if (discardActive && discardTop && !isPending) {
                  sendWithAck({ type: 'take_discard' })
                }
              }}
              disabled={!discardActive || !discardTop || isPending}
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
              sendWithAck({
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

      {/* ── Buying cinematic overlay (non-interactive phases) ────────── */}
      <BuyingCinematic
        phase={isBuyingPhase ? (buyingState?.buyingPhase ?? 'hidden') : 'hidden'}
        card={buyingState?.buyingDiscard ?? null}
        isFreeOffer={false}
        buyerName={view.buyingSnatcherName ?? undefined}
        passedPlayers={buyingState?.passedPlayers ?? []}
        buysRemaining={view.myBuysRemaining}
        buyLimit={view.buyLimit}
        cardLabel={buyingState?.buyingDiscard ? formatCard(buyingState.buyingDiscard) : ''}
        onBuy={() => sendWithAck({ type: 'buy', wantsToBuy: true })}
        onPass={() => sendWithAck({ type: 'buy', wantsToBuy: false })}
      />

      {/* Free offer — real bottom sheet */}
      {hasFreeOffer && view.pendingFreeOffer && (
        <FreeTakeBottomSheet
          card={view.pendingFreeOffer}
          cardLabel={formatCard(view.pendingFreeOffer)}
          onTake={() => sendWithAck({ type: 'take_discard' })}
          onPass={() => sendWithAck({ type: 'decline_free_offer' })}
        />
      )}

      {/* Buy decision — real bottom sheet */}
      {isBuyingMyTurn && buyingState && (
        <BuyBottomSheet
          card={buyingState.buyingDiscard}
          buysRemaining={view.myBuysRemaining}
          buyLimit={view.buyLimit}
          cardLabel={formatCard(buyingState.buyingDiscard)}
          canBuy={view.myBuysRemaining > 0}
          onBuy={() => sendWithAck({ type: 'buy', wantsToBuy: true })}
          onPass={() => sendWithAck({ type: 'buy', wantsToBuy: false })}
        />
      )}

      {/* ── Turn banner ──────────────────────────────────────────────── */}
      {isMyTurn && uiPhase !== 'round-end' && uiPhase !== 'game-over' && uiPhase !== 'round-start' && (
        <div
          className="turnBannerIn"
          style={{
            margin: '4px 12px',
            padding: '10px 14px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(226,184,88,0.15), rgba(45,122,58,0.15))',
            border: '2px solid #e2b858',
            textAlign: 'center',
            boxShadow: '0 0 20px rgba(226,184,88,0.2)',
            animation: 'ready-pulse 2s ease-in-out infinite',
          }}
        >
          <span style={{
            color: '#e2b858',
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}>
            {uiPhase === 'draw' ? (hasFreeOffer ? 'FREE TAKE OFFER' : 'YOUR TURN — DRAW') : 'YOUR TURN'}
          </span>
        </div>
      )}
      {!isMyTurn && uiPhase !== 'round-end' && uiPhase !== 'game-over' && uiPhase !== 'round-start' && !isBuyingMyTurn && (
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
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '0 8px',
        opacity: isMyTurn ? 1 : 0.7,
        transition: 'opacity 0.3s ease',
      }}>
        {/* Perfect draw indicator */}
        {view.perfectDraw && (
          <div style={{
            textAlign: 'center',
            padding: '4px 0',
            color: '#e2b858',
            fontSize: 12,
            fontWeight: 700,
            animation: 'ready-pulse 1.5s ease-in-out infinite',
          }}>
            Ready to lay down!
          </div>
        )}
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
          edgeGlow={view.isOnTheEdge}
          shimmerCardId={view.shimmerCardId}
          compact={isBuyingPhase}
          onToggle={(cardId: string) => {
            if (!isMyTurn || isPending) return
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

      {/* Joker position prompt */}
      {jokerPositionPrompt && (
        <div style={{
          margin: '0 12px',
          backgroundColor: '#2e1a0e',
          borderRadius: 10,
          border: '1px solid #e2b858',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <p style={{ color: '#f0d480', fontSize: 11, fontWeight: 600, margin: 0, flex: 1 }}>
            Place Joker where?
          </p>
          <button
            onClick={() => {
              sendWithAck({ type: 'lay_off', cardId: jokerPositionPrompt.card.id, meldId: jokerPositionPrompt.meld.id, jokerPosition: 'low' })
              setJokerPositionPrompt(null)
            }}
            style={{
              background: '#6aad7a', color: '#0f2218', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 36,
            }}
          >
            Low
          </button>
          <button
            onClick={() => {
              sendWithAck({ type: 'lay_off', cardId: jokerPositionPrompt.card.id, meldId: jokerPositionPrompt.meld.id, jokerPosition: 'high' })
              setJokerPositionPrompt(null)
            }}
            style={{
              background: '#e2b858', color: '#2c1810', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 36,
            }}
          >
            High
          </button>
        </div>
      )}

      {/* ── Zone 5: Action buttons ──────────────────────────────────────── */}
      <div style={{
        padding: '8px 12px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
      }}>
        {isMyTurn && uiPhase === 'action' && !showMeldBuilder && !jokerPositionPrompt && (
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
                  sendWithAck({ type: 'discard', cardId })
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

      {/* Host disconnected banner */}
      {hostDisconnected && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 90,
          background: 'rgba(184,50,50,0.95)',
          padding: '12px 16px',
          paddingTop: 'max(12px, env(safe-area-inset-top, 44px))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ color: '#ffffff', fontSize: 14, fontWeight: 700 }}>Host disconnected</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
              Waiting for host to reconnect...
            </div>
          </div>
          <button
            onClick={onExit}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 8,
              padding: '8px 16px',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Leave Game
          </button>
        </div>
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
            {/* Volume controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#a8d0a8', fontSize: 12, minWidth: 90 }}>Game Sounds</span>
                <input
                  type="range" min="0" max="1" step="0.1"
                  value={sfxVol}
                  onChange={e => { const v = Number(e.target.value); setSfxVol(v); setSfxVolume(v) }}
                  aria-label="Game sounds volume"
                  style={{ flex: 1, accentColor: '#e2b858' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#a8d0a8', fontSize: 12, minWidth: 90 }}>Notifications</span>
                <input
                  type="range" min="0" max="1" step="0.1"
                  value={notifVol}
                  onChange={e => { const v = Number(e.target.value); setNotifVol(v); setNotifVolume(v) }}
                  aria-label="Notification volume"
                  style={{ flex: 1, accentColor: '#e2b858' }}
                />
              </div>
            </div>
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

function formatCard(card: CardType): string {
  if (card.rank === 0) return 'Jkr'
  const r = card.rank
  const rank = r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r)
  const suit = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'
  return `${rank}${suit}`
}
