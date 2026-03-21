# Shanghai Tracker — CLAUDE.md

## Project Overview

Progressive Web App (PWA) for playing and tracking Shanghai Rummy card games. Mobile-first, warm cream light theme, with a full digital card game (pass-and-play + AI), real-time score tracker multiplayer, and historical stats.

## Tech Stack

- **React 18** + **TypeScript 5** — UI layer
- **Vite 5** — build tool, dev server, PWA plugin
- **Tailwind CSS 3** — utility-first styling with warm cream/gold light theme
- **Supabase JS 2** — PostgreSQL backend, real-time subscriptions
- **Recharts** — score trend line charts
- **XLSX** — Excel/CSV import and export
- **date-fns** — date formatting and parsing
- **Lucide React** — icons

## Project Structure

```
src/
├── App.tsx                  # Root: section routing, scoreTrackerState machine, prop wiring
├── main.tsx                 # React entry point
├── index.css                # Tailwind directives + custom scrollbar/safe-area styles
├── lib/
│   ├── types.ts             # All TypeScript interfaces (score tracker + stats layer)
│   ├── constants.ts         # Round definitions, player colors, import templates
│   ├── supabase.ts          # Supabase client (reads VITE_SUPABASE_URL/ANON_KEY)
│   ├── gameStore.ts         # Every database operation (single module, no ORM)
│   └── haptics.ts           # haptic() utility — navigator.vibrate wrapper, silent no-op on iOS
├── game/                    # Digital card game engine (no Supabase calls)
│   ├── types.ts             # Card, Meld, RoundState, GameState, PlayerConfig
│   ├── deck.ts              # Deck creation, shuffle, deal
│   ├── meld-validator.ts    # Set/run/joker validation, round requirements, canLayOff
│   ├── scoring.ts           # Hand point calculation, Shanghai detection
│   ├── turn-manager.ts      # Draw, meld, lay-off, discard turn flow
│   ├── buy-manager.ts       # Buy requests, priority, penalty cards
│   ├── round-manager.ts     # Round setup and progression
│   ├── game-manager.ts      # Full game flow across 7 rounds
│   ├── rules.ts             # Point values, round requirement constants
│   └── ai.ts                # Medium + Hard AI: aiFindBestMelds, aiFindAllMelds, canFormAnyValidMeld,
│                            #   aiShouldTakeDiscard, aiChooseDiscard, aiChooseDiscardHard,
│                            #   aiShouldBuy, aiShouldBuyHard, aiFindLayOff, aiFindJokerSwap
├── hooks/
│   └── useRealtimeScores.ts # Supabase Realtime subscriptions for score tracker multiplayer
└── components/
    ├── HomePage.tsx          # Landing screen: 4 nav cards (Play, Score Tracker, Stats, Analytics) + HelpCircle tutorial button
    ├── AnalyticsPage.tsx     # Telemetry dashboard: Overview / AI Quality / Rounds / Decisions tabs
    ├── PlayTab.tsx           # Hosts play mode flow: GameSetup → GameBoard → GameOver
    ├── ScoreTrackerPage.tsx  # Score tracker home: game list, import/export
    ├── PlayerSetup.tsx       # Player selection + game date picker (score tracker)
    ├── ScoreEntry.tsx        # Round-by-round score input (7 rounds) + room code copy bar
    ├── GameSummary.tsx       # End-of-game results with winner highlight (score tracker)
    ├── GameCard.tsx          # Scorecard detail for a single game + game_type badge
    ├── StatsLeaderboard.tsx  # Stats tabs: leaderboard / trends / records; game-type filter
    ├── JoinGame.tsx          # Join a score-tracked game via SHNG-XXXX room code
    ├── ExportData.tsx        # Export all data to JSON or CSV
    ├── ImportData.tsx        # Bulk import games from Excel/CSV
    ├── DrilldownModal.tsx    # Reusable drilldown bottom sheet (z-60); 6 sub-view types; 3-level stack
    ├── PlayerProfileModal.tsx # Bottom-sheet player profile (z-50): stats, sparkline, H2H, game log
    ├── TutorialOverlay.tsx   # 4-slide first-run tutorial + useTutorial hook (localStorage gate)
    └── play/                 # Digital game UI
        ├── GameSetup.tsx     # 2–8 players, Human/AI toggle per slot, name autocomplete, difficulty selector
        ├── GameBoard.tsx     # Main game board: hand, melds, piles, AI automation, pause
        ├── GameOver.tsx      # End-of-game results + auto-save badge
        ├── Card.tsx          # Card component: suit tints, haptic on tap
        ├── MeldModal.tsx     # Step-through meld builder: required melds → bonus-prompt → bonus phase
        └── HandDisplay.tsx   # Scrollable hand with controlled sort (Rank / Suit) + fade gradient

supabase/
├── add_game_type.sql         # Migration: ALTER TABLE games ADD COLUMN game_type text DEFAULT 'manual'
└── add_shanghai_events.sql   # Migration: CREATE TABLE shanghai_events (optional, for future tracking)
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
```

