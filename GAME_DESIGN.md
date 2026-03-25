# Shanghai Rummy — Game Design Document

## Your Group's Complete House Rules

### The Basics
- **Players:** 2-8
- **Decks:** 2 decks (with jokers) for 2-4 players, 3 decks (with jokers) for 5+
- **Rounds:** 7 rounds per game, played in fixed order
- **Objective:** Lowest total score across all 7 rounds wins

### The 7 Rounds

| Round | Required Hand | Cards Dealt |
|-------|--------------|-------------|
| 1 | 2 Sets | 10 |
| 2 | 1 Set + 1 Run | 10 |
| 3 | 2 Runs | 10 |
| 4 | 3 Sets | 10 |
| 5 | 2 Sets + 1 Run | 12 |
| 6 | 1 Set + 2 Runs | 12 |
| 7 | 3 Runs | 12 |

### Melds
- **Set:** 3 or more cards of the same rank (e.g., 7♥ 7♦ 7♠)
- **Run:** 4 or more cards in sequence of the same suit (e.g., 4♠ 5♠ 6♠ 7♠)
- **Aces:** Can be high OR low in runs (A-2-3-4 or J-Q-K-A both valid)
- **Jokers:** Wild — can substitute for any card. No limit on jokers per meld.
- **Melds are permanent** — once placed on the table, they cannot be rearranged
- **Joker swaps allowed (runs only)** — if a RUN on the table contains a joker, any player (who has already laid down their required hand) can swap in the natural card the joker represents and take the joker into their hand. Jokers in SETS cannot be swapped — their suit is ambiguous (a 7-set joker could be 7♣ or 7♠). The joker from a run can then be used in a new meld or laid off elsewhere.

### Turn Flow
1. **Draw** — Take the top card from either the draw pile or the discard pile
2. **Meld (optional)** — Lay down your required hand if you have it. You **must** meet the minimum round requirement, but you **may** lay down additional valid sets or runs beyond the requirement in the same turn to reduce your hand size.
3. **Lay off (optional)** — After laying down your required hand, you may add cards to ANY player's existing melds on the table
4. **Check: hand empty?** — If all cards were melded/laid off, you go out. The round ends immediately.
5. **Discard (mandatory)** — If your hand is not empty, you **must** discard one card. You cannot end your turn without discarding.

### Going Out
- A player goes out when they meld or lay off ALL remaining cards in their hand (step 4 above)
- **You CANNOT go out by discarding.** Discarding your last card is not allowed — you must have a meld or lay-off opportunity for every remaining card.
- No final discard is required when going out — if you can meld/lay off every card, you're out immediately
- The round ends immediately when someone goes out
- A player with 1 card who cannot lay it off anywhere is "stuck" — they must draw on their next turn and try again

### Buying (Out-of-Turn Draws)
- **5 buys per player per game** (not per round — across all 7 rounds)
- When a card is discarded, any player (not just the next in turn) can request to "buy" it
- **The buyer receives:** the discard pile card PLUS one penalty card drawn from the top of the draw pile (so they gain 2 cards)
- **Priority:** If multiple players want the same card, the player closest to the discarder (in turn order) gets priority
- **The player whose actual turn it is** always gets first right to draw from the discard pile — buying only applies to out-of-turn players

### Scoring (End of Round)
When a player goes out, all other players count the cards remaining in their hand:

| Card | Point Value |
|------|------------|
| Number cards (2-10) | Face value |
| Face cards (J, Q, K) | 10 points |
| Aces | 20 points |
| Jokers | 50 points |

- **Shanghai penalty:** If you haven't laid down your required hand when someone goes out, ALL cards in your hand are counted. No extra penalty beyond the card values — but since you're holding 10-12 cards, the score is massive (typically 100-200+ points).
- A score of **0** means the player went out (melded/laid off all cards).
- Only **one player** can go out (score 0) per round.

### Dealer Rotation
- Dealer rotates clockwise each round
- Player to the left of the dealer goes first

---

