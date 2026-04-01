# Telemetry System Design — Learning From Every Decision

## Overview

Three-layer telemetry system that captures every AI decision, tracks outcomes, and enables both quick in-app dashboards and deep SQL analysis.

```
Layer 1: ai_decisions      — every individual decision with reasoning + outcome
Layer 2: player_round_stats — aggregated per-player-per-round summary
Layer 3: player_game_stats  — aggregated per-player-per-game summary
```

Layer 1 is written during gameplay (after each AI action).
Layers 2 and 3 are computed at round end and game end.
The in-app dashboard reads Layers 2 and 3. SQL deep dives use Layer 1.

---

## Layer 1: `ai_decisions` — Every Decision With Reasoning

One row per decision point. This is where you find "what went wrong" for specific AI behaviors.

```sql
CREATE TABLE ai_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  turn_number integer NOT NULL,
  player_name text NOT NULL,
  difficulty text NOT NULL,                    -- 'easy' | 'medium' | 'hard'
  is_human boolean NOT NULL DEFAULT false,     -- track human decisions too

  -- What decision was made
  decision_type text NOT NULL,                 -- see decision types below
  decision_result text NOT NULL,               -- what they chose (see below)
  
  -- Context at decision time
  hand_size integer,                           -- cards in hand when deciding
  hand_points integer,                         -- total point value of hand
  has_laid_down boolean DEFAULT false,
  buys_remaining integer,
  
  -- The card involved (if applicable)
  card_suit text,                              -- 'hearts' | 'diamonds' | etc
  card_rank integer,                           -- 1-13 or 0 for joker
  
  -- AI reasoning (why it decided this way)
  reason text,                                 -- human-readable: 'gap-fill in hearts run', 'denial of opponent', etc
  
  -- Outcome tracking (filled in LATER when we know if the decision was good)
  card_used_in_meld boolean,                   -- did the taken/bought card end up in a meld?
  card_laid_off boolean,                       -- was the card laid off onto a meld?
  card_still_in_hand_at_round_end boolean,     -- was the card still in hand when round ended?
  points_contributed integer,                  -- if still in hand, how many points did it cost?

  created_at timestamptz DEFAULT now()
);

CREATE INDEX ai_decisions_game_idx ON ai_decisions(game_id);
CREATE INDEX ai_decisions_type_idx ON ai_decisions(decision_type);
CREATE INDEX ai_decisions_difficulty_idx ON ai_decisions(difficulty);
CREATE INDEX ai_decisions_round_idx ON ai_decisions(game_id, round_number);
```

### Decision Types and Results

| decision_type | decision_result values | card fields used |
|---|---|---|
| `free_take` | `took` / `declined` | card that was offered |
| `draw` | `took_discard` / `drew_pile` | card taken (if discard) |
| `buy` | `bought` / `passed` | card offered |
| `discard` | `discarded` | card discarded |
| `go_down` | `went_down` / `held` | null |
| `lay_off` | `laid_off` / `no_target` | card laid off |
| `joker_swap` | `swapped` / `skipped` | natural card used for swap |
| `denial_take` | `denied` / `skipped` | card denied |
| `denial_buy` | `denied` / `skipped` | card denied |

### The Outcome Columns — The Key Innovation

The outcome columns (`card_used_in_meld`, `card_still_in_hand_at_round_end`, etc.) are NOT filled at decision time. They're backfilled at the END of the round when we know the actual outcome.

This lets you ask: "Of all the cards Hard AI took from the discard pile, what percentage actually ended up in melds?" If that number is low, the AI is making bad take decisions. If it's high, the AI is being selective correctly.

**How to backfill:**
At round end, for each player, loop through their `ai_decisions` for that round:
- For `draw` decisions where `decision_result = 'took_discard'`: check if that card is in the player's melds or was laid off → set `card_used_in_meld` or `card_laid_off`. If still in hand → set `card_still_in_hand_at_round_end = true` and `points_contributed = cardPoints(rank)`.
- For `buy` decisions where `decision_result = 'bought'`: same check.
- For `discard` decisions: check if any opponent used that card (laid it off, bought it). This tells you if the discard was "safe" or "dangerous."

