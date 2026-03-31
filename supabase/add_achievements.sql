-- Migration: Add player_achievements table for the achievement/milestone system

CREATE TABLE IF NOT EXISTS player_achievements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name text NOT NULL,
  achievement_id text NOT NULL,
  unlocked_at timestamptz DEFAULT now(),
  UNIQUE(player_name, achievement_id)
);

CREATE INDEX IF NOT EXISTS player_achievements_player_idx ON player_achievements(player_name);

-- Permissive RLS (app uses anon key, no auth)
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'player_achievements' AND policyname = 'anon_all_player_achievements') THEN
    CREATE POLICY anon_all_player_achievements ON player_achievements FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
