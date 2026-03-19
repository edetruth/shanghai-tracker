CREATE TABLE IF NOT EXISTS game_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  turn_number  integer NOT NULL,
  event_type   text NOT NULL,
  player_name  text NOT NULL,
  card         text,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_events_game_id_idx ON game_events(game_id);
