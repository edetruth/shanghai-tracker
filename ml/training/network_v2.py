"""
Neural network v2 for Shanghai Rummy — PPO Policy + Value heads.

Architecture improvements over v1:
  - Wider shared trunk: 256 → 256 → 128
  - Dedicated buy policy head (binary: buy / decline_buy)
  - Buy head outputs are injected into gameplay logits at the correct indices
    so that a single masked softmax can cover both gameplay and buy decisions
  - Separate entropy helper that excludes buy steps from gameplay entropy

Input:  rich state vector (RICH_STATE_SIZE features from state_encoder)
Output: policy_logits (batch, MAX_ACTIONS), value (batch, 1)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX


class ShanghaiNetV2(nn.Module):
    """
    PPO network for Shanghai Rummy.

    Separates buy decisions from gameplay decisions via a dedicated buy head,
    then merges them back into the unified action logit vector so the rest of
    the PPO loop (action sampling, ratio clipping, entropy) works unchanged.
    """

    def __init__(self, state_size: int = RICH_STATE_SIZE):
        super().__init__()

        # ── Shared trunk ──────────────────────────────────────────────────────
        self.trunk = nn.Sequential(
            nn.Linear(state_size, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, 128),
            nn.ReLU(),
        )

        # ── Gameplay policy head ──────────────────────────────────────────────
        # Outputs raw logits for all MAX_ACTIONS slots.
        # Indices BUY_ACTION_IDX and DECLINE_BUY_ACTION_IDX are overwritten
        # by the buy head in forward(), so they are never used directly.
        self.gameplay_head = nn.Linear(128, MAX_ACTIONS)

        # ── Buy policy head ───────────────────────────────────────────────────
        # Dedicated two-logit head for the binary buy decision.
        # Output: [buy_logit, decline_logit]
        self.buy_head = nn.Sequential(
            nn.Linear(128, 32),
            nn.ReLU(),
            nn.Linear(32, 2),
        )

        # ── Value head ────────────────────────────────────────────────────────
        # Outputs expected return (no final activation — raw scalar).
        self.value_head = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    # ── forward ───────────────────────────────────────────────────────────────

    def forward(self, state: torch.Tensor):
        """
        Args:
            state: (batch, RICH_STATE_SIZE) float tensor

        Returns:
            policy_logits: (batch, MAX_ACTIONS) — gameplay logits with buy
                           slots overwritten by the dedicated buy head.
            value:         (batch, 1) — expected return (no activation).
        """
        trunk_out = self.trunk(state)

        gameplay_logits = self.gameplay_head(trunk_out)   # (batch, 350)
        buy_logits      = self.buy_head(trunk_out)         # (batch, 2)

        # Inject buy head outputs into the unified logit vector so that
        # sampling a single distribution covers both action types.
        policy_logits = gameplay_logits.clone()
        policy_logits[:, BUY_ACTION_IDX]         = buy_logits[:, 0]  # buy
        policy_logits[:, DECLINE_BUY_ACTION_IDX] = buy_logits[:, 1]  # decline_buy

        value = self.value_head(trunk_out)  # (batch, 1)

        return policy_logits, value

    # ── entropy helper ────────────────────────────────────────────────────────

    def get_gameplay_entropy(
        self,
        policy_logits: torch.Tensor,
        action_mask:   torch.Tensor,
        is_buy_step:   torch.Tensor,
    ) -> torch.Tensor:
        """
        Compute mean entropy over *gameplay* steps only (buy steps excluded).

        Args:
            policy_logits: (batch, MAX_ACTIONS) logits from forward()
            action_mask:   (batch, MAX_ACTIONS) float tensor — 1 for valid
                           actions, 0 for invalid ones
            is_buy_step:   (batch,) bool tensor — True when the step is a
                           binary buy/decline decision

        Returns:
            Scalar mean entropy across non-buy steps, or torch.tensor(0.0)
            if every step in the batch is a buy step.
        """
        gameplay_mask = ~is_buy_step  # (batch,) bool

        if gameplay_mask.sum() == 0:
            return torch.tensor(0.0, device=policy_logits.device)

        # Select only gameplay rows
        logits = policy_logits[gameplay_mask]   # (G, MAX_ACTIONS)
        mask   = action_mask[gameplay_mask]      # (G, MAX_ACTIONS)

        # Mask invalid actions with a large negative value before softmax
        masked_logits = logits + (1.0 - mask) * -1e9

        probs   = F.softmax(masked_logits, dim=-1)          # (G, MAX_ACTIONS)
        log_p   = F.log_softmax(masked_logits, dim=-1)      # (G, MAX_ACTIONS)

        # Shannon entropy: -sum(p * log_p), clamped to avoid -inf from zero probs
        entropy = -(probs * log_p).sum(dim=-1)              # (G,)

        return entropy.mean()
