"""
Value labeler for AlphaZero-lite training.

label_values() annotates each trajectory step with a scalar value target
derived from the game's final outcome.  This is the standard REINFORCE
baseline approach: the value head learns to predict the expected final score
from the current state, providing a low-variance training signal.

Value target convention
-----------------------
    value_label = final_score (player 0's cumulative score across all 7 rounds)

Lower is better in Shanghai Rummy (fewest points wins), so the value head
predicts a raw score — not a reward.  The loss in train.py minimises
MSE between the predicted value and this label.

Discount factor
---------------
For games where future rounds are already "baked in" to the final score,
discount=1.0 (no discounting) is correct.  Pass discount < 1.0 to weight
earlier decisions less if desired; the label for step i (0-indexed from the
start of the trajectory) becomes:

    value_label = final_score * discount^(n_steps - 1 - i)
"""
from __future__ import annotations

from typing import List


def label_values(
    trajectories: List[dict],
    discount: float = 1.0,
) -> List[dict]:
    """
    Annotate each trajectory step with a value target.

    Args:
        trajectories: output of collect_games() — list of dicts, each with
            "steps" (list of step dicts) and "final_score" (float).
        discount: per-step discount factor applied backward from the end of
            the trajectory.  Default 1.0 (no discounting).

    Returns:
        The same trajectories list, with "value_label" (float) added to
        every step dict in-place.  Empty trajectories are skipped silently.
    """
    for traj in trajectories:
        steps = traj["steps"]
        if not steps:
            continue
        final_score = float(traj["final_score"])
        n = len(steps)
        for i, step in enumerate(steps):
            if discount == 1.0:
                step["value_label"] = final_score
            else:
                step["value_label"] = final_score * (discount ** (n - 1 - i))
    return trajectories
