# Shanghai — AI Systems Agent

## Your Role
You are the AI Systems agent. You own all AI decision-making logic. You implement personality-driven AI behavior using a unified evaluation system. Six AI personalities share the same core functions but diverge through `AIEvalConfig` and `PersonalityConfig` tuning. You consume the game engine functions but never modify them.

## Your Law
All AI decisions must be rules-compliant regardless of personality. The evaluation-based architecture means every decision (take, buy, discard, go-down timing) is driven by `evaluateHand()` — the single "brain" that scores a hand from 0 (nothing useful) to 200+ (ready to go down). Personality configs control thresholds, noise, and awareness, not separate code paths.

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

## AI Architecture Overview

### Unified Evaluation System
All AI decisions flow through a single evaluation pipeline:

1. **`evaluateHand(hand, requirement)`** scores the hand holistically (0–200+)
2. For each decision (take discard, buy, discard), the AI compares hand score before/after
3. **`AIEvalConfig`** per personality controls thresholds that determine how much improvement is "enough"
4. **`PersonalityConfig`** per personality controls behavioral style flags (lay-off caps, joker swap willingness, go-down timing, etc.)

There are no separate Easy/Medium/Hard function implementations. A single function (e.g., `aiShouldTakeDiscard`) accepts an `AIEvalConfig` parameter. The personality's config determines the decision outcome.

### Personality System

Six personalities, mapped to three difficulty tiers:

| Personality | Difficulty | Key Traits |
|---|---|---|
| **Rookie Riley** | Easy | High take threshold (8), no buying, high discard noise (15), no opponent awareness |
| **Steady Sam** | Easy | Moderate thresholds, slight noise (8), conservative buying, capped lay-offs |
| **Lucky Lou** | Medium | Low thresholds, high noise (20), aggressive buying (+10 tolerance), chaos agent |
| **Patient Pat** | Medium | Balanced thresholds, minimal noise (3), strategic go-down timing |
| **The Shark** | Hard | Zero noise, opponent-aware discards (dangerWeight 0.5), denial takes/buys |
| **The Mastermind** | Hard | Zero noise, highest opponent awareness (dangerWeight 0.6), holds for going out |

**Difficulty mapping** (in `personalityToLegacyDifficulty`):
- `'easy'` → Rookie Riley, Steady Sam
- `'medium'` → Lucky Lou, Patient Pat
- `'hard'` → The Shark, The Mastermind

### AIEvalConfig

Defined in `src/game/ai.ts`:

```typescript
export interface AIEvalConfig {
  takeThreshold: number    // minimum improvement to take discard (Riley=8, Mastermind=2)
  buyRiskTolerance: number // added to improvement vs risk (Riley=-15, Lou=+10, Mastermind=+5)
  discardNoise: number     // random variance on discard eval (0=optimal, 20=chaotic)
  goDownStyle: 'immediate' | 'strategic'
  opponentAware: boolean   // factor opponent danger into discards
  denialTake: boolean      // take/buy cards purely to deny opponents
  dangerWeight: number     // 0-1: how much cardDanger influences discard choice
}
```

Actual config values:

| Personality | takeThreshold | buyRiskTolerance | discardNoise | goDownStyle | opponentAware | denialTake | dangerWeight |
|---|---|---|---|---|---|---|---|
| Rookie Riley | 8 | -15 | 15 | immediate | false | false | 0 |
| Steady Sam | 5 | -5 | 8 | immediate | false | false | 0 |
| Lucky Lou | 3 | 10 | 20 | immediate | false | false | 0 |
| Patient Pat | 4 | 0 | 3 | immediate | false | false | 0 |
| The Shark | 3 | 2 | 0 | immediate | true | true | 0.5 |
| The Mastermind | 2 | 5 | 0 | strategic | true | true | 0.6 |

### PersonalityConfig

Defined in `src/game/types.ts`. Controls behavioral style flags consumed by GameBoard:

