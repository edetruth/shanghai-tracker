import { describe, it, expect } from 'vitest'
import { CardTracker } from '../card-tracker'
import type { Card } from '../types'

function makeCard(rank: number, suit: Card['suit'], deckIndex = 0): Card {
  const suitChar = suit === 'joker' ? 'jkr' : suit[0]
  return { id: `${suitChar}${rank}-${deckIndex}`, suit, rank, deckIndex }
}

describe('CardTracker', () => {
  it('initializes with correct total cards (108 for 2-deck Shanghai)', () => {
    const tracker = new CardTracker()
    // Before any cards are seen, all 108 are unseen
    expect(tracker.getTotalUnseen()).toBe(108)
  })

  it('tracks seen cards and reduces remaining count', () => {
    const tracker = new CardTracker()
    const hand = [
      makeCard(7, 'hearts', 0),
      makeCard(8, 'hearts', 0),
      makeCard(12, 'spades', 1),
    ]
    tracker.reset(hand)

    // 7 of hearts: 2 in deck, 1 seen → 1 remaining
    expect(tracker.getRemainingCount(7, 'hearts')).toBe(1)
    // 8 of hearts: 2 in deck, 1 seen → 1 remaining
    expect(tracker.getRemainingCount(8, 'hearts')).toBe(1)
    // Queen of spades: 2 in deck, 1 seen → 1 remaining
    expect(tracker.getRemainingCount(12, 'spades')).toBe(1)
    // Unseen card: 2 remaining
    expect(tracker.getRemainingCount(1, 'clubs')).toBe(2)
    // Total: 108 - 3 = 105
    expect(tracker.getTotalUnseen()).toBe(105)
  })

  it('tracks multiple copies of the same card', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    // See both copies of 5 of diamonds
    tracker.markSeen(makeCard(5, 'diamonds', 0))
    tracker.markSeen(makeCard(5, 'diamonds', 1))

    expect(tracker.getRemainingCount(5, 'diamonds')).toBe(0)
    expect(tracker.getTotalUnseen()).toBe(106) // 108 - 2
  })

  it('does not count below zero when overmarked', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    // Try to mark 3 copies of a card that only has 2
    tracker.markSeen(makeCard(10, 'clubs', 0))
    tracker.markSeen(makeCard(10, 'clubs', 1))
    tracker.markSeen(makeCard(10, 'clubs', 0)) // duplicate — should not go below 0

    expect(tracker.getRemainingCount(10, 'clubs')).toBe(0)
    expect(tracker.getTotalUnseen()).toBe(106)
  })

  it('tracks jokers correctly (4 total)', () => {
    const tracker = new CardTracker()
    expect(tracker.getRemainingCount(0, 'joker')).toBe(4)

    tracker.reset([makeCard(0, 'joker', 0)])
    expect(tracker.getRemainingCount(0, 'joker')).toBe(3)

    tracker.markSeen(makeCard(0, 'joker', 1))
    expect(tracker.getRemainingCount(0, 'joker')).toBe(2)
  })

  it('calculates draw probability correctly', () => {
    const tracker = new CardTracker()
    tracker.reset([]) // no cards seen in hand

    // 2 copies of Ace of Hearts in 108 total unseen
    const prob = tracker.getDrawProbability(1, 'hearts')
    expect(prob).toBeCloseTo(2 / 108, 5)

    // Mark one Ace of Hearts as seen
    tracker.markSeen(makeCard(1, 'hearts', 0))
    const prob2 = tracker.getDrawProbability(1, 'hearts')
    expect(prob2).toBeCloseTo(1 / 107, 5)

    // Mark both as seen → probability 0
    tracker.markSeen(makeCard(1, 'hearts', 1))
    expect(tracker.getDrawProbability(1, 'hearts')).toBe(0)
  })

  it('resets correctly between rounds', () => {
    const tracker = new CardTracker()
    tracker.reset([makeCard(5, 'hearts')])
    tracker.markSeen(makeCard(10, 'diamonds'))
    expect(tracker.getTotalUnseen()).toBe(106)

    // Reset with new hand
    tracker.reset([makeCard(3, 'clubs')])
    // Should be back to 107 (only the new hand is seen)
    expect(tracker.getTotalUnseen()).toBe(107)
    expect(tracker.getRemainingCount(5, 'hearts')).toBe(2) // previous hand no longer tracked
  })

  it('markSeenMany tracks multiple cards', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    const discardPile = [
      makeCard(2, 'hearts'),
      makeCard(3, 'hearts'),
      makeCard(4, 'hearts'),
    ]
    tracker.markSeenMany(discardPile)

    expect(tracker.getRemainingCount(2, 'hearts')).toBe(1)
    expect(tracker.getRemainingCount(3, 'hearts')).toBe(1)
    expect(tracker.getRemainingCount(4, 'hearts')).toBe(1)
    expect(tracker.getTotalUnseen()).toBe(105)
  })

  it('getUnseenPool returns correct expanded list', () => {
    const tracker = new CardTracker()
    tracker.reset([])
    const pool = tracker.getUnseenPool()
    expect(pool.length).toBe(108) // all cards unseen

    // Mark all hearts as seen (13 ranks × 2 copies = 26 cards)
    for (let rank = 1; rank <= 13; rank++) {
      tracker.markSeen(makeCard(rank, 'hearts', 0))
      tracker.markSeen(makeCard(rank, 'hearts', 1))
    }
    const pool2 = tracker.getUnseenPool()
    expect(pool2.length).toBe(82) // 108 - 26
    // No hearts should remain
    expect(pool2.filter(ck => ck.suit === 'hearts').length).toBe(0)
  })

  it('getSuitDrawProbability returns correct value', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    // Hearts: 13 ranks × 2 copies = 26 out of 108
    const prob = tracker.getSuitDrawProbability('hearts')
    expect(prob).toBeCloseTo(26 / 108, 5)
  })

  it('getUnseenCardTypes returns types with positive counts', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    const types = tracker.getUnseenCardTypes()
    // 52 unique natural cards + 1 joker type = 53 types
    expect(types.length).toBe(53)
    // Each natural type has count 2, joker has count 4
    const jokerType = types.find(t => t.suit === 'joker')
    expect(jokerType?.count).toBe(4)
    const aceHearts = types.find(t => t.rank === 1 && t.suit === 'hearts')
    expect(aceHearts?.count).toBe(2)
  })
})
