# Shanghai — Agent Handoff Document
## For New Claude Code Sessions

This document gives a new agent full context to pick up this project immediately. Read it completely before writing a single line of code.

---

## What This Project Is

A mobile-first Progressive Web App (PWA) for playing and tracking Shanghai Rummy card games. It has two major modes:

1. **Play Mode** — A fully digital card game with pass-and-play and AI opponents (Easy, Medium, Hard). Built entirely in React with a pure TypeScript game engine. No server involvement during play — all game logic runs client-side.

2. **Score Tracker** — A real-time multiplayer score tracker backed by Supabase. Players enter scores manually, synced live across devices via Supabase Realtime.

**Deployed on Vercel. PWA installable on iOS and Android.**

---

## Tech Stack

- **React 18** + **TypeScript 5** — UI layer
- **Vite 5** — build tool, PWA plugin
- **Tailwind CSS 3** — utility styling
- **Supabase JS 2** — PostgreSQL backend, Realtime subscriptions
- **Recharts** — score trend charts
- **Vitest** — test runner (265 tests, 264 passing)

---

## The Law — Master GDD

The file `Shanghai_GDD_v1.1.docx` in the project root is the **single source of truth** for all game rules. Every engine function, AI decision, and UI behavior must match it exactly. If code contradicts the GDD, the code is wrong.

Key rules from the GDD (memorize these):

### The 7 Rounds
| Round | Requirement | Cards Dealt |
|---|---|---|
| 1 | 2 Sets of 3+ | 10 |
| 2 | 1 Set + 1 Run of 4+ | 10 |
| 3 | 2 Runs of 4+ | 10 |
| 4 | 3 Sets of 3+ | 10 |
| 5 | 2 Sets + 1 Run of 4+ | 12 |
| 6 | 1 Set + 2 Runs of 4+ | 12 |
| 7 | 3 Runs of 4+ | 12 |

### Scoring (GDD Section 10)
- 2–9: **5 points each** (NOT face value)
- 10, J, Q, K: **10 points each**
- Ace: **15 points**
- Joker: **25 points**

### Critical Rules
- **CANNOT go out by discarding** — last card must be played onto a meld
- **Scenario B** — bonus meld leaves 1 stuck card → take back ONLY bonus melds, required stay
- **Scenario C** — lay-off leaves 1 stuck card → reverse the lay-off, player gets both cards back
- **Joker swaps from RUNS only** — never from sets
- **Buy limit is configurable** — set at game setup, resets each round, default 5
- **Next player gets free discard** — no buy used, counts as their draw
- **Lowest score wins**. Tied scores = shared win.

---

## Project Structure

```
src/
├── game/                        # Pure game engine — NO Supabase calls here ever
│   ├── types.ts                 # Card, Meld, RoundState, GameState, PlayerConfig
│   ├── rules.ts                 # cardPoints(), ROUND_REQUIREMENTS, MAX_BUYS
│   ├── deck.ts                  # Deck creation, shuffle, deal
│   ├── meld-validator.ts        # isValidSet, isValidRun, canLayOff, 
│   │                            # evaluateLayOffReversal, isLegalDiscard,
│   │                            # findSwappableJoker, meetsRoundRequirement
│   ├── scoring.ts               # calculateHandScore, scoreRound
│   └── ai.ts                    # All AI logic — Easy/Medium/Hard
│
├── lib/
│   ├── gameStore.ts             # ALL Supabase operations — never call Supabase from components
│   ├── types.ts                 # Score tracker + stats TypeScript interfaces
│   ├── constants.ts             # ROUNDS array, PLAYER_COLORS
│   ├── supabase.ts              # Supabase client init
│   └── haptics.ts               # haptic('tap'|'success'|'error'|'heavy')
│
├── components/
│   ├── play/                    # Digital game UI components
│   │   ├── GameBoard.tsx        # Main game board — all game state lives here
│   │   ├── GameSetup.tsx        # 3-step setup flow (players → names → settings)
│   │   ├── GameOver.tsx         # Game end — saves scores + telemetry to Supabase
│   │   ├── Card.tsx             # Card component with suit colors, states, NEW badge
│   │   ├── HandDisplay.tsx      # Controlled fan hand with sort toggle
│   │   ├── MeldModal.tsx        # Slot-based meld builder (Option 3)
│   │   ├── LayOffModal.tsx      # Full-screen lay-off modal with joker swap
│   │   ├── TableMelds.tsx       # Vertical meld table grouped by player
│   │   ├── RoundSummary.tsx     # Full-screen round end screen
│   │   └── BuyPrompt.tsx        # Buying banner (free vs paid styling)
│   └── [score tracker components]
│
├── game/__tests__/              # 238 tests across 14 files — all must pass
│
agents/                          # Agent CLAUDE.md files — read before each session
├── ORCHESTRATOR.md
├── GAME_ENGINE.md
├── QA.md
├── AI_SYSTEMS.md
├── FRONTEND.md
├── BACKEND.md
└── UIUX.md

supabase/
├── add_game_type.sql
├── add_buy_limit.sql            # Run this if not yet applied
└── add_game_events.sql          # Run this if not yet applied

Shanghai_GDD_v1.1.docx           # THE LAW — master rules document
Shanghai_UIUX_Spec_v1.0.docx    # UI/UX visual contract for all screens
```

