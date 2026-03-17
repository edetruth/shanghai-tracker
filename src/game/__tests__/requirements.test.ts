import { describe, it, expect } from 'vitest'
import { meetsRoundRequirement } from '../meld-validator'
import { c } from './helpers'
import { ROUND_REQUIREMENTS } from '../rules'

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
