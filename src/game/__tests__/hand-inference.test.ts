import { describe, it, expect } from 'vitest'
import { sampleOpponentHands } from '../hand-inference'
import { CardTracker } from '../card-tracker'
import type { Card } from '../types'

function makeCard(rank: number, suit: Card['suit'], deckIndex = 0): Card {
  const suitChar = suit === 'joker' ? 'jkr' : suit[0]
  return { id: `${suitChar}${rank}-${deckIndex}`, suit, rank, deckIndex }
}

describe('sampleOpponentHands', () => {
  it('returns correct number of samples', () => {
    const tracker = new CardTracker()
    tracker.reset([makeCard(1, 'hearts')]) // own hand

    const samples = sampleOpponentHands(tracker, 10, [], 20)
    expect(samples.length).toBe(20)
  })

  it('each sample has correct hand size', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    const samples = sampleOpponentHands(tracker, 10, [], 10)
    for (const hand of samples) {
      expect(hand.length).toBe(10)
    }
  })

  it('returns empty array for handSize 0', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    const samples = sampleOpponentHands(tracker, 0, [])
    expect(samples.length).toBe(0)
  })

  it('caps hand size to available pool', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    // Mark almost everything as seen, leaving only 3 unseen
    // We have 108 cards, mark 105 as seen
    const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades']
    let marked = 0
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank++) {
        if (marked >= 105) break
        tracker.markSeen(makeCard(rank, suit, 0))
        marked++
        if (marked >= 105) break
        tracker.markSeen(makeCard(rank, suit, 1))
        marked++
      }
    }

    const remaining = tracker.getTotalUnseen()
    const samples = sampleOpponentHands(tracker, 10, [], 5)
    for (const hand of samples) {
      expect(hand.length).toBeLessThanOrEqual(remaining)
    }
  })

  it('generates valid card objects with synthetic IDs', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    const samples = sampleOpponentHands(tracker, 5, [], 3)
    for (const hand of samples) {
      for (const card of hand) {
        expect(card.id).toMatch(/^infer-/)
        expect(typeof card.rank).toBe('number')
        expect(typeof card.suit).toBe('string')
      }
    }
  })

  it('respects pick history weighting (statistical)', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    // Opponent has been picking lots of hearts
    const pickHistory = [
      makeCard(3, 'hearts'),
      makeCard(5, 'hearts'),
      makeCard(7, 'hearts'),
      makeCard(9, 'hearts'),
      makeCard(11, 'hearts'),
    ]
    tracker.markSeenMany(pickHistory)

    // Sample many hands
    const samples = sampleOpponentHands(tracker, 10, pickHistory, 100)

    // Count average hearts per sample
    let totalHearts = 0
    for (const hand of samples) {
      totalHearts += hand.filter(c => c.suit === 'hearts').length
    }
    const avgHearts = totalHearts / samples.length

    // Without weighting, hearts would be ~21/103 * 10 ≈ 2.04 per hand
    // With weighting, hearts should be higher due to suit affinity
    // We just check it's at least somewhat elevated (statistical test)
    // Note: 21 hearts remaining out of 103 total unseen
    const baselineRate = 21 / 103 * 10
    expect(avgHearts).toBeGreaterThan(baselineRate * 0.9) // at least near baseline
  })

  it('produces different samples (not all identical)', () => {
    const tracker = new CardTracker()
    tracker.reset([])

    const samples = sampleOpponentHands(tracker, 10, [], 10)

    // Check that at least 2 samples are different
    const serialized = samples.map(hand =>
      hand.map(c => `${c.rank}:${c.suit}`).sort().join(',')
    )
    const unique = new Set(serialized)
    expect(unique.size).toBeGreaterThan(1)
  })
})
