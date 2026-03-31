-- Migration: Add game_action_log table for replay system and AI learning

CREATE TABLE IF NOT EXISTS game_action_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id text NOT NULL,
  seq integer NOT NULL,
  player_index integer NOT NULL,
  action_type text NOT NULL,
  action_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_log_game_seq_idx ON game_action_log(game_id, seq);
CREATE INDEX IF NOT EXISTS action_log_game_idx ON game_action_log(game_id);

-- Permissive RLS (app uses anon key, no auth)
ALTER TABLE game_action_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_action_log' AND policyname = 'anon_all_game_action_log') THEN
    CREATE POLICY anon_all_game_action_log ON game_action_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