## Game Architecture — Phase 1: Core Engine

### Overview
Phase 1 builds the card engine and game logic — no multiplayer, no UI polish. The goal is a working game where all rules are enforced correctly. This can be tested in a simple pass-and-play mode on one device.

### Data Models

```typescript
// ─── Card ───
interface Card {
  id: string;           // unique identifier (e.g., "h7-1" = 7 of hearts, deck 1)
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
  rank: number;         // 1=Ace, 2-10, 11=Jack, 12=Queen, 13=King, 0=Joker
  deckIndex: number;    // which deck this card is from (for multi-deck games)
}

// ─── Meld ───
interface Meld {
  id: string;
  type: 'set' | 'run';
  cards: Card[];
  ownerId: string;        // player who laid it down
  jokerMappings: {        // tracks what each joker represents
    cardId: string;       // the joker's card ID
    representsRank: number;
    representsSuit: string;
  }[];
}

// ─── Player ───
interface Player {
  id: string;
  name: string;
  hand: Card[];
  melds: Meld[];        // melds they've laid down
  hasLaidDown: boolean;  // has met the round requirement
  buysRemaining: number; // starts at 5, decrements across rounds
  scores: number[];      // score per round (index 0-6)
}

// ─── Round State ───
interface RoundState {
  roundNumber: number;           // 1-7
  requirement: RoundRequirement; // what melds are needed
  cardsDealt: number;            // 10 or 12
  drawPile: Card[];
  discardPile: Card[];
  players: Player[];
  currentPlayerIndex: number;
  turnPhase: 'draw' | 'meld' | 'discard' | 'buying';
  pendingBuyRequests: BuyRequest[];
  dealerIndex: number;
}

// ─── Buy Request ───
interface BuyRequest {
  playerId: string;
  priority: number;     // distance from discarder in turn order
}

// ─── Round Requirements ───
interface RoundRequirement {
  sets: number;         // how many sets needed
  runs: number;         // how many runs needed
  description: string;  // "2 Sets", "1 Set + 1 Run", etc.
}

// ─── Full Game State ───
interface GameState {
  id: string;
  players: Player[];
  currentRound: number;  // 1-7
  roundState: RoundState;
  deckCount: number;     // 2 or 3 depending on player count
  gamePhase: 'lobby' | 'playing' | 'roundEnd' | 'gameEnd';
  winner: string | null;
}
```

### Core Game Logic Modules

```
src/
  game/
    deck.ts              — Create deck(s), shuffle, deal
    meld-validator.ts    — Validate sets, runs, jokers, required hands
    scoring.ts           — Calculate hand points, track totals
    turn-manager.ts      — Turn flow: draw → meld → lay off → discard
    buy-manager.ts       — Handle buy requests, priority, penalty cards
    round-manager.ts     — Round setup, progression, end conditions
    game-manager.ts      — Full game flow across 7 rounds
    rules.ts             — Constants (round requirements, point values, etc.)
```

### Module Details

#### deck.ts
```
createDeck(deckCount: number): Card[]
  - Creates 52 cards per deck + 2 jokers per deck
  - For 2 decks: 108 cards total
  - For 3 decks: 162 cards total
  - Each card has a unique ID including deck index

shuffleDeck(cards: Card[]): Card[]
  - Fisher-Yates shuffle

dealCards(deck: Card[], playerCount: number, cardsPerPlayer: number):
  { hands: Card[][], remainingDeck: Card[] }
  - Deals cards one at a time, rotating through players
  - Returns each player's hand and the remaining draw pile
```