---

## Layer 2: `player_round_stats` — Per-Player-Per-Round Summary

One row per player per round. Computed at round end. This is the main table for the in-app dashboard.

```sql
CREATE TABLE player_round_stats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  player_name text NOT NULL,
  is_human boolean NOT NULL DEFAULT false,
  difficulty text,                             -- null for humans

  -- Round outcome
  round_score integer NOT NULL,
  went_out boolean DEFAULT false,
  went_down boolean DEFAULT false,
  shanghaied boolean DEFAULT false,
  
  -- Timing
  total_turns integer,                         -- how many turns this player had
  turn_went_down integer,                      -- which turn they went down (null if never)
  turns_held_before_going_down integer,         -- turns where they COULD go down but chose to wait (Hard AI)
  
  -- Draw decisions
  free_takes integer DEFAULT 0,                -- times took free discard
  free_declines integer DEFAULT 0,             -- times declined free discard
  pile_draws integer DEFAULT 0,                -- times drew from pile
  discard_take_rate numeric,                   -- free_takes / (free_takes + free_declines) * 100
  
  -- Card acquisition quality
  cards_taken_used_in_meld integer DEFAULT 0,  -- taken discards that ended up in melds
  cards_taken_wasted integer DEFAULT 0,        -- taken discards still in hand at round end
  take_accuracy numeric,                       -- cards_taken_used_in_meld / total taken * 100
  
  -- Buying
  buys_made integer DEFAULT 0,
  buys_passed integer DEFAULT 0,
  buy_opportunities integer DEFAULT 0,         -- times offered a buy
  cards_bought_used_in_meld integer DEFAULT 0,
  cards_bought_wasted integer DEFAULT 0,
  buy_accuracy numeric,
  
  -- Discarding quality
  discards_fed_to_opponents integer DEFAULT 0, -- discards that opponents used (laid off, bought)
  discards_safe integer DEFAULT 0,             -- discards nobody used
  discard_safety_rate numeric,                 -- discards_safe / total discards * 100
  
  -- Denial
  denial_takes integer DEFAULT 0,              -- cards taken specifically to deny opponents
  denial_buys integer DEFAULT 0,
  
  -- Melding
  melds_laid_down integer DEFAULT 0,
  bonus_melds integer DEFAULT 0,
  lay_offs_made integer DEFAULT 0,
  joker_swaps integer DEFAULT 0,
  
  -- Hand management
  hand_size_when_went_down integer,            -- how many cards left after going down
  final_hand_size integer,                     -- cards in hand when round ended
  final_hand_points integer,                   -- point value of remaining cards
  
  -- Scenario tracking
  scenario_b_triggers integer DEFAULT 0,       -- bonus meld reversals
  scenario_c_triggers integer DEFAULT 0,       -- lay-off reversals

  created_at timestamptz DEFAULT now()
);

CREATE INDEX prs_game_idx ON player_round_stats(game_id);
CREATE INDEX prs_difficulty_idx ON player_round_stats(difficulty);
CREATE INDEX prs_round_idx ON player_round_stats(round_number);
CREATE UNIQUE INDEX prs_unique ON player_round_stats(game_id, round_number, player_name);
```

---

## Layer 3: `player_game_stats` — Per-Player-Per-Game Summary

One row per player per game. Computed at game end. Fastest queries for leaderboard-style analysis.

