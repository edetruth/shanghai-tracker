import type { Card, Meld, RoundRequirement } from './types'
import { isValidRun, canLayOff, simulateLayOff, findSwappableJoker } from './meld-validator'
import { cardPoints, MIN_SET_SIZE, MIN_RUN_SIZE } from './rules'

function isJoker(c: Card): boolean { return c.suit === 'joker' }

function groupByRank(cards: Card[]): Map<number, Card[]> {
  const map = new Map<number, Card[]>()
  for (const c of cards.filter(c => !isJoker(c))) {
    if (!map.has(c.rank)) map.set(c.rank, [])
    map.get(c.rank)!.push(c)
  }
  return map
}

function groupBySuit(cards: Card[]): Map<string, Card[]> {
  const map = new Map<string, Card[]>()
  for (const c of cards.filter(c => !isJoker(c))) {
    if (!map.has(c.suit)) map.set(c.suit, [])
    map.get(c.suit)!.push(c)
  }
  return map
}

function tryFindSet(hand: Card[], allJokers: Card[], jokersUsed: number): Card[] | null {
  const byRank = groupByRank(hand)
  const available = allJokers.slice(jokersUsed)
  for (const [, cards] of byRank) {
    if (cards.length >= MIN_SET_SIZE) return cards.slice(0, MIN_SET_SIZE)
    const needed = MIN_SET_SIZE - cards.length
    if (needed <= available.length) {
      return [...cards, ...available.slice(0, needed)]
    }
  }
  return null
}

function tryFindRun(hand: Card[], allJokers: Card[], jokersUsed: number): Card[] | null {
  const bySuit = groupBySuit(hand)
  const available = allJokers.slice(jokersUsed)
  for (const [, suitCards] of bySuit) {
    const sorted = [...suitCards].sort((a, b) => a.rank - b.rank)
    for (let jCount = 0; jCount <= available.length; jCount++) {
      for (let start = 0; start < sorted.length; start++) {
        for (let end = sorted.length; end > start + MIN_RUN_SIZE - 1 - jCount; end--) {
          const sub = sorted.slice(start, end)
          const testCards = [...sub, ...available.slice(0, jCount)]
          if (testCards.length >= MIN_RUN_SIZE && isValidRun(testCards)) return testCards
        }
      }
    }
  }
  return null
}

// Score a suit by its run-building potential (higher = better)
function scoreSuitForRun(suitCards: Card[]): number {
  if (suitCards.length < 2) return suitCards.length
  const ranks = suitCards.map(c => c.rank).sort((a, b) => a - b)
  // Longest consecutive sequence
  let maxSeq = 1, curSeq = 1
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1] + 1) curSeq++
    else curSeq = 1
    maxSeq = Math.max(maxSeq, curSeq)
  }
  // Density: how close ranks are
  const span = ranks[ranks.length - 1] - ranks[0] + 1
  const density = suitCards.length / span
  return maxSeq * 10 + suitCards.length * 4 + density * 15
}

// Get the top committed suits (best run-building opportunities)
function getCommittedSuits(hand: Card[], topN = 2): Set<string> {
  const bySuit = groupBySuit(hand)
  const scores: [string, number][] = []
  for (const [suit, cards] of bySuit) {
    scores.push([suit, scoreSuitForRun(cards)])
  }
  scores.sort((a, b) => b[1] - a[1])
  return new Set(scores.slice(0, topN).map(s => s[0]))
}

// Try to find meld groups satisfying the round requirement
export function aiFindBestMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  const jokers = hand.filter(isJoker)
  const naturals = hand.filter(c => !isJoker(c))

  const melds: Card[][] = []
  const usedIds = new Set<string>()
  let jokersUsed = 0

  for (let s = 0; s < requirement.sets; s++) {
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const meld = tryFindSet(remaining, jokers, jokersUsed)
    if (!meld) return null
    meld.forEach(c => usedIds.add(c.id))
    jokersUsed += meld.filter(isJoker).length
    melds.push(meld)
  }

  for (let r = 0; r < requirement.runs; r++) {
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const meld = tryFindRun(remaining, jokers, jokersUsed)
    if (!meld) return null
    meld.forEach(c => usedIds.add(c.id))
    jokersUsed += meld.filter(isJoker).length
    melds.push(meld)
  }

  return melds
}

