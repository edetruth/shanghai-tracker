-- Migration: Add game_rooms and game_room_players tables for online multiplayer

CREATE TABLE IF NOT EXISTS game_rooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code text UNIQUE NOT NULL,
  host_player_name text NOT NULL,
  game_config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  game_state_snapshot jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_room_players (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code text NOT NULL REFERENCES game_rooms(room_code) ON DELETE CASCADE,
  player_name text NOT NULL,
  seat_index int NOT NULL,
  is_host boolean DEFAULT false,
  is_ai boolean DEFAULT false,
  is_connected boolean DEFAULT true,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(room_code, seat_index),
  UNIQUE(room_code, player_name)
);

CREATE INDEX IF NOT EXISTS game_rooms_status_idx ON game_rooms(status);
CREATE INDEX IF NOT EXISTS game_rooms_code_idx ON game_rooms(room_code);
CREATE INDEX IF NOT EXISTS game_room_players_room_idx ON game_room_players(room_code);

-- Permissive RLS (app uses anon key, no auth)
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_room_players ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_rooms' AND policyname = 'anon_all_game_rooms') THEN
    CREATE POLICY anon_all_game_rooms ON game_rooms FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_room_players' AND policyname = 'anon_all_game_room_players') THEN
    CREATE POLICY anon_all_game_room_players ON game_room_players FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Enable realtime for lobby updates
ALTER PUBLICATION supabase_realtime ADD TABLE game_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE game_room_players;
