# Shanghai Tracker — Feature Roadmap Design Spec

## Overview

Nine features that progressively transform the Shanghai Rummy PWA from a functional card game into a polished, social, competitive experience. Each feature is independent and deployable on its own.

**Build order** follows a player-experience arc — each deployment makes the game noticeably better:

1. Sound Design System — silent → alive
2. Card Physics / 3D CSS — flat → tactile
3. In-Game Emotes — solo → social
4. Push Notifications — "forgot the game" → "it's your turn"
5. Achievements / Milestones — play → play with goals
6. Spectator Mode — private → shareable
7. Game Replay System — ephemeral → replayable
8. Adaptive AI — static opponents → rivals that learn you
9. Online Tournament Brackets — casual → competitive

**Dependencies:**
- Features 1–5 are fully independent of each other
- Feature 6 (Spectator) extends the multiplayer broadcast system
- Feature 7 (Replay) introduces the action log infrastructure
- Feature 8 (Adaptive AI) reads from the action log (requires Feature 7's infrastructure)
- Feature 9 (Tournaments) extends the room/lobby system with bracket management

---

## Feature 1: Sound Design System

### Goal
Add audio feedback to every meaningful game moment. A card game that sounds alive.

### Sound Inventory (15 sounds)

**Card Actions (SFX channel):**
| Sound | Trigger | Description |
|-------|---------|-------------|
| `card-draw` | `handleDrawFromPile()` | Soft card slide |
| `card-snap` | `handleDiscard()`, `handleTakeDiscard()` | Card snap/place |
| `card-deal` | Deal sequence in `RoundAnnouncement` | Rapid card flicks (staggered) |
| `card-shuffle` | Draw pile reshuffle | Riffle shuffle |

**Meld Actions (SFX channel):**
| Sound | Trigger | Description |
|-------|---------|-------------|
| `meld-slam` | `handleMeldConfirm()` | Cards slamming on table |
| `lay-off` | `handleLayOff()` | Single card placement |
| `joker-swap` | `handleJokerSwap()` | Quick sleight-of-hand sound |

**Cinematics (SFX channel):**
| Sound | Trigger | Description |
|-------|---------|-------------|
| `going-out` | `triggerGoingOut()` | Impact boom + short fanfare |
| `shanghai-sting` | Shanghai exposure in `RoundSummary` | Penalty sting/buzz |
| `buy-ding` | `handleBuyDecision(true)` | Cash register ding |
| `round-fanfare` | Round announcement countdown=1 | Short brass fanfare |
| `win-celebration` | Game over, winner revealed | Victory flourish |

**UI / Notifications:**
| Sound | Trigger | Channel | Description |
|-------|---------|---------|-------------|
| `turn-notify` | `isMyTurn` transitions true while `document.hidden` | Notification | Gentle chime |
| `button-tap` | UI button press | SFX | Soft click |
| `error-buzz` | Invalid action (lay-off error, etc.) | SFX | Short buzz |
| `countdown-tick` | Countdown 3-2-1 in `RoundAnnouncement` | SFX | Clock tick |

### Architecture

**`src/lib/sounds.ts`** — single module:
- `initAudio()` — creates `AudioContext`, two `GainNode` chains (SFX, Notification)
- `playSound(name: SoundName, opts?: { channel?: 'sfx' | 'notification' })` — loads and plays
- `setSfxVolume(0-1)` / `setNotifVolume(0-1)` — persisted in `localStorage`
- `getSfxVolume()` / `getNotifVolume()` — read current levels
- Lazy AudioContext creation on first user interaction (browser autoplay policy)
- Concurrent sound limit: max 4 simultaneous sounds, oldest dropped
- Sound assets: individual `.mp3` files in `public/sounds/`, cached by service worker

**Volume control UI:** Two sliders in the pause menu — "Game Sounds" (SFX) and "Notifications" (Notification). Default: both at 0.7.

**Multiplayer:** Remote sounds triggered by existing broadcast data — `view.lastEvent` string matching, `view.toast`, `view.goingOutSequence`, `view.buyingCinematicPhase`. No new broadcast events needed.

### Files
- Create: `src/lib/sounds.ts`
- Create: `public/sounds/` directory with 15 `.mp3` files
- Modify: `GameBoard.tsx` (~8 `playSound()` calls at existing handlers)
- Modify: `RemoteGameBoard.tsx` (sound triggers from view state changes)
- Modify: `RoundAnnouncement.tsx` (countdown tick, round fanfare)
- Modify: `RoundSummary.tsx` (shanghai sting)
- Modify: `BuyingCinematic.tsx` (buy ding)
- Modify: Pause menu in both `GameBoard.tsx` and `RemoteGameBoard.tsx` (volume sliders)

---

## Feature 2: Card Physics / 3D CSS Animations

### Goal
Upgrade flat card interactions to feel tactile and physical using CSS 3D transforms.

### Animation Inventory (8 animations)

| Animation | Trigger | Technique | Duration |
|-----------|---------|-----------|----------|
| **3D Card Flip** | Draw, deal, card reveal | CSS 3D `rotateY` with `backface-visibility` | 400ms |
| **Deal Arc** | Round start dealing | CSS 3D translate + rotate, staggered 60ms per card | 200ms each |
| **Draw Slide** | Player draws from pile | CSS transform translate from pile → hand | 350ms |
| **Discard Toss** | Player discards | CSS transform: lift, rotate 3-5°, translate to pile | 300ms |
| **Meld Slam** | Lay down melds | CSS transform: scale bounce from 0.8 → 1.05 → 1 | 400ms |
| **Pile Depth** | Draw pile always | CSS: 3 stacked cards with offset + shadow | Static |
| **Shuffle Riffle** | Deck reshuffle | CSS 3D: cards interleave left/right | 600ms |
| **Buy Snatch** | Someone buys card | Enhanced existing `bc-snatch-fly` with rotation | 500ms |

### Technical Approach
- Pure CSS — no animation library
- `perspective: 800px` on card containers
- `transform-style: preserve-3d` on Card.tsx wrapper
- `backface-visibility: hidden` on card front/back faces
- All animations use `transform` and `opacity` only — GPU composited, no layout thrashing
- `will-change: transform` applied during active animations only (removed after)
- Keyframes defined in `src/index.css`

### Card.tsx Changes
Add a 3D flip wrapper around the existing card content:
- Outer div: `transform-style: preserve-3d`, `transition: transform 400ms`
- Front face: existing card rendering, `backface-visibility: hidden`
- Back face: card back pattern (rotated 180°), `backface-visibility: hidden`
- Flip triggered by `isFlipped` prop — `rotateY(180deg)` when face-down

### Files
- Modify: `src/index.css` (new keyframes: `deal-arc`, `draw-slide`, `discard-toss`, `meld-slam-bounce`, `shuffle-riffle`)
- Modify: `Card.tsx` (3D flip wrapper, `isFlipped` prop)
- Modify: `HandDisplay.tsx` (deal arc animation on mount)
- Modify: `GameBoard.tsx` (draw/discard transition states)
- Modify: `BuyingCinematic.tsx` (enhanced snatch animation)

---

## Feature 3: In-Game Emotes / Reactions

### Goal
Let players express reactions during multiplayer games — 8 preset emotes, no text chat.

### Emote Set
| ID | Emoji | Label |
|----|-------|-------|
| `nice` | 👏 | Nice! |
| `haha` | 😂 | Haha |
| `wow` | 😱 | Wow |
| `cmon` | 😤 | Come on! |
| `fire` | 🔥 | On fire! |
| `rip` | 💀 | RIP |
| `calc` | 🎯 | Calculated |
| `gg` | 👋 | GG |

### UX Flow
1. Player taps a small "😊" reaction button near the bottom of the screen
2. Emote bar slides up showing 8 options in a horizontal strip
3. Player taps one — bar dismisses, emote broadcasts
4. All players see a floating emoji bubble above the sender's player card in the opponent strip
5. Bubble fades after 2.5 seconds
6. Cooldown: 3 seconds between emotes per player

### Architecture
- New broadcast event: `emote` with payload `{ seatIndex: number, emoteId: string, timestamp: number }`
- Add `'emote'` to `KNOWN_EVENTS` in `useMultiplayerChannel.ts`
- New type: `EmotePayload` in `multiplayer-types.ts`
- Emote mute toggle in pause menu (independent from sound mute)
- Sound: each emote plays a short sound via `playSound('emote-pop')` (1 shared sound, not per-emote)

### Files
- Create: `src/components/play/EmoteBar.tsx` — selector UI, cooldown logic
- Create: `src/components/play/EmoteBubble.tsx` — floating bubble with fade animation
- Modify: `GameBoard.tsx` (render EmoteBar + EmoteBubble, broadcast emote on send, listen for incoming)
- Modify: `RemoteGameBoard.tsx` (same — render EmoteBar + EmoteBubble, send/receive emotes)
- Modify: `useMultiplayerChannel.ts` (add `'emote'` to KNOWN_EVENTS)
- Modify: `multiplayer-types.ts` (add `EmotePayload` type, add to `ChannelMessage` union)

**No database** — emotes are ephemeral broadcast events.

---

## Feature 4: Push Notifications for Turn

### Goal
Notify players when it's their turn and the app is backgrounded.

### Tier 1: Local Notification API (this spec)
- Uses the browser `Notification` API — works when tab is open but not focused
- Zero backend required
- Permission requested once via a prompt in the game lobby or on first multiplayer join

**Notification triggers:**
| Event | Title | Body |
|-------|-------|------|
| Your turn | "Your Turn" | "It's your turn in SHNG-XXXX" |
| Game starting | "Game Starting" | "Your game in SHNG-XXXX is starting!" |
| Someone went out | "Round Over!" | "{name} went out in SHNG-XXXX" |
| Game over | "Game Over" | "{winner} wins in SHNG-XXXX!" |

**Conditions:** Only fires when `document.hidden === true`. Never fires for the host's own actions. Respects a "Mute notifications" toggle in pause menu.

### Tier 2: Web Push (future enhancement, not in this spec)
Would add a `push_subscriptions` table and Supabase Edge Function for closed-tab push. Deferred.

### Files
- Create: `src/lib/notifications.ts` — `requestPermission()`, `notifyTurn(roomCode)`, `notifyGameEvent(type, data)`
- Modify: `RemoteGameBoard.tsx` (trigger on `isMyTurn` transition + `document.hidden`)
- Modify: `GameBoard.tsx` (trigger for host on their turn in multiplayer)
- Modify: `Lobby.tsx` (request notification permission on join)

---

## Feature 5: Achievements / Milestones

### Goal
Give players goals beyond winning — 16 badges across 4 categories that unlock over time.

### Achievement Definitions

**🌱 Beginner (4):**
| ID | Name | Condition |
|----|------|-----------|
| `first-hand` | First Hand | Complete your first game |
| `going-down` | Going Down | Lay down melds for the first time |
| `clean-sweep` | Clean Sweep | Go out in a round (score 0) |
| `buyers-market` | Buyer's Market | Buy a card for the first time |

**⭐ Skill (4):**
| ID | Name | Condition |
|----|------|-----------|
| `hat-trick` | Hat Trick | Go out 3 rounds in a row in one game |
| `zero-buys` | Zero Buys | Win a game without buying any cards |
| `the-heist` | The Heist | Swap a joker from a table meld |
| `comeback-kid` | Comeback Kid | Win after being last place at Round 5 |

**💎 Mastery (4):**
| ID | Name | Condition |
|----|------|-----------|
| `shutout` | Shutout | Go out in all 7 rounds of one game |
| `shark-slayer` | Shark Slayer | Beat The Shark AI |
| `mastermind-slayer` | Mastermind Slayer | Beat The Mastermind AI |
| `century-club` | Century Club | Play 100 games |

**🤝 Social (4):**
| ID | Name | Condition |
|----|------|-----------|
| `party-host` | Party Host | Host 10 online games |
| `full-house` | Full House | Play a game with 8 players |
| `globetrotter` | Globetrotter | Play with 20 different players |
| `shanghai-master` | Shanghai! | Shanghai an opponent 5 times |

### Architecture

**Database:** New `player_achievements` table:
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `player_name` | text | Player who unlocked |
| `achievement_id` | text | e.g. `hat-trick` |
| `unlocked_at` | timestamptz | When unlocked |

Unique constraint on `(player_name, achievement_id)`.

**Detection:** `src/lib/achievements.ts`:
- `ACHIEVEMENTS` — array of achievement definitions with `id`, `name`, `category`, `description`, `icon`, `check(context) → boolean`
- `checkAchievements(context: AchievementContext) → string[]` — returns newly unlocked achievement IDs
- `AchievementContext` includes: game state, player name, game history stats, round results
- Called at round-end and game-end from `GameBoard.tsx`
- Fire-and-forget insert to `player_achievements` (same pattern as telemetry)

**Display:**
- Unlock toast: uses existing `GameToast` with `celebration` style + achievement name
- Profile badges: grid of unlocked badges in `PlayerProfileModal.tsx`
- Achievement list: new "Achievements" tab in `StatsLeaderboard.tsx` showing all 16 with locked/unlocked state

### Files
- Create: `src/lib/achievements.ts` — definitions + detection logic
- Modify: `src/lib/gameStore.ts` — `saveAchievement()`, `getPlayerAchievements()`
- Modify: `GameBoard.tsx` — call `checkAchievements()` at round-end/game-end, show unlock toast
- Modify: `PlayerProfileModal.tsx` — achievement badge grid
- Modify: `StatsLeaderboard.tsx` — new "Achievements" tab
- New DB table: `player_achievements`

---

## Feature 6: Spectator Mode

### Goal
Let non-players watch a live game with full hand visibility.

### UX Flow
1. Room creator toggles "Allow Spectators" in lobby settings (off by default)
2. Spectators join via room code on a "Watch Game" screen — no seat assignment
3. `SpectatorBoard.tsx` renders a read-only view showing all players' hands
4. Spectators see all cinematics, toasts, round announcements — same experience as host
5. No interactive elements — no card tapping, no buttons except "Leave" and scoreboard
6. Connection indicator shows: "3 players + 2 watching"

### Architecture
- Host broadcasts a `spectator_view` event alongside per-player `game_state` events
- `SpectatorGameView` type: like `RemoteGameView` but with `allHands: { seatIndex: number, hand: Card[] }[]` instead of `myHand`
- Spectators join the same Supabase Realtime channel, listen for `spectator_view` only
- Max 10 spectators per room (configurable, prevents channel overload)
- Spectators not tracked in `game_room_players` — only via channel presence count

### Files
- Create: `src/components/play/SpectatorBoard.tsx` — read-only game view with all hands
- Modify: `multiplayer-types.ts` — `SpectatorGameView` type, `spectator_view` channel event
- Modify: `GameBoard.tsx` — broadcast `spectator_view` when spectators enabled
- Modify: `Lobby.tsx` — "Allow Spectators" toggle, "Watch" join mode
- Modify: `PlayTab.tsx` — route to `SpectatorBoard`
- Modify: `useMultiplayerChannel.ts` — add `'spectator_view'` to KNOWN_EVENTS

**No new DB tables.**

---

## Feature 7: Game Replay System

### Goal
Record every game action and allow playback of completed games.

### Action Log (Shared Infrastructure)
Every game action recorded as a structured event stored in Supabase. This infrastructure is also used by Feature 8 (Adaptive AI).

**New `game_action_log` table:**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `game_id` | uuid | FK to games |
| `seq` | integer | Sequence number (1, 2, 3...) |
| `player_index` | integer | Which player acted |
| `action_type` | text | `draw_pile`, `take_discard`, `discard`, `meld_confirm`, `lay_off`, `joker_swap`, `buy`, `decline_free_offer` |
| `action_data` | jsonb | Action-specific data (card IDs, meld IDs, etc.) |
| `created_at` | timestamptz | Timestamp |

Index on `(game_id, seq)`.

**Logging:** `logAction(gameId, seq, playerIndex, type, data)` — fire-and-forget insert, called from `GameBoard.tsx` after each game handler. Same silencing pattern as telemetry. Sequence number tracked via a `actionSeqRef` counter in GameBoard.

### Replay Viewer

**`src/game/replay-engine.ts`:**
- `initReplayState(playerConfigs, deckSeed) → GameState` — reconstruct initial state
- `applyAction(state, action) → GameState` — deterministic state transition
- Requires storing the deck seed (random seed used for shuffle) alongside the game. Add `deck_seed` column to `games` table.
- **Important:** Current deck creation (`createDecks` + `shuffle` in `deck.ts`) uses `Math.random()`. Replay requires a seeded PRNG so the same seed reproduces the same deck order. The plan must introduce a lightweight seeded RNG (e.g., mulberry32) and thread the seed through `createDecks`/`shuffle`. Existing non-replay games can use a random seed — the change is backward-compatible.

**`src/components/play/ReplayViewer.tsx`:**
- Takes a `gameId` prop, loads action log from Supabase
- Reconstructs state step-by-step using `replay-engine.ts`
- Shows full hands for all players (game is over, no privacy needed)
- Reuses visual components: `HandDisplay`, `TableMelds`, `Card`
- Playback controls: ▶ Play / ⏸ Pause, ⏪ Step Back / ⏩ Step Forward, speed selector (1x/2x/4x), scrub bar

**Access point:** "Watch Replay" button on `GameCard.tsx` for completed games that have an action log.

### Files
- Create: `src/lib/actionLog.ts` — `logAction()`, `loadActionLog(gameId)`, `ActionLogEntry` type
- Create: `src/game/replay-engine.ts` — deterministic state reconstruction
- Create: `src/components/play/ReplayViewer.tsx` — playback UI
- Modify: `GameBoard.tsx` — log each action after handlers
- Modify: `GameCard.tsx` — "Watch Replay" button
- Modify: `gameStore.ts` — action log CRUD, `deck_seed` on game creation
- Modify: `PlayTab.tsx` — route to `ReplayViewer`
- New DB table: `game_action_log`
- Alter: `games` table — add `deck_seed` text column

---

## Feature 8: Adaptive AI — "The Nemesis"

### Goal
An AI personality that learns your play patterns over multiple games and adapts to counter your tendencies.

### Opponent Model
Tracks per-player patterns from completed game action logs:

```typescript
interface OpponentModel {
  playerName: string
  gamesAnalyzed: number
  suitBias: Record<string, number>     // hearts: 0.3, diamonds: 0.1, ...
  avgBuyRate: number                    // buys per round
  avgGoDownRound: number                // typical round they lay down
  discardPatterns: Record<number, number> // rank → frequency discarded
  takePatterns: Record<number, number>    // rank → frequency taken from discard
  updatedAt: number
}
```

**Storage:** `localStorage` keyed by `nemesis_model_${playerName}`. Client-side only — no DB table needed. Models update after each game via `updateOpponentModel(playerName, actionLog)`.

### The Nemesis Personality
New entry in `PERSONALITIES` array and `AI_EVAL_CONFIGS`:
- **Suit denial:** If opponent favors hearts (suitBias > 0.25), Nemesis holds hearts longer before discarding and penalizes discarding them via `dangerWeight`
- **Buy competition:** If opponent buys aggressively (avgBuyRate > 1.5), Nemesis increases its own buy tolerance to snatch cards first
- **Timing pressure:** If opponent goes down late (avgGoDownRound > 4), Nemesis rushes to go down early to Shanghai them. If they go down early, Nemesis holds for a better hand.
- **Discard traps:** Avoids discarding ranks the opponent frequently takes
- **Fallback:** When no model exists for the opponent, plays like The Shark

### Files
- Create: `src/game/opponent-model.ts` — `OpponentModel` type, `updateOpponentModel()`, `loadOpponentModel()`, `buildNemesisConfig(model) → AIEvalConfig`
- Modify: `src/game/types.ts` — add `'the-nemesis'` to `AIPersonality`, add to `PERSONALITIES`
- Modify: `src/game/ai.ts` — `NemesisEvalConfig` that reads opponent model, new entry in `AI_EVAL_CONFIGS`
- Modify: `GameBoard.tsx` — call `updateOpponentModel()` post-game
- Modify: `GameSetup.tsx` — Nemesis personality option (with tooltip: "Learns your playstyle")

---

## Feature 9: Online Tournament Brackets

### Goal
Structured competitive play with automatic bracket generation and progression.

### Tournament Flow
1. **Create** — Host sets format: 4 or 8 players, single elimination
2. **Lobby** — Players join via code `TRNY-XXXX`, see the player list
3. **Bracket** — Host starts tournament, bracket auto-generated (random seeding)
4. **Play** — Each match auto-creates a `game_room`. Players are directed to their match.
5. **Advance** — When a match completes, winner auto-progresses. Losers see the bracket.
6. **Finals** — Last match played, champion crowned with celebration screen.

### Database

**`tournaments` table:**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `code` | text | `TRNY-XXXX` format |
| `host_name` | text | Tournament creator |
| `player_count` | integer | 4 or 8 |
| `format` | text | `single-elimination` |
| `status` | text | `waiting`, `in_progress`, `finished` |
| `created_at` | timestamptz | |

**`tournament_matches` table:**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `tournament_id` | uuid | FK to tournaments |
| `round_number` | integer | 1 = quarter-finals, 2 = semis, 3 = finals |
| `match_index` | integer | Position within round (0, 1, 2, 3) |
| `player_names` | text[] | Array of player names in this match |
| `winner_name` | text | Null until match completes |
| `room_code` | text | Game room code for this match |
| `status` | text | `pending`, `in_progress`, `finished` |

### Architecture
- `src/lib/tournamentStore.ts` — CRUD: `createTournament()`, `joinTournament()`, `generateBracket()`, `reportMatchResult()`, `advanceWinner()`
- `src/hooks/useTournamentChannel.ts` — Supabase Realtime channel `tournament:${code}` for live bracket updates
- Bracket generation: random shuffle of players, pair into matches. 4 players = 2 rounds. 8 players = 3 rounds.
- Match rooms auto-created by the tournament host when a round begins
- Players receive a push/toast directing them to their match room
- Between rounds: all players see the bracket view while waiting for other matches to finish

### UI Components
- `TournamentLobby.tsx` — join screen + player list + "Start Tournament" button (host only)
- `BracketView.tsx` — visual bracket with match status (pending/in-progress/finished), scores, live indicators
- `TournamentResults.tsx` — final standings, champion highlight, achievement unlocks

### Files
- Create: `src/lib/tournamentStore.ts`
- Create: `src/hooks/useTournamentChannel.ts`
- Create: `src/components/play/TournamentLobby.tsx`
- Create: `src/components/play/BracketView.tsx`
- Create: `src/components/play/TournamentResults.tsx`
- Modify: `PlayTab.tsx` — tournament creation/join flow, bracket view routing
- Modify: `HomePage.tsx` — "Tournament" entry point alongside existing nav cards
- New DB tables: `tournaments`, `tournament_matches`

---

## Summary

| # | Feature | New Files | Modified | New DB | Effort |
|---|---------|-----------|----------|--------|--------|
| 1 | Sound Design | 2 | ~8 | 0 | Small |
| 2 | Card Physics | 0 | ~5 | 0 | Small |
| 3 | Emotes | 2 | ~4 | 0 | Small |
| 4 | Push Notifications | 1 | ~4 | 0 | Small |
| 5 | Achievements | 1 | ~4 | 1 | Medium |
| 6 | Spectator Mode | 1 | ~5 | 0 | Medium |
| 7 | Game Replay | 3 | ~5 | 1 (+alter) | Large |
| 8 | Adaptive AI | 1 | ~4 | 0 | Medium |
| 9 | Tournaments | 5 | ~2 | 2 | Large |

**Total:** ~16 new files, ~41 file modifications, 4 new DB tables, 1 table alteration.

Each feature has its own plan → implement → ship cycle. Start with Feature 1 (Sound Design) and work through in order.
