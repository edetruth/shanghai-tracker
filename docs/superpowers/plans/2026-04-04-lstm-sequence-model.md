# LSTM Sequence Model (Hybrid v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four independent feedforward classifiers with a unified LSTM sequence model that processes entire rounds as ordered decision sequences, achieving < 250 avg score vs Shark.

**Architecture:** 2-layer LSTM (192 hidden) processes ~323 features per timestep across a round. Three specialized heads (draw, discard, buy) read from LSTM hidden state. Meld/layoff remain rule-based. Trained end-to-end via behavioral cloning on expert round sequences with scheduled sampling.

**Tech Stack:** Python 3.14, PyTorch, TypeScript (bridge), Node.js (tsx)

**Spec:** `docs/superpowers/specs/2026-04-04-lstm-sequence-model-design.md`

**Important conventions:**
- All ML scripts must tee output to log files via `log_utils.setup_logging()` (terminal closes on crash/exit)
- User runs long training/data-gen commands themselves — provide commands, don't execute
- Never use backslash line continuations — user is on Windows, single-line commands only
- All new Python files need `from log_utils import setup_logging` at top

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `ml/training/network_v3.py` | LSTM backbone, draw/discard/buy/auxiliary heads, v3 opponent encoder |
| `ml/training/train_sequence.py` | Training loop: data loading, teacher forcing, scheduled sampling, validation, checkpointing |
| `ml/training/evaluate_sequence.py` | Inference loop: load model, step through games via bridge, report metrics |
| `ml/bridge/meld-plan-encoder.ts` | Extract 30-dim meld plan features from existing meld-finding logic |
| `ml/training/test_v3.py` | Smoke tests: tensor shapes, forward passes, encoding roundtrips |

### Modified Files

| File | Changes |
|------|---------|
| `ml/training/state_encoder.py` | Add v3 constants (input dims, phase encoding, meld plan dims, opponent action dims) |
| `ml/bridge/game-bridge.ts` | Add `rich_state_v3` mode: include `meld_plan`, `opponent_actions_since_last`, round sequence tracking |
| `ml/training/generate_data.py` | Add `--v3` mode: collect ordered round sequences with all decision points |
| `ml/training/preprocess.py` | Add `--v3` mode: sequence padding, suit augmentation, Shark/Nemesis filtering |
| `ml/training/shanghai_env.py` | Add `rich_state_v3` parameter, parse new response fields |
| `ml/training/export_model.py` | Add `--v3` ONNX export with explicit LSTM state I/O |

---

## Task 1: State Encoder v3 Constants

**Files:**
- Modify: `ml/training/state_encoder.py`
- Create: `ml/training/test_v3.py`

- [ ] **Step 1: Write smoke test for v3 constants**

Create `ml/training/test_v3.py`:

```python
"""Smoke tests for v3 LSTM sequence model components."""
import pytest


def test_v3_input_dimensions():
    from state_encoder import (
        V3_HAND_FEATURES, V3_DISCARD_HISTORY_FEATURES,
        V3_TABLE_MELD_FEATURES, V3_GAME_CONTEXT_FEATURES,
        V3_MELD_PLAN_FEATURES, V3_OPP_EMBEDDING_TOTAL,
        V3_ACTION_TAKEN_FEATURES, V3_OPP_ACTIONS_FEATURES,
        V3_PHASE_FEATURES, V3_TIMESTEP_INPUT_SIZE,
    )
    expected = (
        V3_HAND_FEATURES           # 132
        + V3_DISCARD_HISTORY_FEATURES  # 60
        + V3_TABLE_MELD_FEATURES       # 60
        + V3_GAME_CONTEXT_FEATURES     # 12
        + V3_MELD_PLAN_FEATURES        # 30
        + V3_OPP_EMBEDDING_TOTAL       # 48
        + V3_ACTION_TAKEN_FEATURES     # 10
        + V3_OPP_ACTIONS_FEATURES      # 18
        + V3_PHASE_FEATURES            # 3
    )
    assert V3_TIMESTEP_INPUT_SIZE == expected
    assert V3_TIMESTEP_INPUT_SIZE == 373


def test_v3_constants_match_spec():
    from state_encoder import (
        V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
        V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES,
        V3_MAX_SEQ_LEN, V3_LSTM_HIDDEN,
    )
    assert V3_MELD_PLAN_FEATURES == 30
    assert V3_OPP_ACTIONS_FEATURES == 18
    assert V3_ACTION_TAKEN_FEATURES == 10
    assert V3_PHASE_FEATURES == 3
    assert V3_MAX_SEQ_LEN == 80
    assert V3_LSTM_HIDDEN == 192
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ml/training && python -m pytest test_v3.py::test_v3_input_dimensions -v`
Expected: FAIL — `ImportError: cannot import name 'V3_HAND_FEATURES'`

- [ ] **Step 3: Add v3 constants to state_encoder.py**

Append to the end of `ml/training/state_encoder.py`:

```python
# ── V3: LSTM Sequence Model ──────────────────────────────────────────

# Per-timestep input components
V3_HAND_FEATURES = MAX_HAND_CARDS * CARD_FEATURES          # 22 * 6 = 132
V3_DISCARD_HISTORY_FEATURES = MAX_DISCARD_HISTORY * CARD_FEATURES  # 10 * 6 = 60
V3_TABLE_MELD_FEATURES = MAX_TABLE_MELDS * MELD_FEATURES   # 12 * 5 = 60
V3_GAME_CONTEXT_FEATURES = 12  # round, req_sets, req_runs, draw_pile, discard_pile,
                                # buys_remaining, hand_points, turn, buy_window,
                                # cumulative_score, player_count, laid_down

# New v3 feature groups
V3_MELD_PLAN_FEATURES = 30     # See spec: plan count, completeness, per-requirement, etc.
V3_OPP_ACTIONS_FEATURES = 18   # Opponent actions between our turns
V3_ACTION_TAKEN_FEATURES = 10  # Previous action: type one-hot(5) + card features(5)
V3_PHASE_FEATURES = 3          # One-hot: draw / buy / action

# Total per-timestep input to LSTM
V3_TIMESTEP_INPUT_SIZE = (
    V3_HAND_FEATURES
    + V3_DISCARD_HISTORY_FEATURES
    + V3_TABLE_MELD_FEATURES
    + V3_GAME_CONTEXT_FEATURES
    + V3_MELD_PLAN_FEATURES
    + OPP_EMBEDDING_TOTAL          # 48 (3 opponents x 16-dim, reused from v2)
    + V3_ACTION_TAKEN_FEATURES
    + V3_OPP_ACTIONS_FEATURES
    + V3_PHASE_FEATURES
)  # = 373

# LSTM architecture
V3_LSTM_HIDDEN = 192
V3_LSTM_LAYERS = 2
V3_LSTM_DROPOUT = 0.2
V3_MAX_SEQ_LEN = 80  # Max timesteps per round sequence (padded)

# Head input sizes
V3_DRAW_HEAD_INPUT = V3_LSTM_HIDDEN + CARD_FEATURES    # 192 + 6 = 198
V3_BUY_HEAD_INPUT = V3_LSTM_HIDDEN + CARD_FEATURES     # 192 + 6 = 198
V3_DISCARD_HEAD_INPUT = V3_LSTM_HIDDEN                  # 192
V3_DISCARD_HEAD_OUTPUT = MAX_HAND_CARDS                 # 22

# Phase indices for one-hot encoding
V3_PHASE_DRAW = 0
V3_PHASE_BUY = 1
V3_PHASE_ACTION = 2

# Action type indices for one-hot encoding (action_taken features)
V3_ACT_DRAW_PILE = 0
V3_ACT_TAKE_DISCARD = 1
V3_ACT_BUY = 2
V3_ACT_DECLINE_BUY = 3
V3_ACT_DISCARD = 4
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ml/training && python -m pytest test_v3.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/state_encoder.py ml/training/test_v3.py && git commit -m "feat(ml): add v3 LSTM state encoder constants and smoke tests"
```

---

## Task 2: Network v3 Architecture

**Files:**
- Create: `ml/training/network_v3.py`
- Modify: `ml/training/test_v3.py`

- [ ] **Step 1: Write shape tests for all v3 network components**

Append to `ml/training/test_v3.py`:

```python
import torch


def test_opponent_encoder_v3_shape():
    from network_v3 import OpponentEncoderNetV3
    from state_encoder import OPP_RAW_FEATURES, OPP_EMBEDDING_DIM
    encoder = OpponentEncoderNetV3()
    # Single opponent: (batch, 126) -> (batch, 16)
    x = torch.randn(4, OPP_RAW_FEATURES)
    out = encoder(x)
    assert out.shape == (4, OPP_EMBEDDING_DIM)


def test_lstm_backbone_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_MAX_SEQ_LEN
    model = ShanghaiLSTM()
    batch = 4
    seq_len = 35
    x = torch.randn(batch, seq_len, V3_TIMESTEP_INPUT_SIZE)
    mask = torch.ones(batch, seq_len, dtype=torch.bool)
    h_out, (h_n, c_n) = model.lstm_forward(x, mask)
    assert h_out.shape == (batch, seq_len, V3_LSTM_HIDDEN)
    assert h_n.shape == (2, batch, V3_LSTM_HIDDEN)  # 2 layers
    assert c_n.shape == (2, batch, V3_LSTM_HIDDEN)


def test_draw_head_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_LSTM_HIDDEN, CARD_FEATURES
    model = ShanghaiLSTM()
    h_t = torch.randn(4, V3_LSTM_HIDDEN)
    offered = torch.randn(4, CARD_FEATURES)
    prob = model.draw_head_forward(h_t, offered)
    assert prob.shape == (4, 1)
    assert (prob >= 0).all() and (prob <= 1).all()


def test_discard_head_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_DISCARD_HEAD_OUTPUT
    model = ShanghaiLSTM()
    h_t = torch.randn(4, 192)
    logits = model.discard_head_forward(h_t)
    assert logits.shape == (4, V3_DISCARD_HEAD_OUTPUT)


def test_buy_head_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_LSTM_HIDDEN, CARD_FEATURES
    model = ShanghaiLSTM()
    h_t = torch.randn(4, V3_LSTM_HIDDEN)
    offered = torch.randn(4, CARD_FEATURES)
    prob = model.buy_head_forward(h_t, offered)
    assert prob.shape == (4, 1)
    assert (prob >= 0).all() and (prob <= 1).all()


def test_auxiliary_head_shape():
    from network_v3 import ShanghaiLSTM
    model = ShanghaiLSTM()
    h_t = torch.randn(4, 192)
    score = model.auxiliary_head_forward(h_t)
    assert score.shape == (4, 1)


def test_full_forward_pass():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, CARD_FEATURES
    model = ShanghaiLSTM()
    batch, seq_len = 4, 35
    x = torch.randn(batch, seq_len, V3_TIMESTEP_INPUT_SIZE)
    mask = torch.ones(batch, seq_len, dtype=torch.bool)
    # Full sequence forward
    h_all, (h_n, c_n) = model.lstm_forward(x, mask)
    # Pick a timestep
    h_t = h_all[:, 10, :]
    offered = torch.randn(batch, CARD_FEATURES)
    # All heads work
    draw_prob = model.draw_head_forward(h_t, offered)
    discard_logits = model.discard_head_forward(h_t)
    buy_prob = model.buy_head_forward(h_t, offered)
    aux_score = model.auxiliary_head_forward(h_n[-1])  # last layer
    assert draw_prob.shape == (batch, 1)
    assert discard_logits.shape == (batch, 22)
    assert buy_prob.shape == (batch, 1)
    assert aux_score.shape == (batch, 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ml/training && python -m pytest test_v3.py::test_opponent_encoder_v3_shape -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'network_v3'`

