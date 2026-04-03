# Hybrid ML v2: Opponent Awareness & Draw Network — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add learned opponent embeddings and a neural draw decision network to the hybrid ML system, then retrain all networks on fresh 5K-10K game data.

**Architecture:** A shared OpponentEncoderNet (126→64→32→16 per opponent, weight-shared across 3 slots) produces 48 embedding features that are concatenated with the 264-feature base state (273 minus old 9 opponent features) to form a 312-feature enriched state. A new DrawEvalNet (319→128→64→1) replaces the hardcoded 0.05 draw threshold. All networks are retrained with the new input sizes.

**Tech Stack:** Python 3, PyTorch, Node.js/TypeScript (game bridge), JSON data pipeline

**Spec:** `docs/superpowers/specs/2026-04-03-hybrid-v2-opponent-awareness-design.md`

---

## File Structure

### New Files
- `ml/training/opponent_encoder.py` — OpponentEncoderNet + joint training with HandEvalNet
- `ml/training/draw_evaluator.py` — DrawEvalNet definition and training script

### Modified Files
- `ml/bridge/game-bridge.ts` — Add per-opponent history tracking, `encodeOpponentRaw()`, expand `get_full_state` response
- `ml/training/state_encoder.py` — New constants for v2 feature layout
- `ml/training/generate_data.py` — Collect opponent_raw, draw samples, mixed opponents
- `ml/training/hand_evaluator.py` — Input size change (273→312), accept external encoder
- `ml/training/discard_policy.py` — Input size change (274→313)
- `ml/training/buy_evaluator.py` — Input size change (280→319)
- `ml/training/evaluate_hybrid.py` — Load opponent encoder + DrawEvalNet, ablation support

---

### Task 1: Update State Encoder Constants

**Files:**
- Modify: `ml/training/state_encoder.py`

- [ ] **Step 1: Update state_encoder.py with v2 constants**

```python
"""
State encoder — defines the rich state vector layout.
Must match the bridge's encodeRichState() output exactly.

V2: Base state (264) + opponent raw (378) returned separately.
     Opponent encoder produces 48-dim embedding.
     Enriched state = base (264) + embedding (48) = 312.
"""

# Card features: rank/13, suit_onehot(4), is_joker
CARD_FEATURES = 6
MAX_HAND_CARDS = 22
MAX_DISCARD_HISTORY = 10
MAX_TABLE_MELDS = 12
MELD_FEATURES = 5

# Game context WITHOUT opponent features (old 21 - 9 opponent = 12)
GAME_CONTEXT_FEATURES_V2 = 12  # round, requirements, pile sizes, buys, hand pts, turn, buy-window, own score, player count

# Base state (no opponent features) — returned by bridge as "state"
BASE_STATE_SIZE = (
    MAX_HAND_CARDS * CARD_FEATURES +      # 132: hand cards
    MAX_DISCARD_HISTORY * CARD_FEATURES +  # 60: discard history
    MAX_TABLE_MELDS * MELD_FEATURES +      # 60: table melds
    GAME_CONTEXT_FEATURES_V2              # 12: game context (no opponents)
)
# Total: 264

# Opponent raw features (returned by bridge as "opponent_raw")
MAX_OPPONENTS = 3
OPP_DISCARD_HISTORY = 10  # last 10 discards per opponent
OPP_PICKUP_HISTORY = 5    # last 5 pickups per opponent
OPP_MAX_MELDS = 6         # up to 6 melds per opponent
OPP_SCALAR_STATS = 6      # hand_size, laid_down, buys_remaining, cards_laid_off, cumulative_score, is_winning

OPP_RAW_FEATURES = (
    OPP_DISCARD_HISTORY * CARD_FEATURES +  # 60: discard history
    OPP_PICKUP_HISTORY * CARD_FEATURES +   # 30: pickup history
    OPP_MAX_MELDS * MELD_FEATURES +        # 30: meld composition
    OPP_SCALAR_STATS                       # 6: scalar stats
)
# Total per opponent: 126

OPP_RAW_TOTAL = MAX_OPPONENTS * OPP_RAW_FEATURES  # 378

# Opponent encoder output
OPP_EMBEDDING_DIM = 16
OPP_EMBEDDING_TOTAL = MAX_OPPONENTS * OPP_EMBEDDING_DIM  # 48

# Enriched state (base + opponent embeddings)
ENRICHED_STATE_SIZE = BASE_STATE_SIZE + OPP_EMBEDDING_TOTAL  # 312

# Legacy (keep for backward compatibility with v1 models)
RICH_STATE_SIZE = 273
GAME_CONTEXT_FEATURES = 21

# Offered card features (unchanged)
OFFERED_CARD_FEATURES = 6

# Action encoding (unchanged)
MAX_ACTIONS = 350
BUY_ACTION_IDX = 339
DECLINE_BUY_ACTION_IDX = 340
```

- [ ] **Step 2: Verify constants are consistent**

Run: `cd ml/training && python -c "from state_encoder import *; print(f'Base: {BASE_STATE_SIZE}, OppRaw: {OPP_RAW_FEATURES}, Enriched: {ENRICHED_STATE_SIZE}'); assert BASE_STATE_SIZE == 264; assert OPP_RAW_FEATURES == 126; assert ENRICHED_STATE_SIZE == 312; print('OK')"`

Expected: `Base: 264, OppRaw: 126, Enriched: 312` then `OK`

- [ ] **Step 3: Commit**

```bash
git add ml/training/state_encoder.py
git commit -m "feat(ml): add v2 state encoder constants for opponent awareness"
```

---

### Task 2: Add Opponent History Tracking to Game Bridge

**Files:**
- Modify: `ml/bridge/game-bridge.ts`

This task adds per-opponent history buffers to BridgeGameState and tracks discards, pickups, and layoffs as the game progresses.

- [ ] **Step 1: Add opponent history fields to BridgeGameState interface**

In `ml/bridge/game-bridge.ts`, after the `buyWindowState` field (line 61), add:

```typescript
  // Per-opponent observable history (for ML opponent encoder)
  opponentHistory: OpponentHistory[]
```

Before the `BridgeGameState` interface (around line 37), add:

```typescript
interface OpponentHistory {
  discards: Card[]    // rolling last 10 discards by this player
  pickups: Card[]     // rolling last 5 cards this player took from discard pile
  layoffCount: number // number of cards laid off this round
}
```

- [ ] **Step 2: Initialize opponent history in initGame()**

In `initGame()` (line 75), after the players loop, add initialization:

```typescript
  const opponentHistory: OpponentHistory[] = []
  for (let i = 0; i < playerCount; i++) {
    opponentHistory.push({ discards: [], pickups: [], layoffCount: 0 })
  }
```

And include `opponentHistory` in the returned object (after `buyWindowState: null`):

```typescript
    opponentHistory,
```

- [ ] **Step 3: Track discards in takeAction()**

Find the section in `takeAction()` where discard actions are processed. When a player discards a card, add tracking:

```typescript
// Track discard for opponent modeling
game.opponentHistory[game.currentPlayerIndex].discards.push(discardedCard)
if (game.opponentHistory[game.currentPlayerIndex].discards.length > 10) {
  game.opponentHistory[game.currentPlayerIndex].discards.shift()
}
```

