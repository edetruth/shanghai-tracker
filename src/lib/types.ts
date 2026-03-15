export interface Player {
  id: string
  name: string
  created_at: string
}

export interface Game {
  id: string
  date: string
  room_code: string | null
  notes: string | null
  is_complete: boolean
  created_by: string | null
  created_at: string
  game_type?: string | null  // 'manual' | 'pass-and-play' | 'ai' | 'online' (null = legacy)
}

export interface GameScore {
  id: string
  game_id: string
  player_id: string
  round_scores: number[]
  total_score: number
  player?: Player
}

export interface GameWithScores extends Game {
  game_scores: GameScore[]
}

export interface PlayerStats {
  player: Player
  games_played: number
  wins: number
  avg_score: number
  best_game: number
  zero_rounds: number
}

export type DrilldownView =
  | { type: 'game-list';     title: string; games: GameWithScores[]; focalPlayerId?: string }
  | { type: 'game-scorecard'; title: string; game: GameWithScores; highlightPlayerId?: string }
  | { type: 'score-history'; title: string; games: GameWithScores[]; focalPlayerId: string; playerColor: string }
  | { type: 'zero-rounds';   title: string; games: GameWithScores[]; focalPlayerId: string }
  | { type: 'win-streak';    title: string; games: GameWithScores[]; focalPlayerId: string }
  | { type: 'improvement';   title: string; focalPlayerId: string; playerColor: string; firstGames: GameWithScores[]; lastGames: GameWithScores[]; firstAvg: number; lastAvg: number }
