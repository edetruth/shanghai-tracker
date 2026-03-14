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
| `ScoreEntry` | `inputValues` (round × player grid), `expandedRound` |
| `GameHistory` | `games` list, `expandedGame` id, `confirmDelete` id |
| `StatsLeaderboard` | `activeView` (leaderboard / trends / records), `games`, `visiblePlayerIds` (Set — trends filter) |
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

**Exception**: `GameHistory` and `StatsLeaderboard` are self-contained — they fetch their own data on mount because they are read-only views not tied to the active game state.

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

### Next Up

**Bulk import improvements** (`ImportData.tsx`)
- Review and harden the Excel/CSV parser: improve date format coverage, add per-row error reporting, and show a preview table before committing.
- Consider deduplication check before import to avoid inserting the same game twice.