- [ ] **Step 3: Implement network_v3.py**

Create `ml/training/network_v3.py`:

```python
"""V3 LSTM Sequence Model for Shanghai Rummy.

Architecture:
  - OpponentEncoderNetV3: 126 raw features -> 16-dim embedding per opponent (weight-shared)
  - ShanghaiLSTM: 2-layer LSTM backbone (323 -> 192 hidden) with specialized heads:
    - DrawHead: h_t + offered_card -> take/draw probability
    - DiscardHead: h_t -> logits over 22 hand slots
    - BuyHead: h_t + offered_card -> buy/pass probability
    - AuxiliaryHead: final h_t -> predicted round score
"""
import torch
import torch.nn as nn

from state_encoder import (
    OPP_RAW_FEATURES, OPP_EMBEDDING_DIM,
    CARD_FEATURES, MAX_HAND_CARDS,
    V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_LSTM_LAYERS, V3_LSTM_DROPOUT,
    V3_DRAW_HEAD_INPUT, V3_BUY_HEAD_INPUT, V3_DISCARD_HEAD_INPUT,
)


class OpponentEncoderNetV3(nn.Module):
    """Compress 126 raw opponent features into 16-dim embedding. Weight-shared across opponents."""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(OPP_RAW_FEATURES, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, OPP_EMBEDDING_DIM),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (batch, 126) -> (batch, 16)"""
        return self.net(x)

    def encode_all_opponents(self, opp_raw: torch.Tensor) -> torch.Tensor:
        """opp_raw: (batch, 378) -> (batch, 48). Splits into 3 opponents, encodes each."""
        embeddings = []
        for i in range(3):
            start = i * OPP_RAW_FEATURES
            end = start + OPP_RAW_FEATURES
            emb = self.forward(opp_raw[:, start:end])
            embeddings.append(emb)
        return torch.cat(embeddings, dim=-1)


class ShanghaiLSTM(nn.Module):
    """Unified LSTM model with specialized decision heads."""

    def __init__(self):
        super().__init__()

        # LSTM backbone
        self.lstm = nn.LSTM(
            input_size=V3_TIMESTEP_INPUT_SIZE,
            hidden_size=V3_LSTM_HIDDEN,
            num_layers=V3_LSTM_LAYERS,
            dropout=V3_LSTM_DROPOUT,
            batch_first=True,
        )

        # Draw head: h_t + offered_card(6) -> probability
        self.draw_head = nn.Sequential(
            nn.Linear(V3_DRAW_HEAD_INPUT, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

        # Discard head: h_t -> logits over 22 card slots
        self.discard_head = nn.Sequential(
            nn.Linear(V3_DISCARD_HEAD_INPUT, 96),
            nn.ReLU(),
            nn.Linear(96, MAX_HAND_CARDS),
        )

        # Buy head: h_t + offered_card(6) -> probability
        self.buy_head = nn.Sequential(
            nn.Linear(V3_BUY_HEAD_INPUT, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

        # Auxiliary head: final h_t -> predicted round score
        self.auxiliary_head = nn.Sequential(
            nn.Linear(V3_LSTM_HIDDEN, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def lstm_forward(
        self,
        x: torch.Tensor,
        mask: torch.Tensor,
        hx: tuple[torch.Tensor, torch.Tensor] | None = None,
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        """Run LSTM over padded sequences.

        Args:
            x: (batch, seq_len, input_size) — padded input
            mask: (batch, seq_len) — True for real timesteps, False for padding
            hx: optional initial (h_0, c_0), each (num_layers, batch, hidden)

        Returns:
            h_all: (batch, seq_len, hidden) — hidden state at every timestep
            (h_n, c_n): final hidden and cell states
        """
        lengths = mask.sum(dim=1).cpu()
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths, batch_first=True, enforce_sorted=False
        )
        packed_out, (h_n, c_n) = self.lstm(packed, hx)
        h_all, _ = nn.utils.rnn.pad_packed_sequence(
            packed_out, batch_first=True, total_length=x.size(1)
        )
        return h_all, (h_n, c_n)

    def draw_head_forward(self, h_t: torch.Tensor, offered_card: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192), offered_card: (batch, 6) -> (batch, 1) probability."""
        return self.draw_head(torch.cat([h_t, offered_card], dim=-1))

    def discard_head_forward(self, h_t: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192) -> (batch, 22) raw logits (mask before softmax)."""
        return self.discard_head(h_t)

    def buy_head_forward(self, h_t: torch.Tensor, offered_card: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192), offered_card: (batch, 6) -> (batch, 1) probability."""
        return self.buy_head(torch.cat([h_t, offered_card], dim=-1))

    def auxiliary_head_forward(self, h_t: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192) -> (batch, 1) predicted round score."""
        return self.auxiliary_head(h_t)

    def step_inference(
        self,
        x_t: torch.Tensor,
        hx: tuple[torch.Tensor, torch.Tensor],
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        """Single-step forward for autoregressive inference.

        Args:
            x_t: (1, 1, input_size) — single timestep
            hx: (h, c) each (num_layers, 1, hidden)

        Returns:
            h_t: (1, hidden) — current hidden state
            (h_n, c_n): updated states for next step
        """
        out, (h_n, c_n) = self.lstm(x_t, hx)
        h_t = out.squeeze(1)  # (1, hidden)
        return h_t, (h_n, c_n)
```

- [ ] **Step 4: Run all network tests**

Run: `cd ml/training && python -m pytest test_v3.py -v`
Expected: All 9 tests pass

- [ ] **Step 5: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/network_v3.py ml/training/test_v3.py && git commit -m "feat(ml): add v3 LSTM network architecture with specialized heads"
```

---

## Task 3: Bridge — Meld Plan Encoder

**Files:**
- Create: `ml/bridge/meld-plan-encoder.ts`

- [ ] **Step 1: Create meld-plan-encoder.ts**

Create `ml/bridge/meld-plan-encoder.ts`. This file imports the existing meld-finding logic and extracts 30 features.

```typescript
/**
 * Meld Plan Feature Encoder for v3 LSTM model.
 * Extracts 30-dim feature vector from existing meld-finding logic.
 */
import type { Card, RoundRequirement, Meld } from '../../src/game/types';
import { aiFindBestMelds } from '../../src/game/ai';
import { ROUNDS } from '../../src/lib/constants';

const MELD_PLAN_FEATURES = 30;
const MAX_REQUIREMENTS = 3; // Max meld requirements per round
const FEATURES_PER_REQUIREMENT = 4;

/**
 * Encode meld plan features for the current hand and round.
 * Returns a 30-dim float array.
 */
export function encodeMeldPlan(
  hand: Card[],
  roundNumber: number,
): number[] {
  const features = new Array(MELD_PLAN_FEATURES).fill(0);
  const requirement = ROUNDS[roundNumber]?.requirement;
  if (!requirement) return features;

  const reqSets = requirement.sets || 0;
  const reqRuns = requirement.runs || 0;
  const totalRequired = reqSets + reqRuns;

  // Try to find meld plans
  const bestMelds = aiFindBestMelds(hand, requirement);
  const canMeld = bestMelds !== null;

  // Count jokers in hand
  const jokerCount = hand.filter(c => c.suit === 'joker').length;
  const nonJokers = hand.filter(c => c.suit !== 'joker');

  // Analyze partial progress toward melds
  const setCandidates = analyzeSetProgress(nonJokers, reqSets);
  const runCandidates = analyzeRunProgress(nonJokers, reqRuns);

  let idx = 0;

  // Feature 0: Number of candidate meld plans (0 or 1 for now; could expand)
  features[idx++] = canMeld ? 1 : 0;

  // Feature 1: Best plan completeness (cards held / cards needed)
  if (canMeld) {
    features[idx++] = 1.0; // Complete
  } else {
    const totalCardsNeeded = totalRequired * 3; // Min 3 cards per meld
    const bestProgress = Math.min(
      (setBestCards(setCandidates) + runBestCards(runCandidates)) / Math.max(totalCardsNeeded, 1),
      1.0
    );
    features[idx++] = bestProgress;
  }

  // Feature 2: Best plan cards away
  if (canMeld) {
    features[idx++] = 0;
  } else {
    const setCardsAway = setCandidates.reduce((sum, c) => sum + Math.max(0, 3 - c.count), 0);
    const runCardsAway = runCandidates.reduce((sum, c) => sum + Math.max(0, 3 - c.length), 0);
    features[idx++] = Math.min((setCardsAway + runCardsAway) / 10.0, 1.0); // Normalize
  }

  // Features 3-14: Per-requirement slots (up to 3 requirements x 4 features)
  const requirements: Array<{ type: 'set' | 'run'; count: number }> = [];
  for (let i = 0; i < reqSets; i++) requirements.push({ type: 'set', count: 1 });
  for (let i = 0; i < reqRuns; i++) requirements.push({ type: 'run', count: 1 });

  for (let r = 0; r < MAX_REQUIREMENTS; r++) {
    const baseIdx = idx + r * FEATURES_PER_REQUIREMENT;
    if (r < requirements.length) {
      const req = requirements[r];
      features[baseIdx + 0] = req.type === 'set' ? 0 : 1; // Type
      if (req.type === 'set' && r < setCandidates.length) {
        features[baseIdx + 1] = setCandidates[r].count / 3.0; // Completeness
        features[baseIdx + 2] = Math.max(0, 3 - setCandidates[r].count) / 3.0; // Cards away
        features[baseIdx + 3] = setCandidates[r].count / 4.0; // Best partial length
      } else if (req.type === 'run') {
        const runIdx = r - reqSets;
        if (runIdx < runCandidates.length) {
          features[baseIdx + 1] = runCandidates[runIdx].length / 3.0; // Completeness
          features[baseIdx + 2] = Math.max(0, 3 - runCandidates[runIdx].length) / 3.0;
          features[baseIdx + 3] = runCandidates[runIdx].length / 5.0; // Best partial
        }
      }
    }
    // Else: padding zeros (already initialized)
  }
  idx += MAX_REQUIREMENTS * FEATURES_PER_REQUIREMENT; // idx = 15

  // Feature 15: Flexible card count (useful to multiple melds)
  const flexibleCards = countFlexibleCards(nonJokers, setCandidates, runCandidates);
  features[idx++] = flexibleCards / Math.max(hand.length, 1);

  // Feature 16: Dead card count (not useful to any plan)
  const usefulCards = new Set<string>();
  setCandidates.forEach(c => c.cardIds.forEach(id => usefulCards.add(id)));
  runCandidates.forEach(c => c.cardIds.forEach(id => usefulCards.add(id)));
  const deadCount = nonJokers.filter(c => !usefulCards.has(c.id)).length;
  features[idx++] = deadCount / Math.max(hand.length, 1);

  // Feature 17: Jokers in hand (normalized)
  features[idx++] = jokerCount / 4.0; // Max ~4 jokers in 2-deck game

  // Features 18-29: Padding (zeros, already initialized)

  return features;
}

