-- Migration: Add tournaments and tournament_matches tables for online tournament brackets

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  host_name text NOT NULL,
  player_count integer NOT NULL CHECK (player_count IN (4, 8)),
  format text NOT NULL DEFAULT 'single-elimination',
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'finished')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  match_index integer NOT NULL,
  player_names text[] NOT NULL DEFAULT '{}',
  winner_name text,
  room_code text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'finished')),
  UNIQUE(tournament_id, round_number, match_index)
);

CREATE INDEX IF NOT EXISTS tournaments_code_idx ON tournaments(code);
CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments(status);
CREATE INDEX IF NOT EXISTS tournament_matches_tournament_idx ON tournament_matches(tournament_id);

-- Permissive RLS (app uses anon key, no auth)
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournaments' AND policyname = 'anon_all_tournaments') THEN
    CREATE POLICY anon_all_tournaments ON tournaments FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_matches' AND policyname = 'anon_all_tournament_matches') THEN
    CREATE POLICY anon_all_tournament_matches ON tournament_matches FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Enable realtime for live bracket updates
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
ALTER PUBLICATION supabase_realtime ADD TABLE tournament_matches;
