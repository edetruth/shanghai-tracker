# SHANGHAI — Master Game Design Document

**Version 1.3** — Authoritative Rules Reference

Single source of truth for Engineering, QA, AI, and UI/UX

---

## 1. Game Overview

Shanghai is a rummy-style card game played over exactly 7 rounds. Each round has a specific meld requirement that players must achieve before they can go down. The player with the lowest cumulative score after all 7 rounds wins.

### 1.1 Players & Decks

| Player Count | Decks Used | Total Jokers |
|---|---|---|
| 2–4 players | 2 standard decks | 4 jokers |
| 5–8 players | 3 standard decks | 6 jokers |

Valid player range: 2 minimum, 8 maximum.
Always exactly 7 rounds per game — fixed, not variable.

### 1.2 Cards Dealt Per Round

| Rounds | Cards Dealt Per Player |
|---|---|
| Rounds 1–4 | 10 cards |
| Rounds 5–7 | 12 cards |

### 1.3 Winning

- Lowest cumulative score after all 7 rounds wins.
- Tied final scores = shared win. No tiebreaker round.
- No player elimination — all players play all 7 rounds regardless of score.

---

## 2. The 7 Rounds

| Round | Requirement | Cards Dealt | Meld Count |
|---|---|---|---|
| 1 | 2 Sets of 3+ | 10 | 2 melds |
| 2 | 1 Set of 3+ and 1 Run of 4+ | 10 | 2 melds |
| 3 | 2 Runs of 4+ | 10 | 2 melds |
| 4 | 3 Sets of 3+ | 10 | 3 melds |
| 5 | 2 Sets of 3+ and 1 Run of 4+ | 12 | 3 melds |
| 6 | 1 Set of 3+ and 2 Runs of 4+ | 12 | 3 melds |
| 7 | 3 Runs of 4+ | 12 | 3 melds |

The numbers in each requirement (Set of 3, Run of 4) are minimums. Players may include more cards in any individual meld when going down (e.g., a Run of 5 satisfies a Run of 4+ requirement).

---

## 3. Meld Definitions

### 3.1 Set

- 3 or more cards of the same rank, any suit.
- No suit restrictions or requirements.
- No joker minimum — a meld of 3 jokers is valid.
- No maximum size.
- Example valid sets: 7♥ 7♦ 7♣ | 7♥ 7♦ 7♣ 7♠ | J♥ J♦ Joker

### 3.2 Run

- 4 or more cards of the same suit in consecutive rank order.
- No joker minimum — multiple jokers per run allowed.
- No maximum size.
- Ace is BOTH high and low — A-2-3-4 is valid AND Q-K-A is valid.
- Wrapping is NOT allowed — K-A-2 is INVALID.
- Example valid runs: 4♥ 5♥ 6♥ 7♥ | A♠ 2♠ 3♠ 4♠ | J♣ Q♣ K♣ A♣

### 3.3 Jokers

- Jokers are fully wild — substitute for any card in any meld.
- No minimum or maximum jokers per meld.
- Point value if left in hand: 25 points.
- In a run, a joker has a fixed identity based on its position (e.g., joker between 5♠ and 7♠ = represents 6♠).
- In a set, a joker's suit is ambiguous — it could represent any suit of that rank.

### 3.4 Required Melds Only

> **Changed from v1.1:** Bonus melds beyond the round requirement are **not** supported. Players lay down exactly the required melds — no extra/bonus melds.

When going down, players lay down only the melds required by the round. For example, in Round 1 (2 Sets), the player lays exactly 2 sets. Individual melds may exceed the minimum size (e.g., a Set of 4 for a Set of 3+ requirement), but no additional melds beyond the requirement count are placed.

This simplifies the going-down flow and eliminates edge cases around bonus meld type restrictions and the "take back bonus meld" scenario from v1.1 §6.3 Scenario B.

---

## 4. Game Setup

### 4.1 Configurable Settings

The following settings are chosen by the host before each game begins:

| Setting | Default | Options | Notes |
|---|---|---|---|
| Player count | 2 | 2–8 | Determines deck count |
| AI players | 0 | 0 to (total-1) | At least 1 human required |
| AI personality | Steady Sam | 6 personalities (see §11) | One personality applies to all AI players |
| Buy limit | 5 | Off, 2, 3, 5, 7, 10, or Unlimited | Buys per player per round — resets each round |

> **Changed from v1.1:** AI difficulty replaced with AI personality system (6 personalities across 3 difficulty tiers). Buy limit options updated to match implementation: Off (0), 2, 3, 5, 7, 10, or Unlimited.

### 4.2 Round Start Sequence

1. Dealer rotates left each round (clockwise).
2. Dealer deals the correct number of cards to each player (10 or 12).
3. Top card of the draw pile is flipped face-up to start the discard pile.
4. Player to the left of the dealer goes first.
5. Buy counters reset to the configured buy limit for all players.

