import { describe, it, expect } from 'vitest'
import { meetsRoundRequirement } from '../meld-validator'
import { c } from './helpers'
import { ROUND_REQUIREMENTS, CARDS_DEALT, MAX_BUYS } from '../rules'

const set3 = [c('hearts', 7), c('diamonds', 7), c('clubs', 7)]
const set4 = [c('hearts', 8), c('diamonds', 8), c('clubs', 8)]
const set5 = [c('hearts', 9), c('diamonds', 9), c('clubs', 9)]
const run1 = [c('spades', 3), c('spades', 4), c('spades', 5), c('spades', 6)]
const run2 = [c('hearts', 7), c('hearts', 8), c('hearts', 9), c('hearts', 10)]

describe('meetsRoundRequirement', () => {
  it('Round 1: 2 sets — accepts exactly 2 sets', () => {
    expect(meetsRoundRequirement([set3, set4], ROUND_REQUIREMENTS[0])).toBe(true)
  })

  it('Round 1: 2 sets — rejects 1 set', () => {
    expect(meetsRoundRequirement([set3], ROUND_REQUIREMENTS[0])).toBe(false)
  })

  it('Round 1: 2 sets — rejects 1 set + 1 run', () => {
    expect(meetsRoundRequirement([set3, run1], ROUND_REQUIREMENTS[0])).toBe(false)
  })

  it('Round 1: 2 sets — accepts 3 sets (extra meld)', () => {
    expect(meetsRoundRequirement([set3, set4, set5], ROUND_REQUIREMENTS[0])).toBe(true)
  })

  it('Round 2: 1 set + 1 run — accepts exactly 1 set + 1 run', () => {
    expect(meetsRoundRequirement([set3, run1], ROUND_REQUIREMENTS[1])).toBe(true)
  })

  it('Round 2: 1 set + 1 run — rejects 2 sets', () => {
    expect(meetsRoundRequirement([set3, set4], ROUND_REQUIREMENTS[1])).toBe(false)
  })

  it('Round 2: 1 set + 1 run — rejects 2 runs', () => {
    expect(meetsRoundRequirement([run1, run2], ROUND_REQUIREMENTS[1])).toBe(false)
  })

  it('Round 3: 2 runs — accepts exactly 2 runs', () => {
    expect(meetsRoundRequirement([run1, run2], ROUND_REQUIREMENTS[2])).toBe(true)
  })

  it('Round 3: 2 runs — rejects 1 run', () => {
    expect(meetsRoundRequirement([run1], ROUND_REQUIREMENTS[2])).toBe(false)
  })

  it('Round 3: 2 runs — rejects 2 sets', () => {
    expect(meetsRoundRequirement([set3, set4], ROUND_REQUIREMENTS[2])).toBe(false)
  })

  it('Round 4: 3 sets — accepts exactly 3 sets', () => {
    expect(meetsRoundRequirement([set3, set4, set5], ROUND_REQUIREMENTS[3])).toBe(true)
  })

  it('Round 4: 3 sets — rejects 2 sets', () => {
    expect(meetsRoundRequirement([set3, set4], ROUND_REQUIREMENTS[3])).toBe(false)
  })

  it('Round 5: 2 sets + 1 run — accepts exactly 2 sets + 1 run', () => {
    expect(meetsRoundRequirement([set3, set4, run1], ROUND_REQUIREMENTS[4])).toBe(true)
  })

  it('Round 5: 2 sets + 1 run — rejects 3 sets (missing run)', () => {
    expect(meetsRoundRequirement([set3, set4, set5], ROUND_REQUIREMENTS[4])).toBe(false)
  })

  it('Round 5: 2 sets + 1 run — rejects 1 set + 2 runs (wrong mix)', () => {
    expect(meetsRoundRequirement([set3, run1, run2], ROUND_REQUIREMENTS[4])).toBe(false)
  })

  it('Round 6: 1 set + 2 runs — accepts exactly 1 set + 2 runs', () => {
    expect(meetsRoundRequirement([set3, run1, run2], ROUND_REQUIREMENTS[5])).toBe(true)
  })

  it('Round 6: 1 set + 2 runs — rejects 2 sets + 1 run (wrong mix)', () => {
    expect(meetsRoundRequirement([set3, set4, run1], ROUND_REQUIREMENTS[5])).toBe(false)
  })

  it('Round 6: 1 set + 2 runs — rejects 3 runs (missing set)', () => {
    const run3 = [c('diamonds', 2), c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)]
    expect(meetsRoundRequirement([run1, run2, run3], ROUND_REQUIREMENTS[5])).toBe(false)
  })

  it('Round 7: 3 runs — accepts exactly 3 runs', () => {
    const run3 = [c('diamonds', 2), c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)]
    expect(meetsRoundRequirement([run1, run2, run3], ROUND_REQUIREMENTS[6])).toBe(true)
  })

  it('rejects invalid meld (not a set or run)', () => {
    const badCards = [c('hearts', 5), c('diamonds', 6), c('clubs', 7)]
    expect(meetsRoundRequirement([badCards, set4], ROUND_REQUIREMENTS[0])).toBe(false)
  })
})

