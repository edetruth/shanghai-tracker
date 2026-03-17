import type { Card, Meld, JokerMapping, RoundRequirement } from './types'
import { MIN_SET_SIZE, MIN_RUN_SIZE } from './rules'

// Returns true if cards form a valid set (3+ same rank, >=1 natural)
export function isValidSet(cards: Card[]): boolean {
  if (cards.length < MIN_SET_SIZE) return false
  const naturals = cards.filter(c => c.suit !== 'joker')
  if (naturals.length === 0) return false
  const rank = naturals[0].rank
  return naturals.every(c => c.rank === rank)
}

function canFormRun(sortedRanks: number[], jokerCount: number): boolean {
  if (sortedRanks.length === 0) return false
  const min = sortedRanks[0]
  const max = sortedRanks[sortedRanks.length - 1]
  const span = max - min + 1
  const gaps = span - sortedRanks.length
  // jokers fill gaps; extra jokers extend the run
  return jokerCount >= gaps
}

// Returns true if cards form a valid run (4+ same suit in sequence, >=1 natural, ace can be high or low, no wrap)
export function isValidRun(cards: Card[]): boolean {
  if (cards.length < MIN_RUN_SIZE) return false
  const naturals = cards.filter(c => c.suit !== 'joker')
  const jokers = cards.filter(c => c.suit === 'joker')
  if (naturals.length === 0) return false

  const suit = naturals[0].suit
  if (suit === 'joker') return false
  if (!naturals.every(c => c.suit === suit)) return false

  // Check no duplicate ranks
  const ranks = naturals.map(c => c.rank).sort((a, b) => a - b)
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1]) return false
  }

  // Try ace-low (ace = 1)
  if (canFormRun(ranks, jokers.length)) return true

  // Try ace-high (ace = 14) — only if there's an ace
  if (ranks.includes(1)) {
    const hiRanks = ranks.map(r => (r === 1 ? 14 : r)).sort((a, b) => a - b)
    // No wrap: if ace is high, all other naturals must be >= 10 for it to make sense
    if (hiRanks[0] >= 10 && canFormRun(hiRanks, jokers.length)) return true
  }

  return false
}

// Returns true if the proposed melds satisfy the round requirement
export function meetsRoundRequirement(meldCards: Card[][], requirement: RoundRequirement): boolean {
  let setCount = 0
  let runCount = 0
  for (const cards of meldCards) {
    if (isValidSet(cards)) setCount++
    else if (isValidRun(cards)) runCount++
    else return false
  }
  return setCount >= requirement.sets && runCount >= requirement.runs
}

// ── Joker placement helpers ───────────────────────────────────────────────

export interface JokerPlacementOption {
  rank: number        // actual rank (14 = ace-high)
  displayRank: number // display rank (14 → 1 for "A")
  // Full sequence preview: each position is natural or joker
  sequence: Array<{ rank: number; displayRank: number; isNatural: boolean }>
}

export interface JokerPlacement {
  joker: Card
  suit: string
  aceHigh: boolean
  options: JokerPlacementOption[]
}

// For a run containing extra jokers (beyond gap-filling), returns the NEXT ambiguous
// joker and its valid placement options. Call iteratively until null.
// alreadyPlaced maps jokerCardId → explicit rank chosen by the player.
export function getNextJokerOptions(
  cards: Card[],
  alreadyPlaced: Map<string, number>
): JokerPlacement | null {
  const naturals = cards.filter(c => c.suit !== 'joker')
  const jokers = cards.filter(c => c.suit === 'joker')
  if (naturals.length === 0 || jokers.length === 0) return null

  const suit = naturals[0].suit
  const naturalRanks = naturals.map(c => c.rank).sort((a, b) => a - b)

  // Determine ace-high
  let useNaturalRanks = naturalRanks
  let aceHigh = false
  if (naturalRanks.includes(1)) {
    const hiRanks = naturalRanks.map(r => (r === 1 ? 14 : r)).sort((a, b) => a - b)
    if (hiRanks[0] >= 10 && canFormRun(hiRanks, jokers.length)) {
      useNaturalRanks = hiRanks
      aceHigh = true
    }
  }

  // Build known ranks: naturals + already-placed joker ranks
  const knownRanks = new Set(useNaturalRanks)
  alreadyPlaced.forEach(rank => knownRanks.add(rank))

  const allKnown = [...knownRanks].sort((a, b) => a - b)
  const seqMin = allKnown[0]
  const seqMax = allKnown[allKnown.length - 1]

  // Find gaps within current span
  const gaps: number[] = []
  for (let r = seqMin; r <= seqMax; r++) {
    if (!knownRanks.has(r)) gaps.push(r)
  }

  // Unplaced jokers
  const unplaced = jokers.filter(j => !alreadyPlaced.has(j.id))
  if (unplaced.length === 0) return null

  // How many are needed to fill gaps?
  const gapFillers = Math.min(gaps.length, unplaced.length)
  if (gapFillers >= unplaced.length) return null // all fill gaps — no ambiguity

  // First extra (ambiguous) joker
  const ambiguousJoker = unplaced[gapFillers]

  const options: JokerPlacementOption[] = []

  // Low-end option
  const lowRank = seqMin - 1
  if (lowRank >= 1 && !knownRanks.has(lowRank)) {
    const choiceKnown = new Set([...knownRanks, lowRank])
    options.push({
      rank: lowRank,
      displayRank: lowRank === 14 ? 1 : lowRank,
      sequence: buildSequencePreview(choiceKnown, useNaturalRanks),
    })
  }

  // High-end option
  const highRank = seqMax + 1
  const highValid = (highRank <= 13) || (highRank === 14 && seqMax === 13)
  if (highValid && !knownRanks.has(highRank)) {
    const choiceKnown = new Set([...knownRanks, highRank])
    options.push({
      rank: highRank,
      displayRank: highRank === 14 ? 1 : highRank,
      sequence: buildSequencePreview(choiceKnown, useNaturalRanks),
    })
  }

  if (options.length < 2) return null // only one valid spot → no choice needed

  return { joker: ambiguousJoker, suit, aceHigh: aceHigh || options.some(o => o.rank === 14), options }
}

