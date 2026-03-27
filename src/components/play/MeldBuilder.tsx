import { useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { Card as CardType, RoundRequirement } from '../../game/types'
import { isValidSet, isValidRun, getNextJokerOptions } from '../../game/meld-validator'
import { aiFindBestMelds } from '../../game/ai'
import { cardPoints } from '../../game/rules'
import CardComponent from './Card'

interface Props {
  hand: CardType[]
  requirement: RoundRequirement
  onConfirm: (meldGroups: CardType[][], jokerPositions: Map<string, number>) => void
  onClose: () => void
  mustLayDown?: boolean
  sortMode?: 'rank' | 'suit'
  onSortChange?: (mode: 'rank' | 'suit') => void
  /** Callback: returns set of card IDs currently assigned to meld slots */
  onAssignedIdsChange?: (ids: Set<string>) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

function totalRequired(req: RoundRequirement): number {
  return req.sets + req.runs
}

function validateSlot(cards: CardType[], slotIdx: number, req: RoundRequirement): boolean {
  if (cards.length === 0) return false
  return slotIdx < req.sets ? isValidSet(cards) : isValidRun(cards)
}

function slotLabel(slotIdx: number, req: RoundRequirement): string {
  return slotIdx < req.sets ? 'Set' : 'Run'
}

function rankLabel(rank: number): string {
  if (rank === 0 || rank === 14) return 'A'
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

function describeMeld(cards: CardType[]): string {
  if (isValidSet(cards)) {
    const natural = cards.find(c => c.suit !== 'joker')
    if (!natural) return 'Set'
    const rank = natural.rank
    const name: Record<number, string> = { 1: 'Aces', 11: 'Jacks', 12: 'Queens', 13: 'Kings' }
    return `Set of ${name[rank] ?? `${rank}s`}`
  }
  if (isValidRun(cards)) {
    const natural = cards.find(c => c.suit !== 'joker')
    if (!natural) return 'Run'
    const suitName: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
    const sorted = cards.filter(c => c.suit !== 'joker').sort((a, b) => a.rank - b.rank)
    const lo = sorted[0]
    const hi = sorted[sorted.length - 1]
    return `${rankLabel(lo.rank)}-${rankLabel(hi.rank)}${suitName[natural.suit] ?? ''}`
  }
  return `${cards.length} cards`
}

function slotHint(cards: CardType[], slotIdx: number, req: RoundRequirement): string | null {
  if (cards.length === 0) return null
  const isSetSlot = slotIdx < req.sets
  if (isSetSlot) {
    if (cards.length < 3) return `need ${3 - cards.length} more`
    if (!isValidSet(cards)) return 'not a valid set'
  } else {
    if (cards.length < 4) return `need ${4 - cards.length} more`
    if (!isValidRun(cards)) return 'not a valid run'
  }
  return null
}

// ── Shared button styles ───────────────────────────────────────────────────

const secondaryBtn: React.CSSProperties = {
  flex: 1, minHeight: 38, background: '#1e4a2e', color: '#a8d0a8',
  border: '1px solid #2d5a3a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    flex: 1, minHeight: 38, borderRadius: 8, border: 'none',
    fontSize: 13, fontWeight: 700, cursor: enabled ? 'pointer' : 'default',
    background: enabled ? '#e2b858' : '#1e4a2e',
    color: enabled ? '#2c1810' : '#3a5a3a',
  }
}

// ── Joker Placement Overlay ────────────────────────────────────────────────

function JokerPlacementOverlay({
  pendingGroup,
  jokerPositions,
  onPick,
  onBack,
  mustLayDown,
}: {
  pendingGroup: CardType[]
  jokerPositions: Map<string, number>
  onPick: (jokerId: string, rank: number) => void
  onBack: () => void
  mustLayDown?: boolean
}) {
  const placement = getNextJokerOptions(pendingGroup, jokerPositions)
  if (!placement) return null

  const sym = suitSymbol(placement.suit)
  const placedCount = jokerPositions.size
  const totalAmbiguous = (() => {
    let count = 0
    const temp = new Map<string, number>()
    let p = getNextJokerOptions(pendingGroup, temp)
    while (p) { count++; temp.set(p.joker.id, p.options[0].rank); p = getNextJokerOptions(pendingGroup, temp) }
    return count
  })()

  return (
    <>
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', zIndex: 49,
        }}
        onClick={mustLayDown ? undefined : onBack}
      />
      <div style={{
        position: 'fixed',
        top: 'max(56px, calc(env(safe-area-inset-top) + 56px))',
        bottom: 200, left: 8, right: 8,
        background: '#0f2218', borderRadius: 10, zIndex: 50,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px 8px', borderBottom: '1px solid #1e4a2e', flexShrink: 0,
        }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#e2b858', margin: 0 }}>Place Your Joker</p>
            <p style={{ fontSize: 10, color: '#6aad7a', margin: '2px 0 0' }}>
              {totalAmbiguous > 1 ? `Joker ${placedCount + 1} of ${totalAmbiguous} — ` : ''}Choose where it goes in your run
            </p>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 10, color: '#6aad7a', margin: 0 }}>
            Tap the position. Choosing low lets you extend the run further later.
          </p>
          {placement.options.map(option => (
            <button
              key={option.rank}
              onClick={() => onPick(placement.joker.id, option.rank)}
              style={{
                width: '100%', textAlign: 'left', background: '#1e4a2e',
                border: '1.5px solid #2d5a3a', borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, background: '#e2b858',
                  color: '#2c1810', borderRadius: 10, padding: '1px 8px',
                }}>
                  Joker = {rankLabel(option.displayRank)}{sym}
                </span>
                <span style={{ fontSize: 10, color: '#6aad7a' }}>
                  {option.rank === placement.options[0].rank ? '← extend low' : 'extend high →'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
                {option.sequence.map(pos => {
                  if (pos.isNatural) {
                    const card = pendingGroup.find(c => {
                      if (c.suit === 'joker') return false
                      const r = placement.aceHigh && c.rank === 1 ? 14 : c.rank
                      return r === pos.rank
                    })
                    if (card) return <CardComponent key={pos.rank} card={card} compact />
                  }
                  const isChosen = pos.rank === option.rank
                  return (
                    <div
                      key={pos.rank}
                      style={{
                        width: 40, height: 64, borderRadius: 6, flexShrink: 0,
                        background: isChosen ? '#fff8e0' : '#1a3a2a',
                        border: `1.5px solid ${isChosen ? '#e2b858' : '#2d5a3a'}`,
                        opacity: isChosen ? 1 : 0.6,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <span style={{ fontSize: 8, fontWeight: 700, color: '#8b6914' }}>JKR</span>
                      <span style={{ fontSize: 8, color: '#8b6914' }}>{rankLabel(pos.displayRank)}{sym}</span>
                    </div>
                  )
                })}
              </div>
            </button>
          ))}
        </div>

        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid #1e4a2e', flexShrink: 0 }}>
          <button onClick={onBack} style={secondaryBtn}>Back</button>
        </div>
      </div>
    </>
  )
}

// ── Bonus Suggest Overlay ──────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// MeldBuilder — inline meld-building component
// ════════════════════════════════════════════════════════════════════════════

export interface MeldBuilderHandle {
  handleCardTap: (card: CardType) => void
}

const MeldBuilder = forwardRef<MeldBuilderHandle, Props>(function MeldBuilder({
  hand,
  requirement,
  onConfirm,
  onClose,
  mustLayDown,
  onAssignedIdsChange,
}, ref) {
  const total = totalRequired(requirement)

  // ── State ──────────────────────────────────────────────────────────────

  type BuildPhase = 'building' | 'joker-placement'
  const [phase, setPhase] = useState<BuildPhase>('building')

  // Cards in each required slot
  const [slotCards, setSlotCards] = useState<CardType[][]>(() =>
    Array.from({ length: total }, () => [])
  )
  // Active slot index (highlighted, receives card taps)
  const [activeSlot, setActiveSlot] = useState(0)
  // Joker state
  const [jokerPositions, setJokerPositions] = useState<Map<string, number>>(new Map())
  const [pendingGroups, setPendingGroups] = useState<CardType[][]>([])
  const [pendingJokerGroupIdx, setPendingJokerGroupIdx] = useState(0)
  const [pendingGroup, setPendingGroup] = useState<CardType[] | null>(null)
  // Suggestion applied flag
  const [suggestionApplied, setSuggestionApplied] = useState(false)

  // ── Derived ────────────────────────────────────────────────────────────

  const assignedIds = useMemo(() => {
    const ids = new Set<string>()
    slotCards.forEach(s => s.forEach(c => ids.add(c.id)))
    return ids
  }, [slotCards])

  // Notify parent of assigned IDs changes
  const prevAssignedRef = useMemo(() => ({ current: new Set<string>() }), [])
  if (onAssignedIdsChange) {
    const changed = assignedIds.size !== prevAssignedRef.current.size ||
      [...assignedIds].some(id => !prevAssignedRef.current.has(id))
    if (changed) {
      prevAssignedRef.current = assignedIds
      // Schedule to avoid setState during render
      setTimeout(() => onAssignedIdsChange(assignedIds), 0)
    }
  }

  const remainingPts = useMemo(() => {
    return hand.filter(c => !assignedIds.has(c.id)).reduce((sum, c) => sum + cardPoints(c.rank), 0)
  }, [hand, assignedIds])

  const allSlotsValid = slotCards.every((cards, i) => validateSlot(cards, i, requirement))
  const validCount = slotCards.filter((cards, i) => validateSlot(cards, i, requirement)).length

  // Suggestion
  const suggestedMelds = useMemo(() => {
    return aiFindBestMelds(hand, requirement)
  }, [hand, requirement])

  const hasSuggestion = suggestedMelds !== null

  // Check if can't lay down at all
  const cantLayDown = !hasSuggestion && slotCards.every(s => s.length === 0)

  // ── Card tap handler — called from GameBoard ───────────────────────────

  const handleCardTap = useCallback((card: CardType) => {
    // In building phase, add card to the active slot
    if (activeSlot < total) {
      setSlotCards(prev => {
        const next = prev.map(s => [...s])
        next[activeSlot] = [...next[activeSlot], card]
        return next
      })
    }
  }, [activeSlot, total])

  // Expose handleCardTap to parent via ref
  useImperativeHandle(ref, () => ({ handleCardTap }), [handleCardTap])

  // ── Remove card from slot ──────────────────────────────────────────────

  function removeFromSlot(card: CardType, slotIdx: number) {
    setSlotCards(prev => {
      const next = prev.map(s => [...s])
      next[slotIdx] = next[slotIdx].filter(c => c.id !== card.id)
      return next
    })
  }

  // ── Apply suggestion ───────────────────────────────────────────────────

  function applySuggestion() {
    if (!suggestedMelds) return
    const required = suggestedMelds.slice(0, total)
    // Reorder melds to match slot layout: set slots first, then run slots.
    // aiFindBestMelds may return runs-first when sets-first fails, but slots
    // are always ordered sets (0..sets-1) then runs (sets..total-1).
    const sets: CardType[][] = []
    const runs: CardType[][] = []
    for (const meld of required) {
      if (isValidSet(meld)) sets.push(meld)
      else runs.push(meld)
    }
    const ordered = [...sets, ...runs]
    setSlotCards(ordered.map(m => [...m]))
    setSuggestionApplied(true)
    // Auto-select last slot
    setActiveSlot(total - 1)
  }

  function clearAll() {
    setSlotCards(Array.from({ length: total }, () => []))
    setSuggestionApplied(false)
    setActiveSlot(0)
  }

  // ── Joker processing ───────────────────────────────────────────────────

  function startJokerProcessing(
    groups: CardType[][],
    positions: Map<string, number>,
    startIdx: number,
  ) {
    for (let i = startIdx; i < groups.length; i++) {
      const group = groups[i]
      if (isValidRun(group) && !isValidSet(group) && group.some(c => c.suit === 'joker')) {
        const placement = getNextJokerOptions(group, positions)
        if (placement) {
          setPendingGroups(groups)
          setPendingJokerGroupIdx(i)
          setPendingGroup(group)
          setJokerPositions(positions)
          setPhase('joker-placement')
          return
        }
      }
    }
    resolveGroups(groups, positions)
  }

  function resolveGroups(
    groups: CardType[][],
    positions: Map<string, number>,
  ) {
    setJokerPositions(positions)
    onConfirm(groups, positions)
  }

  function handleLayDown() {
    if (!allSlotsValid) return
    startJokerProcessing([...slotCards], new Map(), 0)
  }

  // ── Joker pick handlers ────────────────────────────────────────────────

  function handleJokerPick(jokerCardId: string, rank: number) {
    if (!pendingGroup) return
    const newPositions = new Map(jokerPositions)
    newPositions.set(jokerCardId, rank)

    if (getNextJokerOptions(pendingGroup, newPositions)) {
      setJokerPositions(newPositions)
      return
    }

    for (let i = pendingJokerGroupIdx + 1; i < pendingGroups.length; i++) {
      const group = pendingGroups[i]
      if (isValidRun(group) && !isValidSet(group) && group.some(c => c.suit === 'joker')) {
        const placement = getNextJokerOptions(group, newPositions)
        if (placement) {
          setPendingJokerGroupIdx(i)
          setPendingGroup(group)
          setJokerPositions(newPositions)
          return
        }
      }
    }

    resolveGroups(pendingGroups, newPositions)
  }

  function handleJokerBack() {
    setPendingGroup(null)
    setJokerPositions(new Map())
    setPhase('building')
  }

  // ── Overlay sub-flows ──────────────────────────────────────────────────

  if (phase === 'joker-placement' && pendingGroup) {
    return (
      <JokerPlacementOverlay
        pendingGroup={pendingGroup}
        jokerPositions={jokerPositions}
        onPick={handleJokerPick}
        onBack={handleJokerBack}
        mustLayDown={mustLayDown}
      />
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // Main building phase — inline staging area
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div style={{
      flexShrink: 0,
      background: '#0a1a10',
      borderTop: '1px solid #2d5a3a',
      borderBottom: '1px solid #2d5a3a',
      padding: '8px 12px',
      animation: 'meld-staging-in 300ms ease-out both',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      maxHeight: '40vh',
      overflowY: 'auto',
    }}>
      {/* Must lay down banner */}
      {mustLayDown && (
        <div style={{
          background: '#181000', border: '1px solid #8b6914', borderRadius: 6, padding: '4px 8px',
        }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#e2b858', margin: 0 }}>
            You swapped a joker — you must lay down!
          </p>
        </div>
      )}

      {/* Can't lay down message */}
      {cantLayDown && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#e8d5a3', margin: 0 }}>Can't lay down yet</p>
          <p style={{ fontSize: 11, color: '#a8d0a8', margin: '4px 0 0' }}>Need: {requirement.description}</p>
          <p style={{ fontSize: 10, color: '#6aad7a', margin: '4px 0 0' }}>Keep drawing and building your hand.</p>
        </div>
      )}

      {/* Progress indicator */}
      {!cantLayDown && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: allSlotsValid ? '#6aad7a' : '#a8d0a8', margin: 0 }}>
            {allSlotsValid ? '✓ Ready to lay down' : `${validCount}/${total} ${requirement.description}`}
          </p>
          <p style={{ fontSize: 10, color: remainingPts > 20 ? '#e2855a' : '#a8d0a8', margin: 0 }}>
            {remainingPts} pts remaining
          </p>
        </div>
      )}

      {/* Suggestion banner */}
      {hasSuggestion && !suggestionApplied && !cantLayDown && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#132a1a', border: '1px solid #2d5a3a', borderRadius: 6,
          padding: '4px 10px',
        }}>
          <p style={{ fontSize: 11, color: '#6aad7a', margin: 0 }}>
            {suggestedMelds!.length} valid meld{suggestedMelds!.length !== 1 ? 's' : ''} found
          </p>
          <button
            onClick={applySuggestion}
            style={{
              background: '#1e4a2e', border: '1px solid #3d7a4c', borderRadius: 6,
              color: '#6aad7a', fontSize: 11, fontWeight: 600, padding: '3px 10px',
              cursor: 'pointer', minHeight: 26,
            }}
          >
            Auto-fill
          </button>
        </div>
      )}

      {/* Meld slots */}
      {!cantLayDown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slotCards.map((cards, slotIdx) => {
            const isActive = slotIdx === activeSlot
            const valid = validateSlot(cards, slotIdx, requirement)
            const hint = slotHint(cards, slotIdx, requirement)

            return (
              <div
                key={slotIdx}
                onClick={() => setActiveSlot(slotIdx)}
                style={{
                  border: valid
                    ? '2px solid #6aad7a'
                    : isActive
                      ? '2px solid #e2b858'
                      : '2px dashed #2d5a3a',
                  background: '#1a3a2a',
                  borderRadius: 8,
                  padding: '6px 8px',
                  minHeight: 46,
                  cursor: 'pointer',
                  transition: 'border-color 150ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: cards.length > 0 ? 4 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <p style={{
                      fontSize: 9, fontWeight: 600, margin: 0,
                      color: isActive ? '#e2b858' : '#6aad7a',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {slotLabel(slotIdx, requirement)} {slotIdx + 1}
                    </p>
                    {valid && (
                      <span style={{
                        fontSize: 8, fontWeight: 700, background: '#6aad7a', color: '#0f2218',
                        borderRadius: 4, padding: '1px 5px',
                      }}>
                        ✓ {describeMeld(cards)}
                      </span>
                    )}
                    {!valid && hint && (
                      <span style={{ fontSize: 9, color: '#8b7355' }}>{hint}</span>
                    )}
                  </div>
                  {cards.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSlotCards(prev => {
                          const next = prev.map(s => [...s])
                          next[slotIdx] = []
                          return next
                        })
                      }}
                      style={{
                        background: 'transparent', border: 'none', color: '#6aad7a',
                        fontSize: 9, fontWeight: 600, cursor: 'pointer', padding: '0 4px',
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {cards.length === 0 ? (
                  <p style={{
                    fontSize: 10, margin: '2px 0',
                    color: isActive ? '#e2b858' : '#2d5a3a',
                    textAlign: 'center', fontStyle: 'italic',
                  }}>
                    {isActive ? 'Tap cards from your hand' : 'Tap to activate'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {cards.map(card => (
                      <div
                        key={card.id}
                        onClick={(e) => { e.stopPropagation(); removeFromSlot(card, slotIdx) }}
                        style={{ cursor: 'pointer' }}
                      >
                        <CardComponent card={card} compact />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        {!mustLayDown && (
          <button onClick={onClose} style={secondaryBtn}>Cancel</button>
        )}
        {slotCards.some(s => s.length > 0) && (
          <button onClick={clearAll} style={secondaryBtn}>Clear</button>
        )}
        {!cantLayDown && (
          <button onClick={handleLayDown} disabled={!allSlotsValid} style={primaryBtn(allSlotsValid)}>
            Lay Down ✓
          </button>
        )}
        {cantLayDown && !mustLayDown && (
          <button onClick={onClose} style={{ ...primaryBtn(true), width: '100%' }}>Got it</button>
        )}
      </div>
    </div>
  )
})

export default MeldBuilder
export type { Props as MeldBuilderProps }
