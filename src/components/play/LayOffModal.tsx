import { useState } from 'react'
import { X } from 'lucide-react'
import type { Card as CardType, Meld, RoundRequirement } from '../../game/types'
import { canLayOff, simulateLayOff, findSwappableJoker } from '../../game/meld-validator'
import { aiFindBestMelds } from '../../game/ai'
import CardComponent from './Card'
import TableMelds from './TableMelds'

interface Props {
  hand: CardType[]
  tablesMelds: Meld[]
  onLayOff: (card: CardType, meld: Meld) => void
  onSwapJoker: (naturalCard: CardType, meld: Meld) => void
  onClose: () => void
  errorMsg?: string | null
  // Pre-lay-down swap mode: player hasn't laid down yet, must lay down after swap
  preLayDown?: boolean
  requirement?: RoundRequirement
  onPreLayDownSwap?: (card: CardType, meld: Meld) => void
}

function cardName(card: CardType): string {
  const ranks: Record<number, string> = { 0: 'Joker', 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }
  const suits: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
  return `${ranks[card.rank] ?? String(card.rank)}${suits[card.suit] ?? ''}`
}

type Mode = 'layoff' | 'swap'

export default function LayOffModal({ hand, tablesMelds, onLayOff, onSwapJoker, onClose, errorMsg, preLayDown, requirement, onPreLayDownSwap }: Props) {
  const [mode, setMode] = useState<Mode>(preLayDown ? 'swap' : 'layoff')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null)

  const selectedCard = hand.find(c => c.id === selectedCardId) ?? null
  const selectedMeld = tablesMelds.find(m => m.id === selectedMeldId) ?? null

  // Natural cards only for swap mode
  const swapableHand = mode === 'swap' ? hand.filter(c => c.suit !== 'joker') : hand

  function handleCardClick(cardId: string) {
    setSelectedCardId(prev => prev === cardId ? null : cardId)
    setSelectedMeldId(null)
  }

  function handleMeldClick(meld: Meld) {
    setSelectedMeldId(prev => prev === meld.id ? null : meld.id)
  }

  function handleModeChange(m: Mode) {
    setMode(m)
    setSelectedCardId(null)
    setSelectedMeldId(null)
  }

  // Smart meld sorting: when a card is selected, bubble valid targets to the top
  const validLayOffMeldIds: Set<string> | undefined = (() => {
    if (!selectedCard || mode !== 'layoff') return undefined
    return new Set(tablesMelds.filter(m => canLayOff(selectedCard, m)).map(m => m.id))
  })()

  const displayMelds = (() => {
    if (!selectedCard) return tablesMelds
    if (mode === 'layoff') {
      const valid = tablesMelds.filter(m => validLayOffMeldIds!.has(m.id))
      const invalid = tablesMelds.filter(m => !validLayOffMeldIds!.has(m.id))
      return [...valid, ...invalid]
    }
    if (mode === 'swap') {
      // Runs with jokers swappable for this card go first
      const validSwap = tablesMelds.filter(m => m.type === 'run' && findSwappableJoker(selectedCard, m))
      const rest = tablesMelds.filter(m => !(m.type === 'run' && findSwappableJoker(selectedCard, m)))
      return [...validSwap, ...rest]
    }
    return tablesMelds
  })()

  // Joker swap targets: only runs (sets excluded per house rules)
  const swapRunMeldIds = new Set(tablesMelds.filter(m => m.type === 'run' && m.jokerMappings.length > 0).map(m => m.id))

  // Validation
  let isValid = false
  let validationMessage = ''

  if (selectedCard && selectedMeld) {
    if (mode === 'layoff') {
      isValid = canLayOff(selectedCard, selectedMeld)
      validationMessage = isValid
        ? 'Valid lay off ✓'
        : 'This card cannot be laid off on that meld'

      // Pre-validate: would this lay-off leave exactly 1 card that can't be played?
      if (isValid) {
        const handAfter = hand.filter(c => c.id !== selectedCard.id)
        if (handAfter.length === 1) {
          const remaining = handAfter[0]
          // Check against SIMULATED updated melds (after the lay-off extends the target meld)
          const simulatedMelds = tablesMelds.map(m =>
            m.id === selectedMeld.id ? simulateLayOff(selectedCard, m) : m
          )
          const canRemainPlay = simulatedMelds.some(m => canLayOff(remaining, m))
          if (!canRemainPlay) {
            isValid = false
            validationMessage = `Can't lay off — your remaining ${cardName(remaining)} can't be played anywhere, and you can't go out by discarding. Keep both cards and discard one instead.`
          } else {
            validationMessage = `Valid lay off ✓ — you can go out by laying off ${cardName(remaining)} next!`
          }
        }
      }
    } else {
      const joker = findSwappableJoker(selectedCard, selectedMeld)
      isValid = joker !== null
      if (isValid && joker) {
        if (preLayDown && requirement) {
          // Pre-lay-down swap: verify the player can lay down after getting this joker
          const simulatedHand = [...hand.filter(c => c.id !== selectedCard.id), joker]
          const canLayDown = aiFindBestMelds(simulatedHand, requirement) !== null
          if (!canLayDown) {
            isValid = false
            validationMessage = "You can't lay down even with this joker. Swap not allowed."
          } else {
            validationMessage = 'Valid swap ✓ — you\'ll take the joker and must lay down'
          }
        } else {
          validationMessage = 'Valid swap ✓ — you\'ll take the joker'
        }
      } else if (!isValid) {
        validationMessage = 'No joker in that meld represents this card'
      }
    }
  }

  function handleConfirm() {
    if (!selectedCard || !selectedMeld || !isValid) return
    if (mode === 'layoff') {
      onLayOff(selectedCard, selectedMeld)
    } else if (preLayDown && onPreLayDownSwap) {
      onPreLayDownSwap(selectedCard, selectedMeld)
      return // parent closes the modal
    } else {
      onSwapJoker(selectedCard, selectedMeld)
    }
    // Reset selections so player can do another action
    setSelectedCardId(null)
    setSelectedMeldId(null)
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-[#e2ddd2] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-[#e2ddd2]">
          <div>
            <h2 className="font-bold text-[#2c1810] text-base">
              {preLayDown ? 'Swap Joker' : 'Lay Off / Swap'}
            </h2>
            {preLayDown && (
              <p className="text-xs text-[#e2b858] font-semibold mt-0.5">You must lay down after this swap</p>
            )}
            {!preLayDown && mode === 'layoff' && hand.length > 1 && (
              <p className="text-xs text-[#8b7355] mt-0.5">
                Lay off one card at a time — keep going until you're ready to discard
              </p>
            )}
            {!preLayDown && mode === 'layoff' && hand.length === 1 && (
              <p className="text-xs text-[#2d7a3a] font-semibold mt-0.5">
                Last card — lay it off to go out!
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#a08c6e] active:bg-[#efe9dd]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Empty melds message */}
          {tablesMelds.length === 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-[#a08c6e] italic">No melds on the table yet.</p>
              <p className="text-xs text-[#a08c6e] mt-1">Lay off once other players have laid down melds.</p>
            </div>
          )}

          {/* Mode tabs — hidden in pre-lay-down mode (swap only) */}
          {!preLayDown && (
            <div className="bg-[#efe9dd] rounded-xl p-1 flex gap-1">
              <button
                onClick={() => handleModeChange('layoff')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  mode === 'layoff' ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'
                }`}
              >
                Lay Off
              </button>
              <button
                onClick={() => handleModeChange('swap')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  mode === 'swap' ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'
                }`}
              >
                Swap Joker
              </button>
            </div>
          )}

          {/* Swap mode hint when no RUNS have jokers */}
          {mode === 'swap' && swapRunMeldIds.size === 0 && tablesMelds.length > 0 && (
            <p className="text-sm text-[#a08c6e] italic text-center py-2">
              No runs with jokers on the table (jokers in sets cannot be swapped)
            </p>
          )}

          {/* Step 1: pick card */}
          <div>
            <p className="text-xs text-[#8b7355] mb-1.5">
              Step 1: Pick a card from your hand
              {mode === 'swap' && ' (natural cards only)'}
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
              {swapableHand.map(card => (
                <CardComponent
                  key={card.id}
                  card={card}
                  selected={selectedCardId === card.id}
                  onClick={() => handleCardClick(card.id)}
                />
              ))}
              {swapableHand.length === 0 && (
                <p className="text-sm text-[#a08c6e] italic">No eligible cards</p>
              )}
            </div>
          </div>

          {/* Step 2: pick meld */}
          {selectedCardId && (
            <div>
              <p className="text-xs text-[#8b7355] mb-1.5">
                Step 2: Pick a meld on the table
                {mode === 'layoff' && validLayOffMeldIds!.size === 0 && (
                  <span className="text-[#b83232] ml-1">— this card can't be laid off on any meld</span>
                )}
              </p>
              {tablesMelds.length === 0 ? (
                <p className="text-sm text-[#a08c6e] italic">No melds on the table yet</p>
              ) : (
                <TableMelds
                  melds={displayMelds}
                  onMeldClick={handleMeldClick}
                  highlightMeldId={selectedMeldId ?? undefined}
                  jokerMeldIds={mode === 'swap' ? swapRunMeldIds : undefined}
                  validLayOffMeldIds={mode === 'layoff' ? validLayOffMeldIds : undefined}
                  layOffCard={mode === 'layoff' ? selectedCard : null}
                />
              )}
            </div>
          )}

          {/* Validation message */}
          {selectedCard && selectedMeld && validationMessage && (
            <p className={`text-xs font-medium ${isValid ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
              {validationMessage}
            </p>
          )}
        </div>

        {/* External error (safety-net undo message) */}
        {errorMsg && (
          <div className="px-4 pb-2">
            <p className="text-xs text-[#b83232] bg-[#fff0f0] border border-[#f0c0c0] rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 pb-8 pt-3 border-t border-[#e2ddd2] flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="btn-primary flex-1"
          >
            {preLayDown ? 'Swap & Lay Down' : 'Confirm'}
          </button>
        </div>
      </div>
    </>
  )
}