function buildSequencePreview(
  knownRanks: Set<number>,
  naturalRanks: number[]
): Array<{ rank: number; displayRank: number; isNatural: boolean }> {
  const sorted = [...knownRanks].sort((a, b) => a - b)
  const seqMin = sorted[0]
  const seqMax = sorted[sorted.length - 1]
  const naturalSet = new Set(naturalRanks)
  const result: Array<{ rank: number; displayRank: number; isNatural: boolean }> = []
  for (let r = seqMin; r <= seqMax; r++) {
    result.push({ rank: r, displayRank: r === 14 ? 1 : r, isNatural: naturalSet.has(r) })
  }
  return result
}

// Build a Meld object from validated cards, computing joker mappings
// For runs: cards array is sorted into correct sequence order (jokers at their logical position)
// jokerPositions: optional explicit rank assignments for jokers (from player picker)
export function buildMeld(cards: Card[], type: 'set' | 'run', ownerId: string, ownerName: string, id: string, jokerPositions?: Map<string, number>): Meld {
  const jokerMappings: JokerMapping[] = []
  const naturals = cards.filter(c => c.suit !== 'joker')
  const jokers = cards.filter(c => c.suit === 'joker')

  let runMin: number | undefined
  let runMax: number | undefined
  let runSuit: import('./types').Suit | undefined
  let runAceHigh: boolean | undefined
  let orderedCards: Card[] = cards

  if (type === 'set') {
    const rank = naturals[0].rank
    jokers.forEach((j) => {
      jokerMappings.push({
        cardId: j.id,
        representsRank: rank,
        representsSuit: naturals[0]?.suit ?? 'spades',
      })
    })
    orderedCards = cards
  } else {
    // Run: compute full sequence
    const suit = naturals[0].suit as import('./types').Suit
    runSuit = suit
    const ranks = naturals.map(c => c.rank).sort((a, b) => a - b)

    // Determine if ace-high
    let useRanks = ranks
    let aceHigh = false
    if (ranks.includes(1)) {
      const hiRanks = ranks.map(r => (r === 1 ? 14 : r)).sort((a, b) => a - b)
      if (hiRanks[0] >= 10 && canFormRun(hiRanks, jokers.length)) {
        useRanks = hiRanks
        aceHigh = true
      }
    }
    runAceHigh = aceHigh

    // Split jokers into explicitly placed (player chose position) vs auto-placed
    const explicitJokers = jokers.filter(j => jokerPositions?.has(j.id))
    const autoJokers = jokers.filter(j => !jokerPositions?.has(j.id))

    // All known ranks: naturals + explicit joker positions
    const allKnownRanks = [...useRanks, ...explicitJokers.map(j => jokerPositions!.get(j.id)!)]
      .sort((a, b) => a - b)
    const allKnownSet = new Set(allKnownRanks)

    const knownMin = allKnownRanks[0]
    const knownMax = allKnownRanks[allKnownRanks.length - 1]

    // Gaps within the known span that auto-jokers will fill
    const remainingGaps: number[] = []
    for (let r = knownMin; r <= knownMax; r++) {
      if (!allKnownSet.has(r)) remainingGaps.push(r)
    }

    const extraAuto = autoJokers.length - remainingGaps.length
    const seqMin = knownMin
    const seqMax = knownMax + Math.max(0, extraAuto)

    runMin = seqMin
    runMax = seqMax
    // If the sequence extends to rank 14 (joker placed as ace-high), mark runAceHigh
    if (seqMax === 14) runAceHigh = true

    // Build the full sequence
    const fullSeq: number[] = []
    for (let r = seqMin; r <= seqMax; r++) fullSeq.push(r)

    // Explicit joker mappings
    explicitJokers.forEach(j => {
      jokerMappings.push({
        cardId: j.id,
        representsRank: jokerPositions!.get(j.id)!,
        representsSuit: suit,
      })
    })

    // Auto-joker mappings: fill remaining gaps then extend at high end
    const autoFillPositions = fullSeq.filter(r => !allKnownSet.has(r))
    autoJokers.forEach((j, i) => {
      jokerMappings.push({
        cardId: j.id,
        representsRank: autoFillPositions[i] ?? seqMax,
        representsSuit: suit,
      })
    })

    // Build ordered cards array: place cards in sequence position order
    orderedCards = []
    for (let r = seqMin; r <= seqMax; r++) {
      const natural = naturals.find(c => (aceHigh ? (c.rank === 1 ? 14 : c.rank) : c.rank) === r)
      if (natural) {
        orderedCards.push(natural)
      } else {
        const mapping = jokerMappings.find(m => m.representsRank === r)
        if (mapping) {
          const jokerCard = jokers.find(c => c.id === mapping.cardId)
          if (jokerCard) orderedCards.push(jokerCard)
        }
      }
    }
    // Fallback: include any cards not placed (shouldn't happen)
    const placedIds = new Set(orderedCards.map(c => c.id))
    cards.forEach(c => { if (!placedIds.has(c.id)) orderedCards.push(c) })
  }

  return { id, type, cards: orderedCards, ownerId, ownerName, jokerMappings, runMin, runMax, runSuit, runAceHigh }
}

