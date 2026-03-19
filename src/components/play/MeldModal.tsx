import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import type { Card as CardType, RoundRequirement } from '../../game/types'
import { isValidSet, isValidRun, getNextJokerOptions } from '../../game/meld-validator'
import { canFormAnyValidMeld } from '../../game/ai'
import CardComponent from './Card'

interface Props {
  hand: CardType[]
  requirement: RoundRequirement
  onConfirm: (meldGroups: CardType[][], jokerPositions: Map<string, number>) => void
  onClose: () => void
  mustLayDown?: boolean     // true when player swapped a joker pre-lay-down and MUST lay down now
  sortMode?: 'rank' | 'suit'
  onSortChange?: (mode: 'rank' | 'suit') => void
}

type ModalPhase = 'slots' | 'bonus-prompt' | 'bonus' | 'joker-placement'
type AllowedMeldType = 'set' | 'run' | 'both'

// ── Unchanged helpers ────────────────────────────────────────────────────────

function getAllowedBonusTypes(req: RoundRequirement): AllowedMeldType {
  if (req.sets > 0 && req.runs > 0) return 'both'
  if (req.sets > 0) return 'set'
  return 'run'
}

function bonusTypeLabel(t: AllowedMeldType): string {
  if (t === 'set') return 'Sets only'
  if (t === 'run') return 'Runs only'
  return 'Sets or Runs'
}

function totalRequired(req: RoundRequirement): number {
  return req.sets + req.runs
}

function validateSlot(cards: CardType[], slotIdx: number, req: RoundRequirement): boolean {
  if (cards.length === 0) return false
  return slotIdx < req.sets ? isValidSet(cards) : isValidRun(cards)
}

function slotLabel(slotIdx: number, req: RoundRequirement): string {
  return slotIdx < req.sets ? 'Set of 3+' : 'Run of 4+'
}

function validateBonus(cards: CardType[], allowed: AllowedMeldType): boolean {
  if (cards.length === 0) return false
  if (allowed !== 'run' && isValidSet(cards)) return true
  if (allowed !== 'set' && isValidRun(cards)) return true
  return false
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

const SUIT_ORDER: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }

// ── Centered modal panel (spec §4.1) — does NOT cover the hand at bottom ──────

function ModalPanel({
  children,
  onClose,
  locked,
}: {
  children: React.ReactNode
  onClose: () => void
  locked?: boolean
}) {
  return (
    <>
      {/* Full-screen backdrop — hides main board hand behind the modal */}
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', zIndex: 49,
        }}
        onClick={locked ? undefined : onClose}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 'max(56px, calc(env(safe-area-inset-top) + 56px))',
          bottom: 200,
          left: 8,
          right: 8,
          background: '#0f2218',
          borderRadius: 10,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </>
  )
}

// ── Shared header bar ─────────────────────────────────────────────────────────

