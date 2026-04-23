"""
ShanghaiNetAgent — wraps ShanghaiNet as engine hook callables.

Produces discard_hook, draw_hook, buy_hook, laydown_hook compatible with
engine.play_game(). Only records trajectory steps for its own player_idx;
returns None for all other players (engine uses greedy fallback).

State tracking across hooks
----------------------------
All four hooks are called for every player, not just player 0.  The agent
exploits this to maintain accurate per-round state:

  _seen_dict  — maps card_int → count of times that card appeared on top of
                the discard pile this round (populated from discard_top in
                draw() and buy() hooks after every discard).  Resets each round.

  _hand_sizes — maps player_idx → most recently observed hand size, inferred
                from the `hand` argument passed to each hook.  Resets each round.

Both are fed into _build_state_vec so the full 170-dim state vector is
populated, matching the feature distribution from PIMC training.

Eval mode
---------
The model must be set to eval() before play starts (done once in
collect_games, not per call). _forward() does NOT call model.eval().
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
from alphazero.constants import (
    ACTION_DISCARD, ACTION_DRAW, ACTION_BUY, ACTION_LAYDOWN,
    _STATE_DIM, _MAX_OPP_SLOTS,
)


def _ctype(card_int: int) -> int:
    """Map card int → compact type index 0-52."""
    if card_int == JOKER_INT:
        return 52
    suit = card_int >> 4
    rank = card_int & 15
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
    for c in hand:
        v[_ctype(c)] += 1.0
    for c, cnt in seen_dict.items():
        v[53 + _ctype(c)] += float(cnt)
    if discard_top >= 0:
        v[106 + _ctype(discard_top)] = 1.0
    v[159 + min(round_idx, 6)] = 1.0
    v[166] = float(has_laid_down)
    for i, sz in enumerate(opp_sizes[:_MAX_OPP_SLOTS]):
        v[167 + i] = sz / 12.0
    return v


class ShanghaiNetAgent:
    """
    Hook dispatcher for ShanghaiNet in the Python engine.

    Attributes:
        trajectory: list of step dicts, populated during play_game().
            Each step has: state_vec, action_type, action_taken, hand,
            round_idx, has_laid_down, opp_sizes. Call reset() between games.
    """

    def __init__(
        self,
        model,
        player_idx: int,
        n_players: int = 4,
        temperature: float = 1.0,
        record: bool = True,
    ):
        self._model         = model
        self._player_idx    = player_idx
        self._n_players     = n_players
        self._temperature   = temperature
        self._record        = record
        self.trajectory:    list = []
        self._seen_dict:    dict = {}
        self._hand_sizes:   dict = {}
        self._current_round: int = -1

    def reset(self) -> None:
        self.trajectory     = []
        self._seen_dict     = {}
        self._hand_sizes    = {}
        self._current_round = -1

    # ── Shared state helpers (called for ALL players) ────────────────

    def _maybe_new_round(self, round_idx: int) -> None:
        if round_idx != self._current_round:
            self._seen_dict     = {}
            self._hand_sizes    = {}
            self._current_round = round_idx

    def _observe(self, player_idx: int, hand: list, discard_top: int = -1) -> None:
        """Track hand size and any visible discard-top card."""
        self._hand_sizes[player_idx] = len(hand)
        if discard_top >= 0:
            self._seen_dict[discard_top] = self._seen_dict.get(discard_top, 0) + 1

    def _opp_sizes(self, round_idx: int) -> list:
        default = float(CARDS_DEALT[round_idx])
        return [
            float(self._hand_sizes.get(p, default))
            for p in range(self._n_players)
            if p != self._player_idx
        ][:_MAX_OPP_SLOTS]

    def _state_vec(
        self, hand: list, discard_top: int, round_idx: int, has_laid_down: bool
    ) -> np.ndarray:
        return _build_state_vec(
            hand=hand,
            seen_dict=self._seen_dict,
            discard_top=discard_top,
            round_idx=round_idx,
            has_laid_down=has_laid_down,
            opp_sizes=self._opp_sizes(round_idx),
        )

    # ── Inference helpers ─────────────────────────────────────────────

    @torch.no_grad()
    def _forward(self, state_vec: np.ndarray) -> dict:
        """Forward pass. Caller must ensure model is in eval() mode."""
        x = torch.from_numpy(state_vec).unsqueeze(0)  # (1, 170)
        return self._model(x)

    def _sample_categorical(self, logits: torch.Tensor, mask: Optional[list] = None) -> int:
        logits = logits.squeeze(0).float()
        if mask:
            neg_inf = torch.full_like(logits, float("-inf"))
            for idx in mask:
                neg_inf[idx] = logits[idx]
            logits = neg_inf
        probs = F.softmax(logits / max(self._temperature, 1e-6), dim=-1)
        return int(torch.multinomial(probs, 1).item())

    def _sample_binary(self, logit: torch.Tensor) -> int:
        scaled = logit.squeeze().float() / max(self._temperature, 1e-6)
        return int(torch.bernoulli(torch.sigmoid(scaled)).item())

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

    # ── Engine hooks — called for ALL players ─────────────────────────

    def discard(
        self,
        player_idx: int,
        hand: list,
        has_laid_down: bool,
        table_melds: list,
        round_idx: int,
    ) -> Optional[int]:
        self._maybe_new_round(round_idx)
        self._observe(player_idx, hand)   # no discard_top available here

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
        self._maybe_new_round(round_idx)
        self._observe(player_idx, hand, discard_top)  # discard_top = card just played

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
        self._maybe_new_round(round_idx)
        self._observe(player_idx, hand, discard_top)

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
        self._maybe_new_round(round_idx)
        self._observe(player_idx, hand)

        if player_idx != self._player_idx:
            return None

        own_ld = has_laid_down[player_idx] if isinstance(has_laid_down, (list, tuple)) else bool(has_laid_down)
        sv = self._state_vec(hand, -1, round_idx, own_ld)
        out = self._forward(sv)

        action = self._sample_binary(out["laydown_logit"])
        self._record_step(sv, ACTION_LAYDOWN, action, hand, round_idx, own_ld)
        return bool(action)
