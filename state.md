# State Management

## Philosophy

No global state library (no Redux, no Zustand, no Context API). All state lives in `App.tsx` and is passed down via props. This is intentional — the app is small enough that prop drilling is manageable and the added complexity of a state manager is unnecessary.

## State in App.tsx

```typescript
// Top-level section (which major area of the app is active)
section: 'home' | 'play' | 'scoretracker' | 'stats'

// Score tracker sub-state machine (only relevant when section === 'scoretracker')
scoreTrackerState: 'list' | 'setup' | 'playing' | 'summary' | 'joining'

// Active score-tracked game (null when not in a game)
activeGame: Game | null
activePlayers: Player[]

// Player profile modal (driven from any section)
selectedPlayerId: string | null

// Tutorial visibility (delegated to useTutorial hook)
tutorial: { show: boolean; dismiss: () => void; reopen: () => void }
```

## Score Tracker State Machine

```
        ┌─────────────────────────────────────────┐
        │                                         │
        ▼                                         │
    [ list ]                                      │
    ScoreTrackerPage                              │
        │ onStartNewGame()                        │
        ▼                                         │
    [ setup ]                                     │
    PlayerSetup ──────── onJoinGame() ──────► [ joining ]
        │ onGameCreated(game, players)            JoinGame
        ▼                                         │ onBack()
    [ playing ]  ◄───────────────────────────────┘
    ScoreEntry
        │ onComplete()
        ▼
    [ summary ]
    GameSummary
        │ onDone()
        ▼
    [ list ] ─────────────────────────────────────┘
```

**Transitions:**
| From | To | Trigger |
|------|----|---------|
| `list` | `setup` | User clicks "New Game" |
| `setup` | `joining` | User clicks "Join Game" |
| `setup` | `playing` | `handleGameCreated(game, players)` — PlayerSetup created game in DB |
| `joining` | `list` | User cancels or backs out |
| `playing` | `summary` | All 7 rounds entered — `onComplete()` |
| `summary` | `list` | User clicks "Done" — `onDone()` |
| any | `list` | `onBack()` / `handleBackToList()` |

Navigation between top-level sections (`home`, `play`, `scoretracker`, `stats`) is handled by `navigateTo(section)`. Navigating to `scoretracker` resets `scoreTrackerState` to `'list'` unless a game is in progress.

## Play Mode State (in GameBoard.tsx)

Play mode (`section === 'play'`) has its own self-contained state inside `PlayTab` → `GameBoard`. It does not touch `App.tsx`'s state.

```typescript
// Core game state (passed through actions from game engine)
gameState: GameState   // players, drawPile, discardPile, currentRound, etc.

// UI phase (what the current player should be doing)
uiPhase: 'privacy' | 'draw' | 'action' | 'discard' | 'round-end' | 'game-end'
//  privacy   — privacy screen between turns (human only; AI skips)
//  draw      — waiting for draw from pile or discard
//  action    — can meld, lay off, or go to discard
//  discard   — must discard a card
//  round-end — round summary shown before next round
//  game-end  — final scores, transitions to GameOver

// Buying window
buyerOrder: number[]   // indices of players interested in buying
buyerStep: number      // which buyer is currently being asked
buyWindow: boolean     // whether buying window is open

// Undo discard (3-second window for human players)
pendingUndo: {
  preDiscardState: GameState  // state before discard (to restore on undo)
  timerId: ReturnType<typeof setTimeout>
} | null

// Reshuffle notification
reshuffleMsg: string   // non-empty when draw pile was just reshuffled

// Pause modal
paused: boolean

// AI automation — driven by useEffect watching uiPhase + currentPlayer.isAI
// AI turn delayed 700–1200ms; uses useRef for fresh state to avoid stale closures:
//   gameStateRef, uiPhaseRef, buyerOrderRef, buyerStepRef
```

