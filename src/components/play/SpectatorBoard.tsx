import { useState, useEffect, useRef } from 'react'
import { Wifi, WifiOff, Eye } from 'lucide-react'
import { useMultiplayerChannel } from '../../hooks/useMultiplayerChannel'
import type { SpectatorGameView } from '../../game/multiplayer-types'
import CardComponent from './Card'
import GameToast, { type QueuedToast } from './GameToast'
import TableMelds from './TableMelds'
import { playSound, preloadSounds } from '../../lib/sounds'
import { haptic } from '../../lib/haptics'
import { ROUND_REQUIREMENTS } from '../../game/rules'

interface Props {
  roomCode: string
  onExit: () => void
}

export default function SpectatorBoard({ roomCode, onExit }: Props) {
  const [view, setView] = useState<SpectatorGameView | null>(null)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [activeToast, setActiveToast] = useState<QueuedToast | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mpChannel = useMultiplayerChannel(roomCode)
  const { isConnected, onMessage } = mpChannel

  useEffect(() => { preloadSounds() }, [])

  // Listen for spectator view updates
  useEffect(() => {
    return onMessage('spectator_view', (payload: { view: SpectatorGameView }) => {
      setView(payload.view)
    })
  }, [onMessage])

  // Process toasts
  useEffect(() => {
    if (!view?.toast) return
    setActiveToast({
      id: Date.now(),
      message: view.toast.message,
      style: view.toast.style as QueuedToast['style'],
      icon: view.toast.icon,
      duration: 3000,
    })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setActiveToast(null), 3000)
  }, [view?.toast?.message]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sound effects
  const prevViewRef = useRef<SpectatorGameView | null>(null)
  useEffect(() => {
    if (!view) return
    const prev = prevViewRef.current
    prevViewRef.current = view
    if (!prev) return
    if (view.goingOutSequence === 'flash' && prev.goingOutSequence !== 'flash') playSound('going-out')
  }, [view])

  const feltBg = view?.feltColor ?? '#1a3a2a'
  const currentRound = view?.currentRound ?? 1
  const requirement = view?.roundRequirement ?? ROUND_REQUIREMENTS[0]

  // Waiting screen
  if (!view) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#1a3a2a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <Eye size={32} style={{ color: '#e2b858' }} />
        <div style={{ color: isConnected ? '#6aad7a' : '#e07a5f', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
          {isConnected ? 'Watching — waiting for game...' : 'Connecting...'}
        </div>
        <p style={{ color: '#3a5a3a', fontSize: 12 }}>Room: {roomCode}</p>
        <button onClick={onExit} style={{
          background: 'transparent', border: '1px solid #2d5a3a', borderRadius: 8,
          padding: '8px 20px', color: '#6aad7a', cursor: 'pointer', fontSize: 12,
        }}>Leave</button>
      </div>
    )
  }

  // Game over
  if (view.gameOver) {
    const sorted = [...view.scores].sort((a, b) =>
      a.roundScores.reduce((s, n) => s + n, 0) - b.roundScores.reduce((s, n) => s + n, 0)
    )
    return (
      <div style={{
        minHeight: '100dvh', background: '#1a3a2a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24,
        paddingTop: 'max(48px, env(safe-area-inset-top))',
      }}>
        <Eye size={16} style={{ color: '#e2b858', marginBottom: 8 }} />
        <span style={{ color: '#e2b858', fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Game Over</span>
        {view.winner && <span style={{ color: '#6aad7a', fontSize: 16, marginBottom: 24 }}>{view.winner} wins!</span>}
        <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((s, i) => {
            const total = s.roundScores.reduce((sum, n) => sum + n, 0)
            return (
              <div key={s.name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: '#0f2218', borderRadius: 10, padding: '12px 16px',
                border: i === 0 ? '1px solid #e2b858' : '1px solid #2d5a3a',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#e2b858', fontSize: 14, fontWeight: 700, width: 20 }}>#{i + 1}</span>
                  <span style={{ color: '#ffffff', fontSize: 14 }}>{s.name}</span>
                </div>
                <span style={{ color: '#a8d0a8', fontSize: 16, fontWeight: 700 }}>{total}</span>
              </div>
            )
          })}
        </div>
        <button onClick={onExit} style={{
          marginTop: 32, background: '#e2b858', border: 'none', borderRadius: 12,
          padding: '14px 40px', color: '#2c1810', fontSize: 16, fontWeight: 700, cursor: 'pointer',
        }}>Back to Menu</button>
      </div>
    )
  }

  // Round announcement
  if (view.announcementStage && view.uiPhase === 'round-start') {
    const glowColor = [1, 4].includes(currentRound) ? '#e2b858' : [3, 7].includes(currentRound) ? '#5b9bd5' : '#b0a060'
    return (
      <div style={{
        minHeight: '100dvh', background: '#000000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 72, fontWeight: 900, color: glowColor, textShadow: `0 0 30px ${glowColor}80`, lineHeight: 1 }}>{currentRound}</div>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, letterSpacing: 2, opacity: 0.7 }}>Round {currentRound} of 7</div>
        <div style={{ color: glowColor, fontSize: 22, fontWeight: 800, textAlign: 'center' }}>{requirement.description}</div>
      </div>
    )
  }

  // Round end
  if (view.uiPhase === 'round-end' && view.roundResults) {
    return (
      <div style={{
        minHeight: '100dvh', background: feltBg,
        display: 'flex', flexDirection: 'column', padding: 16,
        paddingTop: 'max(48px, calc(env(safe-area-inset-top, 44px) + 16px))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
          <Eye size={14} style={{ color: '#e2b858' }} />
          <span style={{ color: '#e2b858', fontSize: 20, fontWeight: 700 }}>Round {currentRound} Complete</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...view.roundResults].sort((a, b) => a.score - b.score).map((r, i) => (
            <div key={r.playerName} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: r.wentOut ? 'rgba(45,122,58,0.15)' : '#0f2218',
              borderRadius: 8, padding: '10px 14px',
              border: r.wentOut ? '1px solid rgba(45,122,58,0.3)' : '1px solid #1a3a2a',
              animation: `meld-staging-in 0.3s ease-out ${i * 0.1}s both`,
            }}>
              <div>
                <span style={{ color: '#ffffff', fontSize: 14 }}>{r.playerName}</span>
                {r.shanghaied && <span className="slam-in" style={{ color: '#e07a5f', fontSize: 11, marginLeft: 8, fontWeight: 800 }}>Shanghaied!</span>}
              </div>
              <span style={{ color: r.wentOut ? '#6aad7a' : '#ffffff', fontSize: 18, fontWeight: 700 }}>
                {r.wentOut ? 'OUT!' : r.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Going out cinematic
  const showGoingOutFlash = view.goingOutSequence === 'flash'
  const showGoingOutAnnounce = view.goingOutSequence === 'announce'

  // Current player name
  const currentPlayer = view.players.find(p => p.seatIndex === view.currentPlayerIndex)

  return (
    <div style={{
      minHeight: '100dvh', background: feltBg,
      display: 'flex', flexDirection: 'column',
      transition: 'background 3s ease', position: 'relative',
    }}>
      {/* Going out cinematics */}
      {showGoingOutFlash && <div className="go-impact-flash" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'white', pointerEvents: 'none' }} />}
      {showGoingOutAnnounce && view.goingOutPlayerName && (
        <div className="go-backdrop-fade" style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4,
        }}>
          <span className="slam-in" style={{ color: '#e2b858', fontSize: 32, fontWeight: 900, textShadow: '0 0 30px rgba(226,184,88,0.6)' }}>{view.goingOutPlayerName}</span>
          <span className="slam-in" style={{ color: '#fff', fontSize: 18, fontWeight: 700, animationDelay: '0.15s' }}>GOES OUT!</span>
        </div>
      )}

      <GameToast toast={activeToast} />

      {/* Top bar */}
      <div style={{
        background: '#0f2218', paddingTop: 'env(safe-area-inset-top, 44px)',
        padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Eye size={14} style={{ color: '#e2b858' }} />
          <span style={{ color: '#e2b858', fontSize: 11, fontWeight: 600 }}>SPECTATING</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: '#0f2218', border: '1px solid #2d5a3a', borderRadius: 20, padding: '4px 10px', color: '#a8d0a8', fontSize: 11, fontWeight: 600 }}>R{currentRound}/7</span>
          <span style={{ background: '#0f2218', border: '1px solid #8b6914', borderRadius: 20, padding: '4px 10px', color: '#e2b858', fontSize: 11, fontWeight: 600 }}>{requirement.description}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isConnected ? <Wifi size={12} style={{ color: '#6aad7a' }} /> : <WifiOff size={12} style={{ color: '#e07a5f' }} />}
          <button onClick={onExit} style={{ background: 'transparent', border: '1px solid #2d5a3a', borderRadius: 6, padding: '4px 10px', color: '#6aad7a', fontSize: 10, cursor: 'pointer' }}>Leave</button>
        </div>
      </div>

      {/* Current turn indicator */}
      <div style={{ padding: '4px 12px', textAlign: 'center' }}>
        <span style={{ color: '#e2b858', fontSize: 12, fontWeight: 600 }}>
          {currentPlayer?.name ?? '...'}&apos;s turn
        </span>
      </div>

      {/* All players' hands — scrollable grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {/* Table melds */}
        {view.tableMelds.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <TableMelds melds={view.tableMelds} currentPlayerId="" />
          </div>
        )}

        {/* Player hand panels */}
        {view.players.map(p => {
          const isCurrentTurn = p.seatIndex === view.currentPlayerIndex
          const score = view.scores[p.seatIndex]
          const totalScore = score ? score.roundScores.reduce((s, n) => s + n, 0) : 0
          return (
            <div key={p.seatIndex} style={{
              background: isCurrentTurn ? 'rgba(30,74,46,0.4)' : 'rgba(15,34,24,0.3)',
              border: isCurrentTurn ? '1px solid #e2b858' : '1px solid rgba(45,90,58,0.3)',
              borderRadius: 10, padding: '8px', marginBottom: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isCurrentTurn && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e2b858', boxShadow: '0 0 4px rgba(226,184,88,0.6)' }} />}
                  <span style={{ color: isCurrentTurn ? '#e2b858' : '#a8d0a8', fontSize: 12, fontWeight: 600 }}>
                    {p.name}{p.isAI ? ' (AI)' : ''}
                  </span>
                  {p.hasLaidDown && <span style={{ color: '#2d7a3a', fontSize: 9, fontWeight: 700, background: 'rgba(45,122,58,0.15)', borderRadius: 3, padding: '0 4px' }}>DOWN</span>}
                </div>
                <span style={{ color: '#8b7355', fontSize: 10 }}>{totalScore} pts | {p.hand.length} cards</span>
              </div>
              {/* Mini hand display — show all cards in a compact row */}
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {p.hand.map(card => (
                  <div key={card.id} style={{ transform: 'scale(0.6)', transformOrigin: 'top left', marginBottom: -30, marginRight: -16 }}>
                    <CardComponent card={card} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Scoreboard toggle */}
      <div style={{ padding: '8px 12px', paddingBottom: 'max(8px, env(safe-area-inset-bottom))', flexShrink: 0, textAlign: 'center' }}>
        <button
          onClick={() => { setShowScoreboard(s => !s); haptic('tap') }}
          style={{ background: '#0f2218', border: '1px solid #2d5a3a', borderRadius: 8, padding: '8px 20px', color: '#6aad7a', fontSize: 12, cursor: 'pointer' }}
        >
          {showScoreboard ? 'Hide Scoreboard' : 'Show Scoreboard'}
        </button>
      </div>

      {/* Scoreboard overlay */}
      {showScoreboard && (
        <>
          <div onClick={() => setShowScoreboard(false)} style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: '#0f2218', borderTopLeftRadius: 16, borderTopRightRadius: 16,
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            maxHeight: '70dvh', overflowY: 'auto', animation: 'meld-staging-in 0.25s ease-out',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#2d5a3a' }} />
            </div>
            <h3 style={{ color: '#e2b858', fontSize: 15, fontWeight: 700, textAlign: 'center', marginBottom: 12 }}>Scoreboard</h3>
            <div style={{ overflowX: 'auto', padding: '0 12px 12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', color: '#6aad7a', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #2d5a3a' }}>Player</th>
                    {[1,2,3,4,5,6,7].map(r => (
                      <th key={r} style={{ textAlign: 'center', color: r <= currentRound ? '#6aad7a' : '#2d5a3a', fontWeight: 600, padding: '4px 6px', borderBottom: '1px solid #2d5a3a', minWidth: 28 }}>R{r}</th>
                    ))}
                    <th style={{ textAlign: 'right', color: '#e2b858', fontWeight: 700, padding: '4px 8px', borderBottom: '1px solid #2d5a3a' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...view.scores]
                    .map((s, idx) => ({ ...s, idx }))
                    .sort((a, b) => a.roundScores.reduce((x, n) => x + n, 0) - b.roundScores.reduce((x, n) => x + n, 0))
                    .map(s => {
                      const total = s.roundScores.reduce((sum, n) => sum + n, 0)
                      return (
                        <tr key={s.name}>
                          <td style={{ padding: '6px 8px', color: '#a8d0a8', borderBottom: '1px solid #1a3a2a', whiteSpace: 'nowrap' }}>{s.name}</td>
                          {[0,1,2,3,4,5,6].map(ri => {
                            const val = ri < s.roundScores.length ? s.roundScores[ri] : null
                            return <td key={ri} style={{ textAlign: 'center', padding: '6px 4px', color: val === null ? '#2d5a3a' : val === 0 ? '#6aad7a' : '#a8d0a8', fontWeight: val === 0 ? 700 : 400, borderBottom: '1px solid #1a3a2a' }}>{val === null ? '-' : val}</td>
                          })}
                          <td style={{ textAlign: 'right', padding: '6px 8px', color: '#fff', fontWeight: 700, borderBottom: '1px solid #1a3a2a' }}>{total}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
