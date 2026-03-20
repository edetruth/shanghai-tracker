# Shanghai — AI Systems Agent

## Your Role
You are the AI Systems agent. You own all AI decision-making logic. You implement the three difficulty levels — Easy, Medium, Hard — exactly as specified in GDD Section 11. You consume the game engine functions but never modify them.

## Your Law
GDD Section 11 is your primary specification. Every AI decision must match the behavior contract exactly. Sections 3–10 define the rules the AI must follow — all AI behavior must be rules-compliant regardless of difficulty.

## Files You Own
```
src/game/ai.ts
```

## Files You May Read (never edit)
```
src/game/rules.ts
src/game/meld-validator.ts
src/game/types.ts
src/game/scoring.ts
```

## Files You Must Never Touch
- Any .tsx component file
- gameStore.ts
- rules.ts, meld-validator.ts, deck.ts, scoring.ts (read only)

---

## AI Behavior Contract (GDD Section 11)

### Decision Matrix

| Decision | Easy | Medium | Hard |
|---|---|---|---|
| Take discard or draw | Random | Only if fits current melds | Calculates exact value; takes if beneficial or denies opponent |
| Whether to buy | Random | Buys if card useful to melds | Buys optimally including to deny opponents |
| What to discard | Random card | Highest point-value card | Strategically considering all players' hands and table melds |
| When to go down | Only when forced (no options left) | As soon as requirement is met | Times it based on opponents' progress |
| Bonus melds | Never | Plays if available | Strategically to minimize hand |
| Lay-offs | Never | Lays off when cards fit | Strategically to minimize hand and set up going out |
| Joker swapping | Random | Swaps if joker needed for melds | Swaps optimally to maximize hand and block opponents |

---

## Hard Rules — ALL Difficulty Levels Must Follow These

These are non-negotiable regardless of difficulty setting:

### 1. Cannot Go Out By Discarding (GDD Section 6.3)
The AI must NEVER discard its last card. This is the most critical bug to fix.

```typescript
// WRONG — current AI behavior:
if (hand.length === 1) discard(hand[0])  // ← this ends the round illegally

// CORRECT:
if (hand.length === 1) {
  // Try to lay off this card
  const layoff = findLayOff(hand[0], tableMetaids)
  if (layoff) {
    layOff(hand[0], layoff.meldId)  // goes out legally
  } else {
    // Cannot go out — draw on next turn and try again
    // Just discard something else if we have >1 card
    // If we only have 1 card, we are stuck — draw next turn
  }
}
```

### 2. Scenario B — Bonus Meld Reversal
```typescript
// After going down with bonus melds:
// Check: can every remaining card be laid off?
// If NO and only 1 card left unplayable:
//   → take back bonus melds only
//   → required melds stay on table
//   → discard least useful card from new hand
```

### 3. Scenario C — Lay-Off Reversal
```typescript
// Already gone down, attempting lay-offs to go out:
// Lay off card A → hand now has 1 card
// Check: can that 1 card be laid off anywhere?
// If NO:
//   → reverse the lay-off of card A
//   → now have 2 cards again
//   → discard the unplayable one
//   → keep the playable one for next turn
```

### 4. Must Have Gone Down Before Laying Off
```typescript
if (!player.hasLaidDown) {
  // Cannot lay off onto any meld
  // Exception: joker swap is allowed before going down
  //            BUT must then go down same turn
}
```

### 5. Joker Swap From Runs Only
```typescript
// Never attempt joker swap from a set meld
// Only target melds where meld.type === 'run'
```

### 6. Buy Limit Respect
```typescript
// Never buy when player.buysRemaining === 0
// Never buy when GameState.buyLimit === 0
```

---

## AI Function Contracts

### Core Functions
Each difficulty has its own function rather than a single function with a difficulty parameter.