// Should AI take the top discard card?
export function aiShouldTakeDiscard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
): boolean {
  if (isJoker(discardCard)) return true
  if (hasLaidDown) return false

  // Taking it enables melds we couldn't make before
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  if (withCard !== null && aiFindBestMelds(hand, requirement) === null) return true

  // Run-heavy round: be more aggressive about same-suit cards
  const isRunHeavy = requirement.runs > requirement.sets
  if (isRunHeavy) {
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
    if (sameSuit.length >= 2) {
      const allRanks = [...sameSuit.map(c => c.rank), discardCard.rank].sort((a, b) => a - b)
      // Check if new card fills a gap or extends the sequence
      for (let i = 1; i < allRanks.length; i++) {
        if (allRanks[i] - allRanks[i - 1] <= 2) return true
      }
    }
    return false
  }

  // Set-heavy round: pairs with 2+ same-rank cards → makes a set
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 2) return true

  // Extends an existing suit sequence
  const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
  if (sameSuit.length >= 2) {
    const close = sameSuit.filter(c => Math.abs(c.rank - discardCard.rank) <= 2)
    if (close.length >= 2) return true
  }

  return false
}

// Pick the best card to discard (lowest meld utility, highest point cost)
export function aiChooseDiscard(hand: Card[], requirement?: RoundRequirement): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  const isRunHeavy = requirement && requirement.runs > requirement.sets

  if (isRunHeavy) {
    return aiChooseDiscardForRuns(hand)
  }

  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 3).length
    return sameRank * 50 + adjacent * 30 - cardPoints(card.rank)
  }

  return hand.reduce((worst, card) => utility(card) < utility(worst) ? card : worst)
}

// Discard strategy for run-heavy rounds: dump cards from non-committed suits
function aiChooseDiscardForRuns(hand: Card[]): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  const committedSuits = getCommittedSuits(hand, 2)

  // Find non-committed non-joker cards
  const nonCommitted = hand.filter(c => !isJoker(c) && !committedSuits.has(c.suit))
  if (nonCommitted.length > 0) {
    // Discard highest-point non-committed card
    return nonCommitted.reduce((max, c) => cardPoints(c.rank) > cardPoints(max.rank) ? c : max)
  }

  // All cards are in committed suits — discard lowest-utility card
  function runUtility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 2).length
    return adjacent * 40 - cardPoints(card.rank)
  }

  return hand.reduce((worst, card) => runUtility(card) < runUtility(worst) ? card : worst)
}

// Should AI buy an out-of-turn discard?
export function aiShouldBuy(hand: Card[], discardCard: Card, requirement: RoundRequirement): boolean {
  if (isJoker(discardCard)) return true
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  const without = aiFindBestMelds(hand, requirement)
  if (withCard !== null && without === null) return true

  // For run rounds, also buy if the card fits a committed suit
  const isRunHeavy = requirement.runs > requirement.sets
  if (isRunHeavy) {
    const committedSuits = getCommittedSuits(hand, 2)
    if (committedSuits.has(discardCard.suit)) {
      const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
      if (sameSuit.length >= 2) {
        const close = sameSuit.filter(c => Math.abs(c.rank - discardCard.rank) <= 2)
        if (close.length >= 1) return true
      }
    }
  }

  return false
}

// Check whether any valid meld (set or run) can be formed from the given cards
// allowedTypes restricts which meld types count (default: both)
export function canFormAnyValidMeld(cards: Card[], allowedTypes: 'set' | 'run' | 'both' = 'both'): boolean {
  const jokers = cards.filter(isJoker)
  const naturals = cards.filter(c => !isJoker(c))
  if (allowedTypes !== 'run' && tryFindSet(naturals, jokers, 0) !== null) return true
  if (allowedTypes !== 'set' && tryFindRun(naturals, jokers, 0) !== null) return true
  return false
}

// Find required melds PLUS any additional valid melds from remaining cards (AI lay-down)
// Extra melds respect round type: e.g. runs-only round only adds extra runs
export function aiFindAllMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  const requiredMelds = aiFindBestMelds(hand, requirement)
  if (!requiredMelds) return null

  // Determine which extra meld types are allowed
  const allowsSets = requirement.sets > 0
  const allowsRuns = requirement.runs > 0

  const allMelds = [...requiredMelds]
  const usedIds = new Set(requiredMelds.flatMap(m => m.map(c => c.id)))

  // Greedily find additional melds from remaining cards (matching round type)
  let found = true
  while (found) {
    found = false
    const remaining = hand.filter(c => !usedIds.has(c.id))
    const jokers = remaining.filter(isJoker)
    const naturals = remaining.filter(c => !isJoker(c))

    if (allowsSets) {
      const set = tryFindSet(naturals, jokers, 0)
      if (set) {
        set.forEach(c => usedIds.add(c.id))
        allMelds.push(set)
        found = true
        continue
      }
    }

    if (allowsRuns) {
      const run = tryFindRun(naturals, jokers, 0)
      if (run) {
        run.forEach(c => usedIds.add(c.id))
        allMelds.push(run)
        found = true
      }
    }
  }

  return allMelds
}

