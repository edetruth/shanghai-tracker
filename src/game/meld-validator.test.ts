import { describe, it, expect } from 'vitest'
import { canGoOutViaChainLayOff } from './meld-validator'
import { c, joker, makeMeld } from './__tests__/helpers'

// Tests for canGoOutViaChainLayOff — the recursive chain lay-off feasibility check.
// Each scenario matches a "Bug 3A" test case from the task specification.

describe('canGoOutViaChainLayOff', () => {
  // Test 1: Sequential low-end chain
  // Hand: [3♥, 4♥]  Run: 5♥-6♥-7♥-8♥-JKR(9♥)
  // Step: lay off 4♥ (low end, 4 = 5-1) → run becomes 4-9
  //       lay off 3♥ (low end, 3 = 4-1) → run becomes 3-9 → hand empty
  it('Test 1: sequential low-end chain [3♥, 4♥] on run 5♥-8♥-JKR(9♥) — allowed', () => {
    const jkr = joker('jkr-t1')
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), jkr],
      'run'
    )
    const hand = [c('hearts', 3), c('hearts', 4)]
    expect(canGoOutViaChainLayOff(hand, [meld])).toBe(true)
  })

  // Test 2: Sequential high-end chain
  // Hand: [Q♠, K♠]  Run: 8♠-9♠-10♠-J♠
  // Step: lay off Q♠ after J♠ (12 = 11+1) → run becomes 8-12
  //       lay off K♠ after Q♠ (13 = 12+1) → run becomes 8-13 → hand empty
  it('Test 2: sequential high-end chain [Q♠, K♠] on run 8♠-9♠-10♠-J♠ — allowed', () => {
    const meld = makeMeld(
      [c('spades', 8), c('spades', 9), c('spades', 10), c('spades', 11)],
      'run'
    )
    const hand = [c('spades', 12), c('spades', 13)]
    expect(canGoOutViaChainLayOff(hand, [meld])).toBe(true)
  })

  // Test 3: Chain across different melds
  // Hand: [7♦, K♣]  Run: 4♦-5♦-6♦  Set: K♥-K♠-K♦
  // Lay off 7♦ on run (7 = 6+1), lay off K♣ on set (same rank)
  it('Test 3: cross-meld chain [7♦, K♣] on run 4♦-5♦-6♦ and set K♥-K♠-K♦ — allowed', () => {
    const runMeld = makeMeld(
      [c('diamonds', 4), c('diamonds', 5), c('diamonds', 6)],
      'run'
    )
    const setMeld = makeMeld(
      [c('hearts', 13), c('spades', 13), c('diamonds', 13)],
      'set'
    )
    const hand = [c('diamonds', 7), c('clubs', 13)]
    expect(canGoOutViaChainLayOff(hand, [runMeld, setMeld])).toBe(true)
  })

  // Test 4: Joker chain (from Round 3)
  // Hand: [JKR, 7♦]  Run: A♦-2♦-3♦-4♦-5♦
  // Lay off JKR as 6♦ (high end) → run becomes A♦-...-5♦-JKR(6♦), max=6
  // Lay off 7♦ after JKR (7 = 6+1) → run becomes A♦-...-7♦ → hand empty
  it('Test 4: joker chain [JKR, 7♦] on run A♦-2♦-3♦-4♦-5♦ — allowed', () => {
    const meld = makeMeld(
      [c('diamonds', 1), c('diamonds', 2), c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)],
      'run'
    )
    const hand = [joker('jkr-t4'), c('diamonds', 7)]
    expect(canGoOutViaChainLayOff(hand, [meld])).toBe(true)
  })

  // Negative: cards cannot go out — no valid chain exists
  it('returns false when no card can be laid off anywhere', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    // 2♥ is 3 away from min; K♠ is wrong suit — neither fits
    const hand = [c('hearts', 2), c('spades', 13)]
    expect(canGoOutViaChainLayOff(hand, [meld])).toBe(false)
  })

  // Negative: first card fits but second is stuck after it
  it('returns false when first lay-off leaves a card with no valid target', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    // 9♥ can be laid off, but K♠ cannot go anywhere after that
    const hand = [c('hearts', 9), c('spades', 13)]
    expect(canGoOutViaChainLayOff(hand, [meld])).toBe(false)
  })

  // Single card going out
  it('single card that fits is a valid going-out chain', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    expect(canGoOutViaChainLayOff([c('hearts', 9)], [meld])).toBe(true)
  })

  // Empty hand is trivially true
  it('empty hand returns true (nothing to lay off)', () => {
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run'
    )
    expect(canGoOutViaChainLayOff([], [meld])).toBe(true)
  })
})