**AI Turn Automation:**
```
useEffect fires when uiPhase changes + currentPlayer.isAI === true
  → setTimeout 700–1200ms
    → read fresh state from gameStateRef.current
    → if uiPhase === 'draw': AI draws from discard (aiShouldTakeDiscard) or pile
    → if uiPhase === 'action': executeAIAction()
      → try meld → try lay-off → go to discard
    → if uiPhase === 'discard': aiChooseDiscard() → discard immediately (no undo)
  → AI never sees privacy screen (nextPhaseForPlayer returns 'draw' for AI)
```

**Undo Discard Flow:**
```
Human discards
  → preDiscardState saved
  → 3-second timer starts
  → undo toast shown to human player
  → buying window NOT started yet

  If undo tapped:
    → timer cleared
    → gameState restored to preDiscardState
    → back to 'action' phase

  If timer expires (or AI buys):
    → pendingUndo cleared
    → startBuyingWindow() called
    → normal buy resolution proceeds
```

## Local Component State

Components manage their own ephemeral UI state with `useState`:

| Component | Local State |
|-----------|-------------|
| `PlayerSetup` | `knownPlayers` (DB fetch), `selectedPlayers` id list, `query` (typeahead), `showSuggestions`, `date`, `loading`, `error` |
| `ScoreEntry` | `scores` (7×N string grid), `currentRound`, `saving`, `roundError`, `codeCopied` |
| `GameCard` | `expanded`, `confirming` (delete), `editing`, `editDate`, `editNotes`, `editScores`, `savingEdit` |
| `ScoreTrackerPage` | `games` list, `loading`, `view` (list/export/import) |
| `StatsLeaderboard` | `view`, `games`, `minGames`, `gameTypeFilter`, `alsoPlayedOpen`, `dateFilter`, `customStart`/`customEnd`, `trendsView`, `overtimeMode`, `visiblePlayerIds`, `maxLinesWarning`, `compareA`/`compareB`, `drilldownStack` |
| `GameSummary` | `notes`, `saving`, `gameData` (fetched), `copied` |
| `PlayerProfileModal` | `games` (fetched), `loading`, `visible` (slide animation), `drilldownStack` |
| `ImportData` | `file`, `preview` rows, `importing` flag, `results` |
| `ExportData` | `exporting` flag |
| `JoinGame` | `roomCode` input, `loading`, `error` |
| `PlayTab` | `screen` ('setup' \| 'playing' \| 'over'), `playerConfigs: PlayerConfig[]`, `finalScores` |
| `play/GameSetup` | `playerCount`, `configs` (name + isAI per slot), `knownNames` (autocomplete), `loading` |
| `play/GameBoard` | `gameState`, `uiPhase`, `buyerOrder`, `buyerStep`, `buyWindow`, `pendingUndo`, `reshuffleMsg`, `paused` |
| `play/GameOver` | `saveStatus` ('saving' \| 'saved' \| 'error') |

## Real-Time State Sync (Score Tracker)

`useRealtimeScores(gameId, onUpdate)` subscribes to Supabase Realtime for the duration of an active score-tracked game.

- Watches: `game_scores` table changes filtered to `game_id=eq.{gameId}`
- Watches: `games` table changes (completion events)
- On any change: calls `onUpdate()` callback
- `onUpdate` in `ScoreEntry` re-fetches the full game from Supabase and updates local scores

This means during multiplayer, all devices see score updates within ~1 second of entry, without polling.

**Lifecycle:**
```
useEffect → channel = supabase.channel(gameId)
  .on('postgres_changes', ..., onUpdate)
  .subscribe()

cleanup → supabase.removeChannel(channel)
```

## Data Fetching Pattern

Components do **not** fetch data themselves on mount (except standalone views). The pattern:

1. `App.tsx` calls `gameStore` functions and stores results in state
2. Results passed to components as props
3. Components call callback props to trigger mutations
4. After mutation, parent re-fetches and updates state