#### meld-validator.ts — THE HARDEST MODULE
```
isValidSet(cards: Card[]): boolean
  - 3+ cards of same rank
  - Jokers can substitute for any card
  - Must have at least 1 natural (non-joker) card
  - Cards can come from different suits

isValidRun(cards: Card[]): boolean
  - 4+ cards in sequence, same suit
  - Jokers fill gaps
  - Aces can be high (Q-K-A) or low (A-2-3) but not wrap (K-A-2)
  - Must have at least 1 natural card

meetsRoundRequirement(melds: Meld[], requirement: RoundRequirement): boolean
  - Check that the melds contain the required number of sets and runs
  - Extra cards beyond the requirement are OK (they reduce hand size)

canLayOff(card: Card, existingMeld: Meld): boolean
  - For sets: card matches the rank
  - For runs: card extends the sequence at either end (or fills via joker)
  - Player must have already laid down their required hand

getValidMeldCombinations(hand: Card[], requirement: RoundRequirement): Meld[][]
  - Given a hand, find all possible ways to form the required melds
  - This is the most complex function — combinatorial search
  - Used for: validating player's proposed melds, AI hints, auto-detect
```

#### buy-manager.ts
```
requestBuy(playerId: string, gameState: RoundState): BuyRequest | null
  - Check if player has buys remaining (across all rounds, max 5)
  - Check if it's not their actual turn
  - Calculate priority (distance from discarder)

resolveBuyRequests(requests: BuyRequest[]): string | null
  - Returns the winning buyer's ID (closest to discarder)
  - Returns null if no requests

executeBuy(buyerId: string, gameState: RoundState): RoundState
  - Give buyer the top discard card
  - Give buyer one additional card from draw pile (penalty)
  - Decrement buyer's buysRemaining
  - Resume normal turn order
```

#### turn-manager.ts
```
drawCard(playerId: string, source: 'draw' | 'discard', state: RoundState): RoundState
  - Player picks up from draw pile or discard pile
  - Only the current turn player can draw from discard without buying

meldCards(playerId: string, proposedMelds: Meld[], state: RoundState): RoundState | Error
  - Validate melds meet round requirement
  - Remove cards from player's hand
  - Add melds to the table
  - Set player.hasLaidDown = true

layOffCard(playerId: string, card: Card, targetMeldId: string, state: RoundState): RoundState | Error
  - Verify player has laid down (hasLaidDown must be true)
  - Verify card can extend the target meld
  - Remove card from hand, add to meld

swapJoker(playerId: string, naturalCard: Card, targetMeldId: string, jokerIndex: number, state: RoundState): RoundState | Error
  - Verify player has laid down (hasLaidDown must be true), OR verify they can lay down after the swap (pre-lay-down swap)
  - Target meld must be a RUN — joker swaps from sets are not allowed (suit is ambiguous)
  - Verify the natural card matches the exact rank AND suit the joker represents in the run
  - For a run: natural card must be the specific rank+suit the joker is filling
  - Remove natural card from hand, place it in the meld at joker's position
  - Move the joker into the player's hand
  - The player can then use the joker to meld, lay off, or hold it

discardCard(playerId: string, card: Card, state: RoundState): RoundState
  - Remove card from hand, add to discard pile
  - Cannot discard if it would empty the hand (going out via discard is not allowed)
  - Advance to next player (Rule 9A: next player gets first right to take the discard)

checkGoOut(playerId: string, state: RoundState): boolean
  - Can this player play ALL remaining cards?
  - Check combinations of melding + laying off
  - If yes AND they have 0 cards after → round ends
```

#### scoring.ts
```
calculateHandScore(hand: Card[]): number
  - Sum up point values: number cards = face value, J/Q/K = 10, A = 20, Joker = 50

isShanghaied(player: Player): boolean
  - Returns true if player hasn't laid down their required hand
  - Their full hand gets counted (typically 100-200+ points)

calculateRoundScores(state: RoundState): { playerId: string, score: number }[]
  - Player who went out = 0
  - Everyone else = sum of remaining hand
  - Flag Shanghai'd players
```

### Key Technical Challenges

#### 1. Meld Validation is Combinatorial
A player might hold cards that could form multiple valid meld combinations. For example, three 7s could be a set, but one of those 7s might also fit into a run. The engine needs to:
- Find ALL valid combinations for the round requirement
- Let the player choose which combination to use
- Or auto-suggest the best option (lowest remaining hand points)

