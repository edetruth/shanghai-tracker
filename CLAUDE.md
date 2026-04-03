# Shanghai Tracker — CLAUDE.md

## Project Overview

Progressive Web App (PWA) for playing and tracking Shanghai Rummy card games. Mobile-first, warm cream light theme, with a full digital card game (pass-and-play, AI, and online multiplayer), real-time score tracker multiplayer, and historical stats.

## Tech Stack

- **React 18** + **TypeScript 5** — UI layer
- **Vite 5** — build tool, dev server, PWA plugin
- **Tailwind CSS 3** — utility-first styling with warm cream/gold light theme
- **Zustand 5** — game state management (core game state in store, UI state in React)
- **Supabase JS 2** — PostgreSQL backend, real-time subscriptions
- **Recharts** — score trend line charts
- **XLSX** — Excel/CSV import and export
- **date-fns** — date formatting and parsing
- **Lucide React** — icons

## Project Structure

> For full file-level detail, use `Glob` and `Read` on the source tree. Below is the folder-level map.

```
src/
├── App.tsx              # Root: section routing, scoreTrackerState machine, prop wiring
├── main.tsx             # React entry point
├── index.css            # Tailwind directives + custom scrollbar/safe-area styles + animation keyframes
├── lib/                 # Shared utilities: types, constants, Supabase client, gameStore (all DB ops),
│                        #   haptics, sounds, notifications, achievements, actionLog, tournamentStore
├── game/                # Digital card game engine (no Supabase calls): types, deck, meld-validator,
│                        #   scoring, turn/buy/round/game managers, rules, ai.ts, opponent-model.ts
├── multiplayer/         # Online multiplayer: types, host/client logic, Realtime hooks (channel, lobby, heartbeat, ack)
├── stores/gameStore.ts  # Zustand store — core game state (gameState, uiPhase, buying, round flow)
├── hooks/               # useRealtimeScores, useTournamentChannel, useMultiplayerSync, useAIAutomation,
│                        #   useGameAudio, useGameAchievements, useActionLogger
└── components/
    ├── *.tsx            # Score tracker UI, stats, drilldowns, player profiles, import/export, tutorial
    └── play/            # Digital game UI: GameSetup, GameBoard (orchestrator), zone components
                         #   (TopBar, OpponentStrip, PileArea, HandArea, ActionBar, PauseMenu),
                         #   Card, MeldBuilder, HandDisplay, BuyingCinematic, cinematics, multiplayer views

supabase/                # SQL migrations
```

## Environment Variables

Required in `.env.local`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Common Commands

```bash
npm run dev       # Start dev server (http://localhost:5173)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
npm run lint      # ESLint check
npx vitest run    # Run all tests (1454 tests)
```

## Database (Supabase)

No row-level security (public anon key access):

| Table | Key columns |
|-------|-------------|
| `players` | `id`, `name`, `created_at` |
| `games` | `id`, `date`, `room_code`, `notes`, `is_complete`, `game_type`, `created_at` |
| `game_scores` | `id`, `game_id`, `player_id`, `round_scores` (number[]), `total_score` (generated) |
| `shanghai_events` | `id`, `game_id`, `player_id`, `round_number`, `created_at` (optional) |
| `ai_decisions` | `id`, `game_id`, `round_number`, `turn_number`, `player_name`, `decision_type`, `decision_result`, ... |
| `player_round_stats` | `id`, `game_id`, `round_number`, `player_name`, `round_score`, `went_out`, `went_down`, ... |
| `player_game_stats` | `id`, `game_id`, `player_name`, `total_score`, `final_rank`, `won`, ... |
| `game_rooms` | `id`, `room_code`, `host_player_id`, `status`, `game_id`, `created_at` |
| `game_room_players` | `id`, `room_id`, `player_name`, `is_ai`, `is_ready`, `is_connected`, `seat_index` |
| `player_achievements` | `id`, `player_name`, `achievement_id`, `unlocked_at` |
| `game_action_log` | `id`, `game_id`, `seq`, `player_index`, `action_type`, `action_data` (jsonb), `created_at` |
| `tournaments` | `id`, `code`, `host_name`, `player_count`, `format`, `status`, `created_at` |
| `tournament_matches` | `id`, `tournament_id`, `round_number`, `match_index`, `player_names` (text[]), `winner_name`, `room_code`, `status` |