---

## Database Schema

**5 tables in Supabase (no row-level security — public anon key):**

```sql
players         — id, name, created_at
games           — id, date, room_code, notes, is_complete, game_type, 
                  buy_limit (integer default 5), created_at
game_scores     — id, game_id, player_id, round_scores (number[]), 
                  total_score (GENERATED column — never write to it)
shanghai_events — id, game_id, player_id, round_number, created_at
game_events     — id, game_id, round_number, turn_number, event_type,
                  player_name, card, detail (jsonb), created_at
```

**Critical database rules:**
- `total_score` is a **generated column** — never insert or update it
- `created_by` does **not exist** on the games table
- All DB access goes through `src/lib/gameStore.ts` only — never call Supabase from components directly

**Key gameStore functions:**
```typescript
createPlayedGame(playerNames, date, gameType, buyLimit?) → Promise<string>  // creates game at START
completePlayedGame(gameId, players) → Promise<void>                          // saves scores at END
saveGameEvents(gameId, events) → Promise<void>                               // telemetry — silent fail
createGame(playerIds, date, gameType?, buyLimit?) → Promise<Game>            // score tracker
savePlayedGame(players, date, gameType, buyLimit?) → Promise<string>         // legacy — score tracker
```

---

## Game State Architecture

**GameBoard.tsx owns all play mode state.** Nothing goes to App.tsx during a game.

Key state in GameBoard:
```typescript
gameState: GameState          // players, drawPile, discardPile, roundState, buyLimit
uiPhase: 'privacy'|'draw'|'action'|'discard'|'round-end'|'game-end'|'buying'
buyerOrder: number[]          // indices of players in buy window
buyerStep: number             // current buyer being asked
pendingBuyDiscard: Card|null  // card being offered for buying
freeOfferDeclined: boolean    // human declined free take — React state (not just ref)
handSort: 'rank'|'suit'       // controlled by GameBoard, passed to HandDisplay + MeldModal
newCardId: string|null        // id of most recently drawn card (NEW badge)
gameId: string|null           // Supabase game record id — created on game start
buyLog: BuyLogEntry[]         // telemetry events — passed to GameOver, saved to game_events
pendingSaveIndexRef           // tracks how many buyLog entries already saved to Supabase
```

**Refs (for stale closure safety in AI useEffect):**
```typescript
gameStateRef, uiPhaseRef, buyerOrderRef, buyerStepRef
pendingBuyDiscardRef, buyingIsPostDrawRef, freeOfferDeclinedRef
```

**IMPORTANT — React 18 timing:** `useEffect` runs asynchronously after paint. The buying window fix uses BOTH React state AND refs to avoid race conditions where the ref hasn't synced before a handler fires. Always check both when reading values in event handlers: `const val = reactState ?? ref.current`

---

## AI Behavior Contract (GDD Section 11)

