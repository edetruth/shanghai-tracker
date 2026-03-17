import type { Card, Meld, RoundRequirement } from './types'
import { isValidRun, canLayOff, simulateLayOff, findSwappableJoker, canGoOutViaChainLayOff } from './meld-validator'
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
// Conservative: only take if it directly enables melds, makes a set, or is adjacent to a committed run.
// Expected ratio: ~60-70% draw from pile, 30-40% take discard — so the buy window opens regularly.
export function aiShouldTakeDiscard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
): boolean {
  if (isJoker(discardCard)) return true
  if (hasLaidDown) return false

  // Taking it enables required melds we couldn't form without it
  if (aiFindBestMelds([...hand, discardCard], requirement) !== null &&
      aiFindBestMelds(hand, requirement) === null) return true

  // Card makes a set: hand already holds 2+ of same rank → adding this gives 3+
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 2) return true

  // Card is directly adjacent (rank ±1) to a same-suit card in a committed run suit.
  // Only check the top-2 committed suits to avoid greedily hoarding every suit.
  const committedSuits = getCommittedSuits(hand, 2)
  if (committedSuits.has(discardCard.suit)) {
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
    const isRunHeavy = requirement.runs > requirement.sets
    if (isRunHeavy) {
      // Run-heavy rounds: take within ±2 gap even with just 1 existing same-suit card
      if (sameSuit.length >= 1) {
        for (const c of sameSuit) {
          if (Math.abs(discardCard.rank - c.rank) <= 2) return true
        }
      }
    } else {
      // Set-heavy rounds: only take if directly adjacent and already have 2 same-suit
      if (sameSuit.length >= 2) {
        for (const c of sameSuit) {
          if (Math.abs(discardCard.rank - c.rank) === 1) return true
        }
      }
    }
  }

  return false
}

// Pick the best card to discard (lowest meld utility, highest point cost)
// tablesMelds: melds currently on the table — used to prevent discarding jokers when runs exist
export function aiChooseDiscard(hand: Card[], requirement?: RoundRequirement, tablesMelds: Meld[] = []): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  // Never discard a joker if there are any runs on the table to lay it off on.
  // If somehow a joker can't be laid off (no runs), hold it as last resort only.
  const runsOnTable = tablesMelds.filter(m => m.type === 'run')
  const nonJokerHand = hand.filter(c => !isJoker(c))

  // If hand has only jokers, we can't avoid discarding one — but this should be extremely rare
  const candidateHand = (runsOnTable.length > 0 || nonJokerHand.length > 0)
    ? (nonJokerHand.length > 0 ? nonJokerHand : hand)
    : hand

  const isRunHeavy = requirement && requirement.runs > requirement.sets

  if (isRunHeavy) {
    return aiChooseDiscardForRuns(candidateHand)
  }

  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 3).length
    return sameRank * 50 + adjacent * 30 - cardPoints(card.rank)
  }

  return candidateHand.reduce((worst, card) => utility(card) < utility(worst) ? card : worst)
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

// Before laying down: check if swapping jokers from table melds would enable
// meeting the round requirement. Tries single swaps first, then pairs.
// Returns the FIRST swap to execute (re-evaluation after each swap finds the next).
export function aiFindPreLayDownJokerSwap(
  hand: Card[],
  tablesMelds: Meld[],
  requirement: RoundRequirement
): { card: Card; meld: Meld } | null {
  // Collect all possible swap candidates
  const candidates: { card: Card; meld: Meld; joker: Card }[] = []
  for (const card of hand) {
    if (isJoker(card)) continue
    for (const meld of tablesMelds) {
      const joker = findSwappableJoker(card, meld)
      if (!joker) continue
      candidates.push({ card, meld, joker })
    }
  }

  // Try single swaps first
  for (const { card, meld, joker } of candidates) {
    const simulatedHand = [...hand.filter(c => c.id !== card.id), joker]
    if (aiFindBestMelds(simulatedHand, requirement)) return { card, meld }
  }

  // Try pairs of swaps — two swaps together might enable laying down
  for (let i = 0; i < candidates.length; i++) {
    const { card: c1, meld: m1, joker: j1 } = candidates[i]
    // Simulate hand and melds after first swap
    const hand1 = [...hand.filter(c => c.id !== c1.id), j1]
    const melds1 = tablesMelds.map(m => {
      if (m.id !== m1.id) return m
      const newCards = m.cards.map(c => c.id === j1.id ? c1 : c)
      const newMappings = m.jokerMappings.filter(jm => jm.cardId !== j1.id)
      return { ...m, cards: newCards, jokerMappings: newMappings }
    })
    for (let k = i + 1; k < candidates.length; k++) {
      const { card: c2, meld: m2 } = candidates[k]
      if (c2.id === c1.id) continue // can't use same card twice
      const targetMeld2 = melds1.find(m => m.id === m2.id)
      if (!targetMeld2) continue
      const joker2 = findSwappableJoker(c2, targetMeld2)
      if (!joker2) continue
      const hand2 = [...hand1.filter(c => c.id !== c2.id), joker2]
      if (aiFindBestMelds(hand2, requirement)) return { card: c1, meld: m1 }
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
// Jokers are prioritised first — AI should never hold a joker when it can lay one off.
// Skips lay-offs that would leave exactly 1 card that can't itself be laid off
// anywhere (which would strand the AI — can't discard last card, can't go out).
export function aiFindLayOff(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null {
  // Prioritise jokers: always lay off jokers before other cards
  const jokers = hand.filter(c => c.suit === 'joker')
  const nonJokers = hand.filter(c => c.suit !== 'joker')
  const prioritisedHand = [...jokers, ...nonJokers]

  for (const card of prioritisedHand) {
    for (const meld of tablesMelds) {
      if (canLayOff(card, meld)) {
        const jokerPosition = (card.suit === 'joker' && meld.type === 'run')
          ? aiChooseJokerLayOffPosition(meld)
          : undefined
        const remaining = hand.filter(c => c.id !== card.id)
        if (remaining.length === 1) {
          // Check against the SIMULATED post-lay-off meld bounds — a chain lay-off
          // (e.g. 4♥ onto 5-9 run) updates runMin/runMax, enabling the next card (3♥).
          // Use canGoOutViaChainLayOff so that any 1-card lay-off is properly validated.
          const updatedMelds = tablesMelds.map(m => m.id === meld.id ? simulateLayOff(card, meld, jokerPosition) : m)
          if (!canGoOutViaChainLayOff(remaining, updatedMelds)) {
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
// tablesMelds: melds currently on the table — used to prevent discarding jokers when runs exist
export function aiChooseDiscardHard(hand: Card[], tablesMelds: Meld[] = []): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  // Never discard a joker if there are any runs on the table to lay it off on.
  const runsOnTable = tablesMelds.filter(m => m.type === 'run')
  const nonJokerHand = hand.filter(c => !isJoker(c))
  const candidateHand = (runsOnTable.length > 0 || nonJokerHand.length > 0)
    ? (nonJokerHand.length > 0 ? nonJokerHand : hand)
    : hand

  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 3).length
    // Hard: much stronger weighting — a pair is almost never discarded
    return sameRank * 120 + adjacent * 60 - cardPoints(card.rank)
  }

  return candidateHand.reduce((worst, card) => utility(card) < utility(worst) ? card : worst)
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
