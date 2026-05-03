"""
Neural network v2 for Shanghai Rummy — PPO Policy + Value heads.

PPO v2: Simplified 26-action space (draw/discard/buy only).
Meld/layoff handled by rule-based AI in the env wrapper.
Unified policy head — no separate buy head needed.

Input:  rich state vector (RICH_STATE_SIZE features from state_encoder)
Output: policy_logits (batch, MAX_ACTIONS=26), value (batch, 1)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS


class ShanghaiNetV2(nn.Module):
    """
    PPO v2 network for Shanghai Rummy.

    Simplified: 26 actions (draw/discard/buy only).
    No separate buy head — buy/decline are indices 24/25 in the unified output.
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

        # ── Policy head ──────────────────────────────────────────────────────
        # 26 actions: draw(1) + take(1) + discard(22) + buy(1) + decline(1)
        self.policy_head = nn.Linear(128, MAX_ACTIONS)

        # ── Value head ────────────────────────────────────────────────────────
        self.value_head = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, state: torch.Tensor):
        trunk_out = self.trunk(state)
        policy_logits = self.policy_head(trunk_out)
        value = self.value_head(trunk_out)
        return policy_logits, value

    def get_entropy(self, logits: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
        """Compute mean entropy across all steps."""
        masked = logits + (masks - 1.0) * 1e9
        probs = F.softmax(masked, dim=-1)
        log_probs = F.log_softmax(masked, dim=-1)
        entropy = -(probs * log_probs).sum(dim=-1)
        return entropy.mean()