```typescript
export interface PersonalityConfig {
  id: AIPersonality
  name: string
  emoji: string
  description: string
  difficulty: number  // 1-5
  takeStyle: 'basic' | 'medium' | 'selective' | 'aggressive-denial'
  buyStyle: 'never' | 'conservative' | 'aggressive' | 'denial' | 'heavy-denial'
  discardStyle: 'random' | 'highest-value' | 'run-aware' | 'opponent-aware'
  goDownStyle: 'immediate' | 'immediate-random-hold' | 'strategic' | 'hold-for-out'
  layOffStyle: 'never' | 'capped-1' | 'unlimited'
  jokerSwapStyle: 'never' | 'random' | 'beneficial' | 'optimal'
  denialEnabled: boolean
  opponentAwareness: boolean
  randomFactor: number
  buySelfLimit: number
  panicThreshold: number
  denialOpponentCardThreshold: number
}
```

---

## AI Behavior Contract

### Decision Matrix

| Decision | Evaluation Method | Personality Differentiation |
|---|---|---|
| Take discard or draw | `evaluateHand` before/after; take if improvement >= `takeThreshold` + size adjust | Riley needs +8 improvement, Mastermind needs +2. Shark/Mastermind add denial takes for opponent-awareness. Run-heavy rounds get bonus for run-building cards. |
| Whether to buy | `evaluateHand` improvement vs composite risk (hand size + opponent pressure + penalty cost) | `buyRiskTolerance` shifts the threshold: Riley at -15 almost never buys, Lou at +10 buys aggressively. Shark/Mastermind add denial buying. |
| What to discard | For each non-joker: `evaluateHandFast` of hand-without-card; pick card whose removal hurts least | `discardNoise` adds random variance (Lou=20 makes suboptimal picks). `dangerWeight` blends in `cardDanger` for Shark/Mastermind. Run-window protection penalizes discarding run-building cards. |
| When to go down | Immediate for most; `aiShouldGoDownHard` for strategic personalities | Mastermind (`goDownStyle: 'hold-for-out'`) waits up to 3 turns if remaining cards are few and opponents have many cards. Always goes down if an opponent has laid down or has <=4 cards. |
| Lay-offs | `aiFindLayOff` — prioritizes jokers, skips stranding lay-offs | GameBoard caps by `layOffStyle`: Riley=never, Sam=capped-1 (except going-out), Shark/Mastermind/Lou/Pat=unlimited |
| Joker swapping | `aiFindJokerSwap` / `aiFindPreLayDownJokerSwap` | Controlled by `jokerSwapStyle`: Riley/Sam=never, Lou=random, Pat=beneficial, Shark/Mastermind=optimal |

---

## Hard Rules — ALL Personalities Must Follow These

These are non-negotiable regardless of personality:

### 1. Cannot Go Out By Discarding
The AI must NEVER discard its last card. Going out is ONLY possible by melding or laying off ALL remaining cards.

```typescript
if (hand.length === 1) {
  // Try to lay off this card
  const layoff = aiFindLayOff(hand, tablesMelds)
  if (layoff) {
    layOff(layoff.card, layoff.meld)  // goes out legally
  } else {
    // Cannot go out — draw on next turn and try again
  }
}
```

### 2. Lay-Off Reversal
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

`aiFindLayOff` handles this internally — it skips any lay-off that would leave 1 card that cannot itself go out (checked via `canGoOutViaChainLayOff`).

### 3. Must Have Gone Down Before Laying Off
```typescript
if (!player.hasLaidDown) {
  // Cannot lay off onto any meld
  // Exception: joker swap is allowed before going down
  //            BUT must then go down same turn
}
```

### 4. Joker Swap From Runs Only
```typescript
// Never attempt joker swap from a set meld
// Only target melds where meld.type === 'run'
// findSwappableJoker enforces this
```

### 5. Buy Limit Respect
```typescript
// Never buy when player.buysRemaining <= 0
// aiShouldBuy checks this as its first guard
```

### 6. Joker Run Bounds
A joker may not extend a run below rank 1 (Ace-low) or above rank 14 (Ace-high). `canLayOff` returns false when `runMin === 1 && runMax === 14`. AI `aiChooseJokerLayOffPosition` always picks the end that has room.

### 7. Only Required Melds
Players must meet the minimum round requirement to lay down — only the required melds are laid down (no extra/bonus melds beyond the requirement).

---

## AI Function Contracts

### Hand Evaluation

