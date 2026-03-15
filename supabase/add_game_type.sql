-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Adds game_type tracking to distinguish score-tracker entries from played games

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT 'manual';

-- Backfill existing rows (all legacy games count as 'manual' since we can't know)
-- This is already covered by the DEFAULT above, but shown for clarity:
-- UPDATE games SET game_type = 'manual' WHERE game_type IS NULL;

-- Valid values: 'manual' | 'pass-and-play' | 'ai' | 'online'
-- manual       = entered via Score Tracker (no actual cards played)
-- pass-and-play = played on device, all human players
-- ai            = played on device with at least one AI opponent
-- online         = future real-time multiplayer