// GDD Section 2 — Cards dealt per round
describe('CARDS_DEALT constants (GDD Section 2)', () => {
  it('Rounds 1–4 deal 10 cards each', () => {
    expect(CARDS_DEALT[0]).toBe(10)
    expect(CARDS_DEALT[1]).toBe(10)
    expect(CARDS_DEALT[2]).toBe(10)
    expect(CARDS_DEALT[3]).toBe(10)
  })

  it('Rounds 5–7 deal 12 cards each', () => {
    expect(CARDS_DEALT[4]).toBe(12)
    expect(CARDS_DEALT[5]).toBe(12)
    expect(CARDS_DEALT[6]).toBe(12)
  })

  it('CARDS_DEALT has exactly 7 entries (one per round)', () => {
    expect(CARDS_DEALT).toHaveLength(7)
  })
})

// GDD Section 7/4.1 — Default buy limit
describe('MAX_BUYS constant (GDD Section 7/4.1)', () => {
  it('MAX_BUYS defaults to 5', () => {
    expect(MAX_BUYS).toBe(5)
  })
})

// GDD Section 2 — Bonus meld type restriction
// Extra melds beyond the round requirement must match the round type:
//   sets-only round  → only sets allowed as bonus
//   runs-only round  → only runs allowed as bonus
//   mixed round      → either type allowed as bonus
describe('meetsRoundRequirement — bonus meld type restriction (GDD Section 2)', () => {
  // BUG: current implementation allows any valid meld as bonus regardless of round type.
  // meetsRoundRequirement() returns true for [set, set, run] in a sets-only round.
  // Engine file: src/game/meld-validator.ts meetsRoundRequirement() — no bonus type check.
  it('Round 1 (sets-only): extra run as bonus meld is REJECTED [BUG: returns true]', () => {
    expect(meetsRoundRequirement([set3, set4, run1], ROUND_REQUIREMENTS[0])).toBe(false)
  })

  it('Round 3 (runs-only): extra set as bonus meld is REJECTED [BUG: returns true]', () => {
    expect(meetsRoundRequirement([run1, run2, set3], ROUND_REQUIREMENTS[2])).toBe(false)
  })

  it('Round 4 (sets-only): extra run as bonus meld is REJECTED [BUG: returns true]', () => {
    expect(meetsRoundRequirement([set3, set4, set5, run1], ROUND_REQUIREMENTS[3])).toBe(false)
  })

  it('Round 7 (runs-only): extra set as bonus meld is REJECTED [BUG: returns true]', () => {
    const run3 = [c('diamonds', 2), c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)]
    expect(meetsRoundRequirement([run1, run2, run3, set3], ROUND_REQUIREMENTS[6])).toBe(false)
  })

  // Mixed rounds — either type is valid as bonus (should PASS)
  it('Round 2 (mixed): extra run as bonus meld is ALLOWED', () => {
    const run3 = [c('diamonds', 2), c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)]
    expect(meetsRoundRequirement([set3, run1, run3], ROUND_REQUIREMENTS[1])).toBe(true)
  })

  it('Round 2 (mixed): extra set as bonus meld is ALLOWED', () => {
    expect(meetsRoundRequirement([set3, run1, set4], ROUND_REQUIREMENTS[1])).toBe(true)
  })

  it('Round 5 (mixed): extra set as bonus meld is ALLOWED', () => {
    expect(meetsRoundRequirement([set3, set4, run1, set5], ROUND_REQUIREMENTS[4])).toBe(true)
  })

  it('Round 6 (mixed): extra run as bonus meld is ALLOWED', () => {
    const run3 = [c('diamonds', 2), c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)]
    expect(meetsRoundRequirement([set3, run1, run2, run3], ROUND_REQUIREMENTS[5])).toBe(true)
  })
})
