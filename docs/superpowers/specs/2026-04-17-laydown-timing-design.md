# Lay-Down Timing Network — Design Spec

> **For agentic workers:** Use superpowers:writing-plans to create the implementation plan from this spec.

**Goal:** Train a small binary neural network to decide *when* to lay down melds in Shanghai Rummy, replacing the current greedy "always go down immediately" policy.

**Approach:** PIMC-labeled separate binary classifier (174-dim input, 2×128 hidden, sigmoid output). Trained on ~14K labeled lay-down opportunities collected via two-branch PIMC rollouts.

---

## Context

The self-play discard network has plateaued at ~173–179 avg score / 70% win rate vs the Mastermind (human avg: 227). All decisions except discard use greedy heuristics. Lay-down timing is the highest-value next lever.

### Current engine behavior

`engine.py:play_round` calls `find_meld_assignment` on every turn. When a valid assignment is found it **always** lays down immediately — no hook, no conditional. The bridge (`shanghai_env.py:get_strategic_actions`) mirrors this: it auto-executes `meld` actions for all players before returning strategic actions to the Python caller.

### Why timing matters

Going down immediately exposes your remaining cards and locks in your meld configuration. Waiting one turn can be better when:
- You are 1–2 cards away from going out entirely
- No opponent has yet laid down (no urgency)
- It is early in the round (many turns remaining)

Waiting is worse when:
- An opponent has already laid down (race to finish)
- Residual cards are many (you will carry them for multiple turns)
- Round ≥ 5 (shorter rounds, higher urgency)

---

## Architecture

### State vector: 174 dims

Extends the existing 170-dim `build_state_vec` with 4 lay-down-specific features appended at positions 170–173:

| Index | Feature | Notes |
|-------|---------|-------|
| 0–52  | Hand card-type counts | Same as discard state |
| 53–105 | Seen card counts | Same as discard state |
| 106–158 | Discard-top one-hot | Always zeros (discard_top=-1 at lay-down time) |
| 159–165 | Round one-hot (0–6) | Same as discard state |
| 166 | has_laid_down | Always 0 (fires before lay-down) |
| 167–169 | Opponent hand sizes / 12 | Same as discard state |
| 170 | n_residual / 12.0 | Cards left after best meld + immediate layoff |
| 171 | can_go_out_now | 1.0 if residual == 0 |
| 172 | any_opp_laid_down | 1.0 if any opponent has_laid_down |
| 173 | n_meld_cards / 12.0 | Cards committed to required melds |

`LAYDOWN_STATE_DIM = 174`

### Network: `LaydownNet`

```python
class LaydownNet(nn.Module):
    def __init__(self, input_dim=174, hidden=128):
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden),    nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def forward(self, x) -> Tensor:          # raw logit, shape (B,)
        return self.net(x).squeeze(-1)

    @torch.no_grad()
    def predict(self, x) -> Tensor:          # 1=lay down now, 0=wait
        return (self.forward(x) > 0).long()
```

Loss: `BCEWithLogitsLoss(pos_weight=...)` — pos_weight computed from training label distribution (expected ~80% label=1).  
Optimizer: Adam lr=3e-4.  
Epochs: 30.  
Saved to: `ml/pimc/models/laydown_net.pt`.

---

## PIMC Labeling

For each lay-down opportunity (player 0 has a valid assignment):

1. **Branch A** — lay down immediately: run `N=10` PIMC rollouts with greedy lay-down → record `mean_score_A`
2. **Branch B** — skip this turn: run `N=10` PIMC rollouts where player 0's lay-down hook returns `False` on the first opportunity, then greedy thereafter → record `mean_score_B`
3. **Label** = `1` if `mean_score_A < mean_score_B`, else `0`

10 rollouts per branch (vs 20 for discard) is sufficient because the lay-down signal is stronger than the discard signal — the choice between going down now vs waiting one turn has a larger EV difference on average.

---

## Data Collection: `collect_laydown_data.py`

- 2K games × 7 rounds × ~1 lay-down opportunity/round ≈ **14K labeled records**
- Opponents (players 1–3): use `network_v3.pt` for discard, greedy lay-down
- Player 0: PIMC agent for discard decisions; 2-branch PIMC at each lay-down opportunity
- Output: `ml/pimc/data_laydown/` — NPZ chunks of `(state_vecs, labels)`
- Each NPZ chunk: 1K records

### Skip-one-turn hook

```python
class _SkipOnceLaydownHook:
    """Returns False on the first call for player 0, True thereafter."""
    def __init__(self):
        self._skipped = False

    def __call__(self, player_idx, hand, round_idx, has_laid_down_others):
        if player_idx != 0:
            return None   # greedy for others
        if not self._skipped:
            self._skipped = True
            return False  # skip this one turn
        return True       # go down next time
```

---

## Training: `train_laydown_net.py`

1. Load all NPZ chunks from `data_laydown/`
2. Build `(states, labels)` tensors; compute `pos_weight = n_neg / n_pos`
3. 80/20 train/val split
4. Train 30 epochs, save best val-loss checkpoint to `models/laydown_net.pt`
5. Report: val accuracy, label distribution, per-round accuracy breakdown

---

## Bridge Integration

### `shanghai_env.py` — `get_strategic_actions`

Add optional `meld_hook` parameter:

```python
def get_strategic_actions(self, meld_hook=None) -> tuple:
```

When `meld` appears in the action list **and** `current_player == 0` **and** `meld_hook is not None`:
- Call `meld_hook(hand_cards, round_idx, opp_has_laid_down)` → `bool`
- If `True`: step `meld` as usual
- If `False`: skip `meld`, remove it from the action list, return remaining strategic actions

All other players (1–3): auto-meld as before (unchanged).

### `network_bridge_eval.py` — LaydownNet hook

At startup, try to load `models/laydown_net.pt`. If found, create a `LaydownHook` wrapper and pass it to `get_strategic_actions`. If not found, fall back to greedy (auto-meld).

```python
class LaydownHook:
    def __init__(self, model: LaydownNet, n_players: int):
        ...
    def __call__(self, hand_cards, round_idx, opp_has_laid_down) -> bool:
        sv = build_laydown_state_vec(...)
        return bool(model.predict(torch.from_numpy(sv).unsqueeze(0)).item())
```

Add `--no-laydown` CLI flag to force greedy lay-down (for ablation comparison).

---

## Files

| File | Action |
|------|--------|
| `ml/pimc/engine.py` | Add `laydown_hook` param to `play_round` and `play_game` |
| `ml/pimc/collect_data.py` | Add `build_laydown_state_vec()` and `LAYDOWN_STATE_DIM = 174` |
| `ml/pimc/laydown_net.py` | **New** — `LaydownNet` class |
| `ml/pimc/collect_laydown_data.py` | **New** — 2-branch PIMC collection script |
| `ml/pimc/train_laydown_net.py` | **New** — training script |
| `ml/training/shanghai_env.py` | Add `meld_hook` param to `get_strategic_actions` |
| `ml/pimc/network_bridge_eval.py` | Load `laydown_net.pt`, wire up `LaydownHook`, add `--no-laydown` flag |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Val accuracy | > 75% (baseline: always predict label=1) |
| Bridge avg score | < 173 (current discard-only plateau) |
| Bridge win rate | ≥ 70% (maintain discard network performance) |

If bridge score doesn't improve vs greedy lay-down, the discard network's plateau is the bottleneck, not lay-down timing.

---

## Revision History

| Date | Change |
|------|--------|
| 2026-04-17 | Initial spec |
