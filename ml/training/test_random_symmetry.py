"""
Sanity test for random-vs-random symmetry in 2P Shanghai.

Runs 200 pure-random games, tracks per-player scores separately, and
counts P0 wins / P1 wins / ties without ambiguity. Tells us whether
the 91% baseline is a real seat advantage or a counting bug.
"""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from shanghai_env import ShanghaiEnv
from log_utils import setup_logging


def run_games(games: int = 200, players: int = 2):
    env = ShanghaiEnv(player_count=players, rich_state=True)

    p0_scores = []
    p1_scores = []
    p0_wins = 0
    p1_wins = 0
    ties = 0
    timeouts = 0
    completed_info_missing = 0

    # Track per-round going-out: which seat goes out most?
    going_out_by_seat = [0] * players

    for i in range(games):
        state = env.reset(seed=90000 + i)
        done = False
        steps = 0
        max_steps = 4000

        prev_scores = [0] * players
        info = {}

        while not done and steps < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break
            if auto_state is not None:
                state = auto_state

            action_str = random.choice(valid_actions)
            state, _, done, info = env.step(action_str)
            steps += 1

            # Track round-end going-out: if a player's score DIDN'T increase
            # (stayed 0) while the round changed, they went out.
            if info.get("scores"):
                cur = [float(s) for s in info["scores"]]
                for pi in range(players):
                    delta = cur[pi] - prev_scores[pi]
                    # going out = round ended but no score added for this player
                    # Detect round-end by: total of all deltas >= 0 AND at least one delta > 0
                    # Simpler: track whenever someone else's score jumps
                    if delta == 0 and any(cur[pj] - prev_scores[pj] > 0 for pj in range(players) if pj != pi):
                        # Someone else scored, this player didn't → went out
                        pass  # noisy signal, skip
                prev_scores = cur

        if not done:
            timeouts += 1

        scores = info.get("scores", [])
        if not scores or len(scores) < players:
            completed_info_missing += 1
            continue

        s0 = float(scores[0])
        s1 = float(scores[1])
        p0_scores.append(s0)
        p1_scores.append(s1)

        if s0 < s1:
            p0_wins += 1
        elif s1 < s0:
            p1_wins += 1
        else:
            ties += 1

        if (i + 1) % 50 == 0:
            total = p0_wins + p1_wins + ties
            print(
                f"  Game {i+1:4d}/{games} | "
                f"P0: {p0_wins} ({p0_wins/max(total,1)*100:5.1f}%) | "
                f"P1: {p1_wins} ({p1_wins/max(total,1)*100:5.1f}%) | "
                f"ties: {ties}"
            )

    env.close()

    total = p0_wins + p1_wins + ties
    print()
    print("=" * 60)
    print(f"Random-vs-random symmetry test ({players}P, {games} games)")
    print("=" * 60)
    print(f"  Timeouts:          {timeouts}")
    print(f"  Info missing:      {completed_info_missing}")
    print(f"  Games counted:     {total}")
    print()
    print(f"  P0 wins: {p0_wins:4d} ({p0_wins/max(total,1)*100:5.1f}%)")
    print(f"  P1 wins: {p1_wins:4d} ({p1_wins/max(total,1)*100:5.1f}%)")
    print(f"  Ties:    {ties:4d} ({ties/max(total,1)*100:5.1f}%)")
    print()
    if p0_scores:
        import statistics
        print(f"  P0 score: mean={statistics.mean(p0_scores):.1f}, "
              f"median={statistics.median(p0_scores):.0f}, "
              f"stdev={statistics.stdev(p0_scores):.1f}")
        print(f"  P1 score: mean={statistics.mean(p1_scores):.1f}, "
              f"median={statistics.median(p1_scores):.0f}, "
              f"stdev={statistics.stdev(p1_scores):.1f}")
        mean_diff = statistics.mean(p0_scores) - statistics.mean(p1_scores)
        print(f"  Mean diff (P0 - P1): {mean_diff:+.1f}")
    print()

    # Interpretation
    if total > 0:
        p0_pct = p0_wins / total * 100
        if 45 <= p0_pct <= 55:
            print("  VERDICT: symmetric (no seat bias)")
        elif 55 < p0_pct <= 65:
            print("  VERDICT: mild seat advantage for P0 (plausible — first move)")
        elif p0_pct > 65:
            print(f"  VERDICT: STRONG P0 bias ({p0_pct:.1f}%) — BUG in engine or scoring")
        else:
            print(f"  VERDICT: P1 advantage ({100-p0_pct:.1f}%) — unusual")


if __name__ == "__main__":
    setup_logging("test_random_symmetry")
    run_games(games=200, players=2)
