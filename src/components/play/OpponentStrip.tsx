import type { Player } from '../../game/types'
import type { UIPhase } from '../../stores/gameStore'
import EmoteBubble from './EmoteBubble'

interface OpponentStripProps {
  players: Player[]
  currentPlayerId: string
  displayPlayerId: string
  uiPhase: UIPhase
  activeBuyerId?: string
  expanded: boolean
  onToggle: () => void
  // Emotes
  activeEmotes: Map<number, string>
}

export default function OpponentStrip({
  players,
  currentPlayerId,
  displayPlayerId,
  uiPhase,
  activeBuyerId,
  expanded,
  onToggle,
  activeEmotes,
}: OpponentStripProps) {
  return (
    <div
      onClick={onToggle}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {!expanded ? (
        /* ── Collapsed: compact single-line view ── */
        <div
          className="flex items-center gap-1 px-3 py-1.5"
          style={{ overflowX: 'auto', scrollbarWidth: 'none', flexWrap: 'nowrap' }}
        >
          {(() => {
            const isCompact = players.length >= 5
            return players.map((p, i) => {
            const total = p.roundScores.reduce((s, n) => s + n, 0)
            const isMe = p.id === displayPlayerId
            const isActiveTurn = p.id === currentPlayerId
            const isBuyingNow = uiPhase === 'buying' && activeBuyerId === p.id
            const displayName = isMe && !p.isAI
              ? 'You'
              : isCompact && !isActiveTurn
                ? p.name.split(' ')[0].slice(0, 3)
                : p.name.split(' ')[0]
            return (
              <span key={p.id} style={{
                display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                borderLeft: isActiveTurn ? '3px solid #e2b858' : '3px solid transparent',
                paddingLeft: isActiveTurn ? 4 : 0,
                transition: 'border-color 200ms ease, padding-left 200ms ease',
              }}>
                {i > 0 && <span style={{ color: '#2d5a3a', margin: '0 5px', fontSize: 10 }}>·</span>}
                {/* Meld dot */}
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', display: 'inline-block', marginRight: 3, flexShrink: 0,
                  background: p.hasLaidDown ? '#6aad7a' : '#2d5a3a',
                }} />
                <span style={{
                  color: isMe ? '#e2b858' : isActiveTurn ? '#ffffff' : '#a8d0a8',
                  fontSize: isCompact ? 10 : 11, fontWeight: isMe || isActiveTurn ? 700 : 500,
                  maxWidth: isCompact ? 36 : 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {displayName}{p.isAI ? '🤖' : ''}
                </span>
                {(!isCompact || isActiveTurn) && (
                  <span style={{ color: '#6aad7a', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, marginLeft: 3 }}>
                    {total}
                  </span>
                )}
                <span key={p.hand.length} style={{ color: '#a8d0a8', fontSize: 10, marginLeft: 2, animation: 'number-roll 300ms ease-out' }}>
                  🃏{p.hand.length}
                </span>
                {isBuyingNow && !isMe && (
                  <span style={{ color: '#e2b858', fontSize: 9, marginLeft: 2, fontWeight: 700 }}>BUY</span>
                )}
              </span>
            )
          })
          })()}
          {/* Expand chevron */}
          <span style={{ color: '#6aad7a', fontSize: 10, marginLeft: 'auto', paddingLeft: 6, flexShrink: 0 }}>▼</span>
        </div>
      ) : (
        /* ── Expanded: full detail cards ── */
        <>
          <div
            className="flex gap-2 px-3 py-2"
            style={{ overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', scrollbarWidth: 'none' }}
          >
            {players.map(p => {
              const total = p.roundScores.reduce((s, n) => s + n, 0)
              const isBuyingNow = uiPhase === 'buying' && activeBuyerId === p.id
              const isMe = p.id === displayPlayerId
              const isActiveTurn = p.id === currentPlayerId
              const borderColor = isMe
                ? '#e2b858'
                : isBuyingNow
                  ? '#e2b858'
                  : isActiveTurn
                    ? '#4a7a5a'
                    : '#2d5a3a'
              const playerSeatIdx = players.indexOf(p)
              return (
                <div
                  key={p.id}
                  className={isBuyingNow && !isMe ? 'animate-pulse' : ''}
                  style={{
                    flexShrink: 0,
                    background: isActiveTurn ? '#1e4a2e' : (isMe ? '#1e3010' : '#0f2218'),
                    border: `1px solid ${borderColor}`,
                    borderLeft: isActiveTurn ? '3px solid #e2b858' : `1px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: '6px 8px',
                    minWidth: 68,
                    transition: 'all 200ms ease',
                    position: 'relative' as const,
                  }}
                >
                  {activeEmotes.has(playerSeatIdx) && (
                    <EmoteBubble emoji={activeEmotes.get(playerSeatIdx)!} onDone={() => {}} />
                  )}
                  <div className="flex items-center gap-1 mb-0.5">
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: p.hasLaidDown ? '#6aad7a' : '#2d5a3a',
                    }} />
                    <p style={{
                      color: isMe ? '#e2b858' : '#a8d0a8', fontSize: 11, fontWeight: 500,
                      maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {isMe && !p.isAI ? 'You' : `${p.name.split(' ')[0]}${p.isAI ? ' 🤖' : ''}`}
                    </p>
                    {p.hasLaidDown && (
                      <span style={{ color: '#6aad7a', fontSize: 8, fontWeight: 700, marginLeft: 2 }}>DOWN</span>
                    )}
                  </div>
                  {isActiveTurn && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#e2b858', flexShrink: 0 }} />
                      <p style={{ color: '#e2b858', fontSize: 9, fontWeight: 700, margin: 0 }}>
                        {p.isAI ? `${p.name.split(' ')[0]}'s turn` : 'your turn'}
                      </p>
                    </div>
                  )}
                  <p style={{ color: '#6aad7a', fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}>
                    {total} pts
                  </p>
                  <p key={p.hand.length} style={{ color: '#a8d0a8', fontSize: 10, animation: 'number-roll 300ms ease-out' }}>🃏 {p.hand.length}</p>
                  {(uiPhase === 'buying' || p.buysRemaining === 0) && (
                    <p style={{ color: p.buysRemaining === 0 ? '#f87171' : '#6aad7a', fontSize: 10, fontWeight: 600 }}>
                      {p.buysRemaining}🛒
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          {/* Collapse chevron */}
          <div style={{ textAlign: 'center', paddingBottom: 2 }}>
            <span style={{ color: '#6aad7a', fontSize: 10 }}>▲ tap to collapse</span>
          </div>
        </>
      )}
    </div>
  )
}
