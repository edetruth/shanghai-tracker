import { useState } from 'react'
import { X } from 'lucide-react'
import type { Card as CardType, RoundRequirement } from '../../game/types'
import { isValidSet, isValidRun } from '../../game/meld-validator'
import { canFormAnyValidMeld } from '../../game/ai'
import CardComponent from './Card'

interface Props {
  hand: CardType[]
  requirement: RoundRequirement
  onConfirm: (meldGroups: CardType[][]) => void
  onClose: () => void
}

type ModalPhase = 'required' | 'bonus-prompt' | 'bonus'

function getMeldTypeHint(requirement: RoundRequirement, step: number): string {
  const meldTypes: string[] = []
  for (let i = 0; i < requirement.sets; i++) meldTypes.push('Set (3+ cards of the same rank)')
  for (let i = 0; i < requirement.runs; i++) meldTypes.push('Run (4+ cards, same suit in sequence)')
  return meldTypes[step] ?? 'Meld'
}

function totalRequired(requirement: RoundRequirement): number {
  return requirement.sets + requirement.runs
}

function validateRequired(cards: CardType[], requirement: RoundRequirement, step: number): { valid: boolean; message: string } {
  if (cards.length === 0) return { valid: false, message: '' }
  const isSetStep = step < requirement.sets
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

function validateBonus(cards: CardType[]): { valid: boolean; message: string } {
  if (cards.length === 0) return { valid: false, message: '' }
  if (isValidSet(cards)) return { valid: true, message: 'Valid set ✓' }
  if (isValidRun(cards)) return { valid: true, message: 'Valid run ✓' }
  if (cards.length < 3) return { valid: false, message: 'Need at least 3 cards for a set, or 4 for a run' }
  return { valid: false, message: 'Not a valid set or run' }
}

// ─── Shared shell ─────────────────────────────────────────────────────────────

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-[#e2ddd2] rounded-full" />
        </div>
        {children}
      </div>
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MeldModal({ hand, requirement, onConfirm, onClose }: Props) {
  const total = totalRequired(requirement)
  const [phase, setPhase] = useState<ModalPhase>('required')
  const [step, setStep] = useState(0)
  const [groups, setGroups] = useState<CardType[][]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const usedIds = new Set(groups.flatMap(g => g.map(c => c.id)))
  const selectedCards = hand.filter(c => selectedIds.has(c.id))

  function toggleCard(cardId: string) {
    if (usedIds.has(cardId)) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  // ── Confirm a meld (required or bonus) ──────────────────────────────────
  function handleConfirmMeld() {
    const newGroups = [...groups, selectedCards]
    setGroups(newGroups)
    setSelectedIds(new Set())

    if (phase === 'required') {
      if (step + 1 < total) {
        setStep(step + 1)
        return
      }
      // All required melds met — check for bonus opportunities
      const usedIdsNow = new Set(newGroups.flatMap(g => g.map(c => c.id)))
      const remaining = hand.filter(c => !usedIdsNow.has(c.id))
      if (remaining.length > 0 && canFormAnyValidMeld(remaining)) {
        setPhase('bonus-prompt')
      } else {
        onConfirm(newGroups)
      }
    } else {
      // Bonus phase — check if more melds are still possible
      const usedIdsNow = new Set(newGroups.flatMap(g => g.map(c => c.id)))
      const remaining = hand.filter(c => !usedIdsNow.has(c.id))
      if (remaining.length === 0 || !canFormAnyValidMeld(remaining)) {
        onConfirm(newGroups)
      }
      // else: stay in bonus phase for another meld
    }
  }

  // ── Back navigation ──────────────────────────────────────────────────────
  function handleBack() {
    setSelectedIds(new Set())
    if (phase === 'bonus') {
      setPhase('bonus-prompt')
    } else if (phase === 'bonus-prompt') {
      // Un-commit last required meld, go back to it
      setGroups(groups.slice(0, total - 1))
      setStep(total - 1)
      setPhase('required')
    } else if (step === 0) {
      onClose()
    } else {
      setGroups(groups.slice(0, -1))
      setStep(step - 1)
    }
  }

  // ─── Bonus prompt screen ──────────────────────────────────────────────────
  if (phase === 'bonus-prompt') {
    return (
      <ModalShell onClose={onClose}>
        <div className="flex items-center justify-between px-4 pb-3 border-b border-[#e2ddd2]">
          <div>
            <h2 className="font-bold text-[#2c1810] text-base">Lay Down More?</h2>
            <p className="text-xs text-[#8b7355] mt-0.5">
              Requirement met · {groups.length} meld{groups.length !== 1 ? 's' : ''} confirmed
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#a08c6e] active:bg-[#efe9dd]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div className="bg-[#f0fdf4] border border-[#a3e6b4] rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-[#2d7a3a] mb-1">Requirement met! ✓</p>
            <p className="text-sm text-[#8b7355]">
              You have cards for additional melds. Laying down more reduces your hand and lowers your score.
            </p>
          </div>

          {/* Show confirmed melds */}
          {groups.map((group, i) => (
            <div key={i} className="opacity-50">
              <p className="text-xs text-[#8b7355] mb-1">Meld {i + 1} (confirmed)</p>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {group.map(card => (
                  <CardComponent key={card.id} card={card} compact />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 pb-8 pt-3 border-t border-[#e2ddd2] flex gap-3">
          <button onClick={() => onConfirm(groups)} className="btn-secondary flex-1">
            No, I'm done
          </button>
          <button onClick={() => setPhase('bonus')} className="btn-primary flex-1">
            Yes, lay down more
          </button>
        </div>
      </ModalShell>
    )
  }

  // ─── Required / bonus selection screen ───────────────────────────────────
  const validation = phase === 'required'
    ? validateRequired(selectedCards, requirement, step)
    : validateBonus(selectedCards)

  const bonusMeldNumber = groups.length - total + 1

  return (
    <ModalShell onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3 border-b border-[#e2ddd2]">
        <div>
          <h2 className="font-bold text-[#2c1810] text-base">Lay Down Your Hand</h2>
          <p className="text-xs text-[#8b7355] mt-0.5">
            {phase === 'required'
              ? `Meld ${step + 1} of ${total} — ${getMeldTypeHint(requirement, step)}`
              : `Extra meld ${bonusMeldNumber} — Set or Run`}
          </p>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#a08c6e] active:bg-[#efe9dd]">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Previously confirmed groups */}
        {groups.map((group, i) => (
          <div key={i} className="opacity-40">
            <p className="text-xs text-[#8b7355] mb-1">
              {i < total ? `Meld ${i + 1}` : `Extra meld ${i - total + 1}`} (confirmed)
            </p>
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
        <button onClick={handleBack} className="btn-secondary flex-1">
          {phase === 'required' && step === 0 ? 'Cancel' : 'Back'}
        </button>
        {phase === 'bonus' && (
          <button onClick={() => onConfirm(groups)} className="btn-secondary flex-1">
            Done
          </button>
        )}
        <button
          onClick={handleConfirmMeld}
          disabled={!validation.valid}
          className="btn-primary flex-1"
        >
          {phase === 'required' && step + 1 >= total ? 'Lay Down All' : 'Confirm Meld'}
        </button>
      </div>
    </ModalShell>
  )
}
