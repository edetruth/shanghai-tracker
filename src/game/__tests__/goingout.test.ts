import { describe, it, expect } from 'vitest'
import { canLayOff } from '../meld-validator'
import { aiFindLayOff } from '../ai'
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
})