All DB access goes through `src/lib/gameStore.ts` and `src/lib/tournamentStore.ts`. Never call Supabase directly from components. Read those files for the full function list (CRUD, multiplayer room ops, telemetry).

## Play Mode

Play mode (`section === 'play'`) runs entirely in `PlayTab` → `GameBoard` → `GameOver`.

**GameBoard architecture** — GameBoard.tsx is the orchestrator (~3,000 lines). Logic extracted into Zustand store (`src/stores/gameStore.ts`), hooks (`useAIAutomation`, `useMultiplayerSync`, `useGameAudio`, `useGameAchievements`, `useActionLogger`), and zone components (TopBar, OpponentStrip, PileArea, HandArea, ActionBar, PauseMenu, CinematicOverlays).

> For AI system details (evaluation, personalities, opponent awareness, meld-finding strategies, buying/take/discard logic), read `src/game/ai.ts` and `src/game/types.ts` directly. For cinematic/animation details, read the relevant component files and `src/index.css`. For buying window flow, read `BuyingCinematic.tsx` and `GameBoard.tsx`.

## Online Multiplayer

Host-authoritative architecture over Supabase Realtime Broadcast. Host runs the full game engine; remote players receive sanitized `RemoteGameView` (hand privacy enforced server-side) and send `PlayerAction` messages.

> For implementation details (state sync, action validation, buying timeouts), read `src/multiplayer/` files directly.

## Game Rules (Shanghai Rummy)

- 7 rounds total; lowest cumulative score wins
- Rounds 1-4: 10 cards dealt; Rounds 5-7: 12 cards dealt
- Round requirements defined in `src/lib/constants.ts` (`ROUNDS` array)
- A score of 0 for a round = "Out!" (went out first)
- 5 buys per player **per round** (resets each round)
- Players **must** meet the minimum round requirement to lay down — only required melds, no bonus/extra melds
- Aces can be **ace-low** (A-2-3-4) or **ace-high** (...Q-K-A) in runs; lay-off at either end allowed
- **Going out** requires melding or laying off ALL remaining cards — discarding your last card does NOT end the round
- **Joker swaps from RUNS only** — jokers in sets cannot be swapped (ambiguous suit). `findSwappableJoker` enforces this
- **Joker run bounds** — jokers may not extend a run below Ace-low or above Ace-high
- **Free take priority (Rule 9A)** — next player in turn order gets first right to take a discard as their normal draw (no buy used). Only if they decline does a buying window open for remaining players

## Key Conventions

