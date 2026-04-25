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
    pimc_pool: Optional[list] = None,
    pimc_ratio: float = 0.0,
    temperature: float = 1.0,
    seed: Optional[int] = None,
    n_players: int = 4,
) -> List[dict]:
    """
    Run n_games self-play games. Player 0 uses `network`; players 1-(n-1)
    each randomly sample a network from `opponent_pool`.

    If `pimc_pool` is provided and `pimc_ratio` > 0, each opponent slot
    independently draws from `pimc_pool` with probability `pimc_ratio`
    instead of `opponent_pool`. This breaks the self-play echo chamber by
    always exposing the model to stronger, externally-trained opponents.

    The network (and all pool opponents) are set to eval() mode for the
    duration of collection. The caller is responsible for switching back
    to train() mode before the gradient update.

    Returns:
        List of trajectory dicts, each with:
          - "steps": list of step dicts from ShanghaiNetAgent.trajectory
          - "final_score": float, player 0's cumulative score (all 7 rounds)
    """
    from alphazero.agent import ShanghaiNetAgent

    use_pimc = bool(pimc_pool) and pimc_ratio > 0.0

    # Set eval mode once for all models — not per forward call
    network.eval()
    for opp in opponent_pool:
        opp.eval()
    if use_pimc:
        for opp in pimc_pool:
            opp.eval()

    rng = random.Random(seed)
    trajectories = []

    def _pick_opp() -> object:
        if use_pimc and rng.random() < pimc_ratio:
            return rng.choice(pimc_pool)
        return rng.choice(opponent_pool)

    for _ in range(n_games):
        game_seed = rng.randint(0, 2 ** 31)
        game_rng  = random.Random(game_seed)

        agent0 = ShanghaiNetAgent(
            network, player_idx=0, n_players=n_players,
            temperature=temperature, record=True,
        )

        opp_agents = [
            ShanghaiNetAgent(
                _pick_opp(), player_idx=p, n_players=n_players,
                temperature=1.0, record=False,
            )
            for p in range(1, n_players)
        ]

        all_agents = [agent0] + opp_agents

        # Explicit capture via default args avoids any late-binding surprises
        def _discard(pi, hand, hld, melds, ri, _a=all_agents):
            return _a[pi].discard(pi, hand, hld, melds, ri)

        def _draw(pi, hand, dt, hld, ri, _a=all_agents):
            return _a[pi].draw(pi, hand, dt, hld, ri)

        def _buy(pi, hand, dt, br, hld, ri, _a=all_agents):
            return _a[pi].buy(pi, hand, dt, br, hld, ri)

        def _laydown(pi, hand, asgn, ri, hld, _a=all_agents):
            return _a[pi].laydown(pi, hand, asgn, ri, hld)

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