| Decision | Easy | Medium | Hard |
|---|---|---|---|
| Take discard | Random 50/50 | Only direct meld fit (gap-fill or extension only — NOT 'near') | Beneficial OR denial of opponents |
| Buy | Random 30% | Buys if useful | Optimally including denial |
| Discard | Random | Highest point-value card | Considers all players' table melds |
| Go down | Only when forced | As soon as requirement met | Times based on opponent progress |
| Lay off | Never | When cards fit | Strategically |
| Joker swap | Random | If useful | Optimally |

**All AI difficulties must:**
- Never discard last card (always try lay-off first when hand.length === 1)
- Respect `buyLimit === 0` (no buying)
- Respect `player.buysRemaining === 0` (no buying)
- Handle Scenario B and C correctly
- Only swap jokers from run melds

---

## Buying Flow (Most Complex Part)

This is where most bugs have been found. Understand it thoroughly.

```
1. Player discards card
2. Next player offered FREE take (no buy used, counts as their draw)
   → If taken: no buying window opens, next player proceeds to action phase
   → If declined: freeOfferDeclined = true, player MUST tap draw pile manually
3. After next player taps draw pile (handleDrawFromPile):
   → Check BOTH freeOfferDeclined state AND freeOfferDeclinedRef (React 18 timing)
   → If hasPendingBuy: call startBuyingWindowPostDraw() for remaining players
   → Buying window opens for all others in turn order
4. Each player offered buy in turn order
   → Only one player can buy per discard
   → Buyer receives discard + 1 penalty card from draw pile
5. After buying resolves: drew-player proceeds to action phase
```

**The React 18 race condition fix (critical):**
```typescript
// In handleDrawFromPile — check BOTH state and ref:
const wasExplicitlyDeclined = freeOfferDeclinedRef.current || freeOfferDeclined
const hasPendingBuy = pendingBuyDiscard !== null || pendingBuyDiscardRef.current !== null || wasExplicitlyDeclined
const pendingCard = pendingBuyDiscard ?? pendingBuyDiscardRef.current ?? (wasExplicitlyDeclined ? savedDeclinedCard : null)
```

---

## Telemetry System

Game events are saved to `game_events` table for AI tuning and analytics.

**Flow:**
1. `createPlayedGame()` called at game START → creates Supabase record immediately
2. `addBuyLog()` called throughout game for every significant event
3. `flushTelemetry(buyLog)` called at every round end → saves unsaved events to Supabase
4. `completePlayedGame()` called at game END → marks is_complete: true, saves final scores
5. `saveGameEvents()` called at game END → flushes any remaining events

**Event types tracked:**
`discard, free_offer, free_taken, free_declined, buy_window_open, buy_offered, bought, passed, window_closed, went_down, went_out, shanghaied, joker_swap, scenario_b, scenario_c, stalemate, reshuffle`

**Useful analytics queries:**
```sql
-- Buying window open rate
SELECT COUNT(CASE WHEN event_type='buy_window_open' THEN 1 END) * 100.0 / 
       COUNT(CASE WHEN event_type='discard' THEN 1 END) as open_rate
FROM game_events;

-- AI take rate by difficulty  
SELECT detail->>'difficulty' as diff, event_type, COUNT(*)
FROM game_events WHERE event_type IN ('free_taken','free_declined')
GROUP BY 1, 2;

-- Shanghaied rate by round
SELECT round_number, COUNT(CASE WHEN event_type='shanghaied' THEN 1 END) as shanghaied
FROM game_events GROUP BY round_number ORDER BY round_number;
```

---

## UI/UX Design System

Reference `Shanghai_UIUX_Spec_v1.0.docx` for full visual contract.

**Color tokens (game screens — dark felt):**
```
Table bg:        #1a3a2a   Game board background
Top bar:         #0f2218   Top bar, header areas
Table surface:   #1e4a2e   Card slots, meld areas
Table border:    #2d5a3a   All borders on dark screens
Gold accent:     #e2b858   Selected cards, active states, winner
Green text:      #a8d0a8   Primary text on dark bg
Green muted:     #6aad7a   Secondary text, labels
Card back:       #7a1a2e   Draw pile (burgundy red)
Error red:       #b83232   Shanghaied, errors
```

