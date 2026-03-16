# Shanghai Tracker

A mobile-first Progressive Web App for playing and tracking Shanghai Rummy card games. Play a full digital game against AI or friends, or use the score tracker for physical card games. Built for a regular group of players who wanted an easy way to record rounds, see stats over time, and settle "who's actually been winning" debates.

## Features

- **Play Game** — full digital Shanghai Rummy: cards dealt, turn-by-turn on one device (pass-and-play), with optional AI opponents per seat (2–8 players)
- **AI opponents** — Medium and Hard difficulty AI; add AI to any seat with a per-game difficulty selector (Easy coming soon)
- **Score entry** — round-by-round input for 7 rounds, with "Out!" detection (score of 0) and validation to prevent multiple players going out in the same round
- **Game Night Recap** — end-of-game results with winner highlight, round MVPs, margin of victory, and a shareable text summary
- **Game history** — browse all past games, expand any scorecard, edit scores/dates after the fact, or delete a game
- **Stats leaderboard** — ranked table with podium for top 3, configurable minimum games filter, game-type filter (All / Tracker / Played), and a collapsible "Guests & newcomers" section
- **Trends** — bar chart of average scores, 5-game rolling average line chart per player (up to 5 visible at once), and a head-to-head comparison view
- **Records** — Champions board (Most Wins, Lowest Average, Best/Worst Single Game, Most Zeros, Longest Win Streak, Most Improved) and Hall of Shame
- **Drillable stats** — tap any stat number to drill into the source games; up to 3 levels deep with back navigation
- **Player profiles** — bottom-sheet modal with personal stats, sparkline, head-to-head summary, and full game log; tap any record to see the scorecard
- **Import / Export** — bulk import games from Excel or CSV; export everything to JSON or CSV for backup
- **Multiplayer (real-time)** — host generates a `SHNG-XXXX` room code; other devices join via Score Tracker → Join Game and see scores update live via Supabase Realtime
- **Auto-save** — completed digital games are automatically saved to Supabase with a `game_type` tag (`pass-and-play` or `ai`)
- **Haptic feedback** — subtle vibration on taps, success, and errors (Android; silent no-op on iOS/desktop)
- **Tutorial overlay** — first-run onboarding slides; re-openable from the help button on the home screen
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

Create these tables in your Supabase project:

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
  game_type text not null default 'manual',  -- 'manual' | 'pass-and-play' | 'ai'
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

-- Optional: track "Shanghai" events (holding all cards when someone goes out)
create table if not exists shanghai_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  round_number int not null,
  created_at timestamptz not null default now()
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
- 5 buys per player per game (out-of-turn draw + penalty card from draw pile)

Each round has a specific set/run requirement defined in `src/lib/constants.ts`.

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
├── App.tsx                   # Root: section routing, score tracker state machine, prop wiring
├── main.tsx                  # React entry point
├── index.css                 # Tailwind directives + custom scrollbar/safe-area styles
├── lib/
│   ├── types.ts              # TypeScript interfaces (Game, Player, DrilldownView, etc.)
│   ├── constants.ts          # Round definitions, player colors, import headers
│   ├── supabase.ts           # Supabase client
│   ├── gameStore.ts          # All database operations
│   └── haptics.ts            # Haptic feedback utility (navigator.vibrate wrapper)
├── game/                     # Digital card game engine
│   ├── types.ts              # Card, Meld, RoundState, GameState, PlayerConfig
│   ├── deck.ts               # Deck creation, shuffle, deal
│   ├── meld-validator.ts     # Set/run/joker validation, round requirements
│   ├── scoring.ts            # Hand scoring, Shanghai detection
│   ├── turn-manager.ts       # Draw, meld, lay-off, discard turn flow
│   ├── buy-manager.ts        # Buy requests, priority, penalty cards
│   ├── round-manager.ts      # Round setup and progression
│   ├── game-manager.ts       # Full game flow across 7 rounds
│   ├── rules.ts              # Constants (point values, round requirements)
│   └── ai.ts                 # Medium + Hard AI (meld, discard, buy, joker-swap decisions)
├── hooks/
│   └── useRealtimeScores.ts  # Supabase Realtime subscription for score tracker multiplayer
└── components/
    ├── HomePage.tsx           # Landing screen with 3 navigation cards + help button
    ├── PlayTab.tsx            # Hosts play mode: GameSetup → GameBoard → GameOver
    ├── ScoreTrackerPage.tsx   # Score tracker home: game list, import/export
    ├── PlayerSetup.tsx        # Player selection + game date (score tracker)
    ├── ScoreEntry.tsx         # Round-by-round score input (7 rounds)
    ├── GameSummary.tsx        # End-of-game recap (score tracker)
    ├── GameCard.tsx           # Single game scorecard + edit
    ├── StatsLeaderboard.tsx   # Leaderboard / Trends / Records tabs
    ├── DrilldownModal.tsx     # Reusable drilldown bottom sheet (z-60, 6 sub-view types)
    ├── PlayerProfileModal.tsx # Per-player stats bottom sheet (z-50)
    ├── ExportData.tsx         # JSON / CSV export
    ├── ImportData.tsx         # Excel / CSV bulk import
    ├── JoinGame.tsx           # Join via SHNG-XXXX room code
    ├── TutorialOverlay.tsx    # First-run onboarding slides + useTutorial hook
    └── play/                  # Digital game UI components
        ├── GameSetup.tsx      # 2–8 player config, Human/AI toggle, name autocomplete, difficulty selector
        ├── GameBoard.tsx      # Main game board: hand, melds, discard pile, AI automation
        ├── GameOver.tsx       # End-of-game results + auto-save to Supabase
        ├── Card.tsx           # Card component with suit tints + haptic feedback
        └── HandDisplay.tsx    # Scrollable hand with sort toggle (Rank / Suit)

supabase/
├── add_game_type.sql          # Migration: adds game_type column to games table
└── add_shanghai_events.sql    # Migration: creates shanghai_events table
```

## Deployment

The app is deployed on Vercel. `vercel.json` rewrites all routes to `index.html` for client-side routing. The PWA service worker (generated by Workbox) caches Supabase API responses for 24 hours so stats are browsable offline after the first load.
