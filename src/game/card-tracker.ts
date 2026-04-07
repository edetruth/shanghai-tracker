import type { Card, Suit } from './types'

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
const DECK_COUNT = 2
const JOKERS_PER_DECK = 2

/** Key for tracking cards by rank+suit (not individual IDs) */
export type CardKey = { rank: number; suit: Suit }

function toKey(rank: number, suit: Suit): string {
  return `${rank}:${suit}`
}

function cardToKey(card: Card): string {
  return toKey(card.rank, card.suit)
}

/**
 * Tracks all publicly visible cards to compute draw probabilities
 * and provide an unseen-card pool for hand inference sampling.
 *
 * Two-deck Shanghai: 108 cards (52×2 + 4 jokers).
 * Each rank+suit pair has 2 copies; jokers have 4 total (rank 0, suit 'joker').
 */
export class CardTracker {
  /** Count of each card type in the full deck */
  private deckCounts = new Map<string, number>()
  /** Count of each card type that has been seen */
  private seenCounts = new Map<string, number>()
  /** Total cards in the full deck */
  private totalCards = 0

  constructor() {
    this.buildDeckTemplate()
  }

  private buildDeckTemplate() {
    this.deckCounts.clear()
    this.seenCounts.clear()
    this.totalCards = 0

    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const key = toKey(rank, suit)
        this.deckCounts.set(key, DECK_COUNT)
        this.seenCounts.set(key, 0)
        this.totalCards += DECK_COUNT
      }
    }
    // Jokers: 2 per deck × 2 decks = 4
    const jKey = toKey(0, 'joker')
    this.deckCounts.set(jKey, JOKERS_PER_DECK * DECK_COUNT)
    this.seenCounts.set(jKey, 0)
    this.totalCards += JOKERS_PER_DECK * DECK_COUNT
  }

  /** Reset for a new round. Marks the player's own hand as seen. */
  reset(playerHand: Card[]) {
    // Reset seen counts to zero
    for (const key of this.seenCounts.keys()) {
      this.seenCounts.set(key, 0)
    }
    // Mark own hand as seen
    for (const card of playerHand) {
      this.markSeen(card)
    }
  }

  /** Mark a card as seen (discard, pick, buy, meld, etc.) */
  markSeen(card: Card) {
    const key = cardToKey(card)
    const current = this.seenCounts.get(key) ?? 0
    const max = this.deckCounts.get(key) ?? 0
    if (current < max) {
      this.seenCounts.set(key, current + 1)
    }
  }

  /** Mark multiple cards as seen */
  markSeenMany(cards: Card[]) {
    for (const card of cards) this.markSeen(card)
  }

  /** How many copies of this rank+suit remain unseen */
  getRemainingCount(rank: number, suit: Suit): number {
    const key = toKey(rank, suit)
    return (this.deckCounts.get(key) ?? 0) - (this.seenCounts.get(key) ?? 0)
  }

  /** Total number of unseen cards */
  getTotalUnseen(): number {
    let total = 0
    for (const [key, deckCount] of this.deckCounts) {
      total += deckCount - (this.seenCounts.get(key) ?? 0)
    }
    return total
  }

  /** Probability of drawing this specific rank+suit from the unseen pool */
  getDrawProbability(rank: number, suit: Suit): number {
    const remaining = this.getRemainingCount(rank, suit)
    const totalUnseen = this.getTotalUnseen()
    if (totalUnseen === 0) return 0
    return remaining / totalUnseen
  }

  /**
   * Get all unseen card types with their remaining counts.
   * Useful for understanding what's left in the draw pile.
   */
  getUnseenCardTypes(): { rank: number; suit: Suit; count: number }[] {
    const result: { rank: number; suit: Suit; count: number }[] = []
    for (const [key, deckCount] of this.deckCounts) {
      const seen = this.seenCounts.get(key) ?? 0
      const remaining = deckCount - seen
      if (remaining > 0) {
        const [rankStr, suit] = key.split(':')
        result.push({ rank: parseInt(rankStr, 10), suit: suit as Suit, count: remaining })
      }
    }
    return result
  }

  /**
   * Build an expanded pool of unseen cards for sampling.
   * Each unseen copy gets its own entry (e.g., if 2 Queens of Hearts
   * are unseen, the pool has 2 entries for Q♥).
   */
  getUnseenPool(): CardKey[] {
    const pool: CardKey[] = []
    for (const { rank, suit, count } of this.getUnseenCardTypes()) {
      for (let i = 0; i < count; i++) {
        pool.push({ rank, suit })
      }
    }
    return pool
  }

  /**
   * Probability that drawing any card of the given suit.
   * Useful for assessing "how likely is opponent to draw a heart?"
   */
  getSuitDrawProbability(suit: Suit): number {
    const totalUnseen = this.getTotalUnseen()
    if (totalUnseen === 0) return 0
    let suitRemaining = 0
    for (const rank of RANKS) {
      suitRemaining += this.getRemainingCount(rank, suit)
    }
    return suitRemaining / totalUnseen
  }
}
