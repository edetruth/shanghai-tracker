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

export type AIPersonality =
  | 'rookie-riley'
  | 'steady-sam'
  | 'lucky-lou'
  | 'patient-pat'
  | 'the-shark'
  | 'the-mastermind'

export interface PersonalityConfig {
  id: AIPersonality
  name: string
  emoji: string
  description: string
  difficulty: number  // 1-5
  takeStyle: 'basic' | 'medium' | 'selective' | 'aggressive-denial'
  buyStyle: 'never' | 'conservative' | 'aggressive' | 'denial' | 'heavy-denial'
  discardStyle: 'random' | 'highest-value' | 'run-aware' | 'opponent-aware'
  goDownStyle: 'immediate' | 'immediate-random-hold' | 'strategic' | 'hold-for-out'
  layOffStyle: 'never' | 'capped-1' | 'unlimited'
  jokerSwapStyle: 'never' | 'random' | 'beneficial' | 'optimal'
  denialEnabled: boolean
  opponentAwareness: boolean
  randomFactor: number
  buySelfLimit: number
  panicThreshold: number
  denialOpponentCardThreshold: number
}

export const PERSONALITIES: PersonalityConfig[] = [
  {
    id: 'rookie-riley',
    name: 'Rookie Riley',
    emoji: '🐣',
    description: 'Learning the ropes — plays it safe',
    difficulty: 1,
    takeStyle: 'basic',
    buyStyle: 'never',
    discardStyle: 'random',
    goDownStyle: 'immediate',
    layOffStyle: 'never',
    jokerSwapStyle: 'never',
    denialEnabled: false,
    opponentAwareness: false,
    randomFactor: 0,
    buySelfLimit: 0,
    panicThreshold: 10,
    denialOpponentCardThreshold: 0,
  },
  {
    id: 'steady-sam',
    name: 'Steady Sam',
    emoji: '🧢',
    description: 'Reliable and predictable — no surprises',
    difficulty: 2,
    takeStyle: 'medium',
    buyStyle: 'conservative',
    discardStyle: 'highest-value',
    goDownStyle: 'immediate',
    layOffStyle: 'capped-1',
    jokerSwapStyle: 'never',
    denialEnabled: false,
    opponentAwareness: false,
    randomFactor: 0,
    buySelfLimit: 2,
    panicThreshold: 10,
    denialOpponentCardThreshold: 0,
  },
  {
    id: 'lucky-lou',
    name: 'Lucky Lou',
    emoji: '🎲',
    description: 'Wild and unpredictable — chaos agent',
    difficulty: 3,
    takeStyle: 'medium',
    buyStyle: 'aggressive',
    discardStyle: 'highest-value',
    goDownStyle: 'immediate-random-hold',
    layOffStyle: 'unlimited',
    jokerSwapStyle: 'random',
    denialEnabled: false,
    opponentAwareness: false,
    randomFactor: 0.2,
    buySelfLimit: 5,
    panicThreshold: 8,
    denialOpponentCardThreshold: 0,
  },
  {
    id: 'patient-pat',
    name: 'Patient Pat',
    emoji: '🧘',
    description: 'Waits for the perfect moment to strike',
    difficulty: 4,
    takeStyle: 'selective',
    buyStyle: 'conservative',
    discardStyle: 'run-aware',
    goDownStyle: 'strategic',
    layOffStyle: 'unlimited',
    jokerSwapStyle: 'beneficial',
    denialEnabled: false,
    opponentAwareness: false,
    randomFactor: 0,
    buySelfLimit: 3,
    panicThreshold: 8,
    denialOpponentCardThreshold: 0,
  },
  {
    id: 'the-shark',
    name: 'The Shark',
    emoji: '🦈',
    description: 'Reads opponents and blocks their plays',
    difficulty: 5,
    takeStyle: 'aggressive-denial',
    buyStyle: 'denial',
    discardStyle: 'opponent-aware',
    goDownStyle: 'immediate',
    layOffStyle: 'unlimited',
    jokerSwapStyle: 'optimal',
    denialEnabled: true,
    opponentAwareness: true,
    randomFactor: 0,
    buySelfLimit: 5,
    panicThreshold: 7,
    denialOpponentCardThreshold: 3,
  },
  {
    id: 'the-mastermind',
    name: 'The Mastermind',
    emoji: '🧠',
    description: 'Only goes down when going out — ruthless',
    difficulty: 5,
    takeStyle: 'aggressive-denial',
    buyStyle: 'heavy-denial',
    discardStyle: 'opponent-aware',
    goDownStyle: 'hold-for-out',
    layOffStyle: 'unlimited',
    jokerSwapStyle: 'optimal',
    denialEnabled: true,
    opponentAwareness: true,
    randomFactor: 0,
    buySelfLimit: 5,
    panicThreshold: 2,
    denialOpponentCardThreshold: 4,
  },
]

export function personalityToLegacyDifficulty(p: AIPersonality): AIDifficulty {
  if (p === 'rookie-riley' || p === 'steady-sam') return 'easy'
  if (p === 'lucky-lou' || p === 'patient-pat') return 'medium'
  return 'hard'
}

export interface OpponentHistory {
  picked: Card[]     // cards this player took from the discard pile (free take or buy)
  discarded: Card[]  // cards this player discarded
}

export interface PlayerConfig {
  name: string
  isAI: boolean
  personality?: AIPersonality
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

// ── Tournament types ─────────────────────────────────────────────────────────

export interface TournamentState {
  enabled: boolean
  totalGames: 3
  currentGameNumber: number  // 1, 2, or 3
  gameResults: TournamentGameResult[]
  standings: Map<string, TournamentPlayerStats>
}

export interface TournamentGameResult {
  gameNumber: number
  winnerId: string
  winnerName: string
  playerScores: { playerId: string; name: string; totalScore: number; rank: number }[]
}

export interface TournamentPlayerStats {
  gamesWon: number
  totalScore: number
  roundsWon: number
  avgScore: number
  shanghaiCount: number
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
