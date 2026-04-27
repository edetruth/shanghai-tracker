import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import numpy as np
import torch
from alphazero.network import ShanghaiNet
from alphazero.agent import ShanghaiNetAgent


def _make_agent(temperature=1.0):
    model = ShanghaiNet()
    model.eval()
    return ShanghaiNetAgent(model, player_idx=0, n_players=4,
                            temperature=temperature, record=True)


def test_log_prob_old_present_in_every_step():
    """Every recorded trajectory step must contain a finite log_prob_old."""
    from alphazero.self_play import collect_games
    model = ShanghaiNet()
    trajectories = collect_games(model, n_games=2, opponent_pool=[model],
                                 temperature=1.0, seed=0)
    for traj in trajectories:
        for step in traj["steps"]:
            assert "log_prob_old" in step, "missing log_prob_old"
            lp = step["log_prob_old"]
            assert isinstance(lp, float), f"expected float, got {type(lp)}"
            assert np.isfinite(lp), f"log_prob_old is not finite: {lp}"
            assert lp <= 0.0, f"log_prob_old must be <= 0, got {lp}"


def test_log_prob_old_matches_temperature_one():
    """log_prob_old must be computed at temperature=1, not collection temp."""
    import torch.nn.functional as F
    from alphazero.agent import ShanghaiNetAgent, _ctype
    from engine import JOKER_INT

    model = ShanghaiNet()
    model.eval()
    agent = ShanghaiNetAgent(model, player_idx=0, n_players=4,
                             temperature=5.0, record=True)

    hand = [0x11, 0x21]  # rank 1 suit 1, rank 1 suit 2 — two distinct ctypes

    # Build expected_lps using the same state vector the agent will use
    agent._maybe_new_round(0)
    sv = agent._state_vec(hand, -1, round_idx=0, has_laid_down=False)
    with torch.no_grad():
        out = model(torch.from_numpy(sv).unsqueeze(0))
        logits = out["discard_logits"].squeeze(0)
        hand_types = sorted(list({_ctype(c) for c in hand}))
        neg_inf = torch.full_like(logits, float("-inf"))
        for idx in hand_types:
            neg_inf[idx] = logits[idx]
        # expected log_prob for each valid action at temperature=1
        lp_all = F.log_softmax(neg_inf, dim=-1)
        expected_lps = {idx: float(lp_all[idx].item()) for idx in hand_types}

    agent.discard(player_idx=0, hand=hand, has_laid_down=False,
                  table_melds=[], round_idx=0)
    assert len(agent.trajectory) == 1, "discard step was not recorded"
    step = agent.trajectory[-1]
    chosen_type = step["action_taken"]
    assert chosen_type in expected_lps, f"chosen type {chosen_type} not in hand"
    assert abs(step["log_prob_old"] - expected_lps[chosen_type]) < 1e-5