### 4.3 Discard Visibility

- Only the current face-up discard card is visible to all players.
- Previous discards are gone once a new card is discarded.
- The discard being offered for buying is always visible to all players.

---

## 5. Turn Structure

### 5.1 Turn — Before Going Down

1. **DRAW** — Take the top discard (free) or draw from the pile.
2. **BUYING WINDOW** — If you declined the discard, buying window opens for all other players in turn order.
3. **OPTIONAL: JOKER SWAP** — Swap a natural card for a joker in any run meld on the table (see §8).
4. **OPTIONAL: GO DOWN** — Lay down required melds if you have them. You may also lay off cards in the same action.
5. **DISCARD** — Discard one card to end your turn (unless your hand is empty — see §6).

### 5.2 Turn — After Going Down

1. **DRAW** — Take the top discard (free) or draw from the pile.
2. **BUYING WINDOW** — If you declined the discard, buying window opens for all other players in turn order.
3. **OPTIONAL: JOKER SWAP** — Swap natural cards for jokers in any run melds on the table. Multiple swaps allowed per turn.
4. **OPTIONAL: LAY OFF** — Play cards onto your own melds (just placed or from previous turns) AND other players' melds. No limit per turn (Medium AI is capped at 1 lay-off per turn, except for the final going-out lay-off).
5. **DISCARD** — Discard one card to end your turn (unless hand is empty — you've gone out).

### 5.3 Undo Discard

After a human player discards, a 3-second undo window allows them to take back the discard. The buying window does not open until the undo timer expires or the player confirms the discard. AI players do not get an undo window.

---

## 6. Going Down & Going Out

### 6.1 Going Down

- To go down, lay all required melds simultaneously in a single action.
- All melds must meet the minimum size (sets 3+, runs 4+).
- Only required melds are laid — no bonus melds (see §3.4).
- You may also lay off extra cards onto any melds in the same action.
- You may go down and go out in the same turn.

### 6.2 Lay-Offs

- You must have gone down yourself before laying off onto any meld.
- You can lay off onto your OWN melds placed this turn AND previous turns.
- You can lay off onto OTHER players' melds.
- No limit on how many cards you can lay off in one turn.
- Lay-offs happen on your turn only — not out of turn.

### 6.3 CRITICAL RULE — Cannot Go Out By Discarding

> ⚠ A player can NEVER go out by discarding their last card. The final card must always be played onto a meld.

**Scenario A — Last card is playable:**
Go down with required melds. Last card lays off onto any meld. You are out. ✓

**Scenario B — Already gone down, 1 card in hand:**
- Draw a card — now have 2 cards.
- One card is playable — lay it off. Now 1 card left.
- That card has nowhere to go. Cannot discard to go out.
- Strategic choice: discard the unplayable card, keep the playable one.
- Wait for next turn. Draw again. Hopefully now you can go out.

### 6.4 Round End

- Round ends IMMEDIATELY when one player empties their hand by playing (not discarding) their last card.
- No other players get a final turn after someone goes out.
- The player who went out scores 0 for the round.
- All other players score the sum of cards still in their hand.

### 6.5 Shanghai

- A player who has NOT gone down when someone else goes out is said to have been "Shanghaied."
- No extra penalty — they simply score all cards remaining in their hand at face value.
- Holding 10–12 cards naturally produces a very high score (typically 80–200+ points).
- This is tracked for display purposes but carries no multiplier or bonus penalty.

---

## 7. Buying

### 7.1 Buying Rules

- Buy limit is set at game setup (default 5, configurable: Off/2/3/5/7/10/Unlimited).
- Buy counter resets to the configured limit at the start of each new round.
- When a player discards, the card is offered to the table.
- The NEXT player in turn order gets FIRST RIGHT — they may take it FREE as their draw. No buy used.
- Taking the discard as the next player counts as their draw for that turn. They do NOT also draw from the pile.
- If the next player declines, the buying window opens to ALL other players in turn order.
- Any other player who buys receives the discard PLUS one penalty card from the top of the draw pile.
- Only ONE player can buy per discard. First to claim it wins.
- The player who discarded cannot buy their own card.
- Any player can buy — including players who have already gone down.
- Buying is out of turn — it does NOT affect the buyer's upcoming normal turn.

### 7.2 Buying Flow

| Step | Action |
|---|---|
| 1 | Player discards a card (3-second undo window for humans) |
| 2 | Next player: take it FREE (counts as their draw) OR decline |
| 3 | If declined: buying window opens for all remaining players in turn order |
| 4 | First player to claim it receives: discard card + 1 penalty card from draw pile |
| 5 | If no one buys: card stays as discard, next player draws from pile normally |

### 7.3 Buy-Window Hand Highlights

During the buying window, the player's hand highlights cards based on relevance to the offered discard:
- **Gold glow** — Same rank as discard (set match) or joker (always useful)
- **Green glow** — Same suit within ±2 ranks (run neighbor)
- **Normal** — No match
- A "Fits your hand" or "No match in hand" label is shown below the hand.

---

## 8. Joker Swapping

- Any player on their turn may swap a natural card for a joker from any RUN meld on the table.
- Jokers CANNOT be swapped from SET melds — their suit is ambiguous in a set.
- The swap can target any run meld on the table, regardless of who owns it.
- The natural card must exactly match the rank AND suit the joker represents in that run.
- After the swap: the joker goes into the swapping player's hand; the natural card takes the joker's position in the run.
- Multiple joker swaps are allowed in a single turn.
- The joker can be held for future turns — no obligation to use it immediately.

### 8.1 Joker Run Bounds

A joker may not extend a run below rank 1 (Ace-low) or above rank 14 (Ace-high). Lay-offs return false when a run already spans A through A (runMin === 1 && runMax === 14). AI always picks the end that has room.

### 8.2 Swapping Before Going Down

A player MAY swap a joker before they have gone down. AI personalities control whether they attempt pre-lay-down joker swaps (see §11).

> **Changed from v1.1:** The rule that "swap must be followed by going down that turn, or swap reverses" is not enforced in the current implementation. Pre-lay-down joker swaps are permitted without the reversal constraint.

---

## 9. Draw Pile Exhaustion

- When the draw pile runs out, shuffle the discard pile (except the current top card) to form a new draw pile.
- If the discard pile also does not have enough cards: add another full deck to the draw pile.
- A proactive reshuffle occurs at the start of each draw phase. A "Tap to Reshuffle" safety-net button is shown if the pile is somehow still empty.
- Game continues normally after reshuffle. No round is ended by pile exhaustion alone.

---

## 10. Scoring

Points are penalty points. Lower is better. Only cards remaining in a player's hand at round end count.

| Card | Point Value | Notes |
|---|---|---|
| 2 through 9 | 5 points each | All low number cards equal value |
| 10, Jack, Queen, King | 10 points each | All face/ten cards equal value |
| Ace | 15 points each | High value — use carefully |
| Joker | 25 points each | Highest value — dangerous to hold |

- Cards laid down in melds on the table do NOT count against a player.
- Only cards still in hand at round end count.
- Player who goes out scores 0.
- Cumulative scores are tracked across all 7 rounds.
- Lowest total after Round 7 wins. Tied scores = shared win.

---

## 11. AI Behavior Contract

> **Changed from v1.1:** The original 3-level difficulty system (Easy/Medium/Hard with behavioral descriptions) has been replaced by a 6-personality system. All AI players use the same evaluation-based engine (`evaluateHand`) with different configuration thresholds per personality. No AI uses random decisions — all decisions are evaluation-driven with varying levels of noise and sophistication.

### 11.1 AI Personalities

Six named personalities are available, grouped into three difficulty tiers:

#### Easy Tier

**Rookie Riley** 🐣 (★☆☆☆☆) — "Learning the ropes — plays it safe"
- Take style: basic | Buy style: never | Discard: random
- Goes down immediately | No lay-offs | No joker swaps
- No opponent awareness or denial play

**Steady Sam** 🧢 (★★☆☆☆) — "Reliable and predictable — no surprises"
- Take style: medium | Buy style: conservative (limit 2) | Discard: highest value
- Goes down immediately | Capped at 1 lay-off per turn | No joker swaps
- No opponent awareness or denial play

#### Medium Tier

**Lucky Lou** 🎲 (★★★☆☆) — "Wild and unpredictable — chaos agent"
- Take style: medium | Buy style: aggressive (limit 5) | Discard: highest value
- Goes down immediately with random hold chance | Unlimited lay-offs | Random joker swaps
- 20% random factor on decisions | No opponent awareness

**Patient Pat** 🧘 (★★★★☆) — "Waits for the perfect moment to strike"
- Take style: selective | Buy style: conservative (limit 3) | Discard: run-aware
- Strategic go-down timing | Unlimited lay-offs | Beneficial joker swaps
- No denial play, minimal noise

#### Hard Tier

**The Shark** 🦈 (★★★★★) — "Reads opponents and blocks their plays"
- Take style: aggressive-denial | Buy style: denial (limit 5) | Discard: opponent-aware
- Goes down immediately | Unlimited lay-offs | Optimal joker swaps
- Full opponent awareness (dangerWeight 0.5) | Denial takes enabled
- Grabs cards to deny opponents who are close to going out
- Run window detection: `cardDanger` detects opponent run-building (+60 gap-fill, +30 extension)
- Hand reading: `inferOpponentNeeds` penalizes discards matching opponent suit/rank profiles
- Race mode: sheds highest-point cards when any opponent has ≤3 cards and has laid down
- Round-aware strategy: `getRoundStrategy` adjusts discard weights by round type (set-heavy vs run-heavy)

**The Mastermind** 🧠 (★★★★★) — "Only goes down when going out — ruthless"
- Take style: aggressive-denial | Buy style: heavy-denial (limit 5) | Discard: opponent-aware
- Holds hand until can go out (strategic go-down) | Unlimited lay-offs | Optimal joker swaps
- Full opponent awareness (dangerWeight 0.6) | Denial takes enabled
- Most aggressive buying, lowest panic threshold
- Run window detection: `cardDanger` detects opponent run-building (+60 gap-fill, +30 extension)
- Hand reading: `inferOpponentNeeds` penalizes discards matching opponent suit/rank profiles
- Predictive go-down: `aiShouldGoDownHard` bails if 2+ opponents laid down with ≤3 cards, or holding 80+ pts with any opponent down
- Race mode: sheds highest-point cards when any opponent has ≤3 cards and has laid down
- Round-aware strategy: `getRoundStrategy` adjusts discard weights by round type (set-heavy vs run-heavy)

### 11.2 Evaluation Engine

All AI decisions use `evaluateHand(hand, requirement)` which returns a score from 0 (nothing useful) to 200+ (can go down). The score factors in:
- Complete melds found
- Partial melds (pairs, run windows)
- Joker potential
- Round-type matching (set vs. run progress)
- Multi-run suit coverage (critical for rounds requiring 2–3 runs)
- Isolated card penalties

Every decision (take discard, buy, discard) compares hand evaluation score before and after to determine the best action.

### 11.3 Evaluation Config Per Personality

| Personality | Take Threshold | Buy Risk Tolerance | Discard Noise | Go-Down Style | Opponent Aware | Denial Take | Danger Weight |
|---|---|---|---|---|---|---|---|
| Rookie Riley | 8 | -15 | 15 | immediate | no | no | 0 |
| Steady Sam | 5 | -5 | 8 | immediate | no | no | 0 |
| Lucky Lou | 3 | +10 | 20 | immediate | no | no | 0 |
| Patient Pat | 4 | 0 | 3 | immediate | no | no | 0 |
| The Shark | 3 | +2 | 0 | immediate | yes | yes | 0.5 |
| The Mastermind | 2 | +5 | 0 | strategic | yes | yes | 0.6 |

- **Take Threshold**: Minimum evaluation improvement required to take a discard (higher = pickier).
- **Buy Risk Tolerance**: Adjustment to buy threshold (positive = more willing to buy, negative = reluctant).
- **Discard Noise**: Random variance added to discard evaluation (higher = less optimal discards).
- **Go-Down Style**: `immediate` = go down ASAP; `strategic` = hold for going out.
- **Danger Weight**: 0–1 scale for how much opponent danger influences discard choice.

### 11.4 Opponent Awareness

`cardDanger(card, tableMelds, opponents, opponentHistory)` scores how dangerous a discard is:
- Lay-off onto opponent's meld: +100
- Suit opponent is collecting: +50
- Rank opponent previously picked: +40
- Suit opponent has discarded: -15 (discount)

Shark and Mastermind blend danger into discard ranking via `dangerWeight`. Denial takes: grab cards that extend an opponent's 4+ run when opponent has ≤4 cards, but only low-point cards (≤10) and only when AI hand < 12 cards.

### 11.5 Meld Finding

`aiFindBestMelds` uses three strategies in order:
1. **Greedy** — `tryFindRun`/`tryFindSet` for each step, fast path.
2. **Bounded backtracking** — generates candidates per step (5 for sets, 10 for 2-run, 15 for 3-run rounds). Sorted by length then joker count (fewest jokers first).
3. **Suit-permutation search** — For 2+ run requirements, tries all permutations of suit assignments (e.g., P(4,3)=24 for Round 7).

### 11.6 AI Rules Compliance

Regardless of personality, ALL AI players must follow these hard rules at all times:

- Cannot go out by discarding — last card must be played onto a meld.
- Must have gone down before laying off onto any meld.
- Can only swap jokers from run melds, not sets.
- Cannot buy own discard.
- Cannot exceed the configured buy limit per round.
- Must meet the full round requirement before going down.

---

## 12. Game Presentation

> **New in v1.2.** Documents the cinematic and feel systems in the digital implementation.

### 12.1 Cinematic Moments

**Going Out Sequence** — When a player empties their hand via meld/lay-off:
1. White flash overlay (400ms ease-out)
2. Dimmed board + player name "GOES OUT!" slam-in animation (2s hold)
3. Transition to round summary

**Shanghai Exposure** (in Round Summary) — For shanghaied players:
- "Shanghaied" badge slams in with error haptic
- Cards fan out one-by-one with 60ms stagger flip animation
- Score counts up from 0 with ease-in curve

**Perfect Draw** — After a human draws a card that completes their meld requirement:
- Success haptic + "Ready to lay down!" text (3s)
- Lay Down button pulses gold (5s auto-clear)

**Final Card Drama** — When a human has ≤2 cards and has already laid down:
- Radial vignette spotlight on hand area
- Warm gold edge glow on cards
- "Final card — lay it off to go out" label when exactly 1 card

**Close Race Indicator** — When 2+ players are near finishing (≤3–5 cards with melds laid down):
- Rotating tension commentary: "Race to finish," "Every card counts," "One draw could end it," etc.
- 4.5s fade animation cycle

### 12.2 Toast System

Queued toast notifications overlay at ~35% viewport height with 5 styles:

| Style | Visual | Triggers |
|---|---|---|
| Celebration | Gold gradient, dark text | First to table, going-out streaks |
| Pressure | Red background, white text | Danger events, blocks |
| Neutral | Dark green, light green text | Routine game events |
| Drama | Black with border, white text | Major moments, joker swaps |
| Taunt | Dark green, gold text | Opponent actions |

### 12.3 Game Speed

Three speed settings control AI action delays:

| Speed | AI Delay | Notes |
|---|---|---|
| Fast | 200–400ms | Quick games |
| Normal | 600–1200ms | Default |
| Slow | 2000–3000ms | Easier to follow |

Speed does not affect human input latency or cinematic durations. Toggleable from the pause menu.

### 12.4 Visual Theme

**Light "warm cream" theme** for all non-game screens:

| Token | Hex | Usage |
|---|---|---|
| Page bg | `#f8f6f1` | Body background |
| Card bg | `#ffffff` | Card surfaces |
| Secondary surface | `#efe9dd` | Stat boxes, pill containers |
| Border | `#e2ddd2` | All borders |
| Primary text | `#2c1810` | Body copy, headings |
| Accent gold | `#e2b858` | Primary buttons, chips |

**Dark felt theme** for the game table:
- Round-based felt colors that shift warmer under tension (3s CSS transition between rounds)
- R1 emerald `#1a3a2a`, R2 deep teal `#1a2f3a`, R3 dark plum `#2a1a3a`, R4 rich forest `#1a3a30`, R5 deep burgundy `#3a1a24`, R6 dark navy `#1a2a3a`, R7 warm charcoal `#2e2a1a`

**Card suit tints**: Hearts pink `#fff0f0`, Diamonds blue `#f0f5ff`, Clubs green `#e0f7e8`, Spades lavender `#eeecff`.

### 12.5 Inline Meld Building

When a player taps "Lay Down," the game enters inline meld-building mode:
- Zone 2 (table melds) dims to 50% opacity
- Zone 3 (draw/discard piles) hides
- MeldBuilder renders inline with slide animation
- Player taps cards from hand to assign to meld slots; assigned cards show ghosted (25% opacity) in hand
- "Auto-fill" suggestion banner appears when AI detects valid melds
- Hand sort order is shared between hand display and meld builder

### 12.6 Fan Hand Layout

Hand uses absolute positioning with overlap offset computed by hand size. All cards visible without scrolling. Selected cards lift with translate-y offset.

---

## 13. Online Multiplayer

> **New in v1.2.** Documents the online multiplayer system added post-GDD.

### 13.1 Architecture

Online multiplayer uses a **host-authoritative** architecture over Supabase Realtime Broadcast:
- The host runs the full game engine locally.
- Remote players receive sanitized views and send action messages.
- AI runs only on the host — remote clients never execute AI logic.
- Hand privacy is enforced server-side: each player's view contains only their own hand.

### 13.2 Flow

```
Host creates room (auto-assigned seat 0)
  → Lobby displays SHNG-XXXX room code
  → Players join via room code + name
  → Host can add/remove AI to empty seats
  → Host clicks "Start Game" (min 2 total, 1+ human)
    → Host enters GameBoard (mode='host')
    → Remote players enter RemoteGameBoard
      → GameOver
```

### 13.3 State Sync

The host broadcasts a `RemoteGameView` per remote player on every state change. Each view contains:
- The player's own hand (hand privacy enforced)
- Public state: table melds, discard pile top, pile sizes, scores, current turn
- Cinematic state: going-out sequence, announcements, toasts
- Buying window state with timeout

### 13.4 Player Actions

Remote players send `PlayerAction` messages via Broadcast:
- Draw from pile / take discard
- Accept / decline free offer
- Meld confirmation (with joker positions)
- Lay-off (card + meld IDs)
- Joker swap
- Discard
- Buy / pass decision
- Undo discard

The host validates each action through `mapActionToHandler` before applying it to the game state.

### 13.5 Buying Timeout

Remote players get a **15-second timeout** to respond to buy opportunities. If no response, the host auto-passes on their behalf.

### 13.6 Privacy Screens

In host mode, privacy screens are skipped for remote humans (each player has their own device). Local pass-and-play mode retains privacy screens between human turns.

### 13.7 Database Tables

| Table | Key Columns |
|---|---|
| `game_rooms` | `id`, `room_code`, `host_player_id`, `status` ('waiting'/'playing'/'finished'), `game_id` |
| `game_room_players` | `id`, `room_id`, `player_name`, `is_ai`, `is_ready`, `is_connected`, `seat_index` |

### 13.8 Game Type

Online multiplayer games are saved with `game_type: 'online'`. Other game types: `'pass-and-play'` (all human local), `'ai'` (local with AI), `'manual'` (score tracker).

---

## 14. Score Tracker

> **New in v1.2.** Documents the manual score tracking feature.

The app includes a separate score tracker mode for tracking physical card game sessions:
- Create a game, select players, enter date
- Enter scores round-by-round (7 rounds)
- Real-time sync via Supabase Realtime — multiple devices see live score updates
- Shareable room codes (same SHNG-XXXX format) for remote score viewing
- Games saved with `game_type: 'manual'`
- Full game history with import/export (JSON, Excel/CSV)

---

## 15. Analytics Dashboard

> **New in v1.2.** Documents the telemetry and analytics system.

A self-contained analytics page for viewing AI and player performance telemetry. Four tabs:

| Tab | Content |
|---|---|
| Overview | Game/round/decision counts, win rates by difficulty, shanghai rates |
| AI Quality | Avg score, take accuracy, shanghai rate, going-down timing by difficulty |
| Rounds | Performance by round number (1–7); rounds 3 & 7 highlighted as pure-run rounds |
| Decisions | Filterable by difficulty + decision type; outcome summaries, reason breakdowns |

Telemetry is fire-and-forget — logging never blocks or breaks gameplay. Three telemetry tables:

| Table | Purpose |
|---|---|
| `ai_decisions` | Per-decision log: game, round, turn, player, type, result |
| `player_round_stats` | Per-round summary: score, went out, went down |
| `player_game_stats` | Per-game summary: total score, final rank, won |

---

## 16. Edge Cases & Clarifications

| Situation | Rule |
|---|---|
| Multiple players want same discard | Next player gets free option first. Then turn-order window. First to claim wins. |
| Draw pile runs out | Shuffle discard pile (except top card) into new draw pile. If still not enough, add another deck. |
| Lay-off empties hand | Player goes out immediately. No discard needed. |
| Tied final score | Shared win. No tiebreaker. |
| Ace in a run | High (Q-K-A) or low (A-2-3). K-A-2 wrapping is INVALID. |
| Joker in a set | Cannot be swapped out. Stays in the set permanently. |
| Buying after going down | Allowed. Any player regardless of laid-down status can buy. |
| Going down and out same turn | Allowed. Lay required melds + lay off all remaining cards = out immediately. |
| Next player takes free discard | That is their draw. They do NOT also draw from the pile. |
| Buy limit set to 0 | Buying is disabled entirely for that game. No buying window opens. |
| Lay off onto own fresh melds | Allowed. You may lay off onto melds you placed this same turn. |
| Shanghaied player | No extra penalty. Full hand scored at face value. Typically 80–200+ points. |
| Joker extends run beyond bounds | Not allowed. A joker may not extend a run below Ace-low or above Ace-high. |
| Medium AI lay-off cap | Capped at 1 lay-off per turn, EXCEPT when holding exactly 1 card (going-out lay-off always allowed). |
| Stalemate (AI can't discard) | Stalemate counter incremented, turn skipped. Prevents infinite loops. |

---

## 17. Deployment

- **Platform**: Progressive Web App (PWA) deployed on Vercel.
- **SPA Routing**: `vercel.json` rewrites all routes to `index.html`.
- **Offline**: PWA manifest generated by `vite-plugin-pwa` with Workbox caching (Supabase API responses cached 24h).
- **Mobile-first**: Safe-area padding for notched devices, haptic feedback (`navigator.vibrate`, silent no-op on iOS/desktop).

---

## 18. Sound System

- **Engine**: Web Audio API via `src/lib/sounds.ts`. Single AudioContext, two GainNode chains (SFX, Notification).
- **16 sounds**: card-draw, card-snap, card-deal, card-shuffle, meld-slam, lay-off, joker-swap, going-out, shanghai-sting, buy-ding, round-fanfare, win-celebration, turn-notify, button-tap, error-buzz, countdown-tick.
- **Two volume channels**: SFX (game actions) and Notification (turn alerts). Each independently adjustable 0–1, persisted in localStorage. Default: 0.7.
- **Volume UI**: Two sliders in the pause menu of both GameBoard and RemoteGameBoard.
- **Concurrent limit**: Max 4 simultaneous sounds; oldest dropped.
- **Multiplayer**: Remote players hear sounds triggered by view state changes (going-out, buying, opponent events). No extra broadcast events — piggybacks on existing data.
- **File format**: `.wav` preferred, falls back to `.mp3`. Assets in `public/sounds/`.
- **Lazy initialization**: AudioContext created on first user interaction (browser autoplay policy).

---

## 19. Card Physics & 3D Animations

- **Pure CSS**: No animation library. Uses `perspective`, `transform-style: preserve-3d`, `backface-visibility: hidden`.
- **GPU composited**: All animations use `transform` and `opacity` only — no layout thrashing.
- **3D Card Flip**: `isFlipped` prop on Card.tsx. Front/back faces with `rotateY(180deg)` transition (400ms).
- **Deal Arc**: Cards fly from center to hand positions with arc trajectory, staggered 60ms per card.
- **Draw Slide**: Newly drawn card slides in from left (350ms). `lastDrawnCardId` state in GameBoard, passed as `drawSlideCardId` to HandDisplay.
- **Discard Toss**: Card lifts, rotates slightly, lands on discard pile (300ms).
- **Meld Slam Bounce**: Scale bounce 0.7 → 1.08 → 1 on meld appearance (400ms).
- **Pile Depth**: Draw pile shows 3 stacked cards with offset shadows (static).
- **Enhanced Buy Snatch**: `bc-snatch-fly` includes 15° rotation.
- **Keyframes**: Defined in `src/index.css` — `deal-arc`, `draw-slide`, `discard-toss`, `meld-slam-bounce`, `pile-wobble`.

---

## 20. In-Game Emotes

- **8 preset emotes**: 👏 Nice!, 😂 Haha, 😱 Wow, 😤 Come on!, 🔥 On fire!, 💀 RIP, 🎯 Calculated, 👋 GG.
- **EmoteBar.tsx**: Slide-up emoji selector triggered by a 😊 button. 3-second cooldown between sends.
- **EmoteBubble.tsx**: Floating emoji bubble above the sender's player card. Auto-fades after 2.5 seconds.
- **Broadcast**: `emote` event on the Supabase Realtime channel with payload `{ seatIndex, emoteId, timestamp }`.
- **Ephemeral**: No database storage. Emotes are broadcast-only.
- **Multiplayer only**: EmoteBar hidden in local/pass-and-play mode.

---

## 21. Push Notifications

- **Browser Notification API** (local, not Web Push). Tab must be open but can be unfocused.
- **Permission**: Requested once in the lobby when joining or creating a room.
- **Triggers**: Turn notification ("It's your turn in SHNG-XXXX"), game starting, someone went out, game over.
- **Conditions**: Only fires when `document.hidden === true`. Never fires for the player's own actions.
- **Tag replacement**: Uses `tag: 'shanghai-turn'` so new notifications replace old ones.

---

## 22. Achievements & Milestones

- **16 badges** across 4 categories:
  - **🌱 Beginner** (4): First Hand, Going Down, Clean Sweep, Buyer's Market.
  - **⭐ Skill** (4): Hat Trick (3 outs in a row), Zero Buys, The Heist (joker swap), Comeback Kid.
  - **💎 Mastery** (4): Shutout (all 7 rounds out), Shark Slayer, Mastermind Slayer, Century Club (100 games).
  - **🤝 Social** (4): Party Host (10 online games), Full House (8 players), Globetrotter (20 opponents), Shanghai! (5 shanghais).
- **Detection**: `checkAchievements()` called at round-end and game-end. The Heist and Buyer's Market detected inline in handlers.
- **Storage**: `player_achievements` table (player_name, achievement_id, unlocked_at).
- **Display**: Gold celebration toast on unlock. Badge grid in PlayerProfileModal. Achievements tab in StatsLeaderboard.

---

## 23. Spectator Mode

- **Entry**: Join a room via room code when the game is already in `'playing'` status → "Watch this game" button.
- **SpectatorBoard.tsx**: Read-only view showing ALL players' hands (no privacy — game is being watched).
- **Broadcast**: Host sends `spectator_view` event alongside per-player `game_state` events. Contains full hand data for all players.
- **Features**: All cinematics (going-out, round announcements), toasts, scoreboard bottom-sheet.
- **No interactions**: No card tapping, no action buttons. Only "Leave" and scoreboard toggle.
- **Not tracked**: Spectators join via the broadcast channel only — not stored in `game_room_players`.

---

## 24. Game Replay System

- **Action Log**: Every game action logged fire-and-forget to `game_action_log` table via `logAction()`. Fields: game_id, seq, player_index, action_type, action_data (jsonb).
- **Logged actions**: draw_pile, take_discard (with suit/rank), discard (with suit/rank), meld_confirm, lay_off, joker_swap, buy, decline_free_offer, going_out, round_start, round_end.
- **ReplayViewer.tsx**: Loads action log by game ID, displays as scrollable timeline. Playback controls: play/pause, step forward/back, speed (1x/2x/4x), scrub bar.
- **Access**: "Watch Replay" button on the GameOver screen after completing a play-mode game.
- **Opponent model integration**: Action log data feeds The Nemesis AI's opponent model learning.

---

## 25. Adaptive AI — The Nemesis

- **7th AI personality**: Joins Rookie Riley, Steady Sam, Lucky Lou, Patient Pat, The Shark, The Mastermind.
- **Opponent model**: Tracks per-human-player patterns in localStorage. Fields: suitBias, avgBuyRate, avgGoDownRound, discardPatterns, takePatterns, gamesAnalyzed.
- **Learning**: `updateOpponentModel()` called post-game using the action log. Running weighted averages across games.
- **Counter-strategies** (`buildNemesisOverrides()`):
  - **Suit denial**: If opponent favors a suit (bias > 0.3), Nemesis holds those cards longer.
  - **Buy aggression**: If opponent buys aggressively, Nemesis increases buy tolerance.
  - **Go-down timing**: If opponent goes down late, Nemesis rushes. If early, Nemesis holds.
  - **Rank avoidance**: Avoids discarding ranks the opponent frequently takes.
- **Fallback**: Plays like The Shark when no model exists (< 2 games analyzed).
- **Base config**: takeThreshold 3, buyRiskTolerance 5 (+ model adjustment), zero noise, strategic go-down, opponent-aware, dangerWeight 0.6 (+ model adjustment).

---

## 26. Online Tournaments

- **Format**: Single elimination. 4 players (2 rounds) or 8 players (3 rounds).
- **Tournament codes**: `TRNY-XXXX` format.
- **Flow**: Create → players join → host starts → bracket auto-generated (random seeding) → each match creates a game room → winners advance → champion crowned.
- **Database**:
  - `tournaments` table: id, code, host_name, player_count, format, status.
  - `tournament_matches` table: id, tournament_id, round_number, match_index, player_names[], winner_name, room_code, status.
- **Live updates**: Supabase Realtime subscription via `useTournamentChannel` hook.
- **Match lifecycle**: Host clicks "Start Match" → `createMatchRoom()` → game room auto-created → both players navigate to game → game ends → `reportMatchResult()` + `advanceWinner()` → bracket updates.
- **BYE handling**: Auto-resolved — player with BYE opponent advances immediately.
- **UI**: TournamentLobby.tsx (create/join/bracket), BracketView.tsx (visual bracket).

---

## 27. Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0 | March 2025 | Initial master document — rules extracted from source and verified with game owner. |
| 1.1 | March 2025 | Corrected scoring values. Buys changed to configurable per-round setting (default 5). Fixed 7 rounds confirmed. Shanghai defined as name only. Confirmed lay-off allowed onto own fresh melds same turn. Bonus meld type rules confirmed. |
| 1.2 | March 2026 | **Major update to match codebase.** Removed bonus melds (§3.4 — code only supports required melds). Replaced 3-level AI difficulty with 6-personality evaluation-based system (§11). Removed joker-swap reversal rule (§8.2 — not enforced in code). Added online multiplayer (§13), score tracker (§14), analytics dashboard (§15), game presentation/cinematics (§12), undo discard (§5.3), buy-window highlights (§7.3), joker run bounds (§8.1), deployment details (§17). Updated buy limit options. Added edge cases for stalemate and AI lay-off cap. |
| 1.3 | March 2026 | **Feature expansion.** Added sound system (§18), card physics/3D animations (§19), in-game emotes (§20), push notifications (§21), achievements/milestones (§22), spectator mode (§23), game replay system (§24), adaptive AI "The Nemesis" (§25), online tournaments (§26). AI strategic fixes: no buying after laying down, post-down discard prioritizes highest points, lay-off prefers own melds, joker take gated by hasLaidDown, round-relative joker buy threshold. AI intelligence upgrades for Shark/Mastermind/Nemesis: run window detection, hand reading (`inferOpponentNeeds`), predictive go-down (Mastermind), race mode, round-aware strategy (`getRoundStrategy`). Multiplayer overhaul: heartbeat, action ACKs, host disconnect detection, broadcast throttle, session recovery. |

---

*This document must be updated any time a rule changes. All departments must be notified. The GDD is the contract — code follows it, not the other way around.*
