import { describe, it, expect } from 'vitest'
import { canLayOff, simulateLayOff, evaluateLayOffReversal, isLegalDiscard } from '../meld-validator'
import { aiFindLayOff, aiChooseJokerLayOffPosition } from '../ai'
import { c, joker, makeMeld } from './helpers'

describe('Going out rules', () => {
  it('player can go out by laying off last card', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const lastCard = c('hearts', 9)
    expect(canLayOff(lastCard, meld)).toBe(true)
  })

  it('player cannot go out with a card that has no valid lay-off target', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const lastCard = c('spades', 2) // wrong suit, can't extend this run
    expect(canLayOff(lastCard, meld)).toBe(false)
  })
})

describe('aiFindLayOff — stuck-state prevention', () => {
  it('returns a valid lay-off when remaining card can still be discarded (3+ card hand)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    // 3 cards: lay off 9♥, still have 2 cards left → can discard one
    const hand = [c('hearts', 9), c('spades', 2), c('clubs', 3)]
    const result = aiFindLayOff(hand, [meld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(9)
  })

  it('skips lay-off that would leave 1 card with no valid lay-off target (stuck-state)', () => {
    // Hand: 9♥ (can lay off) + K♠ (can't be played anywhere)
    // Laying off 9♥ leaves K♠ with no lay-off target — and can't discard last card to go out
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 9), c('spades', 13)]
    const result = aiFindLayOff(hand, [meld])
    expect(result).toBeNull()
  })

  it('allows lay-off when remaining card CAN also be played', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    // Both cards can be laid off: 9♥ and 4♥
    const hand = [c('hearts', 9), c('hearts', 4)]
    const result = aiFindLayOff(hand, [meld])
    expect(result).not.toBeNull()
  })

  it('allows lay-off when remaining card can go on a different meld', () => {
    const runMeld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const setMeld = makeMeld([c('hearts', 9), c('diamonds', 9), c('clubs', 9)], 'set')
    const hand = [c('hearts', 9), c('spades', 9)]
    // Lay off hearts 9 on run (extends to 5-6-7-8-9), leaves spades 9 which can go on setMeld
    const result = aiFindLayOff(hand, [runMeld, setMeld])
    expect(result).not.toBeNull()
  })

  it('chain lay-off: [3♥, 4♥] on run 5♥-8♥-JKR(9♥) — 4♥ lay-off must NOT be blocked', () => {
    // The key chain bug: lay off 4♥ makes run 4-9, then 3♥ fits at min-1=3.
    // aiFindLayOff must simulate the updated run bounds before deciding to skip.
    const jkr = joker('jkr-chain')
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), jkr],
      'run'
    )
    const hand = [c('hearts', 3), c('hearts', 4)]
    const result = aiFindLayOff(hand, [meld])
    // Should allow 4♥ (laying off 4♥ makes run 4-9; then 3♥ fits at 3=4-1)
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(4)
  })

  it('returns last-card lay-off (going out) — not blocked', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 9)]
    const result = aiFindLayOff(hand, [meld])
    // 1 card, valid lay-off — going out, should be allowed
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(9)
  })

  it('joker lay-off includes jokerPosition in result', () => {
    const jkr = joker('jkr-layoff')
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [jkr]
    const result = aiFindLayOff(hand, [meld])
    expect(result).not.toBeNull()
    expect(result?.jokerPosition).toBeDefined()
    expect(['low', 'high']).toContain(result?.jokerPosition)
  })
})

describe('aiChooseJokerLayOffPosition', () => {
  it('prefers high end when run starts at 1 (more room above)', () => {
    const meld = makeMeld([c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)], 'run')
    // runMin=1 → roomBelow=0; runMax=4 → roomAbove=10; prefer high
    expect(aiChooseJokerLayOffPosition(meld)).toBe('high')
  })

  it('prefers low end when run ends at 14/K (more room below)', () => {
    const meld = makeMeld([c('hearts', 10), c('hearts', 11), c('hearts', 12), c('hearts', 13)], 'run')
    // runMin=10 → roomBelow=9; runMax=13 → roomAbove=1; prefer low
    expect(aiChooseJokerLayOffPosition(meld)).toBe('low')
  })

  it('prefers low end when room is equal (tie goes to low)', () => {
    // 6-7-8-9: runMin=6 → roomBelow=5; runMax=9 → roomAbove=5; equal → low (>= bias)
    const meld = makeMeld([c('hearts', 6), c('hearts', 7), c('hearts', 8), c('hearts', 9)], 'run')
    expect(aiChooseJokerLayOffPosition(meld)).toBe('low')
  })
})