**Card suit colors:**
```
Hearts:   bg #fff0f0  text #c0393b
Diamonds: bg #f0f5ff  text #2158b8
Clubs:    bg #e0f7e8  text #1a6b3a
Spades:   bg #eeecff  text #3d2b8e
Joker:    bg #fff8e0  text #8b6914
```

**Non-game screens:** warm cream #f8f6f1 background

**Touch targets:** minimum 44px on all interactive elements

---

## What Was Recently Built (Current State)

The following was completed in the most recent engineering session:

### Game Engine (238 tests passing)
- Scoring fixed to GDD values (2-9=5pts, A=15pts, Joker=25pts)
- `buyLimit` added to GameState — configurable at setup
- All-joker sets and runs valid
- Bonus meld type restriction enforced
- `isLegalDiscard()` — cannot go out by discarding, universal
- `evaluateLayOffReversal()` — Scenario C with correct finalHand = [...newHand, card]
- `isValidSet/Run` fixes for all-joker melds

### AI Systems
- Easy AI: truly random (50/50 take, 30% buy, random discard)
- Medium AI: direct meld fit only for take-discard (removed 'near' condition), highest-value discard
- Hard AI: denial logic wired with real tablesMelds, considers opponent needs
- All AI: respect buyLimit, buysRemaining, never discard last card

### UI Redesign (all screens)
- PlayTab: dark green hero, SHANGHAI title, suit motifs, card fan, safe area padding
- GameSetup: 3-step wizard (count → names → settings) with buy limit selector
- GameBoard: sticky top/bottom bars, free-growing Zone 2, all players in strip
- HandDisplay: controlled sort, NEW badge z-index fixed, hand never dims
- MeldModal: slot-based Option 3, multi-select, sort toggle synced
- LayOffModal: full-screen modal, multi-select, joker swap section, auto-scroll
- TableMelds: vertical layout, flex-wrap, NO horizontal scroll
- BuyPrompt: green (free) vs gold (paid) banner, static timer bar
- RoundSummary: full screen, two tabs, card pills, progress pips
- GameOver: confetti, winner announcement, full scorecard, both action buttons
- Card: suit colors, states, faceDown prop for draw pile

### Buying Window
- Fixed React 18 timing race condition (state + ref dual check)
- Buying window correctly opens after free decline
- Auto-draw removed — player taps draw pile manually
- Draw phase pulse: gold glow on discard, green glow on draw pile
- Labels: "TAP TO TAKE" / "TAP TO DRAW" during draw phase

### Telemetry
- `game_events` table in Supabase
- Events saved at every round end (not just game end)
- Game record created at game START via `createPlayedGame()`
- Works for abandoned games — never loses more than 1 round of data

---

## Known Issues & Documented Future Work

These are confirmed issues to fix, in rough priority order:

| # | Item | Notes |
|---|---|---|
| 1 | **Joker swap UI** | Restored in LayOffModal — verify working on device |
| 2 | **Draw phase pulse** | Implemented — verify gold/green glow visible on device |
| 3 | **Vertical meld table** | Implemented — verify no horizontal scroll on device |
| 4 | **Scenario C fix** | finalHand fixed — verify both cards return correctly |
| 5 | **Lay-off direction indicator** | When card fits run in both directions, flash neon arrows showing which end |
| 6 | **General engagement pass** | Active state on all actionable elements, reduce visual hunting |
| 7 | **Card animations** | Cards fly from pile to hand on draw, fan to table on meld |
| 8 | **Sound effects** | tap, draw, go down, go out, buy, shanghaied, round end |
| 9 | **Analytics tab** | New tab in app — Overview, AI Behavior, Round Analysis, Events. Wait for 10+ games of data first |
| 10 | **Expert AI — Level 1** | 2-turn look-ahead, urgency mode when opponents close to going out |
| 11 | **Expert AI — Level 3** | Monte Carlo expectimax, opponent hand modeling, 12-17 sessions |
| 12 | **Online multiplayer** | Hidden hands per device, real-time game state sync |
| 13 | **Shanghai events leaderboard** | `shanghai_events` table exists, tracking not wired |
| 14 | **Buy log UI removed** | Confirmed removed — data collection still runs silently |

