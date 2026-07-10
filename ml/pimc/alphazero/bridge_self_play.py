"""
Bridge-based game collection for AlphaZero training.

Drop-in replacement for self_play.collect_games() that runs games through
the TypeScript engine instead of engine.py. This eliminates the rule gaps
identified in the audit:
  - Dealer rotation (TypeScript rotates; Python didn't)
  - Joker swaps (TypeScript AI uses them; Python never saw them)
  - Stalemate at 200 turns (not 120)
  - Correct draw-pile exhaustion handling

Player 0 uses the network for draw and discard decisions.
Opponents 1-3 are handled by the TypeScript AI personality set in BridgePool.
Buy windows use the bridge AI for player 0 (buy head training deferred).
Laydown is auto-executed by get_strategic_actions (greedy, same as bridge eval).

Output format is identical to collect_games() so train.py / value_labeler.py
are unchanged.
"""
from __future__ import annotations

import copy
import random
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

import numpy as np
import torch
import torch.nn.functional as F

_PIMC_DIR = Path(__file__).parent.parent
_TRAINING  = _PIMC_DIR.parent / "training"
for _p in [str(_PIMC_DIR), str(_TRAINING)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from alphazero.bridge_pool import BridgePool
from alphazero.constants import (
    ACTION_DISCARD, ACTION_DRAW,
    _STATE_DIM, _MAX_OPP_SLOTS,
)
from alphazero.agent import _ctype, _build_state_vec
from engine import CARDS_DEALT, JOKER_INT


# ── Card encoding: TypeScript dict → Python int ───────────────────────────────

_SUIT_TS_TO_INT = {'clubs': 0, 'diamonds': 1, 'hearts': 2, 'spades': 3}
_SUIT_ORDER_TS  = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3, 'joker': 4}


def _ts_to_int(card: dict) -> int:
    if card['suit'] == 'joker':
        return JOKER_INT
    return _SUIT_TS_TO_INT[card['suit']] * 16 + card['rank']


def _ts_sort_key(card: dict) -> tuple:
    rank = 14 if card['suit'] == 'joker' else card['rank']
    return (rank, _SUIT_ORDER_TS[card['suit']], card.get('id', ''))


def _find_discard_index(hand_cards: list, chosen_ctype: int) -> int:
    """
    Convert a network ctype choice (0-52) to the bridge discard:N index.

    The bridge sorts the hand rank-first with jokers last (sortHandForEncoding).
    We replicate that sort and find the first card matching the chosen type.
    """
    if chosen_ctype == 52:
        target_suit, target_rank = 'joker', None
    else:
        suit_idx    = chosen_ctype // 13          # 0=clubs 1=diamonds 2=hearts 3=spades
        target_rank = chosen_ctype % 13 + 1       # 1-13
        target_suit = ['clubs', 'diamonds', 'hearts', 'spades'][suit_idx]

    sorted_hand = sorted(hand_cards, key=_ts_sort_key)
    for i, c in enumerate(sorted_hand):
        if c['suit'] == target_suit:
            if target_suit == 'joker' or c['rank'] == target_rank:
                return i
    return len(sorted_hand) - 1   # fallback: last card


# ── Single game ───────────────────────────────────────────────────────────────

