# Architecture

## Overview

Shanghai Tracker is a single-page PWA. There is no custom backend — all persistence and real-time sync are handled by Supabase (hosted PostgreSQL + Realtime websockets). The frontend is a React + TypeScript SPA built with Vite.

```
Browser (PWA)
  └── React SPA (src/)
        ├── App.tsx            ← orchestrates all state and navigation
        ├── Components         ← pure-ish UI, receive props/callbacks
        ├── gameStore.ts       ← all Supabase queries
        └── useRealtimeScores  ← Supabase Realtime subscription
              │
              ▼
        Supabase (PostgreSQL + Realtime)
              ├── players
              ├── games
              └── game_scores
```

## Layers

### 1. UI Layer — `src/components/`

Each component is responsible for a single screen or panel. They are mostly stateless, receiving data and callbacks via props from `App.tsx`. No component queries the database directly.

| Component | Responsibility |
|-----------|---------------|
| `BottomNav` | Tab navigation (new / history / stats) |
| `PlayerSetup` | Select players and date to start a game |
| `ScoreEntry` | Enter scores round by round during play |
| `GameSummary` | Show final rankings after game ends |
| `GameHistory` | Browse and delete completed games |
| `GameCard` | Expand a single game to see full scorecard |
| `StatsLeaderboard` | Leaderboard, trend charts, and records |
| `JoinGame` | Enter a room code to join another player's game |
| `ExportData` | Download all data as JSON or CSV |
| `ImportData` | Parse and bulk-import games from Excel/CSV |

### 2. App Orchestration — `src/App.tsx`

The root component owns all cross-component state:

- **Tab routing**: `activeTab` (`'new' | 'history' | 'stats'`)
- **Game state machine**: `gameState` (`'setup' | 'playing' | 'summary' | 'joining'`)
- **Active game data**: `activeGame`, `activePlayers`

It calls `gameStore` functions and passes results + callbacks down as props. There is no router library — tab switching is conditional rendering.

### 3. Data Access Layer — `src/lib/gameStore.ts`

Single module with all Supabase queries. Every DB operation in the app goes through here. Functions are plain async functions (not classes or hooks).

**Categories:**
- **Player ops**: `getPlayers()`, `upsertPlayer(name)` (case-insensitive dedup)
- **Game lifecycle**: `createGame()`, `getGame()`, `getGameByRoomCode()`, `completeGame()`, `deleteGame()`
- **Score ops**: `updateRoundScore()`, `saveAllRoundScores()`, `getCompletedGames()`
- **Bulk import**: `importGame()` — inserts a pre-filled game with all scores
- **Utility**: `generateRoomCode()` — creates unique `SHNG-XXXX` codes

### 4. Real-Time Layer — `src/hooks/useRealtimeScores.ts`

A custom hook that subscribes to `game_scores` and `games` table changes for a given `gameId` using Supabase Realtime (`postgres_changes` events). When an update arrives, it triggers a refresh callback passed in by `App.tsx`. Used to sync scores between devices during multiplayer.

### 5. Type Definitions — `src/lib/types.ts`

All shared interfaces:
- `Player` — id, name, created_at
- `Game` — id, date, room_code, notes, is_complete, created_by, created_at
- `GameScore` — id, game_id, player_id, round_scores (number[]), total_score, optional nested player
- `GameWithScores` — Game with `game_scores: GameScore[]`
- `PlayerStats` — aggregated stats computed client-side for the leaderboard

### 6. Constants — `src/lib/constants.ts`

- `ROUNDS` — array of 7 round definitions (card counts, names, descriptions)
- `PLAYER_COLORS` — deterministic color assignments for up to N players
- Import/export templates and column configurations

## Data Flow: Scoring a Round

```
User types score in ScoreEntry
  → calls updateRoundScore(gameId, playerId, roundIndex, score) from gameStore
  → Supabase updates game_scores row
  → Supabase Realtime fires postgres_changes event
  → useRealtimeScores hook receives event
  → triggers refreshGame() callback in App.tsx
  → App.tsx re-fetches game via getGame(gameId)
  → Updated data passed back down to ScoreEntry as props
```

## Data Flow: Importing Games

```
User uploads Excel/CSV file in ImportData
  → XLSX library parses file into row objects
  → Rows grouped by (date, notes) into game batches
  → For each game: importGame() called in gameStore
    → upsertPlayer() for each player name
    → createGame() then saveAllRoundScores() per player
  → Results shown (success count, errors)
```

## PWA & Caching

- **Vite PWA plugin** generates service worker and web manifest
- **Workbox** caches static assets (precache) and Supabase API responses (24h runtime cache)
- App is installable and partially functional offline (reads from cache)
- Service worker auto-updates on new deployment

## Build & Code Splitting

Vite manual chunks split vendor code into separate bundles:
- `react-vendor` — react, react-dom
- `recharts-vendor` — recharts
- `xlsx-vendor` — xlsx
- `supabase-vendor` — @supabase/supabase-js

## Deployment

Deployed to Vercel. All routes rewrite to `index.html` (configured in `vercel.json`). No server-side rendering.
