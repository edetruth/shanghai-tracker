import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc

from alphazero.network   import ShanghaiNet
from alphazero.evaluate  import evaluate_model


def _net():
    return ShanghaiNet()


def test_evaluate_model_returns_expected_keys():
    net = _net()
    result = evaluate_model(net, n_games=2, seed=0)
    for key in ("avg_score", "std_score", "min_score", "max_score", "win_rate", "n_games"):
        assert key in result, f"Missing key: {key}"


def test_evaluate_model_n_games():
    net = _net()
    result = evaluate_model(net, n_games=3, seed=1)
    assert result["n_games"] == 3


def test_evaluate_model_scores_non_negative():
    net = _net()
    result = evaluate_model(net, n_games=3, seed=2)
    assert result["avg_score"] >= 0.0
    assert result["min_score"] >= 0.0


def test_evaluate_model_win_rate_in_range():
    net = _net()
    result = evaluate_model(net, n_games=4, seed=3)
    assert 0.0 <= result["win_rate"] <= 1.0


def test_evaluate_model_min_le_avg_le_max():
    net = _net()
    result = evaluate_model(net, n_games=5, seed=4)
    assert result["min_score"] <= result["avg_score"] <= result["max_score"]
