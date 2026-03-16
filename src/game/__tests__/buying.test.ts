import { describe, it, expect } from 'vitest'
import { aiShouldBuy, aiShouldBuyHard, aiShouldBuyEasy } from '../ai'
import { c, joker } from './helpers'
import { ROUND_REQUIREMENTS } from '../rules'

const req1 = ROUND_REQUIREMENTS[0] // 2 sets
const req3 = ROUND_REQUIREMENTS[2] // 2 runs

describe('aiShouldBuyEasy', () => {
  it('always returns false', () => {
    expect(aiShouldBuyEasy()).toBe(false)
  })
})

describe('aiShouldBuy (medium)', () => {
  it('always buys a joker', () => {
    const hand = [c('hearts', 5), c('diamonds', 5), c('clubs', 3)]
    expect(aiShouldBuy(hand, joker(), req1)).toBe(true)
  })

  it('buys if discard completes a required meld combination', () => {
    // 2 sets round: hand has two full sets minus one card; discard provides the missing card
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),   // set 1 ready
      c('hearts', 9), c('diamonds', 9),                   // needs one more 9 for set 2
      c('clubs', 3),
    ]
    const discard = c('spades', 9)
    expect(aiShouldBuy(hand, discard, req1)).toBe(true)
  })

  it('does not buy if hand already can form required melds', () => {
    // Already has 2 valid sets; no reason to buy
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),
      c('hearts', 8), c('diamonds', 8), c('clubs', 8),
    ]
    const discard = c('spades', 2)
    expect(aiShouldBuy(hand, discard, req1)).toBe(false)
  })
})

describe('aiShouldBuyHard', () => {
  it('always buys a joker', () => {
    const hand = [c('hearts', 5), c('diamonds', 5)]
    expect(aiShouldBuyHard(hand, joker(), req1)).toBe(true)
  })

  it('buys a card if it pairs with any existing card (more aggressive)', () => {
    const hand = [c('hearts', 9), c('clubs', 3), c('diamonds', 7)]
    const discard = c('spades', 9) // pairs with 9♥
    expect(aiShouldBuyHard(hand, discard, req1)).toBe(true)
  })

  it('buys if discard is close to same-suit cards', () => {
    const hand = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('clubs', 3)]
    const discard = c('hearts', 8)
    expect(aiShouldBuyHard(hand, discard, req3)).toBe(true)
  })
})
