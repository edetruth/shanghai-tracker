import { useMemo } from 'react'
import type { Card as CardType } from '../../game/types'
import CardComponent from './Card'

type SortMode = 'rank' | 'suit'

interface Props {
  cards: CardType[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  sortMode: SortMode
  onSortChange: (mode: SortMode) => void
  label?: string
  disabled?: boolean
  newCardId?: string
  shimmerCardId?: string | null
  dealAnimation?: boolean
  leavingCardId?: string | null
  dealFlipPhase?: 'facedown' | 'flipping' | null
}

export const SUIT_ORDER: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }

// Horizontal overlap offset per card based on hand size
function cardOffset(count: number): number {
  if (count <= 5) return 48
  if (count <= 7) return 41
  if (count <= 10) return 31
  if (count <= 12) return 24
  return 20
}

export default function HandDisplay({
  cards,
  selectedIds,
  onToggle,
  sortMode,
  onSortChange,
  label,
  disabled,
  newCardId,
  shimmerCardId,
  dealAnimation,
  leavingCardId,
  dealFlipPhase,
}: Props) {
  const sorted = useMemo(() => {
    return [...cards].sort((a, b) => {
      if (sortMode === 'suit') {
        const s = (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4)
        if (s !== 0) return s
        if (a.rank !== b.rank) return a.rank - b.rank
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 // stable tiebreaker
      }
      if (a.suit === 'joker' && b.suit === 'joker') return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      if (a.suit === 'joker') return 1
      if (b.suit === 'joker') return -1
      if (a.rank !== b.rank) return a.rank - b.rank
      const suitDiff = (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4)
      if (suitDiff !== 0) return suitDiff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 // stable tiebreaker
    })
  }, [cards, sortMode])

  const offset = cardOffset(sorted.length)
  const containerWidth = sorted.length > 0 ? (sorted.length - 1) * offset + 41 : 41
  // 61px card height + 10px selected lift + 4px new badge headroom
  const containerHeight = 75

  return (
    <div>
      {/* Sort toggle + label row */}
      <div className="flex items-center justify-between mb-2">
        {label && (
          <p className="text-xs text-[#a8d0a8]">{label}</p>
        )}

        {/* Toggle pill — spec §2.5 */}
        <div
          className="flex ml-auto"
          style={{
            background: '#0f2218',
            border: '1px solid #2d5a3a',
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        >
          {(['rank', 'suit'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onSortChange(mode)}
              style={{
                background: sortMode === mode ? '#1e4a2e' : 'transparent',
                color: sortMode === mode ? '#e2b858' : '#6aad7a',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                transition: 'background 120ms, color 120ms',
                minHeight: '28px',
              }}
            >
              {mode === 'rank' ? 'Rank' : 'Suit'}
            </button>
          ))}
        </div>
      </div>

      {/* Hand area */}
      {cards.length === 0 ? (
        <p className="text-sm text-[#8bc48b] italic py-2">No cards</p>
      ) : (
        <div
          className="relative overflow-x-auto pb-2"
          style={{ height: `${containerHeight}px`, display: 'flex', justifyContent: sorted.length <= 3 ? 'center' : 'flex-start' }}
        >
          <div
            className="relative"
            style={{ width: `${containerWidth}px`, height: `${containerHeight}px`, flexShrink: 0, transition: 'width 300ms ease-out' }}
          >
            {sorted.map((card, index) => {
              const isSelected = selectedIds.has(card.id)
              const isLeaving = card.id === leavingCardId
              const showFaceDown = dealFlipPhase === 'facedown'
              const isFlipping = dealFlipPhase === 'flipping'
              return (
                <div
                  key={card.id}
                  className={`absolute bottom-0${isLeaving ? ' animate-card-exit' : ''}`}
                  style={{
                    left: `${index * offset}px`,
                    zIndex: isSelected ? sorted.length + 10 : card.id === newCardId ? sorted.length + 5 : index + 1,
                    transition: isLeaving ? 'none' : 'left 300ms ease-out, transform 300ms ease-out',
                    ...(dealAnimation && !isFlipping ? { animation: `card-deal-in 200ms ease-out ${index * 50}ms both` } : {}),
                  }}
                >
                  {isFlipping ? (
                    /* 3D flip: wrapper rotates, back hides, face reveals */
                    <div
                      style={{
                        perspective: '400px',
                        width: 41,
                        height: 61,
                      }}
                    >
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: '100%',
                          transformStyle: 'preserve-3d',
                          animation: `card-flip-in 500ms ease-out ${index * 60}ms both`,
                        }}
                      >
                        {/* Back face (visible at start, rotateY=0) */}
                        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>
                          <CardComponent card={card} faceDown />
                        </div>
                        {/* Front face (hidden at start, pre-rotated 180deg) */}
                        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                          <CardComponent
                            card={card}
                            selected={false}
                            onClick={disabled ? undefined : () => onToggle(card.id)}
                            disabled={disabled}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <CardComponent
                      card={card}
                      selected={isLeaving ? false : isSelected}
                      isNew={card.id === newCardId}
                      shimmer={shimmerCardId ? card.id === shimmerCardId : false}
                      onClick={disabled || isLeaving ? undefined : () => onToggle(card.id)}
                      disabled={disabled || isLeaving}
                      faceDown={showFaceDown}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
