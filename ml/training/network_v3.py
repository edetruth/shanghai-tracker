"""V3 LSTM Sequence Model for Shanghai Rummy.

Architecture:
  - OpponentEncoderNetV3: 126 raw features -> 16-dim embedding per opponent (weight-shared)
  - ShanghaiLSTM: 2-layer LSTM backbone (373 -> 192 hidden) with specialized heads:
    - DrawHead: h_t + offered_card -> take/draw probability
    - DiscardHead: h_t -> logits over 22 hand slots
    - BuyHead: h_t + offered_card -> buy/pass probability
    - AuxiliaryHead: final h_t -> predicted round score
"""
import torch
import torch.nn as nn

from state_encoder import (
    OPP_RAW_FEATURES, OPP_EMBEDDING_DIM,
    CARD_FEATURES, MAX_HAND_CARDS,
    V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_LSTM_LAYERS, V3_LSTM_DROPOUT,
    V3_DRAW_HEAD_INPUT, V3_BUY_HEAD_INPUT, V3_DISCARD_HEAD_INPUT,
)


class OpponentEncoderNetV3(nn.Module):
    """Compress 126 raw opponent features into 16-dim embedding. Weight-shared across opponents."""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(OPP_RAW_FEATURES, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, OPP_EMBEDDING_DIM),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (batch, 126) -> (batch, 16)"""
        return self.net(x)

    def encode_all_opponents(self, opp_raw: torch.Tensor) -> torch.Tensor:
        """opp_raw: (batch, 378) -> (batch, 48). Splits into 3 opponents, encodes each."""
        embeddings = []
        for i in range(3):
            start = i * OPP_RAW_FEATURES
            end = start + OPP_RAW_FEATURES
            emb = self.forward(opp_raw[:, start:end])
            embeddings.append(emb)
        return torch.cat(embeddings, dim=-1)


class ShanghaiLSTM(nn.Module):
    """Unified LSTM model with specialized decision heads."""

    def __init__(self):
        super().__init__()

        self.lstm = nn.LSTM(
            input_size=V3_TIMESTEP_INPUT_SIZE,
            hidden_size=V3_LSTM_HIDDEN,
            num_layers=V3_LSTM_LAYERS,
            dropout=V3_LSTM_DROPOUT,
            batch_first=True,
        )

        self.draw_head = nn.Sequential(
            nn.Linear(V3_DRAW_HEAD_INPUT, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

        self.discard_head = nn.Sequential(
            nn.Linear(V3_DISCARD_HEAD_INPUT, 96),
            nn.ReLU(),
            nn.Linear(96, MAX_HAND_CARDS),
        )

        self.buy_head = nn.Sequential(
            nn.Linear(V3_BUY_HEAD_INPUT, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

        self.auxiliary_head = nn.Sequential(
            nn.Linear(V3_LSTM_HIDDEN, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def lstm_forward(
        self,
        x: torch.Tensor,
        mask: torch.Tensor,
        hx: tuple[torch.Tensor, torch.Tensor] | None = None,
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        """Run LSTM over padded sequences.

        Args:
            x: (batch, seq_len, input_size)
            mask: (batch, seq_len) — True for real timesteps
            hx: optional initial (h_0, c_0)

        Returns:
            h_all: (batch, seq_len, hidden) — hidden state at every timestep
            (h_n, c_n): final hidden and cell states
        """
        lengths = mask.sum(dim=1).cpu()
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths, batch_first=True, enforce_sorted=False
        )
        packed_out, (h_n, c_n) = self.lstm(packed, hx)
        h_all, _ = nn.utils.rnn.pad_packed_sequence(
            packed_out, batch_first=True, total_length=x.size(1)
        )
        return h_all, (h_n, c_n)

    def draw_head_forward(self, h_t: torch.Tensor, offered_card: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192), offered_card: (batch, 6) -> (batch, 1) probability."""
        return self.draw_head(torch.cat([h_t, offered_card], dim=-1))

    def discard_head_forward(self, h_t: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192) -> (batch, 22) raw logits."""
        return self.discard_head(h_t)

    def buy_head_forward(self, h_t: torch.Tensor, offered_card: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192), offered_card: (batch, 6) -> (batch, 1) probability."""
        return self.buy_head(torch.cat([h_t, offered_card], dim=-1))

    def auxiliary_head_forward(self, h_t: torch.Tensor) -> torch.Tensor:
        """h_t: (batch, 192) -> (batch, 1) predicted round score."""
        return self.auxiliary_head(h_t)

    def step_inference(
        self,
        x_t: torch.Tensor,
        hx: tuple[torch.Tensor, torch.Tensor],
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        """Single-step forward for autoregressive inference.

        Args:
            x_t: (1, 1, input_size)
            hx: (h, c) each (num_layers, 1, hidden)

        Returns:
            h_t: (1, hidden)
            (h_n, c_n): updated states
        """
        out, (h_n, c_n) = self.lstm(x_t, hx)
        h_t = out.squeeze(1)
        return h_t, (h_n, c_n)
