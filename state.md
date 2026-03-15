# State Management

## Philosophy

No global state library (no Redux, no Zustand, no Context API). All state lives in `App.tsx` and is passed down via props. This is intentional — the app is small enough that prop drilling is manageable and the added complexity of a state manager is unnecessary.

## State in App.tsx

```typescript
// Navigation
activeTab: 'new' | 'history' | 'stats'

// Game state machine
gameState: 'setup' | 'playing' | 'summary' | 'joining'

// Active game (null when not in a game)
activeGame: GameWithScores | null
activePlayers: Player[]
```

## Game State Machine

```
        ┌─────────────────────────────────────────┐
        │                                         │
        ▼                                         │
    [ setup ]                                     │
    PlayerSetup                                   │
        │ startGame() / joinGame()                │
        ▼                                         │
    [ playing ]                                   │
    ScoreEntry                                    │
        │ completeGame()                          │
        ▼                                         │
    [ summary ]                                   │
    GameSummary                                   │
        │ resetGame()                             │
        ▼                                         │
    [ setup ] ────────────────────────────────────┘

    [ joining ]  ← entered from BottomNav "Join" button
    JoinGame
        │ found room code → transition to [ playing ]
        │ cancel → back to [ setup ]
```

**Transitions:**
| From | To | Trigger |
|------|----|---------|
| `setup` | `playing` | User starts a new game (PlayerSetup → createGame) |
| `setup` | `joining` | User clicks "Join Game" |
| `joining` | `playing` | Valid room code found (getGameByRoomCode) |
| `joining` | `setup` | User cancels |
| `playing` | `summary` | All 7 rounds entered and game completed |
| `summary` | `setup` | User clicks "New Game" (resetGame) |

## Local Component State

Components manage their own ephemeral UI state with `useState`:

| Component | Local State |
|-----------|-------------|
| `PlayerSetup` | `knownPlayers` (DB fetch), `selectedPlayers` id list, `query` (typeahead text), `showSuggestions`, `date`, `loading`, `error` |
| `ScoreEntry` | `scores` (7×N string grid), `currentRound`, `saving`, `roundError` |
| `GameCard` | `expanded`, `confirming` (delete), `editing`, `editDate`, `editNotes`, `editScores` (Record\<playerId, string[]\>), `savingEdit` |
| `GameHistory` | `games` list, `loading`, `view` (list/export/import) |
| `StatsLeaderboard` | `view`, `games`, `minGames`, `alsoPlayedOpen`, `dateFilter`, `customStart`/`customEnd`, `trendsView`, `overtimeMode` (raw/rolling), `visiblePlayerIds`, `maxLinesWarning`, `compareA`/`compareB`, `drilldownStack` |
| `GameSummary` | `notes`, `saving`, `gameData` (fetched), `copied` |
| `PlayerProfileModal` | `games` (fetched), `loading`, `visible` (slide animation), `drilldownStack` |
| `ImportData` | `file`, `preview` rows, `importing` flag, `results` |
| `ExportData` | `exporting` flag |
| `JoinGame` | `roomCode` input, `loading`, `error` |

## Real-Time State Sync

`useRealtimeScores(gameId, onUpdate)` subscribes to Supabase Realtime for the duration of an active game.

- Watches: `game_scores` table changes filtered to `game_id=eq.{gameId}`
- Watches: `games` table changes (completion events)
- On any change: calls `onUpdate()` callback
- `onUpdate` in App.tsx re-fetches the full game from Supabase and updates `activeGame`

This means during multiplayer, all devices see score updates within ~1 second of entry, without polling.

**Lifecycle:**
```
useEffect → channel = supabase.channel(gameId)
  .on('postgres_changes', ..., onUpdate)
  .subscribe()

cleanup → supabase.removeChannel(channel)
```

## Data Fetching Pattern

Components do **not** fetch data themselves on mount (except standalone views: GameHistory, StatsLeaderboard). The pattern:

1. `App.tsx` calls `gameStore` functions and stores results in state
2. Results passed to components as props
3. Components call callback props to trigger mutations
4. After mutation, `App.tsx` re-fetches and updates its state

**Exception**: `GameHistory`, `StatsLeaderboard`, and `PlayerProfileModal` are self-contained — they fetch their own data on mount because they are read-only views not tied to the active game state.

## Score Update Flow (Detail)

```
ScoreEntry input change
  → local inputValues state updated (instant UI feedback)
  → debounced call to updateRoundScore(gameId, playerId, roundIndex, score)
  → Supabase write
  → Realtime event fires on all subscribed clients
  → onUpdate() → getGame(gameId) → setActiveGame(updated)
  → ScoreEntry re-renders with authoritative data from DB
```

This optimistic-ish pattern means the typing experience is smooth (local state) but the source of truth is always Supabase.

## Winner Computation