**Exceptions**: `ScoreTrackerPage`, `StatsLeaderboard`, and `PlayerProfileModal` are self-contained — they fetch their own data on mount because they are read-only views not tied to the active game state.

## Score Update Flow (Score Tracker Detail)

```
ScoreEntry input change
  → local scores state updated (instant UI feedback)
  → on "Next Round": saveAllRoundScores(gameId, playerId, scores[0..currentRound])
  → Supabase write
  → Realtime event fires on all subscribed clients
  → onUpdate() → getGame(gameId) → setScores(refreshed)
  → ScoreEntry re-renders with authoritative data from DB
```

Note: only rounds `0..currentRound` are saved — future rounds are not written to avoid zero-fill pollution on realtime sync.

## Winner Computation

Winner is computed client-side via `computeWinner(game)` in `gameStore.ts`:

```typescript
// Lowest total_score wins
const winner = game.game_scores.reduce((a, b) =>
  a.total_score <= b.total_score ? a : b
)
```

`total_score` is a generated column in Supabase — computed by PostgreSQL from `round_scores` automatically on every update.

---

## Change Log

### Phase G: Polish (current)

**Haptic feedback** (`src/lib/haptics.ts`)
- New `haptic(type)` utility wrapping `navigator.vibrate` with 4 patterns: `tap` (8ms), `heavy` (25ms), `success` ([15,40,15]), `error` ([8,30,8,30,8]). Silent no-op if `navigator.vibrate` is unavailable (iOS, desktop).
- Used in `Card.tsx` on tap and `ScoreEntry.tsx` on score change.

**Tutorial overlay** (`TutorialOverlay.tsx`, `App.tsx`, `HomePage.tsx`)
- 4-slide tutorial with slide dots, Next/Skip/Get Started navigation.
- `useTutorial()` hook: checks `localStorage('shng-tutorial-v1')` on mount; exposes `show`, `dismiss`, `reopen`.
- First-run: shows automatically. Re-openable via `HelpCircle` button on `HomePage`.

**Join Game enabled** (`PlayerSetup.tsx`)
- Removed `{false && ...}` wrapper around the Join Game button — it is now live.

**Room code in ScoreEntry** (`ScoreEntry.tsx`)
- Tap-to-copy bar showing `SHNG-XXXX` room code with `Wifi` + `Copy`/`Check` icons and a hint line.

### Phase F: Multiplayer score tracker

Room code bar and Join Game enabled (see Phase G above).

### Phase E: Stats enhancements

**game_type column** — `games` table now has `game_type text default 'manual'`. Values: `'manual'` (score tracker), `'pass-and-play'` (play mode, all human), `'ai'` (play mode with AI opponent). Legacy rows have `null`.

**Game type filter** in `StatsLeaderboard`: "Type: All | Tracker | Played" pill buttons. `gameTypeFilter` state drives `filteredGames`.

**Game type badges** in `GameCard` and `DrilldownModal` game list view: "vs AI" (gold) and "Played" (cream) chips.

### Phase H: Play testing fixes (current)

**Buys per round** (`src/game/types.ts`, `GameBoard.tsx`)
- `buysRemaining` now resets to `MAX_BUYS` (5) at the start of each new round via `setupRound()`.
- UI shows "X/5 buys" in the top bar.

**Rule 9A — Next player gets free draw** (`GameBoard.tsx`)
- After any discard (non-wentOut), the game advances to the next player who sees the discard and can take it as their normal draw OR draw from the pile.
- If they draw from the pile, a post-draw buying window opens for all other players (not the current player, who already drew).
- New state: `pendingBuyDiscard: CardType | null`, `buyingIsPostDrawRef: React.MutableRefObject<boolean>`.
- New function: `startBuyingWindowPostDraw(state, drewPlayerIdx, discardCard)`.
- After post-draw buying resolves, the current player proceeds to action phase (not re-draw).