describe('aiFindLayOff — going-out sequences', () => {
  // ── 3-step chain: [2♥, 3♥, 4♥] onto run 5♥-8♥ ──────────────────────────
  it('3-step chain step 1: [2♥, 3♥, 4♥] → returns 4♥ (only valid first card)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 2), c('hearts', 3), c('hearts', 4)]
    // 4♥ is the only card that fits now (min-1=4); 2♥ and 3♥ cannot go yet
    const result = aiFindLayOff(hand, [meld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(4)
  })

  it('3-step chain step 2: [2♥, 3♥] on run 4♥-8♥ → returns 3♥', () => {
    // After 4♥ was laid off, run is now 4-8
    const meld = makeMeld([c('hearts', 4), c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 2), c('hearts', 3)]
    // 3♥ fits at min-1=3; laying it off leaves 2♥ which fits at new min-1=2
    const result = aiFindLayOff(hand, [meld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(3)
  })

  it('3-step chain step 3: [2♥] on run 3♥-8♥ → returns 2♥ (going out)', () => {
    const meld = makeMeld([c('hearts', 3), c('hearts', 4), c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 2)]
    const result = aiFindLayOff(hand, [meld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(2)
  })

  it('wrong start card blocked: [3♥] alone on run 5♥-8♥ → null (3 ≠ min-1=4)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 3)]
    expect(aiFindLayOff(hand, [meld])).toBeNull()
  })

  // ── Cross-meld go-out ─────────────────────────────────────────────────────
  it('cross-meld: [4♥, J♠] — 4♥ on run, J♠ on set → both valid, returns 4♥', () => {
    const runMeld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const setMeld = makeMeld([c('hearts', 11), c('diamonds', 11), c('clubs', 11)], 'set')
    const hand = [c('hearts', 4), c('spades', 11)]
    // Laying off 4♥ leaves J♠ which can go on setMeld → allowed
    const result = aiFindLayOff(hand, [runMeld, setMeld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(4)
  })

  it('cross-meld blocked: [4♥, K♠] — K♠ has no valid target → null', () => {
    // After laying off 4♥, K♠ has nowhere to go → stuck-state → blocked
    const runMeld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 4), c('spades', 13)]
    expect(aiFindLayOff(hand, [runMeld])).toBeNull()
  })

  // ── Going out onto a set ──────────────────────────────────────────────────
  it('goes out by laying off last card onto a set', () => {
    const setMeld = makeMeld([c('hearts', 11), c('diamonds', 11), c('clubs', 11)], 'set')
    const hand = [c('spades', 11)]
    const result = aiFindLayOff(hand, [setMeld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(11)
    expect(result?.card.suit).toBe('spades')
  })

  // ── Joker going out ───────────────────────────────────────────────────────
  it('joker as last card goes out on a run (returns jokerPosition)', () => {
    const runMeld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [joker('jkr-last')]
    const result = aiFindLayOff(hand, [runMeld])
    expect(result).not.toBeNull()
    expect(result?.jokerPosition).toBeDefined()
  })

  // ── Stuck-state: neither card can start the chain ────────────────────────
  it('neither card fits run — returns null (both stuck)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    // 2♥ is 3 away from min; K♠ is wrong suit
    const hand = [c('hearts', 2), c('spades', 13)]
    expect(aiFindLayOff(hand, [meld])).toBeNull()
  })
})

describe('evaluateLayOffReversal — GDD Section 6.3 Scenario C', () => {
  // ── Safe cases → outcome: 'allowed' ──────────────────────────────────────

  it('allowed: hand has 3+ cards after lay-off (player can still discard)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const card9 = c('hearts', 9)
    const hand = [card9, c('spades', 3), c('clubs', 7)]
    const result = evaluateLayOffReversal(card9, meld, hand, [meld])
    expect(result.outcome).toBe('allowed')
    expect(result.discardCard).toBeUndefined()
  })

  it('allowed: lay-off empties the hand (player goes out)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const lastCard = c('hearts', 9)
    const hand = [lastCard]
    const result = evaluateLayOffReversal(lastCard, meld, hand, [meld])
    expect(result.outcome).toBe('allowed')
  })

  it('allowed: 2-card hand where remaining card can be laid off on the same run (chain)', () => {
    // Lay off 4♥ onto 5♥-8♥ → run becomes 4♥-8♥; remaining 3♥ fits at new min-1=3
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const card4 = c('hearts', 4)
    const hand = [card4, c('hearts', 3)]
    const result = evaluateLayOffReversal(card4, meld, hand, [meld])
    expect(result.outcome).toBe('allowed')
  })

  it('allowed: 2-card hand where remaining card fits a different meld on the table', () => {
    const runMeld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const setMeld = makeMeld([c('hearts', 11), c('diamonds', 11), c('clubs', 11)], 'set')
    const card9 = c('hearts', 9)
    const hand = [card9, c('spades', 11)]
    // Lay off 9♥ on run; remaining J♠ can go on the set
    const result = evaluateLayOffReversal(card9, runMeld, hand, [runMeld, setMeld])
    expect(result.outcome).toBe('allowed')
  })

  it('allowed: remaining card is a joker (joker can always lay off on any meld)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const card9 = c('hearts', 9)
    const jkr = joker('jkr-rem')
    const hand = [card9, jkr]
    const result = evaluateLayOffReversal(card9, meld, hand, [meld])
    expect(result.outcome).toBe('allowed')
  })

  // ── Scenario C cases → outcome: 'reversed' ───────────────────────────────

  it('reversed: lay-off leaves 1 card with no valid target anywhere (Scenario C)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const card9 = c('hearts', 9)
    const stuck = c('spades', 13)
    const hand = [card9, stuck]
    const result = evaluateLayOffReversal(card9, meld, hand, [meld])
    expect(result.outcome).toBe('reversed')
    expect(result.discardCard?.id).toBe(stuck.id)
  })

  it('reversed: remaining card wrong suit for any run meld', () => {
    const meld = makeMeld([c('diamonds', 3), c('diamonds', 4), c('diamonds', 5), c('diamonds', 6)], 'run')
    const card7 = c('diamonds', 7)
    const stuck = c('clubs', 11)
    const hand = [card7, stuck]
    const result = evaluateLayOffReversal(card7, meld, hand, [meld])
    expect(result.outcome).toBe('reversed')
    expect(result.discardCard?.id).toBe(stuck.id)
  })

  it('reversed: remaining card cannot extend run at either end AND wrong rank for set', () => {
    const runMeld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const setMeld = makeMeld([c('hearts', 3), c('diamonds', 3), c('clubs', 3)], 'set')
    const card9h = c('hearts', 9)
    // Laying off hearts 9 extends run to 5-9; remaining spades 9 — suit mismatch for run, rank mismatch for set
    const stuck = c('spades', 9)
    const hand = [card9h, stuck]
    const result = evaluateLayOffReversal(card9h, runMeld, hand, [runMeld, setMeld])
    expect(result.outcome).toBe('reversed')
    expect(result.discardCard?.id).toBe(stuck.id)
  })

  it('reversed: remaining card rank too far from run ends (not adjacent)', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const card9 = c('hearts', 9)
    const stuck = c('hearts', 2) // 2 is 2 away from new min=4 after lay-off, not adjacent
    const hand = [card9, stuck]
    const result = evaluateLayOffReversal(card9, meld, hand, [meld])
    expect(result.outcome).toBe('reversed')
    expect(result.discardCard?.id).toBe(stuck.id)
  })

  // ── Post-lay-off bounds are used (not pre-lay-off) ───────────────────────

  it('uses post-lay-off meld bounds: laying off on set does not change what set accepts', () => {
    const setMeld = makeMeld([c('hearts', 7), c('diamonds', 7), c('clubs', 7)], 'set')
    // Lay off spades 7 on set; remaining hearts 8 — rank 8 ≠ 7 (set rank), so reversed
    const card7s = c('spades', 7)
    const stuck = c('hearts', 8)
    const hand = [card7s, stuck]
    const result = evaluateLayOffReversal(card7s, setMeld, hand, [setMeld])
    expect(result.outcome).toBe('reversed')
    expect(result.discardCard?.id).toBe(stuck.id)
  })
})

