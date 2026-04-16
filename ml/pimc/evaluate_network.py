"""
Evaluate trained PIMCNet as a direct player against greedy opponents.

Loads models/network_v1.pt and uses PIMCNet.predict_discard / predict_draw
as drop-in hooks for play_game().  No rollouts — each decision is a single
~1ms forward pass, so 200 games finish in ~2–3 minutes.

The purpose is to answer: where does the network land on the score scale?
  Greedy P0: ~350   Human: 227   Mastermind: 219   PIMC-40R: 220

Interpretation:
  Lower avg score = better.
  Win rate > 25% (4P) means positive EV vs greedy field.

Usage:
    python evaluate_network.py                         # 200 games, 4P, full mode
    python evaluate_network.py --games 50              # quick check
    python evaluate_network.py --discard-only          # net discard, greedy draw
    python evaluate_network.py --model network_v1.pt   # explicit checkpoint
"""

import argparse
import json
import sys
import time
from pathlib import Path
from statistics import mean, stdev
from typing import Optional

import torch
import numpy as np

# ── Path setup ────────────────────────────────────────────────────
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from engine import play_game, DECK_COUNT, JOKER_INT, CARDS_DEALT
from collect_data import _ctype, build_state_vec
from train_network import PIMCNet
from evaluate_pimc import _Tee

# PIMCDiscardNet imported lazily — only if a v2 checkpoint is detected

# ── Benchmarks ────────────────────────────────────────────────────
HUMAN_AVG      = 227.0
MASTERMIND_AVG = 219.0   # standalone 4P benchmark
PIMC_40R_AVG   = 220.4   # PIMC discard+draw, 40 rollouts vs greedy
GREEDY_P0_AVG  = 349.7   # greedy P0 vs greedy P1-3 (first-mover baseline)


# ── Model loading ─────────────────────────────────────────────────

def load_model(model_path: Path) -> tuple:
    """
    Load a network checkpoint, auto-detecting checkpoint type.

    Three types:
      v1 (PIMCNet):              draw_head.weight shape != (1, 256)
      v2 (PIMCDiscardNet):       no draw_head.weight
      v3 (PIMCDiscardNet+draw):  draw_head.weight shape == (1, 256)

    Returns:
        (model, is_discard_only) — False means model has a draw head.
    """
    from train_network_v2 import PIMCDiscardNet
    state_dict = torch.load(model_path, map_location="cpu", weights_only=True)
    has_draw = "draw_head.weight" in state_dict
    is_v3    = has_draw and tuple(state_dict["draw_head.weight"].shape) == (1, 256)

    if has_draw and not is_v3:
        # v1: dual-head PIMCNet (old architecture, draw head shape != (1,256))
        model = PIMCNet()
        model.load_state_dict(state_dict)
        model.eval()
        return model, False

    if is_v3:
        # v3: PIMCDiscardNet with co-trained draw head
        model = PIMCDiscardNet()
        model.load_state_dict(state_dict)
        model.eval()
        return model, False   # has draw head → discard_only=False

    # v2: discard-only PIMCDiscardNet (no draw head in checkpoint)
    # Build model without draw head by loading into a fresh PIMCDiscardNet
    # that may or may not have draw_head depending on current code — use strict=False
    model = PIMCDiscardNet()
    model.load_state_dict(state_dict, strict=False)
    model.eval()
    return model, True


# ── Card-type index → card int ────────────────────────────────────

def _type_to_card(type_idx: int, hand: list) -> Optional[int]:
    """Find the first card in hand whose type index matches type_idx.

    predict_discard() masks to hand-present types, so this should always
    succeed.  Returns None only if masking has a bug (triggers fallback).
    """
    for c in hand:
        if _ctype(c) == type_idx:
            return c
    return None


# ── Network hook ──────────────────────────────────────────────────

