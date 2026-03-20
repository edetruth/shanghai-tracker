-- Telemetry Phase 1: three tables for decision tracking + round/game summaries

-- Table 1: ai_decisions — every individual decision
CREATE TABLE IF NOT EXISTS ai_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  turn_number integer NOT NULL,
  player_name text NOT NULL,
  difficulty text,
  is_human boolean NOT NULL DEFAULT false,

  decision_type text NOT NULL,
  decision_result text NOT NULL,

  hand_size integer,
  hand_points integer,
  has_laid_down boolean DEFAULT false,
  buys_remaining integer,

  card_suit text,
  card_rank integer,

  reason text,

  card_used_in_meld boolean,
  card_still_in_hand_at_round_end boolean,
  points_contributed integer,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_decisions_game_idx ON ai_decisions(game_id);
CREATE INDEX IF NOT EXISTS ai_decisions_type_idx ON ai_decisions(decision_type);
CREATE INDEX IF NOT EXISTS ai_decisions_difficulty_idx ON ai_decisions(difficulty);
CREATE INDEX IF NOT EXISTS ai_decisions_round_idx ON ai_decisions(game_id, round_number);

-- Table 2: player_round_stats — per-player-per-round summary
CREATE TABLE IF NOT EXISTS player_round_stats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  player_name text NOT NULL,
  is_human boolean NOT NULL DEFAULT false,
  difficulty text,

  round_score integer NOT NULL,
  went_out boolean DEFAULT false,
  went_down boolean DEFAULT false,
  shanghaied boolean DEFAULT false,

  total_turns integer,
  turn_went_down integer,
  turns_held_before_going_down integer DEFAULT 0,

  free_takes integer DEFAULT 0,
  free_declines integer DEFAULT 0,
  pile_draws integer DEFAULT 0,
  discard_take_rate numeric,

  cards_taken_used_in_meld integer DEFAULT 0,
  cards_taken_wasted integer DEFAULT 0,
  take_accuracy numeric,

  buys_made integer DEFAULT 0,
  buys_passed integer DEFAULT 0,
  buy_opportunities integer DEFAULT 0,
  cards_bought_used_in_meld integer DEFAULT 0,
  cards_bought_wasted integer DEFAULT 0,
  buy_accuracy numeric,

  discards_total integer DEFAULT 0,
  denial_takes integer DEFAULT 0,
  denial_buys integer DEFAULT 0,

  melds_laid_down integer DEFAULT 0,
  bonus_melds integer DEFAULT 0,
  lay_offs_made integer DEFAULT 0,
  joker_swaps integer DEFAULT 0,

  hand_size_when_went_down integer,
  final_hand_size integer,
  final_hand_points integer,

  scenario_b_triggers integer DEFAULT 0,
  scenario_c_triggers integer DEFAULT 0,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prs_game_idx ON player_round_stats(game_id);
CREATE INDEX IF NOT EXISTS prs_difficulty_idx ON player_round_stats(difficulty);
CREATE INDEX IF NOT EXISTS prs_round_idx ON player_round_stats(round_number);
CREATE UNIQUE INDEX IF NOT EXISTS prs_unique ON player_round_stats(game_id, round_number, player_name);

-- Table 3: player_game_stats — per-player-per-game summary
CREATE TABLE IF NOT EXISTS player_game_stats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  is_human boolean NOT NULL DEFAULT false,
  difficulty text,

  total_score integer NOT NULL,
  final_rank integer NOT NULL,
  won boolean DEFAULT false,

  rounds_won integer DEFAULT 0,
  rounds_shanghaied integer DEFAULT 0,
  rounds_went_down integer DEFAULT 0,
  avg_score_per_round numeric,
  worst_round_score integer,
  best_round_score integer,

  overall_take_accuracy numeric,
  overall_buy_accuracy numeric,
  avg_turns_to_go_down numeric,

  total_buys_made integer DEFAULT 0,
  total_denial_actions integer DEFAULT 0,
  total_lay_offs integer DEFAULT 0,
  total_joker_swaps integer DEFAULT 0,

  avg_turn_went_down numeric,
  times_held_going_down integer DEFAULT 0,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pgs_game_idx ON player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS pgs_difficulty_idx ON player_game_stats(difficulty);
CREATE INDEX IF NOT EXISTS pgs_player_idx ON player_game_stats(player_name);
CREATE UNIQUE INDEX IF NOT EXISTS pgs_unique ON player_game_stats(game_id, player_name);
