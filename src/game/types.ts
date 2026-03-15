export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker'

export interface Card {
  id: string          // e.g. "h7-1" = 7 of hearts deck 1, "jkr-0-1" = joker deck 1 #0
  suit: Suit
  rank: number        // 1=Ace, 2-10, 11=Jack, 12=Queen, 13=King, 0=Joker
  deckIndex: number
}

export interface JokerMapping {
  cardId: string        // the joker card's id
  representsRank: number
  representsSuit: Suit
}

export interface Meld {
  id: string
  type: 'set' | 'run'
  cards: Card[]         // in sequence order for runs
  ownerId: string
  ownerName: string
  jokerMappings: JokerMapping[]
  // For runs: minRank and maxRank of the full sequence (including joker positions)
  runMin?: number       // actual min rank in sequence
  runMax?: number       // actual max rank in sequence
  runSuit?: Suit
  runAceHigh?: boolean  // if ace is used as 14
}

export interface Player {
  id: string
  name: string
  hand: Card[]
  melds: Meld[]         // melds this player has laid down this round
  hasLaidDown: boolean
  buysRemaining: number // 5 across the whole game
  roundScores: number[] // score per round index 0-6
  isAI?: boolean
}

export interface PlayerConfig {
  name: string
  isAI: boolean
}

export interface RoundRequirement {
  sets: number
  runs: number
  description: string
}

export interface RoundState {
  roundNumber: number       // 1-7
  requirement: RoundRequirement
  cardsDealt: number        // 10 or 12
  drawPile: Card[]
  discardPile: Card[]
  currentPlayerIndex: number
  dealerIndex: number
  tablesMelds: Meld[]       // all melds on the table this round
  meldIdCounter: number
  goOutPlayerId: string | null
}

export interface GameState {
  players: Player[]
  currentRound: number  // 1-7
  roundState: RoundState
  deckCount: number
  gameOver: boolean
}
