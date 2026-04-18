"""
Lay-down timing data collector.

For each game, whenever player 0 has a valid meld assignment, runs two
PIMC branches to generate a binary label using ROUND-SCORE labeling:
  Branch A: lay down now  (N rollouts, current round only) -> mean_round_score_A
  Branch B: skip one turn (N rollouts, current round only) -> mean_round_score_B
  label = 1 if mean_round_score_A < mean_round_score_B (lay down now is better)

Round-score labeling uses play_round() instead of play_game() so variance
is ~3x lower (~40 pts std dev vs ~150 pts for full game). This makes 10
rollouts sufficient where 100 full-game rollouts would be needed.

Players 1-3 use network_v3.pt for discard decisions (same as data_v2).
Player 0 uses greedy discard during collection (only lay-down labels recorded).

Output: ml/pimc/data_laydown/  (NPZ chunks of 1000 records)

Usage:
    python collect_laydown_data.py --games 2000 --opponent-model models/network_v3.pt
    python collect_laydown_data.py --games 2000 --opponent-model models/network_v3.pt --resume
"""

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import numpy as np

_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from engine import (
    play_game, play_round, DECK_COUNT, CARDS_DEALT, make_deck,
    find_meld_assignment, ROUND_REQS,
)
from collect_data import (
    build_laydown_state_vec, build_state_vec, _ctype,
    LAYDOWN_STATE_DIM,
    _load_progress, _save_progress,
)
from collect_data_v2 import _get_worker_model
from evaluate_pimc import _Tee, _setup_logging


# ── Skip-once hook ────────────────────────────────────────────────

class _SkipOnceLaydownHook:
    """Returns False on the first lay-down opportunity for player 0, then None."""

    def __init__(self):
        self._skipped = False

    def __call__(self, player_idx, hand, assignment, round_idx, has_laid_down_list):
        if player_idx != 0:
            return None  # greedy for opponents
        if not self._skipped:
            self._skipped = True
            return False   # skip this turn
        return None        # greedy from here on


# ── NPZ chunk writer (lay-down specific) ─────────────────────────

class _LaydownChunkWriter:
    CHUNK_SIZE = 1_000

    def __init__(self, out_dir: Path):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._states:  list = []
        self._labels:  list = []
        self._rounds:  list = []
        self._chunk_n: int  = self._next_chunk_n()

    def _next_chunk_n(self) -> int:
        existing = sorted(self.out_dir.glob("chunk_*.npz"))
        return int(existing[-1].stem.split("_")[1]) + 1 if existing else 0

    def add(self, state: np.ndarray, label: int, round_idx: int) -> None:
        self._states.append(state)
        self._labels.append(label)
        self._rounds.append(round_idx)
        if len(self._states) >= self.CHUNK_SIZE:
            self._flush()

    def _flush(self) -> None:
        if not self._states:
            return
        path = self.out_dir / f"chunk_{self._chunk_n:04d}.npz"
        np.savez_compressed(
            path,
            states=np.array(self._states,  dtype=np.float32),
            labels=np.array(self._labels,  dtype=np.int8),
            round_idx=np.array(self._rounds, dtype=np.int8),
        )
        n = len(self._states)
        print(f"    chunk {self._chunk_n:04d}  {n:,} records -> {path.name}", flush=True)
        self._states.clear()
        self._labels.clear()
        self._rounds.clear()
        self._chunk_n += 1

    def close(self) -> None:
        self._flush()


# ── Game worker ───────────────────────────────────────────────────