- [ ] **Step 4: Track pickups (take_discard actions) in takeAction()**

When a player takes from the discard pile, track the pickup:

```typescript
// Track pickup for opponent modeling
game.opponentHistory[game.currentPlayerIndex].pickups.push(pickedCard)
if (game.opponentHistory[game.currentPlayerIndex].pickups.length > 5) {
  game.opponentHistory[game.currentPlayerIndex].pickups.shift()
}
```

- [ ] **Step 5: Track layoffs in takeAction()**

When a layoff action succeeds, increment the counter:

```typescript
game.opponentHistory[game.currentPlayerIndex].layoffCount++
```

- [ ] **Step 6: Reset layoffCount on round transitions**

In the round transition logic (where `buysRemaining` resets to 5), also reset layoff counts:

```typescript
for (let i = 0; i < game.players.length; i++) {
  game.opponentHistory[i].layoffCount = 0
}
```

- [ ] **Step 7: Commit**

```bash
git add ml/bridge/game-bridge.ts
git commit -m "feat(ml): track per-opponent discard/pickup/layoff history in bridge"
```

---

### Task 3: Add encodeOpponentRaw() and Update Bridge State Encoding

**Files:**
- Modify: `ml/bridge/game-bridge.ts`

- [ ] **Step 1: Write encodeOpponentRaw() function**

Add this function before `encodeRichState()` (around line 700):

```typescript
/**
 * Encode raw observable data for a single opponent — 126 features.
 *
 * Layout:
 *   Discard history  60 (10 × 6 card features)
 *   Pickup history   30 (5 × 6 card features)
 *   Meld composition 30 (6 × 5 meld features)
 *   Scalar stats      6
 *                   ---
 *   Total           126
 */
function encodeOpponentRaw(
  g: BridgeGameState,
  oppIdx: number,
  playerIdx: number,
): number[] {
  const opp = g.players[oppIdx]
  const hist = g.opponentHistory[oppIdx]
  const features: number[] = []

  // ── Discard history (60 features: 10 × 6) ──
  const MAX_OPP_DISCARDS = 10
  for (let i = 0; i < MAX_OPP_DISCARDS; i++) {
    if (i < hist.discards.length) {
      features.push(...encodeCard(hist.discards[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Pickup history (30 features: 5 × 6) ──
  const MAX_OPP_PICKUPS = 5
  for (let i = 0; i < MAX_OPP_PICKUPS; i++) {
    if (i < hist.pickups.length) {
      features.push(...encodeCard(hist.pickups[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Meld composition (30 features: 6 × 5) ──
  const MAX_OPP_MELDS = 6
  for (let i = 0; i < MAX_OPP_MELDS; i++) {
    if (i < opp.melds.length) {
      const meld = opp.melds[i]
      const isRun = meld.type === 'run' ? 1 : 0
      const cardCount = meld.cards.length / 8
      const hasJoker = meld.cards.some(c => c.suit === 'joker') ? 1 : 0
      let minRank: number, maxRank: number
      if (meld.type === 'run') {
        const naturalRanks = meld.cards.filter(c => c.suit !== 'joker').map(c => c.rank)
        minRank = meld.runMin !== undefined ? meld.runMin : (naturalRanks.length > 0 ? Math.min(...naturalRanks) : 0)
        maxRank = meld.runMax !== undefined ? meld.runMax : (naturalRanks.length > 0 ? Math.max(...naturalRanks) : 0)
      } else {
        const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank ?? 0
        minRank = setRank
        maxRank = setRank
      }
      features.push(isRun, cardCount, minRank / 13, maxRank / 13, hasJoker)
    } else {
      features.push(0, 0, 0, 0, 0)
    }
  }

  // ── Scalar stats (6 features) ──
  const oppScore = g.scores[oppIdx].reduce((a, b) => a + b, 0)
  const allScores = g.scores.map(rs => rs.reduce((a, b) => a + b, 0))
  const minScore = Math.min(...allScores)

  features.push(opp.hand.length / 16)           // hand size
  features.push(opp.hasLaidDown ? 1 : 0)         // laid down
  features.push(opp.buysRemaining / 5)            // buys remaining
  features.push(hist.layoffCount / 10)             // cards laid off this round
  features.push(oppScore / 300)                    // cumulative score
  features.push(oppScore === minScore ? 1 : 0)    // is winning

  return features // Total: 126
}
```

- [ ] **Step 2: Write encodeRichStateV2() function**

Add after `encodeOpponentRaw()`:

```typescript
/**
 * V2 Rich state encoding — returns base state (264) + opponent raw (378) separately.
 *
 * Base state layout:
 *   Hand cards      132 (22 × 6)
 *   Discard history  60 (10 × 6)
 *   Table melds      60 (12 × 5)
 *   Game context     12 (no opponent features — those are in opponent_raw)
 *                   ---
 *   Total           264
 */
function encodeRichStateV2(
  g: BridgeGameState,
  playerIdx: number,
): { state: number[]; opponentRaw: number[] } {
  const p = g.players[playerIdx]
  const features: number[] = []

  // ── Hand cards (132 features: 22 × 6) — same as v1 ──
  const suitOrder: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }
  const sortedHand = [...p.hand].sort((a, b) => {
    const suitDiff = suitOrder[a.suit] - suitOrder[b.suit]
    if (suitDiff !== 0) return suitDiff
    return a.rank - b.rank
  })
  const MAX_HAND = 22
  for (let i = 0; i < MAX_HAND; i++) {
    if (i < sortedHand.length) {
      features.push(...encodeCard(sortedHand[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Discard history (60 features: 10 × 6) — same as v1 ──
  const MAX_DISCARD = 10
  const discardSlice = g.discardPile.slice(-MAX_DISCARD)
  for (let i = 0; i < MAX_DISCARD; i++) {
    if (i < discardSlice.length) {
      features.push(...encodeCard(discardSlice[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Table melds (60 features: 12 × 5) — same as v1 ──
  const MAX_MELDS = 12
  for (let i = 0; i < MAX_MELDS; i++) {
    if (i < g.tableMelds.length) {
      const meld = g.tableMelds[i]
      const isRun = meld.type === 'run' ? 1 : 0
      const cardCount = meld.cards.length / 8
      const hasJoker = meld.cards.some(c => c.suit === 'joker') ? 1 : 0
      let minRank: number, maxRank: number
      if (meld.type === 'run') {
        const naturalRanks = meld.cards.filter(c => c.suit !== 'joker').map(c => c.rank)
        minRank = meld.runMin !== undefined ? meld.runMin : (naturalRanks.length > 0 ? Math.min(...naturalRanks) : 0)
        maxRank = meld.runMax !== undefined ? meld.runMax : (naturalRanks.length > 0 ? Math.max(...naturalRanks) : 0)
      } else {
        const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank ?? 0
        minRank = setRank
        maxRank = setRank
      }
      features.push(isRun, cardCount, minRank / 13, maxRank / 13, hasJoker)
    } else {
      features.push(0, 0, 0, 0, 0)
    }
  }

  // ── Game context V2 (12 features — NO opponent features) ──
  features.push(g.currentRound / 7)
  features.push(g.requirement.sets / 3)
  features.push(g.requirement.runs / 3)
  features.push(g.drawPile.length / 108)
  features.push(g.discardPile.length / 108)
  features.push(p.buysRemaining / 5)
  features.push(p.hasLaidDown ? 1 : 0)
  const handPoints = p.hand.reduce((s, c) => s + cardPoints(c.rank), 0)
  features.push(handPoints / 200)
  features.push(g.turnCount / 200)
  features.push(g.phase === 'buy-window' ? 1 : 0)
  const ownScore = g.scores[playerIdx].reduce((a, b) => a + b, 0)
  features.push(ownScore / 300)
  features.push(g.players.length / 8)

  // ── Opponent raw features (3 × 126 = 378) ──
  const MAX_OPPONENTS = 3
  const opponentRaw: number[] = []
  let oppSlot = 0
  for (let i = 0; i < g.players.length && oppSlot < MAX_OPPONENTS; i++) {
    if (i === playerIdx) continue
    opponentRaw.push(...encodeOpponentRaw(g, i, playerIdx))
    oppSlot++
  }
  while (oppSlot < MAX_OPPONENTS) {
    // Zero-pad empty opponent slots (126 zeros each)
    for (let f = 0; f < 126; f++) opponentRaw.push(0)
    oppSlot++
  }

  return { state: features, opponentRaw }
}
```

