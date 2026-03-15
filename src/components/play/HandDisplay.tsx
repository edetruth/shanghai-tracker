import type { Card as CardType } from '../../game/types'
import CardComponent from './Card'

interface Props {
  cards: CardType[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  label?: string
  disabled?: boolean
}

export default function HandDisplay({ cards, selectedIds, onToggle, label, disabled }: Props) {
  return (
    <div>
      {label && (
        <p className="text-xs text-[#8b7355] mb-1.5">{label}</p>
      )}
      {cards.length === 0 ? (
        <p className="text-sm text-[#a08c6e] italic py-2">No cards</p>
      ) : (
        <div className="flex overflow-x-auto gap-1.5 pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
          {cards.map(card => (
            <CardComponent
              key={card.id}
              card={card}
              selected={selectedIds.has(card.id)}
              onClick={disabled ? undefined : () => onToggle(card.id)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}
