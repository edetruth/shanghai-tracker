# Lay-Down Timing Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Train a binary neural network (`LaydownNet`) that decides whether player 0 should lay down melds immediately or wait one turn, replacing the current greedy "always go down" policy.

**Architecture:** Add `laydown_hook` to the Python game engine; extend `collect_data.py` with a 174-dim lay-down state vector; collect ~14K PIMC-labeled records; train a 2×128 binary classifier; wire it into the bridge evaluator via a `meld_hook` callback in `get_strategic_actions`.

**Tech Stack:** Python 3, PyTorch, NumPy, existing `ml/pimc/engine.py` PIMC infrastructure, TypeScript game bridge via `ml/training/shanghai_env.py`.

---

## File Map

| File | Change |
|------|--------|
| `ml/pimc/engine.py` | Add `laydown_hook` param to `play_round` and `play_game` |
| `ml/pimc/collect_data.py` | Add `LAYDOWN_STATE_DIM`, `build_laydown_state_vec()` |
| `ml/pimc/laydown_net.py` | **New** — `LaydownNet` class |
| `ml/pimc/collect_laydown_data.py` | **New** — 2-branch PIMC collection script |
| `ml/pimc/train_laydown_net.py` | **New** — training script |
| `ml/training/shanghai_env.py` | Add `meld_hook` param to `get_strategic_actions` |
| `ml/pimc/network_bridge_eval.py` | Add `LaydownHook`, `--no-laydown` flag |

---

## Background: key engine functions

```
engine.py important internals used in Tasks 1–2:
  find_meld_assignment(hand, req_sets, req_runs) -> (meld_idx, rem_idx) | None
  _build_table_melds(meld_cards, req_sets, req_runs) -> list
  _lay_off_greedy(hand, table_melds) -> None   (mutates hand in place)
  ROUND_REQS: list of (req_sets, req_runs) per round index
  make_deck(deck_count) -> list of card ints
  CARDS_DEALT: list of hand sizes per round index
  JOKER_INT = 64
```

The lay-down block in `engine.py:play_round` currently lives at lines 676–694 and always lays down immediately when `find_meld_assignment` returns a valid assignment.

---

## Task 1: Add `laydown_hook` to engine

**Files:**
- Modify: `ml/pimc/engine.py:572-580` (play_round signature)
- Modify: `ml/pimc/engine.py:676-694` (lay-down block)
- Modify: `ml/pimc/engine.py:820-851` (play_game signature + call)

- [ ] **Step 1: Add `laydown_hook=None` param to `play_round`**

Replace the current `play_round` signature (lines 572–580):

```python
def play_round(
    round_idx: int,
    n_players: int,
    rng: random.Random,
    deck_count: int = DECK_COUNT,
    initial_hands: Optional[list] = None,
    discard_hook=None,
    draw_hook=None,
    laydown_hook=None,
) -> list:
    """Simulate one complete round. Returns list of scores per player.

    Rollout policy:
      - Active player takes top discard if it matches a rank in hand (free take)
        OR continues a same-suit sequence already in hand.
      - Otherwise draws from the draw pile.
      - After each discard: player p+1 gets first free-take right; then players
        p+2..p+n-1 may BUY (take discard + penalty draw, costs 1 of 5 buys).
      - Greedy go-down: lay down as soon as requirement is met (unless laydown_hook
        returns False).
      - Greedy discard: prefer high-value singleton-rank cards; never discard jokers.

    laydown_hook: Optional callable(player_idx, hand, assignment, round_idx,
                  has_laid_down_list) -> bool | None.
                  Return False to skip laying down this turn; None or True = go down.
                  Called only when a valid meld assignment is found.
    """
```

- [ ] **Step 2: Update the lay-down block to call the hook**

Replace the lay-down block at lines 676–694 with:

```python
            # ── Try to go down ────────────────────────────────
            if not has_laid_down[p]:
                assignment = find_meld_assignment(hand, req_sets, req_runs)
                if assignment is not None:
                    # Ask hook; None or True = go down; False = skip this turn
                    should_down = True
                    if laydown_hook is not None:
                        decision = laydown_hook(p, hand, assignment, round_idx,
                                                has_laid_down)
                        if decision is False:
                            should_down = False
                    if should_down:
                        meld_idx, rem_idx = assignment
                        meld_cards = [hand[i] for i in meld_idx]
                        hands[p] = [hand[i] for i in rem_idx]
                        hand = hands[p]
                        has_laid_down[p] = True

                        new_melds = _build_table_melds(meld_cards, req_sets, req_runs)
                        table_melds.extend(new_melds)

                        if table_melds and hand:
                            _lay_off_greedy(hand, table_melds)

                        if not hand:
                            winner = p
                            break
```

- [ ] **Step 3: Add `laydown_hook` to `play_game` signature and call**

Replace lines 820–851 with:

```python
def play_game(
    n_players: int = 4,
    rng: Optional[random.Random] = None,
    deck_count: int = DECK_COUNT,
    starting_round: int = 0,
    initial_scores: Optional[list] = None,
    initial_hands: Optional[list] = None,
    discard_hook=None,
    draw_hook=None,
    laydown_hook=None,
) -> list:
    """Simulate rounds starting_round..6. Returns cumulative scores per player.

    Args:
        starting_round:  First round to simulate (0-6). Default 0 = full game.
        initial_scores:  Scores accumulated before starting_round. Default zeros.
        initial_hands:   If set, used as dealt hands only for starting_round.
                         (Subsequent rounds deal fresh.) For PIMC rollouts.
        discard_hook:    Optional callable(player_idx, hand, has_laid_down,
                         table_melds, round_idx) -> card_int | None.
        draw_hook:       Optional callable(player_idx, hand, discard_top,
                         has_laid_down, round_idx) -> 'take' | 'draw' | None.
        laydown_hook:    Optional callable(player_idx, hand, assignment, round_idx,
                         has_laid_down_list) -> bool | None.
                         Return False to skip laying down this turn.
    """
    if rng is None:
        rng = random.Random()
    scores = list(initial_scores) if initial_scores is not None else [0] * n_players
    for round_idx in range(starting_round, 7):
        ih = initial_hands if round_idx == starting_round else None
        for p, s in enumerate(
            play_round(round_idx, n_players, rng, deck_count, ih,
                       discard_hook, draw_hook, laydown_hook)
        ):
            scores[p] += s
    return scores
```