- [ ] **Step 3: Update get_full_state to return v2 data when rich_state_v2 is set**

In the `get_full_state` command handler (line 905), update to conditionally return v2 encoding:

```typescript
      case 'get_full_state': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        const pi = cmd.player ?? 0
        const p = game.players[pi]

        if (game.useRichStateV2) {
          const { state: stateVec, opponentRaw } = encodeRichStateV2(game, pi)
          respond({
            ok: true,
            state: stateVec,
            opponentRaw,
            hand: p.hand.map(c => ({ rank: c.rank, suit: c.suit, id: c.id })),
            handSize: p.hand.length,
            hasLaidDown: p.hasLaidDown,
            buysRemaining: p.buysRemaining,
            phase: game.phase,
            round: game.currentRound,
            requirement: game.requirement,
            discardTop: game.discardPile.length > 0
              ? { rank: game.discardPile[game.discardPile.length - 1].rank, suit: game.discardPile[game.discardPile.length - 1].suit }
              : null,
            scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
            tableMeldCount: game.tableMelds.length,
          })
        } else {
          const stateVec = game.useRichState ? encodeRichState(game, pi) : encodeState(game, pi)
          respond({
            ok: true,
            state: stateVec,
            hand: p.hand.map(c => ({ rank: c.rank, suit: c.suit, id: c.id })),
            handSize: p.hand.length,
            hasLaidDown: p.hasLaidDown,
            buysRemaining: p.buysRemaining,
            phase: game.phase,
            round: game.currentRound,
            requirement: game.requirement,
            discardTop: game.discardPile.length > 0
              ? { rank: game.discardPile[game.discardPile.length - 1].rank, suit: game.discardPile[game.discardPile.length - 1].suit }
              : null,
            scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
            tableMeldCount: game.tableMelds.length,
          })
        }
        break
      }
```

- [ ] **Step 4: Add useRichStateV2 flag to BridgeGameState and new_game handler**

Add `useRichStateV2: boolean` to the `BridgeGameState` interface (after `useRichState`).

In `initGame()`, add `useRichStateV2: false` to the returned object.

In the `new_game` command handler, after `game.useRichState = cmd.rich_state === true`, add:

```typescript
game.useRichStateV2 = cmd.rich_state_v2 === true
```

Also update the `take_action` handler to use v2 encoding when `useRichStateV2` is set:

```typescript
const stateVec = game.useRichStateV2
  ? encodeRichStateV2(game, 0).state
  : (game.useRichState ? encodeRichState(game, 0) : encodeState(game, 0))
```

- [ ] **Step 5: Commit**

```bash
git add ml/bridge/game-bridge.ts
git commit -m "feat(ml): add encodeOpponentRaw(), encodeRichStateV2(), and v2 bridge protocol"
```

---

### Task 4: Update ShanghaiEnv for V2 Protocol

**Files:**
- Modify: `ml/training/shanghai_env.py`

- [ ] **Step 1: Add rich_state_v2 support to ShanghaiEnv**

Update the constructor to accept `rich_state_v2`:

```python
class ShanghaiEnv:
    def __init__(self, player_count=2, opponent_ai=None, rich_state=False, rich_state_v2=False):
        self.player_count = player_count
        self.opponent_ai = opponent_ai
        self.rich_state = rich_state
        self.rich_state_v2 = rich_state_v2
        self.proc = None
        self._start_bridge()
```

Update `reset()` to pass `rich_state_v2`:

```python
    def reset(self, seed=None) -> list:
        """Start a new game. Returns the initial state vector."""
        import random
        if seed is None:
            seed = random.randint(0, 2147483647)
        cmd = {"cmd": "new_game", "players": self.player_count, "seed": seed}
        if self.opponent_ai:
            cmd["opponent_ai"] = self.opponent_ai
        if self.rich_state:
            cmd["rich_state"] = True
        if self.rich_state_v2:
            cmd["rich_state_v2"] = True
        result = self._send(cmd)
        if not result.get("ok"):
            raise RuntimeError(f"Failed to start game: {result}")
        return result["state"]
```

- [ ] **Step 2: Commit**

```bash
git add ml/training/shanghai_env.py
git commit -m "feat(ml): add rich_state_v2 flag to ShanghaiEnv"
```

---

### Task 5: Create OpponentEncoderNet

**Files:**
- Create: `ml/training/opponent_encoder.py`

- [ ] **Step 1: Write the OpponentEncoderNet module**

```python
"""
Opponent Encoder — learns 16-dim embeddings from raw observable opponent data.

Weight-shared across all opponent slots. Trained jointly with HandEvalNet.

Usage:
    encoder = OpponentEncoderNet()
    opp_raw = torch.randn(batch, 3, 126)  # 3 opponents × 126 features
    embeddings = encoder(opp_raw)          # (batch, 48)
"""

import torch
import torch.nn as nn

from state_encoder import OPP_RAW_FEATURES, MAX_OPPONENTS, OPP_EMBEDDING_DIM


class OpponentEncoderNet(nn.Module):
    """Shared-weight encoder: 126 raw features per opponent → 16-dim embedding."""

    def __init__(self, input_size: int = OPP_RAW_FEATURES, embed_dim: int = OPP_EMBEDDING_DIM):
        super().__init__()
        self.embed_dim = embed_dim
        self.max_opponents = MAX_OPPONENTS
        self.encoder = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, embed_dim),
        )

    def forward(self, opp_raw: torch.Tensor) -> torch.Tensor:
        """
        Args:
            opp_raw: (batch, 3 * 126) or (batch, 3, 126) — raw opponent features

        Returns:
            (batch, 48) — concatenated embeddings for all 3 opponents
        """
        batch = opp_raw.shape[0]
        # Reshape to (batch, 3, 126) if flat
        if opp_raw.dim() == 2:
            opp_raw = opp_raw.view(batch, self.max_opponents, -1)

        embeddings = []
        for i in range(self.max_opponents):
            emb = self.encoder(opp_raw[:, i, :])  # (batch, 16)
            embeddings.append(emb)

        return torch.cat(embeddings, dim=1)  # (batch, 48)


def build_enriched_state(
    base_state: torch.Tensor,
    opp_raw: torch.Tensor,
    encoder: OpponentEncoderNet,
) -> torch.Tensor:
    """
    Combine base state (264) with opponent embeddings (48) → enriched state (312).

    Args:
        base_state: (batch, 264)
        opp_raw: (batch, 378) — raw opponent features
        encoder: trained OpponentEncoderNet

    Returns:
        (batch, 312) — enriched state
    """
    opp_embeddings = encoder(opp_raw)  # (batch, 48)
    return torch.cat([base_state, opp_embeddings], dim=1)
```

