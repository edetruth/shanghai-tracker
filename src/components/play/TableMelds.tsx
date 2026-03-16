import type { Meld } from '../../game/types'
import CardComponent from './Card'

interface Props {
  melds: Meld[]
  onMeldClick?: (meld: Meld) => void
  highlightMeldId?: string
  jokerMeldIds?: Set<string>
}

function getJokerLabel(meld: Meld, cardId: string): string | undefined {
  const mapping = meld.jokerMappings.find(m => m.cardId === cardId)
  if (!mapping) return undefined
  const suitSymbols: Record<string, string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠',
    joker: '',
  }
  const rankStr =
    mapping.representsRank === 1 ? 'A'
    : mapping.representsRank === 11 ? 'J'
    : mapping.representsRank === 12 ? 'Q'
    : mapping.representsRank === 13 ? 'K'
    : mapping.representsRank === 14 ? 'A'
    : String(mapping.representsRank)
  return `${rankStr}${suitSymbols[mapping.representsSuit] ?? ''}`
}

export default function TableMelds({ melds, onMeldClick, highlightMeldId, jokerMeldIds }: Props) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">Table</p>
      {melds.length === 0 ? (
        <p className="text-sm text-[#a08c6e] italic">No melds yet</p>
      ) : (
        <div className="space-y-2">
          {melds.map((meld, idx) => (
            <div
              key={meld.id}
              className={`rounded-lg p-2 border transition-colors ${
                highlightMeldId === meld.id
                  ? 'border-[#e2b858] bg-[#fffbee]'
                  : jokerMeldIds?.has(meld.id)
                    ? 'border-[#e2b858]/60 bg-[#fffbee]/50 shadow-[0_0_6px_rgba(226,184,88,0.4)]'
                    : 'border-[#e2ddd2] bg-[#f8f6f1]'
              } ${onMeldClick ? 'cursor-pointer active:opacity-70' : ''}`}
              onClick={onMeldClick ? () => onMeldClick(meld) : undefined}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-bold bg-[#e2b858] text-[#2c1810] rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
                  {idx + 1}
                </span>
                <span className="text-xs text-[#8b7355] font-medium">{meld.ownerName}</span>
                <span className="text-[10px] text-[#a08c6e] bg-[#efe9dd] px-1.5 py-0.5 rounded-full">
                  {meld.type}
                </span>
                {jokerMeldIds?.has(meld.id) && (
                  <span className="text-[10px] text-[#8b6914] bg-[#fffbee] px-1.5 py-0.5 rounded-full border border-[#e2b858]/40">
                    swap
                  </span>
                )}
              </div>
              <div className="flex gap-1 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                {meld.cards.map(card => {
                  const layOffName = meld.cardOwners?.[card.id]
                  return (
                    <div key={card.id} className="flex flex-col items-center gap-0.5">
                      <CardComponent
                        card={card}
                        compact
                        jokerLabel={card.suit === 'joker' ? getJokerLabel(meld, card.id) : undefined}
                      />
                      {layOffName && (
                        <span className="text-[8px] font-semibold bg-[#2d5a3c] text-[#a8d0a8] px-1 rounded leading-tight max-w-[40px] truncate">
                          {layOffName.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