```typescript
// Holistic hand scoring: 0 (nothing useful) to 200+ (ready to go down).
// Scores complete melds (40 pts), pairs (15 pts if sets required), run windows
// (20-70 pts based on length and joker-fillable gaps), joker potential, multi-run
// suit coverage bonus/deficit, and isolated card penalties.
// If hand can meet the requirement: returns 200 - remaining_points.
evaluateHand(hand: Card[], requirement: RoundRequirement): number

// Fast variant that skips the expensive aiFindBestMelds call for discard loops.
// Called once per card in hand during discard evaluation. Uses precomputed
// canMeldFull flag to avoid redundant meld-finding.
evaluateHandFast(hand: Card[], requirement: RoundRequirement, canMeldFull: boolean): number
```

### Meld Finding

```typescript
// 3-tier meld solver: greedy → bounded backtracking → suit-permutation search.
// Returns Card[][] (one array per required meld slot) or null if impossible.
//
// Tier 1: Greedy — tryFindRun/tryFindSet for each step, fast path.
// Tier 2: Bounded backtracking — generates candidates per step (5 for sets,
//   10 for 2-run, 15 for 3-run rounds). Sorted by length then joker count
//   (fewest jokers first to conserve for later steps).
// Tier 3: Suit-permutation search — for 2+ run requirements, tries all
//   permutations of suit assignments (P(4,3)=24 for R7). Each suit gets a
//   run slot and tryFindRunFromCards finds the best run using fewest jokers first.
aiFindBestMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null

// Lay-off-aware meld selection. Generates up to 2 candidate meld combinations
// (sets-first vs runs-first) and scores each by lay-off potential of remaining
// cards against table melds. Picks the combination that leaves the most
// lay-off-able remainders.
aiFindBestMeldsForLayOff(
  hand: Card[],
  requirement: RoundRequirement,
  tablesMelds: Meld[],
): Card[][] | null
```

### Take-Discard Decision

```typescript
// Unified take-discard decision for all personalities.
// Core logic: evaluateHand before/after, take if improvement >= takeThreshold + sizeAdjust.
// Special cases:
//   - Always takes jokers.
//   - Always takes if card enables going down (score jumps to 150+).
//   - Run-heavy round bonus: +4/+6 improvement for run-building cards in R3/R6/R7.
//   - Denial take (Shark/Mastermind): takes cards that extend opponent melds when
//     opponent has <=6 cards and has laid down. Mastermind denies even high-point cards.
//   - Size adjustment: +1 at 10+ cards, +3 at 12+ cards.
aiShouldTakeDiscard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
  config: AIEvalConfig,
  tablesMelds?: Meld[],
  opponents?: Player[],
): boolean
```

### Buy Decision

```typescript
// Buying has a hidden cost (penalty card from draw pile), so uses risk assessment.
// Risk = handSizeRisk (3-40 based on cards over round base) + opponentPressure (0-50)
//        + penaltyCardCost (5).
// Decision: improvement + runBuyBonus + buyRiskTolerance > risk.
// Special cases:
//   - Always buys jokers (unless hand >= 14 cards).
//   - Always buys if card enables going down (unless opponent about to win).
//   - Run-heavy round bonus: +5/+8 for run neighbors in R3/R6/R7.
//   - Denial buy (Shark/Mastermind): buys to deny opponents close to going out
//     if buysRemaining >= 2 and card lays off onto any table meld.
aiShouldBuy(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining: number,
  config: AIEvalConfig,
  players?: { hand: { length: number }, hasLaidDown: boolean }[],
  tablesMelds?: Meld[],
): boolean
```

### Discard Decision

```typescript
// For each non-joker: evaluateHandFast of hand-without-card.
// Discards the card whose removal hurts least (highest "without" score).
// Additional factors:
//   - Never discards jokers (unless hand is ALL jokers).
//   - Post-lay-down path: discards dead-weight (can't lay off) first, highest
//     points first. Cooperative: prefers feeding downed opponents over undowned.
//   - Run-window protection: penalizes discarding cards that shrink run windows
//     (-8/-12 in run-heavy rounds).
//   - Opponent danger: cardDanger score weighted by dangerWeight subtracts from
//     the "without" score so dangerous cards are avoided.
//   - Discard noise: random variance (discardNoise * 2 range) for weaker personalities.
aiChooseDiscard(
  hand: Card[],
  requirement: RoundRequirement,
  config: AIEvalConfig,
  tablesMelds?: Meld[],
  opponents?: Player[],
  opponentHistory?: Map<string, OpponentHistory>,
  hasLaidDown?: boolean,
): Card
```