def _collect_one_game(
    env,
    model,
    n_players: int,
    temperature: float,
    rng: random.Random,
) -> dict:
    """
    Play one full game (7 rounds) through the bridge.

    Player 0's draw and discard decisions are made by the network.
    All other decisions (buy windows, laydown, layoff) are handled by the
    bridge's TypeScript AI — identical to how bridge eval works.

    Returns a trajectory dict compatible with value_labeler.label_values()
    and train.build_batch().
    """
    seed = rng.randint(0, 2 ** 31)
    env.reset(seed=seed)

    steps:            list  = []
    round_cumulative: dict  = {}
    seen_dict:        dict  = {}   # card_int → observation count, resets per round
    current_round:    int   = -1
    prev_cumulative:  float = 0.0
    done = False
    info: dict = {}

    while not done:
        actions, current_player, _ = env.get_strategic_actions()

        if not actions:
            break

        # ── Buy window: delegate to TypeScript AI, don't train on it ─────────
        if 'buy' in actions or 'decline_buy' in actions:
            action = env.get_ai_action()
            _, _, done, info = env.step(action)
            _update_round_tracking(info, round_cumulative, seen_dict,
                                   current_round, prev_cumulative)
            current_round, prev_cumulative = _extract_round_info(info, round_cumulative)
            continue

        # ── Safety: opponent somehow surfaced — shouldn't happen with ─────────
        # ── opponent_ai set, but guard cleanly ───────────────────────────────
        if current_player != 0:
            action = env.get_ai_action()
            _, _, done, info = env.step(action)
            _update_round_tracking(info, round_cumulative, seen_dict,
                                   current_round, prev_cumulative)
            current_round, prev_cumulative = _extract_round_info(info, round_cumulative)
            continue

        # ── Fetch game state from bridge ──────────────────────────────────────
        full      = env.get_full_state()
        round_idx = max(0, full.get('round', 1) - 1)

        if round_idx != current_round:
            seen_dict     = {}
            current_round = round_idx

        hand_cards = full.get('hand', [])
        hand_ints  = [_ts_to_int(c) for c in hand_cards]
        has_ld     = full.get('hasLaidDown', False)

        # Opponent sizes: default to CARDS_DEALT (no per-turn tracking for now)
        opp_sizes = [float(CARDS_DEALT[round_idx])] * min(n_players - 1, _MAX_OPP_SLOTS)

        # ── Draw decision ─────────────────────────────────────────────────────
        if 'draw_pile' in actions or 'take_discard' in actions:
            discard_top_raw = full.get('discardTop')
            discard_int     = _ts_to_int(discard_top_raw) if discard_top_raw else -1
            if discard_int >= 0:
                seen_dict[discard_int] = seen_dict.get(discard_int, 0) + 1

            sv  = _build_state_vec(hand_ints, seen_dict, discard_int,
                                   round_idx, has_ld, opp_sizes)
            out = _forward(model, sv)

            logits = out['draw_logits'].squeeze(0).float()
            if 'take_discard' not in actions:
                logits[1] = float('-inf')   # pile-only when discard not offered

            probs      = F.softmax(logits / max(temperature, 1e-6), dim=-1)
            action_idx = int(torch.multinomial(probs, 1).item())
            log_prob   = float(F.log_softmax(logits, dim=-1)[action_idx].item())

            action = 'take_discard' if action_idx == 1 else 'draw_pile'
            steps.append(_make_step(sv, ACTION_DRAW, action_idx,
                                    hand_ints, round_idx, has_ld, opp_sizes, log_prob))

        # ── Discard decision ──────────────────────────────────────────────────
        elif any(a.startswith('discard:') for a in actions):
            sv  = _build_state_vec(hand_ints, seen_dict, -1,
                                   round_idx, has_ld, opp_sizes)
            out = _forward(model, sv)

            logits = out['discard_logits'].squeeze(0).float()
            masked = torch.full((53,), float('-inf'))
            for ct in {_ctype(c) for c in hand_ints}:
                masked[ct] = logits[ct]

            probs        = F.softmax(masked / max(temperature, 1e-6), dim=-1)
            chosen_ctype = int(torch.multinomial(probs, 1).item())
            log_prob     = float(F.log_softmax(masked, dim=-1)[chosen_ctype].item())

            discard_idx  = _find_discard_index(hand_cards, chosen_ctype)
            action       = f'discard:{discard_idx}'
            steps.append(_make_step(sv, ACTION_DISCARD, chosen_ctype,
                                    hand_ints, round_idx, has_ld, opp_sizes, log_prob))

        else:
            action = actions[0]

        _, _, done, info = env.step(action)
        _update_round_tracking(info, round_cumulative, seen_dict,
                               current_round, prev_cumulative)
        current_round, prev_cumulative = _extract_round_info(info, round_cumulative)

    # Tag terminal step
    for i, step in enumerate(steps):
        step['is_terminal'] = (i == len(steps) - 1)

    final_scores = info.get('scores') or [0] * n_players
    final_score  = float(final_scores[0])

    # Ensure last round is recorded in cumulative map
    if current_round >= 0:
        round_cumulative.setdefault(current_round, final_score)

    return {
        'steps':            steps,
        'final_score':      final_score,
        'round_cumulative': round_cumulative,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

@torch.no_grad()
def _forward(model, sv: np.ndarray) -> dict:
    x = torch.from_numpy(sv).unsqueeze(0)
    return model(x)


def _make_step(
    sv: np.ndarray,
    action_type: int,
    action_taken: int,
    hand: list,
    round_idx: int,
    has_ld: bool,
    opp_sizes: list,
    log_prob: float,
) -> dict:
    return {
        'state_vec':     sv,
        'action_type':   action_type,
        'action_taken':  action_taken,
        'hand':          list(hand),
        'round_idx':     round_idx,
        'has_laid_down': has_ld,
        'opp_sizes':     opp_sizes,
        'log_prob_old':  log_prob,
        'is_terminal':   False,
    }


def _update_round_tracking(
    info: dict,
    round_cumulative: dict,
    seen_dict: dict,
    current_round: int,
    prev_cumulative: float,
) -> None:
    """Record round-end cumulative score when the round changes."""
    info_round = max(0, info.get('round', 1) - 1)
    if info_round != current_round and current_round >= 0:
        scores = info.get('scores') or [0]
        round_cumulative[current_round] = float(scores[0])


def _extract_round_info(info: dict, round_cumulative: dict) -> tuple:
    """Return (current_round_idx, cumulative_score_so_far)."""
    round_idx  = max(0, info.get('round', 1) - 1)
    scores     = info.get('scores') or [0]
    cumulative = float(scores[0])
    return round_idx, cumulative


# ── Parallel collection ───────────────────────────────────────────────────────

def collect_games_bridge(
    network,
    n_games: int,
    pool: BridgePool,
    temperature: float = 1.0,
    seed: Optional[int] = None,
) -> List[dict]:
    """
    Collect n_games games via the TypeScript bridge using pool.n_workers
    parallel bridge processes.

    Returns the same format as self_play.collect_games() so that
    value_labeler.label_values() and train.build_batch() work unchanged.
    """
    network.eval()
    rng = random.Random(seed)

    n_workers       = pool.n_workers
    games_per_worker = [n_games // n_workers] * n_workers
    for i in range(n_games % n_workers):
        games_per_worker[i] += 1

    worker_seeds = [rng.randint(0, 2 ** 31) for _ in range(n_workers)]

    def _worker(env_idx: int, n: int, wseed: int) -> List[dict]:
        env        = pool.envs[env_idx]
        model_copy = copy.deepcopy(network)
        model_copy.eval()
        wrng       = random.Random(wseed)
        return [
            _collect_one_game(env, model_copy, pool.player_count, temperature, wrng)
            for _ in range(n)
        ]

    trajectories: List[dict] = []
    with ThreadPoolExecutor(max_workers=n_workers) as executor:
        futures = {
            executor.submit(_worker, i, games_per_worker[i], worker_seeds[i]): i
            for i in range(n_workers)
            if games_per_worker[i] > 0
        }
        for future in as_completed(futures):
            trajectories.extend(future.result())

    return trajectories
