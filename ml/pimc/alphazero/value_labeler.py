"""
Value labeler for AlphaZero-lite training.

label_values() annotates each trajectory step with a scalar value target.

Two modes
---------
Round-level (default, round_rewards=True):
    Each step is labeled with the cumulative score at the END of the round
    in which that step occurred.  This gives 7x denser feedback than
    game-level labeling: a discard in round 2 is judged on how round 2 went,
    not on the 7-round total.

    round_idx is recovered from positions 159:166 of the state vector
    (one-hot encoding).  If round_cumulative is missing from a trajectory
    (e.g. old data), falls back to final_score.

Game-level (round_rewards=False):
    All steps in a trajectory receive the same label: the player's total
    cumulative score across all 7 rounds.  This is the original REINFORCE
    baseline approach.
"""
from __future__ import annotations

import numpy as np
from typing import List


def label_values(
    trajectories: List[dict],
    round_rewards: bool = True,
) -> List[dict]:
    """
    Annotate each trajectory step with a value target.

    Args:
        trajectories: output of collect_games() — list of dicts, each with
            "steps", "final_score", and (if round_rewards) "round_cumulative".
        round_rewards: if True, label each step with the cumulative score at
            the end of its own round. If False, use the 7-round final score.

    Returns:
        The same trajectories list with "value_label" (float) added to every
        step dict in-place.
    """
    for traj in trajectories:
        steps = traj["steps"]
        if not steps:
            continue

        final_score = float(traj["final_score"])
        round_cumulative: dict = traj.get("round_cumulative", {})

        for step in steps:
            if round_rewards and round_cumulative:
                round_idx = int(np.argmax(step["state_vec"][159:166]))
                step["value_label"] = round_cumulative.get(round_idx, final_score)
            else:
                step["value_label"] = final_score

    return trajectories