- **App state lives in `App.tsx`** — no Context. Components receive props
- **Play mode state** uses **Zustand** (`src/stores/gameStore.ts`). UI-only state (selection, modals, animations) stays in component useState
- **`section`** drives top-level nav: `'home' | 'play' | 'scoretracker' | 'stats' | 'analytics'`
- **`scoreTrackerState`** drives score tracker sub-machine: `'list' | 'setup' | 'playing' | 'summary' | 'joining'`
- **`game_type`** values: `'manual'` (score tracker), `'pass-and-play'` (all human), `'ai'` (with AI), `'online'` (multiplayer). Legacy rows may be `null`
- **`mode` prop on GameBoard** — `'local'` (pass-and-play, default) or `'host'` (online multiplayer)
- **`total_score`** is a generated column in Supabase — never insert or update it directly
- **`created_by`** column does not exist in the `games` table — do not reference it
- **Score entry** only saves rounds 0..currentRound to avoid zero-filling future rounds on realtime sync
- **Play mode saves scores incrementally** — `saveRoundScores()` is called after every round end in `GameBoard.endRound()`. On the final round it also sets `is_complete: true`. `GameOver`'s save is a confirmation/retry, not the primary write path
- **`createPlayedGame()` returns `{ gameId, playerMap }`** — `playerMap` maps player names to Supabase UUIDs. Always pass `playerMap` through to `saveRoundScores`/`completePlayedGame` to avoid ambiguous name lookups (multiple "AI 2" records exist)
- **`saveShanghaiEvents()`** silently no-ops if the `shanghai_events` table doesn't exist
- **Room codes** use format `SHNG-XXXX` (4 random uppercase chars)
- **Winner** = player with lowest total score (`computeWinner()`)
- **Tests** use **Vitest**. Test files in `src/game/__tests__/`. Simulation benchmarks in `src/simulation/run.test.ts`
- **Remote players** never see other hands — privacy enforced via per-player `RemoteGameView`
- **AI runs on host only** — remote clients never execute AI logic

## Theme

Light "warm cream" theme. **Do not reintroduce dark backgrounds** outside the game table.

> For exact hex values, suit colors, and game table felt colors, read `src/index.css` and search for Tailwind classes in components. Key tokens: page bg `#f8f6f1`, accent gold `#e2b858`, game table `#1a3a2a`.

## Feature Reference

> These features are fully implemented. For implementation details, read the referenced source files directly.

- **Drilldown system** — tappable stats in `StatsLeaderboard`/`PlayerProfileModal` open `DrilldownModal` (z-60). 6 view types, 3-level stack. See `src/lib/types.ts` for `DrilldownView` union.
- **Analytics dashboard** — `AnalyticsPage.tsx`, 4 tabs (Overview, AI Quality, Rounds, Decisions). Client-side computation.
- **Sound system** — `src/lib/sounds.ts`, Web Audio API, 2 channels. Volume in localStorage.
- **Achievements** — `src/lib/achievements.ts`, 16 badges, 4 categories. Stored in `player_achievements`.
- **Emotes** — 8 preset reactions, broadcast via Supabase channel. Ephemeral, no DB storage.
- **Spectator mode** — `SpectatorBoard.tsx`, read-only view with all hands visible.
- **Game replay** — `ReplayViewer.tsx` + `game_action_log` table via `src/lib/actionLog.ts`.
- **Adaptive AI (Nemesis)** — `src/game/opponent-model.ts`, localStorage opponent models.
- **Tournaments** — `src/lib/tournamentStore.ts`, single elimination, `TRNY-XXXX` codes.
- **Notifications** — Browser Notification API (local only). `src/lib/notifications.ts`.

## Bug Fix SOP

When working on GitHub issues or bugs, follow this workflow:

1. **Diagnose** — investigate the root cause, identify affected code
2. **Propose** — present findings and fix plan to the user; **do not implement until approved**
3. **Implement** — make the changes, run `npx tsc --noEmit` and `npx vitest run` to verify
4. **Comment on the issue** — add a comment summarizing: root cause, what changed, and manual test steps
5. **Hand off for testing** — provide specific reproduction steps so the user can verify the fix on-device
6. **User tests and closes** — user confirms the fix; issue is closed after verification

## Deployment

Deployed on Vercel. `vercel.json` rewrites all routes to `index.html` for SPA routing. PWA manifest via `vite-plugin-pwa` with Workbox caching.

## Game Design Document (GDD)

The authoritative game rules and feature specification lives in `Shanghai_GDD_v1.3.md` at the project root. **Any code change that alters game rules, AI behavior, scoring, turn flow, multiplayer logic, or adds/removes a user-facing feature MUST be accompanied by a corresponding update to the GDD.** The GDD is the contract — it must always reflect the current state of the codebase. When updating the GDD, bump the revision history table at the bottom.
