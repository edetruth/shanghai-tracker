import { describe, it, expect } from 'vitest'
import { canLayOff, simulateLayOff } from '../meld-validator'
import { c, joker, makeMeld } from './helpers'

describe('canLayOff — sets', () => {
  it('allows natural card of same rank on a set', () => {
    const meld = makeMeld([c('hearts', 7), c('diamonds', 7), c('clubs', 7)], 'set')
    expect(canLayOff(c('spades', 7), meld)).toBe(true)
  })

  it('rejects card of different rank on a set', () => {
    const meld = makeMeld([c('hearts', 7), c('diamonds', 7), c('clubs', 7)], 'set')
    expect(canLayOff(c('spades', 8), meld)).toBe(false)
  })

  it('allows joker on any set', () => {
    const meld = makeMeld([c('hearts', 7), c('diamonds', 7), c('clubs', 7)], 'set')
    expect(canLayOff(joker(), meld)).toBe(true)
  })
})

describe('canLayOff — runs (low/high extension)', () => {
  // Run: 5-6-7-8 of hearts (min=5, max=8)
  const runCards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]

  it('allows card at low end (rank = min-1)', () => {
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('hearts', 4), meld)).toBe(true)
  })

  it('allows card at high end (rank = max+1)', () => {
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('hearts', 9), meld)).toBe(true)
  })

  it('rejects card of wrong suit', () => {
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('spades', 4), meld)).toBe(false)
  })

  it('rejects card in the middle of existing run', () => {
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('hearts', 6), meld)).toBe(false)
  })

  it('rejects card 2 away from either end', () => {
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('hearts', 3), meld)).toBe(false)
    expect(canLayOff(c('hearts', 10), meld)).toBe(false)
  })

  it('allows joker on any run', () => {
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(joker(), meld)).toBe(true)
  })
})

describe('canLayOff — ace extension', () => {
  it('allows ace at high end of K-high run (K-A extension)', () => {
    const runCards = [c('hearts', 10), c('hearts', 11), c('hearts', 12), c('hearts', 13)]
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('hearts', 1), meld)).toBe(true)
  })

  it('allows ace at low end of ace-low run (already ace-low)', () => {
    // A-2-3-4 run, ace is at min=1; 5 goes at high end
    const runCards = [c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)]
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(c('hearts', 5), meld)).toBe(true)
  })
})

describe('canLayOff — chain scenario', () => {
  it('after laying off on a run, simulateLayOff result accepts next card', () => {
    // 5-6-7-8 run; lay off 4♥ → run becomes 4-5-6-7-8; then 3♥ should be valid
    const runCards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    const meld = makeMeld(runCards, 'run')

    const updatedMeld = simulateLayOff(c('hearts', 4), meld)
    expect(updatedMeld.runMin).toBe(4)
    expect(canLayOff(c('hearts', 3), updatedMeld)).toBe(true)
    expect(canLayOff(c('hearts', 9), updatedMeld)).toBe(true)
  })

  it('laying off joker (default high) extends runMax by 1 via simulateLayOff', () => {
    const runCards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    const meld = makeMeld(runCards, 'run')
    const updatedMeld = simulateLayOff(joker(), meld)
    expect(updatedMeld.runMax).toBe(9)
    expect(canLayOff(c('hearts', 10), updatedMeld)).toBe(true)
  })
})

describe('canLayOff — joker bounds', () => {
  it('joker CANNOT lay off on a full-range run (runMin=1, runMax=14)', () => {
    // Build a run A-2-3-...-K-A (conceptually full range); simulate runMin=1, runMax=14
    const runCards = [c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)]
    const meld = makeMeld(runCards, 'run')
    // Manually set bounds to simulate full-range
    const fullMeld = { ...meld, runMin: 1, runMax: 14 }
    expect(canLayOff(joker(), fullMeld)).toBe(false)
  })

  it('joker CAN lay off on run 2-3-4-5 (room below at rank 1)', () => {
    const runCards = [c('hearts', 2), c('hearts', 3), c('hearts', 4), c('hearts', 5)]
    const meld = makeMeld(runCards, 'run')
    expect(canLayOff(joker(), meld)).toBe(true)
  })

  it('joker CAN lay off on run J-Q-K (room above up to 14)', () => {
    const runCards = [c('hearts', 11), c('hearts', 12), c('hearts', 13)]
    const meld = makeMeld([...runCards, c('hearts', 10)], 'run') // 10-J-Q-K
    expect(canLayOff(joker(), meld)).toBe(true)
  })

  it('simulateLayOff with joker on full-range run (1-14) returns meld unchanged', () => {
    const runCards = [c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)]
    const meld = makeMeld(runCards, 'run')
    const fullMeld = { ...meld, runMin: 1, runMax: 14 }
    const result = simulateLayOff(joker(), fullMeld, 'low')
    expect(result.runMin).toBe(1)
    expect(result.runMax).toBe(14)
  })

  it('simulateLayOff with joker on run 1-13 at high end → runMax=14', () => {
    const runCards = [c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)]
    const meld = makeMeld(runCards, 'run')
    const almostFullMeld = { ...meld, runMin: 1, runMax: 13 }
    const result = simulateLayOff(joker(), almostFullMeld, 'high')
    expect(result.runMax).toBe(14)
  })

  it('simulateLayOff with joker going below rank 1 returns meld unchanged', () => {
    const runCards = [c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)]
    const meld = makeMeld(runCards, 'run')
    const aceLowMeld = { ...meld, runMin: 1, runMax: 4 }
    const result = simulateLayOff(joker(), aceLowMeld, 'low')
    expect(result.runMin).toBe(1) // unchanged, can't go below 1
  })
})

describe('canLayOff — chain scenario (continued)', () => {
  it('chain lay-off into run with joker at high end — hand [3♥, 4♥] on run 5♥-8♥-JKR(9♥)', () => {
    // Run: 5♥-6♥-7♥-8♥-JKR(9♥), runMin=5, runMax=9
    const jkr = joker('jkr-chain')
    const meld = makeMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), jkr],
      'run'
    )
    // Step 1: 4♥ can lay off at low end (min=5, 4=min-1)
    expect(canLayOff(c('hearts', 4), meld)).toBe(true)

    // Step 2: use simulateLayOff to get updated bounds — runMin becomes 4
    const afterFirst = simulateLayOff(c('hearts', 4), meld)
    expect(afterFirst.runMin).toBe(4)
    // 3♥ must now be valid (3 === 4-1)
    expect(canLayOff(c('hearts', 3), afterFirst)).toBe(true)
  })
})
