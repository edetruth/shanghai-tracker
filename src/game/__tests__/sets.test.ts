import { describe, it, expect } from 'vitest'
import { isValidSet } from '../meld-validator'
import { c, joker } from './helpers'

describe('isValidSet', () => {
  it('accepts 3 natural cards of the same rank', () => {
    expect(isValidSet([c('hearts', 7), c('diamonds', 7), c('clubs', 7)])).toBe(true)
  })

  it('accepts 4 natural cards of the same rank', () => {
    expect(isValidSet([c('hearts', 7), c('diamonds', 7), c('clubs', 7), c('spades', 7)])).toBe(true)
  })

  it('rejects 2 natural cards (too few)', () => {
    expect(isValidSet([c('hearts', 7), c('diamonds', 7)])).toBe(false)
  })

  it('rejects 3 cards of different ranks', () => {
    expect(isValidSet([c('hearts', 7), c('diamonds', 8), c('clubs', 7)])).toBe(false)
  })

  it('accepts 2 naturals + 1 joker', () => {
    expect(isValidSet([c('hearts', 5), c('diamonds', 5), joker()])).toBe(true)
  })

  it('accepts 1 natural + 2 jokers', () => {
    expect(isValidSet([c('hearts', 9), joker(), joker()])).toBe(true)
  })

  it('rejects all-joker set (no naturals)', () => {
    expect(isValidSet([joker(), joker(), joker()])).toBe(false)
  })

  it('accepts set of aces', () => {
    expect(isValidSet([c('hearts', 1), c('diamonds', 1), c('clubs', 1)])).toBe(true)
  })

  it('accepts set of kings', () => {
    expect(isValidSet([c('hearts', 13), c('diamonds', 13), c('spades', 13)])).toBe(true)
  })

  it('suit does not matter — same rank different suits is valid', () => {
    expect(isValidSet([c('hearts', 10), c('hearts', 10), c('clubs', 10)])).toBe(true)
  })

  it('rejects empty array', () => {
    expect(isValidSet([])).toBe(false)
  })

  it('rejects 1 card', () => {
    expect(isValidSet([c('hearts', 7)])).toBe(false)
  })

  it('5-card set is valid', () => {
    expect(isValidSet([
      c('hearts', 3), c('diamonds', 3), c('clubs', 3), c('spades', 3), joker()
    ])).toBe(true)
  })
})