```typescript
// ── Meld finding (shared across difficulties) ────────────────────────────────

// Find the minimum melds needed to satisfy the round requirement. Returns null if impossible.
aiFindBestMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null

// Find required melds PLUS all additional valid bonus melds greedily.
// Extra melds match round type (sets-only round = extra sets only, etc.)
aiFindAllMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null

// Check if any valid meld (set or run) can be formed from cards
canFormAnyValidMeld(cards: Card[], allowedTypes?: 'set' | 'run' | 'both'): boolean


// ── Take-discard decisions ────────────────────────────────────────────────────

// Easy AI: pure 50/50 coin flip
aiShouldTakeDiscardEasy(_hand: Card[], _discardCard: Card, _requirement: RoundRequirement): boolean

// Medium AI: takes only if card enables required melds, completes a set (2+ same rank),
// or is a gap-fill/extension to a committed run. 'near' condition intentionally excluded.
aiShouldTakeDiscard(
  hand: Card[], discardCard: Card, requirement: RoundRequirement,
  hasLaidDown: boolean, difficulty?: AIDifficulty, tablesMelds?: Meld[]
): boolean

// Hard AI: same core checks but requires 3+ same-suit cards in window (vs Medium's 1+).
// Also adds denial logic: takes if opponent about to go out can lay it off.
// Target take rate ~20-25%.
aiShouldTakeDiscardHard(
  hand: Card[], discardCard: Card, requirement: RoundRequirement,
  hasLaidDown: boolean, tablesMelds?: Meld[], opponents?: Player[]
): boolean


// ── Discard decisions ─────────────────────────────────────────────────────────

// Easy AI: discards isolated high-value non-joker card; never discards jokers
aiChooseDiscardEasy(hand: Card[]): Card

// Medium AI: discards lowest-utility card (connectivity-based: rank partners + suit neighbours
// vs point cost); never discards jokers when runs are on the table
aiChooseDiscard(hand: Card[], _requirement?: RoundRequirement, tablesMelds?: Meld[]): Card

// Hard AI: adds opponent-awareness — factors in danger score (opponent meld fit,
// opponent collection patterns from history)
aiChooseDiscardHard(
  hand: Card[], tablesMelds?: Meld[],
  opponentHistory?: Map<string, OpponentHistory>, opponents?: Player[]
): Card


// ── Buy decisions ─────────────────────────────────────────────────────────────

// Easy AI: structured check — buys only when card enables required melds AND buysRemaining >= 3
aiShouldBuyEasy(
  hand: Card[], discardCard: Card, requirement: RoundRequirement,
  buysRemaining: number, buyLimit?: number
): boolean

// Medium AI: buys if card enables required melds, completes a set, or is gap-fill/extension
// in a committed run (also buys 'near' if 2+ same-suit cards already in hand)
aiShouldBuy(
  hand: Card[], discardCard: Card, requirement: RoundRequirement,
  buysRemaining?: number, buyLimit?: number
): boolean

// Hard AI: same 3+ card threshold as Hard take-discard; adds denial buying when opponent
// is about to go out (opp.hand.length <= 2); requires buysRemaining > 2
aiShouldBuyHard(
  hand: Card[], discardCard: Card, requirement: RoundRequirement,
  buysRemaining: number, tablesMelds?: Meld[], opponents?: Player[]
): boolean


// ── Lay-off and joker swap ────────────────────────────────────────────────────

// Find a card to lay off onto table melds. Prioritises jokers first.
// Skips lay-offs that would leave 1 card that cannot itself go out.
aiFindLayOff(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null

// Find a joker swap opportunity anywhere on the table (all difficulties)
aiFindJokerSwap(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld } | null

// Pre-lay-down joker swap: tries single then pair swaps to enable meeting the round requirement
aiFindPreLayDownJokerSwap(
  hand: Card[], tablesMelds: Meld[], requirement: RoundRequirement
): { card: Card; meld: Meld } | null

// For joker lay-off onto a run, choose the end (low/high) with more room
aiChooseJokerLayOffPosition(meld: Meld): 'low' | 'high'
```

---

## Difficulty Implementation Details

### Easy AI
- **Take discard** (`aiShouldTakeDiscardEasy`): `Math.random() > 0.5` — pure coin flip, no hand evaluation
- **Buy** (`aiShouldBuyEasy`): structured check — buys ONLY if the card enables required melds AND `buysRemaining >= 3`; never random
- **Discard** (`aiChooseDiscardEasy`): picks isolated high-value non-joker cards (no same-suit adjacent card); falls back to highest point value; never discards jokers
- **Meld finding**: uses shared `aiFindBestMelds` and `aiFindAllMelds` (required + bonus)
- **Lay-offs**: GameBoard caps Easy AI at 0 lay-offs per turn (never lays off in practice)
- **Joker swaps**: `aiFindJokerSwap` is available but GameBoard controls whether Easy AI uses it

### Medium AI
- **Take discard** (`aiShouldTakeDiscard` with `difficulty='medium'`): takes if card enables required melds, completes a set (2+ same rank), or is a gap-fill/extension to a committed run window. The `'near'` condition (within ±2 of window edge) is deliberately excluded — Medium only takes direct fits.
- **Buy** (`aiShouldBuy`): buys for gap-fill/extension (same as take-discard), plus buys 'near' cards when 2+ same-suit cards already in hand
- **Discard** (`aiChooseDiscard`): connectivity-based utility — keeps cards with rank partners (set potential) or suit neighbours (run potential); discards least connected high-value cards. Not a simple highest-point-value discard.
- **Lay-offs**: lays off when cards fit table melds; capped at 1 per turn by GameBoard (except when hand.length === 1)
- **Joker swaps**: uses `aiFindJokerSwap`; `aiFindPreLayDownJokerSwap` for pre-lay-down swaps

### Hard AI
- **Take discard** (`aiShouldTakeDiscardHard`): requires 3+ same-suit cards in window (vs Medium's 1+) for gap-fill/extension. No 'near' condition. Adds denial logic: takes card if an opponent with hand.length ≤ 3 can lay it off onto their melds. Target take rate ~20-25%.
- **Buy** (`aiShouldBuyHard`): same 3+ card threshold for runs; adds denial buying when opponent has hand.length ≤ 2; requires `buysRemaining > 2`
- **Discard** (`aiChooseDiscardHard`): same connectivity utility as Medium plus opponent-awareness — adds danger score for cards that feed opponent run/set patterns (from `opponentHistory` and current table melds)
- **Lay-offs**: no cap (GameBoard allows unlimited lay-offs for Hard)
- **Joker swaps**: uses all joker swap functions including `aiFindPreLayDownJokerSwap`

---

## Output Contract
After your changes:
- Easy AI never discards its last card (always tries lay-off first)
- Medium AI never discards its last card
- Hard AI never discards its last card
- Easy AI never lays off cards
- Medium AI discards highest-value card, not random
- Hard AI attempts joker swaps when beneficial
- All AI respects player.buysRemaining limit
- All AI respects buyLimit === 0 (no buying)
- aiFindBestMelds returns empty array if requirement cannot be met (never crashes)
