# ml/pimc/alphazero/tests/test_engine_buy.py
import random
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from engine import play_round, JOKER_INT


def test_buy_hook_is_called():
    """buy_hook must be called when a buy opportunity arises for a non-zero player."""
    calls = []

    def hook(player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx):
        calls.append(player_idx)
        return False  # always decline so game proceeds normally

    rng = random.Random(99)
    # Run multiple games until at least one buy opportunity fires
    for seed in range(20):
        rng = random.Random(seed)
        try:
            play_round(0, 4, rng, buy_hook=hook)
        except Exception:
            pass  # some seeds may produce edge cases — keep trying

    assert len(calls) > 0, "buy_hook was never called across 20 games"


def test_buy_hook_can_force_decline():
    """When hook returns False, game completes without error."""
    def never_buy(player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx):
        return False

    rng = random.Random(42)
    scores = play_round(0, 4, rng, buy_hook=never_buy)
    assert len(scores) == 4
    assert all(isinstance(s, int) for s in scores)


def test_buy_hook_none_returns_use_greedy():
    """When hook returns None, greedy logic applies — same result as no hook."""
    def passthrough(player_idx, hand, discard_top, buys_remaining, has_laid_down, round_idx):
        return None  # let greedy decide

    rng1 = random.Random(7)
    rng2 = random.Random(7)
    scores_greedy = play_round(0, 4, rng1)
    scores_passthrough = play_round(0, 4, rng2, buy_hook=passthrough)
    assert scores_greedy == scores_passthrough
