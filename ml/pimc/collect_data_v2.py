"""
PIMC training data collector — self-play iteration 2+.

Like collect_data.py but players 1-3 use a trained network (discard-only)
instead of the engine's greedy heuristic.  PIMC rollouts for player 0 remain
greedy internally — only the actual game opponents are upgraded.

Collects both discard (type=0) and draw (type=1) decisions for player 0,
enabling co-training of both heads in train_network_v2.py.

Why this helps:
  v1 data: PIMC player 0 vs greedy opponents (~330 avg)
  v2 data: PIMC player 0 vs network opponents (~164 avg)
  The optimal discard in a hard game (vs strong opponents) differs from an
  easy one.  PIMC's EV estimates shift to reflect tighter races and opponents
  who lay down sooner.  The resulting network learns harder situations.

Output: ml/pimc/data_v2/  (separate from v1 to preserve the original dataset)

Usage:
    # Initial v2 dataset (~1.4 hrs, ~420K records)
    python collect_data_v2.py --games 1000 --rollouts 20

    # With explicit opponent model
    python collect_data_v2.py --games 1000 --rollouts 20 --opponent-model models/network_v2.pt

    # Resume after interruption
    python collect_data_v2.py --games 1000 --rollouts 20 --resume
"""

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import numpy as np

# ── Path setup ────────────────────────────────────────────────────
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from engine import play_game, DECK_COUNT, CARDS_DEALT
from evaluate_pimc import _Tee, _setup_logging
from collect_data import (
    _DataCollectHook, _ctype, build_state_vec,
    ChunkWriter, STATE_DIM,
    _load_progress, _save_progress, _print_dataset_summary,
)


# ── Per-worker model cache ────────────────────────────────────────
# Each worker process loads the model once and keeps it in memory.
# This avoids re-loading for every game (persistent pool workers).

_worker_model_cache: dict = {}   # model_path_str -> PIMCDiscardNet


def _get_worker_model(model_path_str: str):
    """Load and cache the opponent network in this worker process.

    Auto-detects v1 (PIMCNet, dual-head) vs v2 (PIMCDiscardNet, discard-only)
    by checking whether draw_head.weight is present in the state dict.
    """
    if model_path_str not in _worker_model_cache:
        import torch as _torch
        state = _torch.load(model_path_str, map_location="cpu", weights_only=True)
        has_draw = "draw_head.weight" in state
        is_v3    = has_draw and tuple(state["draw_head.weight"].shape) == (1, 256)
        if has_draw and not is_v3:
            from train_network import PIMCNet as _Net
        else:
            from train_network_v2 import PIMCDiscardNet as _Net
        m = _Net()
        # strict=False: opponents only use discard head; draw head keys may be
        # absent (v2 checkpoint) or present (v3 checkpoint) — both are fine.
        m.load_state_dict(state, strict=False)
        m.eval()
        _worker_model_cache[model_path_str] = m
    return _worker_model_cache[model_path_str]


# ── Game worker (top-level — must be picklable) ───────────────────

def _run_one_game_v2(args: tuple) -> list:
    """
    Play one complete game with PIMC as player 0, network as opponents 1-3.
    Returns raw discard decision records for player 0 only.

    Draw hook is omitted (greedy draw for all) — v2 training is discard-only.
    """
    game_seed, agent_seed, n_rollouts, n_players, model_path_str = args

    import sys as _sys, os as _os
    _here = _os.path.dirname(_os.path.abspath(__file__))
    if _here not in _sys.path:
        _sys.path.insert(0, _here)

    import random as _random
    import torch as _torch
    from engine import play_game as _play_game, DECK_COUNT as _DC, CARDS_DEALT as _CD
    from collect_data import _DataCollectHook as _Hook, _ctype as _ct, build_state_vec as _bsv

    # Load/cache opponent model in this worker
    model = _get_worker_model(model_path_str)

    # Player 0: PIMC agent (records decisions + EV labels)
    p0_hook = _Hook(
        player_idx=0,
        n_players=n_players,
        n_rollouts=n_rollouts,
        base_seed=agent_seed,
    )

    def _combined_discard(player_idx, hand, has_laid_down, table_melds, round_idx):
        """Route discard decisions: PIMC for P0, network for P1-3."""
        if player_idx == 0:
            return p0_hook.discard(player_idx, hand, has_laid_down, table_melds, round_idx)

        # Opponent: single network forward pass, no rollouts
        opp_sizes = [_CD[round_idx]] * (n_players - 1)
        sv = _bsv(hand=hand, seen_dict={}, discard_top=-1,
                  round_idx=round_idx, has_laid_down=has_laid_down,
                  opp_sizes=opp_sizes)
        state_t  = _torch.from_numpy(sv).unsqueeze(0)
        type_idx = int(model.predict_discard(state_t).item())
        for c in hand:
            if _ct(c) == type_idx:
                return c
        return None   # fallback to greedy if masking misses (shouldn't happen)

    _play_game(
        n_players,
        _random.Random(game_seed),
        _DC,
        discard_hook=_combined_discard,
        draw_hook=p0_hook.draw,   # collect draw decisions alongside discard
    )
    return p0_hook.raw_records


