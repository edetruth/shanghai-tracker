import { describe, it, expect } from 'vitest'
import { canLayOff, simulateLayOff } from '../meld-validator'
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
