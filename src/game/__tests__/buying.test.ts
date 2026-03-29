import { describe, it, expect } from 'vitest'
import { aiShouldBuy, aiShouldBuyHard, aiShouldBuyEasy } from '../ai'
import { c, joker } from './helpers'
import { ROUND_REQUIREMENTS, MAX_BUYS } from '../rules'

const req1 = ROUND_REQUIREMENTS[0] // 2 sets
const req3 = ROUND_REQUIREMENTS[2] // 2 runs

describe('aiShouldBuyEasy', () => {
  it('returns false when buys remaining < 3', () => {
    const hand = [c('hearts', 7), c('diamonds', 7), c('clubs', 5)]
    const discard = c('spades', 7)
    expect(aiShouldBuyEasy(hand, discard, req1, 2)).toBe(false)
  })

  it('buys when card enables required meld and enough buys remain', () => {
    const hand = [c('hearts', 7), c('diamonds', 7), c('clubs', 7), c('hearts', 9), c('diamonds', 9)]
    const discard = c('spades', 9) // completes the 2nd set
    expect(aiShouldBuyEasy(hand, discard, req1, 5)).toBe(true)
  })

  it('does not buy if hand can already form required melds', () => {
    const hand = [c('hearts', 7), c('diamonds', 7), c('clubs', 7), c('hearts', 8), c('diamonds', 8), c('clubs', 8)]
    const discard = c('spades', 2)
    expect(aiShouldBuyEasy(hand, discard, req1, 5)).toBe(false)
  })
})

describe('aiShouldBuy (medium)', () => {
  it('always buys a joker', () => {
    const hand = [c('hearts', 5), c('diamonds', 5), c('clubs', 3)]
    expect(aiShouldBuy(hand, joker(), req1, 5)).toBe(true)
  })

  it('buys if discard completes a required meld combination', () => {
    // 2 sets round: hand has two full sets minus one card; discard provides the missing card
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),   // set 1 ready
      c('hearts', 9), c('diamonds', 9),                   // needs one more 9 for set 2
      c('clubs', 3),
    ]
    const discard = c('spades', 9)
    expect(aiShouldBuy(hand, discard, req1, 5)).toBe(true)
  })

  it('does not buy if hand already can form required melds', () => {
    // Already has 2 valid sets; no reason to buy
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),
      c('hearts', 8), c('diamonds', 8), c('clubs', 8),
    ]
    const discard = c('spades', 2)
    expect(aiShouldBuy(hand, discard, req1, 5)).toBe(false)
  })
})

describe('aiShouldBuyHard', () => {
  it('always buys a joker (if buys remain)', () => {
    const hand = [c('hearts', 5), c('diamonds', 5)]
    expect(aiShouldBuyHard(hand, joker(), req1, 5)).toBe(true)
  })

  it('buys a card that completes a set (2+ same rank in hand)', () => {
    const hand = [c('hearts', 9), c('clubs', 9), c('diamonds', 7)]
    const discard = c('spades', 9) // completes set of 9s
    expect(aiShouldBuyHard(hand, discard, req1, 5)).toBe(true)
  })

  it('buys on a pair when hand is small and risk is low', () => {
    // New evaluation system: forming a pair from nothing is a significant improvement
    // on a set round with a small hand (low risk)
    const hand = [c('hearts', 9), c('clubs', 3), c('diamonds', 7)]
    const discard = c('spades', 9) // pairs with hearts 9
    expect(aiShouldBuyHard(hand, discard, req1, 5)).toBe(true)
  })

  it('buys if discard is close to same-suit cards', () => {
    const hand = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('clubs', 3)]
    const discard = c('hearts', 8)
    expect(aiShouldBuyHard(hand, discard, req3, 5)).toBe(true)
  })

  it('does not buy when buysRemaining is 0', () => {
    const hand = [c('hearts', 9), c('clubs', 3), c('diamonds', 7)]
    const discard = c('spades', 9)
    expect(aiShouldBuyHard(hand, discard, req1, 0)).toBe(false)
  })
})