```sql
CREATE TABLE player_game_stats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  is_human boolean NOT NULL DEFAULT false,
  difficulty text,

  -- Game outcome
  total_score integer NOT NULL,
  final_rank integer NOT NULL,                 -- 1 = winner
  won boolean DEFAULT false,
  
  -- Round-level aggregates
  rounds_won integer DEFAULT 0,                -- rounds where they went out (score 0)
  rounds_shanghaied integer DEFAULT 0,
  rounds_went_down integer DEFAULT 0,
  avg_score_per_round numeric,
  worst_round_score integer,
  best_round_score integer,
  
  -- Decision quality aggregates
  overall_take_accuracy numeric,               -- % of taken discards that ended up in melds
  overall_buy_accuracy numeric,
  overall_discard_safety_rate numeric,
  avg_turns_to_go_down numeric,
  
  -- Resource usage
  total_buys_made integer DEFAULT 0,
  total_denial_actions integer DEFAULT 0,
  total_lay_offs integer DEFAULT 0,
  total_joker_swaps integer DEFAULT 0,
  
  -- Timing
  avg_turn_went_down numeric,                  -- average turn number when going down
  times_held_going_down integer DEFAULT 0,     -- rounds where AI could go down but waited

  created_at timestamptz DEFAULT now()
);

CREATE INDEX pgs_game_idx ON player_game_stats(game_id);
CREATE INDEX pgs_difficulty_idx ON player_game_stats(difficulty);
CREATE INDEX pgs_player_idx ON player_game_stats(player_name);
CREATE UNIQUE INDEX pgs_unique ON player_game_stats(game_id, player_name);
```

---

## Key Analytics Queries

### "Is Hard AI actually better than Medium?"
```sql
SELECT difficulty,
  COUNT(CASE WHEN won THEN 1 END) as wins,
  COUNT(*) as games,
  ROUND(COUNT(CASE WHEN won THEN 1 END) * 100.0 / COUNT(*), 1) as win_pct,
  ROUND(AVG(total_score), 1) as avg_total_score,
  ROUND(AVG(rounds_shanghaied), 1) as avg_times_shanghaied
FROM player_game_stats
WHERE is_human = false
GROUP BY difficulty
ORDER BY avg_total_score;
```

### "Which rounds are hardest?"
```sql
SELECT round_number,
  ROUND(AVG(round_score), 1) as avg_score,
  ROUND(AVG(CASE WHEN shanghaied THEN 1.0 ELSE 0 END) * 100, 1) as shanghai_pct,
  ROUND(AVG(total_turns), 1) as avg_turns
FROM player_round_stats
GROUP BY round_number
ORDER BY round_number;
```

### "Is the AI making good take decisions?"
```sql
SELECT difficulty, round_number,
  SUM(cards_taken_used_in_meld) as cards_used,
  SUM(cards_taken_wasted) as cards_wasted,
  ROUND(SUM(cards_taken_used_in_meld) * 100.0 / 
    NULLIF(SUM(cards_taken_used_in_meld) + SUM(cards_taken_wasted), 0), 1) as accuracy_pct
FROM player_round_stats
WHERE is_human = false
GROUP BY difficulty, round_number
ORDER BY difficulty, round_number;
```

### "Is the AI making good take decisions in RUN rounds specifically?"
```sql
SELECT difficulty,
  SUM(cards_taken_used_in_meld) as used,
  SUM(cards_taken_wasted) as wasted,
  ROUND(SUM(cards_taken_used_in_meld) * 100.0 / 
    NULLIF(SUM(cards_taken_used_in_meld) + SUM(cards_taken_wasted), 0), 1) as accuracy
FROM player_round_stats
WHERE is_human = false AND round_number IN (3, 7)  -- pure run rounds
GROUP BY difficulty;
```

### "Are my discards feeding opponents?"
```sql
SELECT player_name,
  SUM(discards_fed_to_opponents) as fed,
  SUM(discards_safe) as safe,
  ROUND(SUM(discards_safe) * 100.0 / 
    NULLIF(SUM(discards_fed_to_opponents) + SUM(discards_safe), 0), 1) as safety_pct
FROM player_round_stats
GROUP BY player_name
ORDER BY safety_pct DESC;
```

### "Is buying worth it?"
```sql
SELECT 
  CASE WHEN total_buys_made >= 3 THEN 'heavy buyer (3+)'
       WHEN total_buys_made >= 1 THEN 'light buyer (1-2)'
       ELSE 'no buys' END as buy_category,
  COUNT(*) as games,
  ROUND(AVG(total_score), 1) as avg_score,
  ROUND(AVG(final_rank), 2) as avg_rank
FROM player_game_stats
GROUP BY buy_category
ORDER BY avg_score;
```

