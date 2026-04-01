"""
Neural network for Shanghai Rummy — Policy + Value heads.

Input:  game state vector (~65 features from the bridge encoder)
Output: policy (probability distribution over actions) + value (expected final score)

Architecture:
  - Shared trunk: 3 hidden layers (128 → 128 → 64)
  - Policy head: maps to action space (variable size, masked by valid actions)
  - Value head: single scalar prediction (expected negative final score)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

# Maximum number of discrete actions the network can output.
# draw_pile(1) + take_discard(1) + discard:0..15(16) + meld(1) + layoff:ci:mi(16*20=320) = ~339
# We'll use a fixed size and mask invalid actions.
MAX_ACTIONS = 350
STATE_SIZE = 65  # Must match bridge encoder output


class ShanghaiNet(nn.Module):
    """Combined policy + value network for Shanghai Rummy."""

    def __init__(self, state_size=STATE_SIZE, hidden_size=128):
        super().__init__()
        # Shared trunk
        self.trunk = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
        )
        # Policy head — outputs action logits
        self.policy_head = nn.Linear(64, MAX_ACTIONS)
        # Value head — outputs expected reward
        self.value_head = nn.Sequential(
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Tanh(),  # Output in [-1, 1], scaled to score range later
        )

    def forward(self, state):
        """
        Args:
            state: (batch, STATE_SIZE) tensor
        Returns:
            policy_logits: (batch, MAX_ACTIONS) raw logits (mask before softmax)
            value: (batch, 1) expected normalized reward
        """
        trunk_out = self.trunk(state)
        policy_logits = self.policy_head(trunk_out)
        value = self.value_head(trunk_out)
        return policy_logits, value


# ── Action encoding ──────────────────────────────────────────────────────────

# Maps action strings to fixed indices for the policy network.
# The bridge returns actions like "draw_pile", "take_discard", "discard:3", "meld", "layoff:2:5"

def encode_action(action: str) -> int:
    """Convert an action string to a network output index."""
    if action == "draw_pile":
        return 0
    if action == "take_discard":
        return 1
    if action == "meld":
        return 2
    if action.startswith("discard:"):
        idx = int(action.split(":")[1])
        return 3 + idx  # 3..18 (up to 16 cards)
    if action.startswith("layoff:"):
        parts = action.split(":")
        ci, mi = int(parts[1]), int(parts[2])
        return 19 + ci * 20 + mi  # 19..339
    return 0  # fallback


def decode_action(index: int, valid_actions: list) -> str:
    """Convert a network output index back to an action string.
    Falls back to a random valid action if the index doesn't map."""
    # Build reverse map from valid actions
    action_to_idx = {a: encode_action(a) for a in valid_actions}
    idx_to_action = {v: k for k, v in action_to_idx.items()}
    if index in idx_to_action:
        return idx_to_action[index]
    # Fallback: return first valid action
    return valid_actions[0] if valid_actions else "draw_pile"


def get_action_mask(valid_actions: list) -> torch.Tensor:
    """Create a mask tensor where valid actions are 1, invalid are 0."""
    mask = torch.zeros(MAX_ACTIONS)
    for action in valid_actions:
        mask[encode_action(action)] = 1.0
    return mask
