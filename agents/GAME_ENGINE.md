# Shanghai — Game Engine Agent

## Your Role
You are the Game Engine agent. You own the pure game logic layer. Your code has zero knowledge of UI, components, or Supabase. Everything you write must be fully testable in isolation.

## Your Law
The Master GDD (Shanghai_GDD_v1.1.docx) is your specification. Every function you write must implement exactly what the GDD says — nothing more, nothing less. If the current code contradicts the GDD, fix the code.

## Files You Own
```
src/game/rules.ts
src/game/meld-validator.ts
src/game/deck.ts
src/game/scoring.ts
src/game/types.ts
```

## Files You May Read (never edit)
```
src/game/ai.ts           — understand how AI consumes your functions
src/game/turn-manager.ts — understand turn flow dependencies
src/game/buy-manager.ts  — understand buy logic dependencies
```

## Files You Must Never Touch
- Any .tsx component file
- gameStore.ts
- Any Supabase-related file
- ai.ts (read only)

---

## GDD Rules You Implement

### Scoring (GDD Section 10)
```
cardPoints(rank):
  rank === 0  → 25   (Joker)
  rank === 1  → 15   (Ace)
  rank >= 10  → 10   (10, J, Q, K)
  rank 2–9    → 5    (all low cards equal value)
```
⚠ The current code is WRONG. It uses face value for 2–10 and Ace=20, Joker=50. Fix this.

### Round Requirements (GDD Section 2)
```
Round 1: sets=2, runs=0  (10 cards)
Round 2: sets=1, runs=1  (10 cards)
Round 3: sets=0, runs=2  (10 cards)
Round 4: sets=3, runs=0  (10 cards)
Round 5: sets=2, runs=1  (12 cards)
Round 6: sets=1, runs=2  (12 cards)
Round 7: sets=0, runs=3  (12 cards)
```

### Sets (GDD Section 3.1)
- 3 or more cards, same rank, any suit
- No joker minimum or maximum
- No upper size limit

### Runs (GDD Section 3.2)
- 4 or more cards, same suit, consecutive ranks
- Ace is high (Q-K-A) AND low (A-2-3-4)
- K-A-2 wrapping is INVALID
- No joker minimum or maximum
- No upper size limit

### Joker Swapping (GDD Section 8)
- Only from RUN melds — never from sets
- Natural card must exactly match rank AND suit the joker represents
- Swap before going down: allowed BUT player MUST go down same turn
- If swap happens but player cannot go down: swap reverses, no penalty
- Multiple swaps per turn: allowed

### Going Out (GDD Section 6.3) — CRITICAL
- Player can NEVER go out by discarding their last card
- Final card must be played onto a meld (lay-off or part of going down)
- Scenario B: bonus meld leaves 1 unplayable card → take back ONLY bonus meld, required melds stay, discard least useful card
- Scenario C: already gone down, lay off reduces to 1 unplayable card → reverse that lay-off, discard the unplayable card

### Deck Composition (GDD Section 1.1)
- 2–4 players: 2 decks (4 jokers total)
- 5–8 players: 3 decks (6 jokers total)

### Draw Pile Exhaustion (GDD Section 9)
- Shuffle discard pile (except top card) into new draw pile
- If still not enough: add another full deck

### Bonus Melds (GDD Section 3.4)
- Same minimum sizes as required melds (sets 3+, runs 4+)
- Must match round type (sets-only round = extra sets only, etc.)

---

## Configurable Buy Limit (GDD Section 4.1)
The buy limit is no longer hardcoded. It must come from GameState:
```typescript
// Add to GameState in types.ts:
buyLimit: number  // configured at game setup, default 5, range 0–unlimited

// Player.buysRemaining resets to buyLimit at start of each round
// buyLimit === 0 means buying is disabled entirely
```

---

## Key Type Contracts
Keep these interfaces stable — AI and Frontend depend on them:

```typescript
interface Card {
  id: string
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker'
  rank: number  // 0=Joker, 1=Ace, 2-10, 11=Jack, 12=Queen, 13=King
  deckIndex: number
}

interface Meld {
  id: string
  type: 'set' | 'run'
  cards: Card[]
  ownerId: string
  ownerName: string
  jokerMappings: JokerMapping[]
  runMin?: number
  runMax?: number
  runSuit?: Suit
  runAceHigh?: boolean
}

interface Player {
  id: string
  name: string
  hand: Card[]
  melds: Meld[]
  hasLaidDown: boolean
  buysRemaining: number  // resets to buyLimit each round
  roundScores: number[]
  isAI?: boolean
}

interface GameState {
  players: Player[]
  currentRound: number
  roundState: RoundState
  deckCount: number
  gameOver: boolean
  buyLimit: number  // NEW — configured at setup
}
```

---

## Output Contract
After your changes, these must all be true:
- `cardPoints(0)` returns 25
- `cardPoints(1)` returns 15
- `cardPoints(10)` returns 10
- `cardPoints(9)` returns 5
- `cardPoints(2)` returns 5
- A player with hand [A♥, Joker] scores 40 points
- A player with hand [2♥, 3♥] scores 10 points
- Joker swap from a set throws/returns error
- Joker swap from a run before going down works but forces go-down
- Going out by discard is rejected
- GameState includes buyLimit field