#### 2. Joker Ambiguity and Swapping
A joker in a run has a fixed identity based on its position. If a run is 5♠-Joker-7♠, the joker represents 6♠. A player holding the natural 6♠ can swap it in and take the joker back into their hand. Key rules:
- Every meld tracks what each joker represents (via `jokerMappings`)
- **Runs only**: a joker's identity is fixed by its position in the sequence — swappable
- **Sets excluded**: a joker in a set has ambiguous suit (could be any suit of that rank) — NOT swappable per house rules
- After a swap from a run, the player gains a joker and can use it immediately to meld or lay off — this creates powerful chain plays

#### 3. Buying Window
After each discard, there's a brief window where any player can request a buy. In multiplayer this is real-time. In pass-and-play it can be a prompt. The engine needs a state for this: `turnPhase: 'buying'`.

#### 4. Ace Ambiguity in Runs
A-2-3-4 is valid (ace low). Q-K-A is valid (ace high). But K-A-2 is NOT valid (no wrapping). The engine needs to handle aces at both ends but reject wraps.

### Phase 1 Deliverable
A working game engine with:
- ✅ Deck creation, shuffling, dealing
- ✅ Full turn flow (draw, meld, lay off, discard)
- ✅ Meld validation (sets, runs, jokers, round requirements)
- ✅ Joker swap system (swap natural card for joker in existing melds)
- ✅ Buying system with priority and penalty cards
- ✅ Scoring with Shanghai detection
- ✅ Round progression through all 7 rounds
- ✅ Game-over state with final totals
- ✅ Unit tests for all rule edge cases

### Phase 1 does NOT include:
- ❌ UI beyond basic pass-and-play
- ❌ Real-time multiplayer
- ❌ AI opponents
- ❌ Animations or visual polish
- ❌ Room codes or lobby system

---

## Completed Phases

### Phase 2: Pass-and-Play UI ✅
- Mobile-friendly card display with scrollable hand fan
- Tap to select cards, tap piles to draw, tap melds to lay off
- Visual table showing all melds laid down by all players
- Turn indicator, privacy screen between turns, buying window prompt
- Round summary screen with scores; 7-round progression
- Sort toggle: order hand by Rank or Suit
- Colorblind-friendly suit tints: hearts `#fff5f5`, diamonds `#f5f8ff`, clubs `#f5fff7`, spades `#f8f8f8`
- Draw pile auto-reshuffle when empty (all but top discard card); proactive reshuffle at draw phase start so players never see "0 cards"; fresh deck fallback if both piles are empty (GDD §9)
- Undo discard: 3-second toast window for human players
- Pause modal: Resume or Abandon

### Phase 3: Online Multiplayer — Score Tracker ✅
- Supabase Realtime for live score sync in the score tracker (not digital play mode)
- Room codes (`SHNG-XXXX`) generated on game creation; displayed as tap-to-copy bar in ScoreEntry
- Join Game enabled: enter a room code to follow scores on a secondary device
- Score entry only writes rounds 0..currentRound to prevent zero-fill pollution on sync

### Phase 4: AI Opponents ✅
- Medium and Hard difficulty rule-based AI (`src/game/ai.ts`)
- `aiFindBestMelds` — finds optimal meld combination for the round requirement
- `aiFindAllMelds` — finds required melds + greedily finds all additional valid melds (used for AI lay-down)
- `canFormAnyValidMeld` — utility: returns true if any set or run is possible from given cards
- `aiShouldTakeDiscard` / `aiShouldTakeDiscardHard` — evaluates if top discard improves AI's hand (self-interest only, no denial takes)
- `aiChooseDiscard` / `aiChooseDiscardHard` — Medium/Hard discard strategies (Hard uses opponent-aware danger scoring)
- `aiShouldBuy` / `aiShouldBuyHard` — Medium uses simple criteria; Hard uses cost/benefit evaluation (`calculateBuyValue` vs `calculateBuyRisk`, no fixed buy cap)
- `aiFindLayOff` — extends existing table melds after laying down
- `aiFindJokerSwap` — Hard AI only: finds jokers on the table the AI can reclaim by swapping in a natural card
- Medium AI capped at 1 lay-off per turn to prevent dumping all same-rank cards onto one meld; Hard AI has no cap
- **AI Personalities** (`PERSONALITIES` in `src/game/types.ts`): Rookie Riley, Steady Sam (easy), Lucky Lou, Patient Pat (medium), The Shark, The Mastermind (hard). Each has a `PersonalityConfig` controlling take/buy/discard/goDown/layOff/jokerSwap styles.
  - The Shark: `goDownStyle: 'immediate'`, opponent-aware discarding, aggressive take
  - The Mastermind: `goDownStyle: 'hold-for-out'`, `panicThreshold: 2`, opponent-aware discarding