- [ ] **Step 4: Smoke-test the engine change**

Run from `ml/pimc/`:
```bash
python -c "
from engine import play_game
import random

# Hook that NEVER lays down — scores should be much higher than greedy
class NeverDown:
    def __call__(self, p, hand, assignment, round_idx, hld):
        return False if p == 0 else None

rng = random.Random(42)
scores_greedy = [play_game(4, random.Random(i)) for i in range(50)]
scores_never  = [play_game(4, random.Random(i), laydown_hook=NeverDown()) for i in range(50)]

import statistics
print('greedy p0 avg:', statistics.mean(s[0] for s in scores_greedy))
print('never-down p0 avg:', statistics.mean(s[0] for s in scores_never))
assert statistics.mean(s[0] for s in scores_never) > statistics.mean(s[0] for s in scores_greedy), \
    'Never-down should score worse than greedy'
print('PASS')
"
```

Expected output: `never-down p0 avg` is significantly higher (worse) than `greedy p0 avg`. Both should print, then `PASS`.

- [ ] **Step 5: Commit**

```bash
git add ml/pimc/engine.py
git commit -m "feat(engine): add laydown_hook param to play_round / play_game"
```

---

## Task 2: `build_laydown_state_vec` in `collect_data.py`

**Files:**
- Modify: `ml/pimc/collect_data.py` — add imports, `LAYDOWN_STATE_DIM`, `build_laydown_state_vec()`

- [ ] **Step 1: Add engine imports needed by `build_laydown_state_vec`**

Find the existing engine import line in `collect_data.py`:
```python
from engine import play_game, DECK_COUNT, JOKER_INT
```

Replace it with:
```python
from engine import (
    play_game, DECK_COUNT, JOKER_INT,
    ROUND_REQS, _build_table_melds, _lay_off_greedy,
)
```

- [ ] **Step 2: Add `LAYDOWN_STATE_DIM` constant after the existing `STATE_DIM = 170` line**

```python
STATE_DIM         = 170   # existing constant — do not change
LAYDOWN_STATE_DIM = 174   # lay-down state: base 170 + 4 extra features
```

- [ ] **Step 3: Add `build_laydown_state_vec` after the existing `build_state_vec` function**

```python
def build_laydown_state_vec(
    hand: list,
    assignment: tuple,           # (meld_idx, rem_idx) from find_meld_assignment
    round_idx: int,
    has_laid_down_others: list,  # bool per opponent (len = n_players - 1)
    opp_sizes: list,             # estimated hand sizes per opponent (up to 3)
) -> np.ndarray:
    """Build the 174-dim state vector for the lay-down timing decision.

    Extends build_state_vec (170 dims) with 4 extra features at positions 170-173:
      170: n_residual / 12.0       — cards left after meld + immediate layoff
      171: can_go_out_now          — 1.0 if residual == 0
      172: any_opp_laid_down       — 1.0 if any opponent has already gone down
      173: n_meld_cards / 12.0     — cards committed to required melds
    """
    # Base 170 dims (has_laid_down=False since we haven't gone down yet)
    base = build_state_vec(
        hand=hand,
        seen_dict={},
        discard_top=-1,
        round_idx=round_idx,
        has_laid_down=False,
        opp_sizes=opp_sizes,
    )
    v = np.concatenate([base, np.zeros(4, dtype=np.float32)])

    # Extra features
    meld_idx, rem_idx = assignment
    meld_cards   = [hand[i] for i in meld_idx]
    remaining    = [hand[i] for i in rem_idx]
    n_meld_cards = len(meld_idx)

    # Simulate layoff on a copy to find true residual
    req_sets, req_runs = ROUND_REQS[round_idx]
    new_melds  = _build_table_melds(meld_cards, req_sets, req_runs)
    rem_copy   = list(remaining)
    if new_melds:
        _lay_off_greedy(rem_copy, [m[:] for m in new_melds])  # copy melds to avoid mutation

    n_residual = len(rem_copy)

    v[170] = n_residual / 12.0
    v[171] = float(n_residual == 0)
    v[172] = float(any(has_laid_down_others))
    v[173] = n_meld_cards / 12.0
    return v
```

- [ ] **Step 4: Smoke-test the new function**

```bash
python -c "
from engine import find_meld_assignment
from collect_data import build_laydown_state_vec, LAYDOWN_STATE_DIM

# Simulate a round-1 hand that can form 2 sets
# Round 1 req: 2 sets. Use rank 5 (cards: 0x05, 1x05, 2x05) + rank 7 (3 cards) + 4 extra
hand = [0x05, 0x15, 0x25, 0x07, 0x17, 0x27, 0x01, 0x11, 0x21, 0x31]
assignment = find_meld_assignment(hand, 2, 0)
assert assignment is not None, 'Expected valid assignment'

sv = build_laydown_state_vec(
    hand=hand,
    assignment=assignment,
    round_idx=0,
    has_laid_down_others=[False, False, False],
    opp_sizes=[10, 10, 10],
)
assert sv.shape == (LAYDOWN_STATE_DIM,), f'Expected {LAYDOWN_STATE_DIM} dims, got {sv.shape}'
assert sv.dtype.kind == 'f', 'Expected float32'
assert sv[172] == 0.0, 'No opponents down yet'
print(f'State dim: {sv.shape[0]}')
print(f'n_residual feature (v[170]*12): {sv[170]*12:.0f}')
print(f'can_go_out_now (v[171]): {sv[171]}')
print(f'any_opp_laid_down (v[172]): {sv[172]}')
print(f'n_meld_cards feature (v[173]*12): {sv[173]*12:.0f}')
print('PASS')
"
```

Expected: `State dim: 174`, `PASS`.

- [ ] **Step 5: Commit**

```bash
git add ml/pimc/collect_data.py
git commit -m "feat(pimc): add build_laydown_state_vec (174-dim) to collect_data"
```

---

## Task 3: `LaydownNet`

