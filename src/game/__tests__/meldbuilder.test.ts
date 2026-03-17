import { describe, it, expect } from 'vitest'
import { buildMeld, canLayOff, getRunBounds, getNextJokerOptions, simulateLayOff } from '../meld-validator'
import { c, joker } from './helpers'

describe('buildMeld — sets', () => {
  it('builds a natural set with correct type and cards', () => {
    const cards = [c('hearts', 7), c('diamonds', 7), c('clubs', 7)]
    const meld = buildMeld(cards, 'set', 'p0', 'Alice', 'meld-1')
    expect(meld.type).toBe('set')
    expect(meld.cards).toHaveLength(3)
    expect(meld.jokerMappings).toHaveLength(0)
  })

  it('builds a joker set with correct joker mapping', () => {
    const jkr = joker('jkr-0')
    const cards = [c('hearts', 5, 'h5'), c('diamonds', 5, 'd5'), jkr]
    const meld = buildMeld(cards, 'set', 'p0', 'Alice', 'meld-2')
    expect(meld.jokerMappings).toHaveLength(1)
    expect(meld.jokerMappings[0].cardId).toBe(jkr.id)
    expect(meld.jokerMappings[0].representsRank).toBe(5)
  })
})

describe('buildMeld — runs', () => {
  it('builds a natural run with correct bounds', () => {
    const cards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    const meld = buildMeld(cards, 'run', 'p0', 'Alice', 'meld-3')
    expect(meld.runMin).toBe(5)
    expect(meld.runMax).toBe(8)
    expect(meld.runSuit).toBe('hearts')
    expect(meld.jokerMappings).toHaveLength(0)
  })

  it('orders run cards in sequence', () => {
    // Input out of order
    const cards = [c('hearts', 8), c('hearts', 6), c('hearts', 5), c('hearts', 7)]
    const meld = buildMeld(cards, 'run', 'p0', 'Alice', 'meld-4')
    const ranks = meld.cards.map(c => c.rank)
    expect(ranks).toEqual([5, 6, 7, 8])
  })

  it('places joker in correct position in sequence', () => {
    const jkr = joker('jkr-fill')
    // 5-joker-7-8 → joker should be at position for rank 6
    const cards = [c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)]
    const meld = buildMeld(cards, 'run', 'p0', 'Alice', 'meld-5')
    expect(meld.jokerMappings[0].representsRank).toBe(6)
    expect(meld.jokerMappings[0].representsSuit).toBe('hearts')
    // Joker should be at index 1 in ordered cards
    expect(meld.cards[1].suit).toBe('joker')
  })

  it('builds ace-high run with correct bounds', () => {
    const cards = [c('spades', 11), c('spades', 12), c('spades', 13), c('spades', 1)]
    const meld = buildMeld(cards, 'run', 'p0', 'Alice', 'meld-6')
    expect(meld.runAceHigh).toBe(true)
    expect(meld.runMax).toBe(14)
    expect(meld.runMin).toBe(11)
  })

  it('builds ace-low run with correct bounds', () => {
    const cards = [c('clubs', 1), c('clubs', 2), c('clubs', 3), c('clubs', 4)]
    const meld = buildMeld(cards, 'run', 'p0', 'Alice', 'meld-7')
    expect(meld.runAceHigh).toBe(false)
    expect(meld.runMin).toBe(1)
    expect(meld.runMax).toBe(4)
  })

  it('respects explicit joker positions', () => {
    const jkr = joker('jkr-explicit')
    const cards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), jkr]
    const positions = new Map([[jkr.id, 4]]) // joker at low end (rank 4)
    const meld = buildMeld(cards, 'run', 'p0', 'Alice', 'meld-8', positions)
    const jkrMapping = meld.jokerMappings.find(m => m.cardId === jkr.id)
    expect(jkrMapping?.representsRank).toBe(4)
  })
})

describe('getRunBounds', () => {
  it('returns correct bounds from a run meld', () => {
    const meld = buildMeld(
      [c('hearts', 3), c('hearts', 4), c('hearts', 5), c('hearts', 6)],
      'run', 'p0', 'Test', 'meld-bounds'
    )
    const bounds = getRunBounds(meld)
    expect(bounds.min).toBe(3)
    expect(bounds.max).toBe(6)
    expect(bounds.suit).toBe('hearts')
  })
})

describe('simulateLayOff', () => {
  it('updates runMin when card extends at low end', () => {
    const meld = buildMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run', 'p0', 'Test', 'meld-sl-1'
    )
    const updated = simulateLayOff(c('hearts', 4), meld)
    expect(updated.runMin).toBe(4)
    expect(updated.runMax).toBe(8)
  })

  it('updates runMax when card extends at high end', () => {
    const meld = buildMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run', 'p0', 'Test', 'meld-sl-2'
    )
    const updated = simulateLayOff(c('hearts', 9), meld)
    expect(updated.runMin).toBe(5)
    expect(updated.runMax).toBe(9)
  })

  it('updates runMax when joker extends at high end', () => {
    const meld = buildMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)],
      'run', 'p0', 'Test', 'meld-sl-3'
    )
    const updated = simulateLayOff(joker(), meld)
    expect(updated.runMax).toBe(9)
  })

  it('sets runAceHigh=true when ace extends K-high run to 14', () => {
    const meld = buildMeld(
      [c('hearts', 10), c('hearts', 11), c('hearts', 12), c('hearts', 13)],
      'run', 'p0', 'Test', 'meld-sl-4'
    )
    const updated = simulateLayOff(c('hearts', 1), meld)
    expect(updated.runMax).toBe(14)
    expect(updated.runAceHigh).toBe(true)
  })

  it('does not change bounds for set melds', () => {
    const meld = buildMeld(
      [c('hearts', 7), c('diamonds', 7), c('clubs', 7)],
      'set', 'p0', 'Test', 'meld-sl-5'
    )
    const updated = simulateLayOff(c('spades', 7), meld)
    expect(updated.runMin).toBeUndefined()
    expect(updated.runMax).toBeUndefined()
  })

  it('chain scenario: 4♥ onto 5-9 run → 3♥ valid on result', () => {
    const jkr = joker('jkr-chain-sim')
    const meld = buildMeld(
      [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), jkr],
      'run', 'p0', 'Test', 'meld-sl-6'
    )
    // After simulating 4♥ lay-off: runMin should be 4
    const after4 = simulateLayOff(c('hearts', 4), meld)
    expect(after4.runMin).toBe(4)
    // canLayOff(3♥, after4) = 3 === 4-1 ✓
    expect(canLayOff(c('hearts', 3), after4)).toBe(true)
  })
})

describe('getNextJokerOptions', () => {
  it('returns null when no extra jokers (all fill gaps)', () => {
    // 5-joker-7-8: joker fills gap at 6, no ambiguity
    const jkr = joker('jkr-gap')
    const cards = [c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)]
    expect(getNextJokerOptions(cards, new Map())).toBeNull()
  })

  it('returns options when joker is extra (no gaps to fill)', () => {
    // 5-6-7-8-joker: joker can go at either end (4 or 9)
    const jkr = joker('jkr-extra')
    const cards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), jkr]
    const result = getNextJokerOptions(cards, new Map())
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(2)
    // Options should be low end (4) and high end (9)
    const ranks = result!.options.map(o => o.rank).sort((a, b) => a - b)
    expect(ranks).toContain(4)
    expect(ranks).toContain(9)
  })

  it('returns null when no jokers present', () => {
    const cards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    expect(getNextJokerOptions(cards, new Map())).toBeNull()
  })
})