function Header({
  title,
  subtitle,
  onClose,
  locked,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  locked?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px 8px', borderBottom: '1px solid #1e4a2e', flexShrink: 0,
      }}
    >
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#e2b858', margin: 0 }}>{title}</p>
        {subtitle && (
          <p style={{ fontSize: 10, color: '#6aad7a', margin: '2px 0 0' }}>{subtitle}</p>
        )}
      </div>
      {!locked && (
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', color: '#6aad7a',
            cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
            justifyContent: 'center', minWidth: 32, minHeight: 32,
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}

// ── Must-lay-down banner ──────────────────────────────────────────────────────

function MustLayDownBanner() {
  return (
    <div
      style={{
        margin: '8px 12px 0', background: '#181000',
        border: '1px solid #8b6914', borderRadius: 8, padding: '6px 10px', flexShrink: 0,
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 600, color: '#e2b858', margin: 0 }}>
        You swapped a joker — you must lay down your hand this turn!
      </p>
    </div>
  )
}

// ── Sort toggle (spec §4.3) ───────────────────────────────────────────────────

function SortToggle({
  sortMode,
  onSortChange,
}: {
  sortMode: 'rank' | 'suit'
  onSortChange?: (m: 'rank' | 'suit') => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          display: 'flex', background: '#1e4a2e',
          border: '1px solid #2d5a3a', borderRadius: 6, overflow: 'hidden',
        }}
      >
        {(['rank', 'suit'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => onSortChange?.(mode)}
            style={{
              background: sortMode === mode ? '#2d5a3a' : 'transparent',
              color: sortMode === mode ? '#e2b858' : '#6aad7a',
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              border: 'none', cursor: 'pointer', minHeight: 28,
            }}
          >
            {mode === 'rank' ? 'Rank' : 'Suit'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Secondary button style ────────────────────────────────────────────────────

const secondaryBtn: React.CSSProperties = {
  flex: 1, minHeight: 44, background: '#1e4a2e', color: '#a8d0a8',
  border: '1px solid #2d5a3a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    flex: 1, minHeight: 44, borderRadius: 8, border: 'none',
    fontSize: 13, fontWeight: 600, cursor: enabled ? 'pointer' : 'default',
    background: enabled ? '#e2b858' : '#1e4a2e',
    color: enabled ? '#2c1810' : '#3a5a3a',
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MeldModal({
  hand,
  requirement,
  onConfirm,
  onClose,
  mustLayDown,
  sortMode = 'rank',
  onSortChange,
}: Props) {
  const total = totalRequired(requirement)
  const allowedBonusTypes = getAllowedBonusTypes(requirement)

  const [phase, setPhase] = useState<ModalPhase>('slots')
  // Cards placed in each required slot (indices 0..total-1)
  const [slotCards, setSlotCards] = useState<CardType[][]>(() =>
    Array.from({ length: total }, () => [])
  )
  // Cards placed in the current bonus slot
  const [bonusCards, setBonusCards] = useState<CardType[]>([])
  // Cards selected from hand, waiting to be dropped into a slot
  const [selectedHandCards, setSelectedHandCards] = useState<CardType[]>([])
  // Groups that have been fully confirmed (required + past bonus melds)
  const [confirmedGroups, setConfirmedGroups] = useState<CardType[][]>([])

  // ── Joker placement state ────────────────────────────────────────────────
  const [jokerPositions, setJokerPositions] = useState<Map<string, number>>(new Map())
  const [pendingGroups, setPendingGroups] = useState<CardType[][]>([])
  const [pendingJokerGroupIdx, setPendingJokerGroupIdx] = useState(0)
  const [pendingGroup, setPendingGroup] = useState<CardType[] | null>(null)
  const [pendingPhaseAfterJoker, setPendingPhaseAfterJoker] = useState<'slots' | 'bonus' | null>(null)

  // ── Derived state ────────────────────────────────────────────────────────
  const usedIds = useMemo(() => {
    const ids = new Set<string>()
    slotCards.forEach(s => s.forEach(c => ids.add(c.id)))
    bonusCards.forEach(c => ids.add(c.id))
    confirmedGroups.forEach(g => g.forEach(c => ids.add(c.id)))
    return ids
  }, [slotCards, bonusCards, confirmedGroups])

  const sortedHand = useMemo(() => {
    const available = hand.filter(c => !usedIds.has(c.id))
    return available.sort((a, b) => {
      if (sortMode === 'suit') {
        const s = (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4)
        if (s !== 0) return s
        return a.rank - b.rank
      }
      if (a.suit === 'joker' && b.suit === 'joker') return 0
      if (a.suit === 'joker') return 1
      if (b.suit === 'joker') return -1
      if (a.rank !== b.rank) return a.rank - b.rank
      return (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4)
    })
  }, [hand, usedIds, sortMode])

  const allSlotsValid = slotCards.every((cards, i) => validateSlot(cards, i, requirement))
  const bonusSlotValid = validateBonus(bonusCards, allowedBonusTypes)
  const isBonus = phase === 'bonus'

  // ── Card selection ───────────────────────────────────────────────────────
  function handleHandCardTap(card: CardType) {
    setSelectedHandCards(prev => {
      const idx = prev.findIndex(c => c.id === card.id)
      if (idx >= 0) return prev.filter(c => c.id !== card.id)
      return [...prev, card]
    })
  }

  function handleSlotTap(slotIdx: number) {
    if (selectedHandCards.length === 0) return
    setSlotCards(prev => {
      const next = prev.map(s => [...s])
      for (const card of selectedHandCards) {
        next[slotIdx] = [...next[slotIdx], card]
      }
      return next
    })
    setSelectedHandCards([])
  }

  function handleBonusSlotTap() {
    if (selectedHandCards.length === 0) return
    setBonusCards(prev => [...prev, ...selectedHandCards])
    setSelectedHandCards([])
  }

  function removeFromSlot(card: CardType, slotIdx: number, e: React.MouseEvent) {
    e.stopPropagation()
    setSlotCards(prev => {
      const next = prev.map(s => [...s])
      next[slotIdx] = next[slotIdx].filter(c => c.id !== card.id)
      return next
    })
    setSelectedHandCards([])
  }

  function removeFromBonus(card: CardType, e: React.MouseEvent) {
    e.stopPropagation()
    setBonusCards(prev => prev.filter(c => c.id !== card.id))
    setSelectedHandCards([])
  }

  function handleClearAllSlots() {
    setSlotCards(Array.from({ length: total }, () => []))
    setBonusCards([])
    setSelectedHandCards([])
  }

  // ── Slot border style (spec §4.2) ────────────────────────────────────────
  function slotStyle(slotIdx: number): React.CSSProperties {
    const cards = isBonus ? bonusCards : slotCards[slotIdx]
    const valid = isBonus ? bonusSlotValid : validateSlot(cards, slotIdx, requirement)
    if (valid) return { border: '2px solid #6aad7a', background: '#1a3a2a', borderRadius: 8 }
    if (selectedHandCards.length > 0) return { border: '2px solid #e2b858', background: '#1a3a2a', borderRadius: 8 }
    return { border: '2px dashed #2d5a3a', background: '#1a3a2a', borderRadius: 8 }
  }

  // Badge: "X / Y" when incomplete, "✓ Valid" when complete
  function slotBadge(slotIdx: number): { text: string; valid: boolean } | null {
    const cards = isBonus ? bonusCards : slotCards[slotIdx]
    if (cards.length === 0) return null
    const valid = isBonus ? bonusSlotValid : validateSlot(cards, slotIdx, requirement)
    if (valid) return { text: '✓ Valid', valid: true }
    const isSetSlot = !isBonus && slotIdx < requirement.sets
    return { text: `${cards.length} / ${isSetSlot ? '3' : '4'}+`, valid: false }
  }

  // ── Joker processing ─────────────────────────────────────────────────────
  function startJokerProcessing(
    groups: CardType[][],
    sourcePhase: 'slots' | 'bonus',
    positions: Map<string, number>,
    startIdx: number
  ) {
    for (let i = startIdx; i < groups.length; i++) {
      const group = groups[i]
      if (isValidRun(group) && !isValidSet(group) && group.some(c => c.suit === 'joker')) {
        const placement = getNextJokerOptions(group, positions)
        if (placement) {
          setPendingGroups(groups)
          setPendingJokerGroupIdx(i)
          setPendingGroup(group)
          setPendingPhaseAfterJoker(sourcePhase)
          setJokerPositions(positions)
          setPhase('joker-placement')
          return
        }
      }
    }
    resolveGroups(groups, sourcePhase, positions)
  }

  function resolveGroups(
    groups: CardType[][],
    sourcePhase: 'slots' | 'bonus',
    positions: Map<string, number>
  ) {
    setJokerPositions(positions)
    const usedIdsNow = new Set(groups.flatMap(g => g.map(c => c.id)))
    const remaining = hand.filter(c => !usedIdsNow.has(c.id))
    const canBonus = remaining.length > 0 && canFormAnyValidMeld(remaining, allowedBonusTypes)

    if (sourcePhase === 'slots') {
      if (canBonus) {
        setConfirmedGroups(groups)
        setPhase('bonus-prompt')
      } else {
        onConfirm(groups, positions)
      }
    } else {
      if (canBonus) {
        setConfirmedGroups(groups)
        setBonusCards([])
        setSelectedHandCards([])
        setPhase('bonus')
      } else {
        onConfirm(groups, positions)
      }
    }
  }

  function handleLayDown() {
    if (!allSlotsValid) return
    startJokerProcessing([...slotCards], 'slots', new Map(), 0)
  }

  function handleAddBonus() {
    if (!bonusSlotValid) return
    const allGroups = [...confirmedGroups, bonusCards]
    startJokerProcessing(allGroups, 'bonus', jokerPositions, confirmedGroups.length)
  }

  // ── Joker pick ───────────────────────────────────────────────────────────
  function handleJokerPick(jokerCardId: string, rank: number) {
    if (!pendingGroup) return
    const newPositions = new Map(jokerPositions)
    newPositions.set(jokerCardId, rank)

    // More ambiguous jokers in this same group?
    if (getNextJokerOptions(pendingGroup, newPositions)) {
      setJokerPositions(newPositions)
      return
    }

    // Advance to next group that needs joker placement
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

    // All jokers placed
    resolveGroups(pendingGroups, pendingPhaseAfterJoker ?? 'slots', newPositions)
  }

  function handleJokerBack() {
    setPendingGroup(null)
    setJokerPositions(new Map())
    if (pendingPhaseAfterJoker === 'bonus') {
      setBonusCards(pendingGroups[pendingGroups.length - 1] ?? [])
      setSelectedHandCards([])
      setPhase('bonus')
    } else {
      setSlotCards(pendingGroups.slice(0, total))
      setSelectedHandCards([])
      setPhase('slots')
    }
  }

  // ─── Joker placement screen ───────────────────────────────────────────────
  if (phase === 'joker-placement' && pendingGroup) {
    const placement = getNextJokerOptions(pendingGroup, jokerPositions)
    if (!placement) {
      resolveGroups(pendingGroups, pendingPhaseAfterJoker ?? 'slots', jokerPositions)
      return null
    }

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
      <ModalPanel onClose={onClose} locked={mustLayDown}>
        {mustLayDown && <MustLayDownBanner />}
        <Header
          title="Place Your Joker"
          subtitle={`${totalAmbiguous > 1 ? `Joker ${placedCount + 1} of ${totalAmbiguous} — ` : ''}Choose where it goes in your run`}
          onClose={onClose}
          locked={mustLayDown}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 10, color: '#6aad7a', margin: 0 }}>
            Tap the position. Choosing low lets you extend the run further later.
          </p>

          {placement.options.map(option => (
            <button
              key={option.rank}
              onClick={() => handleJokerPick(placement.joker.id, option.rank)}
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
          <button onClick={handleJokerBack} style={secondaryBtn}>Back</button>
        </div>
      </ModalPanel>
    )
  }

  // ─── Bonus prompt screen ──────────────────────────────────────────────────
  if (phase === 'bonus-prompt') {
    return (
      <ModalPanel onClose={onClose} locked={mustLayDown}>
        <Header
          title="Lay Down More?"
          subtitle={`Requirement met · ${confirmedGroups.length} meld${confirmedGroups.length !== 1 ? 's' : ''} confirmed`}
          onClose={onClose}
          locked={mustLayDown}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ background: '#1e4a2e', border: '1px solid #2d7a3a', borderRadius: 8, padding: '8px 10px' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#6aad7a', margin: '0 0 2px' }}>Requirement met! ✓</p>
            <p style={{ fontSize: 11, color: '#a8d0a8', margin: 0 }}>
              You can lay down additional melds ({bonusTypeLabel(allowedBonusTypes)}). Laying down more reduces your hand score.
            </p>
          </div>

          {confirmedGroups.map((group, i) => (
            <div key={i} style={{ opacity: 0.5 }}>
              <p style={{ fontSize: 10, color: '#6aad7a', margin: '0 0 4px' }}>Meld {i + 1} (confirmed)</p>
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
                {group.map(card => <CardComponent key={card.id} card={card} compact />)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid #1e4a2e', flexShrink: 0, display: 'flex', gap: 8 }}>
          <button onClick={() => onConfirm(confirmedGroups, jokerPositions)} style={secondaryBtn}>
            No, I'm done
          </button>
          <button
            onClick={() => { setBonusCards([]); setSelectedHandCards([]); setPhase('bonus') }}
            style={primaryBtn(true)}
          >
            Yes, lay down more
          </button>
        </div>
      </ModalPanel>
    )
  }

  // ─── Slots screen (required & bonus) — spec §4.2 ─────────────────────────
  const slotCount = isBonus ? 1 : total

  // Determine if any slots have cards (for showing Clear All)
  const hasAnySlotCards = isBonus
    ? bonusCards.length > 0
    : slotCards.some(s => s.length > 0)

  return (
    <ModalPanel onClose={onClose} locked={mustLayDown}>
      {mustLayDown && <MustLayDownBanner />}
      <Header
        title={isBonus ? 'Extra Meld' : 'Lay Down Your Hand'}
        onClose={onClose}
        locked={mustLayDown}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Confirmed groups (bonus phase only — dimmed) */}
        {isBonus && confirmedGroups.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {confirmedGroups.map((group, i) => (
              <div key={i} style={{ opacity: 0.35, flexShrink: 0 }}>
                <p style={{ fontSize: 9, color: '#6aad7a', margin: '0 0 3px', whiteSpace: 'nowrap' }}>
                  {i < total ? `Meld ${i + 1}` : `Extra ${i - total + 1}`}
                </p>
                <div style={{ display: 'flex', gap: 2 }}>
                  {group.map(card => <CardComponent key={card.id} card={card} compact />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Meld slots — side by side (spec §4.2 Option 3) ────────────── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {Array.from({ length: slotCount }).map((_, slotIdx) => {
            const cards = isBonus ? bonusCards : slotCards[slotIdx]
            const label = isBonus
              ? `Extra (${bonusTypeLabel(allowedBonusTypes)})`
              : slotLabel(slotIdx, requirement)
            const badge = slotBadge(slotIdx)

            return (
              <div
                key={slotIdx}
                style={{ flex: 1, minWidth: 0 }}
                onClick={() => isBonus ? handleBonusSlotTap() : handleSlotTap(slotIdx)}
              >
                {/* Slot label */}
                <p style={{
                  fontSize: 9, color: '#6aad7a', fontWeight: 600, margin: '0 0 4px',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {label}
                </p>

                {/* Slot box */}
                <div
                  style={{
                    ...slotStyle(slotIdx),
                    minHeight: 60,
                    padding: '6px 6px 4px',
                    cursor: selectedHandCards.length > 0 ? 'pointer' : 'default',
                    transition: 'border-color 0.12s',
                    position: 'relative',
                  }}
                >
                  {/* Badge */}
                  {badge && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      background: badge.valid ? '#6aad7a' : '#1e4a2e',
                      color: badge.valid ? '#0f2218' : '#3a5a3a',
                      fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 5px',
                    }}>
                      {badge.text}
                    </div>
                  )}

                  {cards.length === 0 ? (
                    <p style={{
                      fontSize: 10, margin: '10px 4px',
                      color: selectedHandCards.length > 0 ? '#e2b858' : '#2d5a3a',
                      textAlign: 'center', fontStyle: 'italic',
                    }}>
                      {selectedHandCards.length > 0 ? 'Tap to place' : 'Empty'}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {cards.map(card => (
                        <div
                          key={card.id}
                          onClick={(e) => isBonus ? removeFromBonus(card, e) : removeFromSlot(card, slotIdx, e)}
                        >
                          <CardComponent card={card} compact />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Instruction */}
        <p style={{ fontSize: 10, color: '#6aad7a', margin: 0 }}>
          {selectedHandCards.length > 0
            ? 'Tap a slot to place selected cards'
            : 'Tap cards below to select, then tap a slot. Tap a placed card to remove it.'}
        </p>

        {/* Sort toggle (spec §4.3) */}
        <SortToggle sortMode={sortMode} onSortChange={onSortChange} />

        {/* Selection bar */}
        <div style={{
          border: selectedHandCards.length > 0 ? '1.5px solid #e2b858' : '1.5px solid #2d5a3a',
          borderRadius: 6,
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: selectedHandCards.length > 0 ? 1 : 0.5,
          background: '#0f2218',
          minHeight: 32,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedHandCards.length === 0 ? (
              <p style={{ color: '#6aad7a', fontSize: 9, margin: 0, fontStyle: 'italic' }}>
                No cards selected
              </p>
            ) : (
              <>
                <p style={{
                  color: '#e2b858', fontSize: 10, margin: '0 0 1px', fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {selectedHandCards.map(c =>
                    c.suit === 'joker' ? 'JKR' : `${rankLabel(c.rank)}${suitSymbol(c.suit)}`
                  ).join(', ')}
                </p>
                <p style={{ color: '#a8d0a8', fontSize: 9, margin: 0 }}>
                  {selectedHandCards.length} card{selectedHandCards.length !== 1 ? 's' : ''} — tap a slot to place
                </p>
              </>
            )}
          </div>
          {selectedHandCards.length > 0 && (
            <button
              onClick={() => setSelectedHandCards([])}
              style={{
                background: 'transparent',
                border: '1px solid #3a5a3a',
                borderRadius: 4,
                color: '#6aad7a',
                fontSize: 9,
                fontWeight: 600,
                padding: '3px 8px',
                cursor: 'pointer',
                flexShrink: 0,
                marginLeft: 8,
                minHeight: 24,
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Hand cards */}
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
          {sortedHand.map(card => {
            const selIdx = selectedHandCards.findIndex(c => c.id === card.id)
            return (
              <div
                key={card.id}
                onClick={() => handleHandCardTap(card)}
                style={{ flexShrink: 0, position: 'relative' }}
              >
                <CardComponent
                  card={card}
                  compact
                  selected={selIdx >= 0}
                />
                {selIdx >= 0 && (
                  <div style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    background: '#e2b858',
                    color: '#2c1810',
                    fontSize: 7,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}>
                    {selIdx + 1}
                  </div>
                )}
              </div>
            )
          })}
          {sortedHand.length === 0 && (
            <p style={{ fontSize: 11, color: '#2d5a3a', fontStyle: 'italic' }}>All cards placed</p>
          )}
        </div>
      </div>

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 12px 12px', borderTop: '1px solid #1e4a2e', flexShrink: 0, display: 'flex', gap: 8 }}>
        {isBonus ? (
          <>
            <button onClick={() => onConfirm(confirmedGroups, jokerPositions)} style={secondaryBtn}>
              Done
            </button>
            {hasAnySlotCards && (
              <button onClick={handleClearAllSlots} style={secondaryBtn}>
                Clear
              </button>
            )}
            <button onClick={handleAddBonus} disabled={!bonusSlotValid} style={primaryBtn(bonusSlotValid)}>
              Add Meld
            </button>
          </>
        ) : (
          <>
            {!mustLayDown && (
              <button onClick={onClose} style={secondaryBtn}>Cancel</button>
            )}
            {hasAnySlotCards && (
              <button onClick={handleClearAllSlots} style={secondaryBtn}>
                Clear
              </button>
            )}
            <button onClick={handleLayDown} disabled={!allSlotsValid} style={primaryBtn(allSlotsValid)}>
              Lay Down
            </button>
          </>
        )}
      </div>
    </ModalPanel>
  )
}
