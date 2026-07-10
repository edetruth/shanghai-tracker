"""
PIMC Evaluator — measures whether PIMC discard decisions beat greedy.

Player 0 uses PIMCAgent.choose_discard() for every discard.
Players 1..n-1 use the engine's built-in greedy discard.

Usage:
    python evaluate_pimc.py                          # 50 games, 20 rollouts, 4P
    python evaluate_pimc.py --games 100 --rollouts 10
    python evaluate_pimc.py --sweep                  # rollouts in [0,5,10,20,40]
    python evaluate_pimc.py --baseline-only          # greedy vs greedy (sanity check)

Interpretation:
  Delta > 0 means PIMC player 0 scores LOWER (better) than greedy average.
  Win rate > 25% (4P) / 33% (3P) suggests positive EV.
"""

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from statistics import mean, stdev
from typing import Optional

from engine import play_game, DECK_COUNT
from pimc import PIMCAgent


# ─────────────────────────────────────────────────────────────
# Logging (tee stdout/stderr to logs/evaluate_pimc.log)
# ─────────────────────────────────────────────────────────────

class _Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)
            s.flush()

    def flush(self):
        for s in self.streams:
            s.flush()


def _setup_logging() -> None:
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "evaluate_pimc.log"
    fh = open(log_file, "a", encoding="utf-8")
    fh.write(f"\n{'='*60}\n")
    fh.write(f"Run started: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    fh.write(f"Args: {' '.join(sys.argv[1:])}\n")
    fh.write(f"{'='*60}\n")
    sys.stdout = _Tee(sys.__stdout__, fh)
    sys.stderr = _Tee(sys.__stderr__, fh)


# ─────────────────────────────────────────────────────────────
# Per-game PIMC state wrapper
# ─────────────────────────────────────────────────────────────

class _RoundAwarePIMCHook:
    """
    Wraps PIMCAgent so round_idx is always current.

    A fresh PIMCAgent is created at the start of each new round
    (identified by the round_idx arg the engine passes to the hook).
    The agent's CardTracker starts empty — it samples from the full
    unseen pool, which is a conservative but valid approximation
    (the real unseen pool is always a subset).
    """

    def __init__(
        self,
        player_idx: int,
        n_players: int,
        n_rollouts: int,
        base_seed: int,
        n_workers: int = 1,
    ):
        self._player_idx = player_idx
        self._n_players = n_players
        self._n_rollouts = n_rollouts
        self._base_seed = base_seed
        self._n_workers = n_workers
        self._agent: Optional[PIMCAgent] = None
        self._current_round = -1

    def _get_agent(self, round_idx: int) -> PIMCAgent:
        """Return agent for the current round, rebuilding on round change."""
        if round_idx != self._current_round:
            self._current_round = round_idx
            self._agent = PIMCAgent(
                player_idx=self._player_idx,
                n_players=self._n_players,
                round_idx=round_idx,
                seed=self._base_seed + round_idx * 997,
                n_workers=self._n_workers,
            )
        return self._agent

    def discard(
        self,
        player_idx: int,
        hand: list,
        has_laid_down: bool,
        table_melds: list,
        round_idx: int,
    ) -> Optional[int]:
        """discard_hook: returns card_int to discard, or None (= use greedy)."""
        if player_idx != self._player_idx:
            return None
        return self._get_agent(round_idx).choose_discard(
            hand, n_rollouts=self._n_rollouts, my_has_laid_down=has_laid_down
        )

    def draw(
        self,
        player_idx: int,
        hand: list,
        discard_top: int,
        has_laid_down: bool,
        round_idx: int,
    ) -> Optional[str]:
        """draw_hook: returns 'take' or 'draw', or None (= use greedy)."""
        if player_idx != self._player_idx:
            return None
        return self._get_agent(round_idx).choose_draw(
            hand, discard_top, n_rollouts=self._n_rollouts, my_has_laid_down=has_laid_down
        )


# ─────────────────────────────────────────────────────────────
# Evaluation runner
# ─────────────────────────────────────────────────────────────

def run_evaluation(
    n_games: int,
    n_rollouts: int,
    n_players: int,
    seed: int,
    use_pimc: bool = True,
    n_workers: int = 1,
) -> dict:
    """
    Run n_games and collect scores.

    Args:
        use_pimc: If True, player 0 uses PIMC discard. If False, all greedy.
    Returns dict with avg/std/win_rate/scores for player 0 and greedy opponents.
    """
    rng = random.Random(seed)
    p0_scores: list = []
    opp_avgs: list = []  # per-game average of P1..P{n-1}
    wins = 0

    t_start = time.perf_counter()
    for game_i in range(n_games):
        discard_hook = None
        draw_hook = None
        if use_pimc:
            pimc_hooks = _RoundAwarePIMCHook(
                player_idx=0,
                n_players=n_players,
                n_rollouts=n_rollouts,
                base_seed=rng.randint(0, 2 ** 31),
                n_workers=n_workers,
            )
            discard_hook = pimc_hooks.discard
            draw_hook = pimc_hooks.draw

        scores = play_game(
            n_players, rng, DECK_COUNT,
            discard_hook=discard_hook,
            draw_hook=draw_hook,
        )

        p0_scores.append(scores[0])
        opp_avgs.append(mean(scores[1:]))
        if scores[0] == min(scores):
            wins += 1

        # Progress line after each game
        elapsed = time.perf_counter() - t_start
        cur_p0 = mean(p0_scores)
        cur_opp = mean(opp_avgs)
        cur_wr = wins / (game_i + 1)
        rate = (game_i + 1) / elapsed
        print(
            f"  game {game_i+1:3d}/{n_games}"
            f"  p0={cur_p0:5.0f}  opp={cur_opp:5.0f}"
            f"  wr={cur_wr:.0%}"
            f"  {rate:.1f}g/s",
            flush=True,
        )

    def _stats(vals: list) -> tuple:
        avg = mean(vals)
        sd = stdev(vals) if len(vals) > 1 else 0.0
        return avg, sd

    p0_avg, p0_std = _stats(p0_scores)
    opp_avg, opp_std = _stats(opp_avgs)

    return {
        "n_games": n_games,
        "n_rollouts": n_rollouts,
        "n_players": n_players,
        "p0_avg": p0_avg,
        "p0_std": p0_std,
        "opp_avg": opp_avg,
        "opp_std": opp_std,
        "win_rate": wins / n_games,
        "p0_scores": p0_scores,
        "opp_avgs": opp_avgs,
    }


# ─────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────

def _print_result(results: dict, label: str, elapsed: float, n_players: int) -> None:
    n = results["n_games"]
    p0a = results["p0_avg"]
    p0s = results["p0_std"]
    opa = results["opp_avg"]
    ops = results["opp_std"]
    wr = results["win_rate"]
    expected_wr = 1.0 / n_players

    delta = opa - p0a  # positive = PIMC lower (better)
    wr_delta = wr - expected_wr

    print(f"  [{label}]  {n} games  {elapsed:.1f}s  ({n/elapsed:.1f} games/sec)")
    print(f"    P0 (PIMC)  : avg {p0a:6.1f}  +/- {p0s:5.1f}")
    print(f"    P1+ (greedy): avg {opa:6.1f}  +/- {ops:5.1f}")
    print(f"    Score delta : {delta:+.1f}  (positive = PIMC better)")
    print(f"    Win rate    : {wr:.1%}  (random={expected_wr:.0%}, delta={wr_delta:+.1%})")
    print()


def _print_baseline(results: dict, elapsed: float) -> None:
    n = results["n_games"]
    p0a = results["p0_avg"]
    opa = results["opp_avg"]
    n_players = results["n_players"]
    wr = results["win_rate"]
    expected_wr = 1.0 / n_players

    print(f"  [baseline: all greedy]  {n} games  {elapsed:.1f}s  ({n/elapsed:.1f} games/sec)")
    print(f"    All players greedy. Expect symmetry: P0 avg == P1+ avg.")
    print(f"    P0 avg : {p0a:.1f}   P1+ avg : {opa:.1f}   (delta {opa - p0a:+.1f})")
    print(f"    P0 win : {wr:.1%}   (expected {expected_wr:.0%})")
    print()


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

def _save_report(
    baseline: dict,
    sweep_results: list,  # list of dicts from run_evaluation
    args,
    total_elapsed: float,
) -> None:
    """Write a compact JSON + human-readable text report to logs/."""
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    stem = f"pimc_report_{ts}"

    # ── JSON (machine-readable) ───────────────────────────────
    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "args": {
            "games": args.games,
            "players": args.players,
            "seed": args.seed,
            "sweep": args.sweep,
        },
        "baseline": {
            "p0_avg": round(baseline["p0_avg"], 1),
            "opp_avg": round(baseline["opp_avg"], 1),
            "win_rate": round(baseline["win_rate"], 3),
        },
        "sweep": [
            {
                "rollouts": r["n_rollouts"],
                "p0_avg": round(r["p0_avg"], 1),
                "p0_std": round(r["p0_std"], 1),
                "opp_avg": round(r["opp_avg"], 1),
                "delta": round(r["opp_avg"] - r["p0_avg"], 1),
                "win_rate": round(r["win_rate"], 3),
            }
            for r in sweep_results
        ],
        "total_elapsed_sec": round(total_elapsed, 1),
    }
    json_path = log_dir / f"{stem}.json"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    # ── Text summary (human-readable) ────────────────────────
    lines = [
        f"PIMC Sweep Report — {report['timestamp']}",
        f"Games: {args.games}  Players: {args.players}  Seed: {args.seed}",
        f"Total time: {total_elapsed/3600:.1f}h",
        "",
        f"Benchmarks: Human=227  Mastermind=219  Greedy-P0={baseline['p0_avg']:.1f}",
        "",
        f"{'Rollouts':>10} {'P0 avg':>8} {'Opp avg':>8} {'Delta':>7} {'Win%':>6} {'vs Human':>9} {'vs MM':>7}",
        "-" * 62,
    ]
    for r in sweep_results:
        delta = r["opp_avg"] - r["p0_avg"]
        vs_human = r["p0_avg"] - 227
        vs_mm = r["p0_avg"] - 218.8
        lines.append(
            f"{r['n_rollouts']:>10d}"
            f" {r['p0_avg']:>8.1f}"
            f" {r['opp_avg']:>8.1f}"
            f" {delta:>+7.1f}"
            f" {r['win_rate']:>6.1%}"
            f" {vs_human:>+9.1f}"
            f" {vs_mm:>+7.1f}"
        )
    txt_path = log_dir / f"{stem}.txt"
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\nReport saved:")
    print(f"  {json_path}")
    print(f"  {txt_path}")


