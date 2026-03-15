import type { Card, Suit } from './types'

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

export function createDecks(deckCount: number): Card[] {
  const cards: Card[] = []
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const suitChar = suit[0]
        cards.push({
          id: `${suitChar}${rank}-${d}`,
          suit,
          rank,
          deckIndex: d,
        })
      }
    }
    // 2 jokers per deck
    cards.push({ id: `jkr-0-${d}`, suit: 'joker', rank: 0, deckIndex: d })
    cards.push({ id: `jkr-1-${d}`, suit: 'joker', rank: 0, deckIndex: d })
  }
  return cards
}

export function shuffle(cards: Card[]): Card[] {
  const arr = [...cards]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function dealHands(deck: Card[], playerCount: number, cardsPerPlayer: number): { hands: Card[][], remaining: Card[] } {
  const hands: Card[][] = Array.from({ length: playerCount }, () => [])
  const workDeck = [...deck]
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (let p = 0; p < playerCount; p++) {
      const card = workDeck.shift()
      if (card) hands[p].push(card)
    }
  }
  return { hands, remaining: workDeck }
}
