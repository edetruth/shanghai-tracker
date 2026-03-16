import { describe, it, expect } from 'vitest'
import { createDecks, dealHands, shuffle } from '../deck'

describe('createDecks', () => {
  it('creates 54 cards per deck (52 standard + 2 jokers)', () => {
    const deck = createDecks(1)
    expect(deck).toHaveLength(54)
  })

  it('creates correct number of cards for 2 decks', () => {
    const deck = createDecks(2)
    expect(deck).toHaveLength(108)
  })

  it('each deck has exactly 2 jokers', () => {
    const deck = createDecks(1)
    const jokers = deck.filter(c => c.suit === 'joker')
    expect(jokers).toHaveLength(2)
  })

  it('each suit has 13 cards', () => {
    const deck = createDecks(1)
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const
    for (const suit of suits) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(13)
    }
  })

  it('all card ids are unique within a deck', () => {
    const deck = createDecks(1)
    const ids = deck.map(c => c.id)
    expect(new Set(ids).size).toBe(deck.length)
  })

  it('all card ids are unique across 2 decks', () => {
    const deck = createDecks(2)
    const ids = deck.map(c => c.id)
    expect(new Set(ids).size).toBe(deck.length)
  })

  it('ranks run from 1 to 13 for standard suits', () => {
    const deck = createDecks(1)
    const hearts = deck.filter(c => c.suit === 'hearts').map(c => c.rank).sort((a, b) => a - b)
    expect(hearts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })
})

describe('dealHands', () => {
  it('deals correct number of cards to each player', () => {
    const deck = createDecks(2)
    const { hands } = dealHands(deck, 4, 10)
    expect(hands).toHaveLength(4)
    hands.forEach(h => expect(h).toHaveLength(10))
  })

  it('remaining pile has correct count', () => {
    const deck = createDecks(2) // 108 cards
    const { remaining } = dealHands(deck, 4, 10) // dealt 40
    expect(remaining).toHaveLength(68)
  })

  it('no card appears in two different hands', () => {
    const deck = createDecks(2)
    const { hands } = dealHands(deck, 4, 10)
    const allIds = hands.flatMap(h => h.map(c => c.id))
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('deals in round-robin order', () => {
    const deck = createDecks(2)
    const { hands } = dealHands(deck, 2, 3)
    // P0 gets cards 0, 2, 4 (0-indexed); P1 gets 1, 3, 5
    expect(hands[0][0].id).toBe(deck[0].id)
    expect(hands[1][0].id).toBe(deck[1].id)
    expect(hands[0][1].id).toBe(deck[2].id)
  })
})

describe('shuffle', () => {
  it('returns same number of cards', () => {
    const deck = createDecks(1)
    expect(shuffle(deck)).toHaveLength(deck.length)
  })

  it('does not modify original array', () => {
    const deck = createDecks(1)
    const copy = [...deck]
    shuffle(deck)
    expect(deck.map(c => c.id)).toEqual(copy.map(c => c.id))
  })
})