**AI blank screen fixed** (`GameBoard.tsx`)
- Buying phase no longer replaces the full game board screen for AI buyers.
- AI decisions show as toast messages (`aiMessage`) while the board stays visible.
- Human buy decisions show as a slim sticky banner at the top of the board.

**Selection state always resets** (`GameBoard.tsx`)
- `setSelectedCardIds(new Set())` added to `handleMeldConfirm` and `handleJokerSwap`.
- `newCardId` cleared on any card toggle or action.

**Ace lay-off at end of K-high run** (`meld-validator.ts`)
- `canLayOff` now returns `true` when `card.rank === 1 && meld.runMax === 13` (A can extend ...Q-K to ...Q-K-A).
- `handleLayOff` in `GameBoard.tsx` sets `runAceHigh=true` and `runMax=14` when this extension happens.
- New jokerMapping added when a joker is laid off on a run.

**Joker position in runs** (`meld-validator.ts`)
- `buildMeld` now returns cards in sequence order: natural cards sorted by rank, jokers inserted at their mapped position.
- Melds displayed via `TableMelds` always show the logical ascending sequence.
- Extra jokers extend the run at the high end (not low end as before).

**Extra melds must match round type** (`MeldModal.tsx`, `ai.ts`)
- `getAllowedBonusTypes(requirement)` returns `'set' | 'run' | 'both'` based on the round.
- `validateBonus` and `canFormAnyValidMeld` enforce the type restriction.
- `aiFindAllMelds` only adds extra melds of allowed types.

**Improved AI run strategy** (`ai.ts`)
- `scoreSuitForRun` scores each suit by consecutive sequence length + density.
- `getCommittedSuits` picks the top 2 suits as AI's run targets.
- `aiChooseDiscardForRuns` discards highest-value card from non-committed suits first.
- `aiShouldTakeDiscard` is run-aware: in run-heavy rounds, takes any card that extends a committed suit.
- `aiShouldBuy` is run-aware: buys cards that fit a committed suit.

**Easy AI difficulty** (`ai.ts`, `GameSetup.tsx`)
- `aiChooseDiscardEasy`: discards highest-value non-joker card.
- `aiShouldTakeDiscardEasy()`: always returns false (never takes discard).
- `aiShouldBuyEasy()`: always returns false (never buys).
- Lays down required melds only (no bonus melds, no lay-offs).
- GameSetup shows Easy as a selectable option (not "Soon").

**Dark game table background** (`GameBoard.tsx`)
- Game board uses `bg-[#1a3a2a]` (dark green felt) for the main screen.
- Top bar: `bg-[#0f2218]`, text/icons adjusted to white/cream.
- Round-start screen also uses dark green.

**Fan/overlap card layout** (`HandDisplay.tsx`)
- Cards overlap in a fan layout; all cards visible without scrolling.
- Selected card lifts up via Card's `-translate-y-3`.
- Overlap offset adapts to hand size: ≤5 cards = 56px, ≤7 = 48px, ≤10 = 36px, ≤12 = 28px, >12 = 24px.

**Suit differentiation** (`Card.tsx`)
- Hearts: `bg-[#fff0f0]` pink · Diamonds: `bg-[#f0f5ff]` blue
- Clubs: `bg-[#e0f7e8]` strong green · Spades: `bg-[#eeecff]` lavender
- Text colors: hearts red, diamonds dark blue, clubs dark green, spades dark purple.
- Suit symbols now `text-sm` (slightly larger).

**New card indicator** (`Card.tsx`, `HandDisplay.tsx`, `GameBoard.tsx`)
- `isNew` prop on Card shows a gold ring + "NEW" badge.
- Auto-clears after 3 seconds or on first player action.
- Set when drawing from pile or taking discard.

**Player card count warnings** (`GameBoard.tsx`)
- Mini score bar shows each player's card count (`X🃏`).
- Card count turns red when a player has 3 or fewer cards.
- Updated in real time via the `players` array.

