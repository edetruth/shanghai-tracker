import type { Card, Suit } from './types'
import type { CardKey, CardTracker } from './card-tracker'

/**
 * Sample possible opponent hands based on publicly observable information.
 *
 * Uses the unseen card pool from CardTracker and weights samples toward
 * cards consistent with the opponent's observed pick patterns (suit/rank affinity).
 */
export function sampleOpponentHands(
  tracker: CardTracker,
  handSize: number,
  pickHistory: Card[],
  numSamples: number = 50,
): Card[][] {
  if (handSize <= 0) return []

  const pool = tracker.getUnseenPool()
  if (pool.length === 0) return []

  // Build affinity weights from pick history
  const suitAffinity = new Map<Suit, number>()
  const rankAffinity = new Map<number, number>()
  for (const card of pickHistory) {
    suitAffinity.set(card.suit, (suitAffinity.get(card.suit) ?? 0) + 1)
    rankAffinity.set(card.rank, (rankAffinity.get(card.rank) ?? 0) + 1)
  }

  // Compute weight for each card in the pool
  const weights = pool.map(ck => {
    let w = 1.0
    // Suit affinity: if opponent picks hearts often, hearts are 3x more likely
    if (suitAffinity.has(ck.suit)) w += (suitAffinity.get(ck.suit)! * 2)
    // Rank affinity: if opponent picks 7s, 7s are 2x more likely
    if (rankAffinity.has(ck.rank)) w += (rankAffinity.get(ck.rank)! * 1)
    return w
  })

  const totalWeight = weights.reduce((a, b) => a + b, 0)

  const samples: Card[][] = []

  for (let s = 0; s < numSamples; s++) {
    const hand = weightedSample(pool, weights, totalWeight, Math.min(handSize, pool.length))
    // Convert CardKeys to Card objects (synthetic IDs — these are hypothetical cards)
    samples.push(hand.map((ck, i) => ({
      id: `infer-${s}-${i}`,
      suit: ck.suit,
      rank: ck.rank,
      deckIndex: 0,
    })))
  }

  return samples
}

/** Weighted sampling without replacement */
function weightedSample(
  pool: CardKey[],
  weights: number[],
  totalWeight: number,
  count: number,
): CardKey[] {
  const result: CardKey[] = []
  // Work with copies so we can remove picked items
  const available = pool.map((ck, i) => ({ ck, w: weights[i] }))
  let remaining = totalWeight

  for (let i = 0; i < count && available.length > 0; i++) {
    let r = Math.random() * remaining
    let picked = -1
    for (let j = 0; j < available.length; j++) {
      r -= available[j].w
      if (r <= 0) {
        picked = j
        break
      }
    }
    if (picked === -1) picked = available.length - 1

    result.push(available[picked].ck)
    remaining -= available[picked].w
    available.splice(picked, 1)
  }

  return result
}
