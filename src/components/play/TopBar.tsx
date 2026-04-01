import { Pause, Wifi } from 'lucide-react'
import EmoteBar from './EmoteBar'

interface TopBarProps {
  currentRound: number
  totalRounds: number
  requirementDescription: string
  onPause: () => void
  // Online multiplayer
  mode: 'local' | 'host'
  remoteSeatCount: number
  onEmoteSend?: (id: string) => void
  isConnected?: boolean
  connectedPlayerCount?: number
}

export default function TopBar({
  currentRound,
  totalRounds,
  requirementDescription,
  onPause,
  mode,
  remoteSeatCount,
  onEmoteSend,
  isConnected,
  connectedPlayerCount,
}: TopBarProps) {
  const showMultiplayer = mode === 'host' && remoteSeatCount > 0

  return (
    <>
      {/* Top bar: round badge | requirement badge | pause */}
      <div
        className="flex items-center justify-between px-3 pb-2"
        style={{ borderBottom: '1px solid #2d5a3a', minHeight: 30 }}
      >
        {/* Round badge */}
        <div style={{
          background: '#0f2218', color: '#a8d0a8',
          border: '1px solid #2d5a3a', borderRadius: 20,
          padding: '4px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          Round {currentRound}/{totalRounds}
        </div>

        {/* Requirement badge */}
        <div style={{
          background: '#0f2218', color: '#e2b858',
          border: '1px solid #8b6914', borderRadius: 20,
          padding: '4px 10px', fontSize: 11, fontWeight: 600,
          textAlign: 'center', flex: '0 1 auto', margin: '0 8px',
        }}>
          {requirementDescription}
        </div>

        {/* Pause button + Emote bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {showMultiplayer && onEmoteSend && (
            <EmoteBar onSend={onEmoteSend} disabled={!isConnected} />
          )}
          <button
            onClick={onPause}
            aria-label="Pause game"
            style={{
              background: '#0f2218', border: '1px solid #2d5a3a', borderRadius: 8,
              color: '#a8d0a8', minWidth: 40, minHeight: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Pause size={18} />
          </button>
        </div>
      </div>

      {/* Host multiplayer connection indicator */}
      {showMultiplayer && (
        <div className="flex items-center justify-center gap-1 px-3 py-1" style={{ borderBottom: '1px solid #2d5a3a' }}>
          <Wifi size={12} style={{ color: isConnected ? '#6aad7a' : '#e07a5f' }} />
          <span style={{ fontSize: 10, color: '#6aad7a' }}>
            {connectedPlayerCount}/{remoteSeatCount + 1} players connected
          </span>
        </div>
      )}
    </>
  )
}
