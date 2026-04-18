"""
PIMC training data collector — Stage 3 data generation.

Runs PIMC (player 0, n_rollouts per decision) vs greedy (players 1-3)
across many games and records every discard and draw decision as a
(state_vector, label, ev_scores) tuple.

The resulting NPZ dataset trains a neural network to approximate PIMC
decisions at inference time (~1ms vs ~200ms for live PIMC), making it
fast enough to use inside PIMC rollouts themselves (Stage 3 self-play loop).

State vector (STATE_DIM = 170 dims):
    [0:53]    hand counts per card type (0-2 for regular, 0-4 for joker)
    [53:106]  seen-card counts per card type (own hand + observed discards)
    [106:159] discard-top one-hot (zeros for discard decisions)
    [159:166] round index one-hot (7 dims, rounds 0-6)
    [166]     has_laid_down flag
    [167:170] opponent hand sizes normalized by 12 (3 slots for 4P)

Card type index: suit * 13 + (rank - 1) for non-jokers (0-51), 52 for joker.

Action labels:
    discard decision → card type index (0-52)
    draw decision    → 1 (take) or 0 (draw from pile)

Data written as NPZ chunks of 10K records to ml/pimc/data/.
Progress saved to ml/pimc/data/progress.json for --resume support.

Usage:
    # Quick pipeline test (~8 min)
    python collect_data.py --games 100 --rollouts 10

    # Initial training dataset (~1.4 hrs, ~420K records)
    python collect_data.py --games 1000 --rollouts 20

    # Full dataset (~7 hrs, ~2.1M records)
    python collect_data.py --games 5000 --rollouts 20

    # Resume after interruption
    python collect_data.py --games 5000 --rollouts 20 --resume
"""

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np

# ── Path setup ────────────────────────────────────────────────────
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from engine import (
    play_game, DECK_COUNT, JOKER_INT,
    ROUND_REQS, _build_table_melds, _lay_off_greedy,
)
from evaluate_pimc import _RoundAwarePIMCHook, _Tee, _setup_logging


# ── State encoding ────────────────────────────────────────────────

STATE_DIM = 170          # total feature vector length
LAYDOWN_STATE_DIM = 174  # STATE_DIM + 4 lay-down-specific features
_MAX_OPP_SLOTS = 3       # fixed for 4P; padded with 0 for fewer opponents
_EV_PAD_WIDTH = 5        # max candidates to store EVs for (padded with 0)


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


def build_state_vec(
    hand: list,
    seen_dict: dict,     # {card_int: count} — CardTracker._seen snapshot
    discard_top: int,    # card int, or -1 for discard decisions
    round_idx: int,
    has_laid_down: bool,
    opp_sizes: list,     # estimated hand sizes per opponent (up to 3)
) -> np.ndarray:
    """Build the 170-dim state vector for one decision point."""
    v = np.zeros(STATE_DIM, dtype=np.float32)
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


def build_laydown_state_vec(
    hand: list,
    assignment: tuple,           # (meld_idx, rem_idx) from find_meld_assignment
    round_idx: int,
    has_laid_down_others: list,  # has_laid_down list, indexed by player (player 0 excluded)
    opp_sizes: list,             # estimated hand sizes per opponent (up to 3)
) -> np.ndarray:
    """Build the 174-dim state vector for a lay-down decision point.

    Extends the base 170-dim vector with 4 lay-down-specific features:
        [170] n_residual / 12.0        — cards left after best meld + immediate layoff
        [171] can_go_out_now           — 1.0 if residual == 0
        [172] any_opp_laid_down        — 1.0 if any opponent has already laid down
        [173] n_meld_cards / 12.0      — cards committed to required melds
    """
    base = build_state_vec(
        hand=hand,
        seen_dict={},
        discard_top=-1,
        round_idx=round_idx,
        has_laid_down=False,   # fires before lay-down; always 0
        opp_sizes=opp_sizes,
    )
    v = np.concatenate([base, np.zeros(4, dtype=np.float32)])

    meld_idx, rem_idx = assignment
    meld_cards = [hand[i] for i in meld_idx]
    remaining = [hand[i] for i in rem_idx]
    n_meld_cards = len(meld_idx)

    req_sets, req_runs = ROUND_REQS[round_idx]
    new_melds = _build_table_melds(meld_cards, req_sets, req_runs)
    rem_copy = list(remaining)
    if new_melds:
        _lay_off_greedy(rem_copy, [m[:] for m in new_melds])
    n_residual = len(rem_copy)

    v[170] = n_residual / 12.0
    v[171] = float(n_residual == 0)
    v[172] = float(any(has_laid_down_others))
    v[173] = n_meld_cards / 12.0
    return v


