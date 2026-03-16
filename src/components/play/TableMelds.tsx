import type { Card, Meld } from '../../game/types'
import CardComponent from './Card'

interface Props {
  melds: Meld[]
  onMeldClick?: (meld: Meld) => void
  highlightMeldId?: string
  jokerMeldIds?: Set<string>
  validLayOffMeldIds?: Set<string>  // melds that are valid lay-off targets for the selected card
  layOffCard?: Card | null          // the card being laid off (used to show joker extension hint)
}

function getJokerLabel(meld: Meld, cardId: string): string | undefined {
  // Only show identity label for run jokers — set jokers have ambiguous suit, can't be swapped
  if (meld.type !== 'run') return undefined
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

function getJokerExtensionLabel(meld: Meld, jokerCard: Card): string | undefined {
  if (meld.type !== 'run' || jokerCard.suit !== 'joker') return undefined
  const rankLabels: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
  const newRank = (meld.runMax ?? 0) + 1
  const label = rankLabels[newRank] ?? String(newRank)
  const suitSymbols: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
  const suit = suitSymbols[meld.runSuit ?? ''] ?? ''
  if (newRank > 14) return undefined
  return `→ ${label}${suit}`
}

export default function TableMelds({ melds, onMeldClick, highlightMeldId, jokerMeldIds, validLayOffMeldIds, layOffCard }: Props) {
  const hasTargetSet = validLayOffMeldIds !== undefined && validLayOffMeldIds.size >= 0
  return (
    <div>
      <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">Table</p>
      {melds.length === 0 ? (
        <p className="text-sm text-[#a08c6e] italic">No melds yet</p>
      ) : (
        <div className="space-y-2">
          {melds.map((meld, idx) => {
            const isValidTarget = validLayOffMeldIds?.has(meld.id)
            const isDimmed = hasTargetSet && validLayOffMeldIds!.size > 0 && !isValidTarget
            return (
            <div
              key={meld.id}
              className={`rounded-lg p-2 border transition-colors ${
                highlightMeldId === meld.id
                  ? 'border-[#e2b858] bg-[#fffbee]'
                  : isValidTarget
                    ? 'border-[#2d7a3a] bg-[#f0fdf4] shadow-[0_0_6px_rgba(45,122,58,0.25)]'
                    : jokerMeldIds?.has(meld.id)
                      ? 'border-[#e2b858]/60 bg-[#fffbee]/50 shadow-[0_0_6px_rgba(226,184,88,0.4)]'
                      : 'border-[#e2ddd2] bg-[#f8f6f1]'
              } ${isDimmed ? 'opacity-40' : ''} ${onMeldClick ? 'cursor-pointer active:opacity-70' : ''}`}
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
                {isValidTarget && (() => {
                  const jokerExt = layOffCard?.suit === 'joker' ? getJokerExtensionLabel(meld, layOffCard) : undefined
                  return (
                    <span className="text-[10px] text-[#2d7a3a] bg-[#e6faf0] px-1.5 py-0.5 rounded-full border border-[#a3e6b4]">
                      {jokerExt ? jokerExt : 'tap to lay off ✓'}
                    </span>
                  )
                })()}
                {!isValidTarget && jokerMeldIds?.has(meld.id) && (
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
          )
          })}
        </div>
      )}
    </div>
  )
}
