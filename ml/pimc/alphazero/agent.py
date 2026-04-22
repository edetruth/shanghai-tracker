"""
ShanghaiNetAgent — wraps ShanghaiNet as engine hook callables.

Produces discard_hook, draw_hook, buy_hook, laydown_hook compatible with
engine.play_game(). Only records trajectory steps for its own player_idx;
returns None for all other players (engine uses greedy fallback).

_ctype() and build_state_vec() are inlined here (copied from collect_data.py)
to avoid that module's top-level dependency on evaluate_pimc.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn.functional as F

_PIMC_DIR = Path(__file__).parent.parent
if str(_PIMC_DIR) not in sys.path:
    sys.path.insert(0, str(_PIMC_DIR))

from engine import CARDS_DEALT, JOKER_INT

ACTION_DISCARD  = 0
ACTION_DRAW     = 1
ACTION_BUY      = 2
ACTION_LAYDOWN  = 3

# ── State encoding (inlined from collect_data to avoid evaluate_pimc dep) ────

_STATE_DIM      = 170
_MAX_OPP_SLOTS  = 3   # fixed for 4P; padded with 0 for fewer opponents


def _ctype(card_int: int) -> int:
    """Map card int to compact type index 0-52.

    Non-joker: suit * 13 + (rank - 1)  →  0-51
    Joker (64):                         →  52
    """
    if card_int == JOKER_INT:
        return 52
    suit = card_int >> 4    # 0-3
    rank = card_int & 15    # 1-13
    return suit * 13 + (rank - 1)


def _build_state_vec(
    hand: list,
    seen_dict: dict,
    discard_top: int,
    round_idx: int,
    has_laid_down: bool,
    opp_sizes: list,
) -> np.ndarray:
    """Build the 170-dim state vector for one decision point."""
    v = np.zeros(_STATE_DIM, dtype=np.float32)
    # [0:53] hand counts
    for c in hand:
        v[_ctype(c)] += 1.0
    # [53:106] seen counts
    for c, cnt in seen_dict.items():
        v[53 + _ctype(c)] += float(cnt)
    # [106:159] discard-top one-hot
    if discard_top >= 0:
        v[106 + _ctype(discard_top)] = 1.0
    # [159:166] round one-hot
    v[159 + min(round_idx, 6)] = 1.0
    # [166] has_laid_down
    v[166] = float(has_laid_down)
    # [167:170] opponent hand sizes, normalized
    for i, sz in enumerate(opp_sizes[:_MAX_OPP_SLOTS]):
        v[167 + i] = sz / 12.0
    return v


# ── Agent ─────────────────────────────────────────────────────────────────────

class ShanghaiNetAgent:
    """
    Hook dispatcher for ShanghaiNet in the Python engine.

    Attributes:
        trajectory: list of step dicts, populated during play_game().
            Each step has: state_vec, action_type, action_taken, hand, round_idx,
            has_laid_down, opp_sizes. Call reset() between games.
    """

    def __init__(
        self,
        model,
        player_idx: int,
        n_players: int = 4,
        temperature: float = 1.0,
        record: bool = True,
    ):
        self._model       = model
        self._player_idx  = player_idx
        self._n_players   = n_players
        self._temperature = temperature
        self._record      = record
        self.trajectory: list = []

    def reset(self) -> None:
        self.trajectory = []

    def _opp_sizes(self, round_idx: int) -> list:
        return [float(CARDS_DEALT[round_idx])] * (self._n_players - 1)

    def _state_vec(
        self, hand: list, discard_top: int, round_idx: int, has_laid_down: bool
    ) -> np.ndarray:
        return _build_state_vec(
            hand=hand,
            seen_dict={},
            discard_top=discard_top,
            round_idx=round_idx,
            has_laid_down=has_laid_down,
            opp_sizes=self._opp_sizes(round_idx),
        )

    @torch.no_grad()
    def _forward(self, state_vec: np.ndarray) -> dict:
        x = torch.from_numpy(state_vec).unsqueeze(0)  # (1, 170)
        self._model.eval()
        return self._model(x)

    def _sample_categorical(self, logits: torch.Tensor, mask: Optional[list] = None) -> int:
        """Sample from logits with temperature, optionally restricting to mask indices."""
        logits = logits.squeeze(0).float()
        if mask:  # non-empty mask: restrict to valid indices only
            neg_inf = torch.full_like(logits, float("-inf"))
            for idx in mask:
                neg_inf[idx] = logits[idx]
            logits = neg_inf
        probs = F.softmax(logits / max(self._temperature, 1e-6), dim=-1)
        return int(torch.multinomial(probs, 1).item())

    def _sample_binary(self, logit: torch.Tensor) -> int:
        logit_val = logit.squeeze().float().item()
        prob_1 = torch.sigmoid(torch.tensor(logit_val / max(self._temperature, 1e-6))).item()
        return 1 if np.random.random() < prob_1 else 0

    def _record_step(
        self, state_vec: np.ndarray, action_type: int, action_taken: int,
        hand: list, round_idx: int, has_laid_down: bool,
    ) -> None:
        if self._record:
            self.trajectory.append({
                "state_vec":     state_vec,
                "action_type":   action_type,
                "action_taken":  action_taken,
                "hand":          list(hand),
                "round_idx":     round_idx,
                "has_laid_down": has_laid_down,
                "opp_sizes":     self._opp_sizes(round_idx),
            })

    # ── Engine hooks ────────────────────────────────────────────────

    def discard(
        self,
        player_idx: int,
        hand: list,
        has_laid_down: bool,
        table_melds: list,
        round_idx: int,
    ) -> Optional[int]:
        if player_idx != self._player_idx:
            return None

        sv = self._state_vec(hand, -1, round_idx, has_laid_down)
        out = self._forward(sv)

        hand_types = list({_ctype(c) for c in hand})
        chosen_type = self._sample_categorical(out["discard_logits"], mask=hand_types)

        card = next((c for c in hand if _ctype(c) == chosen_type), None)
        if card is None:
            return None  # fallback to greedy

        self._record_step(sv, ACTION_DISCARD, chosen_type, hand, round_idx, has_laid_down)
        return card

    def draw(
        self,
        player_idx: int,
        hand: list,
        discard_top: int,
        has_laid_down: bool,
        round_idx: int,
    ) -> Optional[str]:
        if player_idx != self._player_idx:
            return None

        sv = self._state_vec(hand, discard_top, round_idx, has_laid_down)
        out = self._forward(sv)

        action = self._sample_categorical(out["draw_logits"])  # 0=pile, 1=take
        self._record_step(sv, ACTION_DRAW, action, hand, round_idx, has_laid_down)
        return "take" if action == 1 else "draw"

    def buy(
        self,
        player_idx: int,
        hand: list,
        discard_top: int,
        buys_remaining: int,
        has_laid_down: bool,
        round_idx: int,
    ) -> Optional[bool]:
        if player_idx != self._player_idx:
            return None

        sv = self._state_vec(hand, discard_top, round_idx, has_laid_down)
        out = self._forward(sv)

        action = self._sample_binary(out["buy_logit"])
        self._record_step(sv, ACTION_BUY, action, hand, round_idx, has_laid_down)
        return bool(action)

    def laydown(
        self,
        player_idx: int,
        hand: list,
        assignment: tuple,
        round_idx: int,
        has_laid_down,  # list[bool] in engine; extract own flag
    ) -> Optional[bool]:
        if player_idx != self._player_idx:
            return None

        # engine passes the full has_laid_down list; extract own flag
        own_ld = has_laid_down[player_idx] if isinstance(has_laid_down, (list, tuple)) else bool(has_laid_down)
        sv = self._state_vec(hand, -1, round_idx, own_ld)
        out = self._forward(sv)

        action = self._sample_binary(out["laydown_logit"])
        self._record_step(sv, ACTION_LAYDOWN, action, hand, round_idx, own_ld)
        return bool(action)
