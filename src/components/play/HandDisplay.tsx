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
}

const SUIT_ORDER: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }

export default function HandDisplay({ cards, selectedIds, onToggle, label, disabled }: Props) {
  const [sort, setSort] = useState<SortMode>('rank')
  const selectedCount = selectedIds.size

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

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        {label && (
          <p className="text-xs text-[#8b7355]">
            {label}{selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
          </p>
        )}
        <div className="bg-[#efe9dd] rounded-lg p-0.5 flex gap-0.5 ml-auto">
          {(['rank', 'suit'] as SortMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setSort(mode)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-all ${
                sort === mode ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-[#a08c6e] italic py-2">No cards</p>
      ) : (
        <div className="relative">
          <div
            className="flex overflow-x-auto gap-1.5 pb-2"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {sorted.map(card => (
              <CardComponent
                key={card.id}
                card={card}
                selected={selectedIds.has(card.id)}
                onClick={disabled ? undefined : () => onToggle(card.id)}
                disabled={disabled}
              />
            ))}
          </div>
          {/* Right fade gradient to hint at scroll */}
          <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-[#f8f6f1] to-transparent pointer-events-none" />
        </div>
      )}
    </div>
  )
}