// For a run meld, determine min and max rank of the full sequence
export function getRunBounds(meld: Meld): { min: number; max: number; suit: string; aceHigh: boolean } {
  return {
    min: meld.runMin ?? 0,
    max: meld.runMax ?? 0,
    suit: meld.runSuit ?? '',
    aceHigh: meld.runAceHigh ?? false,
  }
}

// Return what a meld looks like AFTER a card is laid off on it (bounds only, no card array).
// Used by stuck-state checkers to validate chained lay-offs.
export function simulateLayOff(card: Card, meld: Meld): Meld {
  if (meld.type !== 'run') return meld // sets don't change bounds
  let runMin = meld.runMin, runMax = meld.runMax, runAceHigh = meld.runAceHigh
  if (card.suit === 'joker') {
    runMax = (runMax ?? 0) + 1
  } else {
    let r = card.rank
    if (card.rank === 1 && runMax === 13) { runMax = 14; runAceHigh = true }
    else {
      if (meld.runAceHigh && card.rank === 1) r = 14
      if (r < (runMin ?? 999)) runMin = r
      else if (r > (runMax ?? 0)) runMax = r
    }
  }
  return { ...meld, runMin, runMax, runAceHigh }
}

// Can a card be laid off on an existing meld?
export function canLayOff(card: Card, meld: Meld): boolean {
  if (meld.type === 'set') {
    const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank
    if (setRank === undefined) return false
    if (card.suit === 'joker') return true
    return card.rank === setRank
  } else {
    // Run
    if (card.suit === 'joker') return true
    if (card.suit !== meld.runSuit) return false
    const min = meld.runMin!
    const max = meld.runMax!

    // Ace can be placed at end of K-high run (ace-high extension: ...Q-K-A)
    if (card.rank === 1 && max === 13) return true

    // Extend at either end
    let cardRank = card.rank
    if (meld.runAceHigh && card.rank === 1) cardRank = 14
    return cardRank === min - 1 || cardRank === max + 1
  }
}

// For joker swaps: find a joker in a RUN meld that the natural card can replace.
// Joker swaps from sets are NOT allowed — the joker's suit is ambiguous in a set.
export function findSwappableJoker(naturalCard: Card, meld: Meld): Card | null {
  if (meld.type !== 'run') return null   // sets: swap not allowed
  for (const mapping of meld.jokerMappings) {
    // Natural must match exact rank AND suit of what joker represents in the run
    let naturalRank = naturalCard.rank
    if (meld.runAceHigh && naturalCard.rank === 1) naturalRank = 14
    if (naturalCard.suit === mapping.representsSuit && naturalRank === mapping.representsRank) {
      const joker = meld.cards.find(c => c.id === mapping.cardId)
      return joker ?? null
    }
  }
  return null
}