Winner is computed client-side in `App.tsx` via `computeWinner(game)`:

```typescript
// Lowest total_score wins
// Ties broken by... first in array (no explicit tiebreaker)
const winner = game.game_scores.reduce((a, b) =>
  a.total_score <= b.total_score ? a : b
)
```

This is recalculated on every render from `activeGame` — not stored separately.

---

## Change Log

### Fixed

**Game creation bug** (`gameStore.ts` — `createGame`) — 3 schema mismatches resolved:
1. `created_by` column does not exist in the `games` table → removed from insert; `createdBy` parameter also dropped from function signature.
2. `is_complete` is NOT NULL with no default → must be set explicitly; added `is_complete: false` to the `games` insert.
3. `total_score` is a **generated column** (computed by PostgreSQL from `round_scores`) → cannot be written; removed `total_score: 0` from the `game_scores` insert. The DB computes it automatically on every `round_scores` update.

**Player selection redesign** (`PlayerSetup.tsx`)
- Replaced the full grid of all known-player chips with a typeahead input + dropdown.
- Selected players render as gold chips (with × to remove) above the input.
- "Join Existing Game" button moved to just below the header — always visible without scrolling.
- Local state simplified: `knownPlayers`, `selectedPlayers`, `query`, `showSuggestions`.

**Trends chart readability** (`StatsLeaderboard.tsx`)
- Added `visiblePlayerIds: Set<string>` state; initialised to top 5 players by games played on first data load.
- Player toggle panel above the chart: each player is a pill button colored when active, dimmed when hidden, with game-count hint.
- Chart and Recharts `<Legend>` only render lines for `visiblePlayers` (filtered from full player list).

### Stats full redesign (`StatsLeaderboard.tsx`, `GameSummary.tsx`)

**Leaderboard tab**
- `minGames` filter (2/3/5/All, default 3) controls which players appear in the main view vs the "Also Played" section.
- Top 3 qualifying players rendered as an Olympic podium (2nd left, 1st centre/crown, 3rd right) using `items-end` flex alignment and varying platform heights.
- Rank 4+ shown in a compact table: Rank / Player / G / W / Avg / Best / Zeros with alternating row shading.
- Players below threshold shown in a collapsible "Guests & newcomers" section (`alsoPlayedOpen` state).

**Trends tab** — three sub-views (`trendsView` state):
- `averages`: horizontal Recharts `BarChart` (`layout="vertical"`), sorted best→worst, per-player cell colors, score label at bar end via `LabelList`. Height is dynamic (`barData.length * 44`).
- `overtime`: existing line chart with player toggle pills; max 5 active lines enforced — attempting a 6th sets `maxLinesWarning` for 2.5s.
- `compare`: pick 2 players (gold = A, blue = B via `compareA`/`compareB` state); head-to-head stats table with winner highlighted; 2-line chart filtered to games where both played.

**Records tab**
- Champions group (7): Most Wins, Lowest Avg, Best Single Game (glows if score = 0), Most Zeros, Most Games Played, Longest Win Streak, Most Improved (requires 6+ games: first-3-avg → last-3-avg).
- Hall of Shame group (2): Worst Single Game, Shanghai Survivor (5+ games, 0 wins).
- Win streak and improvement computed inline via `getWinStreak()` and `getImprovement()` helpers.

**Game Night Recap** (`GameSummary.tsx`)
- `GameSummary` renamed to "Game Night Recap" screen.
- Round MVPs computed per-round (lowest score; 0 = auto MVP) and highlighted inline in the score grid.
- Game Stats card: total points, margin (1st vs 2nd), zero-round count; flags any 100+ round score as notable.
- Round MVP summary chips with counts per player.
- Share button copies formatted results text to clipboard (`copied` state toggles icon/label for 2s).
- Notes + Save button unchanged at bottom.

### Drillable Stats (latest)

**Every stat is now tappable** — opens a `DrilldownModal` (z-60) sliding up from the bottom with up to 3 levels of back navigation.

**New files:**
- `src/components/DrilldownModal.tsx` — reusable modal shell + 6 sub-view renderers: `GameListView`, `GameScorecardView`, `ScoreHistoryView`, `ZeroRoundsView`, `WinStreakView`, `ImprovementView`

**`src/lib/types.ts`** — added `DrilldownView` discriminated union (6 variants: game-list, game-scorecard, score-history, zero-rounds, win-streak, improvement)

**`StatsLeaderboard.tsx`** drilldowns wired:
- Podium: wins (→ game-list of wins), avg (→ score-history), games (→ full game-list)
- Table rows: G / W / Avg / Best / 0s columns all tappable (Best → scorecard of that game, 0s → zero-rounds)
- Best Nights: score badge → game-scorecard
- Improvement Tracker rows: delta → improvement drilldown (first 5 vs last 5 games)
- Records: each value badge → relevant drilldown (wins→list, avg→history, best→scorecard, zeros→zero-rounds, games→list, streak→win-streak, improved→improvement, worst→scorecard, survivor→list)
- Local helpers: `getWinStreakGames()` (returns `GameWithScores[]`), `DS` button component (dotted underline), drilldown builder functions

