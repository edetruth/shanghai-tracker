"""
Self-play game collection for AlphaZero-lite training.

collect_games() runs N games with player 0 controlled by the current
network and players 1-3 randomly sampled from the opponent pool.
Returns a list of trajectory dicts ready for build_batch().
"""
from __future__ import annotations

import random
import sys
from pathlib import Path
from typing import List, Optional

_PIMC_DIR = Path(__file__).parent.parent
if str(_PIMC_DIR) not in sys.path:
    sys.path.insert(0, str(_PIMC_DIR))

from engine import play_game


def collect_games(
    network,
    n_games: int,
    opponent_pool: list,
    temperature: float = 1.0,
    seed: Optional[int] = None,
    n_players: int = 4,
) -> List[dict]:
    """
    Run n_games self-play games. Player 0 uses `network`; players 1-(n-1)
    each randomly sample a network from `opponent_pool`.

    Returns:
        List of trajectory dicts, each with:
          - "steps": list of step dicts from ShanghaiNetAgent.trajectory
          - "final_score": float, player 0's cumulative score (all 7 rounds)
    """
    from agent import ShanghaiNetAgent

    rng = random.Random(seed)
    trajectories = []

    for _ in range(n_games):
        game_seed = rng.randint(0, 2 ** 31)
        game_rng  = random.Random(game_seed)

        agent0 = ShanghaiNetAgent(
            network, player_idx=0, n_players=n_players,
            temperature=temperature, record=True,
        )

        opp_agents = [
            ShanghaiNetAgent(
                rng.choice(opponent_pool), player_idx=p, n_players=n_players,
                temperature=1.0, record=False,
            )
            for p in range(1, n_players)
        ]

        all_agents = [agent0] + opp_agents

        def _discard(player_idx, hand, has_laid_down, table_melds, round_idx):
            return all_agents[player_idx].discard(
                player_idx, hand, has_laid_down, table_melds, round_idx
            )

        def _draw(player_idx, hand, discard_top, has_laid_down, round_idx):
            return all_agents[player_idx].draw(
                player_idx, hand, discard_top, has_laid_down, round_idx
            )

        def _buy(player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx):
            return all_agents[player_idx].buy(
                player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx
            )

        def _laydown(player_idx, hand, assignment, round_idx, has_laid_down):
            return all_agents[player_idx].laydown(
                player_idx, hand, assignment, round_idx, has_laid_down
            )

        scores = play_game(
            n_players=n_players,
            rng=game_rng,
            discard_hook=_discard,
            draw_hook=_draw,
            buy_hook=_buy,
            laydown_hook=_laydown,
        )

        trajectories.append({
            "steps":       agent0.trajectory,
            "final_score": float(scores[0]),
        })

    return trajectories
