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

### Core Functions (keep these signatures stable — Frontend depends on them)

```typescript
// Find the best combination of melds to satisfy the round requirement
aiFindBestMelds(hand: Card[], requirement: RoundRequirement, difficulty: AIDifficulty): Meld[]

// Find required melds + all possible bonus melds
aiFindAllMelds(hand: Card[], requirement: RoundRequirement, difficulty: AIDifficulty): Meld[]

// Should AI take the top discard card?
aiShouldTakeDiscard(card: Card, hand: Card[], requirement: RoundRequirement, hasLaidDown: boolean, difficulty: AIDifficulty): boolean

// Which card should AI discard?
aiChooseDiscard(hand: Card[], tableMetaids: Meld[], difficulty: AIDifficulty): Card

// Should AI buy the current discard?
aiShouldBuy(card: Card, hand: Card[], requirement: RoundRequirement, hasLaidDown: boolean, buysRemaining: number, buyLimit: number, difficulty: AIDifficulty): boolean

// Find a card to lay off onto table melds
aiFindLayOff(hand: Card[], tableMelds: Meld[], difficulty: AIDifficulty): { card: Card; meldId: string } | null

// Find a joker swap opportunity on the table
aiFindJokerSwap(hand: Card[], tableMelds: Meld[], hasLaidDown: boolean, difficulty: AIDifficulty): { naturalCard: Card; meldId: string; jokerIndex: number } | null
```

---

## Difficulty Implementation Details

### Easy AI
- `aiShouldTakeDiscard`: `Math.random() > 0.5` — pure coin flip
- `aiShouldBuy`: `Math.random() > 0.7` — buys about 30% of the time randomly
- `aiChooseDiscard`: random card from hand (not joker-aware)
- `aiFindBestMelds`: finds minimum required melds only
- `aiFindAllMelds`: returns required melds only (no bonus)
- `aiFindLayOff`: always returns null (never lays off)
- `aiFindJokerSwap`: random 50/50 whether to attempt a swap
- Goes down only when it has no other choice (hand is depleted or requirement exactly met with nothing else possible)

### Medium AI
- `aiShouldTakeDiscard`: takes if card directly completes or extends a meld in current hand
- `aiShouldBuy`: buys if card completes a meld or is needed for the round requirement
- `aiChooseDiscard`: discards the card with the highest point value (per GDD Section 10 scoring)
- `aiFindBestMelds`: finds optimal combination for the round requirement
- `aiFindAllMelds`: finds required + any additional valid melds
- `aiFindLayOff`: lays off when a card fits any existing meld
- `aiFindJokerSwap`: swaps if the joker is needed to complete a meld this turn
- Goes down as soon as the round requirement is met

### Hard AI
- `aiShouldTakeDiscard`: full hand evaluation — takes if it improves expected score OR denies a key card from an opponent who needs it
- `aiShouldBuy`: buys optimally — considers card value to own hand AND strategic denial of opponents
- `aiChooseDiscard`: evaluates all players' visible melds and known needs; discards least dangerous card
- `aiFindBestMelds`: finds optimal combination
- `aiFindAllMelds`: greedily finds all possible melds to minimize hand
- `aiFindLayOff`: maximizes lay-offs each turn — lay off multiple cards when possible
- `aiFindJokerSwap`: proactively seeks joker swaps to improve hand; considers blocking opponents
- Times going down based on: own hand strength, opponents' progress, round number

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
