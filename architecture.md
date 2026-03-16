# Architecture

## Overview

Shanghai Tracker is a single-page PWA. There is no custom backend — all persistence and real-time sync are handled by Supabase (hosted PostgreSQL + Realtime websockets). The frontend is a React + TypeScript SPA built with Vite.

```
Browser (PWA)
  └── React SPA (src/)
        ├── App.tsx            ← orchestrates all state and navigation
        ├── Components         ← pure-ish UI, receive props/callbacks
        ├── Game Engine        ← card game logic (src/game/)
        ├── gameStore.ts       ← all Supabase queries
        └── useRealtimeScores  ← Supabase Realtime subscription
              │
              ▼
        Supabase (PostgreSQL + Realtime)
              ├── players
              ├── games          (+ game_type column)
              ├── game_scores
              └── shanghai_events  (optional — for future tracking)
```

## Layers

### 1. UI Layer — `src/components/`

Each component is responsible for a single screen or panel. They receive data and callbacks via props from `App.tsx` or their direct parent. No component queries the database directly.

| Component | Responsibility |
|-----------|---------------|
| `HomePage` | Landing screen — three navigation cards (Play / Score Tracker / Stats) + help button |
| `PlayTab` | Hosts the play mode flow: GameSetup → GameBoard → GameOver |
| `ScoreTrackerPage` | Score tracker home: game list, import/export, navigate to PlayerSetup |
| `PlayerSetup` | Select players and date to start a score-tracked game |
| `ScoreEntry` | Enter scores round by round during a score-tracked game; shows room code for multiplayer |
| `GameSummary` | Show final rankings after a score-tracked game ends |
| `GameCard` | Expand a single game to see full scorecard; supports inline editing |
| `StatsLeaderboard` | Leaderboard, trend charts, and records; game-type filter; drillable stats |
| `DrilldownModal` | Reusable bottom sheet (z-60) with 6 sub-view types and up to 3-level stack |
| `PlayerProfileModal` | Per-player stats bottom sheet (z-50): stat tiles, sparkline, H2H, game log |
| `JoinGame` | Enter a `SHNG-XXXX` room code to join another player's score-tracked game |
| `TutorialOverlay` | First-run onboarding slides (4 screens); `useTutorial` hook controls visibility |
| `ExportData` | Download all data as JSON or CSV |
| `ImportData` | Parse and bulk-import games from Excel/CSV |
| `play/GameSetup` | Configure a digital game: 2–8 players, Human/AI toggle per slot, name autocomplete, AI difficulty selector (Medium / Hard) |
| `play/GameBoard` | Main game board: hand display, discard pile, meld table, AI turn automation; owns `handSort` state passed to `HandDisplay` and `MeldModal` |
| `play/GameOver` | Final results for digital game + auto-save to Supabase with status badge |
| `play/Card` | Individual playing card with suit color tints and haptic feedback |
| `play/MeldModal` | Step-through meld builder: required phase → bonus-prompt → bonus phase; uses `canFormAnyValidMeld` to gate the bonus prompt |
| `play/HandDisplay` | Scrollable hand fan with controlled sort (Rank / Suit props from `GameBoard`) and fade gradient |

### 2. App Orchestration — `src/App.tsx`

The root component owns all cross-component state:

- **Section routing**: `section: 'home' | 'play' | 'scoretracker' | 'stats'`
- **Score tracker state machine**: `scoreTrackerState: 'list' | 'setup' | 'playing' | 'summary' | 'joining'`
- **Active game data**: `activeGame`, `activePlayers` (score tracker only; play mode owns its own state in `PlayTab`/`GameBoard`)
- **Selected player**: `selectedPlayerId` — drives `PlayerProfileModal` from any section
- **Tutorial visibility**: delegated to `useTutorial()` hook from `TutorialOverlay`

It calls `gameStore` functions and passes results + callbacks down as props. There is no router library — section switching is conditional rendering.

### 3. Game Engine Layer — `src/game/`

Self-contained card game logic for the digital play mode. Nothing in this layer touches Supabase; all DB interaction happens in `GameOver.tsx` via `gameStore.savePlayedGame()`.