## Database (Supabase)

Seven tables — no row-level security (public anon key access):

| Table | Key columns |
|-------|-------------|
| `players` | `id`, `name`, `created_at` |
| `games` | `id`, `date`, `room_code`, `notes`, `is_complete`, `game_type`, `created_at` |
| `game_scores` | `id`, `game_id`, `player_id`, `round_scores` (number[]), `total_score` (generated) |
| `shanghai_events` | `id`, `game_id`, `player_id`, `round_number`, `created_at` (optional) |
| `ai_decisions` | `id`, `game_id`, `round_number`, `turn_number`, `player_name`, `decision_type`, `decision_result`, ... (telemetry) |
| `player_round_stats` | `id`, `game_id`, `round_number`, `player_name`, `round_score`, `went_out`, `went_down`, ... (per-round summary) |
| `player_game_stats` | `id`, `game_id`, `player_name`, `total_score`, `final_rank`, `won`, ... (per-game summary) |

All DB access goes through `src/lib/gameStore.ts`. Never call Supabase directly from components.

Key functions: `getPlayers`, `upsertPlayer`, `createGame(playerIds, date, gameType?)`, `getGame`, `getCompletedGames`, `updateRoundScore`, `saveAllRoundScores`, `completeGame`, `deleteGame`, `updateGame`, `importGame`, `savePlayedGame(players, date, gameType)`, `saveShanghaiEvents(gameId, roundNumber, playerIds)`, `computeWinner`, `generateRoomCode`.

Telemetry functions (fire-and-forget, never break gameplay): `saveAIDecisions`, `backfillDecisionOutcomes`, `savePlayerRoundStats`, `savePlayerGameStats`.

Telemetry read functions (used by AnalyticsPage): `getPlayerRoundStats(limit?)`, `getPlayerGameStats(limit?)`, `getAIDecisions(limit?)`.

## Play Mode

Play mode (`section === 'play'`) runs entirely in `PlayTab` → `GameBoard`. State machine:

```
GameSetup (PlayerConfig[] configured)
  → GameBoard (full game engine, AI automation)
    → GameOver (auto-save → savePlayedGame())
```

- **`PlayerConfig`** — `{ name: string; isAI: boolean }` — in `src/game/types.ts`
- **`AIDifficulty`** — `'easy' | 'medium' | 'hard'` — exported from `src/game/types.ts`; passed from `GameSetup` → `PlayTab` → `GameBoard` prop (`aiDifficulty?: AIDifficulty`, default `'medium'`)
  - Easy: never buys/takes discard, discards highest-value card, lays down required melds only
  - Medium: commits to top-2 suits for runs, run-aware drawing/buying/discarding
  - Hard: all Medium + joker swaps, unlimited lay-offs, very aggressive buying
