"""
Pool of parallel ShanghaiEnv bridge processes for training data collection.

Each worker gets its own bridge subprocess so games can run concurrently
without contention on stdin/stdout.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List

_TRAINING = Path(__file__).parent.parent.parent / "training"
if str(_TRAINING) not in sys.path:
    sys.path.insert(0, str(_TRAINING))

from shanghai_env import ShanghaiEnv


class BridgePool:
    """N parallel ShanghaiEnv instances sharing the same configuration."""

    def __init__(
        self,
        n_workers: int = 4,
        player_count: int = 4,
        opponent_ai: str = "the-mastermind",
    ) -> None:
        self.n_workers    = n_workers
        self.player_count = player_count
        self.opponent_ai  = opponent_ai
        self.envs: List[ShanghaiEnv] = [
            ShanghaiEnv(player_count=player_count, opponent_ai=opponent_ai)
            for _ in range(n_workers)
        ]

    def close(self) -> None:
        for env in self.envs:
            try:
                env.close()
            except Exception:
                pass

    def __enter__(self) -> "BridgePool":
        return self

    def __exit__(self, *_) -> None:
        self.close()
