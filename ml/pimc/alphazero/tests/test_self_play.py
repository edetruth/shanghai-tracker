import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc


def _fresh_net():
    from network import ShanghaiNet
    return ShanghaiNet()


def test_collect_games_returns_correct_count():
    from self_play import collect_games
    net = _fresh_net()
    results = collect_games(net, n_games=3, opponent_pool=[net], temperature=1.0, seed=0)
    assert len(results) == 3, f"Expected 3 trajectories, got {len(results)}"


def test_collect_games_trajectory_structure():
    from self_play import collect_games
    net = _fresh_net()
    results = collect_games(net, n_games=2, opponent_pool=[net], temperature=1.0, seed=1)
    for traj in results:
        assert "steps" in traj, "Trajectory missing 'steps'"
        assert "final_score" in traj, "Trajectory missing 'final_score'"
        assert isinstance(traj["final_score"], float)
        assert len(traj["steps"]) > 0, "Trajectory has no steps"
        for step in traj["steps"]:
            assert step["state_vec"].shape == (170,)
            assert step["action_type"] in (0, 1, 2, 3)


def test_collect_games_final_score_non_negative():
    """Shanghai scores are always >= 0 (winner gets 0, others get hand points)."""
    from self_play import collect_games
    net = _fresh_net()
    results = collect_games(net, n_games=5, opponent_pool=[net], temperature=1.0, seed=2)
    for traj in results:
        assert traj["final_score"] >= 0, f"Negative score: {traj['final_score']}"


def test_collect_games_multi_pool():
    """With multiple nets in pool, runs without error."""
    from self_play import collect_games
    from network import ShanghaiNet
    nets = [ShanghaiNet() for _ in range(3)]
    results = collect_games(nets[0], n_games=4, opponent_pool=nets, temperature=1.0, seed=3)
    assert len(results) == 4
