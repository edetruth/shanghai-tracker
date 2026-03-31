import { useState, useEffect } from 'react'
import { loadActionLog, type ActionLogEntry } from '../../lib/actionLog'
import { ChevronLeft, Play, Pause, SkipForward, SkipBack } from 'lucide-react'

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

  useEffect(() => {
    loadActionLog(gameId).then(log => {
      setActions(log)
      setLoading(false)
    })
  }, [gameId])

  // Auto-play timer
  useEffect(() => {
    if (!playing || currentStep >= actions.length - 1) {
      setPlaying(false)
      return
    }
    const delay = 1000 / speed
    const timer = setTimeout(() => setCurrentStep(s => s + 1), delay)
    return () => clearTimeout(timer)
  }, [playing, currentStep, speed, actions.length])

  function formatAction(entry: ActionLogEntry): string {
    const name = playerNames[entry.player_index] ?? `Player ${entry.player_index + 1}`
    switch (entry.action_type) {
      case 'draw_pile': return `${name} drew from pile`
      case 'take_discard': return `${name} took from discard`
      case 'discard': return `${name} discarded ${entry.action_data.cardLabel ?? 'a card'}`
      case 'meld_confirm': return `${name} laid down melds`
      case 'lay_off': return `${name} laid off a card`
      case 'joker_swap': return `${name} swapped a joker`
      case 'buy': return entry.action_data.wantsToBuy ? `${name} bought a card` : `${name} passed on buy`
      case 'decline_free_offer': return `${name} declined free offer`
      case 'round_start': return `Round ${entry.action_data.round} started`
      case 'round_end': return `Round ${entry.action_data.round} ended`
      case 'going_out': return `${name} went out!`
      default: return `${name}: ${entry.action_type}`
    }
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#1a3a2a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: '#6aad7a', fontSize: 14 }}>Loading replay...</span>
      </div>
    )
  }

  if (actions.length === 0) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#1a3a2a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <span style={{ color: '#a8d0a8', fontSize: 14 }}>No replay data available for this game.</span>
        <button onClick={onExit} style={{
          background: '#1e4a2e', border: '1px solid #2d5a3a', borderRadius: 8,
          padding: '8px 20px', color: '#6aad7a', cursor: 'pointer',
        }}>Back</button>
      </div>
    )
  }

  const visibleActions = actions.slice(0, currentStep + 1)
  const progress = actions.length > 1 ? currentStep / (actions.length - 1) : 0

  return (
    <div style={{
      minHeight: '100dvh', background: '#1a3a2a',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        background: '#0f2218', paddingTop: 'env(safe-area-inset-top, 44px)',
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <button onClick={onExit} style={{
          background: 'transparent', border: 'none', color: '#6aad7a', cursor: 'pointer', padding: 4,
        }}>
          <ChevronLeft size={20} />
        </button>
        <span style={{ color: '#e2b858', fontSize: 14, fontWeight: 700, flex: 1 }}>Game Replay</span>
        <span style={{ color: '#a8d0a8', fontSize: 11 }}>
          {currentStep + 1} / {actions.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#0f2218', flexShrink: 0 }}>
        <div style={{
          height: '100%', background: '#e2b858',
          width: `${progress * 100}%`,
          transition: 'width 0.2s ease',
        }} />
      </div>

      {/* Action timeline */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {visibleActions.map((action, i) => (
          <div
            key={i}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: i === currentStep ? 'rgba(226,184,88,0.1)' : 'transparent',
              border: i === currentStep ? '1px solid rgba(226,184,88,0.3)' : '1px solid transparent',
              color: i === currentStep ? '#e2b858' : '#a8d0a8',
              fontSize: 12,
              animation: i === currentStep ? 'toast-enter 0.2s ease-out' : undefined,
            }}
          >
            <span style={{ color: '#3a5a3a', fontSize: 10, marginRight: 8 }}>#{action.seq}</span>
            {formatAction(action)}
          </div>
        ))}
      </div>

      {/* Playback controls */}
      <div style={{
        background: '#0f2218', padding: '12px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexShrink: 0,
      }}>
        <button
          onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          style={{ background: 'transparent', border: 'none', color: currentStep === 0 ? '#2d5a3a' : '#6aad7a', cursor: 'pointer', padding: 4 }}
        >
          <SkipBack size={20} />
        </button>

        <button
          onClick={() => setPlaying(p => !p)}
          style={{
            background: playing ? '#e07a5f' : '#e2b858',
            border: 'none', borderRadius: '50%', width: 44, height: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#2c1810', cursor: 'pointer',
          }}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <button
          onClick={() => setCurrentStep(s => Math.min(actions.length - 1, s + 1))}
          disabled={currentStep >= actions.length - 1}
          style={{ background: 'transparent', border: 'none', color: currentStep >= actions.length - 1 ? '#2d5a3a' : '#6aad7a', cursor: 'pointer', padding: 4 }}
        >
          <SkipForward size={20} />
        </button>

        {/* Speed selector */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {([1, 2, 4] as const).map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                background: speed === s ? '#1e4a2e' : 'transparent',
                border: '1px solid #2d5a3a', borderRadius: 6,
                padding: '4px 8px', color: speed === s ? '#e2b858' : '#6aad7a',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Scrub bar */}
      <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
        <input
          type="range" min="0" max={Math.max(0, actions.length - 1)} value={currentStep}
          onChange={e => { setCurrentStep(Number(e.target.value)); setPlaying(false) }}
          style={{ width: '100%', accentColor: '#e2b858' }}
        />
      </div>
    </div>
  )
}