interface SetCandidate {
  rank: number;
  count: number;
  cardIds: string[];
}

interface RunCandidate {
  suit: string;
  length: number;
  cardIds: string[];
}

function analyzeSetProgress(cards: Card[], reqSets: number): SetCandidate[] {
  const byRank = new Map<number, Card[]>();
  for (const c of cards) {
    const arr = byRank.get(c.rank) || [];
    arr.push(c);
    byRank.set(c.rank, arr);
  }
  const candidates: SetCandidate[] = [];
  for (const [rank, group] of byRank.entries()) {
    if (group.length >= 2) {
      candidates.push({ rank, count: group.length, cardIds: group.map(c => c.id) });
    }
  }
  // Sort by count descending, take top reqSets
  candidates.sort((a, b) => b.count - a.count);
  return candidates.slice(0, Math.max(reqSets, 1));
}

function analyzeRunProgress(cards: Card[], reqRuns: number): RunCandidate[] {
  const bySuit = new Map<string, Card[]>();
  for (const c of cards) {
    const arr = bySuit.get(c.suit) || [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }
  const candidates: RunCandidate[] = [];
  for (const [suit, suitCards] of bySuit.entries()) {
    const sorted = [...suitCards].sort((a, b) => a.rank - b.rank);
    // Find longest consecutive sequence (allowing gaps of 1)
    let bestRun: Card[] = [sorted[0]];
    let currentRun: Card[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].rank - sorted[i - 1].rank;
      if (gap <= 2 && gap > 0) {
        currentRun.push(sorted[i]);
      } else if (gap > 2) {
        if (currentRun.length > bestRun.length) bestRun = currentRun;
        currentRun = [sorted[i]];
      }
      // gap === 0: duplicate rank, skip
    }
    if (currentRun.length > bestRun.length) bestRun = currentRun;
    if (bestRun.length >= 2) {
      candidates.push({ suit, length: bestRun.length, cardIds: bestRun.map(c => c.id) });
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates.slice(0, Math.max(reqRuns, 1));
}

function setBestCards(candidates: SetCandidate[]): number {
  return candidates.reduce((sum, c) => sum + c.count, 0);
}

function runBestCards(candidates: RunCandidate[]): number {
  return candidates.reduce((sum, c) => sum + c.length, 0);
}

function countFlexibleCards(
  cards: Card[],
  sets: SetCandidate[],
  runs: RunCandidate[],
): number {
  const setIds = new Set<string>();
  const runIds = new Set<string>();
  sets.forEach(c => c.cardIds.forEach(id => setIds.add(id)));
  runs.forEach(c => c.cardIds.forEach(id => runIds.add(id)));
  let count = 0;
  for (const c of cards) {
    if (setIds.has(c.id) && runIds.has(c.id)) count++;
  }
  return count;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd D:/shanghai-tracker && npx tsx --eval "import { encodeMeldPlan } from './ml/bridge/meld-plan-encoder'; console.log('OK, exports:', typeof encodeMeldPlan)"`
Expected: `OK, exports: function`

- [ ] **Step 3: Commit**

```bash
cd D:/shanghai-tracker && git add ml/bridge/meld-plan-encoder.ts && git commit -m "feat(ml): add meld plan feature encoder for v3 bridge"
```

---

## Task 4: Bridge — v3 State Protocol

**Files:**
- Modify: `ml/bridge/game-bridge.ts`

This task adds `rich_state_v3` mode to the bridge. When enabled, state responses include `meldPlan` (30 features) and `opponentActionsSinceLast` (18 features), and the bridge tracks opponent actions between player 0's turns.

- [ ] **Step 1: Add opponent action tracking state**

Near the top of `game-bridge.ts`, after the existing state variables (find where `discardHistory` or similar tracking arrays are declared), add:

```typescript
// V3: Track opponent actions between player 0's turns
let oppActionsSinceLast: number[] = new Array(18).fill(0);

function resetOppActionsSinceLast(): void {
  oppActionsSinceLast = new Array(18).fill(0);
}

function recordOpponentAction(
  g: GameState,
  action: string,
  playerIdx: number,
): void {
  if (playerIdx === 0) return; // Only track opponents
  // [0] total opponent actions count
  oppActionsSinceLast[0] += 1;
  // [1] any opponent went down (check after action)
  if (g.players[playerIdx].hasLaidDown) {
    oppActionsSinceLast[1] = 1;
  }
  // [2] any opponent went out (hand empty)
  if (g.players[playerIdx].hand.length === 0) {
    oppActionsSinceLast[2] = 1;
  }
  // [3-14] last 2 opponent discard pickups (6 features each)
  if (action === 'take_discard' || action === 'buy') {
    // Shift slot 1 -> slot 0, add new to slot 1
    for (let i = 0; i < 6; i++) {
      oppActionsSinceLast[3 + i] = oppActionsSinceLast[9 + i];
    }
    // Encode the card that was on top of discard (now taken)
    // We can't perfectly reconstruct this after the fact, so we encode
    // the player's last acquired card from their hand (approximation)
    const hand = g.players[playerIdx].hand;
    if (hand.length > 0) {
      const card = hand[hand.length - 1]; // Last card added
      const encoded = encodeCard(card);
      for (let i = 0; i < 6; i++) {
        oppActionsSinceLast[9 + i] = encoded[i];
      }
    }
  }
  // [15] opponent buys this interval
  if (action === 'buy') {
    oppActionsSinceLast[15] += 1;
  }
  // [16] opponent layoffs this interval
  if (action.startsWith('layoff:')) {
    oppActionsSinceLast[16] += 1;
  }
  // Normalize count features for NN input
  // (done at read time, not here)
}
```

- [ ] **Step 2: Add v3 to the command handler**

In the `new_game` command handler, add support for `rich_state_v3`:

```typescript
// After existing rich_state_v2 handling:
const richStateV3 = msg.rich_state_v3 === true;
```

Store this flag in a module-level variable so state responses can check it.

In the response builder (the function that constructs state responses after `take_action` and `get_full_state`), when `richStateV3` is true, add these fields:

```typescript
if (richStateV3) {
  // Include everything from v2
  response.state = encodeRichStateV2Base(g, 0);
  response.opponentRaw = encodeAllOpponentRaw(g, 0);
  // New v3 fields
  response.meldPlan = encodeMeldPlan(g.players[0].hand, g.currentRound);
  response.opponentActionsSinceLast = [...oppActionsSinceLast];
}
```

- [ ] **Step 3: Hook opponent action recording into autoPlayOpponents**

In the `autoPlayOpponents` function (or wherever opponent actions are executed), after each opponent takes an action, call:

```typescript
recordOpponentAction(g, action, currentPlayerIdx);
```

- [ ] **Step 4: Reset opponent actions when player 0 acts**

In the `take_action` handler, when the action is from player 0, reset the tracking after including it in the response:

```typescript
// After building the response that includes opponentActionsSinceLast:
if (currentPlayer === 0) {
  resetOppActionsSinceLast();
}
```

Also reset at round boundaries (in the round-change logic).

- [ ] **Step 5: Update shanghai_env.py to support v3**

In `ml/training/shanghai_env.py`, add `rich_state_v3` parameter:

```python
class ShanghaiEnv:
    def __init__(self, player_count=2, opponent_ai=None, rich_state=False,
                 rich_state_v2=False, rich_state_v3=False):
        self.rich_state_v3 = rich_state_v3
        # ... existing init ...

    def reset(self, seed=None):
        cmd = {
            "cmd": "new_game",
            "players": self.player_count,
            "seed": seed,
            "opponent_ai": self.opponent_ai,
            "rich_state": self.rich_state,
            "rich_state_v2": self.rich_state_v2,
            "rich_state_v3": self.rich_state_v3,
        }
        # ... existing logic ...

    def get_full_state(self, player=0):
        resp = self._send({"cmd": "get_full_state", "player": player})
        # V3 adds meldPlan and opponentActionsSinceLast
        if self.rich_state_v3:
            resp['meld_plan'] = resp.get('meldPlan', [0] * 30)
            resp['opponent_actions'] = resp.get('opponentActionsSinceLast', [0] * 18)
        return resp
```

- [ ] **Step 6: Test the v3 bridge manually**

Run a quick smoke test to verify the bridge returns the new fields:

```bash
cd D:/shanghai-tracker/ml && npx tsx -e "
const { stdin, stdout } = require('process');
// This is a manual check - just verify the import works
import('./bridge/meld-plan-encoder').then(m => {
  console.log('meld-plan-encoder loaded, encodeMeldPlan type:', typeof m.encodeMeldPlan);
});
"
```

- [ ] **Step 7: Commit**

```bash
cd D:/shanghai-tracker && git add ml/bridge/game-bridge.ts ml/training/shanghai_env.py && git commit -m "feat(ml): add v3 bridge protocol with meld plan and opponent action tracking"
```

---

## Task 5: Data Generation v3 Mode

**Files:**
- Modify: `ml/training/generate_data.py`

- [ ] **Step 1: Add --v3 argument parsing**

In the `argparse` section of `generate_data.py`, add:

```python
parser.add_argument('--v3', action='store_true', help='V3 mode: collect round sequences for LSTM training')
```

- [ ] **Step 2: Implement v3 round sequence collection**

Add a new function `generate_v3_data(args)` that collects ordered round sequences. This is the core of the v3 data pipeline. Add after the existing `generate_data` function:

```python
def generate_v3_data(args):
    """V3: Collect ordered round sequences for LSTM training."""
    import json
    import time
    from shanghai_env import ShanghaiEnv

    log.info("V3 Sequence Data Generation")
    log.info(f"  Games:    {args.games}")
    log.info(f"  Output:   {args.output or 'auto'}")

    # Mixed opponent pool
    opponents = ['the-shark', 'the-nemesis', 'patient-pat', 'steady-sam']
    all_sequences = []
    timestamp = time.strftime('%Y%m%d_%H%M%S')
    output_path = args.output or f'../data/sequence_training/sequences_{timestamp}.json'

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    checkpoint_every = 500
    t0 = time.time()

    for game_i in range(args.games):
        opponent = opponents[game_i % len(opponents)]
        seed = 50000 + game_i
        env = ShanghaiEnv(player_count=4, opponent_ai=opponent, rich_state_v3=True)

        try:
            env.reset(seed=seed)
            # Track per-round sequences for player 0
            current_round = -1
            round_turns = []  # Ordered list of decision points this round
            prev_action_type = None
            prev_action_card = None

            while True:
                full_state = env.get_full_state(player=0)
                actions_list, current_player = env.get_valid_actions()
                phase = full_state.get('phase', '')
                game_round = full_state.get('round', 0)

                # Round boundary: save previous round's sequence
                if game_round != current_round:
                    if current_round >= 0 and len(round_turns) > 0:
                        scores = full_state.get('scores', [0, 0, 0, 0])
                        round_score = scores[0] if len(scores) > 0 else 0
                        # Compute per-round score (difference from previous)
                        seq = {
                            'game_seed': seed,
                            'round_number': current_round,
                            'round_score': round_score,
                            'went_out': round_score == 0,
                            'player_name': opponent,
                            'turns': round_turns,
                        }
                        all_sequences.append(seq)
                    current_round = game_round
                    round_turns = []
                    prev_action_type = None
                    prev_action_card = None

                # Only collect decision points for player 0
                if current_player == 0 and phase in ('draw', 'action', 'buy-window'):
                    # Determine phase label
                    if phase == 'draw':
                        phase_label = 'draw'
                    elif phase == 'buy-window':
                        phase_label = 'buy'
                    else:
                        phase_label = 'action'

                    # Build action-taken features from previous action
                    action_taken = encode_prev_action(prev_action_type, prev_action_card)

                    turn_data = {
                        'step': len(round_turns),
                        'state': full_state.get('state', []),
                        'opponent_raw': full_state.get('opponentRaw', []),
                        'meld_plan': full_state.get('meld_plan', [0] * 30),
                        'opponent_actions': full_state.get('opponent_actions', [0] * 18),
                        'action_taken': action_taken,
                        'phase': phase_label,
                        'valid_actions': actions_list,
                        'hand': full_state.get('hand', []),
                    }

                    # Get and record the AI action
                    ai_action = env.get_ai_action()

                    # Parse action for the label
                    action_type, action_detail = parse_action(ai_action, full_state)
                    turn_data['action_type'] = action_type
                    turn_data['action_detail'] = action_detail

                    round_turns.append(turn_data)

                    # Update prev action for next timestep
                    prev_action_type = action_type
                    prev_action_card = action_detail.get('card', None)

                    # Execute the action
                    state, reward, done, info = env.step(ai_action)
                else:
                    # Opponent turn or non-decision phase — just step
                    if len(actions_list) > 0:
                        ai_action = env.get_ai_action()
                        state, reward, done, info = env.step(ai_action)
                    else:
                        break

                if done:
                    # Save last round
                    if len(round_turns) > 0:
                        scores = info.get('scores', [0, 0, 0, 0])
                        seq = {
                            'game_seed': seed,
                            'round_number': current_round,
                            'round_score': scores[0] if len(scores) > 0 else 0,
                            'went_out': (scores[0] if len(scores) > 0 else 999) == 0,
                            'player_name': opponent,
                            'turns': round_turns,
                        }
                        all_sequences.append(seq)
                    break

        finally:
            env.close()

        if (game_i + 1) % 50 == 0:
            elapsed = time.time() - t0
            log.info(f"  Game {game_i + 1}/{args.games} | {len(all_sequences)} sequences | {elapsed:.0f}s")

        # Checkpoint
        if (game_i + 1) % checkpoint_every == 0:
            ckpt_path = output_path.replace('.json', f'_{game_i + 1}games.json')
            save_sequences(all_sequences, ckpt_path)
            log.info(f"  Checkpoint: {ckpt_path} ({len(all_sequences)} sequences)")

    # Final save
    final_path = output_path.replace('.json', f'_{args.games}games.json')
    save_sequences(all_sequences, final_path)
    log.info(f"Done. {len(all_sequences)} sequences saved to {final_path}")


def encode_prev_action(action_type: str | None, card: dict | None) -> list[float]:
    """Encode previous action as 10-dim vector: type one-hot(5) + card features(5)."""
    vec = [0.0] * 10
    if action_type is None:
        return vec
    type_map = {
        'draw_pile': 0, 'take_discard': 1, 'buy': 2, 'decline_buy': 3, 'discard': 4,
    }
    idx = type_map.get(action_type, 0)
    vec[idx] = 1.0
    if card is not None:
        rank = card.get('rank', 0)
        suit = card.get('suit', '')
        vec[5] = rank / 13.0
        suit_map = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3}
        suit_idx = suit_map.get(suit, -1)
        if suit_idx >= 0:
            vec[6 + suit_idx] = 1.0
        if suit == 'joker':
            # Use last feature for joker flag (only 5 card features: rank + 4 suit one-hot... 
            # but we have 5 slots: rank/13 + 4 suit. Joker: rank=0, no suit)
            pass
    return vec


def parse_action(action: str, full_state: dict) -> tuple[str, dict]:
    """Parse action string into type and detail for training labels."""
    if action == 'draw_pile':
        return ('draw_pile', {})
    elif action == 'take_discard':
        discard_top = full_state.get('discardTop', None)
        return ('take_discard', {'card': discard_top})
    elif action.startswith('discard:'):
        idx = int(action.split(':')[1])
        hand = full_state.get('hand', [])
        card = hand[idx] if idx < len(hand) else None
        return ('discard', {'card_index': idx, 'card': card})
    elif action == 'buy':
        discard_top = full_state.get('discardTop', None)
        return ('buy', {'card': discard_top})
    elif action == 'decline_buy':
        return ('decline_buy', {})
    elif action == 'meld':
        return ('meld', {})
    elif action.startswith('layoff:'):
        return ('layoff', {})
    else:
        return (action, {})


def save_sequences(sequences: list, path: str):
    """Save sequences to JSON with count header."""
    import json
    with open(path, 'w') as f:
        json.dump({'count': len(sequences), 'sequences': sequences}, f)
```

- [ ] **Step 3: Wire v3 mode into main**

In the `if __name__ == '__main__'` block, add:

```python
if args.v3:
    generate_v3_data(args)
else:
    generate_data(args)  # existing v1/v2 path
```

- [ ] **Step 4: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/generate_data.py && git commit -m "feat(ml): add v3 round sequence data generation mode"
```

---

## Task 6: Preprocessing v3 Mode

**Files:**
- Modify: `ml/training/preprocess.py`

- [ ] **Step 1: Add --v3 argument**

In argparse section:

```python
parser.add_argument('--v3', action='store_true', help='V3 mode: preprocess round sequences for LSTM')
parser.add_argument('--augment', type=int, default=5, help='Number of suit permutations per sequence (v3)')
parser.add_argument('--filter-players', type=str, default='the-shark,the-nemesis', help='Comma-separated player names to keep (v3)')
```

- [ ] **Step 2: Implement v3 preprocessing**

Add `preprocess_v3(args)` function:

```python
def preprocess_v3(args):
    """V3: Preprocess round sequences into padded tensors with suit augmentation."""
    import json
    import random
    from itertools import permutations
    from state_encoder import (
        V3_TIMESTEP_INPUT_SIZE, V3_MAX_SEQ_LEN,
        CARD_FEATURES, MAX_HAND_CARDS, MAX_DISCARD_HISTORY, MAX_TABLE_MELDS,
        MELD_FEATURES, OPP_RAW_FEATURES, OPP_EMBEDDING_DIM,
        V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
        V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES,
    )

    filter_players = set(args.filter_players.split(','))
    log.info(f"V3 Preprocessing")
    log.info(f"  Input:    {args.data}")
    log.info(f"  Filter:   {filter_players}")
    log.info(f"  Augment:  {args.augment} permutations per sequence")

    # Load sequences
    with open(args.data, 'r') as f:
        data = json.load(f)
    raw_sequences = data['sequences']
    log.info(f"  Loaded {len(raw_sequences)} raw sequences")

    # Filter to strong players
    filtered = [s for s in raw_sequences if s['player_name'] in filter_players]
    log.info(f"  After filtering: {len(filtered)} sequences")

    # Generate suit permutations for augmentation
    all_suit_perms = list(permutations(['hearts', 'diamonds', 'clubs', 'spades']))
    identity_perm = ('hearts', 'diamonds', 'clubs', 'spades')

    augmented_sequences = []
    for seq in filtered:
        # Always include original
        augmented_sequences.append(seq)
        # Add N random permutations (excluding identity)
        non_identity = [p for p in all_suit_perms if p != identity_perm]
        chosen = random.sample(non_identity, min(args.augment, len(non_identity)))
        for perm in chosen:
            augmented_sequences.append(permute_sequence_suits(seq, perm))

    log.info(f"  After augmentation: {len(augmented_sequences)} sequences")

    # Convert to padded tensors
    N = len(augmented_sequences)
    # We store raw features per timestep; the opponent encoding happens at train time
    # Input layout: state(264) + opponent_raw(378) + meld_plan(30) + opp_actions(18) + action_taken(10) + phase(3) = 703 raw features
    # The LSTM input (373) is computed at train time after opponent encoding (378 -> 48)
    RAW_FEATURES = 264 + 378 + 30 + 18 + 10 + 3  # 703

    sequences_tensor = torch.zeros(N, V3_MAX_SEQ_LEN, RAW_FEATURES, dtype=torch.float32)
    masks_tensor = torch.zeros(N, V3_MAX_SEQ_LEN, dtype=torch.bool)

    # Targets: phase(1) + action_type_idx(1) + card_index(1) = 3 per timestep
    # phase: 0=draw, 1=buy, 2=action
    # action_type_idx: 0=draw_pile, 1=take_discard, 2=buy, 3=decline_buy, 4=discard, 5=meld, 6=layoff
    # card_index: for discard, which hand slot (0-21); for others, -1
    targets_tensor = torch.full((N, V3_MAX_SEQ_LEN, 3), -1, dtype=torch.long)

    # Offered card features per timestep (for draw/buy heads): 6 features
    offered_tensor = torch.zeros(N, V3_MAX_SEQ_LEN, CARD_FEATURES, dtype=torch.float32)

    outcomes_tensor = torch.zeros(N, dtype=torch.float32)
    rounds_tensor = torch.zeros(N, dtype=torch.long)

    phase_map = {'draw': 0, 'buy': 1, 'action': 2}
    action_type_map = {
        'draw_pile': 0, 'take_discard': 1, 'buy': 2, 'decline_buy': 3,
        'discard': 4, 'meld': 5, 'layoff': 6,
    }

    for i, seq in enumerate(augmented_sequences):
        turns = seq['turns']
        seq_len = min(len(turns), V3_MAX_SEQ_LEN)
        outcomes_tensor[i] = seq['round_score']
        rounds_tensor[i] = seq['round_number']

        for t in range(seq_len):
            turn = turns[t]
            masks_tensor[i, t] = True

            # Pack raw features: state + opponent_raw + meld_plan + opp_actions + action_taken + phase
            state = turn.get('state', [])
            opp_raw = turn.get('opponent_raw', [])
            meld_plan = turn.get('meld_plan', [0] * 30)
            opp_actions = turn.get('opponent_actions', [0] * 18)
            action_taken = turn.get('action_taken', [0] * 10)

            phase_onehot = [0.0, 0.0, 0.0]
            phase_idx = phase_map.get(turn.get('phase', 'action'), 2)
            phase_onehot[phase_idx] = 1.0

            raw = state + opp_raw + meld_plan + opp_actions + action_taken + phase_onehot
            # Pad/truncate to RAW_FEATURES
            raw = raw[:RAW_FEATURES] + [0.0] * max(0, RAW_FEATURES - len(raw))
            sequences_tensor[i, t] = torch.tensor(raw, dtype=torch.float32)

            # Targets
            targets_tensor[i, t, 0] = phase_idx
            action_type = turn.get('action_type', '')
            targets_tensor[i, t, 1] = action_type_map.get(action_type, -1)
            detail = turn.get('action_detail', {})
            if action_type == 'discard':
                targets_tensor[i, t, 2] = detail.get('card_index', -1)

            # Offered card (for draw/buy phases)
            if turn.get('phase') in ('draw', 'buy'):
                valid = turn.get('valid_actions', [])
                if 'take_discard' in valid or turn.get('phase') == 'buy':
                    card = detail.get('card', None)
                    if card:
                        offered_tensor[i, t] = torch.tensor(
                            encode_card_features(card), dtype=torch.float32
                        )

        if (i + 1) % 10000 == 0:
            log.info(f"  Processed {i + 1}/{N} sequences")

    # Save
    output_dir = os.path.dirname(args.data) or '../data/sequence_training'
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.join(output_dir, 'v3')

    torch.save(sequences_tensor, f'{base}_sequences.pt')
    torch.save(masks_tensor, f'{base}_masks.pt')
    torch.save(targets_tensor, f'{base}_targets.pt')
    torch.save(offered_tensor, f'{base}_offered.pt')
    torch.save(outcomes_tensor, f'{base}_outcomes.pt')
    torch.save(rounds_tensor, f'{base}_rounds.pt')

    log.info(f"Saved tensors to {output_dir}/v3_*.pt")
    log.info(f"  sequences: {sequences_tensor.shape}")
    log.info(f"  masks:     {masks_tensor.shape}")
    log.info(f"  targets:   {targets_tensor.shape}")
    log.info(f"  offered:   {offered_tensor.shape}")
    log.info(f"  outcomes:  {outcomes_tensor.shape}")


def encode_card_features(card: dict) -> list[float]:
    """Encode a card dict as 6 features: rank/13, suit_onehot(4), is_joker."""
    if card is None:
        return [0.0] * 6
    rank = card.get('rank', 0)
    suit = card.get('suit', '')
    features = [rank / 13.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    suit_map = {'hearts': 1, 'diamonds': 2, 'clubs': 3, 'spades': 4}
    idx = suit_map.get(suit, 0)
    if idx > 0:
        features[idx] = 1.0
    if suit == 'joker':
        features[5] = 1.0
    return features


def permute_sequence_suits(seq: dict, perm: tuple) -> dict:
    """Create a copy of a sequence with suits permuted.

    perm is a tuple like ('clubs', 'hearts', 'spades', 'diamonds')
    meaning: hearts->clubs, diamonds->hearts, clubs->spades, spades->diamonds
    """
    suit_map = {
        'hearts': perm[0],
        'diamonds': perm[1],
        'clubs': perm[2],
        'spades': perm[3],
        'joker': 'joker',
    }

    def remap_card(card: dict | None) -> dict | None:
        if card is None:
            return None
        return {**card, 'suit': suit_map.get(card.get('suit', ''), card.get('suit', ''))}

    def remap_state_vector(state: list[float]) -> list[float]:
        """Remap suit one-hot features in the state vector.
        Card encoding is [rank/13, hearts, diamonds, clubs, spades, is_joker].
        Suit one-hot is at indices 1,2,3,4 within each 6-feature card block.
        """
        result = state[:]
        # Indices of original suits in one-hot: hearts=1, diamonds=2, clubs=3, spades=4
        orig_suits = ['hearts', 'diamonds', 'clubs', 'spades']
        orig_idx = {s: i + 1 for i, s in enumerate(orig_suits)}
        perm_idx = {s: orig_idx[suit_map[s]] for s in orig_suits}
        # But we need: for position that WAS hearts (idx 1), put 1 at NEW suit position
        # Actually: if original had hearts=1 at position 1, and perm maps hearts->clubs,
        # then new encoding should have clubs=1 at position 3.
        # So we need to rearrange: new[orig_idx[perm[s]]] = old[orig_idx[s]]
        # Simpler: for each card block, read which suit is hot, remap, write new hot

        card_blocks = []
        # Hand: 22 cards starting at 0
        for c in range(22):
            card_blocks.append(c * 6)
        # Discard history: 10 cards starting at 132
        for c in range(10):
            card_blocks.append(132 + c * 6)

        for block_start in card_blocks:
            if block_start + 5 >= len(result):
                break
            # Read suit one-hot
            old_suits = [result[block_start + 1], result[block_start + 2],
                         result[block_start + 3], result[block_start + 4]]
            # Find which suit was active
            new_suits = [0.0, 0.0, 0.0, 0.0]
            for s_idx, s_name in enumerate(orig_suits):
                if old_suits[s_idx] > 0.5:
                    new_name = suit_map[s_name]
                    new_s_idx = orig_suits.index(new_name)
                    new_suits[new_s_idx] = 1.0
            result[block_start + 1] = new_suits[0]
            result[block_start + 2] = new_suits[1]
            result[block_start + 3] = new_suits[2]
            result[block_start + 4] = new_suits[3]

        return result

    new_seq = {
        'game_seed': seq['game_seed'],
        'round_number': seq['round_number'],
        'round_score': seq['round_score'],
        'went_out': seq['went_out'],
        'player_name': seq['player_name'],
        'turns': [],
    }

    for turn in seq['turns']:
        new_turn = {**turn}
        new_turn['state'] = remap_state_vector(turn.get('state', []))
        # Remap opponent_raw suit features similarly (same 6-feature card blocks)
        new_turn['opponent_raw'] = remap_opp_raw_suits(turn.get('opponent_raw', []), suit_map)
        # Remap meld_plan (features 3-14 have suit-dependent aspects but are normalized ratios — keep as-is)
        # Remap action_taken card features
        action_taken = turn.get('action_taken', [0] * 10)
        if sum(action_taken[5:]) > 0:  # Has card features
            new_at = action_taken[:5]  # type one-hot unchanged
            old_card_suits = action_taken[6:10]
            new_card_suits = [0.0, 0.0, 0.0, 0.0]
            for s_idx, s_name in enumerate(['hearts', 'diamonds', 'clubs', 'spades']):
                if old_card_suits[s_idx] > 0.5:
                    new_name = suit_map[s_name]
                    new_s_idx = ['hearts', 'diamonds', 'clubs', 'spades'].index(new_name)
                    new_card_suits[new_s_idx] = 1.0
            new_at.append(action_taken[5])  # rank unchanged
            new_at.extend(new_card_suits)
            new_turn['action_taken'] = new_at
        # Remap hand cards
        new_turn['hand'] = [remap_card(c) for c in turn.get('hand', [])]
        # Remap action_detail card
        detail = turn.get('action_detail', {})
        if 'card' in detail and detail['card']:
            new_turn['action_detail'] = {**detail, 'card': remap_card(detail['card'])}

        new_seq['turns'].append(new_turn)

    return new_seq


def remap_opp_raw_suits(opp_raw: list[float], suit_map: dict) -> list[float]:
    """Remap suit one-hot in opponent raw features (378 = 3 opponents x 126 each).
    Per opponent: discard_history(60=10x6), pickup_history(30=5x6), melds(30=6x5), scalars(6).
    Card blocks are in discard and pickup history.
    """
    result = opp_raw[:]
    orig_suits = ['hearts', 'diamonds', 'clubs', 'spades']

    for opp in range(3):
        base = opp * 126
        # Discard history: 10 cards x 6 features
        for c in range(10):
            block = base + c * 6
            if block + 5 >= len(result):
                break
            old_suits = [result[block + 1], result[block + 2], result[block + 3], result[block + 4]]
            new_suits = [0.0, 0.0, 0.0, 0.0]
            for s_idx, s_name in enumerate(orig_suits):
                if old_suits[s_idx] > 0.5:
                    new_name = suit_map[s_name]
                    new_s_idx = orig_suits.index(new_name)
                    new_suits[new_s_idx] = 1.0
            result[block + 1] = new_suits[0]
            result[block + 2] = new_suits[1]
            result[block + 3] = new_suits[2]
            result[block + 4] = new_suits[3]
        # Pickup history: 5 cards x 6 features (starts at base + 60)
        for c in range(5):
            block = base + 60 + c * 6
            if block + 5 >= len(result):
                break
            old_suits = [result[block + 1], result[block + 2], result[block + 3], result[block + 4]]
            new_suits = [0.0, 0.0, 0.0, 0.0]
            for s_idx, s_name in enumerate(orig_suits):
                if old_suits[s_idx] > 0.5:
                    new_name = suit_map[s_name]
                    new_s_idx = orig_suits.index(new_name)
                    new_suits[new_s_idx] = 1.0
            result[block + 1] = new_suits[0]
            result[block + 2] = new_suits[1]
            result[block + 3] = new_suits[2]
            result[block + 4] = new_suits[3]

    return result
```

- [ ] **Step 3: Wire v3 mode into main**

In the `if __name__ == '__main__'` block:

```python
if args.v3:
    preprocess_v3(args)
elif args.type:
    preprocess_typed(args)  # existing path
```

- [ ] **Step 4: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/preprocess.py && git commit -m "feat(ml): add v3 sequence preprocessing with suit augmentation"
```

---

## Task 7: Training Script

**Files:**
- Create: `ml/training/train_sequence.py`

- [ ] **Step 1: Create train_sequence.py**

```python
"""V3 LSTM Sequence Model Training.

Trains a unified LSTM on expert round sequences with:
  - Phase 1 (epochs 1-20): Teacher forcing
  - Phase 2 (epochs 21-50): Scheduled sampling (p ramps 0.1 -> 0.5)

Usage:
  python train_sequence.py --data ../data/sequence_training/v3_sequences.pt --epochs 50
"""
import argparse
import math
import os
import sys
import time

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, random_split

from log_utils import setup_logging
from network_v3 import ShanghaiLSTM, OpponentEncoderNetV3
from state_encoder import (
    V3_MAX_SEQ_LEN, V3_LSTM_HIDDEN, V3_LSTM_LAYERS,
    OPP_RAW_FEATURES, OPP_RAW_TOTAL, OPP_EMBEDDING_DIM, OPP_EMBEDDING_TOTAL,
    CARD_FEATURES, BASE_STATE_SIZE, MAX_HAND_CARDS,
    V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
    V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES, V3_TIMESTEP_INPUT_SIZE,
)

log = setup_logging('train_sequence')

# Raw feature layout in preprocessed tensors (703 features):
# [0:264]     base state
# [264:642]   opponent raw (378)
# [642:672]   meld plan (30)
# [672:690]   opponent actions (18)
# [690:700]   action taken (10)
# [700:703]   phase (3)
RAW_STATE_END = BASE_STATE_SIZE                    # 264
RAW_OPP_END = RAW_STATE_END + OPP_RAW_TOTAL        # 642
RAW_MELD_END = RAW_OPP_END + V3_MELD_PLAN_FEATURES # 672
RAW_OPP_ACT_END = RAW_MELD_END + V3_OPP_ACTIONS_FEATURES  # 690
RAW_ACT_TAKEN_END = RAW_OPP_ACT_END + V3_ACTION_TAKEN_FEATURES  # 700
RAW_TOTAL = RAW_ACT_TAKEN_END + V3_PHASE_FEATURES   # 703


def build_lstm_input(raw: torch.Tensor, encoder: OpponentEncoderNetV3) -> torch.Tensor:
    """Convert raw 703-dim features to 373-dim LSTM input by encoding opponents.

    raw: (batch, seq_len, 703)
    Returns: (batch, seq_len, 373)
    """
    batch, seq_len, _ = raw.shape

    base_state = raw[:, :, :RAW_STATE_END]                    # (B, T, 264)
    opp_raw = raw[:, :, RAW_STATE_END:RAW_OPP_END]            # (B, T, 378)
    meld_plan = raw[:, :, RAW_OPP_END:RAW_MELD_END]           # (B, T, 30)
    opp_actions = raw[:, :, RAW_MELD_END:RAW_OPP_ACT_END]     # (B, T, 18)
    action_taken = raw[:, :, RAW_OPP_ACT_END:RAW_ACT_TAKEN_END]  # (B, T, 10)
    phase = raw[:, :, RAW_ACT_TAKEN_END:RAW_TOTAL]            # (B, T, 3)

    # Encode opponents: reshape to (B*T, 378), encode, reshape back
    flat_opp = opp_raw.reshape(-1, OPP_RAW_TOTAL)
    flat_emb = encoder.encode_all_opponents(flat_opp)  # (B*T, 48)
    opp_emb = flat_emb.reshape(batch, seq_len, OPP_EMBEDDING_TOTAL)

    # Concatenate: base(264) + meld(30) + opp_emb(48) + opp_act(18) + act_taken(10) + phase(3) = 373
    return torch.cat([base_state, meld_plan, opp_emb, opp_actions, action_taken, phase], dim=-1)


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f"V3 LSTM Sequence Training")
    log.info(f"  Device:  {device}")
    log.info(f"  Data:    {args.data}")
    log.info(f"  Epochs:  {args.epochs}")

    # Load preprocessed tensors
    data_dir = os.path.dirname(args.data)
    prefix = os.path.join(data_dir, 'v3')

    sequences = torch.load(f'{prefix}_sequences.pt', weights_only=True)   # (N, 80, 703)
    masks = torch.load(f'{prefix}_masks.pt', weights_only=True)           # (N, 80)
    targets = torch.load(f'{prefix}_targets.pt', weights_only=True)       # (N, 80, 3)
    offered = torch.load(f'{prefix}_offered.pt', weights_only=True)       # (N, 80, 6)
    outcomes = torch.load(f'{prefix}_outcomes.pt', weights_only=True)     # (N,)
    rounds = torch.load(f'{prefix}_rounds.pt', weights_only=True)         # (N,)

    N = sequences.shape[0]
    log.info(f"  Sequences: {N}")
    log.info(f"  Shape:     {sequences.shape}")

    # Train/val split (80/20), stratified by round
    val_size = int(N * 0.2)
    train_size = N - val_size
    train_set, val_set = random_split(
        TensorDataset(sequences, masks, targets, offered, outcomes),
        [train_size, val_size],
        generator=torch.Generator().manual_seed(42),
    )

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, pin_memory=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, pin_memory=True)

    log.info(f"  Train: {train_size}, Val: {val_size}")

    # Models
    model = ShanghaiLSTM().to(device)
    encoder = OpponentEncoderNetV3().to(device)

    # Optimizer: lower LR for encoder
    optimizer = torch.optim.Adam([
        {'params': model.parameters(), 'lr': args.lr},
        {'params': encoder.parameters(), 'lr': args.lr * 0.5},
    ])

    # LR scheduler: cosine annealing
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-5)

    # Loss functions
    bce_loss = nn.BCELoss(reduction='none')
    ce_loss = nn.CrossEntropyLoss(reduction='none')
    mse_loss = nn.MSELoss()

    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    os.makedirs(model_dir, exist_ok=True)
    best_val_loss = float('inf')
    patience_counter = 0

    for epoch in range(1, args.epochs + 1):
        # Scheduled sampling probability
        if epoch <= 20:
            sample_p = 0.0  # Pure teacher forcing
        else:
            sample_p = 0.1 + (0.4 * (epoch - 21) / max(args.epochs - 21, 1))
            sample_p = min(sample_p, 0.5)

        # ── Train ──
        model.train()
        encoder.train()
        train_metrics = run_epoch(
            model, encoder, train_loader, device,
            bce_loss, ce_loss, mse_loss,
            optimizer=optimizer, sample_p=sample_p,
        )

        # ── Validate ──
        model.eval()
        encoder.eval()
        with torch.no_grad():
            val_metrics = run_epoch(
                model, encoder, val_loader, device,
                bce_loss, ce_loss, mse_loss,
                optimizer=None, sample_p=0.0,
            )

        scheduler.step()

        # Log
        log.info(
            f"Epoch {epoch:3d}/{args.epochs} | "
            f"Train loss: {train_metrics['loss']:.4f} | "
            f"Val loss: {val_metrics['loss']:.4f} | "
            f"Discard acc: {val_metrics['discard_acc']:.1f}% | "
            f"Draw acc: {val_metrics['draw_acc']:.1f}% | "
            f"Buy acc: {val_metrics['buy_acc']:.1f}% | "
            f"sample_p: {sample_p:.2f}"
        )

        # Checkpointing
        if val_metrics['loss'] < best_val_loss:
            best_val_loss = val_metrics['loss']
            patience_counter = 0
            torch.save(model.state_dict(), os.path.join(model_dir, 'shanghai_lstm.pt'))
            torch.save(encoder.state_dict(), os.path.join(model_dir, 'opponent_encoder_v3.pt'))
            log.info(f"  => Saved best model (val loss: {best_val_loss:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                log.info(f"  Early stopping after {args.patience} epochs without improvement")
                break

        if epoch % 5 == 0:
            torch.save(model.state_dict(), os.path.join(model_dir, f'shanghai_lstm_epoch{epoch}.pt'))

    log.info(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    log.info(f"Model saved to {os.path.join(model_dir, 'shanghai_lstm.pt')}")


def run_epoch(model, encoder, loader, device, bce_loss, ce_loss, mse_loss, optimizer=None, sample_p=0.0):
    """Run one epoch of training or validation.

    When sample_p > 0 (scheduled sampling), we process step-by-step so the model's
    own predictions can replace ground-truth action_taken features for subsequent steps.
    When sample_p == 0 (teacher forcing), we use the fast packed-sequence path.
    """
    total_loss = 0.0
    discard_correct = 0
    discard_total = 0
    draw_correct = 0
    draw_total = 0
    buy_correct = 0
    buy_total = 0
    n_batches = 0

    for batch in loader:
        seq_raw, mask, tgt, off, out = [b.to(device) for b in batch]
        batch_size, seq_len = mask.shape

        # Build LSTM input from raw features
        lstm_input = build_lstm_input(seq_raw, encoder)  # (B, T, 373)

        if sample_p > 0 and optimizer is not None:
            # ── Step-by-step with scheduled sampling ──
            # Process one timestep at a time so we can feed model predictions back
            h = torch.zeros(V3_LSTM_LAYERS, batch_size, V3_LSTM_HIDDEN, device=device)
            c_state = torch.zeros(V3_LSTM_LAYERS, batch_size, V3_LSTM_HIDDEN, device=device)
            h_all = torch.zeros(batch_size, seq_len, V3_LSTM_HIDDEN, device=device)

            current_input = lstm_input.clone()

            for t in range(seq_len):
                x_t = current_input[:, t:t+1, :]  # (B, 1, 373)
                out_t, (h, c_state) = model.lstm(x_t, (h, c_state))
                h_all[:, t, :] = out_t.squeeze(1)

                # Scheduled sampling: maybe replace next step's action_taken with model's prediction
                if t + 1 < seq_len and torch.rand(1).item() < sample_p:
                    h_t = out_t.squeeze(1)  # (B, 192)
                    phase_t = tgt[:, t, 0]
                    offered_t = off[:, t, :]

                    # Get model's predicted action and encode as action_taken features
                    pred_action = torch.zeros(batch_size, V3_ACTION_TAKEN_FEATURES, device=device)

                    # Draw phase predictions
                    draw_sel = (phase_t == 0) & mask[:, t]
                    if draw_sel.any():
                        prob = model.draw_head_forward(h_t[draw_sel], offered_t[draw_sel])
                        took = (prob.squeeze(1) > 0.5).float()
                        # Encode: take_discard=idx1, draw_pile=idx0
                        pred_action[draw_sel, 0] = 1.0 - took  # draw_pile
                        pred_action[draw_sel, 1] = took         # take_discard

                    # Buy phase predictions
                    buy_sel = (phase_t == 1) & mask[:, t]
                    if buy_sel.any():
                        prob = model.buy_head_forward(h_t[buy_sel], offered_t[buy_sel])
                        bought = (prob.squeeze(1) > 0.5).float()
                        pred_action[buy_sel, 2] = bought      # buy
                        pred_action[buy_sel, 3] = 1.0 - bought # decline

                    # Discard phase predictions
                    disc_sel = (phase_t == 2) & mask[:, t]
                    if disc_sel.any():
                        logits = model.discard_head_forward(h_t[disc_sel])
                        pred_action[disc_sel, 4] = 1.0  # discard type
                        # Card features from predicted discard would need hand info;
                        # for simplicity, leave card features as zeros (the action type
                        # carries the main signal)

                    # Overwrite action_taken portion of next timestep's input
                    # action_taken is at the end of the 373-dim input, before phase(3)
                    # Layout: base(264-opp+meld+opp_emb...) ... action_taken(10) + phase(3)
                    # In the 373 input: positions [-13:-3] are action_taken
                    act_start = V3_TIMESTEP_INPUT_SIZE - V3_PHASE_FEATURES - V3_ACTION_TAKEN_FEATURES
                    act_end = act_start + V3_ACTION_TAKEN_FEATURES
                    current_input[:, t + 1, act_start:act_end] = pred_action
        else:
            # ── Fast batched path (teacher forcing / validation) ──
            h_all, (h_n, c_n) = model.lstm_forward(lstm_input, mask)

        # Compute per-timestep losses (same for both paths)
        loss = torch.tensor(0.0, device=device)
        batch_discard_correct = 0
        batch_draw_correct = 0
        batch_buy_correct = 0
        batch_discard_total = 0
        batch_draw_total = 0
        batch_buy_total = 0

        for t in range(seq_len):
            valid = mask[:, t]  # (B,) bool
            if not valid.any():
                continue

            h_t = h_all[:, t, :]  # (B, 192)
            phase = tgt[:, t, 0]  # (B,) — 0=draw, 1=buy, 2=action
            action_type = tgt[:, t, 1]  # (B,)
            card_idx = tgt[:, t, 2]  # (B,) — discard slot or -1

            offered_card = off[:, t, :]  # (B, 6)

            # Draw decisions (phase == 0, action_type in {0=draw_pile, 1=take_discard})
            draw_mask = valid & (phase == 0) & ((action_type == 0) | (action_type == 1))
            if draw_mask.any():
                draw_h = h_t[draw_mask]
                draw_off = offered_card[draw_mask]
                draw_prob = model.draw_head_forward(draw_h, draw_off)  # (n, 1)
                draw_label = (action_type[draw_mask] == 1).float().unsqueeze(1)  # 1=take
                draw_loss = bce_loss(draw_prob, draw_label).mean()
                loss = loss + draw_loss
                batch_draw_correct += ((draw_prob > 0.5).float() == draw_label).sum().item()
                batch_draw_total += draw_mask.sum().item()

            # Buy decisions (phase == 1, action_type in {2=buy, 3=decline})
            buy_mask = valid & (phase == 1) & ((action_type == 2) | (action_type == 3))
            if buy_mask.any():
                buy_h = h_t[buy_mask]
                buy_off = offered_card[buy_mask]
                buy_prob = model.buy_head_forward(buy_h, buy_off)
                buy_label = (action_type[buy_mask] == 2).float().unsqueeze(1)
                buy_loss = bce_loss(buy_prob, buy_label).mean()
                loss = loss + buy_loss
                batch_buy_correct += ((buy_prob > 0.5).float() == buy_label).sum().item()
                batch_buy_total += buy_mask.sum().item()

            # Discard decisions (phase == 2, action_type == 4, card_idx >= 0)
            disc_mask = valid & (phase == 2) & (action_type == 4) & (card_idx >= 0)
            if disc_mask.any():
                disc_h = h_t[disc_mask]
                disc_logits = model.discard_head_forward(disc_h)  # (n, 22)
                disc_target = card_idx[disc_mask]
                disc_loss = ce_loss(disc_logits, disc_target).mean()
                loss = loss + disc_loss
                pred = disc_logits.argmax(dim=1)
                batch_discard_correct += (pred == disc_target).sum().item()
                batch_discard_total += disc_mask.sum().item()

        # Auxiliary loss: round outcome prediction from last valid h_t
        lengths = mask.sum(dim=1).long()  # (B,)
        last_h = h_all[torch.arange(batch_size, device=device), lengths - 1, :]
        aux_pred = model.auxiliary_head_forward(last_h)
        aux_loss = mse_loss(aux_pred.squeeze(1), out)
        loss = loss + 0.1 * aux_loss

        if optimizer is not None:
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(
                list(model.parameters()) + list(encoder.parameters()), 1.0
            )
            optimizer.step()

        total_loss += loss.item()
        discard_correct += batch_discard_correct
        discard_total += batch_discard_total
        draw_correct += batch_draw_correct
        draw_total += batch_draw_total
        buy_correct += batch_buy_correct
        buy_total += batch_buy_total
        n_batches += 1

    return {
        'loss': total_loss / max(n_batches, 1),
        'discard_acc': 100.0 * discard_correct / max(discard_total, 1),
        'draw_acc': 100.0 * draw_correct / max(draw_total, 1),
        'buy_acc': 100.0 * buy_correct / max(buy_total, 1),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='V3 LSTM Sequence Training')
    parser.add_argument('--data', type=str, required=True, help='Path to v3_sequences.pt (directory with v3_*.pt files)')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--patience', type=int, default=10)
    args = parser.parse_args()
    train(args)
```

- [ ] **Step 2: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/train_sequence.py && git commit -m "feat(ml): add v3 LSTM sequence training script"
```

---

## Task 8: Evaluation Script

**Files:**
- Create: `ml/training/evaluate_sequence.py`

- [ ] **Step 1: Create evaluate_sequence.py**

```python
"""V3 LSTM Sequence Model Evaluation.

Runs the trained LSTM model against specified opponents and reports win rate + avg score.

Usage:
  python evaluate_sequence.py --opponent the-shark --games 100 --players 4
  python evaluate_sequence.py --opponent the-shark --games 100 --players 4 --temperature 0.8
"""
import argparse
import json
import os
import sys
import time

import torch
import torch.nn.functional as F

from log_utils import setup_logging
from network_v3 import ShanghaiLSTM, OpponentEncoderNetV3
from state_encoder import (
    BASE_STATE_SIZE, OPP_RAW_TOTAL, OPP_EMBEDDING_TOTAL,
    V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
    V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES,
    V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_LSTM_LAYERS,
    CARD_FEATURES, MAX_HAND_CARDS,
)

log = setup_logging('evaluate_sequence')


def encode_card_features(card: dict | None) -> list[float]:
    """Encode card dict as 6 features."""
    if card is None:
        return [0.0] * 6
    rank = card.get('rank', 0)
    suit = card.get('suit', '')
    features = [rank / 13.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    suit_map = {'hearts': 1, 'diamonds': 2, 'clubs': 3, 'spades': 4}
    idx = suit_map.get(suit, 0)
    if idx > 0:
        features[idx] = 1.0
    if suit == 'joker':
        features[5] = 1.0
    return features


def encode_prev_action(action_type: str | None, card: dict | None) -> list[float]:
    """Encode previous action as 10-dim vector."""
    vec = [0.0] * 10
    if action_type is None:
        return vec
    type_map = {'draw_pile': 0, 'take_discard': 1, 'buy': 2, 'decline_buy': 3, 'discard': 4}
    idx = type_map.get(action_type, 0)
    vec[idx] = 1.0
    if card:
        vec[5] = card.get('rank', 0) / 13.0
        suit_map = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3}
        s_idx = suit_map.get(card.get('suit', ''), -1)
        if s_idx >= 0:
            vec[6 + s_idx] = 1.0
    return vec


def build_timestep_input(
    state: list, opp_raw: list, meld_plan: list, opp_actions: list,
    action_taken: list, phase: str, encoder: OpponentEncoderNetV3, device: torch.device,
) -> torch.Tensor:
    """Build a single 373-dim LSTM input from raw game state."""
    base = torch.tensor(state[:BASE_STATE_SIZE], dtype=torch.float32, device=device).unsqueeze(0)
    opp = torch.tensor(opp_raw[:OPP_RAW_TOTAL], dtype=torch.float32, device=device).unsqueeze(0)
    opp_emb = encoder.encode_all_opponents(opp)  # (1, 48)

    meld = torch.tensor(meld_plan[:V3_MELD_PLAN_FEATURES], dtype=torch.float32, device=device).unsqueeze(0)
    opp_act = torch.tensor(opp_actions[:V3_OPP_ACTIONS_FEATURES], dtype=torch.float32, device=device).unsqueeze(0)
    act_taken = torch.tensor(action_taken[:V3_ACTION_TAKEN_FEATURES], dtype=torch.float32, device=device).unsqueeze(0)

    phase_vec = torch.zeros(1, V3_PHASE_FEATURES, device=device)
    phase_map = {'draw': 0, 'buy': 1, 'action': 2}
    phase_vec[0, phase_map.get(phase, 2)] = 1.0

    # (1, 373)
    return torch.cat([base, meld, opp_emb, opp_act, act_taken, phase_vec], dim=-1)


def evaluate(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f"V3 LSTM Sequence Evaluation")
    log.info(f"  Opponent:    {args.opponent}")
    log.info(f"  Games:       {args.games}")
    log.info(f"  Players:     {args.players}")
    log.info(f"  Temperature: {args.temperature}")
    log.info(f"  Device:      {device}")

    # Load models
    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    model = ShanghaiLSTM().to(device)
    model.load_state_dict(torch.load(os.path.join(model_dir, 'shanghai_lstm.pt'), map_location=device, weights_only=True))
    model.eval()

    encoder = OpponentEncoderNetV3().to(device)
    encoder.load_state_dict(torch.load(os.path.join(model_dir, 'opponent_encoder_v3.pt'), map_location=device, weights_only=True))
    encoder.eval()

    from shanghai_env import ShanghaiEnv

    results = []
    wins = 0
    total_my_score = 0
    total_opp_score = 0
    t0 = time.time()

    for game_i in range(args.games):
        seed = 10000 + game_i
        env = ShanghaiEnv(player_count=args.players, opponent_ai=args.opponent, rich_state_v3=True)

        try:
            env.reset(seed=seed)
            # LSTM hidden state
            h = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN, device=device)
            c = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN, device=device)
            prev_round = -1
            prev_action_type = None
            prev_action_card = None
            steps = 0

            while True:
                full_state = env.get_full_state(player=0)
                actions_list, current_player = env.get_valid_actions()
                phase = full_state.get('phase', '')
                game_round = full_state.get('round', 0)

                # Reset hidden state at round boundary
                if game_round != prev_round:
                    h = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN, device=device)
                    c = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN, device=device)
                    prev_action_type = None
                    prev_action_card = None
                    prev_round = game_round

                if current_player != 0 or phase not in ('draw', 'action', 'buy-window'):
                    # Let the bridge handle non-player-0 turns
                    if len(actions_list) > 0:
                        ai_action = env.get_ai_action()
                        _, _, done, info = env.step(ai_action)
                    else:
                        break
                    if done:
                        break
                    steps += 1
                    continue

                # Build input
                action_taken = encode_prev_action(prev_action_type, prev_action_card)
                phase_label = 'draw' if phase == 'draw' else ('buy' if phase == 'buy-window' else 'action')

                x_t = build_timestep_input(
                    full_state.get('state', []),
                    full_state.get('opponentRaw', [0] * OPP_RAW_TOTAL),
                    full_state.get('meld_plan', [0] * V3_MELD_PLAN_FEATURES),
                    full_state.get('opponent_actions', [0] * V3_OPP_ACTIONS_FEATURES),
                    action_taken, phase_label, encoder, device,
                )

                # LSTM step
                with torch.no_grad():
                    h_t, (h, c) = model.step_inference(x_t.unsqueeze(1), (h, c))

                # Decide based on phase
                action = None
                action_type = None
                action_card = None

                if phase == 'draw':
                    if 'take_discard' in actions_list:
                        offered = encode_card_features(full_state.get('discardTop', None))
                        offered_t = torch.tensor(offered, dtype=torch.float32, device=device).unsqueeze(0)
                        prob = model.draw_head_forward(h_t, offered_t).item()
                        if prob > 0.5:
                            action = 'take_discard'
                            action_type = 'take_discard'
                            action_card = full_state.get('discardTop')
                        else:
                            action = 'draw_pile'
                            action_type = 'draw_pile'
                    else:
                        action = 'draw_pile'
                        action_type = 'draw_pile'

                elif phase == 'buy-window':
                    offered = encode_card_features(full_state.get('discardTop', None))
                    offered_t = torch.tensor(offered, dtype=torch.float32, device=device).unsqueeze(0)
                    prob = model.buy_head_forward(h_t, offered_t).item()
                    if prob > 0.5:
                        action = 'buy'
                        action_type = 'buy'
                        action_card = full_state.get('discardTop')
                    else:
                        action = 'decline_buy'
                        action_type = 'decline_buy'

                elif phase == 'action':
                    # Rule-based meld/layoff first
                    if 'meld' in actions_list:
                        action = 'meld'
                        action_type = 'meld'
                    elif any(a.startswith('layoff:') for a in actions_list):
                        action = next(a for a in actions_list if a.startswith('layoff:'))
                        action_type = 'layoff'
                    else:
                        # Neural discard
                        logits = model.discard_head_forward(h_t).squeeze(0)  # (22,)
                        # Mask invalid slots
                        hand_size = full_state.get('handSize', 10)
                        mask = torch.full((MAX_HAND_CARDS,), float('-inf'), device=device)
                        # Valid discard actions
                        for a in actions_list:
                            if a.startswith('discard:'):
                                idx = int(a.split(':')[1])
                                if idx < MAX_HAND_CARDS:
                                    mask[idx] = 0.0
                        logits = logits + mask

                        if args.temperature != 1.0:
                            logits = logits / args.temperature
                            probs = F.softmax(logits, dim=0)
                            card_idx = torch.multinomial(probs, 1).item()
                        else:
                            card_idx = logits.argmax().item()

                        action = f'discard:{card_idx}'
                        action_type = 'discard'
                        hand = full_state.get('hand', [])
                        action_card = hand[card_idx] if card_idx < len(hand) else None

                if action is None:
                    action = actions_list[0] if actions_list else 'draw_pile'

                prev_action_type = action_type
                prev_action_card = action_card

                _, _, done, info = env.step(action)
                steps += 1

                if done:
                    break

                if steps >= 6000:
                    break

            # Record result
            scores = info.get('scores', full_state.get('scores', [999, 0, 0, 0]))
            my_score = scores[0] if len(scores) > 0 else 999
            opp_scores = scores[1:] if len(scores) > 1 else [0]
            best_opp = min(opp_scores) if opp_scores else 0
            won = my_score <= best_opp

            results.append({
                'seed': seed,
                'my_score': my_score,
                'best_opp_score': best_opp,
                'won': won,
                'steps': steps,
            })

            wins += 1 if won else 0
            total_my_score += my_score
            total_opp_score += best_opp

        finally:
            env.close()

        if (game_i + 1) % 10 == 0:
            log.info(f"  Game {game_i + 1}/{args.games} | "
                     f"Win rate: {100.0 * wins / (game_i + 1):.1f}% | "
                     f"Avg score: {total_my_score / (game_i + 1):.0f}")

    elapsed = time.time() - t0
    win_rate = 100.0 * wins / args.games
    avg_score = total_my_score / args.games
    avg_opp = total_opp_score / args.games

    log.info(f"\n{'='*60}")
    log.info(f"Results: {args.games} games vs {args.opponent}")
    log.info(f"  Win rate:  {win_rate:.1f}%")
    log.info(f"  Avg score: {avg_score:.1f}")
    log.info(f"  Avg opp:   {avg_opp:.1f}")
    log.info(f"  Elapsed:   {elapsed:.1f}s")

    # Save results
    eval_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'eval')
    os.makedirs(eval_dir, exist_ok=True)
    out_path = os.path.join(eval_dir, f'eval_lstm_vs_{args.opponent}.json')
    with open(out_path, 'w') as f:
        json.dump({
            'model': 'lstm_v3',
            'opponent': args.opponent,
            'games': args.games,
            'players': args.players,
            'temperature': args.temperature,
            'win_rate': win_rate,
            'avg_my_score': avg_score,
            'avg_opp_score': avg_opp,
            'elapsed_s': elapsed,
            'per_game': results,
        }, f, indent=2)
    log.info(f"Saved to {out_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='V3 LSTM Evaluation')
    parser.add_argument('--opponent', type=str, required=True)
    parser.add_argument('--games', type=int, default=100)
    parser.add_argument('--players', type=int, default=4)
    parser.add_argument('--temperature', type=float, default=1.0)
    args = parser.parse_args()
    evaluate(args)
```

- [ ] **Step 2: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/evaluate_sequence.py && git commit -m "feat(ml): add v3 LSTM sequence evaluation script"
```

---

## Task 9: Export Script Update

**Files:**
- Modify: `ml/training/export_model.py`

- [ ] **Step 1: Add --v3 export mode**

Add to `export_model.py` a `export_v3()` function:

```python
def export_v3():
    """Export LSTM + heads + opponent encoder as single ONNX graph with explicit state I/O."""
    import torch
    from network_v3 import ShanghaiLSTM, OpponentEncoderNetV3
    from state_encoder import V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_LSTM_LAYERS, CARD_FEATURES

    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')

    model = ShanghaiLSTM()
    model.load_state_dict(torch.load(os.path.join(model_dir, 'shanghai_lstm.pt'), weights_only=True))
    model.eval()

    encoder = OpponentEncoderNetV3()
    encoder.load_state_dict(torch.load(os.path.join(model_dir, 'opponent_encoder_v3.pt'), weights_only=True))
    encoder.eval()

    # Create a wrapper that takes raw input + LSTM state and returns action outputs + new state
    class LSTMInferenceWrapper(torch.nn.Module):
        def __init__(self, lstm_model, opp_encoder):
            super().__init__()
            self.model = lstm_model
            self.encoder = opp_encoder

        def forward(self, x_t, offered_card, h_in, c_in):
            """
            x_t: (1, 373) — single timestep LSTM input (already encoded)
            offered_card: (1, 6) — card features for draw/buy heads
            h_in: (2, 1, 192) — LSTM hidden state
            c_in: (2, 1, 192) — LSTM cell state
            Returns: draw_prob, discard_logits, buy_prob, h_out, c_out
            """
            out, (h_out, c_out) = self.model.lstm(x_t.unsqueeze(1), (h_in, c_in))
            h_t = out.squeeze(1)  # (1, 192)
            draw_prob = self.model.draw_head_forward(h_t, offered_card)
            discard_logits = self.model.discard_head_forward(h_t)
            buy_prob = self.model.buy_head_forward(h_t, offered_card)
            return draw_prob, discard_logits, buy_prob, h_out, c_out

    wrapper = LSTMInferenceWrapper(model, encoder)
    wrapper.eval()

    # Dummy inputs
    x_t = torch.randn(1, V3_TIMESTEP_INPUT_SIZE)
    offered = torch.randn(1, CARD_FEATURES)
    h_in = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN)
    c_in = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN)

    onnx_path = os.path.join(model_dir, 'shanghai_lstm_v3.onnx')
    torch.onnx.export(
        wrapper,
        (x_t, offered, h_in, c_in),
        onnx_path,
        input_names=['input', 'offered_card', 'h_in', 'c_in'],
        output_names=['draw_prob', 'discard_logits', 'buy_prob', 'h_out', 'c_out'],
        dynamic_axes={
            'input': {0: 'batch'},
            'offered_card': {0: 'batch'},
        },
        opset_version=17,
    )
    log.info(f"Exported LSTM v3 to {onnx_path}")
    log.info(f"  Size: {os.path.getsize(onnx_path) / 1024:.0f} KB")