- [ ] **Step 2: Verify the module loads and shapes are correct**

Run: `cd ml/training && python -c "
from opponent_encoder import OpponentEncoderNet, build_enriched_state
import torch
enc = OpponentEncoderNet()
opp = torch.randn(4, 378)
emb = enc(opp)
print(f'Embedding shape: {emb.shape}')
assert emb.shape == (4, 48), f'Expected (4, 48), got {emb.shape}'
base = torch.randn(4, 264)
enriched = build_enriched_state(base, opp, enc)
print(f'Enriched shape: {enriched.shape}')
assert enriched.shape == (4, 312), f'Expected (4, 312), got {enriched.shape}'
print('OK')
"`

Expected: `Embedding shape: torch.Size([4, 48])`, `Enriched shape: torch.Size([4, 312])`, `OK`

- [ ] **Step 3: Commit**

```bash
git add ml/training/opponent_encoder.py
git commit -m "feat(ml): add OpponentEncoderNet with shared weights and build_enriched_state helper"
```

---

### Task 6: Update HandEvalNet for V2 (Enriched State Input)

**Files:**
- Modify: `ml/training/hand_evaluator.py`

- [ ] **Step 1: Update HandEvalNet to accept enriched state size**

Update the class and training script to support both v1 (273) and v2 (312) input sizes. The key change is the default `input_size` parameter and adding opponent encoder integration to training.

Replace the `HandEvalNet.__init__` default parameter:

```python
from state_encoder import RICH_STATE_SIZE, ENRICHED_STATE_SIZE

class HandEvalNet(nn.Module):
    """Small regression network: state features -> single 0-1 score."""

    def __init__(self, input_size: int = ENRICHED_STATE_SIZE):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)
```

- [ ] **Step 2: Update HandEvalDataset to handle v2 sample format**

The v2 samples have `state` (264 features) and `opponent_raw` (378 features) separately. The dataset needs to return both:

```python
from state_encoder import BASE_STATE_SIZE, OPP_RAW_TOTAL

class HandEvalDataset(Dataset):
    def __init__(self, path: str):
        with open(path) as f:
            data = json.load(f)
        self.samples = data["samples"]
        # Detect v2 format (has opponent_raw field)
        self.is_v2 = "opponent_raw" in self.samples[0] if self.samples else False

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        label = torch.tensor(s["label"], dtype=torch.float32)
        if self.is_v2:
            opp_raw = torch.tensor(s["opponent_raw"], dtype=torch.float32)
            return state, opp_raw, label
        else:
            return state, label
```

- [ ] **Step 3: Update training loop for joint encoder + hand eval training**

Add a `--v2` flag to the argument parser and update the training function to jointly train the opponent encoder when v2 data is used:

```python
from opponent_encoder import OpponentEncoderNet, build_enriched_state

def train(args):
    # ... existing print statements ...

    is_v2 = args.v2
    if is_v2:
        print("  Mode: V2 (with opponent encoder)")

    with open(args.data) as f:
        raw = json.load(f)
    print(f"Loaded {raw['count']} samples")

    dataset = HandEvalDataset(args.data)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    if is_v2:
        encoder = OpponentEncoderNet()
        net = HandEvalNet(input_size=ENRICHED_STATE_SIZE)
        # Joint optimizer for both networks
        optimizer = optim.Adam([
            {"params": net.parameters(), "lr": args.lr},
            {"params": encoder.parameters(), "lr": args.lr},
        ])
    else:
        net = HandEvalNet(input_size=RICH_STATE_SIZE)
        encoder = None
        optimizer = optim.Adam(net.parameters(), lr=args.lr)

    criterion = nn.MSELoss()
    models_dir = Path(__file__).parent.parent / "models"
    model_path = models_dir / "hand_evaluator.pt"
    encoder_path = models_dir / "opponent_encoder.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        if encoder:
            encoder.train()
        train_loss = 0.0

        for batch in train_loader:
            optimizer.zero_grad()
            if is_v2:
                base_state, opp_raw, labels = batch
                enriched = build_enriched_state(base_state, opp_raw, encoder)
                preds = net(enriched)
            else:
                states, labels = batch
                preds = net(states)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(labels)
        train_loss /= train_size

        net.eval()
        if encoder:
            encoder.eval()
        val_loss = 0.0
        with torch.no_grad():
            for batch in val_loader:
                if is_v2:
                    base_state, opp_raw, labels = batch
                    enriched = build_enriched_state(base_state, opp_raw, encoder)
                    preds = net(enriched)
                else:
                    states, labels = batch
                    preds = net(states)
                val_loss += criterion(preds, labels).item() * len(labels)
        val_loss /= val_size

        print(f"Epoch {epoch+1:3d}/{args.epochs} | Train loss: {train_loss:.4f} | Val loss: {val_loss:.4f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            if encoder:
                torch.save(encoder.state_dict(), encoder_path)
                # Monitor encoder embedding norms
                sample_opp = torch.randn(1, 378)
                emb = encoder(sample_opp)
                print(f"  => Saved (val loss: {val_loss:.4f}, encoder L2 norm: {emb.norm().item():.3f})")
            else:
                print(f"  => Saved best model (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
```

Add `--v2` flag to the argument parser:

```python
    parser.add_argument("--v2", action="store_true", help="Use v2 data format with opponent encoder")
```

- [ ] **Step 4: Commit**

```bash
git add ml/training/hand_evaluator.py
git commit -m "feat(ml): update HandEvalNet for v2 enriched state with joint encoder training"
```

---

### Task 7: Create DrawEvalNet

**Files:**
- Create: `ml/training/draw_evaluator.py`

- [ ] **Step 1: Write the DrawEvalNet module and training script**