**AI buying messages** (`GameBoard.tsx`)
- AI buyers show "X buys!" or "X passes" toast message.
- Fixes the blank-screen issue for AI buying decisions.

**Round summary shows remaining cards** (`RoundSummary.tsx`)
- Each non-out player's remaining cards are displayed with their point values.
- Players sorted by score (winner first).

**Game speed setting** (`GameBoard.tsx`)
- Pause menu now includes AI Speed: Fast / Normal / Slow.
- Fast: 200–400ms delays · Normal: 700–1200ms · Slow: 2000–3000ms.

**Stalemate detection** (`GameBoard.tsx`)
- `noProgressTurnsRef` and `drawPileDepletionsRef` track stalemate conditions.
- If draw pile depletes twice AND no progress for many turns: round is force-ended.
- All players score their remaining hands; "Round ended — no one went out" shown.

**Cannot go out by discarding** (`GameBoard.tsx`)
- `handleDiscard` no longer sets `goOutPlayerId` — discard never ends the round.
- Going out is only checked in `handleMeldConfirm` and `handleLayOff` (after meld/lay-off phase).
- Human players: discard blocked when hand would be empty; error toast shown.
- AI players: when stuck with 1 card, turn advances without discarding; stalemate counter increments.

**Lay Off / Swap gating** (`GameBoard.tsx`)
- "Lay Off / Swap" button is disabled (greyed, with tooltip) when player hasn't laid down yet.
- Shows as an enabled button only after `hasLaidDown = true`.

### Phase D: AI opponent

**`PlayerConfig`** type: `{ name: string; isAI: boolean }` — replaces plain string player names in play mode.

**`ai.ts`** — Medium difficulty AI with 5 exported functions. Core pattern: `tryFindSet` / `tryFindRun` helpers try joker counts 0..available, returning first valid group.

**`GameSetup`** — 2–8 player slots, Human/AI toggle per slot (at least 1 human enforced), Supabase name autocomplete via `<datalist>`.

**`GameBoard`** — AI skip privacy screen (`nextPhaseForPlayer` returns `'draw'` for AI), AI draw/action/discard via two `useEffect` blocks with `useRef` to avoid stale closures.

### Phase C: Auto-save

**`savePlayedGame()`** in `gameStore.ts` — single call that upserts players, creates game with `game_type`, saves all scores, marks complete.

**`GameOver`** — calls `savePlayedGame` on mount; shows Loader → CheckCircle/AlertCircle badge.

### Phase B: Game core improvements

**Colorblind suit tints** in `Card.tsx`: hearts `#fff5f5`, diamonds `#f5f8ff`, clubs `#f5fff7`, spades `#f8f8f8`.

**Sort toggle** in `HandDisplay.tsx`: Rank / Suit order, scrollable with right-edge fade gradient.

**Draw pile reshuffle** in `GameBoard.tsx`: when draw pile empties, all but the top discard card are shuffled and become the new draw pile. Reshuffle banner shown for 2s.

**Undo discard** — 3-second toast for human players; buying window delayed until timer expires.

**Pause modal** — Resume / Abandon options; Abandon returns to GameSetup.

### Fixed (score tracker bugs)

**Score entry** (`ScoreEntry.tsx`)
- `loadGame` pads `round_scores` to 7 with `''` — future rounds never loaded as `'0'`. `saveCurrentRound` writes only `scores.slice(0, currentRound + 1)`, preventing zero-fill pollution on realtime sync.
- `goNext` counts zeros before saving; >1 zero blocks advance with "Only one player can go out per round".
- "Prev" button added to footer (visible from Round 2 onward).

**Game creation** (`gameStore.ts` — `createGame`)
- `created_by` column does not exist → removed from insert.
- `is_complete` is NOT NULL with no default → added `is_complete: false` explicitly.
- `total_score` is a generated column → removed from `game_scores` insert.