### Opponent Danger Scoring

```typescript
// Scores how dangerous a card is to discard (how much it helps opponents).
// Returns 0 when no opponent data is available.
// Checks:
//   1. Card lays off onto opponent's meld: +100 (or +200 if opponent has <=3 cards)
//   2. Suit collecting: +50 if opponent picked 2+ of this suit, +20 for 1
//   3. Rank collecting: +40 if opponent picked this rank
//   4. Opponent discarded same suit/rank: -15/-10 (safer)
cardDanger(
  card: Card,
  tablesMelds: Meld[],
  opponents?: Player[],
  opponentHistory?: Map<string, OpponentHistory>,
): number
```

### Lay-Off, Joker Swap, Go-Down Timing

```typescript
// Find a card to lay off onto table melds. Prioritizes jokers first.
// Skips lay-offs that would strand the AI (1 card remaining that can't go out,
// checked via canGoOutViaChainLayOff).
aiFindLayOff(
  hand: Card[],
  tablesMelds: Meld[],
): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null

// Find a natural card in hand that can replace a joker in a table run.
// Only targets run melds (jokers in sets have ambiguous suit).
aiFindJokerSwap(
  hand: Card[],
  tablesMelds: Meld[],
): { card: Card; meld: Meld } | null

// Pre-lay-down joker swap: tries single then pair swaps to enable meeting the
// round requirement. Swaps a natural card for a joker, then checks if the new
// hand (with the joker) can satisfy the requirement via aiFindBestMelds.
aiFindPreLayDownJokerSwap(
  hand: Card[],
  tablesMelds: Meld[],
  requirement: RoundRequirement,
): { card: Card; meld: Meld } | null

// For a joker being laid off on a run, choose the end (low/high) with more room.
// Respects joker run bounds: picks 'high' if runMin === 1, 'low' if runMax === 14.
aiChooseJokerLayOffPosition(meld: Meld): 'low' | 'high'

// Strategic go-down timing for Mastermind personality.
// Always goes down if: going out immediately, can chain lay-off out, an opponent
// has laid down, waited 3+ turns, or any opponent has <=4 cards.
// May hold if: remaining points >= 40, remaining cards <= 2, has lay-off potential,
// and all opponents have >= 7 cards.
aiShouldGoDownHard(
  hand: Card[],
  melds: Card[][],
  requirement: RoundRequirement,
  tablesMelds: Meld[],
  players: Player[],
  currentPlayerIndex: number,
  turnsWaited: number,
): boolean

// Returns the AIEvalConfig for a given personality.
getAIEvalConfig(personality: AIPersonality): AIEvalConfig
```

### Legacy Wrappers (deprecated)

The following functions exist for backward compatibility but delegate to the unified functions with the appropriate personality config:

```typescript
/** @deprecated Use aiShouldTakeDiscard with config */
aiShouldTakeDiscardEasy(hand, discardCard, requirement)
  → aiShouldTakeDiscard(hand, discardCard, requirement, false, AI_EVAL_CONFIGS['rookie-riley'])

/** @deprecated Use aiShouldTakeDiscard with config */
aiShouldTakeDiscardHard(hand, discardCard, requirement, hasLaidDown, tablesMelds, opponents)
  → aiShouldTakeDiscard(hand, discardCard, requirement, hasLaidDown, AI_EVAL_CONFIGS['the-shark'], tablesMelds, opponents)

/** @deprecated Use aiChooseDiscard with config */
aiChooseDiscardEasy(hand) → aiChooseDiscard(hand, undefined, AI_EVAL_CONFIGS['rookie-riley'])

/** @deprecated Use aiChooseDiscard with config */
aiChooseDiscardHard(hand, tablesMelds, opponentHistory, opponents)
  → aiChooseDiscard(hand, undefined, AI_EVAL_CONFIGS['the-shark'], tablesMelds, opponents, opponentHistory)

/** @deprecated Use aiShouldBuy with config */
aiShouldBuyEasy(hand, discardCard, requirement, buysRemaining)
  → aiShouldBuy(hand, discardCard, requirement, buysRemaining, AI_EVAL_CONFIGS['rookie-riley'])

/** @deprecated Use aiShouldBuy with config */
aiShouldBuyHard(hand, discardCard, requirement, buysRemaining, tablesMelds, opponents)
  → aiShouldBuy(hand, discardCard, requirement, buysRemaining, AI_EVAL_CONFIGS['the-shark'], ...)
```