def _run_one_game_laydown(args: tuple) -> list:
    """
    Play one game; record lay-down decisions for player 0.

    Returns list of dicts: {state: np.ndarray, label: int, round_idx: int}
    """
    game_seed, agent_seed, n_rollouts, n_players, model_path_str = args

    import sys as _sys, os as _os
    _here = _os.path.dirname(_os.path.abspath(__file__))
    if _here not in _sys.path:
        _sys.path.insert(0, _here)

    import random as _random
    import numpy as _np
    from collections import Counter as _Counter
    from engine import (
        play_game as _play_game, play_round as _play_round,
        DECK_COUNT as _DC, CARDS_DEALT as _CD,
        make_deck as _make_deck, find_meld_assignment as _fma, ROUND_REQS as _RR,
    )
    from collect_data import (
        build_laydown_state_vec as _bsv_ld,
        build_state_vec as _bsv,
        _ctype as _ct,
    )

    model     = _get_worker_model(model_path_str)
    game_rng  = _random.Random(game_seed)
    agent_rng = _random.Random(agent_seed)
    records: list = []

    def _laydown_hook(player_idx, hand, assignment, round_idx, has_laid_down_list):
        if player_idx != 0:
            return None  # greedy for opponents

        # Build state vector
        opp_sizes     = [_CD[round_idx]] * (n_players - 1)
        has_ld_others = list(has_laid_down_list[1:])
        sv = _bsv_ld(
            hand=hand,
            assignment=assignment,
            round_idx=round_idx,
            has_laid_down_others=has_ld_others,
            opp_sizes=opp_sizes,
        )

        # Sample opponent hands for PIMC rollouts
        n_cards   = _CD[round_idx]
        deck      = _make_deck(_DC)
        p0_cnt    = _Counter(hand)
        remaining = []
        for c in deck:
            if p0_cnt.get(c, 0) > 0:
                p0_cnt[c] -= 1
            else:
                remaining.append(c)
        agent_rng.shuffle(remaining)
        opp_hands = [remaining[i * n_cards: (i + 1) * n_cards]
                     for i in range(n_players - 1)]
        all_hands = [list(hand)] + opp_hands

        # Branch A: lay down immediately — round score only (lower variance)
        scores_a = []
        for _ in range(n_rollouts):
            rs = _random.Random(agent_rng.randint(0, 2 ** 31 - 1))
            s  = _play_round(round_idx, n_players, rs, _DC,
                             initial_hands=[list(h) for h in all_hands])
            scores_a.append(s[0])

        # Branch B: skip one turn for player 0 — round score only
        scores_b = []
        for _ in range(n_rollouts):
            rs   = _random.Random(agent_rng.randint(0, 2 ** 31 - 1))
            skip = _SkipOnceLaydownHook()
            s    = _play_round(round_idx, n_players, rs, _DC,
                               initial_hands=[list(h) for h in all_hands],
                               laydown_hook=skip)
            scores_b.append(s[0])

        label = int(_np.mean(scores_a) < _np.mean(scores_b))
        records.append({"state": sv, "label": label, "round_idx": round_idx})
        return True  # always lay down in the actual game (after labeling)

    def _combined_discard(player_idx, hand, has_laid_down, table_melds, round_idx):
        if player_idx == 0:
            return None  # greedy discard for player 0
        # Opponents use network
        import torch as _torch
        opp_sizes = [_CD[round_idx]] * (n_players - 1)
        sv        = _bsv(hand=hand, seen_dict={}, discard_top=-1,
                         round_idx=round_idx, has_laid_down=has_laid_down,
                         opp_sizes=opp_sizes)
        state_t   = _torch.from_numpy(sv).unsqueeze(0)
        type_idx  = int(model.predict_discard(state_t).item())
        for c in hand:
            if _ct(c) == type_idx:
                return c
        return None

    _play_game(
        n_players,
        game_rng,
        _DC,
        discard_hook=_combined_discard,
        laydown_hook=_laydown_hook,
    )
    return records


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

    out_dir = _HERE / "data_laydown"
    out_dir.mkdir(exist_ok=True)

    prog            = _load_progress(out_dir) if resume else {"games_completed": 0, "records_written": 0}
    games_done      = prog["games_completed"]
    records_written = prog["records_written"]
    remaining       = n_games - games_done

    if remaining <= 0:
        print(f"Already have {games_done} games. Increase --games to collect more.")
        return

    if games_done:
        print(f"Resuming: {games_done} done, {remaining} remaining "
              f"({records_written:,} records so far)\n")

    writer  = _LaydownChunkWriter(out_dir)
    rng     = random.Random(seed)
    for _ in range(games_done * 2):   # advance past completed games
        rng.randint(0, 2 ** 31 - 1)

    game_args = [
        (rng.randint(0, 2 ** 31 - 1), rng.randint(0, 2 ** 31 - 1),
         n_rollouts, n_players, opponent_model)
        for _ in range(remaining)
    ]

    t_start   = time.perf_counter()
    completed = 0

    with ProcessPoolExecutor(max_workers=n_workers) as pool:
        futs = {pool.submit(_run_one_game_laydown, ga): i for i, ga in enumerate(game_args)}

        for fut in as_completed(futs):
            recs = fut.result()
            for rec in recs:
                writer.add(rec["state"], rec["label"], rec["round_idx"])

            completed       += 1
            games_done      += 1
            records_written += len(recs)

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
    print(f"\nDone. {games_done} games, {records_written:,} records in {elapsed / 3600:.2f}h")

    # Summary
    chunks = sorted(out_dir.glob("chunk_*.npz"))
    label_counts = {0: 0, 1: 0}
    for p in chunks:
        d = np.load(p)
        for lbl in d["labels"]:
            label_counts[int(lbl)] += 1
    total = sum(label_counts.values())
    print(f"\nDataset summary ({len(chunks)} chunks, {total:,} records):")
    print(f"  Label 0 (wait)        : {label_counts[0]:,}  ({label_counts[0]/max(total,1):.1%})")
    print(f"  Label 1 (lay down now): {label_counts[1]:,}  ({label_counts[1]/max(total,1):.1%})")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()
    parser = argparse.ArgumentParser(
        description="Collect lay-down timing data via 2-branch PIMC"
    )
    parser.add_argument("--games",          type=int, default=2000)
    parser.add_argument("--rollouts",       type=int, default=10,
                        help="PIMC rollouts per branch per decision (default 10)")
    parser.add_argument("--players",        type=int, default=4)
    parser.add_argument("--workers",        type=int, default=os.cpu_count())
    parser.add_argument("--seed",           type=int, default=42)
    parser.add_argument("--resume",         action="store_true")
    parser.add_argument("--opponent-model", type=str,
                        default=str(_HERE / "models" / "network_v3.pt"))
    args = parser.parse_args()

    if not Path(args.opponent_model).exists():
        print(f"ERROR: opponent model not found: {args.opponent_model}",
              file=sys.stderr)
        sys.exit(1)

    print("Lay-Down Timing Data Collector")
    print(f"  Games          : {args.games}")
    print(f"  Rollouts/branch: {args.rollouts}  (2x per decision = {args.rollouts * 2} total)")
    print(f"  State dim      : {LAYDOWN_STATE_DIM}")
    print(f"  Opponent model : {Path(args.opponent_model).name}")
    print(f"  Workers        : {args.workers}")
    print(f"  Output         : ml/pimc/data_laydown/")
    print()

    run_collection(
        args.games, args.rollouts, args.players,
        args.workers, args.seed, args.resume,
        opponent_model=args.opponent_model,
    )


if __name__ == "__main__":
    main()