```

- [ ] **Step 2: Wire into argparse**

Add `--v3` flag and route to `export_v3()`.

- [ ] **Step 3: Commit**

```bash
cd D:/shanghai-tracker && git add ml/training/export_model.py && git commit -m "feat(ml): add v3 ONNX export with explicit LSTM state I/O"
```

---

## Task 10: End-to-End Pipeline Test

This is the integration test — run the full pipeline on a tiny dataset to verify everything connects.

- [ ] **Step 1: Generate a small test dataset**

Command for user to run:

```
cd D:/shanghai-tracker/ml/training && python generate_data.py --v3 --games 10 --output ../data/sequence_training/test_sequences.json
```

Expected: `test_sequences_10games.json` with ~140 sequences (10 games x 7 rounds x 2 players-ish).

- [ ] **Step 2: Preprocess the test data**

```
cd D:/shanghai-tracker/ml/training && python preprocess.py --v3 --data ../data/sequence_training/test_sequences_10games.json --augment 2
```

Expected: `v3_*.pt` files in `../data/sequence_training/`.

- [ ] **Step 3: Run training for 3 epochs**

```
cd D:/shanghai-tracker/ml/training && python train_sequence.py --data ../data/sequence_training/v3_sequences.pt --epochs 3 --batch-size 4
```

Expected: 3 epochs complete, model saved to `ml/models/shanghai_lstm.pt`.

- [ ] **Step 4: Run evaluation for 5 games**

```
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent the-shark --games 5 --players 4
```

Expected: 5 games complete, results saved. Scores will be bad (untrained model) but the pipeline should not crash.

- [ ] **Step 5: Run all smoke tests**

```
cd D:/shanghai-tracker/ml/training && python -m pytest test_v3.py -v
```

Expected: All tests pass.

- [ ] **Step 6: Commit any fixes from integration testing**

```bash
cd D:/shanghai-tracker && git add -A ml/training/ ml/bridge/ && git commit -m "fix(ml): integration fixes from v3 end-to-end pipeline test"
```

---

## Task 11: Full Training Run

After the pipeline is verified, run the full training.

- [ ] **Step 1: Generate 5,000 games of data**

```
cd D:/shanghai-tracker/ml/training && python generate_data.py --v3 --games 5000 --mixed-opponents
```

Expected runtime: several hours. Output: `../data/sequence_training/sequences_*_5000games.json`.

- [ ] **Step 2: Preprocess with augmentation**

```
cd D:/shanghai-tracker/ml/training && python preprocess.py --v3 --data ../data/sequence_training/sequences_TIMESTAMP_5000games.json --augment 5
```

Expected: ~420K sequences as `v3_*.pt` files.

- [ ] **Step 3: Train for 50 epochs**

```
cd D:/shanghai-tracker/ml/training && python train_sequence.py --data ../data/sequence_training/v3_sequences.pt --epochs 50
```

Monitor `logs/train_sequence.log` for progress.

- [ ] **Step 4: Evaluate against all opponents**

```
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent the-shark --games 100 --players 4
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent the-nemesis --games 100 --players 4
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent random --games 100 --players 4
```

- [ ] **Step 5: Run ablation — temperature sweep**

```
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent the-shark --games 100 --players 4 --temperature 0.7
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent the-shark --games 100 --players 4 --temperature 0.8
cd D:/shanghai-tracker/ml/training && python evaluate_sequence.py --opponent the-shark --games 100 --players 4 --temperature 0.9
```

- [ ] **Step 6: Compare results against targets**

| Opponent | Target | Stretch |
|---|---|---|
| Shark | < 250 avg, > 15% win | < 200 avg, > 20% win |
| Nemesis | < 300 avg, > 10% win | < 250 avg, > 15% win |
| Random | < 150 avg, > 60% win | < 100 avg, > 80% win |

- [ ] **Step 7: Update memory with results**

Document training results and next steps in memory.
