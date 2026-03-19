# Shanghai — Backend Agent

## Your Role
You are the Backend agent. You own the Supabase database layer, real-time sync, and all data persistence. The game engine runs entirely in memory — you only touch data when saving completed games or syncing the score tracker.

## Your Law
GDD Section 10 defines scoring. GDD Section 4.1 defines game settings that must be persisted. Your job is to make sure the data model correctly stores what the game engine produces.

## Files You Own
```
src/lib/gameStore.ts
src/lib/supabase.ts
supabase/*.sql
```

## Files You May Read (never edit)
```
src/game/types.ts     — game engine types
src/lib/types.ts      — score tracker types
```

## Files You Must Never Touch
- Any .tsx component file
- Any src/game/ file
- src/lib/haptics.ts

---

## Database Schema (Current)

```sql
players        — id, name, created_at
games          — id, date, room_code, notes, is_complete, game_type, created_at
game_scores    — id, game_id, player_id, round_scores (number[]), total_score (generated)
shanghai_events — id, game_id, player_id, round_number, created_at
```

## Required Changes

### 1. Add buy_limit to games table
GDD Section 4.1 introduces a configurable buy limit. This must be stored with each game so stats and replays know what rules were used.

```sql
ALTER TABLE games ADD COLUMN buy_limit integer DEFAULT 5;
```

Add this to the migration file: `supabase/add_buy_limit.sql`

Update `createGame()` in gameStore.ts to accept and store `buyLimit`.
Update `savePlayedGame()` to include `buyLimit` when saving play-mode games.

### 2. Scoring values have changed
The score tracker stores raw round_scores entered by users — no change needed there. But `savePlayedGame()` saves computed scores from play mode. Verify it uses the game engine's `scoreRound()` function which now uses the correct GDD values (2–9=5, 10/J/Q/K=10, Ace=15, Joker=25). No schema change needed — just confirm the correct values flow through.

### 3. Shanghai events tracking
The `shanghai_events` table exists but `saveShanghaiEvents()` is not wired to play mode. When a round ends and a player was Shanghaied (hasLaidDown === false), save that event.

In `savePlayedGame()` or the game-over flow, after saving scores, call:
```typescript
saveShanghaiEvents(gameId, roundNumber, shanghaiedPlayerIds)
```

---

## Key Functions in gameStore.ts

Keep these signatures stable — components depend on them:

```typescript
createGame(playerIds: string[], date: string, gameType?: string, buyLimit?: number): Promise<Game>
savePlayedGame(players, date, gameType, buyLimit?: number): Promise<void>
getGame(gameId: string): Promise<GameWithScores>
getCompletedGames(): Promise<GameWithScores[]>
saveAllRoundScores(gameId, playerId, scores): Promise<void>
computeWinner(game: GameWithScores): GameScore
generateRoomCode(): string
```

---

## Rules You Must Follow

- `total_score` is a GENERATED column in Supabase — never insert or update it directly
- `created_by` column does NOT exist — never reference it
- Score entry only saves rounds 0..currentRound — never zero-fill future rounds
- All DB access goes through gameStore.ts — components never call Supabase directly
- Room codes use format SHNG-XXXX (4 random uppercase chars)

---

## Output Contract
After your changes:
- `supabase/add_buy_limit.sql` migration file exists
- `createGame()` accepts optional `buyLimit` parameter (defaults to 5)
- `savePlayedGame()` stores `buy_limit` with the game record
- `saveShanghaiEvents()` is called when players are Shanghaied at round end
- All existing functions maintain their current signatures
