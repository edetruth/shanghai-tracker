import { useState } from 'react'
import { X } from 'lucide-react'
import type { Card as CardType, RoundRequirement } from '../../game/types'
import { isValidSet, isValidRun } from '../../game/meld-validator'
import CardComponent from './Card'

interface Props {
  hand: CardType[]
  requirement: RoundRequirement
  onConfirm: (meldGroups: CardType[][]) => void
  onClose: () => void
}

function getMeldTypeHint(requirement: RoundRequirement, step: number): string {
  // Build an ordered list of what each meld step expects
  const meldTypes: string[] = []
  for (let i = 0; i < requirement.sets; i++) meldTypes.push('Set (3+ cards of the same rank)')
  for (let i = 0; i < requirement.runs; i++) meldTypes.push('Run (4+ cards, same suit in sequence)')
  return meldTypes[step] ?? 'Meld'
}

function totalMelds(requirement: RoundRequirement): number {
  return requirement.sets + requirement.runs
}

function validateCurrentSelection(cards: CardType[], requirement: RoundRequirement, step: number): { valid: boolean; message: string } {
  if (cards.length === 0) return { valid: false, message: '' }

  const sets = requirement.sets
  const isSetStep = step < sets

  if (isSetStep) {
    if (isValidSet(cards)) return { valid: true, message: 'Valid set ✓' }
    if (cards.length < 3) return { valid: false, message: `Need at least 3 cards for a set (have ${cards.length})` }
    return { valid: false, message: 'Not a valid set — cards must share the same rank' }
  } else {
    if (isValidRun(cards)) return { valid: true, message: 'Valid run ✓' }
    if (cards.length < 4) return { valid: false, message: `Need at least 4 cards for a run (have ${cards.length})` }
    return { valid: false, message: 'Not a valid run — cards must be same suit in sequence' }
  }
}

export default function MeldModal({ hand, requirement, onConfirm, onClose }: Props) {
  const total = totalMelds(requirement)
  const [step, setStep] = useState(0)
  const [groups, setGroups] = useState<CardType[][]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Cards already locked into previous groups
  const usedIds = new Set(groups.flatMap(g => g.map(c => c.id)))

  function toggleCard(cardId: string) {
    if (usedIds.has(cardId)) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const selectedCards = hand.filter(c => selectedIds.has(c.id))
  const validation = validateCurrentSelection(selectedCards, requirement, step)

  function handleConfirmMeld() {
    if (!validation.valid) return
    const newGroups = [...groups, selectedCards]
    setGroups(newGroups)
    setSelectedIds(new Set())

    if (step + 1 >= total) {
      // All melds confirmed — call parent
      onConfirm(newGroups)
    } else {
      setStep(step + 1)
    }
  }

  function handleBack() {
    if (step === 0) {
      onClose()
    } else {
      // Go back: un-commit the previous group
      const prevGroups = groups.slice(0, -1)
      setGroups(prevGroups)
      setSelectedIds(new Set())
      setStep(step - 1)
    }
  }

  const isLastStep = step + 1 >= total

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-[#e2ddd2] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-[#e2ddd2]">
          <div>
            <h2 className="font-bold text-[#2c1810] text-base">Lay Down Your Hand</h2>
            <p className="text-xs text-[#8b7355] mt-0.5">
              Meld {step + 1} of {total} — {getMeldTypeHint(requirement, step)}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#a08c6e] active:bg-[#efe9dd]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Previous meld groups (dimmed) */}
          {groups.map((group, i) => (
            <div key={i} className="opacity-40">
              <p className="text-xs text-[#8b7355] mb-1">Meld {i + 1} (confirmed)</p>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {group.map(card => (
                  <CardComponent key={card.id} card={card} compact />
                ))}
              </div>
            </div>
          ))}

          {/* Selected cards preview */}
          {selectedCards.length > 0 && (
            <div>
              <p className="text-xs text-[#8b7355] mb-1">Selected ({selectedCards.length})</p>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {selectedCards.map(card => (
                  <CardComponent key={card.id} card={card} compact selected />
                ))}
              </div>
              {/* Validation message */}
              {validation.message && (
                <p className={`text-xs mt-1.5 font-medium ${validation.valid ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
                  {validation.message}
                </p>
              )}
            </div>
          )}

          {/* Hand */}
          <div>
            <p className="text-xs text-[#8b7355] mb-1.5">
              Your hand ({hand.filter(c => !usedIds.has(c.id)).length} available)
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
              {hand.map(card => {
                const locked = usedIds.has(card.id)
                return (
                  <CardComponent
                    key={card.id}
                    card={card}
                    selected={selectedIds.has(card.id)}
                    onClick={locked ? undefined : () => toggleCard(card.id)}
                    disabled={locked}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-4 pb-8 pt-3 border-t border-[#e2ddd2] flex gap-3">
          <button
            onClick={handleBack}
            className="btn-secondary flex-1"
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          <button
            onClick={handleConfirmMeld}
            disabled={!validation.valid}
            className="btn-primary flex-1"
          >
            {isLastStep ? 'Lay Down All' : 'Confirm Meld'}
          </button>
        </div>
      </div>
    </>
  )
}
