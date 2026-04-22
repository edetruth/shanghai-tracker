import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc


import numpy as np
from alphazero.value_labeler import label_values


def _make_traj(n_steps: int, final_score: float) -> dict:
    steps = [
        {
            "state_vec": np.zeros(170, dtype=np.float32),
            "action_type": 0,
            "action_taken": 0,
            "hand": [],
            "round_idx": 0,
            "has_laid_down": False,
            "opp_sizes": [10.0, 10.0, 10.0],
        }
        for _ in range(n_steps)
    ]
    return {"steps": steps, "final_score": final_score}


def test_label_values_adds_value_label_key():
    trajs = [_make_traj(5, 42.0)]
    label_values(trajs)
    for step in trajs[0]["steps"]:
        assert "value_label" in step, "value_label key missing"


def test_label_values_no_discount():
    trajs = [_make_traj(4, 77.0)]
    label_values(trajs, discount=1.0)
    for step in trajs[0]["steps"]:
        assert step["value_label"] == 77.0


def test_label_values_with_discount():
    """Earlier steps should receive lower discounted labels."""
    trajs = [_make_traj(3, 100.0)]
    label_values(trajs, discount=0.9)
    steps = trajs[0]["steps"]
    # step 0: 100 * 0.9^2 = 81, step 1: 100 * 0.9^1 = 90, step 2: 100 * 0.9^0 = 100
    assert abs(steps[0]["value_label"] - 81.0) < 1e-4
    assert abs(steps[1]["value_label"] - 90.0) < 1e-4
    assert abs(steps[2]["value_label"] - 100.0) < 1e-4


def test_label_values_empty_steps_skipped():
    trajs = [_make_traj(0, 50.0), _make_traj(3, 50.0)]
    label_values(trajs)  # should not raise
    assert trajs[0]["steps"] == []
    for step in trajs[1]["steps"]:
        assert step["value_label"] == 50.0


def test_label_values_multiple_trajectories():
    trajs = [_make_traj(2, 30.0), _make_traj(3, 60.0)]
    label_values(trajs)
    for step in trajs[0]["steps"]:
        assert step["value_label"] == 30.0
    for step in trajs[1]["steps"]:
        assert step["value_label"] == 60.0


def test_label_values_returns_same_list():
    trajs = [_make_traj(2, 10.0)]
    result = label_values(trajs)
    assert result is trajs, "label_values should return the same list object"