```python
"""
Draw Evaluator — decides whether to take the face-up discard or draw blind.

Uses hand evaluator proxy for labels: simulate both options, pick better one.

Train:  python draw_evaluator.py --data ml/data/hybrid_training_v2/draw_TIMESTAMP.json --v2
"""

import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split

from state_encoder import ENRICHED_STATE_SIZE, OFFERED_CARD_FEATURES, OPP_RAW_TOTAL
from hand_evaluator import HandEvalNet
from opponent_encoder import OpponentEncoderNet, build_enriched_state
from buy_evaluator import encode_offered_card

MODELS_DIR = Path(__file__).parent.parent / "models"

# Input: enriched state (312) + hand eval score (1) + offered card (6) = 319
DRAW_INPUT_SIZE = ENRICHED_STATE_SIZE + 1 + OFFERED_CARD_FEATURES


class DrawEvalNet(nn.Module):
    """Binary classifier: should the agent take the discard?"""

    def __init__(self, input_size: int = DRAW_INPUT_SIZE):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def compute_draw_labels(
    draw_samples: list,
    hand_eval: HandEvalNet,
    encoder: OpponentEncoderNet,
) -> list:
    """
    Label draw decisions using hand eval proxy:
    - Simulate taking discard: encode card into hand, score with hand eval
    - Compare against current score (drawing blind = no expected improvement)
    - Label = 1 if taking discard gives better score, else 0
    """
    hand_eval.eval()
    encoder.eval()
    labeled = []

    for i, sample in enumerate(draw_samples):
        base_state = torch.tensor(sample["state"], dtype=torch.float32)
        opp_raw = torch.tensor(sample["opponent_raw"], dtype=torch.float32)
        offered = sample["offered_card"]
        if not offered:
            continue

        with torch.no_grad():
            enriched = build_enriched_state(
                base_state.unsqueeze(0), opp_raw.unsqueeze(0), encoder
            )
            current_score = hand_eval(enriched).item()

        # Simulate taking the discard: encode into first empty hand slot
        modified_base = base_state.clone()
        card_features = encode_offered_card(offered)
        for si in range(22):
            start = si * 6
            if modified_base[start:start + 6].sum().item() == 0:
                modified_base[start:start + 6] = torch.tensor(card_features)
                break

        with torch.no_grad():
            modified_enriched = build_enriched_state(
                modified_base.unsqueeze(0), opp_raw.unsqueeze(0), encoder
            )
            take_score = hand_eval(modified_enriched).item()

        should_take = 1 if take_score > current_score else 0

        labeled.append({
            "state": sample["state"],
            "opponent_raw": sample["opponent_raw"],
            "hand_eval_score": current_score,
            "offered_card": card_features,
            "label": should_take,
        })

        if (i + 1) % 10000 == 0:
            print(f"  Labeled {i+1}/{len(draw_samples)} draw samples")

    return labeled


class DrawDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        opp_raw = torch.tensor(s["opponent_raw"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        offered = torch.tensor(s["offered_card"], dtype=torch.float32)
        label = torch.tensor(s["label"], dtype=torch.float32)
        return state, opp_raw, hand_score, offered, label


def train(args):
    print("Draw Evaluator Training (V2)")
    print(f"  Data:   {args.data}")
    print(f"  Epochs: {args.epochs}")
    print()

    # Load hand evaluator and opponent encoder (for label computation)
    hand_eval = HandEvalNet(input_size=ENRICHED_STATE_SIZE)
    hand_eval.load_state_dict(torch.load(MODELS_DIR / "hand_evaluator.pt", weights_only=True))
    hand_eval.eval()

    encoder = OpponentEncoderNet()
    encoder.load_state_dict(torch.load(MODELS_DIR / "opponent_encoder.pt", weights_only=True))
    print("Loaded hand evaluator and opponent encoder")

    # Load raw draw data
    with open(args.data) as f:
        raw = json.load(f)
    print(f"Loaded {raw['count']} raw draw samples")

    # Compute labels
    print("Computing draw labels via hand eval proxy...")
    labeled = compute_draw_labels(raw["samples"], hand_eval, encoder)
    take_count = sum(s["label"] for s in labeled)
    print(f"Labeled {len(labeled)} samples ({take_count} take, {len(labeled) - take_count} draw)")

    dataset = DrawDataset(labeled)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    net = DrawEvalNet()
    # Fine-tune encoder at 0.1x LR
    optimizer = optim.Adam([
        {"params": net.parameters(), "lr": args.lr},
        {"params": encoder.parameters(), "lr": args.lr * 0.1},
    ])
    criterion = nn.BCELoss()

    model_path = MODELS_DIR / "draw_evaluator.pt"
    encoder_path = MODELS_DIR / "opponent_encoder.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        encoder.train()
        train_loss = 0.0

        for base_state, opp_raw, hand_score, offered, labels in train_loader:
            optimizer.zero_grad()
            enriched = build_enriched_state(base_state, opp_raw, encoder)
            features = torch.cat([enriched, hand_score, offered], dim=1)
            preds = net(features)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(labels)
        train_loss /= train_size

        net.eval()
        encoder.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        val_take = 0
        with torch.no_grad():
            for base_state, opp_raw, hand_score, offered, labels in val_loader:
                enriched = build_enriched_state(base_state, opp_raw, encoder)
                features = torch.cat([enriched, hand_score, offered], dim=1)
                preds = net(features)
                val_loss += criterion(preds, labels).item() * len(labels)
                predicted = (preds > 0.5).float()
                val_correct += (predicted == labels).sum().item()
                val_take += predicted.sum().item()
                val_total += len(labels)
        val_loss /= val_size
        val_acc = val_correct / val_total * 100
        take_pct = val_take / val_total * 100

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Train loss: {train_loss:.4f} | "
            f"Val loss: {val_loss:.4f} | "
            f"Val acc: {val_acc:.1f}% | "
            f"Take%: {take_pct:.1f}%"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            torch.save(encoder.state_dict(), encoder_path)
            print(f"  => Saved (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train draw evaluator network")
    parser.add_argument("--data", type=str, required=True, help="Path to draw JSON data")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    args = parser.parse_args()
    train(args)
```

- [ ] **Step 2: Verify module loads**

Run: `cd ml/training && python -c "
from draw_evaluator import DrawEvalNet, DRAW_INPUT_SIZE
import torch
net = DrawEvalNet()
x = torch.randn(4, DRAW_INPUT_SIZE)
out = net(x)
print(f'Input: {DRAW_INPUT_SIZE}, Output shape: {out.shape}')
assert out.shape == (4,)
assert DRAW_INPUT_SIZE == 319
print('OK')
"`

Expected: `Input: 319, Output shape: torch.Size([4])`, `OK`

- [ ] **Step 3: Commit**

```bash
git add ml/training/draw_evaluator.py
git commit -m "feat(ml): add DrawEvalNet — neural draw decision with opponent awareness"
```

---

### Task 8: Update BuyEvalNet for V2

**Files:**
- Modify: `ml/training/buy_evaluator.py`

- [ ] **Step 1: Update BuyEvalNet input size and training for v2**

Update the default input size:

```python
from state_encoder import RICH_STATE_SIZE, ENRICHED_STATE_SIZE, OPP_RAW_TOTAL

class BuyEvalNet(nn.Module):
    """Binary classifier: should the agent buy the offered card?"""

    def __init__(self, input_size: int = ENRICHED_STATE_SIZE + 1 + OFFERED_CARD_FEATURES):
        # 312 state + 1 hand eval score + 6 offered card features = 319
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)
```

