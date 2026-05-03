from pathlib import Path
from typing import Dict, Optional

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
      - value_head:    (256→1)  predicted cumulative game score (lower = better)

    Use from_pimc_checkpoint() to warm-start backbone + discard_head from
    a PIMCDiscardNet checkpoint, leaving other heads randomly initialized.
    """

    STATE_DIM = 170
    HIDDEN    = 256

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

    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
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

    @torch.no_grad()
    def predict_discard(self, state: torch.Tensor) -> torch.Tensor:
        """Mirrors PIMCDiscardNet.predict_discard() — used by NetworkHook in bridge eval."""
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)
        logits = self.forward(state)["discard_logits"]
        hand_mask = (state[:, :53] > 0).clone()
        hand_mask[:, 52] = False
        logits = logits.masked_fill(~hand_mask, float('-inf'))
        result = logits.argmax(dim=1)
        return result.squeeze(0) if single else result

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

        Raises:
            FileNotFoundError: if checkpoint_path does not exist.
            ValueError: if checkpoint has no backbone.* or discard_head.* keys.
            RuntimeError: if backbone or discard_head weights are missing after load.
        """
        if not Path(checkpoint_path).exists():
            raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

        net = cls(dropout=dropout)
        pimc_state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)

        if not isinstance(pimc_state, dict):
            raise ValueError(
                f"Checkpoint must be a state_dict (dict), got {type(pimc_state)}"
            )

        compatible = {
            k: v for k, v in pimc_state.items()
            if k.startswith("backbone.") or k.startswith("discard_head.")
        }

        if not compatible:
            raise ValueError(
                f"Checkpoint has no backbone.* or discard_head.* keys. "
                f"Found top-level keys: {list(pimc_state.keys())[:10]}"
            )

        missing, _ = net.load_state_dict(compatible, strict=False)
        critical_missing = [
            k for k in missing
            if k.startswith("backbone.") or k.startswith("discard_head.")
        ]
        if critical_missing:
            raise RuntimeError(
                f"Missing critical backbone/discard_head weights: {critical_missing}"
            )

        return net
