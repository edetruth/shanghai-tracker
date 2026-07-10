"""
PIMC vs real AI evaluation — runs through the TypeScript game bridge.

Player 0 uses PIMC (choose_draw + choose_discard).
Players 1-3 use the specified AI personality (mastermind, shark, nemesis).

Usage:
    python pimc_bridge_eval.py --games 100 --rollouts 10 --opponent the-mastermind
    python pimc_bridge_eval.py --games 100 --rollouts 20 --opponent the-shark

Results saved to ml/pimc/logs/pimc_bridge_YYYYMMDD_HHMMSS.json/.txt
"""

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from statistics import mean, stdev

# ── Path setup ────────────────────────────────────────────────
# ShanghaiEnv lives in ml/training/
_TRAINING_DIR = Path(__file__).parent.parent / "training"
sys.path.insert(0, str(_TRAINING_DIR))
from shanghai_env import ShanghaiEnv

# evaluate_pimc.py lives alongside this file in ml/pimc/
sys.path.insert(0, str(Path(__file__).parent))
from evaluate_pimc import _RoundAwarePIMCHook, _Tee, _setup_logging


# ── Card encoding: TypeScript <-> Python int ──────────────────
# TS:  {rank: 1-13, suit: 'clubs'|'diamonds'|'hearts'|'spades'|'joker'}
# Py:  card_int = suit * 16 + rank,  0=clubs 1=diamonds 2=hearts 3=spades
#      JOKER_INT = 64

JOKER_INT = 64
_SUIT_TS_TO_INT = {'clubs': 0, 'diamonds': 1, 'hearts': 2, 'spades': 3}
_SUIT_INT_TO_TS = {0: 'clubs', 1: 'diamonds', 2: 'hearts', 3: 'spades'}

# TypeScript sortHandForEncoding order (must match exactly for discard:N index)
_SUIT_ORDER_TS = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3, 'joker': 4}


def _ts_to_int(card: dict) -> int:
    if card['suit'] == 'joker':
        return JOKER_INT
    return _SUIT_TS_TO_INT[card['suit']] * 16 + card['rank']


def _ts_sort_key(card: dict) -> tuple:
    """Replicate TypeScript sortHandForEncoding key."""
    rank = 14 if card['suit'] == 'joker' else card['rank']
    return (rank, _SUIT_ORDER_TS[card['suit']], card.get('id', ''))


def _find_discard_index(hand_cards: list, chosen_int: int) -> int:
    """
    Find the sorted hand index for chosen_int.
    The bridge expects discard:N where N is the index in sortHandForEncoding order.
    """
    if chosen_int == JOKER_INT:
        target_suit, target_rank = 'joker', 0
    else:
        target_suit = _SUIT_INT_TO_TS[chosen_int >> 4]
        target_rank = chosen_int & 15

    sorted_hand = sorted(hand_cards, key=_ts_sort_key)
    for i, c in enumerate(sorted_hand):
        if c['suit'] == target_suit and c['rank'] == target_rank:
            return i
    return len(sorted_hand) - 1   # fallback: last card


# ── Single game ───────────────────────────────────────────────

def run_one_game(
    env: ShanghaiEnv,
    n_rollouts: int,
    n_players: int,
    seed: int,
    agent_rng: random.Random,
    n_workers: int = 1,
) -> list:
    """
    Play one game with PIMC as player 0. Returns final scores list.
    """
    env.reset(seed=seed)

    hooks = _RoundAwarePIMCHook(
        player_idx=0,
        n_players=n_players,
        n_rollouts=n_rollouts,
        base_seed=agent_rng.randint(0, 2 ** 31),
        n_workers=n_workers,
    )

    done = False
    info: dict = {}
    step = 0
    max_steps = 8000   # safety cap (7 rounds × ~200 turns × ~5 steps/turn)

    while not done and step < max_steps:
        step += 1

        # Auto-execute meld/layoff; returns strategic actions only
        actions, current_player, _ = env.get_strategic_actions()

        if not actions:
            break

        # ── Buy window ────────────────────────────────────────
        # Player 0 is being asked whether to buy an opponent's discard.
        # Use the AI's buy recommendation (same personality as opponents).
        if 'buy' in actions or 'decline_buy' in actions:
            ai_resp = env._send({'cmd': 'get_ai_action'})
            action = ai_resp.get('action', 'decline_buy')
            _, _, done, info = env.step(action)
            continue

        # ── Fetch raw hand for PIMC ───────────────────────────
        full = env.get_full_state()
        hand_cards: list = full.get('hand', [])
        hand_ints = [_ts_to_int(c) for c in hand_cards]
        round_idx: int = max(0, full.get('round', 1) - 1)   # 0-indexed
        has_laid_down: bool = full.get('hasLaidDown', False)

        # ── Draw decision ─────────────────────────────────────
        if 'draw_pile' in actions or 'take_discard' in actions:
            discard_top = full.get('discardTop')
            discard_int = _ts_to_int(discard_top) if discard_top else -1

            if discard_int >= 0 and 'take_discard' in actions:
                decision = hooks.draw(0, hand_ints, discard_int, has_laid_down, round_idx)
                action = 'take_discard' if decision == 'take' else 'draw_pile'
            else:
                action = 'draw_pile'

            _, _, done, info = env.step(action)
            continue

        # ── Discard decision ──────────────────────────────────
        discard_actions = [a for a in actions if a.startswith('discard:')]
        if discard_actions:
            chosen_int = hooks.discard(0, hand_ints, has_laid_down, [], round_idx)
            if chosen_int is not None:
                idx = _find_discard_index(hand_cards, chosen_int)
                action = f'discard:{idx}'
            else:
                action = discard_actions[-1]   # fallback: last sorted card
            _, _, done, info = env.step(action)
            continue

        # ── Fallback ──────────────────────────────────────────
        _, _, done, info = env.step(actions[0])

    return info.get('scores', [0] * n_players)


