"""
Opponent Encoder — learns 16-dim embeddings from raw observable opponent data.

Weight-shared across all opponent slots. Trained jointly with HandEvalNet.

Usage:
    encoder = OpponentEncoderNet()
    opp_raw = torch.randn(batch, 3, 126)  # 3 opponents × 126 features
    embeddings = encoder(opp_raw)          # (batch, 48)
"""

import torch
import torch.nn as nn

from state_encoder import OPP_RAW_FEATURES, MAX_OPPONENTS, OPP_EMBEDDING_DIM


class OpponentEncoderNet(nn.Module):
    """Shared-weight encoder: 126 raw features per opponent → 16-dim embedding."""

    def __init__(self, input_size: int = OPP_RAW_FEATURES, embed_dim: int = OPP_EMBEDDING_DIM):
        super().__init__()
        self.embed_dim = embed_dim
        self.max_opponents = MAX_OPPONENTS
        self.encoder = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, embed_dim),
        )

    def forward(self, opp_raw: torch.Tensor) -> torch.Tensor:
        """
        Args:
            opp_raw: (batch, 3 * 126) or (batch, 3, 126) — raw opponent features

        Returns:
            (batch, 48) — concatenated embeddings for all 3 opponents
        """
        batch = opp_raw.shape[0]
        # Reshape to (batch, 3, 126) if flat
        if opp_raw.dim() == 2:
            opp_raw = opp_raw.view(batch, self.max_opponents, -1)

        embeddings = []
        for i in range(self.max_opponents):
            emb = self.encoder(opp_raw[:, i, :])  # (batch, 16)
            embeddings.append(emb)

        return torch.cat(embeddings, dim=1)  # (batch, 48)


def build_enriched_state(
    base_state: torch.Tensor,
    opp_raw: torch.Tensor,
    encoder: OpponentEncoderNet,
) -> torch.Tensor:
    """
    Combine base state (264) with opponent embeddings (48) → enriched state (312).

    Args:
        base_state: (batch, 264)
        opp_raw: (batch, 378) — raw opponent features
        encoder: trained OpponentEncoderNet

    Returns:
        (batch, 312) — enriched state
    """
    opp_embeddings = encoder(opp_raw)  # (batch, 48)
    return torch.cat([base_state, opp_embeddings], dim=1)