**Files:**
- Create: `ml/pimc/laydown_net.py`

- [ ] **Step 1: Create `laydown_net.py`**

```python
"""
LaydownNet — binary classifier for lay-down timing decisions.

Predicts whether player 0 should lay down melds immediately (1) or wait
one turn (0), given a 174-dim lay-down state vector.

Architecture: 174 → 128 → 128 → 1  (BCEWithLogitsLoss)

Usage:
    model = LaydownNet()
    logit = model(state_tensor)           # (B,) raw logit
    pred  = model.predict(state_tensor)   # (B,) int64: 1=lay down, 0=wait
"""

from pathlib import Path

import torch
import torch.nn as nn

_HERE = Path(__file__).parent

# Import state dim from collect_data to keep a single source of truth.
# Inline fallback avoids circular import issues in worker processes.
try:
    from collect_data import LAYDOWN_STATE_DIM
except ImportError:
    LAYDOWN_STATE_DIM = 174


class LaydownNet(nn.Module):
    """
    Small binary MLP for lay-down timing.

    Input:  174-dim lay-down state vector (see build_laydown_state_vec)
    Output: single raw logit (positive = lay down now, negative = wait)
    """

    def __init__(self, input_dim: int = LAYDOWN_STATE_DIM, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (B, 174) or (174,) float32
        Returns:
            logit: (B,) or scalar float32
        """
        single = x.dim() == 1
        if single:
            x = x.unsqueeze(0)
        out = self.net(x).squeeze(-1)   # (B,)
        return out.squeeze(0) if single else out

    @torch.no_grad()
    def predict(self, x: torch.Tensor) -> torch.Tensor:
        """
        Return 1 (lay down now) or 0 (wait) for each sample.

        Args:
            x: (B, 174) or (174,) float32
        Returns:
            (B,) or scalar int64
        """
        return (self.forward(x) > 0).long()
```

- [ ] **Step 2: Smoke-test `LaydownNet`**

```bash
python -c "
import torch
from laydown_net import LaydownNet, LAYDOWN_STATE_DIM

model = LaydownNet()
n_params = sum(p.numel() for p in model.parameters())
print(f'Parameters: {n_params:,}')
assert LAYDOWN_STATE_DIM == 174

# Single sample
x1 = torch.randn(174)
out1 = model(x1)
assert out1.shape == torch.Size([]), f'Expected scalar, got {out1.shape}'
pred1 = model.predict(x1)
assert pred1.item() in (0, 1), f'Expected 0 or 1, got {pred1}'

# Batch
x_batch = torch.randn(32, 174)
out_batch = model(x_batch)
assert out_batch.shape == (32,), f'Expected (32,), got {out_batch.shape}'
pred_batch = model.predict(x_batch)
assert pred_batch.shape == (32,)
assert set(pred_batch.tolist()).issubset({0, 1})

print(f'Single forward: {out1.item():.3f} -> predict={pred1.item()}')
print(f'Batch forward: shape={out_batch.shape}')
print('PASS')
"
```

Expected: `Parameters: 35,201` (174×128 + 128 + 128×128 + 128 + 128×1 + 1 = 22272+128+16384+128+128+1 = ~35K), `PASS`.

- [ ] **Step 3: Commit**

```bash
git add ml/pimc/laydown_net.py
git commit -m "feat(pimc): add LaydownNet binary classifier for lay-down timing"
```

---

## Task 4: `collect_laydown_data.py`

**Files:**
- Create: `ml/pimc/collect_laydown_data.py`

- [ ] **Step 1: Create `collect_laydown_data.py`**