---

## Agent System

Each task session should start by reading the appropriate agent file from `agents/`:

| Agent | File | Owns |
|---|---|---|
| Orchestrator | ORCHESTRATOR.md | Reads GDD, breaks work into tasks, sequences agents |
| Game Engine | GAME_ENGINE.md | rules.ts, meld-validator.ts, deck.ts, scoring.ts, types.ts |
| QA | QA.md | All *_test.ts files — writes tests, reports bugs, never fixes |
| AI Systems | AI_SYSTEMS.md | ai.ts only |
| Frontend | FRONTEND.md | All .tsx components |
| Backend | BACKEND.md | gameStore.ts, Supabase schema, migrations |
| UI/UX | UIUX.md | Design decisions, visual spec |

**Agent sequencing rule:** Game Engine → QA → AI Systems → Frontend → Backend → UI/UX

**Never:**
- Edit source files from the wrong agent (Game Engine never touches .tsx, etc.)
- Skip QA after Game Engine changes
- Contradict the GDD
- Call Supabase from components directly

---

## Common Commands

```bash
npm run dev              # Dev server at http://localhost:5173
npm run build            # Production build
npx vitest run           # Run all 265 tests
npx tsc --noEmit         # TypeScript check (should be 0 errors)
```

**After any game engine change:** always run `npx vitest run` and verify all tests pass before moving to other agents.

---

## Environment Variables

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## Deployment

Vercel auto-deploys on every git push to main. No manual deploy needed. Wait 2-3 minutes after push for Vercel to complete. Test on phone via the deployed URL.

---

## How To Pick Up This Project

1. Read this document fully
2. Read `Shanghai_GDD_v1.1.docx` — know the rules
3. Read `Shanghai_UIUX_Spec_v1.0.docx` — know the visual contract
4. Read `agents/ORCHESTRATOR.md` — understand the agent hierarchy
5. Run `npx vitest run` — confirm 238 tests passing
6. Run `npx tsc --noEmit` — confirm 0 TypeScript errors
7. Read the specific agent file for your task
8. Make focused, targeted changes — one concern per session
9. Run tests after any game engine change
10. Never contradict the GDD


---

## AI Decision Telemetry System (Planned — Not Yet Built)

### Purpose
Beyond the existing `game_events` table, a deeper AI decision telemetry system has been designed to answer specific questions about AI behavior quality. This is the next major data engineering task.

### Two New Tables Needed

**`ai_turn_decisions`** — one row per AI turn:
```sql
CREATE TABLE ai_turn_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  turn_number integer NOT NULL,
  player_name text NOT NULL,
  difficulty text NOT NULL,         -- 'easy' | 'medium' | 'hard'
  draw_action text,                 -- 'took_discard' | 'drew_pile' | 'pass_free'
  draw_card text,
  draw_reason text,
  buy_offered_card text,
  buy_decision text,                -- 'bought' | 'passed'
  buy_reason text,
  buys_remaining integer,
  went_down boolean DEFAULT false,
  turns_could_have_gone_down integer,
  melds_laid jsonb,
  bonus_melds_laid integer DEFAULT 0,
  layoffs_made integer DEFAULT 0,
  joker_swaps_made integer DEFAULT 0,
  discard_card text,
  discard_reason text,
  discard_card_point_value integer,
  had_better_discard boolean,
  hand_size_before integer,
  hand_size_after integer,
  hand_point_value_before integer,
  hand_point_value_after integer,
  hand_improvement integer,
  has_laid_down boolean DEFAULT false,
  opponent_min_card_count integer,
  created_at timestamptz DEFAULT now()
);
```