# ── Data collection hook ──────────────────────────────────────────

class _DataCollectHook(_RoundAwarePIMCHook):
    """
    Extends _RoundAwarePIMCHook to record every decision made by player 0.

    After each call to .discard() or .draw(), a raw record is appended to
    self.raw_records.  The main process converts records to state vectors
    and writes NPZ chunks (workers stay lightweight, no numpy in IPC).

    Trivial decisions (forced single candidate) are skipped — they add no
    information to the training set.
    """

    def __init__(
        self,
        player_idx: int,
        n_players: int,
        n_rollouts: int,
        base_seed: int,
    ):
        super().__init__(player_idx, n_players, n_rollouts, base_seed)
        self.raw_records: list = []

    def discard(
        self,
        player_idx: int,
        hand: list,
        has_laid_down: bool,
        table_melds: list,
        round_idx: int,
    ) -> Optional[int]:
        chosen = super().discard(player_idx, hand, has_laid_down, table_melds, round_idx)
        if chosen is None:
            return chosen   # not our player
        agent = self._get_agent(round_idx)
        # Skip trivial decisions (no real choice was made)
        if len(agent.last_candidates) < 2:
            return chosen
        self.raw_records.append({
            "type": 0,           # 0 = discard
            "hand": list(hand),
            "seen": dict(agent.tracker._seen),
            "discard_top": -1,
            "round_idx": round_idx,
            "has_laid_down": bool(has_laid_down),
            "opp_sizes": list(agent._estimate_hand_sizes(hand, has_laid_down)),
            "candidates": list(agent.last_candidates),
            "evs": list(agent.last_evs),
            "chosen": chosen,
        })
        return chosen

    def draw(
        self,
        player_idx: int,
        hand: list,
        discard_top: int,
        has_laid_down: bool,
        round_idx: int,
    ) -> Optional[str]:
        chosen = super().draw(player_idx, hand, discard_top, has_laid_down, round_idx)
        if chosen is None:
            return chosen   # not our player
        agent = self._get_agent(round_idx)
        if len(agent.last_candidates) < 2:
            return chosen   # discard_top < 0 case, no real choice
        self.raw_records.append({
            "type": 1,           # 1 = draw
            "hand": list(hand),
            "seen": dict(agent.tracker._seen),
            "discard_top": discard_top,
            "round_idx": round_idx,
            "has_laid_down": bool(has_laid_down),
            "opp_sizes": list(agent._estimate_hand_sizes(hand, has_laid_down)),
            "candidates": ["take", "draw"],
            "evs": list(agent.last_evs),
            "chosen": chosen,    # 'take' or 'draw'
        })
        return chosen


# ── Game worker (top-level — must be picklable) ───────────────────

