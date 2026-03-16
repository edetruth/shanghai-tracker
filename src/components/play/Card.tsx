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


export default function Card({ card, selected, onClick, compact, disabled, jokerLabel, isNew, style }: Props) {
  const isJoker = card.suit === 'joker'
  const rankText = rankDisplay(card.rank)
  const symbol = suitSymbol(card.suit)

  const sizeClass = compact ? 'w-10 h-16' : 'w-12 h-[4.5rem]'

  // Suit backgrounds: hearts=pink, diamonds=yellow, clubs=green, spades=lavender
  const suitBg = isJoker
    ? 'bg-[#fffbee] border-[#e2b858]'
    : card.suit === 'hearts'
      ? 'bg-[#fff0f0] border-[#e2ddd2]'
      : card.suit === 'diamonds'
        ? 'bg-[#fffbeb] border-[#e2ddd2]'
        : card.suit === 'clubs'
          ? 'bg-[#e0f7e8] border-[#e2ddd2]'
          : 'bg-[#eeecff] border-[#e2ddd2]' // spades: lavender

  const baseClass = `
    relative flex flex-col items-start justify-between
    rounded-lg border select-none flex-shrink-0
    ${sizeClass}
    ${suitBg}
    ${selected ? 'border-[#e2b858] border-2 -translate-y-3 shadow-md' : ''}
    ${isNew && !selected ? 'ring-2 ring-[#e2b858] shadow-[0_0_10px_rgba(226,184,88,0.6)]' : ''}
    ${onClick && !disabled ? 'cursor-pointer active:opacity-70' : ''}
    ${disabled ? 'cursor-default' : ''}
    transition-transform duration-100
    p-0.5
  `

  // Text color: clubs/spades dark green/purple for differentiation
  const textColor = isJoker
    ? 'text-[#8b6914]'
    : card.suit === 'hearts'
      ? 'text-[#c0393b]'
      : card.suit === 'diamonds'
        ? 'text-[#b45309]'
        : card.suit === 'clubs'
          ? 'text-[#1a6b3a]'
          : 'text-[#3d2b8e]' // spades: dark purple

  return (
    <div
      className={baseClass}
      style={style}
      onClick={onClick && !disabled ? () => { haptic('tap'); onClick() } : undefined}
    >
      {isNew && (
        <div className="absolute -top-1.5 -right-1 z-10 bg-[#e2b858] text-[#2c1810] text-[8px] font-bold px-1 rounded leading-4">
          NEW
        </div>
      )}
      {isJoker ? (
        <div className="flex flex-col items-center justify-center w-full h-full gap-0.5">
          <span className="text-xs font-bold text-[#8b6914]">JKR</span>
          <span className="text-base leading-none">🃏</span>
          {jokerLabel && (
            <span className="text-[9px] bg-[#fffbee] text-[#8b6914] border border-[#e2b858] rounded px-0.5 leading-tight font-semibold">
              {jokerLabel}
            </span>
          )}
        </div>
      ) : (
        <>
          {/* Top-left: rank + suit */}
          <div className={`flex flex-col items-start leading-none ${textColor}`}>
            <span className="text-xs font-bold">{rankText}</span>
            <span className="text-sm leading-none">{symbol}</span>
          </div>

          {/* Center suit (faint) */}
          <div className={`absolute inset-0 flex items-center justify-center ${textColor} text-base opacity-15 pointer-events-none`}>
            {symbol}
          </div>

          {/* Bottom-right: rank rotated 180° */}
          <div className={`flex flex-col items-end leading-none rotate-180 self-end ${textColor}`}>
            <span className="text-xs font-bold">{rankText}</span>
            <span className="text-sm leading-none">{symbol}</span>
          </div>
        </>
      )}
    </div>
  )
}
