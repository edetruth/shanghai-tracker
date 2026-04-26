"""
Evaluation script for trained ShanghaiNet checkpoints.

evaluate_model() runs N games with the model as player 0 and greedy
opponents (players 1-3), returning score statistics.

Usage
-----
    cd ml/pimc
    python -m alphazero.evaluate \\
        --checkpoint alphazero/checkpoints/best.pt \\
        --games 200 \\
        --temperature 0
"""
from __future__ import annotations

import statistics
import sys
from pathlib import Path
from typing import Optional

import torch

_PIMC_DIR = Path(__file__).parent.parent
if str(_PIMC_DIR) not in sys.path:
    sys.path.insert(0, str(_PIMC_DIR))

from engine import play_game

from alphazero.network import ShanghaiNet
from alphazero.agent   import ShanghaiNetAgent


def evaluate_model(
    model: ShanghaiNet,
    n_games: int = 200,
    n_players: int = 4,
    temperature: float = 0.0,
    seed: Optional[int] = None,
) -> dict:
    """
    Evaluate a ShanghaiNet against greedy opponents.

    Player 0 uses the model; players 1-3 use the engine's built-in greedy
    fallback (agent returns None → engine falls through to greedy).

    Args:
        model:       trained ShanghaiNet (eval mode applied internally)
        n_games:     number of games to play
        n_players:   number of players (default 4)
        temperature: sampling temperature (0.0 = argmax / greedy)
        seed:        optional RNG seed for reproducibility

    Returns:
        dict with keys:
            avg_score    — mean of player-0 final scores (lower = better)
            std_score    — standard deviation
            min_score    — best game
            max_score    — worst game
            win_rate     — fraction of games where player 0 had the lowest score
            n_games      — games played
    """
    import random
    rng = random.Random(seed)

    agent = ShanghaiNetAgent(
        model, player_idx=0, n_players=n_players,
        temperature=temperature, record=False,
    )

    scores = []
    wins   = 0

    for _ in range(n_games):
        game_rng = random.Random(rng.randint(0, 2 ** 31))
        agent.reset()

        def _discard(player_idx, hand, has_laid_down, table_melds, round_idx):
            return agent.discard(player_idx, hand, has_laid_down, table_melds, round_idx)

        def _draw(player_idx, hand, discard_top, has_laid_down, round_idx):
            return agent.draw(player_idx, hand, discard_top, has_laid_down, round_idx)

        def _buy(player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx):
            return agent.buy(player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx)

        def _laydown(player_idx, hand, assignment, round_idx, has_laid_down):
            return agent.laydown(player_idx, hand, assignment, round_idx, has_laid_down)

        all_scores = play_game(
            n_players=n_players,
            rng=game_rng,
            discard_hook=_discard,
            draw_hook=_draw,
            buy_hook=_buy,
            laydown_hook=_laydown,
        )

        p0 = float(all_scores[0])
        scores.append(p0)
        if p0 == min(all_scores):
            wins += 1

    return {
        "avg_score": statistics.mean(scores),
        "std_score": statistics.stdev(scores) if len(scores) > 1 else 0.0,
        "min_score": min(scores),
        "max_score": max(scores),
        "win_rate":  wins / n_games,
        "n_games":   n_games,
    }


def evaluate_greedy_baseline(
    n_games: int = 200,
    n_players: int = 4,
    seed: Optional[int] = None,
) -> dict:
    """
    Run n_games with all players using the engine's built-in greedy logic
    (no neural network). Player 0's scores are collected as the baseline.

    This establishes a fair apples-to-apples reference: what does a greedy
    player score when everyone is greedy? Use this before comparing model
    scores to the PIMC 166.8 baseline, which was measured differently.
    """
    import random
    rng = random.Random(seed)

    scores = []
    wins   = 0

    for _ in range(n_games):
        game_rng = random.Random(rng.randint(0, 2 ** 31))
        all_scores = play_game(n_players=n_players, rng=game_rng)
        p0 = float(all_scores[0])
        scores.append(p0)
        if p0 == min(all_scores):
            wins += 1

    return {
        "avg_score": statistics.mean(scores),
        "std_score": statistics.stdev(scores) if len(scores) > 1 else 0.0,
        "min_score": min(scores),
        "max_score": max(scores),
        "win_rate":  wins / n_games,
        "n_games":   n_games,
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate a ShanghaiNet checkpoint")
    parser.add_argument("--checkpoint",  default=None,    help="Path to .pt state dict (omit with --baseline)")
    parser.add_argument("--warm-start",  default=None,    help="Load via from_pimc_checkpoint instead of state_dict")
    parser.add_argument("--baseline",    action="store_true", help="Run greedy-vs-greedy baseline (no model needed)")
    parser.add_argument("--games",       type=int,   default=200)
    parser.add_argument("--players",     type=int,   default=4)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--seed",        type=int,   default=42)
    args = parser.parse_args()

    if args.baseline:
        print(f"Greedy baseline  ({args.games} games, all players greedy)")
        results = evaluate_greedy_baseline(
            n_games=args.games, n_players=args.players, seed=args.seed
        )
        print(f"  avg_score : {results['avg_score']:.1f}")
        print(f"  std_score : {results['std_score']:.1f}")
        print(f"  min/max   : {results['min_score']:.0f} / {results['max_score']:.0f}")
        print(f"  win_rate  : {results['win_rate']*100:.1f}%  (expected ~25%)")
    else:
        if not args.checkpoint:
            parser.error("--checkpoint is required unless --baseline is set")
        ckpt = Path(args.checkpoint)
        if args.warm_start:
            model = ShanghaiNet.from_pimc_checkpoint(ckpt)
        else:
            model = ShanghaiNet()
            model.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True))
        model.eval()

        print(f"Evaluating {ckpt.name}  ({args.games} games, T={args.temperature})")
        results = evaluate_model(model, n_games=args.games, n_players=args.players,
                                 temperature=args.temperature, seed=args.seed)
        print(f"  avg_score : {results['avg_score']:.1f}  (PIMC baseline: ~166.8)")
        print(f"  std_score : {results['std_score']:.1f}")
        print(f"  min/max   : {results['min_score']:.0f} / {results['max_score']:.0f}")
        print(f"  win_rate  : {results['win_rate']*100:.1f}%  (random baseline: 25%)")
