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
  // cardId → playerName for cards laid off onto this meld by other players
  cardOwners?: Record<string, string>
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
  buysRemaining: number // resets to GameState.buyLimit at the start of each round
  roundScores: number[] // score per round index 0-6
  isAI?: boolean
}

export type AIDifficulty = 'easy' | 'medium' | 'hard'

export interface OpponentHistory {
  picked: Card[]     // cards this player took from the discard pile (free take or buy)
  discarded: Card[]  // cards this player discarded
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
  buyLimit: number      // configured at setup; default 5; 0 = buying disabled; resets buysRemaining each round
}

// ── Telemetry types ──────────────────────────────────────────────────────────

export interface AIDecision {
  game_id: string
  round_number: number
  turn_number: number
  player_name: string
  difficulty: string | null
  is_human: boolean
  decision_type: string
  decision_result: string
  hand_size: number
  hand_points: number
  has_laid_down: boolean
  buys_remaining: number
  card_suit?: string
  card_rank?: number
  reason?: string
}

export interface PlayerRoundStats {
  game_id: string
  round_number: number
  player_name: string
  is_human: boolean
  difficulty: string | null
  round_score: number
  went_out: boolean
  went_down: boolean
  shanghaied: boolean
  total_turns: number
  turn_went_down: number | null
  turns_held_before_going_down: number
  free_takes: number
  free_declines: number
  pile_draws: number
  discard_take_rate: number | null
  cards_taken_used_in_meld: number
  cards_taken_wasted: number
  take_accuracy: number | null
  buys_made: number
  buys_passed: number
  buy_opportunities: number
  cards_bought_used_in_meld: number
  cards_bought_wasted: number
  buy_accuracy: number | null
  discards_total: number
  denial_takes: number
  denial_buys: number
  melds_laid_down: number
  bonus_melds: number
  lay_offs_made: number
  joker_swaps: number
  hand_size_when_went_down: number | null
  final_hand_size: number
  final_hand_points: number
  scenario_b_triggers: number
  scenario_c_triggers: number
}

export interface PlayerGameStats {
  game_id: string
  player_name: string
  is_human: boolean
  difficulty: string | null
  total_score: number
  final_rank: number
  won: boolean
  rounds_won: number
  rounds_shanghaied: number
  rounds_went_down: number
  avg_score_per_round: number
  worst_round_score: number
  best_round_score: number
  overall_take_accuracy: number | null
  overall_buy_accuracy: number | null
  avg_turns_to_go_down: number | null
  total_buys_made: number
  total_denial_actions: number
  total_lay_offs: number
  total_joker_swaps: number
  avg_turn_went_down: number | null
  times_held_going_down: number
}