**`ai_round_summary`** — one row per AI player per round:
```sql
CREATE TABLE ai_round_summary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  player_name text NOT NULL,
  difficulty text NOT NULL,
  went_out boolean DEFAULT false,
  went_down boolean DEFAULT false,
  shanghaied boolean DEFAULT false,
  round_score integer,
  final_hand_value integer,
  total_turns integer,
  turns_before_going_down integer,
  turns_after_going_down integer,
  free_takes integer DEFAULT 0,
  free_passes integer DEFAULT 0,
  buys_made integer DEFAULT 0,
  buy_opportunities integer DEFAULT 0,
  layoffs_total integer DEFAULT 0,
  joker_swaps_total integer DEFAULT 0,
  scenario_b_triggers integer DEFAULT 0,
  scenario_c_triggers integer DEFAULT 0,
  avg_hand_value_before_discard numeric,
  best_hand_value integer,
  worst_hand_value integer,
  created_at timestamptz DEFAULT now()
);
```

### Key Analytics Queries

```sql
-- Does difficulty affect win rate?
SELECT difficulty,
  ROUND(AVG(round_score), 1) as avg_score,
  COUNT(CASE WHEN went_out THEN 1 END) as times_went_out,
  COUNT(CASE WHEN shanghaied THEN 1 END) as times_shanghaied,
  COUNT(*) as total_rounds
FROM ai_round_summary
GROUP BY difficulty ORDER BY avg_score;

-- Going down timing by difficulty
SELECT difficulty,
  ROUND(AVG(turns_before_going_down), 1) as avg_turns_to_go_down,
  MIN(turns_before_going_down) as fastest,
  MAX(turns_before_going_down) as slowest
FROM ai_round_summary
WHERE turns_before_going_down IS NOT NULL
GROUP BY difficulty;

-- Free take rate by difficulty (target: Easy ~50%, Medium ~20-30%, Hard ~35-45%)
SELECT difficulty,
  ROUND(COUNT(CASE WHEN draw_action='took_discard' THEN 1 END) * 100.0 /
        NULLIF(COUNT(CASE WHEN draw_action IN ('took_discard','pass_free') THEN 1 END), 0), 1) as take_rate_pct
FROM ai_turn_decisions
WHERE draw_action IN ('took_discard', 'pass_free')
GROUP BY difficulty;

-- Discard quality
SELECT difficulty,
  ROUND(AVG(discard_card_point_value), 1) as avg_points_discarded,
  ROUND(AVG(hand_improvement), 1) as avg_hand_improvement_per_turn
FROM ai_turn_decisions
WHERE discard_card IS NOT NULL
GROUP BY difficulty;

-- Full picture
SELECT r.difficulty,
  ROUND(AVG(r.round_score), 1) as avg_score,
  ROUND(AVG(r.turns_before_going_down), 1) as avg_turns_to_go_down,
  ROUND(AVG(t.discard_card_point_value), 1) as avg_discard_value,
  ROUND(COUNT(CASE WHEN r.shanghaied THEN 1 END) * 100.0 / COUNT(*), 1) as shanghaied_pct
FROM ai_round_summary r
JOIN ai_turn_decisions t ON t.game_id = r.game_id
  AND t.player_name = r.player_name
  AND t.round_number = r.round_number
GROUP BY r.difficulty ORDER BY avg_score;
```

### Implementation Plan (3 sessions)
1. **Backend agent** — create both tables, add `saveAITurnDecision()` and `saveAIRoundSummary()` to gameStore.ts (silent fail)
2. **AI Systems agent** — add `buildTurnDecision()` to ai.ts that captures reasoning alongside decisions, no logic changes
3. **Frontend agent (GameBoard.tsx)** — call save functions after each AI turn and at round end, add to flushTelemetry()

---

## Known Bugs (Fix These Next)

### BUG 1 — Cascading Shanghai (CRITICAL)
**Symptom:** When a round ends with ALL players Shanghaied (nobody went down), all subsequent rounds immediately end with everyone Shanghaied again. Game becomes unplayable.

**Root cause (suspected):** One or more of these not resetting correctly at round start:
- `player.hasLaidDown` not resetting to `false`
- `player.melds` not resetting to `[]`
- `roundState.goOutPlayerId` carrying over (not reset to `null`)
- `noProgressTurnsRef` and `drawPileDepletionsRef` (stalemate refs) not resetting to 0

**Where to look:**
- `setupRound()` in GameBoard.tsx — check every player field reset
- `endRound()` / `forceEndRound()` — check what state is written after full-Shanghai
- `noProgressTurnsRef.current = 0` and `drawPileDepletionsRef.current = 0` — must happen at round start
- `goOutPlayerId: null` in the new RoundState constructed at round start

