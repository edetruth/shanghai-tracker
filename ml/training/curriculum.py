"""
Curriculum manager for Shanghai Rummy RL training.

Tracks agent performance at each difficulty tier and promotes
the agent to the next tier when improvement has plateaued.
"""

from __future__ import annotations

TIERS = [
    {"players": 2, "opponent": None,            "label": "2P random",    "min_win_rate": 0.60},
    {"players": 2, "opponent": "rookie-riley",  "label": "2P rookie",   "min_win_rate": 0.40},
    {"players": 4, "opponent": None,            "label": "4P random",   "min_win_rate": 0.35},
    {"players": 4, "opponent": "rookie-riley",  "label": "4P rookie",   "min_win_rate": 0.30},
    {"players": 4, "opponent": "steady-sam",    "label": "4P steady",   "min_win_rate": 0.25},
    {"players": 4, "opponent": "patient-pat",   "label": "4P patient",  "min_win_rate": 0.20},
    {"players": 4, "opponent": "the-shark",     "label": "4P shark",    "min_win_rate": 0.15},
    {"players": 4, "opponent": "mixed-hard",    "label": "4P mixed-hard", "min_win_rate": 0.15},
    {"players": 4, "opponent": "the-nemesis",   "label": "4P nemesis",  "min_win_rate": 0.10},
]


class CurriculumManager:
    """
    Manages progressive difficulty tiers for RL training.

    Promotion: must meet per-tier minimum win rate AND plateau/dominate.
    Demotion: win rate below half the tier minimum after 500 games.
    """

    def __init__(
        self,
        plateau_window: int = 1000,
        improvement_threshold: float = 0.05,
    ) -> None:
        self.plateau_window = plateau_window
        self.improvement_threshold = improvement_threshold
        self._tier_index: int = 0
        self._rewards: list[float] = []
        self._wins: int = 0
        self._games: int = 0

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

    @property
    def win_rate(self) -> float:
        """Return win rate at current tier."""
        if self._games == 0:
            return 0.0
        return self._wins / self._games

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record(self, reward: float, won: bool = False) -> None:
        """Append a single episode reward and win/loss to the running history."""
        self._rewards.append(reward)
        self._games += 1
        if won:
            self._wins += 1

    def should_promote(self) -> bool:
        """
        Return True when the agent should move to the next tier.

        Conditions (all must hold):
          1. Not already at the maximum tier.
          2. At least `plateau_window` games played at this tier.
          3. Win rate meets the tier's minimum threshold.
          4. EITHER: reward has plateaued (improvement < threshold)
             OR: win rate exceeds the tier minimum by 10+ percentage points.

        This prevents promoting agents that plateau at zero competence.
        """
        if self._tier_index >= self.max_tier:
            return False

        if self._games < self.plateau_window:
            return False

        min_wr = self.current.get("min_win_rate", 0.15)

        # Gate: must meet minimum win rate for this tier
        if self.win_rate < min_wr:
            return False

        # Fast-track: clearly dominating the tier
        if self.win_rate >= min_wr + 0.10:
            return True

        # Standard: plateaued but competent
        n = len(self._rewards)
        window = 200
        recent_mean = _mean(self._rewards[-window:])
        older_end = n - self.plateau_window
        older_start = max(0, older_end - window)
        older_mean = _mean(self._rewards[older_start:older_end])

        if older_mean == 0.0:
            improvement = abs(recent_mean - older_mean)
        else:
            improvement = (recent_mean - older_mean) / abs(older_mean)

        return improvement < self.improvement_threshold

    def should_demote(self) -> bool:
        """
        Return True if agent should drop back to previous tier.

        Condition: after 500 games at current tier, win rate is less
        than half the tier's minimum threshold. Not at tier 0.
        """
        if self._tier_index <= 0:
            return False
        if self._games < 500:
            return False
        min_wr = self.current.get("min_win_rate", 0.15)
        return self.win_rate < min_wr * 0.5

    def promote(self) -> bool:
        """Advance to the next tier. Resets history. Returns True on success."""
        if self._tier_index >= self.max_tier:
            return False

        old_label = self.current["label"]
        self._tier_index += 1
        self._rewards = []
        self._wins = 0
        self._games = 0
        new_label = self.current["label"]

        print(
            f"[Curriculum] Promoted: {old_label!r} -> {new_label!r} "
            f"(tier {self._tier_index}/{self.max_tier})"
        )
        return True

    def demote(self) -> bool:
        """Drop back to previous tier. Returns True on success."""
        if self._tier_index <= 0:
            return False

        old_label = self.current["label"]
        self._tier_index -= 1
        self._rewards = []
        self._wins = 0
        self._games = 0
        new_label = self.current["label"]

        print(
            f"[Curriculum] Demoted: {old_label!r} -> {new_label!r} "
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