def main() -> None:
    _setup_logging()
    parser = argparse.ArgumentParser(description="Evaluate PIMC vs greedy discard")
    parser.add_argument("--games",         type=int, default=20,
                        help="Games per evaluation (default 20)")
    parser.add_argument("--rollouts",      type=int, default=10,
                        help="PIMC rollouts per discard decision (default 10)")
    parser.add_argument("--players",       type=int, default=4,
                        help="Number of players (default 4)")
    parser.add_argument("--seed",          type=int, default=42,
                        help="RNG seed (default 42)")
    parser.add_argument("--sweep",         action="store_true",
                        help="Sweep rollout counts [0,5,10,20,40]")
    parser.add_argument("--baseline-only", action="store_true",
                        help="Run greedy-vs-greedy only (sanity check)")
    parser.add_argument("--workers",       type=int, default=os.cpu_count(),
                        help=f"Parallel rollout workers (default: {os.cpu_count()} = cpu_count)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Print per-game scores")
    args = parser.parse_args()

    header = (
        f"PIMC Evaluator — {args.players}P, seed={args.seed}, workers={args.workers}\n"
        f"Engine baseline: ~332 avg (greedy). Human avg: 227. Mastermind: 219.\n"
    )
    print(header)

    # ── Greedy baseline first (always run) ────────────────────
    print("Running greedy baseline (all players use engine greedy)...")
    t0 = time.perf_counter()
    baseline = run_evaluation(
        args.games, 0, args.players, args.seed, use_pimc=False, n_workers=1
    )
    _print_baseline(baseline, time.perf_counter() - t0)

    if args.baseline_only:
        return

    # ── Sweep mode ────────────────────────────────────────────
    if args.sweep:
        sweep_rollouts = [5, 10, 20, 40]
        print(f"Sweep mode: rollouts in {sweep_rollouts}, {args.games} games each\n")
        t_sweep_start = time.perf_counter()
        all_results = []
        for nr in sweep_rollouts:
            print(f"Running PIMC with {nr} rollouts...")
            t0 = time.perf_counter()
            results = run_evaluation(args.games, nr, args.players, args.seed, n_workers=args.workers)
            elapsed = time.perf_counter() - t0
            label = f"rollouts={nr:2d}"
            _print_result(results, label, elapsed, args.players)
            all_results.append(results)
        _save_report(baseline, all_results, args, time.perf_counter() - t_sweep_start)
        return

    # ── Single evaluation ─────────────────────────────────────
    print(f"Running PIMC evaluation ({args.rollouts} rollouts/decision)...")
    t0 = time.perf_counter()
    results = run_evaluation(args.games, args.rollouts, args.players, args.seed, n_workers=args.workers)
    elapsed = time.perf_counter() - t0
    _print_result(results, f"rollouts={args.rollouts}", elapsed, args.players)
    _save_report(baseline, [results], args, elapsed)

    if args.verbose:
        print("Per-game scores (P0 | greedy avg):")
        for i, (p0, opp) in enumerate(
            zip(results["p0_scores"], results["opp_avgs"])
        ):
            marker = "<" if p0 < opp else " "
            print(f"  game {i+1:3d}: P0={p0:5.0f}  opp={opp:5.1f} {marker}")


if __name__ == "__main__":
    main()