---

## Personality Implementation Details

### Rookie Riley (Easy, difficulty 1)
- **Take discard**: needs +8 improvement (high bar), so rarely takes. No denial awareness.
- **Buy**: `buyRiskTolerance: -15` makes risk almost always exceed improvement. `buyStyle: 'never'`, `buySelfLimit: 0`.
- **Discard**: `discardNoise: 15` adds significant random variance — often picks suboptimal cards.
- **Go-down**: immediate (goes down as soon as requirement is met).
- **Lay-offs**: GameBoard enforces `layOffStyle: 'never'` — 0 lay-offs per turn.
- **Joker swaps**: `jokerSwapStyle: 'never'` — GameBoard skips joker swap logic entirely.

### Steady Sam (Easy, difficulty 2)
- **Take discard**: needs +5 improvement (moderate bar). No denial awareness.
- **Buy**: `buyRiskTolerance: -5`, conservative. `buySelfLimit: 2`.
- **Discard**: `discardNoise: 8` adds moderate variance.
- **Go-down**: immediate.
- **Lay-offs**: `layOffStyle: 'capped-1'` — max 1 lay-off per turn (except when hand.length === 1 for going out).
- **Joker swaps**: `jokerSwapStyle: 'never'`.

### Lucky Lou (Medium, difficulty 3)
- **Take discard**: needs +3 improvement (low bar). No denial awareness. `randomFactor: 0.2` adds chaos.
- **Buy**: `buyRiskTolerance: +10` makes buying very aggressive. `buyStyle: 'aggressive'`, `buySelfLimit: 5`.
- **Discard**: `discardNoise: 20` (highest) — most chaotic discards. Often discards useful cards.
- **Go-down**: `goDownStyle: 'immediate-random-hold'` — sometimes holds even when ready.
- **Lay-offs**: `layOffStyle: 'unlimited'`.
- **Joker swaps**: `jokerSwapStyle: 'random'` — swaps when available but not strategically.

### Patient Pat (Medium, difficulty 4)
- **Take discard**: needs +4 improvement. `takeStyle: 'selective'`.
- **Buy**: `buyRiskTolerance: 0` (neutral). `buyStyle: 'conservative'`, `buySelfLimit: 3`.
- **Discard**: `discardNoise: 3` (minimal) — nearly optimal discard choices. `discardStyle: 'run-aware'`.
- **Go-down**: `goDownStyle: 'strategic'` — uses `aiShouldGoDownHard` to time going down.
- **Lay-offs**: `layOffStyle: 'unlimited'`.
- **Joker swaps**: `jokerSwapStyle: 'beneficial'` — swaps when it improves hand evaluation.

### The Shark (Hard, difficulty 5)
- **Take discard**: needs +3 improvement. `denialTake: true` — takes cards to deny opponents who have laid down and have <=6 cards. Only denies low-point cards (<=10) to avoid hand bloat.
- **Buy**: `buyRiskTolerance: +2`. `buyStyle: 'denial'` — denial buys when opponent has <=4 cards and card fits any table meld. Requires `buysRemaining >= 2`.
- **Discard**: `discardNoise: 0` (optimal). `opponentAware: true`, `dangerWeight: 0.5` — blends `cardDanger` into discard ranking at 50% weight.
- **Go-down**: immediate (goes down as soon as possible to start laying off).
- **Lay-offs**: `layOffStyle: 'unlimited'`. No GameBoard cap.
- **Joker swaps**: `jokerSwapStyle: 'optimal'` — uses all joker swap functions including `aiFindPreLayDownJokerSwap`.