# ── Evaluation loop ───────────────────────────────────────────

def run_evaluation(
    n_games: int,
    n_rollouts: int,
    n_players: int,
    opponent: str,
    seed: int,
    n_workers: int = 1,
) -> dict:
    env = ShanghaiEnv(player_count=n_players, opponent_ai=opponent)
    rng = random.Random(seed)
    agent_rng = random.Random(seed ^ 0xDEAD)

    p0_scores: list = []
    opp_avgs: list = []
    wins = 0
    t_start = time.perf_counter()

    for game_i in range(n_games):
        game_seed = rng.randint(0, 2 ** 31 - 1)
        scores = run_one_game(env, n_rollouts, n_players, game_seed, agent_rng, n_workers=n_workers)

        p0_scores.append(scores[0])
        opp_avgs.append(mean(scores[1:]))
        if scores[0] == min(scores):
            wins += 1

        elapsed = time.perf_counter() - t_start
        rate = (game_i + 1) / elapsed
        print(
            f"  game {game_i+1:4d}/{n_games}"
            f"  p0={mean(p0_scores):5.0f}"
            f"  opp={mean(opp_avgs):5.0f}"
            f"  wr={wins/(game_i+1):.0%}"
            f"  {rate:.2f}g/s",
            flush=True,
        )

    env.proc.terminate()

    avg = lambda v: mean(v) if v else 0.0
    sd  = lambda v: stdev(v) if len(v) > 1 else 0.0
    return {
        "n_games": n_games,
        "n_rollouts": n_rollouts,
        "n_players": n_players,
        "opponent": opponent,
        "p0_avg": avg(p0_scores),
        "p0_std": sd(p0_scores),
        "opp_avg": avg(opp_avgs),
        "opp_std": sd(opp_avgs),
        "win_rate": wins / n_games,
        "p0_scores": p0_scores,
    }


# ── Report ────────────────────────────────────────────────────

def _save_report(results: dict, elapsed: float) -> None:
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    stem = f"pimc_bridge_{ts}"

    json_path = log_dir / f"{stem}.json"
    json_path.write_text(
        json.dumps({**results, "elapsed_sec": round(elapsed, 1),
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")}, indent=2),
        encoding="utf-8",
    )

    delta = results["opp_avg"] - results["p0_avg"]
    vs_human = results["p0_avg"] - 227
    vs_mm = results["p0_avg"] - 218.8
    lines = [
        f"PIMC vs {results['opponent']} — {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Games: {results['n_games']}  Rollouts: {results['n_rollouts']}  "
        f"Players: {results['n_players']}  Time: {elapsed/3600:.2f}h",
        "",
        f"  PIMC  (P0) : {results['p0_avg']:6.1f}  +/- {results['p0_std']:.1f}",
        f"  {results['opponent']} (P1+): {results['opp_avg']:6.1f}  +/- {results['opp_std']:.1f}",
        f"  Score delta : {delta:+.1f}  (positive = PIMC better)",
        f"  Win rate    : {results['win_rate']:.1%}",
        "",
        f"  vs Human (227)     : {vs_human:+.1f}",
        f"  vs Mastermind (219): {vs_mm:+.1f}",
    ]
    txt_path = log_dir / f"{stem}.txt"
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\nReport saved:")
    print(f"  {json_path}")
    print(f"  {txt_path}")


# ── CLI ───────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()
    parser = argparse.ArgumentParser(description="Evaluate PIMC vs real TypeScript AI")
    parser.add_argument("--games",    type=int, default=100)
    parser.add_argument("--rollouts", type=int, default=10)
    parser.add_argument("--players",  type=int, default=4)
    parser.add_argument("--opponent", type=str, default="the-mastermind",
                        choices=["the-mastermind", "the-shark", "the-nemesis"])
    parser.add_argument("--seed",     type=int, default=42)
    parser.add_argument("--workers",  type=int, default=os.cpu_count(),
                        help=f"Parallel rollout workers (default: {os.cpu_count()} = cpu_count)")
    args = parser.parse_args()

    print(f"PIMC Bridge Evaluator")
    print(f"  Player 0 : PIMC  ({args.rollouts} rollouts, discard+draw, {args.workers} workers)")
    print(f"  Players 1-{args.players-1}: {args.opponent}")
    print(f"  Games    : {args.games}  |  Seed: {args.seed}")
    print(f"  Benchmarks: Human=227  Mastermind=219")
    print()

    t0 = time.perf_counter()
    results = run_evaluation(
        args.games, args.rollouts, args.players, args.opponent, args.seed, n_workers=args.workers
    )
    elapsed = time.perf_counter() - t0

    delta = results["opp_avg"] - results["p0_avg"]
    print()
    print(f"Results ({elapsed:.0f}s):")
    print(f"  PIMC  (P0) : avg {results['p0_avg']:6.1f}  +/- {results['p0_std']:.1f}")
    print(f"  {args.opponent} (P1+): avg {results['opp_avg']:6.1f}  +/- {results['opp_std']:.1f}")
    print(f"  Score delta : {delta:+.1f}  (positive = PIMC better)")
    print(f"  Win rate    : {results['win_rate']:.1%}  (random={1/args.players:.0%})")
    print(f"  vs Human (227)     : {results['p0_avg'] - 227:+.1f}")
    print(f"  vs Mastermind (219): {results['p0_avg'] - 218.8:+.1f}")

    _save_report(results, elapsed)


if __name__ == "__main__":
    main()
