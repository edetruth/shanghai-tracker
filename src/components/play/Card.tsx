import type { Card as CardType } from '../../game/types'
import { haptic } from '../../lib/haptics'

interface Props {
  card: CardType
  selected?: boolean
  onClick?: () => void
  compact?: boolean
  disabled?: boolean
  jokerLabel?: string
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

function isRedSuit(suit: string): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}

export default function Card({ card, selected, onClick, compact, disabled, jokerLabel }: Props) {
  const isJoker = card.suit === 'joker'
  const rankText = rankDisplay(card.rank)
  const symbol = suitSymbol(card.suit)
  const red = isRedSuit(card.suit)

  const sizeClass = compact ? 'w-10 h-16' : 'w-12 h-[4.5rem]'

  const baseClass = `
    relative flex flex-col items-start justify-between
    rounded-lg border select-none flex-shrink-0
    ${sizeClass}
    ${isJoker
      ? 'bg-[#fffbee] border-[#e2b858]'
      : card.suit === 'hearts'
        ? 'bg-[#fff5f5] border-[#e2ddd2]'
        : card.suit === 'diamonds'
          ? 'bg-[#f5f8ff] border-[#e2ddd2]'
          : card.suit === 'clubs'
            ? 'bg-[#f5fff7] border-[#e2ddd2]'
            : 'bg-[#f8f8f8] border-[#e2ddd2]'
    }
    ${selected
      ? 'border-[#e2b858] border-2 -translate-y-3 shadow-md'
      : ''
    }
    ${onClick && !disabled ? 'cursor-pointer active:opacity-70' : ''}
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
    transition-transform duration-100
    p-0.5
  `

  const textColor = isJoker
    ? 'text-[#8b6914]'
    : red
      ? 'text-red-500'
      : 'text-[#2c1810]'

  return (
    <div
      className={baseClass}
      onClick={onClick && !disabled ? () => { haptic('tap'); onClick() } : undefined}
    >
      {isJoker ? (
        <div className="flex flex-col items-center justify-center w-full h-full gap-0.5">
          <span className="text-xs font-bold text-[#8b6914]">JKR</span>
          <span className="text-lg leading-none">🃏</span>
          {jokerLabel && (
            <span className="text-[9px] bg-gray-100 text-gray-500 rounded px-0.5 leading-tight">
              {jokerLabel}
            </span>
          )}
        </div>
      ) : (
        <>
          {/* Top-left: rank + suit */}
          <div className={`flex flex-col items-start leading-none ${textColor}`}>
            <span className="text-xs font-bold">{rankText}</span>
            <span className="text-xs">{symbol}</span>
          </div>

          {/* Center suit (small) */}
          <div className={`absolute inset-0 flex items-center justify-center ${textColor} text-sm opacity-20 pointer-events-none`}>
            {symbol}
          </div>

          {/* Bottom-right: rank rotated 180° */}
          <div className={`flex flex-col items-end leading-none rotate-180 self-end ${textColor}`}>
            <span className="text-xs font-bold">{rankText}</span>
            <span className="text-xs">{symbol}</span>
          </div>
        </>
      )}
    </div>
  )
}
