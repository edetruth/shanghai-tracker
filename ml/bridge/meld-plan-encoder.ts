/**
 * Meld Plan Encoder — extracts 30-dim meld planning features from the current hand.
 *
 * Used by the v3 bridge to give the LSTM explicit meld-planning context:
 * "how close am I to meeting the round's meld requirements?"
 *
 * Feature layout (30 dims total):
 *   [0]     Candidate plan count (0 or 1)
 *   [1]     Best plan completeness (cards held / cards needed, 0-1)
 *   [2]     Best plan cards away (normalized 0-1)
 *   [3-14]  Per-requirement slots: up to 3 requirements x 4 features each
 *             type (set=0/run=1), completeness ratio, cards away ratio, best partial match length
 *   [15]    Flexible card count (normalized)
 *   [16]    Dead card count (normalized)
 *   [17]    Jokers in hand (normalized /4.0)
 *   [18-29] Padding zeros
 */

import { aiFindBestMelds } from '../../src/game/ai'
import { ROUND_REQUIREMENTS, MIN_SET_SIZE, MIN_RUN_SIZE } from '../../src/game/rules'
import type { Card, RoundRequirement } from '../../src/game/types'

const FEATURE_DIM = 30

function isJoker(c: Card): boolean {
  return c.suit === 'joker'
}

function groupByRank(cards: Card[]): Map<number, Card[]> {
  const map = new Map<number, Card[]>()
  for (const c of cards) {
    if (isJoker(c)) continue
    const arr = map.get(c.rank) ?? []
    arr.push(c)
    map.set(c.rank, arr)
  }
  return map
}

function groupBySuit(cards: Card[]): Map<string, Card[]> {
  const map = new Map<string, Card[]>()
  for (const c of cards) {
    if (isJoker(c)) continue
    const arr = map.get(c.suit) ?? []
    arr.push(c)
    map.set(c.suit, arr)
  }
  return map
}

/**
 * Find the longest consecutive run of ranks within a sorted array of same-suit cards.
 * Returns the length of the best partial run found.
 */
function longestConsecutiveRun(suitCards: Card[]): number {
  if (suitCards.length === 0) return 0
  const ranks = [...new Set(suitCards.map(c => c.rank))].sort((a, b) => a - b)
  let best = 1
  let current = 1
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1] + 1) {
      current++
      if (current > best) best = current
    } else {
      current = 1
    }
  }
  return best
}

/**
 * Analyze how well the hand satisfies a single set requirement.
 * Returns { completeness, cardsAway, bestPartialLength }.
 */
function analyzeSetProgress(
  byRank: Map<number, Card[]>,
  jokerCount: number,
  usedCardIds: Set<string>,
): { completeness: number; cardsAway: number; bestPartialLength: number } {
  let bestCount = 0
  for (const [, cards] of byRank) {
    const available = cards.filter(c => !usedCardIds.has(c.id))
    if (available.length > bestCount) bestCount = available.length
  }
  // Include jokers as wildcards
  const effective = Math.min(bestCount + jokerCount, MIN_SET_SIZE)
  const completeness = effective / MIN_SET_SIZE
  const cardsAway = Math.max(0, MIN_SET_SIZE - effective)
  return { completeness, cardsAway, bestPartialLength: bestCount }
}

/**
 * Analyze how well the hand satisfies a single run requirement.
 * Returns { completeness, cardsAway, bestPartialLength }.
 */
function analyzeRunProgress(
  bySuit: Map<string, Card[]>,
  jokerCount: number,
  usedCardIds: Set<string>,
): { completeness: number; cardsAway: number; bestPartialLength: number } {
  let bestRunLen = 0
  for (const [, cards] of bySuit) {
    const available = cards.filter(c => !usedCardIds.has(c.id))
    const runLen = longestConsecutiveRun(available)
    if (runLen > bestRunLen) bestRunLen = runLen
  }
  const effective = Math.min(bestRunLen + jokerCount, MIN_RUN_SIZE)
  const completeness = effective / MIN_RUN_SIZE
  const cardsAway = Math.max(0, MIN_RUN_SIZE - effective)
  return { completeness, cardsAway, bestPartialLength: bestRunLen }
}

