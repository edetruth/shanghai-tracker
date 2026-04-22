import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc

import pytest
import torch

from alphazero.network import ShanghaiNet
from alphazero.runner  import train_iteration, _temperature_for


def _net():
    return ShanghaiNet()


# ── _temperature_for ──────────────────────────────────────────────────────────

def test_temperature_phase_1():
    assert _temperature_for(1,   300) == 1.0
    assert _temperature_for(99,  300) == 1.0


def test_temperature_phase_2():
    assert _temperature_for(100, 300) == 0.5
    assert _temperature_for(199, 300) == 0.5


def test_temperature_phase_3():
    assert _temperature_for(200, 300) == 0.2
    assert _temperature_for(300, 300) == 0.2


# ── train_iteration ───────────────────────────────────────────────────────────

def test_train_iteration_returns_expected_keys():
    net  = _net()
    opt  = torch.optim.Adam(net.parameters(), lr=1e-4)
    pool = [_net()]
    stats = train_iteration(net, opt, pool, n_games=1, temperature=1.0, seed=0)
    for key in ("policy_loss", "value_loss", "entropy", "total_loss", "avg_score", "n_steps"):
        assert key in stats, f"Missing key: {key}"


def test_train_iteration_avg_score_non_negative():
    net  = _net()
    opt  = torch.optim.Adam(net.parameters(), lr=1e-4)
    pool = [_net()]
    stats = train_iteration(net, opt, pool, n_games=1, temperature=1.0, seed=1)
    assert stats["avg_score"] >= 0.0


def test_train_iteration_losses_finite():
    net  = _net()
    opt  = torch.optim.Adam(net.parameters(), lr=1e-4)
    pool = [_net(), _net()]
    stats = train_iteration(net, opt, pool, n_games=2, temperature=1.0, seed=2)
    for key in ("policy_loss", "value_loss", "entropy", "total_loss"):
        assert abs(stats[key]) < 1e6, f"{key} looks diverged: {stats[key]}"


def test_train_iteration_updates_weights():
    """Weights should differ after a gradient step."""
    net = _net()
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    before = [p.clone() for p in net.parameters()]
    pool = [_net()]
    train_iteration(net, opt, pool, n_games=1, seed=3)
    changed = any(not torch.equal(b, p) for b, p in zip(before, net.parameters()))
    assert changed, "No weight was updated after train_iteration"


def test_train_iteration_n_steps_positive():
    net  = _net()
    opt  = torch.optim.Adam(net.parameters(), lr=1e-4)
    pool = [_net()]
    stats = train_iteration(net, opt, pool, n_games=1, seed=4)
    assert stats["n_steps"] > 0
