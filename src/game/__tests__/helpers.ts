import type { Card, Meld, Suit } from '../types'
import { buildMeld } from '../meld-validator'

let _idCounter = 0
export function resetIds() { _idCounter = 0 }

export function c(suit: Suit, rank: number, id?: string): Card {
  return { id: id ?? `${suit[0]}${rank}-t${_idCounter++}`, suit, rank, deckIndex: 0 }
}

export function joker(id?: string): Card {
  return { id: id ?? `jkr-t${_idCounter++}`, suit: 'joker', rank: 0, deckIndex: 0 }
}

export function makeMeld(cards: Card[], type: 'set' | 'run', jokerPositions?: Map<string, number>): Meld {
  return buildMeld(cards, type, 'p0', 'Test', `meld-${_idCounter++}`, jokerPositions)
}