/**
 * Encode meld plan features for the given hand and round.
 *
 * @param hand - Current cards in hand
 * @param roundIndex - 0-based round index (0-6)
 * @returns 30-element float array of meld plan features
 */
export function encodeMeldPlan(hand: Card[], roundIndex: number): number[] {
  const features = new Array<number>(FEATURE_DIM).fill(0)
  if (hand.length === 0 || roundIndex < 0 || roundIndex >= ROUND_REQUIREMENTS.length) {
    return features
  }

  const requirement = ROUND_REQUIREMENTS[roundIndex]
  const totalRequirements = requirement.sets + requirement.runs
  const handSize = hand.length
  const jokers = hand.filter(isJoker)
  const jokerCount = jokers.length
  const naturals = hand.filter(c => !isJoker(c))
  const byRank = groupByRank(naturals)
  const bySuit = groupBySuit(naturals)

  // Feature [0]: Candidate plan count — does a complete meld exist?
  const bestMelds = aiFindBestMelds(hand, requirement)
  const hasPlan = bestMelds !== null ? 1 : 0
  features[0] = hasPlan

  // Feature [1]: Best plan completeness
  // Feature [2]: Best plan cards away
  if (bestMelds !== null) {
    // Complete plan found
    features[1] = 1.0
    features[2] = 0.0
  } else {
    // Compute aggregate partial progress
    const totalCardsNeeded = requirement.sets * MIN_SET_SIZE + requirement.runs * MIN_RUN_SIZE
    let totalCardsHave = 0
    let totalCardsAway = 0
    const usedIds = new Set<string>()

    // Analyze sets first, then runs (greedy approximation)
    for (let s = 0; s < requirement.sets; s++) {
      const result = analyzeSetProgress(byRank, jokerCount, usedIds)
      totalCardsHave += Math.min(result.bestPartialLength, MIN_SET_SIZE)
      totalCardsAway += result.cardsAway
      // Mark best rank's cards as "used" for next slot analysis
      let bestRank = -1
      let bestLen = 0
      for (const [rank, cards] of byRank) {
        const avail = cards.filter(c => !usedIds.has(c.id))
        if (avail.length > bestLen) {
          bestLen = avail.length
          bestRank = rank
        }
      }
      if (bestRank >= 0) {
        const cards = byRank.get(bestRank)!.filter(c => !usedIds.has(c.id))
        for (const c of cards.slice(0, MIN_SET_SIZE)) usedIds.add(c.id)
      }
    }

    for (let r = 0; r < requirement.runs; r++) {
      const result = analyzeRunProgress(bySuit, jokerCount, usedIds)
      totalCardsHave += Math.min(result.bestPartialLength, MIN_RUN_SIZE)
      totalCardsAway += result.cardsAway
      // Mark best suit's consecutive cards as "used"
      let bestSuit = ''
      let bestLen = 0
      for (const [suit, cards] of bySuit) {
        const avail = cards.filter(c => !usedIds.has(c.id))
        const runLen = longestConsecutiveRun(avail)
        if (runLen > bestLen) {
          bestLen = runLen
          bestSuit = suit
        }
      }
      if (bestSuit) {
        const cards = bySuit.get(bestSuit)!.filter(c => !usedIds.has(c.id))
        const ranks = [...new Set(cards.map(c => c.rank))].sort((a, b) => a - b)
        // Find the longest consecutive block and mark those cards
        let runStart = 0
        let runEnd = 0
        let curStart = 0
        for (let i = 1; i <= ranks.length; i++) {
          if (i < ranks.length && ranks[i] === ranks[i - 1] + 1) continue
          if (i - curStart > runEnd - runStart) {
            runStart = curStart
            runEnd = i
          }
          curStart = i
        }
        const runRanks = new Set(ranks.slice(runStart, runEnd))
        for (const c of cards) {
          if (runRanks.has(c.rank)) usedIds.add(c.id)
        }
      }
    }

    features[1] = totalCardsNeeded > 0 ? Math.min(totalCardsHave / totalCardsNeeded, 1.0) : 0
    features[2] = totalCardsNeeded > 0 ? Math.min(totalCardsAway / totalCardsNeeded, 1.0) : 0
  }

  // Features [3-14]: Per-requirement slots (up to 3 requirements x 4 features)
  // Build ordered list of requirement types: sets first, then runs
  const reqSlots: Array<'set' | 'run'> = []
  for (let s = 0; s < requirement.sets; s++) reqSlots.push('set')
  for (let r = 0; r < requirement.runs; r++) reqSlots.push('run')

  const slotUsedIds = new Set<string>()
  for (let i = 0; i < Math.min(reqSlots.length, 3); i++) {
    const offset = 3 + i * 4
    const type = reqSlots[i]

    if (type === 'set') {
      features[offset] = 0 // set type
      const result = analyzeSetProgress(byRank, jokerCount, slotUsedIds)
      features[offset + 1] = result.completeness
      features[offset + 2] = result.cardsAway / MIN_SET_SIZE
      features[offset + 3] = Math.min(result.bestPartialLength / MIN_SET_SIZE, 1.0)
      // Mark used
      let bestRank = -1
      let bestLen = 0
      for (const [rank, cards] of byRank) {
        const avail = cards.filter(c => !slotUsedIds.has(c.id))
        if (avail.length > bestLen) { bestLen = avail.length; bestRank = rank }
      }
      if (bestRank >= 0) {
        const cards = byRank.get(bestRank)!.filter(c => !slotUsedIds.has(c.id))
        for (const c of cards.slice(0, MIN_SET_SIZE)) slotUsedIds.add(c.id)
      }
    } else {
      features[offset] = 1 // run type
      const result = analyzeRunProgress(bySuit, jokerCount, slotUsedIds)
      features[offset + 1] = result.completeness
      features[offset + 2] = result.cardsAway / MIN_RUN_SIZE
      features[offset + 3] = Math.min(result.bestPartialLength / MIN_RUN_SIZE, 1.0)
      // Mark used
      let bestSuit = ''
      let bestLen = 0
      for (const [suit, cards] of bySuit) {
        const avail = cards.filter(c => !slotUsedIds.has(c.id))
        const runLen = longestConsecutiveRun(avail)
        if (runLen > bestLen) { bestLen = runLen; bestSuit = suit }
      }
      if (bestSuit) {
        const cards = bySuit.get(bestSuit)!.filter(c => !slotUsedIds.has(c.id))
        for (const c of cards) slotUsedIds.add(c.id)
      }
    }
  }

  // Feature [15]: Flexible card count — cards useful to multiple requirement types
  // A card is "flexible" if it could participate in either a set or a run
  let flexibleCount = 0
  if (requirement.sets > 0 && requirement.runs > 0) {
    for (const c of naturals) {
      const rankGroup = byRank.get(c.rank)
      const suitGroup = bySuit.get(c.suit)
      const usefulForSet = (rankGroup?.length ?? 0) >= 2 // at least a pair
      const usefulForRun = (suitGroup?.length ?? 0) >= 2 // at least 2 same-suit
      if (usefulForSet && usefulForRun) flexibleCount++
    }
  }
  features[15] = Math.min(flexibleCount / Math.max(handSize, 1), 1.0)

  // Feature [16]: Dead card count — cards not useful to any requirement type
  let deadCount = 0
  const meldCardIds = bestMelds
    ? new Set(bestMelds.flat().map(c => c.id))
    : new Set<string>()

  for (const c of naturals) {
    if (meldCardIds.has(c.id)) continue
    const rankGroup = byRank.get(c.rank)
    const suitGroup = bySuit.get(c.suit)
    const usefulForSet = requirement.sets > 0 && (rankGroup?.length ?? 0) >= 2
    const usefulForRun = requirement.runs > 0 && (suitGroup?.length ?? 0) >= 2
    if (!usefulForSet && !usefulForRun) deadCount++
  }
  features[16] = Math.min(deadCount / Math.max(handSize, 1), 1.0)

  // Feature [17]: Jokers in hand (normalized by /4.0)
  features[17] = Math.min(jokerCount / 4.0, 1.0)

  // Features [18-29]: Padding zeros (already initialized to 0)

  return features
}