# ── Collection loop ───────────────────────────────────────────────

def run_collection(
    n_games: int,
    n_rollouts: int,
    n_players: int,
    n_workers: int,
    seed: int,
    resume: bool,
    opponent_model: str,
) -> None:
    from concurrent.futures import ProcessPoolExecutor, as_completed

    out_dir = _HERE / "data_v2"
    out_dir.mkdir(exist_ok=True)

    prog = _load_progress(out_dir) if resume else {"games_completed": 0, "records_written": 0}
    games_done     = prog["games_completed"]
    records_written = prog["records_written"]
    remaining      = n_games - games_done

    if remaining <= 0:
        print(f"Already have {games_done} games. Increase --games to collect more.")
        return

    if games_done:
        print(f"Resuming: {games_done} done, {remaining} remaining "
              f"({records_written:,} records so far)\n")

    writer = ChunkWriter(out_dir)
    rng    = random.Random(seed)
    # Advance rng past already-completed games (2 ints per game)
    for _ in range(games_done * 2):
        rng.randint(0, 2 ** 31 - 1)

    game_args = [
        (rng.randint(0, 2**31 - 1), rng.randint(0, 2**31 - 1),
         n_rollouts, n_players, opponent_model)
        for _ in range(remaining)
    ]

    t_start   = time.perf_counter()
    completed = 0

    with ProcessPoolExecutor(max_workers=n_workers) as pool:
        futs = {pool.submit(_run_one_game_v2, ga): i for i, ga in enumerate(game_args)}

        for fut in as_completed(futs):
            records = fut.result()
            for rec in records:
                writer.add(rec)   # type==0 (discard) and type==1 (draw)

            completed      += 1
            games_done     += 1
            records_written += len(records)

            elapsed = time.perf_counter() - t_start
            rate    = completed / elapsed
            eta_h   = (remaining - completed) / rate / 3600 if rate > 0 else 0.0
            print(
                f"  game {games_done:5d}/{n_games}"
                f"  records={records_written:,}"
                f"  {rate:.2f}g/s"
                f"  ETA {eta_h:.1f}h",
                flush=True,
            )

            if completed % 100 == 0:
                _save_progress(out_dir, games_done, records_written)

    writer.close()
    _save_progress(out_dir, games_done, records_written)

    elapsed = time.perf_counter() - t_start
    print(f"\nDone. {games_done} games, {records_written:,} records in {elapsed/3600:.2f}h")
    print(f"Data directory: {out_dir}")
    _print_dataset_summary(out_dir)


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()
    parser = argparse.ArgumentParser(
        description="Collect PIMC training data with network opponents (self-play loop)"
    )
    parser.add_argument("--games",    type=int, default=1000,
                        help="Total games to collect (default 1000, ~1.4h)")
    parser.add_argument("--rollouts", type=int, default=20,
                        help="PIMC rollouts per decision for player 0 (default 20)")
    parser.add_argument("--players",  type=int, default=4)
    parser.add_argument("--workers",  type=int, default=os.cpu_count(),
                        help=f"Parallel game workers (default {os.cpu_count()} = cpu_count)")
    parser.add_argument("--seed",     type=int, default=42)
    parser.add_argument("--resume",   action="store_true",
                        help="Continue from last checkpoint in ml/pimc/data_v2/")
    parser.add_argument("--opponent-model", type=str,
                        default=str(_HERE / "models" / "network_v1.pt"),
                        help="Path to opponent network checkpoint (default: models/network_v1.pt)")
    args = parser.parse_args()

    # Validate model path
    if not Path(args.opponent_model).exists():
        print(f"ERROR: opponent model not found: {args.opponent_model}", file=sys.stderr)
        sys.exit(1)

    sec_per_game = 60.0   # ~60 sec/game at 20R single-threaded (network adds ~1s overhead)
    est_h = args.games * sec_per_game / args.workers / 3600

    print("PIMC Data Collector v2 (network opponents)")
    print(f"  Player 0    : PIMC ({args.rollouts} rollouts, discard decisions recorded)")
    print(f"  Players 1-{args.players-1} : network ({Path(args.opponent_model).name}, discard-only)")
    print(f"  Games       : {args.games}  (~{est_h:.1f}h at {args.rollouts}R, {args.workers} workers)")
    print(f"  State dim   : {STATE_DIM}")
    print(f"  Output      : ml/pimc/data_v2/  (NPZ chunks of {ChunkWriter.CHUNK_SIZE:,} records)")
    print()

    run_collection(
        args.games, args.rollouts, args.players,
        args.workers, args.seed, args.resume,
        opponent_model=args.opponent_model,
    )


if __name__ == "__main__":
    main()