**`PlayerProfileModal.tsx`** drilldowns wired:
- Stat tiles: Wins / Avg / Best / Win% all tappable
- Personal records: Best game / Worst game / Zeros / Win streak all tappable
- Game log rows converted from `div` to `button` (→ game-scorecard)

**Visual affordance:** `DS` button component adds `decoration-dotted underline-offset-2` to tappable numbers.

### Light theme overhaul

**Full switch from dark navy to warm cream** (`index.css`, all 11 components)
- Page bg: `#f8f6f1`, card bg: `#ffffff` with subtle shadow, secondary surface: `#efe9dd`
- Primary text: `#2c1810` (dark warm brown), secondary: `#8b7355`, tertiary: `#a08c6e`
- Gold accent on light: `#8b6914` (text/icons); `#e2b858` unchanged for button fills and chips
- Green `#4ade80` → `#2d7a3a`; red `text-red-400` → `#b83232`; compare blue `#6ecfef` → `#1d7ea8`
- `.card` now uses `box-shadow: 0 1px 3px rgba(0,0,0,0.06)` instead of dark border
- Tab pills: `bg-[#efe9dd]` container, active `bg-white shadow-sm text-[#8b6914]`
- Recharts tooltips: white bg, `#e2ddd2` border, `#2c1810` text
- BottomNav: white bg with subtle top shadow

---

### Comprehensive UI overhaul

**Score entry fixes** (`ScoreEntry.tsx`)
- 1B: `loadGame` pads `round_scores` to 7 with `''` — future rounds never loaded as `'0'`. `saveCurrentRound` writes only `scores.slice(0, currentRound + 1)`, preventing zero-fill pollution on realtime sync.
- 1C: `goNext` counts zeros before saving; >1 zero blocks advance with "Only one player can go out per round".
- 2A: "Prev" button added to footer (visible from Round 2 onward); header back arrow still exits game on Round 1.

**Player setup** (`PlayerSetup.tsx`)
- 2B: "Join Existing Game" button hidden via `{false && ...}` — code preserved, easily re-enabled.

**Edit historical games** (`GameCard.tsx`, `gameStore.ts`)
- 2D: Edit button (Pencil) in expanded game card footer. Edit mode shows date input, 7-round score grid, notes textarea, and Save/Cancel. Calls `saveAllRoundScores` per player + new `updateGame(gameId, { date, notes })`. On save, triggers `loadGames()` in `GameHistory`.

**Player profile modal** (`PlayerProfileModal.tsx`, `App.tsx`)
- 3A: New bottom-sheet component. `App.tsx` holds `selectedPlayerId` state; `handlePlayerClick` passed as `onPlayerClick` prop to `StatsLeaderboard`, `GameHistory` → `GameCard`, and `GameSummary`. Modal fetches its own data, slides up with CSS transform transition. Shows: 4-stat row, recent form sparkline (last 5 games), personal records, H2H top 3 opponents, full game log.

**Trends upgrades** (`StatsLeaderboard.tsx`)
- 4A: Over Time view has "5-Game Rolling Avg" / "Raw Scores" toggle (`overtimeMode` state). Rolling avg computed per-player with 5-game sliding window over `chronoGames`.
- 4B: Improvement Tracker section below chart — players with 5+ games, first-5 avg → last-5 avg, sorted by most improved.
- 4C: Best Nights section in Averages view — top 5 lowest individual scores, gold accent on #1.

**Date filter** (`StatsLeaderboard.tsx`)
- 5C: Persistent filter above sub-tabs: All Time / This Month / 30 Days / 3 Months / Custom (two date pickers). `filteredGames` drives ALL stats, charts, and records in all three tabs. Shows "Showing: X games" label when filtered.

**Theme brightening** (`index.css`, all components)
- 5A: Body bg `#1a2332`, card bg `#243447`, borders `#334155`, secondary text `#94a3b8`, primary text `#f1f5f9`, base font-size 15px.

**Rename Round MVP → Round Winner**
- 5B: "Round MVPs" → "Round Winners" in `GameSummary`; inline marker changed from "MVP" text to "★"; share text updated.

**gameStore additions**
- `updateGame(gameId, { date?, notes? })` — used by GameCard edit mode.

### Next Up

**Bulk import improvements** (`ImportData.tsx`)
- Review and harden the Excel/CSV parser: improve date format coverage, add per-row error reporting, and show a preview table before committing.
- Consider deduplication check before import to avoid inserting the same game twice.
