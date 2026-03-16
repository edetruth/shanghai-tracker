import { describe, it, expect } from 'vitest'
import { isValidRun } from '../meld-validator'
import { c, joker } from './helpers'

describe('isValidRun — basic', () => {
  it('accepts 4 consecutive same-suit cards', () => {
    expect(isValidRun([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)])).toBe(true)
  })

  it('accepts 5 consecutive same-suit cards', () => {
    expect(isValidRun([
      c('hearts', 3), c('hearts', 4), c('hearts', 5), c('hearts', 6), c('hearts', 7)
    ])).toBe(true)
  })

  it('rejects 3 cards (too short)', () => {
    expect(isValidRun([c('hearts', 5), c('hearts', 6), c('hearts', 7)])).toBe(false)
  })

  it('rejects 4 cards of mixed suits', () => {
    expect(isValidRun([
      c('hearts', 5), c('hearts', 6), c('diamonds', 7), c('hearts', 8)
    ])).toBe(false)
  })

  it('rejects 4 cards with a gap (no joker)', () => {
    expect(isValidRun([
      c('hearts', 5), c('hearts', 6), c('hearts', 8), c('hearts', 9)
    ])).toBe(false)
  })

  it('rejects duplicate ranks', () => {
    expect(isValidRun([
      c('hearts', 5), c('hearts', 5), c('hearts', 6), c('hearts', 7)
    ])).toBe(false)
  })

  it('rejects all-joker run', () => {
    expect(isValidRun([joker(), joker(), joker(), joker()])).toBe(false)
  })
})

describe('isValidRun — jokers', () => {
  it('accepts run with joker filling a gap', () => {
    expect(isValidRun([
      c('hearts', 5), c('hearts', 6), joker(), c('hearts', 8)
    ])).toBe(true)
  })

  it('accepts run with joker extending the sequence', () => {
    expect(isValidRun([
      c('hearts', 5), c('hearts', 6), c('hearts', 7), joker()
    ])).toBe(true)
  })

  it('accepts 3 naturals + 1 joker with 2 gaps (joker fills one, naturals span 5)', () => {
    // 5, 6, _, 8 — wait no that's 1 gap. 5, _, 7, 8 — same
    // 5, joker, 7, 8 = valid
    expect(isValidRun([
      c('clubs', 5), joker(), c('clubs', 7), c('clubs', 8)
    ])).toBe(true)
  })

  it('accepts run with 2 jokers filling 2 gaps', () => {
    expect(isValidRun([
      c('spades', 4), c('spades', 5), joker(), joker(), c('spades', 8)
    ])).toBe(true)
  })

  it('accepts 2 naturals + 2 jokers (span ≤ 4)', () => {
    expect(isValidRun([
      c('diamonds', 6), c('diamonds', 9), joker(), joker()
    ])).toBe(true)
  })

  it('rejects 2 naturals + 1 joker when gap is too large', () => {
    // 3 and 9 of hearts with 1 joker: span=7, gaps=5, need 5 jokers but have 1
    expect(isValidRun([
      c('hearts', 3), c('hearts', 9), joker()
    ])).toBe(false)
  })
})

describe('isValidRun — ace handling', () => {
  it('accepts ace-low run (A-2-3-4)', () => {
    expect(isValidRun([
      c('hearts', 1), c('hearts', 2), c('hearts', 3), c('hearts', 4)
    ])).toBe(true)
  })

  it('accepts ace-high run (J-Q-K-A)', () => {
    expect(isValidRun([
      c('hearts', 11), c('hearts', 12), c('hearts', 13), c('hearts', 1)
    ])).toBe(true)
  })

  it('accepts 10-J-Q-K-A run', () => {
    expect(isValidRun([
      c('clubs', 10), c('clubs', 11), c('clubs', 12), c('clubs', 13), c('clubs', 1)
    ])).toBe(true)
  })

  it('rejects wrap-around run (Q-K-A-2)', () => {
    expect(isValidRun([
      c('hearts', 12), c('hearts', 13), c('hearts', 1), c('hearts', 2)
    ])).toBe(false)
  })

  it('rejects A-K-Q-J (reverse order — not valid as-is, but valid sorted)', () => {
    // isValidRun sorts internally, so this should be valid if it makes a run
    expect(isValidRun([
      c('spades', 1), c('spades', 13), c('spades', 12), c('spades', 11)
    ])).toBe(true)
  })
})
