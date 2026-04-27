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


def compute_ppo_losses(
    model,
    batch: dict,
    advantages_normalized: torch.Tensor,
    clip_eps: float = 0.2,
    entropy_coef: float = 0.05,
    value_coef: float = 0.5,
) -> dict:
    """
    Compute clipped PPO surrogate loss + value loss + entropy bonus.

    Args:
        model:                 ShanghaiNet in train() mode
        batch:                 output of build_ppo_batch()
        advantages_normalized: normalized advantages (N,) — caller normalizes
        clip_eps:              PPO clip range (default 0.2)
        entropy_coef:          entropy bonus weight
        value_coef:            value loss weight

    Returns:
        dict with scalar tensors: policy_loss, value_loss, entropy, total_loss
    """
    state_vecs    = batch["state_vecs"]
    action_types  = batch["action_types"]
    action_takens = batch["action_takens"]
    log_probs_old = batch["log_probs_old"]
    value_targets = batch["value_targets"]
    discard_masks = batch["discard_masks"]

    out       = model(state_vecs)
    predicted = out["value"].squeeze(-1)   # (N,)

    # ── Value loss (MSE in return space) ─────────────────────────────
    value_loss = F.mse_loss(predicted, value_targets)

    # ── Per-step new log_probs and entropy ───────────────────────────
    log_probs_new_list: list = []
    entropy_terms:      list = []

    # Discard head — categorical over 53 with per-sample mask
    mask_d = action_types == ACTION_DISCARD
    if mask_d.any():
        n_d    = int(mask_d.sum())
        logits = out["discard_logits"][mask_d]           # (n_d, 53)
        acts   = action_takens[mask_d]                   # (n_d,)
        # Apply per-sample validity masks
        masked = logits.clone()
        masked[~discard_masks] = float("-inf")
        log_p  = F.log_softmax(masked, dim=-1)
        lp_new = log_p[torch.arange(n_d), acts]
        log_probs_new_list.append((mask_d, lp_new))
        p = log_p.exp()
        entropy_terms.append((-(p * log_p.clamp(min=-1e9)).sum(dim=-1).mean(), n_d))

    # Draw head — categorical over 2
    mask_r = action_types == ACTION_DRAW
    if mask_r.any():
        n_r    = int(mask_r.sum())
        logits = out["draw_logits"][mask_r]              # (n_r, 2)
        acts   = action_takens[mask_r]
        log_p  = F.log_softmax(logits, dim=-1)
        lp_new = log_p[torch.arange(n_r), acts]
        log_probs_new_list.append((mask_r, lp_new))
        p = log_p.exp()
        entropy_terms.append((-(p * log_p).sum(dim=-1).mean(), n_r))

    # Buy head — binary
    mask_b = action_types == ACTION_BUY
    if mask_b.any():
        n_b    = int(mask_b.sum())
        logit  = out["buy_logit"][mask_b].squeeze(-1)   # (n_b,)
        acts_f = action_takens[mask_b].float()
        lp_new = -F.binary_cross_entropy_with_logits(logit, acts_f, reduction="none")
        log_probs_new_list.append((mask_b, lp_new))
        p = torch.sigmoid(logit).clamp(1e-6, 1 - 1e-6)
        entropy_terms.append((-(p * p.log() + (1 - p) * (1 - p).log()).mean(), n_b))

    # Laydown head — binary
    mask_l = action_types == ACTION_LAYDOWN
    if mask_l.any():
        n_l    = int(mask_l.sum())
        logit  = out["laydown_logit"][mask_l].squeeze(-1)
        acts_f = action_takens[mask_l].float()
        lp_new = -F.binary_cross_entropy_with_logits(logit, acts_f, reduction="none")
        log_probs_new_list.append((mask_l, lp_new))
        p = torch.sigmoid(logit).clamp(1e-6, 1 - 1e-6)
        entropy_terms.append((-(p * p.log() + (1 - p) * (1 - p).log()).mean(), n_l))

    # ── Assemble full log_probs_new tensor (N,) ──────────────────────
    N = state_vecs.shape[0]
    log_probs_new = torch.zeros(N, device=state_vecs.device)
    for mask, lp in log_probs_new_list:
        idx = mask.nonzero(as_tuple=True)[0]
        log_probs_new = log_probs_new.index_put((idx,), lp)

    # ── PPO clipped surrogate objective ──────────────────────────────
    ratio   = torch.exp(log_probs_new - log_probs_old)
    clipped = torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps)
    policy_loss = -torch.min(
        ratio   * advantages_normalized,
        clipped * advantages_normalized,
    ).mean()

    # ── Weighted entropy across heads ────────────────────────────────
    if entropy_terms:
        total_n = sum(n for _, n in entropy_terms)
        entropy = sum(e * n / total_n for e, n in entropy_terms)
    else:
        entropy = torch.tensor(0.0, device=state_vecs.device)

    total_loss = policy_loss + value_coef * value_loss - entropy_coef * entropy

    return {
        "policy_loss": policy_loss,
        "value_loss":  value_loss,
        "entropy":     entropy,
        "total_loss":  total_loss,
    }
