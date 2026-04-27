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
