import random
import sys
from pathlib import Path
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc


def _fresh_net():
    from network import ShanghaiNet
    return ShanghaiNet()


def test_discard_hook_returns_card_in_hand():
    """Agent discard decision must return a card actually in the hand."""
    from agent import ShanghaiNetAgent
    net = _fresh_net()
    agent = ShanghaiNetAgent(net, player_idx=0, n_players=4, temperature=1.0)

    calls = []
    original_discard = agent.discard

    def recording_discard(player_idx, hand, has_laid_down, table_melds, round_idx):
        result = original_discard(player_idx, hand, has_laid_down, table_melds, round_idx)
        if result is not None:
            calls.append((list(hand), result))
        return result

    agent.discard = recording_discard
    rng = random.Random(42)
    from engine import play_game
    play_game(n_players=4, rng=rng, discard_hook=agent.discard)
    assert len(calls) > 0
    for hand, card in calls:
        assert card in hand, f"Returned card {card} not in hand {hand}"


def test_draw_hook_returns_valid_action():
    """Agent draw decision must return 'take' or 'draw' for player 0, None for others."""
    from agent import ShanghaiNetAgent
    net = _fresh_net()
    agent = ShanghaiNetAgent(net, player_idx=0, n_players=4, temperature=1.0)

    draw_returns = []
    original_draw = agent.draw

    def recording_draw(player_idx, hand, discard_top, has_laid_down, round_idx):
        result = original_draw(player_idx, hand, discard_top, has_laid_down, round_idx)
        draw_returns.append((player_idx, result))
        return result

    agent.draw = recording_draw
    rng = random.Random(42)
    from engine import play_game
    play_game(n_players=4, rng=rng, draw_hook=agent.draw)

    for pid, r in draw_returns:
        if pid == 0:
            assert r in ("take", "draw"), f"Invalid draw action: {r}"
        else:
            assert r is None


def test_trajectory_recorded_for_player_0():
    """After play_game, agent.trajectory should have steps for player 0 decisions."""
    from agent import ShanghaiNetAgent
    net = _fresh_net()
    agent = ShanghaiNetAgent(net, player_idx=0, n_players=4, temperature=1.0)

    rng = random.Random(42)
    from engine import play_game
    play_game(
        n_players=4, rng=rng,
        discard_hook=agent.discard,
        draw_hook=agent.draw,
        buy_hook=agent.buy,
        laydown_hook=agent.laydown,
    )

    assert len(agent.trajectory) > 0, "No steps recorded"
    for step in agent.trajectory:
        assert "state_vec" in step
        assert "action_type" in step
        assert "action_taken" in step
        assert "hand" in step
        assert "round_idx" in step
        assert step["state_vec"].shape == (170,)
        assert step["action_type"] in (0, 1, 2, 3)


def test_reset_clears_trajectory():
    from agent import ShanghaiNetAgent
    net = _fresh_net()
    agent = ShanghaiNetAgent(net, player_idx=0, n_players=4)
    rng = random.Random(1)
    from engine import play_game
    play_game(4, rng, discard_hook=agent.discard)
    agent.reset()
    assert agent.trajectory == []