// Before laying down: check if swapping a joker from a table meld would enable
// meeting the round requirement. Returns the swap to make, or null.
export function aiFindPreLayDownJokerSwap(
  hand: Card[],
  tablesMelds: Meld[],
  requirement: RoundRequirement
): { card: Card; meld: Meld } | null {
  for (const card of hand) {
    if (isJoker(card)) continue
    for (const meld of tablesMelds) {
      const joker = findSwappableJoker(card, meld)
      if (!joker) continue
      const simulatedHand = [...hand.filter(c => c.id !== card.id), joker]
      if (aiFindBestMelds(simulatedHand, requirement)) return { card, meld }
    }
  }
  return null
}

// For a joker being laid off on a run, choose the end that maximises future potential.
// Prefers the end with more room (ranks available before hitting A-low or A-high).
export function aiChooseJokerLayOffPosition(meld: Meld): 'low' | 'high' {
  const roomBelow = (meld.runMin ?? 1) - 1       // ranks available below (runMin-1 down to 1)
  const roomAbove = 14 - (meld.runMax ?? 13)      // ranks available above (runMax+1 up to 14)
  return roomBelow >= roomAbove ? 'low' : 'high'
}

// Find a card in hand that can be laid off on any of the given melds.
// Skips lay-offs that would leave exactly 1 card that can't itself be laid off
// anywhere (which would strand the AI — can't discard last card, can't go out).
export function aiFindLayOff(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null {
  for (const card of hand) {
    for (const meld of tablesMelds) {
      if (canLayOff(card, meld)) {
        const jokerPosition = (card.suit === 'joker' && meld.type === 'run')
          ? aiChooseJokerLayOffPosition(meld)
          : undefined
        const remaining = hand.filter(c => c.id !== card.id)
        if (remaining.length === 1) {
          // Check against the SIMULATED post-lay-off meld bounds — a chain lay-off
          // (e.g. 4♥ onto 5-9 run) updates runMin/runMax, enabling the next card (3♥).
          const updatedMelds = tablesMelds.map(m => m.id === meld.id ? simulateLayOff(card, meld, jokerPosition) : m)
          if (!updatedMelds.some(m => canLayOff(remaining[0], m))) {
            continue // would leave 1 unplayable card — skip
          }
        }
        return { card, meld, jokerPosition }
      }
    }
  }
  return null
}

// Hard mode: smarter discard — strongly avoids breaking potential sets/runs
export function aiChooseDiscardHard(hand: Card[]): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 3).length
    // Hard: much stronger weighting — a pair is almost never discarded
    return sameRank * 120 + adjacent * 60 - cardPoints(card.rank)
  }

  return hand.reduce((worst, card) => utility(card) < utility(worst) ? card : worst)
}

// Hard mode: more aggressive buying — buy on any pair or run potential
export function aiShouldBuyHard(hand: Card[], discardCard: Card, requirement: RoundRequirement): boolean {
  if (isJoker(discardCard)) return true
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  const without = aiFindBestMelds(hand, requirement)
  if (withCard !== null && without === null) return true
  // Buy if card pairs with any existing card (more aggressive than medium's sameRank >= 2)
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 1) return true
  // Buy if card extends an existing suit run
  const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
  const close = sameSuit.filter(c => Math.abs(c.rank - discardCard.rank) <= 2)
  if (close.length >= 2) return true
  return false
}

// Easy mode: random/naive play — never buys, never takes discard, discards highest-value
export function aiChooseDiscardEasy(hand: Card[]): Card {
  if (hand.length === 0) throw new Error('Empty hand')
  // Discard highest-value non-joker
  const nonJokers = hand.filter(c => !isJoker(c))
  if (nonJokers.length === 0) return hand[0]
  return nonJokers.reduce((max, c) => cardPoints(c.rank) > cardPoints(max.rank) ? c : max)
}

export function aiShouldTakeDiscardEasy(): boolean { return false }
export function aiShouldBuyEasy(): boolean { return false }

// Find a natural card in hand that can be swapped with a joker on the table
export function aiFindJokerSwap(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld } | null {
  for (const card of hand.filter(c => c.suit !== 'joker')) {
    for (const meld of tablesMelds) {
      if (meld.jokerMappings.length > 0) {
        const joker = findSwappableJoker(card, meld)
        if (joker) return { card, meld }
      }
    }
  }
  return null
}