def _run_one_game(args: tuple) -> list:
    """
    Play one complete game with PIMC as player 0.  Return raw decision records.

    Top-level function so ProcessPoolExecutor can pickle it.
    Workers use n_workers=1 (serial rollouts) — parallelism is at game level.
    """
    game_seed, agent_seed, n_rollouts, n_players = args

    # Ensure ml/pimc/ is importable in worker processes on all platforms
    import sys as _sys
    import os as _os
    _here = _os.path.dirname(_os.path.abspath(__file__))
    if _here not in _sys.path:
        _sys.path.insert(0, _here)

    import random as _random
    from engine import play_game as _play_game, DECK_COUNT as _DC
    from collect_data import _DataCollectHook   # safe: not __main__ in workers

    hooks = _DataCollectHook(
        player_idx=0,
        n_players=n_players,
        n_rollouts=n_rollouts,
        base_seed=agent_seed,
    )
    _play_game(
        n_players,
        _random.Random(game_seed),
        _DC,
        discard_hook=hooks.discard,
        draw_hook=hooks.draw,
    )
    return hooks.raw_records


# ── NPZ chunk writer ──────────────────────────────────────────────

class ChunkWriter:
    """Buffers decision records and flushes to compressed NPZ files."""

    CHUNK_SIZE = 10_000

    def __init__(self, out_dir: Path):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._states: list = []
        self._labels: list = []
        self._label_types: list = []
        self._ev_scores: list = []
        self._round_idxs: list = []
        self._chunk_n: int = self._next_chunk_n()

    def _next_chunk_n(self) -> int:
        existing = sorted(self.out_dir.glob("chunk_*.npz"))
        return int(existing[-1].stem.split("_")[1]) + 1 if existing else 0

    def add(self, rec: dict) -> None:
        """Convert one raw record to arrays and buffer it."""
        state = build_state_vec(
            rec["hand"], rec["seen"], rec["discard_top"],
            rec["round_idx"], rec["has_laid_down"], rec["opp_sizes"],
        )
        self._states.append(state)

        if rec["type"] == 0:   # discard
            label = _ctype(rec["chosen"])
        else:                   # draw
            label = 1 if rec["chosen"] == "take" else 0
        self._labels.append(label)
        self._label_types.append(rec["type"])

        ev_pad = np.zeros(_EV_PAD_WIDTH, dtype=np.float32)
        evs = rec["evs"]
        ev_pad[:len(evs)] = evs
        self._ev_scores.append(ev_pad)
        self._round_idxs.append(rec["round_idx"])

        if len(self._states) >= self.CHUNK_SIZE:
            self._flush()

    def _flush(self) -> None:
        if not self._states:
            return
        path = self.out_dir / f"chunk_{self._chunk_n:04d}.npz"
        np.savez_compressed(
            path,
            states=np.array(self._states, dtype=np.float32),
            labels=np.array(self._labels, dtype=np.int16),
            label_types=np.array(self._label_types, dtype=np.int8),
            ev_scores=np.array(self._ev_scores, dtype=np.float32),
            round_idx=np.array(self._round_idxs, dtype=np.int8),
        )
        n = len(self._states)
        print(f"    chunk {self._chunk_n:04d}  {n:,} records -> {path.name}", flush=True)
        self._states.clear()
        self._labels.clear()
        self._label_types.clear()
        self._ev_scores.clear()
        self._round_idxs.clear()
        self._chunk_n += 1

    def close(self) -> None:
        self._flush()

    def buffered(self) -> int:
        return len(self._states)


# ── Progress file ─────────────────────────────────────────────────

def _load_progress(out_dir: Path) -> dict:
    p = out_dir / "progress.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"games_completed": 0, "records_written": 0}


def _save_progress(out_dir: Path, games: int, records: int) -> None:
    p = out_dir / "progress.json"
    p.write_text(
        json.dumps({"games_completed": games, "records_written": records}),
        encoding="utf-8",
    )


# ── Collection loop ───────────────────────────────────────────────

