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

// Build a Meld object from validated cards, computing joker mappings
// For runs: cards array is sorted into correct sequence order (jokers at their logical position)
export function buildMeld(cards: Card[], type: 'set' | 'run', ownerId: string, ownerName: string, id: string): Meld {
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

    const min = useRanks[0]
    const max = useRanks[useRanks.length - 1]
    const span = max - min + 1
    const gaps = span - useRanks.length
    const extraJokers = jokers.length - gaps
    // Extra jokers extend at the high end
    const seqMin = min
    const seqMax = max + extraJokers

    runMin = seqMin
    runMax = seqMax

    // Build the full sequence
    const fullSeq: number[] = []
    for (let r = seqMin; r <= seqMax; r++) fullSeq.push(r)

    // Map jokers to missing positions
    const naturalRankSet = new Set(useRanks)
    const missingPositions = fullSeq.filter(r => !naturalRankSet.has(r))

    jokers.forEach((j, i) => {
      jokerMappings.push({
        cardId: j.id,
        representsRank: missingPositions[i] ?? seqMax,
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

// For joker swaps: find joker mappings in a meld that match the given natural card
export function findSwappableJoker(naturalCard: Card, meld: Meld): Card | null {
  for (const mapping of meld.jokerMappings) {
    if (meld.type === 'set') {
      // For set: natural card must match the set rank
      const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank
      if (naturalCard.rank === setRank) {
        const joker = meld.cards.find(c => c.id === mapping.cardId)
        return joker ?? null
      }
    } else {
      // For run: natural must match exact rank AND suit of what joker represents
      let naturalRank = naturalCard.rank
      if (meld.runAceHigh && naturalCard.rank === 1) naturalRank = 14
      if (naturalCard.suit === mapping.representsSuit && naturalRank === mapping.representsRank) {
        const joker = meld.cards.find(c => c.id === mapping.cardId)
        return joker ?? null
      }
    }
  }
  return null
}
