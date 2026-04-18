"""
LaydownNet — binary classifier for lay-down timing.

Decides whether player 0 should lay down melds immediately (1) or wait (0).
Trained on PIMC-labeled data collected by collect_laydown_data.py.

Input: 174-dim state vector (see collect_data.LAYDOWN_STATE_DIM)
Output: raw logit (forward) or binary prediction (predict)

Usage:
    from laydown_net import LaydownNet, LAYDOWN_STATE_DIM
    model = LaydownNet()
    # training: BCEWithLogitsLoss(pos_weight=...)
    # inference: model.predict(state_tensor)  -> 1 = lay down, 0 = wait
"""

import torch
import torch.nn as nn
from torch import Tensor

from collect_data import LAYDOWN_STATE_DIM


class LaydownNet(nn.Module):
    """Small binary MLP for lay-down timing decisions."""

    def __init__(self, input_dim: int = LAYDOWN_STATE_DIM, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def forward(self, x: Tensor) -> Tensor:
        """Returns raw logit, shape (B,) for batched or scalar for single."""
        return self.net(x).squeeze(-1)

    @torch.no_grad()
    def predict(self, x: Tensor) -> Tensor:
        """Returns binary prediction: 1 = lay down now, 0 = wait."""
        return (self.forward(x) > 0).long()
