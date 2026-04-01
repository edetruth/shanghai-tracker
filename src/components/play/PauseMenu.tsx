import type { GameSpeed } from '../../stores/gameStore'

interface PauseMenuProps {
  onClose: () => void
  onExit: () => void
  gameSpeed: GameSpeed
  onSpeedChange: (speed: GameSpeed) => void
  reduceAnimations: boolean
  onToggleAnimations: () => void
  sfxVol: number
  notifVol: number
  onSfxVolChange: (v: number) => void
  onNotifVolChange: (v: number) => void
  roundInfo: string
  tournamentInfo?: string
  onCleanup?: () => void
}

export default function PauseMenu({
  onClose,
  onExit,
  gameSpeed,
  onSpeedChange,
  reduceAnimations,
  onToggleAnimations,
  sfxVol,
  notifVol,
  onSfxVolChange,
  onNotifVolChange,
  roundInfo,
  tournamentInfo,
  onCleanup,
}: PauseMenuProps) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="w-full bg-[#0f2218] border-t border-[#2d5a3c] rounded-t-2xl px-4 pt-5 pb-10">
        <h2 className="text-lg font-bold text-white text-center mb-1">Game Paused</h2>
        <p className="text-sm text-[#6aad7a] text-center mb-4">
          {tournamentInfo ? `${tournamentInfo} · ` : ''}{roundInfo}
        </p>
        <p className="text-xs text-[#6aad7a] text-center mb-2">AI Speed</p>
        <div className="bg-[#1e4a2e] rounded-xl p-1 flex gap-1 mb-4">
          {(['fast', 'normal', 'slow'] as GameSpeed[]).map(s => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                gameSpeed === s ? 'bg-[#e2b858] text-[#2c1810] shadow-sm' : 'text-[#8bc48b]'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {/* Reduce animations toggle */}
        <button
          onClick={onToggleAnimations}
          className="w-full flex items-center justify-between bg-[#1e4a2e] rounded-xl px-4 py-3 mb-4"
        >
          <span className="text-sm text-[#a8d0a8]">Reduce animations</span>
          <div
            className="w-10 h-6 rounded-full transition-colors flex items-center px-0.5"
            style={{ backgroundColor: reduceAnimations ? '#e2b858' : '#2d5a3a' }}
          >
            <div
              className="w-5 h-5 rounded-full bg-white transition-transform"
              style={{ transform: reduceAnimations ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </div>
        </button>
        {/* Volume controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#a8d0a8', fontSize: 12, minWidth: 90 }}>Game Sounds</span>
            <input
              type="range" min="0" max="1" step="0.1"
              value={sfxVol}
              onChange={e => onSfxVolChange(Number(e.target.value))}
              aria-label="Game sounds volume"
              style={{ flex: 1, accentColor: '#e2b858' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#a8d0a8', fontSize: 12, minWidth: 90 }}>Notifications</span>
            <input
              type="range" min="0" max="1" step="0.1"
              value={notifVol}
              onChange={e => onNotifVolChange(Number(e.target.value))}
              aria-label="Notification volume"
              style={{ flex: 1, accentColor: '#e2b858' }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <button
            onClick={onClose}
            className="bg-[#e2b858] text-[#2c1810] font-bold rounded-xl w-full py-3 text-sm active:opacity-80"
          >
            Resume Game
          </button>
          {tournamentInfo ? (
            <button
              onClick={() => {
                onClose()
                onCleanup?.()
                onExit()
              }}
              className="w-full rounded-xl py-3 text-sm font-semibold text-[#f87171] bg-[#1e4a2e] active:opacity-80"
            >
              Exit Tournament
            </button>
          ) : (
            <button
              onClick={() => {
                onClose()
                onCleanup?.()
                onExit()
              }}
              className="w-full rounded-xl py-3 text-sm font-semibold text-[#f87171] bg-[#1e4a2e] active:opacity-80"
            >
              Abandon Game
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