- [ ] **Step 2: Update BuyDataset for v2 format**

```python
class BuyDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples
        self.is_v2 = "opponent_raw" in self.samples[0] if self.samples else False

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        offered = torch.tensor(s["offered_card"], dtype=torch.float32)
        label = torch.tensor(s["label"], dtype=torch.float32)
        if self.is_v2:
            opp_raw = torch.tensor(s["opponent_raw"], dtype=torch.float32)
            return state, opp_raw, hand_score, offered, label
        else:
            features = torch.cat([state, hand_score, offered])
            return features, label
```

- [ ] **Step 3: Update compute_buy_labels for v2**

```python
def compute_buy_labels(buy_samples: list, hand_eval: HandEvalNet, threshold: float = 0.1, encoder=None) -> list:
    """Label buy decisions: 1 if offered card improves hand eval by > threshold."""
    hand_eval.eval()
    if encoder:
        encoder.eval()
    labeled = []

    for sample in buy_samples:
        state = torch.tensor(sample["state"], dtype=torch.float32)
        offered = sample["offered_card"]
        if not offered:
            continue

        is_v2 = "opponent_raw" in sample
        if is_v2 and encoder:
            opp_raw = torch.tensor(sample["opponent_raw"], dtype=torch.float32)
            from opponent_encoder import build_enriched_state
            with torch.no_grad():
                enriched = build_enriched_state(state.unsqueeze(0), opp_raw.unsqueeze(0), encoder)
                current_score = hand_eval(enriched).item()
        else:
            with torch.no_grad():
                current_score = hand_eval(state.unsqueeze(0)).item()

        modified = state.clone()
        card_features = encode_offered_card(offered)
        slot_found = False
        for si in range(22):
            start = si * 6
            if modified[start:start + 6].sum().item() == 0:
                modified[start:start + 6] = torch.tensor(card_features)
                slot_found = True
                break

        if not slot_found:
            continue

        if is_v2 and encoder:
            with torch.no_grad():
                modified_enriched = build_enriched_state(modified.unsqueeze(0), opp_raw.unsqueeze(0), encoder)
                new_score = hand_eval(modified_enriched).item()
        else:
            with torch.no_grad():
                new_score = hand_eval(modified.unsqueeze(0)).item()

        improvement = new_score - current_score
        should_buy = 1 if improvement > threshold else 0

        result = {
            "state": sample["state"],
            "hand_eval_score": current_score,
            "offered_card": card_features,
            "label": should_buy,
        }
        if is_v2:
            result["opponent_raw"] = sample["opponent_raw"]
        labeled.append(result)

    return labeled
```

- [ ] **Step 4: Update training loop for v2 with encoder fine-tuning**

Add `--v2` flag and update the training function to handle v2 data with opponent encoder at 0.1x LR (same pattern as draw_evaluator.py training loop).

```python
    parser.add_argument("--v2", action="store_true", help="Use v2 data format with opponent encoder")
```

In the `train()` function, when `args.v2`:
- Load opponent encoder from `ml/models/opponent_encoder.pt`
- Use 0.1x LR for encoder params
- Build enriched state before feeding to buy net
- Save updated encoder weights alongside buy model

- [ ] **Step 5: Commit**

```bash
git add ml/training/buy_evaluator.py
git commit -m "feat(ml): update BuyEvalNet for v2 enriched state with encoder fine-tuning"
```

---

### Task 9: Update DiscardPolicyNet for V2

**Files:**
- Modify: `ml/training/discard_policy.py`

- [ ] **Step 1: Update DiscardPolicyNet input size**

```python
from state_encoder import RICH_STATE_SIZE, ENRICHED_STATE_SIZE

class DiscardPolicyNet(nn.Module):
    """Scores each card slot for discard quality. Highest = best discard."""

    def __init__(self, input_size: int = ENRICHED_STATE_SIZE + 1):
        # 312 + 1 hand eval score = 313
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, MAX_HAND),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)
```

- [ ] **Step 2: Update DiscardDataset and compute_optimal_discards for v2**

Same pattern as BuyEvalNet — detect v2 format, use encoder to build enriched state, fine-tune encoder at 0.1x LR.

Update `DiscardDataset.__getitem__` to return `(state, opp_raw, hand_score, label, mask)` for v2 or `(features, label, mask)` for v1.

Update `compute_optimal_discards` to accept an optional encoder and use `build_enriched_state` when available.

- [ ] **Step 3: Update training loop with --v2 flag**

Add `--v2` flag. When set: load encoder, joint optimizer with 0.1x encoder LR, build enriched state before feeding to discard net.

- [ ] **Step 4: Commit**

```bash
git add ml/training/discard_policy.py
git commit -m "feat(ml): update DiscardPolicyNet for v2 enriched state with encoder fine-tuning"
```

---

### Task 10: Update Data Generation for V2

**Files:**
- Modify: `ml/training/generate_data.py`

- [ ] **Step 1: Add v2 data generation with opponent raw features and draw samples**

Key changes:
- Add `--v2` flag and `--mixed-opponents` flag
- Use `rich_state_v2=True` when creating ShanghaiEnv
- Extract `opponent_raw` from `get_full_state` response
- Add draw sample collection (during draw phase when take_discard is valid)
- Save draw samples as a 4th dataset file
- Support mixed opponents: cycle through `["the-shark", "the-nemesis", "patient-pat", "steady-sam"]`

```python
MIXED_OPPONENTS = ["the-shark", "the-nemesis", "patient-pat", "steady-sam"]

def save_data(hand_snapshots, discard_samples, buy_samples, draw_samples=None, tag=""):
    """Save datasets to JSON. Returns the paths."""
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    suffix = f"_{tag}" if tag else ""

    hand_path = DATA_DIR / f"hand_eval_{timestamp}{suffix}.json"
    with open(hand_path, "w") as f:
        json.dump({"count": len(hand_snapshots), "samples": hand_snapshots}, f)

    discard_path = DATA_DIR / f"discard_{timestamp}{suffix}.json"
    with open(discard_path, "w") as f:
        json.dump({"count": len(discard_samples), "samples": discard_samples}, f)

    buy_path = DATA_DIR / f"buy_{timestamp}{suffix}.json"
    with open(buy_path, "w") as f:
        json.dump({"count": len(buy_samples), "samples": buy_samples}, f)

    draw_path = None
    if draw_samples is not None:
        draw_path = DATA_DIR / f"draw_{timestamp}{suffix}.json"
        with open(draw_path, "w") as f:
            json.dump({"count": len(draw_samples), "samples": draw_samples}, f)

    return hand_path, discard_path, buy_path, draw_path
```

In the main loop, for v2 mode:

```python
    all_draw_samples = []  # NEW: (state_vec, opponent_raw, offered_card, round)

    # For v2: use mixed opponents
    if args.v2 and args.mixed_opponents:
        opponent_pool = MIXED_OPPONENTS
    else:
        opponent_pool = [args.opponent]
```

Cycle opponents per game:

