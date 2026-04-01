import { useState, useEffect, useMemo } from 'react'
import { loadActionLog, type ActionLogEntry } from '../../lib/actionLog'
import { initReplayState, applyAction, type ReplayState } from '../../game/replay-engine'
import { ChevronLeft, Play, Pause, SkipForward, SkipBack } from 'lucide-react'
import CardComponent from './Card'
import { cardPoints } from '../../game/rules'

interface Props {
  gameId: string
  playerNames: string[]
  onExit: () => void
}

export default function ReplayViewer({ gameId, playerNames, onExit }: Props) {
  const [actions, setActions] = useState<ActionLogEntry[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [speed, setSpeed] = useState<1 | 2 | 4>(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadActionLog(gameId).then(log => {
      setActions(log)
      setLoading(false)
      if (log.length === 0) setError('No replay data available.')
    })
  }, [gameId])

  // Compute all states up front (memoized)
  const allStates = useMemo(() => {
    if (actions.length === 0) return []
    const initial = initReplayState(actions, playerNames)
    if (!initial) return []
    const states: ReplayState[] = [initial]
    let current = initial
    for (const action of actions.slice(1)) { // skip first round_start (used by init)
      current = applyAction(current, action)
      states.push(current)
    }
    return states
  }, [actions, playerNames])

  // Auto-play timer
  useEffect(() => {
    if (!playing || currentStep >= allStates.length - 1) {
      if (playing && currentStep >= allStates.length - 1) setPlaying(false)
      return
    }
    const delay = 800 / speed
    const timer = setTimeout(() => setCurrentStep(s => s + 1), delay)
    return () => clearTimeout(timer)
  }, [playing, currentStep, speed, allStates.length])

  const state = allStates[currentStep] ?? null
  const progress = allStates.length > 1 ? currentStep / (allStates.length - 1) : 0

  // Felt color per round
  const ROUND_FELT: Record<number, string> = {
    1: '#1a3a2a', 2: '#1a2f3a', 3: '#2a1a3a', 4: '#1a3a30',
    5: '#3a1a24', 6: '#1a2a3a', 7: '#2e2a1a',
  }
  const feltBg = state ? (ROUND_FELT[state.currentRound] ?? '#1a3a2a') : '#1a3a2a'

  if (loading) {
    return (
      <div style={{ height: '100dvh', background: '#1a3a2a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6aad7a', fontSize: 14 }}>Loading replay...</span>
      </div>
    )
  }

  if (error || allStates.length === 0) {
    return (
      <div style={{ height: '100dvh', background: '#1a3a2a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ color: '#a8d0a8', fontSize: 14 }}>{error ?? 'Could not reconstruct game (no seed in action log).'}</span>
        <span style={{ color: '#3a5a3a', fontSize: 11 }}>Games started before the replay update don't have seeds.</span>
        <button onClick={onExit} style={{ background: '#1e4a2e', border: '1px solid #2d5a3a', borderRadius: 8, padding: '8px 20px', color: '#6aad7a', cursor: 'pointer' }}>Back</button>
      </div>
    )
  }

  return (
    <div style={{ height: '100dvh', background: feltBg, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'background 1s ease' }}>
      {/* Header */}
      <div style={{ background: '#0f2218', paddingTop: 'max(12px, env(safe-area-inset-top, 44px))', paddingBottom: 8, paddingLeft: 12, paddingRight: 12, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onExit} style={{ background: '#1e4a2e', border: '1px solid #2d5a3a', borderRadius: 10, color: '#6aad7a', cursor: 'pointer', padding: 8, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <span style={{ color: '#e2b858', fontSize: 13, fontWeight: 700, flex: 1 }}>
          Replay — Round {state?.currentRound ?? 1}/7
        </span>
        <span style={{ color: '#a8d0a8', fontSize: 11 }}>
          {currentStep + 1}/{allStates.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#0f2218', flexShrink: 0 }}>
        <div style={{ height: '100%', background: '#e2b858', width: `${progress * 100}%`, transition: 'width 0.15s ease' }} />
      </div>

      {/* Action description */}
      {state?.lastAction && (
        <div style={{ padding: '6px 12px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ color: '#e2b858', fontSize: 12, fontWeight: 600 }}>{state.lastAction}</span>
        </div>
      )}

      {/* Going out banner */}
      {state?.goingOutPlayer && (
        <div style={{ padding: '4px 12px', textAlign: 'center' }}>
          <span style={{ color: '#6aad7a', fontSize: 14, fontWeight: 800 }}>
            {state.goingOutPlayer} GOES OUT!
          </span>
        </div>
      )}

      {/* Player strip */}
      <div style={{ padding: '4px 12px', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
        {state?.players.map((p, i) => (
          <div key={i} style={{
            background: i === state.currentPlayerIndex ? '#1e4a2e' : '#0f2218',
            border: i === state.currentPlayerIndex ? '2px solid #e2b858' : '1px solid #2d5a3a',
            borderRadius: 8, padding: '4px 8px', minWidth: 60, textAlign: 'center', flexShrink: 0,
            position: 'relative',
          }}>
            {i === state.currentPlayerIndex && (
              <div style={{ position: 'absolute', top: -3, right: -3, width: 7, height: 7, borderRadius: '50%', background: '#e2b858', boxShadow: '0 0 4px rgba(226,184,88,0.6)' }} />
            )}
            <div style={{ color: i === state.currentPlayerIndex ? '#e2b858' : '#a8d0a8', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 72 }}>
              {p.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 1 }}>
              <span style={{ color: '#6aad7a', fontSize: 9, fontWeight: 600 }}>{p.hand.length}</span>
              {p.hasLaidDown && <span style={{ color: '#2d7a3a', fontSize: 7, fontWeight: 700, background: 'rgba(45,122,58,0.15)', borderRadius: 3, padding: '0 3px' }}>DOWN</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Game board */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {/* Discard + draw pile info */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6aad7a', fontSize: 9, fontWeight: 600, marginBottom: 2 }}>DRAW</div>
            <div style={{ width: 48, height: 66, borderRadius: 6, background: '#7a1a2e', border: '1px solid #4a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#e8c0c8', fontSize: 11, fontWeight: 700 }}>{state?.drawPile.length ?? 0}</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6aad7a', fontSize: 9, fontWeight: 600, marginBottom: 2 }}>DISCARD</div>
            {state && state.discardPile.length > 0 ? (
              <div style={{ transform: 'scale(0.75)', transformOrigin: 'top center' }}>
                <CardComponent card={state.discardPile[state.discardPile.length - 1]} />
              </div>
            ) : (
              <div style={{ width: 48, height: 66, borderRadius: 6, background: '#1e4a2e', border: '1px solid #2d5a3a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#3a5a3a', fontSize: 9 }}>Empty</span>
              </div>
            )}
          </div>
        </div>

        {/* All players' hands */}
        {state?.players.map((p, i) => {
          const totalPts = p.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)
          const isCurrent = i === state.currentPlayerIndex
          return (
            <div key={i} style={{
              background: isCurrent ? 'rgba(30,74,46,0.3)' : 'rgba(15,34,24,0.2)',
              border: isCurrent ? '1px solid #e2b858' : '1px solid rgba(45,90,58,0.2)',
              borderRadius: 10, padding: '8px 10px', marginBottom: 6,
            }}>
              {/* Player name + status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isCurrent && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e2b858', boxShadow: '0 0 4px rgba(226,184,88,0.6)' }} />}
                  <span style={{ color: isCurrent ? '#e2b858' : '#a8d0a8', fontSize: 12, fontWeight: 700 }}>
                    {p.name}
                  </span>
                  {p.hasLaidDown && <span style={{ color: '#2d7a3a', fontSize: 8, fontWeight: 700, background: 'rgba(45,122,58,0.2)', borderRadius: 3, padding: '1px 5px' }}>LAID DOWN</span>}
                </div>
                <span style={{ color: '#8b7355', fontSize: 9 }}>{totalPts} pts</span>
              </div>
              {/* Hand label */}
              <div style={{ color: '#3a5a3a', fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                Hand ({p.hand.length} cards)
              </div>
              {/* Cards in hand */}
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {p.hand.map(card => (
                  <div key={card.id} style={{ transform: 'scale(0.55)', transformOrigin: 'top left', marginBottom: -28, marginRight: -18 }}>
                    <CardComponent card={card} />
                  </div>
                ))}
                {p.hand.length === 0 && <span style={{ color: '#6aad7a', fontSize: 11, fontWeight: 600 }}>Went out!</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Playback controls */}
      <div style={{
        background: '#0f2218', padding: '8px 12px',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
      }}>
        {/* Scrub bar */}
        <input
          type="range" min="0" max={Math.max(0, allStates.length - 1)} value={currentStep}
          onChange={e => { setCurrentStep(Number(e.target.value)); setPlaying(false) }}
          aria-label="Playback position"
          style={{ width: '100%', accentColor: '#e2b858' }}
        />
        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <button
            onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            aria-label="Step back"
            style={{ background: 'transparent', border: 'none', color: currentStep === 0 ? '#2d5a3a' : '#6aad7a', cursor: 'pointer', padding: 4 }}
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={() => setPlaying(p => !p)}
            aria-label={playing ? 'Pause' : 'Play'}
            style={{
              background: playing ? '#e07a5f' : '#e2b858', border: 'none', borderRadius: '50%',
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#2c1810', cursor: 'pointer',
            }}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            onClick={() => setCurrentStep(s => Math.min(allStates.length - 1, s + 1))}
            disabled={currentStep >= allStates.length - 1}
            aria-label="Step forward"
            style={{ background: 'transparent', border: 'none', color: currentStep >= allStates.length - 1 ? '#2d5a3a' : '#6aad7a', cursor: 'pointer', padding: 4 }}
          >
            <SkipForward size={18} />
          </button>
          <div style={{ display: 'flex', gap: 3, marginLeft: 8 }}>
            {([1, 2, 4] as const).map(s => (
              <button key={s} onClick={() => setSpeed(s)} style={{
                background: speed === s ? '#1e4a2e' : 'transparent', border: '1px solid #2d5a3a',
                borderRadius: 5, padding: '3px 7px', color: speed === s ? '#e2b858' : '#6aad7a',
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}>{s}x</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
