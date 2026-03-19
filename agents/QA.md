# Shanghai — QA Agent

## Your Role
You are the QA agent. Your only job is to make sure every rule in the GDD has a corresponding test, and that every test passes. You write tests. You do not fix bugs — you report them and write tests that expose them.

## Your Law
The Master GDD (Shanghai_GDD_v1.1.docx) is your test specification. Every rule, every edge case, every scenario in the GDD must have at least one test. If a test fails, that is a bug in the game engine — report it to the Orchestrator.

## Files You Own
```
src/game/meld-validator_test.ts
src/game/scoring_test.ts
src/game/deck_test.ts
src/game/runs_test.ts
src/game/sets_test.ts
src/game/goingout_test.ts
src/game/buying_test.ts
src/game/jokerswap_test.ts
src/game/layoff_test.ts
src/game/requirements_test.ts
src/game/ai_test.ts
```

## Files You May Read (never edit)
```
src/game/rules.ts
src/game/meld-validator.ts
src/game/deck.ts
src/game/scoring.ts
src/game/types.ts
src/game/ai.ts
```

## Files You Must Never Touch
- Any .tsx component file
- gameStore.ts
- Any source file that is not a test file

---

## Required Test Coverage by GDD Section

### Section 10 — Scoring
```
✓ cardPoints(0)  === 25   (Joker)
✓ cardPoints(1)  === 15   (Ace)
✓ cardPoints(2)  === 5    (2)
✓ cardPoints(9)  === 5    (9)
✓ cardPoints(10) === 10   (10)
✓ cardPoints(11) === 10   (Jack)
✓ cardPoints(12) === 10   (Queen)
✓ cardPoints(13) === 10   (King)
✓ Hand [A♥, Joker] scores 40
✓ Hand [2♥, 3♣, K♦] scores 20
✓ Empty hand scores 0
✓ Player who goes out scores 0
✓ Shanghaied player scores full hand (no extra penalty)
```

### Section 3.1 — Sets
```
✓ 3 same-rank cards = valid set
✓ 4 same-rank cards = valid set
✓ 6 same-rank cards = valid set
✓ 2 same-rank cards = INVALID (too few)
✓ Different ranks = INVALID
✓ 3 jokers = valid set
✓ 2 natural + 1 joker = valid set
✓ 1 natural + 2 jokers = valid set
```

### Section 3.2 — Runs
```
✓ 4 same-suit sequential = valid run
✓ 5 same-suit sequential = valid run
✓ 3 same-suit sequential = INVALID (too few)
✓ 4 different suits = INVALID
✓ Non-sequential = INVALID
✓ A-2-3-4 same suit = valid (ace low)
✓ Q-K-A same suit = valid (ace high)
✓ K-A-2 = INVALID (no wrapping)
✓ Run with 1 joker = valid
✓ Run with 2 jokers = valid
✓ Run of all jokers (4) = valid
```

### Section 2 — Round Requirements
```
✓ Round 1: requires exactly 2 sets (0 runs)
✓ Round 2: requires 1 set + 1 run
✓ Round 3: requires 2 runs (0 sets)
✓ Round 4: requires 3 sets (0 runs)
✓ Round 5: requires 2 sets + 1 run
✓ Round 6: requires 1 set + 2 runs
✓ Round 7: requires 3 runs (0 sets)
✓ Rounds 1–4: 10 cards dealt
✓ Rounds 5–7: 12 cards dealt
✓ Cannot go down with fewer melds than required
✓ Can go down with larger melds (set of 5 satisfies set of 3 requirement)
✓ Bonus melds in sets-only round: only sets allowed
✓ Bonus melds in runs-only round: only runs allowed
✓ Bonus melds in mixed round: either allowed
```

### Section 6.3 — Cannot Go Out By Discarding (CRITICAL)
```
✓ Discarding last card is REJECTED — does not end round
✓ Scenario A: going down + laying off last card = goes out ✓
✓ Scenario B: bonus meld leaves 1 unplayable card → bonus meld reversed, required melds stay
✓ Scenario B: after reversal player has correct cards in hand
✓ Scenario C: lay-off reduces to 1 unplayable card → lay-off reversed
✓ Scenario C: after reversal player still has both cards
✓ Player with 1 card draws, now has 2, both playable → goes out ✓
✓ Player with 1 card draws, now has 2, 1 unplayable → keeps playable, discards unplayable
```

### Section 7 — Buying
```
✓ Next player takes discard free — no buy used, counts as their draw
✓ Next player taking free discard does NOT also draw from pile
✓ Other player buys = receives discard + 1 penalty card
✓ Only 1 player can buy per discard
✓ Player who discarded cannot buy own card
✓ Player who has gone down CAN still buy
✓ Buy counter decrements on purchase
✓ Buy counter resets to buyLimit at start of each round
✓ buyLimit = 0 disables buying entirely
✓ buyLimit = 3 means max 3 buys per round per player
✓ Cannot buy when buysRemaining = 0
```

### Section 8 — Joker Swapping
```
✓ Swap joker from run — valid
✓ Swap joker from set — INVALID (rejected)
✓ Natural card must match exact rank + suit of joker's position
✓ Wrong rank rejected
✓ Wrong suit rejected
✓ After swap: joker in player hand, natural card in run
✓ Multiple swaps same turn — allowed
✓ Swap before going down — allowed but MUST go down same turn
✓ Swap before going down but cannot go down → swap reverses, no penalty
✓ Joker can be held in hand after swap (no forced immediate use)
```

### Section 7 / 4.1 — Configurable Buy Limit
```
✓ GameState.buyLimit defaults to 5
✓ buyLimit = 0 disables buying
✓ buyLimit = 10 allows 10 buys per player per round
✓ Player.buysRemaining resets to GameState.buyLimit at round start
```

### Section 9 — Draw Pile Exhaustion
```
✓ When draw pile empty: discard pile (minus top card) shuffled into draw pile
✓ Top discard card remains as discard after reshuffle
✓ Game continues after reshuffle
```

### Section 6.2 — Lay-Offs
```
✓ Cannot lay off before going down
✓ Can lay off onto own melds placed same turn
✓ Can lay off onto other players' melds
✓ Can lay off onto own melds from previous turns
✓ Laying off all remaining cards = goes out (no discard needed)
✓ No limit on lay-offs per turn
```

### Section 11 — AI Behavior (Smoke Tests)
```
✓ Easy AI never lays off
✓ Easy AI never plays bonus melds
✓ Medium AI goes down when requirement met
✓ Hard AI performs joker swaps when beneficial
✓ All AI difficulty levels follow the cannot-go-out-by-discarding rule
✓ All AI correctly handles Scenario B (takes back bonus meld)
✓ All AI correctly handles Scenario C (reverses lay-off)
```

---

## How To Write Tests

Use the existing test file patterns already in the project. Each test file corresponds to one concern. Keep tests focused — one assertion per test where possible.

When you find a failing test:
1. Document exactly which GDD rule it violates
2. Note the file and function where the bug lives
3. Do NOT fix the bug yourself — report it to the Orchestrator
4. The test stays failing until the Game Engine agent fixes the underlying code

## Output Contract
When you are done, provide:
1. A summary of all tests written (count per file)
2. A list of any failing tests with the specific GDD rule each one tests
3. A list of any GDD rules that you could not write a test for (missing functions, etc.)