class NetworkHook:
    """
    Wraps PIMCNet as discard_hook + draw_hook for use with play_game().

    State vector is built with seen_dict={} (zeros), matching the training
    distribution: the data collector used a fresh PIMCAgent per round with
    an empty CardTracker, so seen slots were always zero in training data.

    Opponent hand sizes use CARDS_DEALT[round_idx] as a flat estimate — the
    same approximation used during data collection.
    """

    def __init__(self, model: PIMCNet, player_idx: int, n_players: int):
        self._model    = model
        self._player_idx = player_idx
        self._n_players  = n_players
        self.decisions  = 0
        self.fallbacks  = 0   # predict_discard returned a type not in hand

    def _opp_sizes(self, round_idx: int) -> list:
        return [CARDS_DEALT[round_idx]] * (self._n_players - 1)

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

        sv = build_state_vec(
            hand=hand,
            seen_dict={},
            discard_top=-1,
            round_idx=round_idx,
            has_laid_down=has_laid_down,
            opp_sizes=self._opp_sizes(round_idx),
        )
        state_t  = torch.from_numpy(sv).unsqueeze(0)       # (1, 170)
        type_idx = int(self._model.predict_discard(state_t).item())
        card     = _type_to_card(type_idx, hand)
        self.decisions += 1
        if card is None:
            # Masking should prevent this; fall back to greedy if it happens
            self.fallbacks += 1
            return None
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

        sv = build_state_vec(
            hand=hand,
            seen_dict={},
            discard_top=discard_top,
            round_idx=round_idx,
            has_laid_down=has_laid_down,
            opp_sizes=self._opp_sizes(round_idx),
        )
        state_t = torch.from_numpy(sv).unsqueeze(0)
        action  = int(self._model.predict_draw(state_t).item())
        self.decisions += 1
        return "take" if action == 1 else "draw"


# ── Evaluation runner ─────────────────────────────────────────────

def run_evaluation(
    n_games: int,
    n_players: int,
    seed: int,
    model: PIMCNet,
    discard_only: bool = False,
) -> dict:
    """
    Run n_games with NetworkHook as player 0 vs greedy opponents.

    Args:
        discard_only: If True, use network for discard only and greedy draw.
                      Useful to isolate how much the draw head contributes.
    """
    import random as _random
    rng          = _random.Random(seed)
    p0_scores: list = []
    opp_avgs:  list = []
    wins             = 0
    total_decisions  = 0
    total_fallbacks  = 0

    t_start = time.perf_counter()
    for game_i in range(n_games):
        hook = NetworkHook(model=model, player_idx=0, n_players=n_players)

        scores = play_game(
            n_players, rng, DECK_COUNT,
            discard_hook=hook.discard,
            draw_hook=None if discard_only else hook.draw,
        )

        p0_scores.append(scores[0])
        opp_avgs.append(mean(scores[1:]))
        if scores[0] == min(scores):
            wins += 1
        total_decisions += hook.decisions
        total_fallbacks += hook.fallbacks

        elapsed  = time.perf_counter() - t_start
        cur_p0   = mean(p0_scores)
        cur_opp  = mean(opp_avgs)
        cur_wr   = wins / (game_i + 1)
        rate     = (game_i + 1) / elapsed
        print(
            f"  game {game_i+1:3d}/{n_games}"
            f"  p0={cur_p0:5.0f}  opp={cur_opp:5.0f}"
            f"  wr={cur_wr:.0%}"
            f"  {rate:.2f}g/s",
            flush=True,
        )

    p0_avg = mean(p0_scores)
    p0_std = stdev(p0_scores) if len(p0_scores) > 1 else 0.0
    opp_avg = mean(opp_avgs)

    return {
        "n_games":      n_games,
        "n_players":    n_players,
        "p0_avg":       p0_avg,
        "p0_std":       p0_std,
        "opp_avg":      opp_avg,
        "win_rate":     wins / n_games,
        "p0_scores":    p0_scores,
        "opp_avgs":     opp_avgs,
        "decisions":    total_decisions,
        "fallbacks":    total_fallbacks,
        "discard_only": discard_only,
    }


# ── Output ────────────────────────────────────────────────────────