```python
    for game_i in range(args.games):
        seed = 50000 + game_i
        current_opponent = opponent_pool[game_i % len(opponent_pool)]

        # Restart env if opponent changed
        if current_opponent != env_opponent:
            env.close()
            env = ShanghaiEnv(
                player_count=args.players,
                opponent_ai=current_opponent,
                rich_state=not args.v2,
                rich_state_v2=args.v2,
            )
            env_opponent = current_opponent

        env.reset(seed=seed)
```

Add draw sample capture in the game loop:

```python
            # Capture draw decisions (v2 only)
            if args.v2 and phase == "draw" and "take_discard" in valid_actions:
                offered = full_state.get("discardTop")
                if offered:
                    all_draw_samples.append({
                        "state": state_vec,
                        "opponent_raw": full_state["opponentRaw"],
                        "offered_card": offered,
                        "round": game_round,
                    })
```

For v2, include `opponent_raw` in all sample types:

```python
            # For v2 samples, include opponent_raw
            if args.v2:
                opp_raw = full_state["opponentRaw"]
                # Hand snapshots
                if phase in ("draw", "action") and not has_laid_down:
                    round_snapshots.append((state_vec, opp_raw, game_round, round_turn))
                # Discard samples
                if phase == "action" and action.startswith("discard:") and len(hand) > 1:
                    all_discard_samples.append({
                        "state": state_vec, "opponent_raw": opp_raw,
                        "hand": hand, "round": game_round,
                        "discarded_idx": int(action.split(":")[1]), "hand_size": len(hand),
                    })
                # Buy samples
                if phase == "buy-window":
                    offered = full_state.get("discardTop")
                    if offered:
                        all_buy_samples.append({
                            "state": state_vec, "opponent_raw": opp_raw,
                            "hand": hand, "round": game_round,
                            "offered_card": offered, "bought": action == "buy",
                        })
```

Update flush logic for v2 hand snapshots (include opponent_raw in saved data).

- [ ] **Step 2: Update argument parser**

```python
    parser.add_argument("--v2", action="store_true", help="Generate v2 data with opponent raw features")
    parser.add_argument("--mixed-opponents", action="store_true", help="Cycle through shark/nemesis/patient/steady")
```

- [ ] **Step 3: Update progress printing to include draw samples**

```python
            print(
                f"  Game {games_completed:5d}/{args.games} | "
                f"Hand: {len(all_hand_snapshots):7d} | "
                f"Discard: {len(all_discard_samples):7d} | "
                f"Buy: {len(all_buy_samples):6d} | "
                f"Draw: {len(all_draw_samples):6d} | "
                f"Time: {elapsed:.1f}s"
            )
```

- [ ] **Step 4: Update DATA_DIR for v2**

```python
DATA_DIR_V1 = Path(__file__).parent.parent / "data" / "hybrid_training"
DATA_DIR_V2 = Path(__file__).parent.parent / "data" / "hybrid_training_v2"

# In generate_games():
DATA_DIR = DATA_DIR_V2 if args.v2 else DATA_DIR_V1
DATA_DIR.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 5: Commit**

```bash
git add ml/training/generate_data.py
git commit -m "feat(ml): v2 data generation with opponent raw features, draw samples, mixed opponents"
```

---

### Task 11: Update Hybrid Evaluation for V2

**Files:**
- Modify: `ml/training/evaluate_hybrid.py`

- [ ] **Step 1: Update hybrid_action to use all v2 networks**

```python
from opponent_encoder import OpponentEncoderNet, build_enriched_state
from draw_evaluator import DrawEvalNet

def hybrid_action(
    state_vec: list,
    opp_raw_vec: list,
    valid_actions: list,
    phase: str,
    hand_eval: HandEvalNet,
    discard_net: DiscardPolicyNet,
    buy_net: BuyEvalNet,
    draw_net: DrawEvalNet,
    encoder: OpponentEncoderNet,
    full_state: dict,
) -> str:
    """Choose an action using the v2 hybrid strategy."""
    base_state = torch.tensor(state_vec, dtype=torch.float32)
    opp_raw = torch.tensor(opp_raw_vec, dtype=torch.float32)

    with torch.no_grad():
        enriched = build_enriched_state(
            base_state.unsqueeze(0), opp_raw.unsqueeze(0), encoder
        )
        enriched_flat = enriched.squeeze(0)  # (312,)
        hand_score = hand_eval(enriched).item()

    # Buy window: use buy evaluator
    if phase == "buy-window":
        if "buy" not in valid_actions and "decline_buy" not in valid_actions:
            return valid_actions[0] if valid_actions else "decline_buy"
        offered = full_state.get("discardTop")
        if offered:
            card_features = torch.tensor(encode_offered_card(offered), dtype=torch.float32)
            buy_input = torch.cat([enriched_flat, torch.tensor([hand_score]), card_features]).unsqueeze(0)
            with torch.no_grad():
                buy_prob = buy_net(buy_input).item()
            return "buy" if buy_prob > 0.5 and "buy" in valid_actions else "decline_buy"
        return "decline_buy" if "decline_buy" in valid_actions else valid_actions[0]

    # Draw phase: use DrawEvalNet
    if phase == "draw":
        if "take_discard" in valid_actions and full_state.get("discardTop"):
            offered = full_state["discardTop"]
            card_features = torch.tensor(encode_offered_card(offered), dtype=torch.float32)
            draw_input = torch.cat([enriched_flat, torch.tensor([hand_score]), card_features]).unsqueeze(0)
            with torch.no_grad():
                take_prob = draw_net(draw_input).item()
            if take_prob > 0.5:
                return "take_discard"
        return "draw_pile" if "draw_pile" in valid_actions else valid_actions[0]

    # Action phase: meld/layoff (rule-based), discard (neural)
    if phase == "action":
        if "meld" in valid_actions:
            return "meld"
        layoff_actions = [a for a in valid_actions if a.startswith("layoff:")]
        if layoff_actions:
            return layoff_actions[0]
        discard_actions = [a for a in valid_actions if a.startswith("discard:")]
        if discard_actions:
            features = torch.cat([enriched_flat, torch.tensor([hand_score])]).unsqueeze(0)
            with torch.no_grad():
                logits = discard_net(features)[0]
            hand_size = full_state.get("handSize", 10)
            mask = torch.zeros(MAX_HAND)
            mask[:hand_size] = 1.0
            logits = logits + (mask - 1.0) * 1e9
            best_idx = logits.argmax().item()
            target = f"discard:{best_idx}"
            if target in discard_actions:
                return target
            return discard_actions[0]

    return valid_actions[0] if valid_actions else "draw_pile"