- **AI automation** — two `useEffect` blocks in `GameBoard` watch `uiPhase` + `currentPlayer.isAI`. Uses `useRef` refs (`gameStateRef`, `uiPhaseRef`, `buyerOrderRef`, `buyerStepRef`, `pendingBuyDiscardRef`, `buyingIsPostDrawRef`) to read fresh state inside `setTimeout` callbacks without stale closures.
- **Game speed** — `gameSpeed: 'fast' | 'normal' | 'slow'` state in `GameBoard`; toggleable from pause menu. Controls AI action delays.
- **Dark table** — GameBoard uses `bg-[#1a3a2a]` (dark green felt) for the game screen; all text/icons adjusted for dark background.
- **Fan hand layout** — `HandDisplay` uses absolute positioning with overlap offset computed by hand size. All cards visible without scrolling. Selected cards lift via Card's `-translate-y-3`.
- **Rule 9A** — After any non-going-out discard, game advances to next player for a free draw decision. If they draw from pile, `startBuyingWindowPostDraw()` opens buying for remaining players. `buyingIsPostDrawRef` tracks this mode; after buying resolves the drew-player goes to action phase directly.
- **`nextPhaseForPlayer(player)`** — returns `'draw'` for AI (skips privacy screen), `'privacy'` for humans.
- **`aiLayOffDoneRef`** — ref in `GameBoard`; Medium AI is capped at 1 lay-off per turn before being forced to discard, **except** when `player.hand.length === 1` — the final going-out lay-off is always allowed. Hard AI has no cap.
- **`aiActionTick`** — state counter bumped after Hard AI joker swaps (hand length unchanged, so this re-triggers the AI action effect).
- **Extra melds rule** — `MeldModal` has a 3-phase flow: `required` → `bonus-prompt` → `bonus`. After the required melds are confirmed, `canFormAnyValidMeld` checks remaining cards; if a bonus meld is possible the player is prompted. AI uses `aiFindAllMelds` (finds required + all bonus melds greedily).
- **Sort order in MeldModal** — `GameBoard` owns `handSort` state; passes it to `HandDisplay` (controlled) and passes `sortedCurrentHand` to `MeldModal` so both show cards in the same order.
- **Undo discard** — 3s timer after human discard; buying window not started until timer expires or undo tapped.
- **Draw pile reshuffle** — when empty, all discard cards except the top are shuffled into a new draw pile.

## Drilldown System

Every stat number in `StatsLeaderboard` and `PlayerProfileModal` is tappable. Tapping opens a `DrilldownModal` (z-60, above PlayerProfileModal at z-50).

- **`DrilldownView`** — discriminated union in `types.ts` with 6 variants: `game-list`, `game-scorecard`, `score-history`, `zero-rounds`, `win-streak`, `improvement`
- **`DrilldownModal`** — takes a `stack: DrilldownView[]`, `onPush`, `onPop`, `onClose`, `onPlayerClick` props. Manages its own slide-up animation.
- **`drilldownStack`** — local `useState` in each host component (`StatsLeaderboard`, `PlayerProfileModal`). No App.tsx threading needed.
- **`DS` button** — local helper component in each host; renders a dotted-underline button that calls `stopPropagation` then `pushDrilldown`.
- **Data** is pre-packaged into `DrilldownView` objects inline — no additional Supabase calls on drill.
- **`getWinStreakGames()`** in `StatsLeaderboard` returns actual `GameWithScores[]` for the streak (used by both win-streak drilldown and `getWinStreak()` count).
- **`getImprovement()`** returns `firstGames`/`lastGames` arrays alongside averages so the improvement drilldown has its source data.

## Analytics Dashboard

`AnalyticsPage` (`section === 'analytics'`) — self-contained telemetry viewer. Fetches data once on mount via `getPlayerRoundStats`, `getPlayerGameStats`, `getAIDecisions` from gameStore. All computation is client-side with `useMemo`.

Four tabs:
- **Overview** — game/round/decision counts, win rates by difficulty, shanghai rates
- **AI Quality** — Recharts bar charts: avg score, take accuracy, shanghai rate, going-down timing by difficulty; decision breakdown table
- **Rounds** — performance by round number (1–7); rounds 3 & 7 highlighted as pure-run rounds; difficulty ranking
- **Decisions** — filterable by difficulty + decision type; outcome summary, reason breakdown table, recent decisions list

Warm cream theme (not dark table). Uses `safe-top` for header padding.

## Game Rules (Shanghai Rummy)

- 7 rounds total; lowest cumulative score wins
- Rounds 1–4: 10 cards; Rounds 5–7: 12 cards
- A score of 0 for a round = "Out!" (went out first)
- Round requirements defined in `src/lib/constants.ts` (`ROUNDS` array)
- 5 buys per player **per round** (resets to 5 at the start of each new round)
- Players **must** meet the minimum round requirement to lay down, but **may** lay down additional valid melds beyond the requirement — extra melds must match the **round type** (sets-only round = extra sets only; runs-only round = extra runs only; mixed round = either)
- Aces can be used **ace-low** (A-2-3-4) or **ace-high** (...Q-K-A) in runs; lay-off at either end of a run is allowed
- **Going out** is ONLY possible by melding or laying off ALL remaining cards — discarding your last card does NOT end the round. Going out is checked after meld/lay-off, never after discard. A player with 1 card they can't lay off is "stuck" — they draw on their next turn and try again.
- **Joker swaps are from RUNS only** — jokers in sets cannot be swapped (their suit is ambiguous). Only jokers in runs have a fixed identity (position-based) and can be replaced by the natural card they represent. `findSwappableJoker` enforces this.
- The next player in turn order gets **first right** to take a discarded card as their normal draw (no buy used). Only if they draw from the pile does a buying window open for the remaining players.