### "What specific decisions is Hard AI getting wrong?"
```sql
SELECT reason, decision_result,
  COUNT(*) as times,
  SUM(CASE WHEN card_used_in_meld THEN 1 ELSE 0 END) as used,
  SUM(CASE WHEN card_still_in_hand_at_round_end THEN 1 ELSE 0 END) as wasted,
  SUM(COALESCE(points_contributed, 0)) as total_points_wasted
FROM ai_decisions
WHERE difficulty = 'hard' AND decision_type IN ('draw', 'buy') AND decision_result IN ('took_discard', 'bought')
GROUP BY reason, decision_result
ORDER BY total_points_wasted DESC;
```

This tells you exactly WHICH reasons lead to wasted cards. If "gap-fill in hearts run" has 80% accuracy but "denial of opponent" has 20% accuracy, the denial logic needs tuning.

---

## In-App Dashboard Design

A new "Analytics" tab in the main navigation with 4 sections:

### Section 1: AI Performance
- Win rate by difficulty (bar chart)
- Average score by difficulty (bar chart)
- Shanghai rate by difficulty
- Trend line: are scores improving over time as you tune the AI?

### Section 2: Decision Quality
- Take accuracy by difficulty (% of taken cards that ended up in melds)
- Buy accuracy by difficulty
- Discard safety rate by difficulty
- Round-by-round breakdown (which rounds have worst accuracy?)

### Section 3: Game Balance
- Average score by round (bar chart) — shows which rounds are hardest
- Shanghai rate by round
- Average turns per round
- Buy usage vs win rate correlation

### Section 4: Your Stats
- Your win rate vs each difficulty
- Your score trend over time
- Your best/worst rounds
- How you compare to each AI difficulty on decision metrics

---

## Implementation Plan

### Phase 1: Schema + Recording (Backend + Frontend)
1. Create the three tables in Supabase
2. Add `saveAIDecision()` to gameStore.ts — single insert, silent fail
3. Add `savePlayerRoundStats()` to gameStore.ts — called at round end
4. Add `savePlayerGameStats()` to gameStore.ts — called at game end
5. Wire recording into GameBoard.tsx:
   - Record each AI decision in the AI useEffect after each action
   - Record human decisions in event handlers (take, buy, discard)
   - At round end: backfill outcome columns, compute round stats
   - At game end: compute game stats

### Phase 2: Outcome Backfill Logic (AI Systems + Frontend)
1. At round end, before scoring:
   - For each player, look at their `ai_decisions` for this round
   - For each "took_discard" or "bought" decision, check if that card ID is in their melds or was laid off
   - Update the outcome columns
2. Track discards: when a player lays off a card onto a meld, check if that card was discarded by someone else earlier → mark the discarder's decision as "fed to opponent"

### Phase 3: Analytics Dashboard (Frontend)
1. Build the Analytics tab with the 4 sections above
2. Read from `player_round_stats` and `player_game_stats` for fast queries
3. Add drill-through: tap any stat to see the underlying data

### Phase 4: AI Improvement Loop
1. Play 10+ games with telemetry running
2. Run the SQL queries to find weak spots
3. Tune AI parameters based on data
4. Play 10 more games, compare metrics
5. Repeat

---

## Important: Silent Fail Everything

All telemetry writes must be fire-and-forget with try/catch. Telemetry should NEVER break gameplay. If Supabase is down or the table doesn't exist, the game continues normally.

```typescript
async function saveAIDecision(decision: AIDecision): Promise<void> {
  try {
    await supabase.from('ai_decisions').insert(decision)
  } catch {
    // silent — telemetry never breaks gameplay
  }
}
```

---

## What This Replaces

The existing `game_events` table can remain for backward compatibility, but the three new tables are the primary telemetry system. The new tables are structured for analysis, not just logging.
