import { useState, useRef } from 'react'

const EMOTES = [
  { id: 'nice', emoji: '\u{1F44F}', label: 'Nice!' },
  { id: 'haha', emoji: '\u{1F602}', label: 'Haha' },
  { id: 'wow', emoji: '\u{1F631}', label: 'Wow' },
  { id: 'cmon', emoji: '\u{1F624}', label: 'Come on!' },
  { id: 'fire', emoji: '\u{1F525}', label: 'On fire!' },
  { id: 'rip', emoji: '\u{1F480}', label: 'RIP' },
  { id: 'calc', emoji: '\u{1F3AF}', label: 'Calculated' },
  { id: 'gg', emoji: '\u{1F44B}', label: 'GG' },
] as const

export const EMOTE_MAP: Record<string, string> = {
  nice: '\u{1F44F}', haha: '\u{1F602}', wow: '\u{1F631}', cmon: '\u{1F624}',
  fire: '\u{1F525}', rip: '\u{1F480}', calc: '\u{1F3AF}', gg: '\u{1F44B}',
}

interface Props {
  onSend: (emoteId: string) => void
  disabled?: boolean
}

export default function EmoteBar({ onSend, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const cooldownRef = useRef(false)

  function handleSelect(id: string) {
    if (cooldownRef.current || disabled) return
    onSend(id)
    setOpen(false)
    cooldownRef.current = true
    setTimeout(() => { cooldownRef.current = false }, 3000)
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Emoji bar — slides up */}
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 8,
          background: '#0f2218',
          border: '1px solid #2d5a3a',
          borderRadius: 12,
          padding: '8px 6px',
          display: 'flex',
          gap: 2,
          animation: 'meld-staging-in 0.2s ease-out',
          zIndex: 30,
        }}>
          {EMOTES.map(e => (
            <button
              key={e.id}
              onClick={() => handleSelect(e.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 22,
                cursor: 'pointer',
                transition: 'transform 0.1s',
              }}
              title={e.label}
            >
              {e.emoji}
            </button>
          ))}
        </div>
      )}
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        style={{
          background: open ? '#1e4a2e' : 'transparent',
          border: '1px solid #2d5a3a',
          borderRadius: 20,
          padding: '6px 12px',
          color: '#6aad7a',
          fontSize: 16,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {'\u{1F60A}'}
      </button>
    </div>
  )
}