## Key Conventions

- **State lives in `App.tsx`** — no Context or Redux. Components receive props.
- **`section`** drives top-level navigation: `'home' | 'play' | 'scoretracker' | 'stats' | 'analytics'`
- **`scoreTrackerState`** drives the score tracker sub-machine: `'list' | 'setup' | 'playing' | 'summary' | 'joining'`
- **Play mode state** is self-contained in `GameBoard` — does not touch App.tsx.
- **Player colors** are assigned deterministically from `PLAYER_COLORS` in constants.
- **Room codes** use format `SHNG-XXXX` (4 random uppercase chars).
- **Winner** = player with the lowest total score (`computeWinner()` in gameStore.ts).
- **Dates** are stored as ISO strings; displayed with date-fns, no timezone conversion.
- **Import** groups rows by date + notes to reconstruct individual games.
- **No test runner** is configured — there are no tests in this project.
- **`onPlayerClick`** is threaded from `App.tsx` → `StatsLeaderboard`, `GameSummary` to open `PlayerProfileModal`. Also passed into `DrilldownModal` so player names in drilldown views are tappable.
- **`total_score`** is a generated column in Supabase — never insert or update it directly.
- **`created_by`** column does not exist in the `games` table — do not reference it.
- **Score entry** only saves rounds 0..currentRound to avoid zero-filling future rounds on realtime sync.
- **`game_type`** values: `'manual'` (score tracker), `'pass-and-play'` (play mode, all human), `'ai'` (play mode with AI). Legacy rows may be `null`.
- **`saveShanghaiEvents()`** silently no-ops if the `shanghai_events` table doesn't exist.
- **`haptic(type)`** — call with `'tap' | 'success' | 'error' | 'heavy'`; silent no-op on iOS/desktop.

## Theme

Light "warm cream" theme. Do not reintroduce dark backgrounds.

| Token | Hex | Usage |
|-------|-----|-------|
| Page bg | `#f8f6f1` | `body` background |
| Card bg | `#ffffff` | `.card` (+ `box-shadow: 0 1px 3px rgba(0,0,0,0.06)`) |
| Secondary surface | `#efe9dd` | Stat boxes, pill containers, secondary buttons |
| Border | `#e2ddd2` | All borders |
| Primary text | `#2c1810` | Body copy, headings |
| Secondary text | `#8b7355` | Subtext, labels |
| Tertiary text | `#a08c6e` | Section headers, placeholders |
| Accent gold (text) | `#8b6914` | Icons, highlights, active states |
| Accent gold (fill) | `#e2b858` | `.btn-primary` bg, chips |
| Green | `#2d7a3a` | "Out!", positive stats |
| Red | `#b83232` | Errors, negative stats |
| Blue (compare B) | `#1d7ea8` | Head-to-head player B color |

Suit backgrounds (cards): hearts `#fff0f0` pink, diamonds `#f0f5ff` blue, clubs `#e0f7e8` strong green, spades `#eeecff` lavender. Text: hearts `#c0393b`, diamonds `#2158b8`, clubs `#1a6b3a`, spades `#3d2b8e`.

Game table background: `bg-[#1a3a2a]` (dark green felt). Top bar: `bg-[#0f2218]`. In-game secondary surface: `bg-[#1e4a2e]`. In-game text: white / `#a8d0a8` / `#6aad7a`.

Tab pill pattern: container `bg-[#efe9dd]`, active `bg-white text-[#8b6914] shadow-sm`, inactive `text-[#8b7355]`.

## Deployment

Deployed on Vercel. `vercel.json` rewrites all routes to `index.html` for SPA routing. PWA manifest generated by `vite-plugin-pwa` with Workbox caching (Supabase API responses cached 24h).
