# Shanghai Tracker

A mobile-first Progressive Web App for tracking Shanghai Rummy card game scores. Built for a regular group of players who wanted an easy way to record rounds, see stats over time, and settle "who's actually been winning" debates.

## Features

- **Score entry** — round-by-round input for 7 rounds, with "Out!" detection (score of 0) and validation to prevent multiple players going out in the same round
- **Game Night Recap** — end-of-game results with winner highlight, round MVPs, margin of victory, and a shareable text summary
- **Game history** — browse all past games, expand any scorecard, edit scores/dates after the fact, or delete a game
- **Stats leaderboard** — ranked table with podium for top 3, configurable minimum games filter, and a collapsible "Guests & newcomers" section
- **Trends** — bar chart of average scores, 5-game rolling average line chart per player (up to 5 visible at once), and a head-to-head comparison view
- **Records** — Champions board (Most Wins, Lowest Average, Best/Worst Single Game, Most Zeros, Longest Win Streak, Most Improved) and Hall of Shame
- **Drillable stats** — tap any stat number to drill into the source games; up to 3 levels deep with back navigation
- **Player profiles** — bottom-sheet modal with personal stats, sparkline, head-to-head summary, and full game log; tap any record to see the scorecard
- **Import / Export** — bulk import games from Excel or CSV; export everything to JSON or CSV for backup
- **Multiplayer (real-time)** — host generates a `SHNG-XXXX` room code; other devices join and see scores update live via Supabase Realtime
- **PWA** — installable on iOS/Android, works offline for browsing history and stats

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 18 + TypeScript 5 |
| Build | Vite 5 + vite-plugin-pwa |
| Styling | Tailwind CSS 3 |
| Backend | Supabase (PostgreSQL + Realtime) |
| Charts | Recharts |
| Import/Export | SheetJS (xlsx) |
| Icons | Lucide React |
| Date handling | date-fns |
| Deployment | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project with the schema below

### Database Schema

Create these three tables in your Supabase project:

```sql
create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  room_code text,
  notes text,
  is_complete boolean not null default false,
  created_at timestamptz default now()
);

create table game_scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id),
  round_scores integer[] not null default '{}',
  total_score integer generated always as (
    coalesce((select sum(s) from unnest(round_scores) s), 0)
  ) stored
);
```

### Installation

```bash
git clone https://github.com/edetruth/shanghai-tracker.git
cd shanghai-tracker
npm install
```

Create a `.env.local` file:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Development

```bash
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview the production build locally
npm run lint      # ESLint check
```

## Game Rules (Shanghai Rummy)

- 7 rounds total — lowest cumulative score wins
- Rounds 1–4 use 10 cards; Rounds 5–7 use 12 cards
- Going out first in a round scores **0** for that round ("Out!")
- Only one player can go out per round

Each round has a specific set requirement (two sets, a set and a run, etc.) defined in `src/lib/constants.ts`.

## Import Format

To bulk-import historical games, download the template from the Import screen and fill in one row per player per game:

| Date | Player | Round 1 | Round 2 | Round 3 | Round 4 | Round 5 | Round 6 | Round 7 | Notes |
|------|--------|---------|---------|---------|---------|---------|---------|---------|-------|
| 6/13/2025 | Cheryl | 10 | 10 | 5 | 5 | 0 | 5 | 10 | Game night |
| 6/13/2025 | George | 5 | 0 | 10 | 5 | 5 | 20 | 0 | Game night |

Rows with the same **Date + Notes** are grouped into one game. Accepts `.xlsx`, `.xls`, and `.csv`.

## Project Structure

```
src/
├── App.tsx                   # Root: tab switching, game state machine, prop wiring
├── lib/
│   ├── types.ts              # TypeScript interfaces
│   ├── constants.ts          # Round definitions, player colors, import headers
│   ├── supabase.ts           # Supabase client
│   └── gameStore.ts          # All database operations
├── hooks/
│   └── useRealtimeScores.ts  # Supabase Realtime subscription for multiplayer
└── components/
    ├── BottomNav.tsx          # Tab bar
    ├── PlayerSetup.tsx        # Player selection + game date
    ├── ScoreEntry.tsx         # Round-by-round score input
    ├── GameSummary.tsx        # End-of-game recap
    ├── GameHistory.tsx        # Past games list
    ├── GameCard.tsx           # Single game scorecard + edit
    ├── StatsLeaderboard.tsx   # Leaderboard / Trends / Records tabs
    ├── DrilldownModal.tsx     # Reusable drilldown bottom sheet
    ├── PlayerProfileModal.tsx # Per-player stats bottom sheet
    ├── ExportData.tsx         # JSON / CSV export
    ├── ImportData.tsx         # Excel / CSV bulk import
    └── JoinGame.tsx           # Join via room code
```

## Deployment

The app is deployed on Vercel. `vercel.json` rewrites all routes to `index.html` for client-side routing. The PWA service worker (generated by Workbox) caches Supabase API responses for 24 hours so stats are browsable offline after the first load.