| Module | Responsibility |
|--------|---------------|
| `types.ts` | `Card`, `Meld`, `RoundState`, `GameState`, `PlayerConfig` (`{ name, isAI }`), `AIDifficulty` (`'medium' \| 'hard'`) |
| `deck.ts` | Create deck(s), shuffle, deal |
| `meld-validator.ts` | Validate sets, runs, jokers, round requirements, lay-off eligibility |
| `scoring.ts` | Hand point calculation, Shanghai detection |
| `turn-manager.ts` | Draw, meld, lay-off, discard turn flow |
| `buy-manager.ts` | Buy requests, priority resolution, penalty cards |
| `round-manager.ts` | Round setup, deal, end-of-round scoring |
| `game-manager.ts` | Full game flow across 7 rounds |
| `rules.ts` | Point values, round requirements |
| `ai.ts` | Medium + Hard AI: `aiFindBestMelds`, `aiFindAllMelds`, `canFormAnyValidMeld`, `aiShouldTakeDiscard`, `aiChooseDiscard`, `aiChooseDiscardHard`, `aiShouldBuy`, `aiShouldBuyHard`, `aiFindLayOff`, `aiFindJokerSwap` |

### 4. Data Access Layer — `src/lib/gameStore.ts`

Single module with all Supabase queries. Every DB operation in the app goes through here. Functions are plain async functions (not classes or hooks).

**Categories:**
- **Player ops**: `getPlayers()`, `upsertPlayer(name)` (case-insensitive dedup)
- **Game lifecycle**: `createGame(playerIds, date, gameType?)`, `getGame()`, `getGameByRoomCode()`, `completeGame()`, `deleteGame()`, `updateGame()`
- **Score ops**: `updateRoundScore()`, `saveAllRoundScores()`, `getCompletedGames()`
- **Play mode**: `savePlayedGame(players, date, gameType)` — creates game + players + scores from a completed digital game in one call
- **Shanghai events**: `saveShanghaiEvents(gameId, roundNumber, playerIds)` — silently no-ops if table doesn't exist
- **Bulk import**: `importGame()` — inserts a pre-filled game with all scores
- **Utility**: `generateRoomCode()` — creates unique `SHNG-XXXX` codes, `computeWinner()`

### 5. Real-Time Layer — `src/hooks/useRealtimeScores.ts`

A custom hook that subscribes to `game_scores` and `games` table changes for a given `gameId` using Supabase Realtime (`postgres_changes` events). When an update arrives, it triggers a refresh callback. Used to sync scores between devices during score-tracker multiplayer.

### 6. Type Definitions — `src/lib/types.ts`

All shared interfaces for the score tracker and stats layers:
- `Player` — id, name, created_at
- `Game` — id, date, room_code, notes, is_complete, game_type, created_at
- `GameScore` — id, game_id, player_id, round_scores (number[]), total_score, optional nested player
- `GameWithScores` — Game with `game_scores: GameScore[]`
- `PlayerStats` — aggregated stats computed client-side for the leaderboard
- `DrilldownView` — discriminated union (6 variants: game-list, game-scorecard, score-history, zero-rounds, win-streak, improvement)

Game engine types live in `src/game/types.ts`:
- `Card`, `Meld`, `RoundState`, `GameState`, `BuyRequest`, `RoundRequirement`, `PlayerConfig`

### 7. Utilities — `src/lib/`

- `constants.ts` — `ROUNDS` (7 round definitions), `PLAYER_COLORS`, import/export templates
- `haptics.ts` — `haptic(type: 'tap' | 'success' | 'error' | 'heavy')` wrapper around `navigator.vibrate`; silent no-op on iOS/desktop
- `supabase.ts` — Supabase client (reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`)

## Data Flow: Scoring a Round (Score Tracker)

```
User types score in ScoreEntry
  → calls saveAllRoundScores(gameId, playerId, scores) from gameStore
  → Supabase updates game_scores row
  → Supabase Realtime fires postgres_changes event
  → useRealtimeScores hook receives event
  → triggers loadGame() callback in ScoreEntry
  → ScoreEntry re-fetches game via getGame(gameId)
  → Updated data re-renders locally
```

## Data Flow: Completing a Digital Game

```
GameOver component mounts
  → determines gameType: players.some(p => p.isAI) ? 'ai' : 'pass-and-play'
  → calls savePlayedGame(playerData, date, gameType) in gameStore
    → upsertPlayer() for each player name
    → createGame(playerIds, date, gameType)
    → saveAllRoundScores() per player
    → completeGame(gameId)
  → setSaveStatus('saved' | 'error')
  → Status badge shown (Loader → CheckCircle | AlertCircle)
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