def run_collection(
    n_games: int,
    n_rollouts: int,
    n_players: int,
    n_workers: int,
    seed: int,
    resume: bool,
) -> None:
    from concurrent.futures import ProcessPoolExecutor, as_completed

    out_dir = _HERE / "data"
    out_dir.mkdir(exist_ok=True)

    prog = _load_progress(out_dir) if resume else {"games_completed": 0, "records_written": 0}
    games_done = prog["games_completed"]
    records_written = prog["records_written"]
    remaining = n_games - games_done

    if remaining <= 0:
        print(f"Already have {games_done} games. Increase --games to collect more.")
        return

    if games_done:
        print(f"Resuming: {games_done} done, {remaining} remaining ({records_written:,} records so far)\n")

    writer = ChunkWriter(out_dir)
    rng = random.Random(seed)
    # Advance rng past already-completed games (2 ints per game)
    for _ in range(games_done * 2):
        rng.randint(0, 2 ** 31 - 1)

    game_args = [
        (rng.randint(0, 2 ** 31 - 1), rng.randint(0, 2 ** 31 - 1), n_rollouts, n_players)
        for _ in range(remaining)
    ]

    t_start = time.perf_counter()
    completed = 0

    with ProcessPoolExecutor(max_workers=n_workers) as pool:
        futs = {pool.submit(_run_one_game, ga): i for i, ga in enumerate(game_args)}

        for fut in as_completed(futs):
            records = fut.result()
            for rec in records:
                writer.add(rec)

            completed += 1
            games_done += 1
            records_written += len(records)

            elapsed = time.perf_counter() - t_start
            rate = completed / elapsed
            eta_h = (remaining - completed) / rate / 3600 if rate > 0 else 0.0
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


def _print_dataset_summary(out_dir: Path) -> None:
    chunks = sorted(out_dir.glob("chunk_*.npz"))
    if not chunks:
        return
    total = 0
    discard_n = 0
    draw_n = 0
    round_counts = [0] * 7
    for p in chunks:
        d = np.load(p)
        n = len(d["labels"])
        total += n
        types = d["label_types"]
        discard_n += int((types == 0).sum())
        draw_n    += int((types == 1).sum())
        for ri in d["round_idx"]:
            round_counts[int(ri)] += 1
    print(f"\nDataset summary ({len(chunks)} chunks, {total:,} records):")
    print(f"  Discard decisions: {discard_n:,}  ({discard_n/total:.1%})")
    print(f"  Draw decisions   : {draw_n:,}  ({draw_n/total:.1%})")
    print(f"  By round         : {round_counts}")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()
    parser = argparse.ArgumentParser(description="Collect PIMC training data")
    parser.add_argument("--games",    type=int, default=1000,
                        help="Total games to collect (default 1000, ~1.4h)")
    parser.add_argument("--rollouts", type=int, default=20,
                        help="PIMC rollouts per decision (default 20)")
    parser.add_argument("--players",  type=int, default=4)
    parser.add_argument("--workers",  type=int, default=os.cpu_count(),
                        help=f"Parallel game workers (default {os.cpu_count()} = cpu_count)")
    parser.add_argument("--seed",     type=int, default=42)
    parser.add_argument("--resume",   action="store_true",
                        help="Continue from last checkpoint in ml/pimc/data/")
    args = parser.parse_args()

    # Timing guide (20R, 12 workers):
    #   100 games  →  ~8 min   (pipeline test)
    #   1000 games →  ~1.4 hr  (initial training set, ~420K records)
    #   5000 games →  ~7 hr    (full dataset, ~2.1M records)
    sec_per_game = 59.0   # ~59 sec/game at 20R, single-threaded
    est_h = args.games * sec_per_game / args.workers / 3600

    print("PIMC Data Collector")
    print(f"  Games   : {args.games}  (~{est_h:.1f}h at {args.rollouts}R, {args.workers} workers)")
    print(f"  Rollouts: {args.rollouts} per decision  (workers=1 per game, game-level parallelism)")
    print(f"  State   : {STATE_DIM} dims")
    print(f"  Output  : ml/pimc/data/  (NPZ chunks of {ChunkWriter.CHUNK_SIZE:,} records)")
    print()

    run_collection(
        args.games, args.rollouts, args.players,
        args.workers, args.seed, args.resume,
    )


if __name__ == "__main__":
    main()