```

- [ ] **Step 2: Update evaluate() to load v2 networks and use v2 env**

```python
def evaluate(args):
    # ... print statements ...

    # Load all networks
    encoder = OpponentEncoderNet()
    encoder.load_state_dict(torch.load(MODELS_DIR / "opponent_encoder.pt", weights_only=True))
    encoder.eval()

    hand_eval = HandEvalNet(input_size=ENRICHED_STATE_SIZE)
    hand_eval.load_state_dict(torch.load(MODELS_DIR / "hand_evaluator.pt", weights_only=True))
    hand_eval.eval()

    discard_net = DiscardPolicyNet(input_size=ENRICHED_STATE_SIZE + 1)
    discard_net.load_state_dict(torch.load(MODELS_DIR / "discard_policy.pt", weights_only=True))
    discard_net.eval()

    buy_net = BuyEvalNet(input_size=ENRICHED_STATE_SIZE + 1 + OFFERED_CARD_FEATURES)
    buy_net.load_state_dict(torch.load(MODELS_DIR / "buy_evaluator.pt", weights_only=True))
    buy_net.eval()

    draw_net = DrawEvalNet()
    draw_net.load_state_dict(torch.load(MODELS_DIR / "draw_evaluator.pt", weights_only=True))
    draw_net.eval()

    print("Loaded all v2 networks (encoder + hand_eval + discard + buy + draw)")

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state_v2=True,
    )
```

Update the game loop to pass `opponentRaw`:

```python
            full_state = env.get_full_state(player=0)
            action = hybrid_action(
                full_state["state"],
                full_state["opponentRaw"],
                valid_actions, full_state["phase"],
                hand_eval, discard_net, buy_net, draw_net, encoder, full_state,
            )
```

Update the saved JSON model name:

```python
    "model": "hybrid_v2 (encoder + hand_eval + draw + discard + buy)",
```

- [ ] **Step 3: Add --ablation flag for zeroing out opponent embeddings**

```python
    parser.add_argument("--ablation", action="store_true", help="Zero out opponent embeddings to measure contribution")
```

When `args.ablation`, replace `opp_raw_vec` with zeros:

```python
            opp_raw_vec = full_state["opponentRaw"]
            if args.ablation:
                opp_raw_vec = [0.0] * len(opp_raw_vec)
```

- [ ] **Step 4: Commit**

```bash
git add ml/training/evaluate_hybrid.py
git commit -m "feat(ml): update hybrid evaluation for v2 with all 5 networks and ablation support"
```

---

### Task 12: End-to-End Smoke Test

**Files:** No file changes — validation only.

- [ ] **Step 1: Verify bridge v2 encoding works**

Run: `cd ml/training && python -c "
from shanghai_env import ShanghaiEnv
env = ShanghaiEnv(player_count=4, opponent_ai='the-shark', rich_state_v2=True)
env.reset(seed=99999)
actions, _ = env.get_valid_actions()
full = env.get_full_state(player=0)
print(f'State length: {len(full[\"state\"])}')
print(f'OpponentRaw length: {len(full[\"opponentRaw\"])}')
assert len(full['state']) == 264, f'Expected 264, got {len(full[\"state\"])}'
assert len(full['opponentRaw']) == 378, f'Expected 378, got {len(full[\"opponentRaw\"])}'
print(f'Phase: {full[\"phase\"]}')
print(f'Actions: {actions[:3]}...')
env.close()
print('Bridge v2 OK')
"`

Expected: `State length: 264`, `OpponentRaw length: 378`, `Bridge v2 OK`

- [ ] **Step 2: Run a short v2 data generation test (10 games)**

Run: `cd ml/training && python generate_data.py --games 10 --players 4 --opponent the-shark --v2`

Expected: Completes 10 games, prints sample counts for all 4 datasets (hand, discard, buy, draw), saves to `ml/data/hybrid_training_v2/`.

- [ ] **Step 3: Verify v2 data files exist and have correct format**

Run: `cd ml/training && python -c "
import json, glob
files = glob.glob('../data/hybrid_training_v2/*.json')
print(f'Files generated: {len(files)}')
for f in sorted(files):
    with open(f) as fh:
        data = json.load(fh)
    sample = data['samples'][0] if data['samples'] else {}
    has_opp = 'opponent_raw' in sample
    print(f'  {f.split(\"/\")[-1]}: {data[\"count\"]} samples, has_opp_raw={has_opp}')
    if has_opp:
        assert len(sample['opponent_raw']) == 378
        assert len(sample['state']) == 264
print('Data format OK')
"`

Expected: 4 JSON files, all v2 samples have `opponent_raw` (378 features) and `state` (264 features).

- [ ] **Step 4: Commit (no code changes — just verify)**

No commit needed for this task (validation only).

---

### Task 13: Generate Full V2 Training Data

**Files:** No code changes — run data generation.

- [ ] **Step 1: Generate 5,000 games with mixed opponents**

Run: `cd ml/training && python generate_data.py --games 5000 --players 4 --v2 --mixed-opponents`

This will take a while. Expected output: periodic progress every 10 games, checkpoints every 500 games saved to `ml/data/hybrid_training_v2/`.

- [ ] **Step 2: Verify final data counts**

Expected rough sample counts (based on v1 ratios scaled to 5K games):
- Hand eval: ~2.5M samples
- Discard: ~6M samples
- Buy: ~800K samples
- Draw: ~1.5M samples (new)

---

### Task 14: Train All V2 Networks (In Order)

**Files:** No code changes — run training scripts.

- [ ] **Step 1: Train HandEvalNet + OpponentEncoder (jointly)**

Run: `cd ml/training && python hand_evaluator.py --data ../data/hybrid_training_v2/hand_eval_LATEST.json --v2 --epochs 50`

Watch for: val loss decreasing, encoder L2 norm > 0.1 (not collapsed).

- [ ] **Step 2: Train DrawEvalNet**

Run: `cd ml/training && python draw_evaluator.py --data ../data/hybrid_training_v2/draw_LATEST.json --epochs 50`

Watch for: Take% between 20-60% (not degenerate). Val accuracy improving.

- [ ] **Step 3: Train BuyEvalNet**

Run: `cd ml/training && python buy_evaluator.py --data ../data/hybrid_training_v2/buy_LATEST.json --v2 --epochs 50`

- [ ] **Step 4: Train DiscardPolicyNet**

Run: `cd ml/training && python discard_policy.py --data ../data/hybrid_training_v2/discard_LATEST.json --v2 --epochs 50`

Note: If full dataset is too large, use `--max-samples 500000`.

---

### Task 15: Evaluate V2 Hybrid

**Files:** No code changes — run evaluation.

- [ ] **Step 1: Evaluate vs The Shark (100 games)**

Run: `cd ml/training && python evaluate_hybrid.py --opponent the-shark --games 100 --players 4`

Target: avg score < 300 (current: 428).

- [ ] **Step 2: Evaluate vs The Nemesis (100 games)**

Run: `cd ml/training && python evaluate_hybrid.py --opponent the-nemesis --games 100 --players 4`

Target: avg score < 350.

- [ ] **Step 3: Evaluate vs Random (100 games)**

Run: `cd ml/training && python evaluate_hybrid.py --opponent random --games 100 --players 4`

Target: avg score < 200.

- [ ] **Step 4: Run ablation (opponent awareness zeroed out)**

Run: `cd ml/training && python evaluate_hybrid.py --opponent the-shark --games 100 --players 4 --ablation`

Compare against Step 1 to measure opponent encoder contribution.

- [ ] **Step 5: Commit evaluation results**

```bash
git add ml/data/eval/
git commit -m "feat(ml): hybrid v2 evaluation results — opponent awareness + draw network"
```