### The Mastermind (Hard, difficulty 5)
- **Take discard**: needs +2 improvement (lowest bar). `denialTake: true`. Denies even high-point cards when opponent is close (`dangerWeight >= 0.6` bypasses the 10-point cap). `handLimitForDenial: 14` (vs Shark's 12).
- **Buy**: `buyRiskTolerance: +5`. `buyStyle: 'heavy-denial'`, `buySelfLimit: 5`.
- **Discard**: `discardNoise: 0`. `dangerWeight: 0.6` (highest) — strongest opponent avoidance.
- **Go-down**: `goDownStyle: 'hold-for-out'` — uses `aiShouldGoDownHard` with aggressive holding. Waits up to 3 turns if remaining <= 2 cards, points >= 40, has lay-off potential, and all opponents have >= 7 cards. `panicThreshold: 2` — only panics when very close to disaster.
- **Lay-offs**: `layOffStyle: 'unlimited'`.
- **Joker swaps**: `jokerSwapStyle: 'optimal'`.

---

## evaluateHand Scoring Breakdown

The hand evaluation system scores these components:

### Can Go Down (200+ range)
If `aiFindBestMelds` succeeds: returns `200 - remaining_points`. A hand that can go down with 0 leftover = 200. With 15 points leftover = 185.

### Set Potential (0-40+ per rank group)
- 3+ of a rank: +40 (complete natural set)
- 2 of a rank (pair): +15 if sets are required this round, else 0
- 1 of a rank + 2 jokers: +4 (weak)

### Run Potential (0-70+ per suit)
Uses `findBestRunWindow` with ace-low and ace-high configurations:
- 4+ effective length (cards + fillable gaps): +20 base + bonuses for length
- 3 cards: +12 (run-required rounds) or +5
- 2 cards: +4 (run-required rounds) or +2
- Bonus for length: +8 per card beyond 4
- Bonus for few gaps: gapless runs score higher
- Near-complete (effective >= MIN_RUN_SIZE): +15 bonus

### Joker Allocation
Jokers are allocated optimally across suit windows:
1. Prioritize windows that cross the 4-card run threshold
2. Then by natural card count
3. Each gap filled by a joker improves the effective length

### Multi-Run Coverage (run-heavy rounds)
- Coverage bonus: suits with run progress * 12 pts
- Deficit penalty: (suits needed - suits started) * 8 pts
- Critical for R7 where 3 separate suits must each form a run

### Isolated Card Penalties
High-point cards with no meld connections are penalized to encourage discarding them.

---

## Simulation Infrastructure

### Headless Simulation Engine
`src/simulation/simulate.ts` replicates the full game logic from GameBoard as pure synchronous functions. No React, no delays, no UI. Runs complete 7-round games at maximum speed.

**`SimConfig`** supports personality-aware simulation:

```typescript
export interface SimConfig {
  numGames: number
  numPlayers: number
  difficulty: AIDifficulty
  logLevel: 'summary' | 'detailed' | 'verbose'
  outputFile?: string
  onlyRounds?: number[]       // simulate specific round numbers only
  personalities?: AIPersonality[]  // per-player personality override
}
```

**`getSimPlayerConfig(index, config)`** resolves each player's `AIEvalConfig` and `PersonalityConfig`:
- If `config.personalities[index]` is set, uses that personality directly
- Otherwise falls back to difficulty-based mapping (easy → Rookie Riley, medium → Steady Sam, hard → The Shark)

### Simulation Test Configs
Run via `npx vitest run src/simulation/run.test.ts`. Six configurations in `src/simulation/run.test.ts`:

| Test | Players | Config | Games |
|---|---|---|---|
| Baseline | 4 | medium difficulty | 50 |
| Large group | 8 | medium difficulty | 30 |
| Easy difficulty | 4 | easy difficulty | 30 |
| Hard difficulty | 4 | hard difficulty | 30 |
| Run rounds focus | 4 | medium, rounds 3 & 7 only | 50 |
| Mixed personalities | 4 | Shark, Mastermind, Patient Pat, Lucky Lou | 30 |

Results are saved to `src/simulation/results/` as JSON data and human-readable text reports. Analysis is performed by `src/simulation/analyze.ts`.

---

## Output Contract
After your changes:
- No personality ever discards its last card (always tries lay-off first)
- All personalities respect `player.buysRemaining` limit
- All personalities respect `buyLimit === 0` (no buying)
- `aiFindBestMelds` returns null if requirement cannot be met (never crashes)
- Evaluation-based decisions produce differentiated behavior through config alone — no personality-specific code branches
- Legacy wrapper functions remain for backward compatibility but delegate to unified functions
- Opponent-aware personalities (Shark, Mastermind) never discard cards that directly feed an opponent close to going out
- `aiShouldGoDownHard` is only invoked for personalities with `goDownStyle: 'strategic'` or `'hold-for-out'`
