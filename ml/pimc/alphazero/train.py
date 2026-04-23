"""
Training utilities for AlphaZero-lite.

build_batch()    — convert labeled trajectory steps → tensor dict
compute_losses() — policy + value + entropy losses
"""
from __future__ import annotations

from typing import List

import numpy as np
import torch
import torch.nn.functional as F


ACTION_DISCARD  = 0
ACTION_DRAW     = 1
ACTION_BUY      = 2
ACTION_LAYDOWN  = 3


def build_batch(steps: List[dict]) -> dict:
    """
    Convert a flat list of labeled trajectory steps to tensors.

    Args:
        steps: list of step dicts, each with keys:
            state_vec (np.ndarray 170), action_type (int), action_taken (int),
            value_label (float).  Produced by value_labeler.label_values().

    Returns:
        dict with:
            state_vecs   — FloatTensor (N, 170)
            action_types — LongTensor  (N,)   values 0-3
            action_takens— LongTensor  (N,)   action index within head
            value_labels — FloatTensor (N,)   value targets
    """
    if not steps:
        raise ValueError("build_batch requires at least one step")

    state_vecs = torch.from_numpy(
        np.stack([s["state_vec"] for s in steps]).astype(np.float32)
    )
    action_types  = torch.tensor([s["action_type"]  for s in steps], dtype=torch.long)
    action_takens = torch.tensor([s["action_taken"] for s in steps], dtype=torch.long)
    value_labels  = torch.tensor([s["value_label"]  for s in steps], dtype=torch.float32)
    return {
        "state_vecs":    state_vecs,
        "action_types":  action_types,
        "action_takens": action_takens,
        "value_labels":  value_labels,
    }


def compute_losses(
    model,
    batch: dict,
    entropy_coef: float = 0.01,
) -> dict:
    """
    Forward pass + loss computation.

    Policy gradient: REINFORCE with value baseline.
        advantage = value_label − predicted_value (detached)
        loss      = −mean(log_prob(action) × advantage)

    Value: MSE(predicted_value, value_label)

    Entropy: mean per-head entropy (maximised to encourage exploration)

    Total: policy_loss + 0.5 × value_loss − entropy_coef × entropy

    Args:
        model:        ShanghaiNet instance (train mode)
        batch:        output of build_batch()
        entropy_coef: weight for entropy bonus (default 0.01)

    Returns:
        dict with scalar tensors:
            policy_loss, value_loss, entropy, total_loss
    """
    state_vecs    = batch["state_vecs"]
    action_types  = batch["action_types"]
    action_takens = batch["action_takens"]
    value_labels  = batch["value_labels"]

    out = model(state_vecs)
    predicted = out["value"].squeeze(-1)   # (N,)

    value_loss = F.mse_loss(predicted, value_labels)
    advantages = (value_labels - predicted.detach())

    policy_losses: list[torch.Tensor] = []
    entropies:     list[torch.Tensor] = []

    # ── Discard (categorical over 53 card types) ────────────────────
    mask_d = action_types == ACTION_DISCARD
    if mask_d.any():
        logits   = out["discard_logits"][mask_d]
        adv      = advantages[mask_d]
        acts     = action_takens[mask_d]
        log_p    = F.log_softmax(logits, dim=-1)
        lp       = log_p[torch.arange(mask_d.sum()), acts]
        policy_losses.append(-(lp * adv).mean())
        p        = log_p.exp()
        entropies.append(-(p * log_p).sum(dim=-1).mean())

    # ── Draw (categorical over 2: pile/take) ────────────────────────
    mask_r = action_types == ACTION_DRAW
    if mask_r.any():
        logits   = out["draw_logits"][mask_r]
        adv      = advantages[mask_r]
        acts     = action_takens[mask_r]
        log_p    = F.log_softmax(logits, dim=-1)
        lp       = log_p[torch.arange(mask_r.sum()), acts]
        policy_losses.append(-(lp * adv).mean())
        p        = log_p.exp()
        entropies.append(-(p * log_p).sum(dim=-1).mean())

    # ── Buy (binary) ─────────────────────────────────────────────────
    mask_b = action_types == ACTION_BUY
    if mask_b.any():
        logit    = out["buy_logit"][mask_b].squeeze(-1)
        adv      = advantages[mask_b]
        acts_f   = action_takens[mask_b].float()
        lp       = -F.binary_cross_entropy_with_logits(logit, acts_f, reduction="none")
        policy_losses.append(-(lp * adv).mean())
        p        = torch.sigmoid(logit).clamp(1e-6, 1 - 1e-6)
        entropies.append(-(p * p.log() + (1 - p) * (1 - p).log()).mean())

    # ── Laydown (binary) ─────────────────────────────────────────────
    mask_l = action_types == ACTION_LAYDOWN
    if mask_l.any():
        logit    = out["laydown_logit"][mask_l].squeeze(-1)
        adv      = advantages[mask_l]
        acts_f   = action_takens[mask_l].float()
        lp       = -F.binary_cross_entropy_with_logits(logit, acts_f, reduction="none")
        policy_losses.append(-(lp * adv).mean())
        p        = torch.sigmoid(logit).clamp(1e-6, 1 - 1e-6)
        entropies.append(-(p * p.log() + (1 - p) * (1 - p).log()).mean())

    zero = torch.tensor(0.0)
    policy_loss = torch.stack(policy_losses).mean() if policy_losses else zero
    entropy     = torch.stack(entropies).mean()     if entropies     else zero
    total_loss  = policy_loss + 0.5 * value_loss - entropy_coef * entropy

    return {
        "policy_loss": policy_loss,
        "value_loss":  value_loss,
        "entropy":     entropy,
        "total_loss":  total_loss,
    }
