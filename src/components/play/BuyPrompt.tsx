import { useState } from 'react'
import type { Card } from '../../game/types'

// Props per UI/UX Spec Section 5
interface Props {
  card: Card
  isFree: boolean       // true = next-player free take; false = paid buy
  playerName: string
  buysRemaining: number
  buyLimit: number
  onAccept: () => void
  onDecline: () => void
}

// ── Suit colour helpers (spec §1.2) ──────────────────────────────────────────

function suitBg(suit: string): string {
  if (suit === 'joker') return '#fff8e0'
  if (suit === 'hearts') return '#fff0f0'
  if (suit === 'diamonds') return '#f0f5ff'
  if (suit === 'clubs') return '#e0f7e8'
  return '#eeecff' // spades
}

function suitColor(suit: string): string {
  if (suit === 'joker') return '#8b6914'
  if (suit === 'hearts') return '#c0393b'
  if (suit === 'diamonds') return '#2158b8'
  if (suit === 'clubs') return '#1a6b3a'
  return '#3d2b8e' // spades
}

function rankLabel(rank: number): string {
  if (rank === 0) return 'JKR'
  if (rank === 1) return 'A'
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  return String(rank)
}

function suitSymbol(suit: string): string {
  if (suit === 'hearts') return '♥'
  if (suit === 'diamonds') return '♦'
  if (suit === 'clubs') return '♣'
  if (suit === 'spades') return '♠'
  return ''
}

// ── BuyPrompt banner ─────────────────────────────────────────────────────────

export default function BuyPrompt({
  card,
  isFree,
  playerName,
  buysRemaining,
  buyLimit,
  onAccept,
  onDecline,
}: Props) {
  // Timer bar is decorative only — static, no auto-advance
  const timerPct = 100
  // Brief toast shown after tapping a button before the callback fires
  const [toast, setToast] = useState<string | null>(null)

  function handleAccept() {
    if (toast) return
    setToast(isFree ? 'Taking it!' : `${playerName} buys!`)
    setTimeout(onAccept, 280)
  }

  function handleDecline() {
    if (toast) return
    setToast(`${playerName} passes`)
    setTimeout(onDecline, 220)
  }

  // Theme tokens per isFree
  const bg = isFree ? '#0f2e1a' : '#2e1a0e'
  const borderColor = isFree ? '#6aad7a' : '#e2b858'
  const timerColor = isFree ? '#6aad7a' : '#e2b858'
  const titleColor = isFree ? '#a8e8b8' : '#f0d480'
  const subtitleColor = isFree ? '#6aad7a' : '#c09840'
  const acceptBg = isFree ? '#6aad7a' : '#e2b858'
  const acceptColor = isFree ? '#0f2218' : '#2c1810'
  const glowRgb = isFree ? '106,173,122' : '226,184,88'

  const buyLimitStr = buyLimit >= 999 ? '∞' : String(buyLimit)
  const cardStr = card.suit === 'joker' ? 'Joker' : `${rankLabel(card.rank)}${suitSymbol(card.suit)}`
  const canBuy = isFree || buysRemaining > 0

  return (
    <>
      {/* Pulsing glow keyframe */}
      <style>{`
        @keyframes bpGlow {
          0%, 100% { box-shadow: 0 0 4px rgba(${glowRgb}, 0.3); }
          50%       { box-shadow: 0 0 14px rgba(${glowRgb}, 0.7); }
        }
      `}</style>

      {/* Banner container */}
      <div
        style={{
          background: bg,
          border: `1.5px solid ${borderColor}`,
          borderRadius: 10,
          marginBottom: 8,
          overflow: 'hidden',
          animation: 'slide-up-prompt 250ms ease-out both, bpGlow 2s ease-in-out infinite',
          flexShrink: 0,
        }}
      >
        {/* Content row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px 7px',
          }}
        >
          {/* Mini card visual (spec §5.2) */}
          <div
            style={{
              width: 30,
              height: 42,
              borderRadius: 5,
              flexShrink: 0,
              background: suitBg(card.suit),
              border: '1px solid rgba(0,0,0,0.12)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: card.suit === 'joker' ? 7 : 11,
              fontWeight: 700,
              color: suitColor(card.suit),
              lineHeight: 1.1,
              userSelect: 'none',
            }}
          >
            {card.suit === 'joker' ? (
              <>
                <span style={{ fontSize: 7 }}>JKR</span>
              </>
            ) : (
              <>
                <span>{rankLabel(card.rank)}</span>
                <span style={{ fontSize: 13 }}>{suitSymbol(card.suit)}</span>
              </>
            )}
          </div>

          {/* Text (spec §5.2) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 13, fontWeight: 700, color: titleColor,
              margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {isFree ? `Take ${cardStr} for free?` : `Buy ${cardStr}?`}
            </p>
            <p style={{
              fontSize: 10, color: subtitleColor,
              margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {isFree
                ? 'Your turn next — no buy used'
                : `You get ${cardStr} + 1 penalty · ${buysRemaining}/${buyLimitStr} buys left`}
            </p>
          </div>

          {/* Buttons / toast (spec §5.2–5.3) */}
          {toast ? (
            <p style={{
              fontSize: 12, fontWeight: 700, color: borderColor,
              flexShrink: 0, margin: 0, minWidth: 80, textAlign: 'right',
            }}>
              {toast}
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className="pass-btn"
                onClick={handleDecline}
                style={{
                  background: 'transparent',
                  border: '1px solid #2d5a3a',
                  borderRadius: 8,
                  color: '#6aad7a',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: 36,
                  minWidth: 52,
                  transition: 'transform 100ms ease',
                }}
              >
                Pass
              </button>
              <button
                className="buy-btn"
                onClick={handleAccept}
                disabled={!canBuy}
                style={{
                  background: acceptBg,
                  color: acceptColor,
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: canBuy ? 'pointer' : 'default',
                  minHeight: 36,
                  minWidth: 58,
                  opacity: canBuy ? 1 : 0.35,
                  transition: 'transform 100ms ease',
                }}
              >
                {isFree ? 'Take it' : 'Buy it'}
              </button>
            </div>
          )}
        </div>

        {/* Timer bar — visual only, no forced action (spec §5.1) */}
        <div style={{ height: 3, background: 'rgba(0,0,0,0.25)' }}>
          <div
            style={{
              height: '100%',
              width: `${timerPct}%`,
              background: timerColor,
              transition: 'width 0.05s linear',
            }}
          />
        </div>
      </div>
    </>
  )
}
