"""
Curriculum manager for Shanghai Rummy RL training.

Tracks agent performance at each difficulty tier and promotes
the agent to the next tier when improvement has plateaued.
"""

from __future__ import annotations

TIERS = [
    {"players": 2, "opponent": None,            "label": "2P random"},
    {"players": 2, "opponent": "rookie-riley",  "label": "2P rookie"},
    {"players": 4, "opponent": None,            "label": "4P random"},
    {"players": 4, "opponent": "rookie-riley",  "label": "4P rookie"},
    {"players": 4, "opponent": "steady-sam",    "label": "4P steady"},
    {"players": 4, "opponent": "patient-pat",   "label": "4P patient"},
    {"players": 4, "opponent": "the-shark",     "label": "4P shark"},
    {"players": 4, "opponent": "the-nemesis",   "label": "4P nemesis"},
]


class CurriculumManager:
    """
    Manages progressive difficulty tiers for RL training.

    Promotion logic: after at least `plateau_window` rewards have been
    recorded at the current tier, compare the mean of the most-recent 200
    rewards against the mean of the 200 rewards from `plateau_window`
    episodes ago. If the improvement is below `improvement_threshold`
    the agent has plateaued and is promoted to the next tier.
    """

    def __init__(
        self,
        plateau_window: int = 500,
        improvement_threshold: float = 0.02,
    ) -> None:
        self.plateau_window = plateau_window
        self.improvement_threshold = improvement_threshold
        self._tier_index: int = 0
        self._rewards: list[float] = []

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def current(self) -> dict:
        """Return the current tier configuration dict."""
        return TIERS[self._tier_index]

    @property
    def max_tier(self) -> int:
        """Return the index of the highest available tier."""
        return len(TIERS) - 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record(self, reward: float) -> None:
        """Append a single episode reward to the running history."""
        self._rewards.append(reward)

    def should_promote(self) -> bool:
        """
        Return True when the agent should move to the next tier.

        Conditions (all must hold):
          1. Not already at the maximum tier.
          2. At least `plateau_window` rewards recorded at this tier.
          3. The mean of the last 200 rewards has improved by less than
             `improvement_threshold` relative to the mean of the 200
             rewards from `plateau_window` episodes ago.
        """
        if self._tier_index >= self.max_tier:
            return False

        n = len(self._rewards)
        if n < self.plateau_window:
            return False

        window = 200

        # Recent window: last `window` rewards.
        recent_mean = _mean(self._rewards[-window:])

        # Earlier window: `window` rewards ending `plateau_window` ago.
        older_end = n - self.plateau_window
        older_start = max(0, older_end - window)
        older_mean = _mean(self._rewards[older_start:older_end])

        # Avoid division by zero / undefined improvement from a zero baseline.
        if older_mean == 0.0:
            improvement = abs(recent_mean - older_mean)
        else:
            improvement = (recent_mean - older_mean) / abs(older_mean)

        return improvement < self.improvement_threshold

    def promote(self) -> bool:
        """
        Advance to the next tier if not already at the maximum.

        Resets the reward history so plateau detection starts fresh.
        Prints a promotion message and returns True on success,
        returns False if already at the maximum tier.
        """
        if self._tier_index >= self.max_tier:
            return False

        old_label = self.current["label"]
        self._tier_index += 1
        self._rewards = []
        new_label = self.current["label"]

        print(
            f"[Curriculum] Promoted: {old_label!r} -> {new_label!r} "
            f"(tier {self._tier_index}/{self.max_tier})"
        )
        return True


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _mean(values: list[float]) -> float:
    """Return the arithmetic mean of a non-empty list, or 0.0 if empty."""
    if not values:
        return 0.0
    return sum(values) / len(values)
