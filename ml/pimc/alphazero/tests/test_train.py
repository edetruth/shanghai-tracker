import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc

import numpy as np
import torch
import pytest

from alphazero.network import ShanghaiNet
from alphazero.train import build_batch, compute_losses, ACTION_DISCARD, ACTION_DRAW, ACTION_BUY, ACTION_LAYDOWN


def _step(action_type: int, action_taken: int, value_label: float = 50.0) -> dict:
    return {
        "state_vec":   np.zeros(170, dtype=np.float32),
        "action_type":  action_type,
        "action_taken": action_taken,
        "value_label":  value_label,
    }


# ── build_batch ───────────────────────────────────────────────────────────────

def test_build_batch_shapes():
    steps = [_step(0, 5), _step(1, 1), _step(2, 0), _step(3, 1)]
    b = build_batch(steps)
    assert b["state_vecs"].shape   == (4, 170)
    assert b["action_types"].shape  == (4,)
    assert b["action_takens"].shape == (4,)
    assert b["value_labels"].shape  == (4,)


def test_build_batch_dtypes():
    steps = [_step(0, 10, 30.0)]
    b = build_batch(steps)
    assert b["state_vecs"].dtype   == torch.float32
    assert b["action_types"].dtype  == torch.int64
    assert b["action_takens"].dtype == torch.int64
    assert b["value_labels"].dtype  == torch.float32


def test_build_batch_values():
    steps = [_step(ACTION_DRAW, 1, 77.0)]
    b = build_batch(steps)
    assert b["action_types"][0].item()   == ACTION_DRAW
    assert b["action_takens"][0].item()  == 1
    assert b["value_labels"][0].item()   == pytest.approx(77.0)


def test_build_batch_empty_raises():
    with pytest.raises(ValueError):
        build_batch([])


# ── compute_losses ────────────────────────────────────────────────────────────

def _net():
    return ShanghaiNet()


def test_compute_losses_keys():
    net   = _net()
    steps = [_step(ACTION_DISCARD, 3)]
    b     = build_batch(steps)
    losses = compute_losses(net, b)
    for key in ("policy_loss", "value_loss", "entropy", "total_loss"):
        assert key in losses, f"Missing key: {key}"


def test_compute_losses_all_action_types():
    """One step of each type — no crash, all losses finite."""
    net = _net()
    steps = [
        _step(ACTION_DISCARD,  3),
        _step(ACTION_DRAW,     1),
        _step(ACTION_BUY,      0),
        _step(ACTION_LAYDOWN,  1),
    ]
    b = build_batch(steps)
    losses = compute_losses(net, b)
    for key, val in losses.items():
        assert torch.isfinite(val), f"{key} is not finite: {val}"


def test_compute_losses_scalars():
    net = _net()
    b   = build_batch([_step(ACTION_DISCARD, 0)])
    losses = compute_losses(net, b)
    for key, val in losses.items():
        assert val.ndim == 0, f"{key} should be scalar"


def test_compute_losses_backprop():
    """total_loss.backward() should not raise and gradients should flow."""
    net  = _net()
    b    = build_batch([_step(ACTION_DISCARD, 5, 30.0), _step(ACTION_DRAW, 0, 30.0)])
    loss = compute_losses(net, b)["total_loss"]
    loss.backward()
    grads = [p.grad for p in net.parameters() if p.grad is not None]
    assert len(grads) > 0, "No gradients flowed to network parameters"


def test_compute_losses_only_discard():
    net = _net()
    b   = build_batch([_step(ACTION_DISCARD, 10) for _ in range(8)])
    losses = compute_losses(net, b)
    assert torch.isfinite(losses["total_loss"])


def test_compute_losses_only_binary():
    """Batch with only buy/laydown steps — no crash."""
    net = _net()
    steps = [_step(ACTION_BUY, 1), _step(ACTION_LAYDOWN, 0)]
    b = build_batch(steps)
    losses = compute_losses(net, b)
    assert torch.isfinite(losses["total_loss"])
