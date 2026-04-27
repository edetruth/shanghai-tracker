"""
PPO training for AlphaZero-lite Shanghai Rummy.

compute_gae()        — Generalized Advantage Estimation over trajectories
build_ppo_batch()    — flatten steps into tensors for PPO loss
compute_ppo_losses() — clipped PPO surrogate + value + entropy
ppo_iteration()      — one PPO update: collect → GAE → N epochs

Value convention: V(s) predicts expected RETURN = −expected_score.
Higher return = lower score = better. Terminal reward R = −final_score.
Log prob convention: computed at temperature=1 (masking applied consistently).
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Optional

import numpy as np
import torch
import torch.nn.functional as F

_PIMC_DIR = Path(__file__).parent.parent
if str(_PIMC_DIR) not in sys.path:
    sys.path.insert(0, str(_PIMC_DIR))

from alphazero.constants import ACTION_DISCARD, ACTION_DRAW, ACTION_BUY, ACTION_LAYDOWN
from alphazero.agent import _ctype


def compute_gae(
    trajectories: List[dict],
    model,
    gamma: float = 0.99,
    lam: float = 0.95,
) -> List[dict]:
    """
    Compute GAE advantages and value targets for every step in every trajectory.

    Reward structure: R = −final_score at the terminal step; 0 elsewhere.
    V(s) predicts expected return (higher = better = lower score).

    Adds to each step in-place:
        advantage    (float): GAE advantage estimate
        value_target (float): A_t + V(s_t), used as value regression target
        value_old    (float): V(s_t) from current model at collection time
    """
    model.eval()
    with torch.no_grad():
        for traj in trajectories:
            steps = traj["steps"]
            if not steps:
                continue

            # Forward pass on all states in this trajectory at once
            states = torch.from_numpy(
                np.stack([s["state_vec"] for s in steps]).astype(np.float32)
            )
            values = model(states)["value"].squeeze(-1).tolist()  # list[float]

            # Terminal return in return space
            terminal_return = -float(traj["final_score"])
            T = len(steps)

            # Backwards GAE recursion
            gae = 0.0
            for t in reversed(range(T)):
                v_t = values[t]
                if steps[t]["is_terminal"]:
                    v_next = 0.0
                    r_t    = terminal_return
                else:
                    v_next = values[t + 1]
                    r_t    = 0.0

                delta = r_t + gamma * v_next - v_t
                gae   = delta + gamma * lam * gae

                steps[t]["advantage"]    = gae
                steps[t]["value_target"] = gae + v_t
                steps[t]["value_old"]    = v_t

    return trajectories


def build_ppo_batch(steps: List[dict]) -> dict:
    """
    Flatten a list of labeled trajectory steps into tensors for PPO loss.

    Requires steps to already have: advantage, value_target (from compute_gae)
    and log_prob_old (from agent collection).

    Returns dict with:
        state_vecs    FloatTensor (N, 170)
        action_types  LongTensor  (N,)
        action_takens LongTensor  (N,)
        log_probs_old FloatTensor (N,)
        advantages    FloatTensor (N,)
        value_targets FloatTensor (N,)
        discard_masks BoolTensor  (N_discard, 53) — True = valid action
    """
    if not steps:
        raise ValueError("build_ppo_batch requires at least one step")

    state_vecs    = torch.from_numpy(
        np.stack([s["state_vec"] for s in steps]).astype(np.float32)
    )
    action_types  = torch.tensor([s["action_type"]  for s in steps], dtype=torch.long)
    action_takens = torch.tensor([s["action_taken"] for s in steps], dtype=torch.long)
    log_probs_old = torch.tensor([s["log_prob_old"] for s in steps], dtype=torch.float32)
    advantages    = torch.tensor([s["advantage"]    for s in steps], dtype=torch.float32)
    value_targets = torch.tensor([s["value_target"] for s in steps], dtype=torch.float32)

    # Build per-sample discard mask (True = card type is in hand, valid to discard)
    discard_steps = [s for s in steps if s["action_type"] == ACTION_DISCARD]
    n_d = len(discard_steps)
    discard_masks = torch.zeros(n_d, 53, dtype=torch.bool)
    for i, s in enumerate(discard_steps):
        for c in s["hand"]:
            discard_masks[i, _ctype(c)] = True

    return {
        "state_vecs":    state_vecs,
        "action_types":  action_types,
        "action_takens": action_takens,
        "log_probs_old": log_probs_old,
        "advantages":    advantages,
        "value_targets": value_targets,
        "discard_masks": discard_masks,
    }
