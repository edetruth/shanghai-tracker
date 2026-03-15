# Shanghai Tracker — CLAUDE.md

## Project Overview

Progressive Web App (PWA) for tracking Shanghai Rummy card game scores. Mobile-first, warm cream light theme, with real-time multiplayer and historical stats.

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
├── App.tsx                  # Root: tab switching, game state machine, prop wiring
├── main.tsx                 # React entry point
├── index.css                # Tailwind directives + custom scrollbar/safe-area styles
├── lib/
│   ├── types.ts             # All TypeScript interfaces
│   ├── constants.ts         # Round definitions, player colors, import templates
│   ├── supabase.ts          # Supabase client (reads VITE_SUPABASE_URL/ANON_KEY)
│   └── gameStore.ts         # Every database operation (single module, no ORM)
├── hooks/
│   └── useRealtimeScores.ts # Supabase Realtime subscriptions for multiplayer
└── components/
    ├── BottomNav.tsx         # Tab bar: New Game / History / Stats
    ├── PlayerSetup.tsx       # Player selection + game date picker
    ├── ScoreEntry.tsx        # Round-by-round score input (7 rounds)
    ├── GameSummary.tsx       # End-of-game results with winner highlight
    ├── GameHistory.tsx       # Completed games list with expand/delete
    ├── GameCard.tsx          # Scorecard detail for a single game
    ├── StatsLeaderboard.tsx  # Stats tabs: leaderboard / trends / records
    ├── JoinGame.tsx          # Join a game via SHNG-XXXX room code (button hidden in PlayerSetup, code intact)
    ├── ExportData.tsx        # Export all data to JSON or CSV
    ├── ImportData.tsx        # Bulk import games from Excel/CSV
    ├── DrilldownModal.tsx    # Reusable drilldown bottom sheet (z-60); 6 sub-view types; up to 3-level stack
    └── PlayerProfileModal.tsx # Bottom-sheet player profile (stats, sparkline, H2H, game log)
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

Three tables — no row-level security (public anon key access):

| Table | Key columns |
|-------|-------------|
| `players` | `id`, `name`, `created_at` |
| `games` | `id`, `date`, `room_code`, `notes`, `is_complete`, `created_by`, `created_at` |
| `game_scores` | `id`, `game_id`, `player_id`, `round_scores` (number[]), `total_score` |

All DB access goes through `src/lib/gameStore.ts`. Never call Supabase directly from components.

Key functions: `getPlayers`, `upsertPlayer`, `createGame`, `getGame`, `getCompletedGames`, `updateRoundScore`, `saveAllRoundScores`, `completeGame`, `deleteGame`, `updateGame`, `importGame`, `computeWinner`, `generateRoomCode`.

## Drilldown System

Every stat number in `StatsLeaderboard` and `PlayerProfileModal` is tappable. Tapping opens a `DrilldownModal` (z-60, above PlayerProfileModal at z-50).

- **`DrilldownView`** — discriminated union in `types.ts` with 6 variants: `game-list`, `game-scorecard`, `score-history`, `zero-rounds`, `win-streak`, `improvement`
- **`DrilldownModal`** — takes a `stack: DrilldownView[]`, `onPush`, `onPop`, `onClose`, `onPlayerClick` props. Manages its own slide-up animation.
- **`drilldownStack`** — local `useState` in each host component (`StatsLeaderboard`, `PlayerProfileModal`). No App.tsx threading needed.
- **`DS` button** — local helper component in each host; renders a dotted-underline button that calls `stopPropagation` then `pushDrilldown`.
- **Data** is pre-packaged into `DrilldownView` objects inline — no additional Supabase calls on drill.
- **`getWinStreakGames()`** in `StatsLeaderboard` returns actual `GameWithScores[]` for the streak (used by both win-streak drilldown and `getWinStreak()` count).
- **`getImprovement()`** returns `firstGames`/`lastGames` arrays alongside averages so the improvement drilldown has its source data.

## Game Rules (Shanghai Rummy)

- 7 rounds total; lowest cumulative score wins
- Rounds 1–4: 10 cards; Rounds 5–7: 12 cards
- A score of 0 for a round = "Out!" (went out first)
- Round requirements defined in `src/lib/constants.ts` (`ROUNDS` array)

## Key Conventions

- **State lives in `App.tsx`** — no Context or Redux. Components receive props.
- **`gameState` drives the UI**: `'setup' | 'playing' | 'summary' | 'joining'`
- **Player colors** are assigned deterministically from `PLAYER_COLORS` in constants.
- **Room codes** use format `SHNG-XXXX` (4 random uppercase chars).
- **Winner** = player with the lowest total score (`computeWinner()` in App.tsx).
- **Dates** are stored as ISO strings; displayed with date-fns, no timezone conversion.
- **Import** groups rows by date + notes to reconstruct individual games.
- **No test runner** is configured — there are no tests in this project.
- **`onPlayerClick`** is threaded from `App.tsx` → `StatsLeaderboard`, `GameHistory`, `GameSummary` to open `PlayerProfileModal`. Also passed into `DrilldownModal` so player names in drilldown views are tappable.
- **`total_score`** is a generated column in Supabase — never insert or update it directly.
- **`created_by`** column does not exist in the `games` table — do not reference it.
- **Score entry** only saves rounds 0..currentRound to avoid zero-filling future rounds on realtime sync.

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

Tab pill pattern: container `bg-[#efe9dd]`, active `bg-white text-[#8b6914] shadow-sm`, inactive `text-[#8b7355]`.

## Deployment

Deployed on Vercel. `vercel.json` rewrites all routes to `index.html` for SPA routing. PWA manifest generated by `vite-plugin-pwa` with Workbox caching (Supabase API responses cached 24h).