```python
"""
Lay-down timing data collector.

For each game, whenever player 0 has a valid meld assignment, runs two
PIMC branches to generate a binary label:
  Branch A: lay down now  (N=10 rollouts) -> mean_score_A
  Branch B: skip one turn (N=10 rollouts) -> mean_score_B
  label = 1 if mean_score_A < mean_score_B (lay down now is better)

Players 1-3 use network_v3.pt for discard decisions (same as data_v2).
Player 0 uses greedy discard during collection (only lay-down labels recorded).

Output: ml/pimc/data_laydown/  (NPZ chunks of 1000 records)

Usage:
    python collect_laydown_data.py --games 2000 --opponent-model models/network_v3.pt
    python collect_laydown_data.py --games 2000 --opponent-model models/network_v3.pt --resume
"""

import argparse
import json
import os
import random
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from engine import (
    play_game, DECK_COUNT, CARDS_DEALT, make_deck,
    find_meld_assignment, ROUND_REQS,
)
from collect_data import (
    build_laydown_state_vec, build_state_vec, _ctype,
    LAYDOWN_STATE_DIM,
    _load_progress, _save_progress,
)
from collect_data_v2 import _get_worker_model
from evaluate_pimc import _Tee, _setup_logging


# ── Skip-once hook ────────────────────────────────────────────────

class _SkipOnceLaydownHook:
    """Returns False on the first lay-down opportunity for player 0, then None."""

    def __init__(self):
        self._skipped = False

    def __call__(self, player_idx, hand, assignment, round_idx, has_laid_down_list):
        if player_idx != 0:
            return None  # greedy for opponents
        if not self._skipped:
            self._skipped = True
            return False   # skip this turn
        return None        # greedy from here on


# ── Opponent hand sampler ─────────────────────────────────────────

def _sample_opponents(p0_hand: list, n_players: int, round_idx: int,
                      rng: random.Random) -> list:
    """Sample n_players-1 opponent hands from cards not in player 0's hand."""
    n_cards  = CARDS_DEALT[round_idx]
    deck     = make_deck(DECK_COUNT)
    p0_cnt   = Counter(p0_hand)
    remaining = []
    for c in deck:
        if p0_cnt.get(c, 0) > 0:
            p0_cnt[c] -= 1
        else:
            remaining.append(c)

    rng.shuffle(remaining)
    hands = []
    pos = 0
    for _ in range(n_players - 1):
        hands.append(remaining[pos: pos + n_cards])
        pos += n_cards
    return hands


# ── NPZ chunk writer (lay-down specific) ─────────────────────────

class _LaydownChunkWriter:
    CHUNK_SIZE = 1_000

    def __init__(self, out_dir: Path):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._states:  list = []
        self._labels:  list = []
        self._rounds:  list = []
        self._chunk_n: int  = self._next_chunk_n()

    def _next_chunk_n(self) -> int:
        existing = sorted(self.out_dir.glob("chunk_*.npz"))
        return int(existing[-1].stem.split("_")[1]) + 1 if existing else 0

    def add(self, state: np.ndarray, label: int, round_idx: int) -> None:
        self._states.append(state)
        self._labels.append(label)
        self._rounds.append(round_idx)
        if len(self._states) >= self.CHUNK_SIZE:
            self._flush()

    def _flush(self) -> None:
        if not self._states:
            return
        path = self.out_dir / f"chunk_{self._chunk_n:04d}.npz"
        np.savez_compressed(
            path,
            states=np.array(self._states,  dtype=np.float32),
            labels=np.array(self._labels,  dtype=np.int8),
            round_idx=np.array(self._rounds, dtype=np.int8),
        )
        n = len(self._states)
        print(f"    chunk {self._chunk_n:04d}  {n:,} records -> {path.name}", flush=True)
        self._states.clear()
        self._labels.clear()
        self._rounds.clear()
        self._chunk_n += 1

    def close(self) -> None:
        self._flush()


# ── Game worker ───────────────────────────────────────────────────

def _run_one_game_laydown(args: tuple) -> list:
    """
    Play one game; record lay-down decisions for player 0.

    Returns list of dicts: {state: np.ndarray, label: int, round_idx: int}
    """
    game_seed, agent_seed, n_rollouts, n_players, model_path_str = args

    import sys as _sys, os as _os
    _here = _os.path.dirname(_os.path.abspath(__file__))
    if _here not in _sys.path:
        _sys.path.insert(0, _here)

    import random as _random
    import numpy as _np
    from collections import Counter as _Counter
    from engine import (
        play_game as _play_game, DECK_COUNT as _DC, CARDS_DEALT as _CD,
        make_deck as _make_deck, find_meld_assignment as _fma, ROUND_REQS as _RR,
    )
    from collect_data import (
        build_laydown_state_vec as _bsv_ld,
        build_state_vec as _bsv,
        _ctype as _ct,
    )

    model    = _get_worker_model(model_path_str)
    game_rng = _random.Random(game_seed)
    agent_rng = _random.Random(agent_seed)
    records: list = []

    def _laydown_hook(player_idx, hand, assignment, round_idx, has_laid_down_list):
        if player_idx != 0:
            return None  # greedy for opponents

        # Build state vector
        opp_sizes = [_CD[round_idx]] * (n_players - 1)
        has_ld_others = list(has_laid_down_list[1:])
        sv = _bsv_ld(
            hand=hand,
            assignment=assignment,
            round_idx=round_idx,
            has_laid_down_others=has_ld_others,
            opp_sizes=opp_sizes,
        )

        # Sample opponent hands for PIMC rollouts
        n_cards   = _CD[round_idx]
        deck      = _make_deck(_DC)
        p0_cnt    = _Counter(hand)
        remaining = []
        for c in deck:
            if p0_cnt.get(c, 0) > 0:
                p0_cnt[c] -= 1
            else:
                remaining.append(c)
        agent_rng.shuffle(remaining)
        opp_hands = [remaining[i * n_cards: (i + 1) * n_cards]
                     for i in range(n_players - 1)]
        all_hands = [list(hand)] + opp_hands

        # Branch A: lay down immediately (greedy — no laydown_hook)
        scores_a = []
        for _ in range(n_rollouts):
            rs = _random.Random(agent_rng.randint(0, 2 ** 31 - 1))
            s  = _play_game(n_players, rs, _DC,
                             starting_round=round_idx,
                             initial_hands=[list(h) for h in all_hands])
            scores_a.append(s[0])

        # Branch B: skip one turn
        scores_b = []
        for _ in range(n_rollouts):
            rs   = _random.Random(agent_rng.randint(0, 2 ** 31 - 1))
            skip = _SkipOnceLaydownHook()
            s    = _play_game(n_players, rs, _DC,
                               starting_round=round_idx,
                               initial_hands=[list(h) for h in all_hands],
                               laydown_hook=skip)
            scores_b.append(s[0])

        label = int(_np.mean(scores_a) < _np.mean(scores_b))
        records.append({"state": sv, "label": label, "round_idx": round_idx})
        return True  # always lay down in actual game

    def _combined_discard(player_idx, hand, has_laid_down, table_melds, round_idx):
        if player_idx == 0:
            return None  # greedy discard for player 0
        # Opponents use network
        import torch as _torch
        opp_sizes = [_CD[round_idx]] * (n_players - 1)
        sv        = _bsv(hand=hand, seen_dict={}, discard_top=-1,
                         round_idx=round_idx, has_laid_down=has_laid_down,
                         opp_sizes=opp_sizes)
        state_t   = _torch.from_numpy(sv).unsqueeze(0)
        type_idx  = int(model.predict_discard(state_t).item())
        for c in hand:
            if _ct(c) == type_idx:
                return c
        return None

    _play_game(
        n_players,
        game_rng,
        _DC,
        discard_hook=_combined_discard,
        laydown_hook=_laydown_hook,
    )
    return records


# ── Collection loop ───────────────────────────────────────────────

def run_collection(
    n_games: int,
    n_rollouts: int,
    n_players: int,
    n_workers: int,
    seed: int,
    resume: bool,
    opponent_model: str,
) -> None:
    from concurrent.futures import ProcessPoolExecutor, as_completed

    out_dir = _HERE / "data_laydown"
    out_dir.mkdir(exist_ok=True)

    prog            = _load_progress(out_dir) if resume else {"games_completed": 0, "records_written": 0}
    games_done      = prog["games_completed"]
    records_written = prog["records_written"]
    remaining       = n_games - games_done

    if remaining <= 0:
        print(f"Already have {games_done} games. Increase --games to collect more.")
        return

    if games_done:
        print(f"Resuming: {games_done} done, {remaining} remaining "
              f"({records_written:,} records so far)\n")

    writer  = _LaydownChunkWriter(out_dir)
    rng     = random.Random(seed)
    for _ in range(games_done * 2):   # advance past completed games
        rng.randint(0, 2 ** 31 - 1)

    game_args = [
        (rng.randint(0, 2 ** 31 - 1), rng.randint(0, 2 ** 31 - 1),
         n_rollouts, n_players, opponent_model)
        for _ in range(remaining)
    ]

    t_start   = time.perf_counter()
    completed = 0

    with ProcessPoolExecutor(max_workers=n_workers) as pool:
        futs = {pool.submit(_run_one_game_laydown, ga): i for i, ga in enumerate(game_args)}

        for fut in as_completed(futs):
            recs = fut.result()
            for rec in recs:
                writer.add(rec["state"], rec["label"], rec["round_idx"])

            completed      += 1
            games_done     += 1
            records_written += len(recs)

            elapsed = time.perf_counter() - t_start
            rate    = completed / elapsed
            eta_h   = (remaining - completed) / rate / 3600 if rate > 0 else 0.0
            print(
                f"  game {games_done:5d}/{n_games}"
                f"  records={records_written:,}"
                f"  {rate:.2f}g/s"
                f"  ETA {eta_h:.1f}h",
                flush=True,
            )

            if completed % 100 == 0:
                _save_progress(out_dir, games_done, records_written)

    writer.close()
    _save_progress(out_dir, games_done, records_written)

    elapsed = time.perf_counter() - t_start
    print(f"\nDone. {games_done} games, {records_written:,} records in {elapsed / 3600:.2f}h")

    # Summary
    chunks = sorted(out_dir.glob("chunk_*.npz"))
    label_counts = {0: 0, 1: 0}
    for p in chunks:
        d = np.load(p)
        for lbl in d["labels"]:
            label_counts[int(lbl)] += 1
    total = sum(label_counts.values())
    print(f"\nDataset summary ({len(chunks)} chunks, {total:,} records):")
    print(f"  Label 0 (wait)        : {label_counts[0]:,}  ({label_counts[0]/max(total,1):.1%})")
    print(f"  Label 1 (lay down now): {label_counts[1]:,}  ({label_counts[1]/max(total,1):.1%})")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()
    parser = argparse.ArgumentParser(
        description="Collect lay-down timing data via 2-branch PIMC"
    )
    parser.add_argument("--games",          type=int, default=2000)
    parser.add_argument("--rollouts",       type=int, default=10,
                        help="PIMC rollouts per branch per decision (default 10)")
    parser.add_argument("--players",        type=int, default=4)
    parser.add_argument("--workers",        type=int, default=os.cpu_count())
    parser.add_argument("--seed",           type=int, default=42)
    parser.add_argument("--resume",         action="store_true")
    parser.add_argument("--opponent-model", type=str,
                        default=str(_HERE / "models" / "network_v3.pt"))
    args = parser.parse_args()

    if not Path(args.opponent_model).exists():
        print(f"ERROR: opponent model not found: {args.opponent_model}",
              file=sys.stderr)
        sys.exit(1)

    print("Lay-Down Timing Data Collector")
    print(f"  Games          : {args.games}")
    print(f"  Rollouts/branch: {args.rollouts}  (2x per decision = {args.rollouts * 2} total)")
    print(f"  State dim      : {LAYDOWN_STATE_DIM}")
    print(f"  Opponent model : {Path(args.opponent_model).name}")
    print(f"  Workers        : {args.workers}")
    print(f"  Output         : ml/pimc/data_laydown/")
    print()

    run_collection(
        args.games, args.rollouts, args.players,
        args.workers, args.seed, args.resume,
        opponent_model=args.opponent_model,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Quick smoke-test (1 game)**

Run from `ml/pimc/`:
```bash
python collect_laydown_data.py --games 1 --rollouts 5 --workers 1 --opponent-model models/network_v3.pt
```

Expected: runs without error, prints progress line with `records=N` where N > 0 (typically 5–10 lay-down records per game). A `data_laydown/` directory is created with at least one record.

- [ ] **Step 3: Commit**

```bash
git add ml/pimc/collect_laydown_data.py
git commit -m "feat(pimc): add collect_laydown_data.py — 2-branch PIMC lay-down labeling"
```

---

## Task 5: `train_laydown_net.py`

**Files:**
- Create: `ml/pimc/train_laydown_net.py`

- [ ] **Step 1: Create `train_laydown_net.py`**

```python
"""
Train LaydownNet binary classifier on lay-down timing data.

Input:  ml/pimc/data_laydown/  (NPZ chunks from collect_laydown_data.py)
Output: ml/pimc/models/laydown_net.pt

Usage:
    python train_laydown_net.py
    python train_laydown_net.py --epochs 50
    python train_laydown_net.py --data-dir data_laydown_custom
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

_HERE     = Path(__file__).parent
MODEL_DIR = _HERE / "models"


def load_dataset(data_dir: Path):
    """Load all NPZ chunks. Returns (states, labels, rounds) numpy arrays."""
    chunks = sorted(data_dir.glob("chunk_*.npz"))
    if not chunks:
        raise FileNotFoundError(f"No chunks found in {data_dir}")

    states_list, labels_list, rounds_list = [], [], []
    for p in chunks:
        d = np.load(p)
        states_list.append(d["states"])
        labels_list.append(d["labels"])
        rounds_list.append(d["round_idx"])

    states = np.concatenate(states_list, axis=0)
    labels = np.concatenate(labels_list, axis=0).astype(np.int8)
    rounds = np.concatenate(rounds_list, axis=0).astype(np.int8)

    n_pos = int((labels == 1).sum())
    n_neg = int((labels == 0).sum())
    print(f"  Loaded {len(states):,} records from {len(chunks)} chunks")
    print(f"  Label 1 (lay down now): {n_pos:,}  ({n_pos/len(labels):.1%})")
    print(f"  Label 0 (wait)        : {n_neg:,}  ({n_neg/len(labels):.1%})")
    return states, labels, rounds


def train(args) -> None:
    from laydown_net import LaydownNet, LAYDOWN_STATE_DIM

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    data_dir = _HERE / args.data_dir
    out_path = MODEL_DIR / args.out

    print(f"Loading dataset from {data_dir} ...")
    t0                 = time.perf_counter()
    states, labels, rounds = load_dataset(data_dir)
    print(f"  Loaded in {time.perf_counter() - t0:.1f}s\n")

    # Train / val split (90/10)
    rng    = torch.Generator().manual_seed(args.seed)
    n      = len(states)
    idx    = torch.randperm(n, generator=rng)
    n_val  = int(n * 0.1)
    val_idx, train_idx = idx[:n_val], idx[n_val:]

    s_t = torch.from_numpy(states).float()
    l_t = torch.from_numpy(labels.astype(np.float32))   # BCE expects float
    r_t = torch.from_numpy(rounds.astype(np.int64))

    train_ds = TensorDataset(s_t[train_idx], l_t[train_idx], r_t[train_idx])
    val_ds   = TensorDataset(s_t[val_idx],   l_t[val_idx],   r_t[val_idx])

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,  num_workers=0)
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False, num_workers=0)

    # Class imbalance: weight the loss so both classes contribute equally
    n_pos     = float((labels == 1).sum())
    n_neg     = float((labels == 0).sum())
    pos_weight = torch.tensor([n_neg / max(n_pos, 1)])   # scalar tensor

    model    = LaydownNet(input_dim=LAYDOWN_STATE_DIM, hidden=args.hidden)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model: LaydownNet  params={n_params:,}  hidden={args.hidden}")
    print(f"  pos_weight={pos_weight.item():.3f}  (neg/pos ratio)")

    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.01
    )

    best_val_loss = float("inf")
    patience_left = args.patience

    print(f"\n{'Epoch':>5} {'TrLoss':>8} {'TrAcc':>8} {'VaLoss':>8} {'VaAcc':>8}")
    print("-" * 46)

    for epoch in range(1, args.epochs + 1):
        model.train()
        tr_loss = tr_acc_sum = tr_n = 0.0

        for states_b, labels_b, _ in train_loader:
            logits = model(states_b)
            loss   = criterion(logits, labels_b)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            preds       = (logits > 0).float()
            b           = states_b.shape[0]
            tr_loss    += loss.item()
            tr_acc_sum += (preds == labels_b).float().mean().item() * b
            tr_n       += b

        scheduler.step()

        # Validation
        model.eval()
        va_loss = va_acc_sum = va_n = 0.0
        with torch.no_grad():
            for states_b, labels_b, _ in val_loader:
                logits     = model(states_b)
                loss       = criterion(logits, labels_b)
                preds      = (logits > 0).float()
                b          = states_b.shape[0]
                va_loss   += loss.item()
                va_acc_sum += (preds == labels_b).float().mean().item() * b
                va_n      += b

        tr_loss_avg = tr_loss / len(train_loader)
        va_loss_avg = va_loss / len(val_loader)
        tr_acc      = tr_acc_sum / tr_n
        va_acc      = va_acc_sum / va_n
        print(f"{epoch:5d} {tr_loss_avg:8.4f} {tr_acc:8.3%} {va_loss_avg:8.4f} {va_acc:8.3%}")

        if va_loss_avg < best_val_loss:
            best_val_loss  = va_loss_avg
            patience_left  = args.patience
            torch.save(model.state_dict(), out_path)
            print(f"  -> saved (val_loss={best_val_loss:.4f}  acc={va_acc:.1%})")
        else:
            patience_left -= 1
            if patience_left <= 0:
                print(f"  Early stop (patience={args.patience})")
                break

    print(f"\nBest model: val_loss={best_val_loss:.4f}")
    print(f"Saved: {out_path}")

    # Per-round accuracy breakdown
    print("\nPer-round val accuracy (best model):")
    saved_state = torch.load(out_path, map_location="cpu", weights_only=True)
    model.load_state_dict(saved_state)
    model.eval()
    round_stats: dict = {}
    with torch.no_grad():
        for states_b, labels_b, rounds_b in val_loader:
            logits = model(states_b)
            preds  = (logits > 0).float()
            correct = (preds == labels_b).float()
            for i in range(len(rounds_b)):
                ri = int(rounds_b[i].item())
                if ri not in round_stats:
                    round_stats[ri] = [0, 0]
                round_stats[ri][0] += correct[i].item()
                round_stats[ri][1] += 1

    print(f"   {'Round':>8}  {'Acc':>8}  {'N':>8}")
    for ri in sorted(round_stats):
        corr, total_r = round_stats[ri]
        print(f"  Round {ri+1:2d}:  {corr/total_r:6.1%}  ({total_r:5d})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train LaydownNet")
    parser.add_argument("--data-dir",   type=str, default="data_laydown")
    parser.add_argument("--out",        type=str, default="laydown_net.pt")
    parser.add_argument("--epochs",     type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--hidden",     type=int, default=128)
    parser.add_argument("--lr",         type=float, default=3e-4)
    parser.add_argument("--patience",   type=int, default=8)
    parser.add_argument("--seed",       type=int, default=42)
    args = parser.parse_args()

    train(args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test training on synthetic data**

Run from `ml/pimc/`:
```bash
python -c "
import numpy as np
from pathlib import Path

# Generate 50 synthetic records (enough for a quick smoke test)
Path('data_laydown_test').mkdir(exist_ok=True)
rng = np.random.default_rng(42)
states = rng.random((50, 174), dtype=np.float32)
labels = rng.integers(0, 2, size=50, dtype=np.int8)
rounds = rng.integers(0, 7, size=50, dtype=np.int8)
np.savez_compressed('data_laydown_test/chunk_0000.npz',
    states=states, labels=labels, round_idx=rounds)
print('Synthetic data created.')
"
python train_laydown_net.py --data-dir data_laydown_test --epochs 3 --out /tmp/laydown_test.pt
```

Expected: runs 3 epochs, prints loss/accuracy table, saves model. No crash.

- [ ] **Step 3: Clean up test data**

```bash
python -c "import shutil; shutil.rmtree('ml/pimc/data_laydown_test', ignore_errors=True)"
```

Or manually delete `ml/pimc/data_laydown_test/`.

- [ ] **Step 4: Commit**

```bash
git add ml/pimc/train_laydown_net.py
git commit -m "feat(pimc): add train_laydown_net.py — binary classifier training script"
```

---

## Task 6: `shanghai_env.py` — `meld_hook` support

**Files:**
- Modify: `ml/training/shanghai_env.py:116-163`

- [ ] **Step 1: Add `meld_hook` parameter to `get_strategic_actions`**

Replace the `get_strategic_actions` method (lines 116–163) with:

```python
def get_strategic_actions(self, meld_hook=None) -> tuple:
    """Get only strategic actions (draw/discard/buy). Auto-execute meld/layoff.

    Melds and layoffs are always executed first (they're almost always
    correct), then the remaining strategic actions are returned for the
    agent to choose from. This keeps the state machine simple: the agent
    never has to handle meld/layoff bookkeeping.

    meld_hook: Optional callable() -> bool.  Called when current_player == 0
    has a 'meld' action available and meld_hook is not None.
    Return False to SKIP meld for player 0 this turn (lay-down timing).
    Return True or None → execute meld as usual.

    Returns (actions, current_player, state) where state is the updated
    state vector after any auto-executed mechanical actions.
    """
    max_auto = 50  # safety cap to prevent infinite loops
    auto_count = 0
    latest_state = None
    while auto_count < max_auto:
        actions, current_player = self.get_valid_actions()
        if not actions:
            return [], current_player, latest_state

        # Always auto-execute mechanical actions (meld/layoff) first,
        # regardless of whose turn it is. This keeps the random/rule-based
        # opponent behavior symmetric with the agent's behavior.
        mechanical = [a for a in actions if a == "meld" or a.startswith("layoff:")]
        if mechanical:
            if "meld" in mechanical:
                # For player 0: ask meld_hook before auto-executing
                if meld_hook is not None and current_player == 0:
                    if meld_hook() is False:
                        # Hook said skip — remove meld, return strategic actions
                        actions_no_meld = [a for a in actions if a != "meld"]
                        strategic = [
                            a for a in actions_no_meld
                            if a in ("draw_pile", "take_discard", "buy", "decline_buy")
                            or a.startswith("discard:")
                        ]
                        if strategic:
                            return strategic, current_player, latest_state
                        return actions_no_meld, current_player, latest_state
                latest_state, _, _, _ = self.step("meld")
            else:
                latest_state, _, _, _ = self.step(mechanical[0])
            auto_count += 1
            continue  # Re-check: more melds/layoffs may now be available

        # No mechanical actions left — return strategic ones.
        strategic = [
            a for a in actions
            if a in ("draw_pile", "take_discard", "buy", "decline_buy")
            or a.startswith("discard:")
        ]
        if strategic:
            return strategic, current_player, latest_state

        # Fallback: return whatever the bridge gave us
        return actions, current_player, latest_state

    # Safety: return whatever we have after max iterations
    actions, current_player = self.get_valid_actions()
    return actions, current_player, latest_state
```

- [ ] **Step 2: Verify existing bridge eval still works (no regression)**

Run a quick 5-game eval:
```bash
cd ml/pimc && python network_bridge_eval.py --model network_v3.pt --discard-only --games 5 --opponent the-mastermind
```

Expected: 5 games complete, scores printed, no crash. Win rate and scores should be similar to previous runs (~170–190 range).

- [ ] **Step 3: Commit**

```bash
git add ml/training/shanghai_env.py
git commit -m "feat(env): add meld_hook param to get_strategic_actions for lay-down timing"
```

---

## Task 7: Wire up `LaydownHook` in `network_bridge_eval.py`

**Files:**
- Modify: `ml/pimc/network_bridge_eval.py`

Background: `network_bridge_eval.py` currently imports and uses `NetworkHook` for discard decisions. The `LaydownHook` is a no-arg callable that `get_strategic_actions` calls when player 0 has a meld opportunity. Internally it:
1. Calls `env.get_full_state()` to get the hand and round
2. Calls `find_meld_assignment` (from `engine.py`) to get the assignment
3. Builds the lay-down state vector via `build_laydown_state_vec`
4. Calls `LaydownNet.predict(state_vec)` → 1 (meld) or 0 (skip)

- [ ] **Step 1: Add imports and `LaydownHook` class**

After the existing imports block in `network_bridge_eval.py`, add:

```python
from engine import find_meld_assignment, ROUND_REQS, CARDS_DEALT as _CARDS_DEALT_LD
from collect_data import build_laydown_state_vec, LAYDOWN_STATE_DIM

# LaydownNet imported lazily (only if laydown_net.pt exists)
```

Add the `LaydownHook` class after the existing `NetworkHook` class:

```python
class LaydownHook:
    """
    Wraps LaydownNet as a no-arg callable for use with get_strategic_actions(meld_hook=).

    Called when player 0 has a meld opportunity. Fetches full state from the
    bridge, reconstructs the lay-down state vector, and returns True/False.
    """

    def __init__(self, model, env, n_players: int):
        self._model    = model
        self._env      = env
        self._n_players = n_players
        self.decisions  = 0
        self.skipped    = 0

    def __call__(self) -> bool:
        """Return True to lay down now, False to skip this turn."""
        full       = self._env.get_full_state()
        hand_cards = full.get('hand', [])
        hand_ints  = [_ts_to_int(c) for c in hand_cards]
        round_idx  = max(0, full.get('round', 1) - 1)

        # Reconstruct meld assignment using Python engine (mirrors bridge logic)
        req_sets, req_runs = ROUND_REQS[round_idx]
        assignment = find_meld_assignment(hand_ints, req_sets, req_runs)
        if assignment is None:
            return True   # no valid assignment — shouldn't happen; default to meld

        opp_sizes      = [_CARDS_DEALT_LD[round_idx]] * (self._n_players - 1)
        # Approximate: no cross-bridge roundtrip for opponent lay-down status
        has_ld_others  = [False] * (self._n_players - 1)

        sv      = build_laydown_state_vec(
            hand=hand_ints,
            assignment=assignment,
            round_idx=round_idx,
            has_laid_down_others=has_ld_others,
            opp_sizes=opp_sizes,
        )
        state_t = torch.from_numpy(sv).unsqueeze(0)
        pred    = int(self._model.predict(state_t).item())   # 1=meld, 0=skip

        self.decisions += 1
        if pred == 0:
            self.skipped += 1
        return bool(pred)
```

- [ ] **Step 2: Update `run_one_game` to accept and use `laydown_hook`**

Find the `run_one_game` function signature:
```python
def run_one_game(
    env: ShanghaiEnv,
    model: PIMCNet,
    n_players: int,
    seed: int,
    discard_only: bool = False,
) -> tuple:
```

Replace with:
```python
def run_one_game(
    env: ShanghaiEnv,
    model: PIMCNet,
    n_players: int,
    seed: int,
    discard_only: bool = False,
    laydown_hook=None,
) -> tuple:
    """
    Play one game with PIMCNet as player 0.

    Returns:
        (scores list, hook) — hook exposes .decisions and .fallbacks
    """
    env.reset(seed=seed)
    hook = NetworkHook(model=model, player_idx=0, n_players=n_players)

    done   = False
    info   = {}
    step   = 0
    max_steps = 8000

    while not done and step < max_steps:
        step += 1
        actions, current_player, _ = env.get_strategic_actions(
            meld_hook=laydown_hook if current_player == 0 else None
        )
        # ... rest of the function unchanged
```

Wait — `current_player` is returned by `get_strategic_actions` itself, so we can't reference it before calling. Instead pass `laydown_hook` always; `get_strategic_actions` already guards on `current_player == 0` internally. Change to:

```python
        actions, current_player, _ = env.get_strategic_actions(meld_hook=laydown_hook)
```

Apply this change to the single `env.get_strategic_actions()` call inside `run_one_game`.

- [ ] **Step 3: Update `run_evaluation` to pass `laydown_hook`**

Find `run_evaluation` and add `laydown_hook=None` parameter:

```python
def run_evaluation(
    n_games: int,
    n_players: int,
    opponent: str,
    seed: int,
    model: PIMCNet,
    discard_only: bool = False,
    laydown_hook=None,
) -> dict:
```

And pass it through to `run_one_game`:
```python
        scores, hook = run_one_game(env, model, n_players, game_seed,
                                    discard_only, laydown_hook=laydown_hook)
```

- [ ] **Step 4: Update `main()` to load `LaydownNet` and add `--no-laydown` flag**

In `main()`, after loading the discard model, add:

```python
    # ── Load lay-down net (optional) ─────────────────────────────────
    laydown_hook = None
    if not args.no_laydown:
        ld_path = _HERE / "models" / "laydown_net.pt"
        if ld_path.exists():
            from laydown_net import LaydownNet
            ld_model = LaydownNet()
            ld_model.load_state_dict(
                torch.load(ld_path, map_location="cpu", weights_only=True)
            )
            ld_model.eval()
            laydown_hook = LaydownHook(ld_model, env=None, n_players=args.players)
            # env assigned after ShanghaiEnv is created below
            print(f"  LaydownNet loaded: {ld_path.name}")
        else:
            print(f"  LaydownNet not found ({ld_path.name}) — using greedy lay-down")
    else:
        print("  Lay-down timing: greedy (--no-laydown)")
```

After `env = ShanghaiEnv(...)` is created, wire up the env:
```python
    if laydown_hook is not None:
        laydown_hook._env = env
```

Add `--no-laydown` argument in the `argparse` block:
```python
    parser.add_argument("--no-laydown", action="store_true",
                        help="Force greedy lay-down (skip LaydownNet even if present)")
```

Pass `laydown_hook` to `run_evaluation`:
```python
    results = run_evaluation(
        n_games=args.games,
        n_players=args.players,
        opponent=args.opponent,
        seed=args.seed,
        model=model,
        discard_only=args.discard_only,
        laydown_hook=laydown_hook,
    )
```

- [ ] **Step 5: Verify bridge eval still works without `laydown_net.pt` present**

Run from `ml/pimc/`:
```bash
python network_bridge_eval.py --model network_v3.pt --discard-only --games 5 --opponent the-mastermind
```

Expected: prints `LaydownNet not found — using greedy lay-down`, runs 5 games, no crash.

- [ ] **Step 6: Commit**

```bash
git add ml/pimc/network_bridge_eval.py
git commit -m "feat(pimc): wire up LaydownHook in network_bridge_eval — add --no-laydown flag"
```

---

## Usage: full pipeline after implementation

```bash
# Step 1: collect ~14K lay-down records (~2–3h at 10 rollouts, all CPU cores)
cd ml/pimc
python collect_laydown_data.py --games 2000 --rollouts 10 --opponent-model models/network_v3.pt

# Step 2: train
python train_laydown_net.py

# Step 3: eval with laydown net (auto-loads laydown_net.pt)
python network_bridge_eval.py --model network_v3.pt --discard-only --games 50 --opponent the-mastermind

# Step 4: ablation — greedy lay-down baseline for comparison
python network_bridge_eval.py --model network_v3.pt --discard-only --games 50 --opponent the-mastermind --no-laydown
```

---

## Self-Review

**Spec coverage:**
- Engine `laydown_hook`: Task 1 ✓
- `build_laydown_state_vec` (174 dims): Task 2 ✓
- `LaydownNet` architecture: Task 3 ✓
- 2-branch PIMC collection: Task 4 ✓
- Training script with pos_weight: Task 5 ✓
- `get_strategic_actions(meld_hook=)`: Task 6 ✓
- `LaydownHook` + `--no-laydown`: Task 7 ✓

**Type consistency:**
- `laydown_hook(player_idx, hand, assignment, round_idx, has_laid_down_list)` — used in Task 1, Task 4, Task 5 ✓
- `build_laydown_state_vec(hand, assignment, round_idx, has_laid_down_others, opp_sizes)` — defined Task 2, used Task 4 and Task 7 ✓
- `LaydownNet.predict(x)` returns `int64 Tensor` — defined Task 3, used Task 7 ✓
- `meld_hook()` is a no-arg callable — Task 6 and Task 7 ✓
- `LAYDOWN_STATE_DIM = 174` — defined Task 2, imported in Tasks 3, 5, 7 ✓
