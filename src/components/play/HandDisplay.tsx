import { useState, useMemo } from 'react'
import type { Card as CardType } from '../../game/types'
import CardComponent from './Card'

type SortMode = 'rank' | 'suit'

interface Props {
  cards: CardType[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  label?: string
  disabled?: boolean
  sort?: SortMode
  onSortChange?: (sort: SortMode) => void
  newCardIds?: Set<string>
}

export const SUIT_ORDER: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }

// Compute horizontal offset per card based on hand size
function cardOffset(count: number): number {
  if (count <= 5) return 56
  if (count <= 7) return 48
  if (count <= 10) return 36
  if (count <= 12) return 28
  return 24
}

export default function HandDisplay({ cards, selectedIds, onToggle, label, disabled, sort: sortProp, onSortChange, newCardIds }: Props) {
  const [sortInternal, setSortInternal] = useState<SortMode>('rank')
  const sort = sortProp ?? sortInternal

  function setSort(mode: SortMode) {
    if (onSortChange) onSortChange(mode)
    else setSortInternal(mode)
  }

  const sorted = useMemo(() => {
    return [...cards].sort((a, b) => {
      if (sort === 'suit') {
        const s = (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4)
        if (s !== 0) return s
        return a.rank - b.rank
      }
      // rank sort: jokers last, then by rank
      if (a.suit === 'joker') return 1
      if (b.suit === 'joker') return -1
      return a.rank - b.rank
    })
  }, [cards, sort])

  const offset = cardOffset(sorted.length)
  const containerWidth = sorted.length > 0 ? (sorted.length - 1) * offset + 48 : 48
  // Card height = 72px, selected lift = 12px (translate-y-3), new badge = 8px above
  const containerHeight = 88

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {label && (
          <p className="text-xs text-[#a8d0a8]">
            {label}
          </p>
        )}
        <div className="bg-[#1e4a2e] rounded-lg p-0.5 flex gap-0.5 ml-auto">
          {(['rank', 'suit'] as SortMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setSort(mode)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-all ${
                sort === mode ? 'bg-[#e2b858] text-[#2c1810] shadow-sm' : 'text-[#8bc48b]'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-[#8bc48b] italic py-2">No cards</p>
      ) : (
        <div
          className="relative overflow-x-auto pb-2"
          style={{ height: `${containerHeight}px` }}
        >
          <div
            className="relative"
            style={{ width: `${containerWidth}px`, height: `${containerHeight}px` }}
          >
            {sorted.map((card, index) => {
              const isSelected = selectedIds.has(card.id)
              const isNewCard = newCardIds?.has(card.id) ?? false
              return (
                <div
                  key={card.id}
                  className="absolute bottom-0"
                  style={{
                    left: `${index * offset}px`,
                    zIndex: isSelected ? sorted.length + 10 : index + 1,
                    transition: 'left 150ms ease',
                  }}
                >
                  <CardComponent
                    card={card}
                    selected={isSelected}
                    isNew={isNewCard}
                    onClick={disabled ? undefined : () => onToggle(card.id)}
                    disabled={disabled}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
