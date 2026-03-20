import { useState, useEffect } from 'react'
import type { Card as CardType } from '../../game/types'
import { haptic } from '../../lib/haptics'

interface Props {
  card: CardType
  selected?: boolean
  onClick?: () => void
  compact?: boolean
  disabled?: boolean
  jokerLabel?: string
  isNew?: boolean
  faceDown?: boolean
  style?: React.CSSProperties
}

function rankDisplay(rank: number): string {
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

// Suit background colors per spec sections 1.2 & 2.4
function suitBackground(suit: string): string {
  if (suit === 'joker') return '#fff8e0'
  if (suit === 'hearts') return '#fff0f0'
  if (suit === 'diamonds') return '#f0f5ff'
  if (suit === 'clubs') return '#e0f7e8'
  return '#eeecff' // spades
}

// Suit text colors per spec sections 1.2 & 2.4
function suitTextColor(suit: string): string {
  if (suit === 'joker') return '#8b6914'
  if (suit === 'hearts') return '#c0393b'
  if (suit === 'diamonds') return '#2158b8'
  if (suit === 'clubs') return '#1a6b3a'
  return '#3d2b8e' // spades
}

export default function Card({ card, selected, onClick, compact, disabled, jokerLabel, isNew, faceDown, style }: Props) {
  // Auto-clear NEW badge after 3 seconds
  const [showNew, setShowNew] = useState(isNew ?? false)
  useEffect(() => {
    if (isNew) {
      setShowNew(true)
      const t = setTimeout(() => setShowNew(false), 3000)
      return () => clearTimeout(t)
    } else {
      setShowNew(false)
    }
  }, [isNew])

  const isJoker = card.suit === 'joker'
  const rankText = rankDisplay(card.rank)
  const symbol = suitSymbol(card.suit)
  const isInteractive = !!(onClick && !disabled)

  // Card size — enforce 38px minimum touch target for interactive cards
  const width = compact ? 34 : 41
  const height = compact ? 54 : 61
  const minW = isInteractive ? 38 : undefined
  const minH = isInteractive ? 38 : undefined

  if (faceDown) {
    return (
      <div
        style={{
          backgroundColor: '#7a1a2e',
          borderRadius: '6px',
          border: '1.5px solid #c05070',
          width: `${width}px`,
          height: `${height}px`,
          minWidth: minW ? `${minW}px` : undefined,
          minHeight: minH ? `${minH}px` : undefined,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: isInteractive ? 'pointer' : 'default',
          ...style,
        }}
        onClick={isInteractive ? () => { haptic('tap'); onClick!() } : undefined}
      >
        {/* Inner border pattern */}
        <div
          style={{
            position: 'absolute',
            inset: '4px',
            border: '1px solid #c05070',
            borderRadius: '3px',
            opacity: 0.7,
          }}
        />
      </div>
    )
  }

  const bg = suitBackground(card.suit)
  const color = suitTextColor(card.suit)

  const cardStyle: React.CSSProperties = {
    backgroundColor: bg,
    borderRadius: '6px',
    border: selected ? '2px solid #e2b858' : '1.5px solid rgba(255,255,255,0.2)',
    transform: selected ? 'translateY(-10px)' : undefined,
    boxShadow: selected ? '0 4px 12px rgba(0,0,0,0.3)' : undefined,
    opacity: disabled ? 0.25 : 1,
    pointerEvents: disabled ? 'none' : undefined,
    width: `${width}px`,
    height: `${height}px`,
    minWidth: minW ? `${minW}px` : undefined,
    minHeight: minH ? `${minH}px` : undefined,
    ...style,
  }

  return (
    <div
      className={`relative flex flex-col items-start justify-between select-none flex-shrink-0 transition-all duration-100 p-0.5${isInteractive ? ' cursor-pointer active:opacity-70' : ' cursor-default'}`}
      style={cardStyle}
      onClick={isInteractive ? () => { haptic('tap'); onClick!() } : undefined}
    >
      {/* NEW badge */}
      {showNew && (
        <div className="absolute -top-1.5 -right-1 z-10 bg-[#e2b858] text-[#2c1810] text-[8px] font-bold px-1 rounded leading-4">
          NEW
        </div>
      )}

      {/* Gold ring overlay for new cards */}
      {showNew && !selected && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: '6px',
            boxShadow: '0 0 0 2px #e2b858, 0 0 10px rgba(226,184,88,0.6)',
          }}
        />
      )}

      {isJoker ? (
        <div className="flex flex-col items-center justify-center w-full h-full gap-0.5">
          <span className="text-xs font-bold" style={{ color }}>JKR</span>
          <span className="text-base leading-none">🃏</span>
          {jokerLabel && (
            <span
              className="text-[9px] rounded px-0.5 leading-tight font-semibold border"
              style={{ backgroundColor: '#fff8e0', color, borderColor: '#e2b858' }}
            >
              {jokerLabel}
            </span>
          )}
        </div>
      ) : (
        <>
          {/* Top-left: rank + suit */}
          <div className="flex flex-col items-start leading-none" style={{ color }}>
            <span className="text-xs font-bold">{rankText}</span>
            <span className="text-sm leading-none">{symbol}</span>
          </div>

          {/* Center suit (faint) */}
          <div
            className="absolute inset-0 flex items-center justify-center text-base opacity-15 pointer-events-none"
            style={{ color }}
          >
            {symbol}
          </div>

          {/* Bottom-right: rank + suit rotated 180° */}
          <div className="flex flex-col items-end leading-none rotate-180 self-end" style={{ color }}>
            <span className="text-xs font-bold">{rankText}</span>
            <span className="text-sm leading-none">{symbol}</span>
          </div>
        </>
      )}
    </div>
  )
}