def _print_result(result: dict, model_name: str, elapsed: float) -> None:
    n        = result["n_games"]
    p0_avg   = result["p0_avg"]
    p0_std   = result["p0_std"]
    opp_avg  = result["opp_avg"]
    wr       = result["win_rate"]
    n_p      = result["n_players"]
    mode_lbl = "discard-only (greedy draw)" if result["discard_only"] else "full (discard + draw)"

    se = p0_std / (n ** 0.5)

    print(f"\n{'='*60}")
    print(f"  Network Evaluator Results")
    print(f"  Model  : {model_name}")
    print(f"  Mode   : {mode_lbl}")
    print(f"{'='*60}")
    print(f"  Games          : {n}")
    print(f"  Avg score (P0) : {p0_avg:.1f} ± {p0_std:.1f}  (SE ± {se:.1f})")
    print(f"  Opp avg        : {opp_avg:.1f}")
    print(f"  Win rate       : {wr:.1%}  (random = {1/n_p:.0%})")
    print()
    print(f"  vs Greedy P0   : {GREEDY_P0_AVG - p0_avg:+.1f} pts  (greedy={GREEDY_P0_AVG:.0f})")
    print(f"  vs Human avg   : {HUMAN_AVG - p0_avg:+.1f} pts  (human={HUMAN_AVG:.0f})")
    print(f"  vs Mastermind  : {MASTERMIND_AVG - p0_avg:+.1f} pts  (mm={MASTERMIND_AVG:.0f})")
    print(f"  vs PIMC-40R    : {PIMC_40R_AVG - p0_avg:+.1f} pts  (pimc={PIMC_40R_AVG:.0f})")
    if result["fallbacks"]:
        print(f"\n  Fallbacks      : {result['fallbacks']}/{result['decisions']} decisions (masking bug)")
    print(f"\n  Elapsed        : {elapsed:.0f}s")
    print(f"{'='*60}")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate PIMCNet as a direct player against greedy opponents"
    )
    parser.add_argument("--games",        type=int,  default=200,
                        help="Games to play (default: 200)")
    parser.add_argument("--players",      type=int,  default=4,
                        help="Number of players (default: 4)")
    parser.add_argument("--seed",         type=int,  default=42,
                        help="RNG seed (default: 42)")
    parser.add_argument("--model",        type=str,  default="network_v1.pt",
                        help="Checkpoint filename in models/ (default: network_v1.pt)")
    parser.add_argument("--discard-only", action="store_true",
                        help="Network discard only; greedy draw")
    parser.add_argument("--no-log",       action="store_true",
                        help="Skip tee logging to logs/evaluate_network.log")
    args = parser.parse_args()

    if not args.no_log:
        log_dir  = _HERE / "logs"
        log_dir.mkdir(exist_ok=True)
        log_path = log_dir / "evaluate_network.log"
        fh = open(log_path, "a", encoding="utf-8")
        fh.write(f"\n{'='*60}\n")
        fh.write(f"Run started: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        fh.write(f"Args: {' '.join(sys.argv[1:])}\n")
        fh.write(f"{'='*60}\n")
        sys.stdout = _Tee(sys.__stdout__, fh)
        sys.stderr = _Tee(sys.__stderr__, fh)

    model_path = _HERE / "models" / args.model
    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}", file=sys.stderr)
        sys.exit(1)

    print(f"\nLoading model: {model_path}")
    model, is_v2 = load_model(model_path)
    if is_v2:
        args.discard_only = True   # v2 has no draw head — force discard-only
    n_params = sum(p.numel() for p in model.parameters())
    print(f"  Parameters: {n_params:,}  ({'v2 discard-only' if is_v2 else 'v1 dual-head'})")
    mode_str = "discard-only (greedy draw)" if args.discard_only else "full (discard + draw)"
    print(f"  Mode: {mode_str}")
    print(f"\nRunning {args.games} games ({args.players}P)  seed={args.seed}")
    print()

    t_start = time.perf_counter()
    result   = run_evaluation(
        n_games=args.games,
        n_players=args.players,
        seed=args.seed,
        model=model,
        discard_only=args.discard_only,
    )
    elapsed = time.perf_counter() - t_start

    _print_result(result, model_path.name, elapsed)

    # Save JSON report (exclude raw score arrays to keep it readable)
    ts          = time.strftime("%Y%m%d_%H%M%S")
    report_path = _HERE / "logs" / f"eval_network_{ts}.json"
    report_out  = {k: v for k, v in result.items() if k not in ("p0_scores", "opp_avgs")}
    report_out["elapsed_s"]  = elapsed
    report_out["model"]      = args.model
    with open(report_path, "w") as f:
        json.dump(report_out, f, indent=2)
    print(f"\nReport saved: {report_path}")


if __name__ == "__main__":
    main()
