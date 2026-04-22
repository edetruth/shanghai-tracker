from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn


class ShanghaiNet(nn.Module):
    """
    Full end-to-end Shanghai Rummy policy + value network.

    Backbone is identical to PIMCDiscardNet (170→256×3 MLP with LayerNorm).
    Five heads replace the original single discard head:
      - discard_head:  (256→53) logits over card types
      - draw_head:     (256→2)  logits for [draw_pile, take_discard]
      - buy_head:      (256→1)  logit; sigmoid > 0.5 = buy
      - laydown_head:  (256→1)  logit; sigmoid > 0.5 = lay down now
      - value_head:    (256→1)  predicted round score (lower = better)

    Use from_pimc_checkpoint() to warm-start backbone + discard_head from
    a PIMCDiscardNet checkpoint, leaving other heads randomly initialized.
    """

    STATE_DIM = 170
    HIDDEN = 256

    def __init__(self, dropout: float = 0.1):
        super().__init__()
        h = self.HIDDEN
        self.backbone = nn.Sequential(
            nn.Linear(self.STATE_DIM, h),
            nn.LayerNorm(h),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(h, h),
            nn.LayerNorm(h),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(h, h),
            nn.LayerNorm(h),
            nn.ReLU(),
        )
        self.discard_head  = nn.Linear(h, 53)
        self.draw_head     = nn.Linear(h, 2)
        self.buy_head      = nn.Linear(h, 1)
        self.laydown_head  = nn.Linear(h, 1)
        self.value_head    = nn.Linear(h, 1)

    def forward(self, x: torch.Tensor) -> dict:
        """
        Args:
            x: (B, 170) float32

        Returns dict with keys:
            discard_logits (B, 53), draw_logits (B, 2),
            buy_logit (B, 1), laydown_logit (B, 1), value (B, 1)
        """
        feat = self.backbone(x)
        return {
            "discard_logits": self.discard_head(feat),
            "draw_logits":    self.draw_head(feat),
            "buy_logit":      self.buy_head(feat),
            "laydown_logit":  self.laydown_head(feat),
            "value":          self.value_head(feat),
        }

    def forward_onnx(self, x: torch.Tensor) -> tuple:
        """ONNX-compatible forward — tuple output for torch.onnx.export."""
        feat = self.backbone(x)
        return (
            self.discard_head(feat),
            self.draw_head(feat),
            self.buy_head(feat),
            self.laydown_head(feat),
            self.value_head(feat),
        )

    @classmethod
    def from_pimc_checkpoint(
        cls, checkpoint_path: Path, dropout: float = 0.1
    ) -> "ShanghaiNet":
        """
        Warm-start backbone and discard_head weights from a PIMCDiscardNet checkpoint.
        draw/buy/laydown/value heads keep random initialization.
        """
        net = cls(dropout=dropout)
        pimc_state = torch.load(checkpoint_path, map_location="cpu")
        compatible = {
            k: v for k, v in pimc_state.items()
            if k.startswith("backbone.") or k.startswith("discard_head.")
        }
        net.load_state_dict(compatible, strict=False)
        return net