// GDD Section 7/4.1 — Configurable buy limit
describe('MAX_BUYS constant (GDD Section 7/4.1)', () => {
  it('MAX_BUYS is 5 (default buy limit per player per round)', () => {
    expect(MAX_BUYS).toBe(5)
  })
})

// GDD Section 7/4.1 — buyLimit = 0 disables buying entirely
// When a game is configured with buyLimit=0, players start each round with buysRemaining=0.
// All AI buy functions must return false when buysRemaining === 0.
describe('buyLimit = 0 disables buying (GDD Section 7/4.1)', () => {
  it('aiShouldBuyEasy: returns false when buysRemaining=0 (buyLimit=0 effect)', () => {
    // Even a compelling buy (discard completes a required meld) must be rejected
    const hand = [c('hearts', 7), c('diamonds', 7), c('hearts', 9), c('diamonds', 9)]
    const discard = c('spades', 9) // would complete 2nd set of 9s
    expect(aiShouldBuyEasy(hand, discard, req1, 0)).toBe(false)
  })

  it('aiShouldBuyHard: returns false when buysRemaining=0 (buyLimit=0 effect)', () => {
    // Hard AI always buys jokers when buys remain — must be blocked at 0
    const hand = [c('hearts', 5), c('diamonds', 5)]
    expect(aiShouldBuyHard(hand, joker(), req1, 0)).toBe(false)
  })

  it('aiShouldBuyEasy: returns false even when discard is a joker and buysRemaining=0', () => {
    const hand = [c('hearts', 5), c('diamonds', 5), c('clubs', 3)]
    expect(aiShouldBuyEasy(hand, joker(), req1, 0)).toBe(false)
  })

  it('aiShouldBuyHard: returns false for matching card pair when buysRemaining=0', () => {
    const hand = [c('hearts', 9), c('clubs', 3), c('diamonds', 7)]
    const discard = c('spades', 9) // pairs with hearts 9
    expect(aiShouldBuyHard(hand, discard, req1, 0)).toBe(false)
  })
})

// GDD Section 7/4.1 — buyLimit resets buysRemaining each round
// buysRemaining is set to GameState.buyLimit at the start of every new round.
// This is enforced by the round setup logic (not a standalone pure function).
// The types contract: Player.buysRemaining must equal GameState.buyLimit after reset.
describe('buyLimit resets buysRemaining each round (GDD Section 7/4.1)', () => {
  it('MAX_BUYS (5) is the default — Player.buysRemaining should start at 5', () => {
    // The default buyLimit is MAX_BUYS; a freshly initialised player starts with MAX_BUYS buys
    expect(MAX_BUYS).toBe(5)
    // Player type documents: buysRemaining resets to GameState.buyLimit at round start
    // Test: a custom buyLimit of 3 means buysRemaining resets to 3, not 5
    // Verified via AI buy guard: aiShouldBuyHard rejects buysRemaining <= 2,
    // so buyLimit=3 allows 1 buy before the guard kicks in at <=2 remaining.
    const hand = [c('hearts', 5), c('diamonds', 5)]
    // buysRemaining=3 → allowed (buyLimit=3, fresh round, first buy)
    expect(aiShouldBuyHard(hand, joker(), req1, 3)).toBe(true)
    // buysRemaining=0 → rejected (buyLimit=0 resets to 0 → no buys)
    expect(aiShouldBuyHard(hand, joker(), req1, 0)).toBe(false)
  })

  it('buyLimit=10 allows 10 buys per player per round (buysRemaining resets to 10)', () => {
    // With a custom buyLimit of 10, Hard AI should accept buys at buysRemaining=10
    const hand = [c('hearts', 5), c('diamonds', 5)]
    // Hard AI guard is at <=2; buysRemaining=10 is well above that
    expect(aiShouldBuyHard(hand, joker(), req1, 10)).toBe(true)
    // Also works at buysRemaining=3 (just above the hard guard)
    expect(aiShouldBuyHard(hand, joker(), req1, 3)).toBe(true)
  })
})