**Fix owner:** Game Engine agent (if in engine files) or Frontend agent (if in GameBoard.tsx)

**Status:** FIXED. Added `noProgressTurnsRef.current = 0` and `drawPileDepletionsRef.current = 0` to both `forceEndRound()` and `handleNextRound()` in GameBoard.tsx. Four lines total.

---

## BUG 2 — Buying Window Race Condition (FIXED)

**Symptom:** After a human declined the free take and tapped the draw pile, the buying window sometimes failed to open. The `updatedState` variable was null when `startBuyingWindowPostDraw` was called.

**Root cause:** `updatedState` was captured inside a `setGameState(prev => ...)` updater function. In React 18 concurrent mode, updater functions execute asynchronously during the render phase, so by the time `startBuyingWindowPostDraw` ran, `updatedState` was always null.

**Fix:** Build `updatedState` synchronously from pre-computed snapshots, then call `setGameState(updatedState)` directly. Now `updatedState` is guaranteed non-null at the buying window check.

---

## BUG 3 — Hard AI Over-Eager Discard Taking (Phase 1 FIXED)

**Symptom:** Hard AI took discards ~70%+ of the time, accepting speculative cards with minimal run evidence and acting indistinguishably from Medium AI.

**Fix:** Added `aiShouldTakeDiscardHard()` — separate function from Medium's `aiShouldTakeDiscard`:
- Requires 3+ same-suit cards already in the run window (vs Medium's 1+)
- No 'near' condition — Hard AI doesn't take speculative cards
- Adds denial logic: takes if an opponent with ≤ 3 cards can lay it off onto their melds
- Target take rate: ~20-25%
- Wired in GameBoard.tsx AI draw useEffect with difficulty-based branching

---

## Analytics Tab (Planned — Not Yet Built)

A new tab in the main app navigation, powered by `game_events` and future `ai_turn_decisions` / `ai_round_summary` tables.

**Four sections:**
1. **Overview** — total games, buy window open rate, most Shanghaied round
2. **AI Behavior** — free take rate by difficulty, buy rate, going down timing
3. **Round Analysis** — avg turns per round (bar chart), Shanghaied rate per round, most bought cards
4. **Game Events** — Scenario B/C frequency, joker swap frequency, stalemate count

**Wait until 10+ games of data are accumulated before building this.**

---

## Scenario C Bug — Full Post-Mortem (FIXED)

### The Symptom
Player lays off second-to-last card. Last card is unplayable. The card in their hand appears to change to a different (playable) card.

### The Real Root Cause
Three bugs in the Scenario C reversal block of `handleLayOff` in `GameBoard.tsx` working together:

**Bug 1 — Turn advanced to next player**
`advancePlayer(afterReversal)` + `setGameState(advanced)` moved the turn to the next player. The current player never got to discard. Their unplayable card was still in their hand in the `advanced` state but it was now someone else's turn.

**Bug 2 — Unplayable card offered as phantom buy**
`setPendingBuyDiscard(discardCard!)` set the unplayable card (still physically in the current player's hand) as a buy offer for the next player. This is what made the card appear to "vanish" — it showed up in the buying window UI instead of the player's hand. The player saw the buying window offering their own card back to them.

**Bug 3 — LayOffModal never closed**
`setShowLayOffModal(false)` was never called. The modal stayed open across the player change, adding to the visual confusion.

### The Fix (5 lines changed)
- Removed `advancePlayer`, the second `setGameState(advanced)`, and `setPendingBuyDiscard(discardCard!)`
- Added `setShowLayOffModal(false)` to close the modal
- Changed phase to `setUiPhase('action')` — current player stays in action phase with BOTH cards
- Added `setDiscardError` message explaining the reversal to the player

### The Lesson
The `discardCard` returned by `evaluateLayOffReversal` is for informational purposes only — it indicates which card is the "unplayable" one. It should NEVER be passed to `setPendingBuyDiscard`. That function is exclusively for cards that have actually been discarded to the discard pile, not cards still in a player's hand.