- Per-slot AI toggle in `GameSetup`: Human/Bot icon, auto-fills "AI {n}" name, at least 1 human enforced
- **Difficulty selector** in `GameSetup` (shown when any AI player added): Easy, Medium, Hard
- AI skips the privacy screen; turns automated with 700–1200ms delays via `useEffect` + `useRef` (fresh state)

### Phase 5: Polish ✅
- Haptic feedback utility (`src/lib/haptics.ts`): `tap`, `heavy`, `success`, `error` patterns via `navigator.vibrate`
- First-run tutorial overlay: 4 slides (Welcome / Play Game / Score Tracker / Stats), slide dots, Skip/Next/Get Started
- Tutorial re-openable via `HelpCircle` button on the home screen
- Auto-save to Supabase on game over: `savePlayedGame()` creates game record with `game_type` tag (`pass-and-play` or `ai`)
- Save status badge in `GameOver`: Loader → CheckCircle | AlertCircle
- `game_type` column on `games` table enables filter in Stats leaderboard (All / Tracker / Played)
- Game type badges ("vs AI", "Played") on game cards and in drilldown lists

### Phase 6: Gameplay Fixes & AI Difficulty ✅
- **Extra melds rule**: players may lay down additional valid melds beyond the round requirement in one turn; `MeldModal` walks required melds, then prompts "Lay Down More?" if further melds are possible
- **Meld builder sort order**: `MeldModal` receives the player's sorted hand so cards appear in the same Rank/Suit order as the hand display
- **Discard selection reset**: selecting cards in `HandDisplay` is now cleared after every lay-off action; 1-card hand auto-activates the discard button
- **AI difficulty selector**: Easy (Coming Soon), Medium, Hard — shown in `GameSetup` when any AI player is added
- **Hard AI**: opponent-aware discard (danger scoring), cost/benefit buying (no fixed cap), joker-swap reclaim, unlimited lay-offs per turn
- **Pause button**: enlarged to 44px touch target with gold background for visibility

### Phase 7: Cinematic Game Moments ✅
- **Cinematic buying window** (`BuyingCinematic.tsx`): full-screen overlay replaces old banner. Card rises to center, AI decides silently (passes hidden, buys = "Snatched!" burst), human gets large Buy/Pass buttons. Unclaimed card sinks back. Free-offer phase for next-in-turn player.
- **Going-out cinematic**: 2.5s sequence — white flash → dimmed board + "GOES OUT!" slam-in → round summary
- **Shanghai exposure** (in `RoundSummary`): badge slam + haptic, card fan-out with flip animation, score count-up with ease-in curve
- **Perfect draw detection**: detects when a draw newly enables the round requirement → shimmer + "Ready to lay down!" + Lay Down button gold pulse
- **Final card drama**: vignette spotlight on hand, warm glow on remaining cards, "Final card" label when 1 card left
- **Buy-window hand highlights**: cards relevant to the offered discard glow gold (set match) or green (run neighbor), others dim to 50%

### Remaining / Future
- Sound effects
- Online multiplayer for digital play mode (hidden hands per device, real-time game state sync)
- Shanghai event leaderboard (requires `shanghai_events` table — migration included, tracking not yet wired to play mode)
