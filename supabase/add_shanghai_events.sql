-- Run in Supabase SQL Editor after add_game_type.sql
-- Tracks which players were "shanghaied" (still holding cards when someone goes out)

CREATE TABLE IF NOT EXISTS shanghai_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  round_number int NOT NULL,   -- 1–7
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast per-player queries
CREATE INDEX IF NOT EXISTS shanghai_events_player_idx ON shanghai_events(player_id);
CREATE INDEX IF NOT EXISTS shanghai_events_game_idx   ON shanghai_events(game_id);