describe('simulateLayOff — jokerPosition param', () => {
  it('extends runMin when jokerPosition=low', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    const updated = simulateLayOff(joker(), meld, 'low')
    expect(updated.runMin).toBe(4)
    expect(updated.runMax).toBe(8)
  })

  it('extends runMax when jokerPosition=high', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    const updated = simulateLayOff(joker(), meld, 'high')
    expect(updated.runMin).toBe(5)
    expect(updated.runMax).toBe(9)
  })

  it('defaults to high when jokerPosition omitted', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    const updated = simulateLayOff(joker(), meld)
    expect(updated.runMax).toBe(9)
  })
})

// ── GDD Section 6.3 — isLegalDiscard ─────────────────────────────────────────
// "A player can NEVER go out by discarding their last card."

describe('isLegalDiscard — GDD Section 6.3 (cannot go out by discarding)', () => {
  it('returns true when discard leaves at least 1 card in hand', () => {
    const hand = [c('hearts', 5), c('spades', 3)]
    expect(isLegalDiscard(hand, hand[0].id)).toBe(true)
  })

  it('returns false when discarding the ONLY card in hand (last-card rule)', () => {
    const lastCard = c('hearts', 9)
    expect(isLegalDiscard([lastCard], lastCard.id)).toBe(false)
  })

  it('returns true when hand has 3 cards and middle card is discarded', () => {
    const hand = [c('hearts', 5), c('diamonds', 7), c('clubs', 9)]
    expect(isLegalDiscard(hand, hand[1].id)).toBe(true)
  })

  it('returns false for a 1-card hand regardless of which player discards it', () => {
    // Even if the player has laid down melds, discarding the last card is illegal
    const lastCard = c('spades', 13)
    expect(isLegalDiscard([lastCard], lastCard.id)).toBe(false)
  })

  it('returns true when a joker is discarded but other cards remain', () => {
    const jkr = joker('jkr-discard')
    const hand = [jkr, c('clubs', 2)]
    expect(isLegalDiscard(hand, jkr.id)).toBe(true)
  })

  it('returns false when the last card is a joker (joker in last position is still illegal to discard)', () => {
    const jkr = joker('jkr-last')
    expect(isLegalDiscard([jkr], jkr.id)).toBe(false)
  })
})
