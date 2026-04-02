"""Validate bridge produces games similar to the simulation framework.

Runs 30 games through the bridge with:
  - player 0 using random actions
  - opponents using 'the-shark' AI

Then checks stats against known simulation benchmarks:
  - Avg player score should be in 150-350 range
  - All games should complete within 5000 steps
  - Player 0 (random) should score worse (higher) than AI opponents
"""

import sys
import random
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "training"))

from shanghai_env import ShanghaiEnv


def run_validation(num_games: int = 30, players: int = 4) -> None:
    print("=" * 60)
    print(f"  Shanghai Bridge Validation — {num_games} games, {players} players")
    print("=" * 60)
    print()

    env = ShanghaiEnv(player_count=players, opponent_ai="the-shark")

    game_scores: list[list[int]] = []       # final scores per game (all players)
    game_steps: list[int] = []              # steps taken per game
    games_completed: int = 0
    games_failed: list[int] = []           # game indices that hit step limit or errored

    step_limit = 5000

    try:
        for game_idx in range(num_games):
            print(f"  Game {game_idx + 1:>2}/{num_games}...", end="", flush=True)

            try:
                env.reset(seed=random.randint(0, 2_147_483_647))
            except Exception as exc:
                print(f" ERROR on reset: {exc}")
                games_failed.append(game_idx)
                continue

            steps = 0
            done = False
            final_scores: list[int] | None = None

            while not done and steps < step_limit:
                try:
                    actions, current_player = env.get_valid_actions()
                except Exception as exc:
                    print(f" ERROR getting actions at step {steps}: {exc}")
                    games_failed.append(game_idx)
                    break

                if not actions:
                    # No valid actions — should not happen in a healthy bridge
                    print(f" WARN: no valid actions at step {steps}")
                    games_failed.append(game_idx)
                    break

                # Player 0 picks randomly; opponents are driven by the bridge AI
                if current_player == 0:
                    action = random.choice(actions)
                else:
                    # Bridge already auto-plays AI opponents; just pick first valid
                    action = actions[0]

                try:
                    _state, _reward, done, info = env.step(action)
                except Exception as exc:
                    print(f" ERROR on step {steps}: {exc}")
                    games_failed.append(game_idx)
                    break

                steps += 1

                if done:
                    scores = info.get("scores")
                    if scores and len(scores) == players:
                        final_scores = [int(s) for s in scores]
                    games_completed += 1
                    break
            else:
                if not done:
                    # Hit step limit without finishing
                    print(f" TIMEOUT (>{step_limit} steps)")
                    games_failed.append(game_idx)
                    steps = step_limit

            game_steps.append(steps)
            if final_scores is not None:
                game_scores.append(final_scores)
                status = f" done in {steps} steps — scores: {final_scores}"
            else:
                status = f" done in {steps} steps (no final scores)"
            print(status)

    finally:
        env.close()

    print()
    print("=" * 60)
    print("  RESULTS")
    print("=" * 60)
    print()

    # ── Basic counts ──────────────────────────────────────────────
    print(f"  Games attempted:   {num_games}")
    print(f"  Games completed:   {games_completed}")
    print(f"  Games failed:      {len(games_failed)}")
    if games_failed:
        print(f"  Failed indices:    {games_failed}")
    print()

    # ── Step stats ────────────────────────────────────────────────
    if game_steps:
        avg_steps = sum(game_steps) / len(game_steps)
        max_steps = max(game_steps)
        over_limit = sum(1 for s in game_steps if s >= step_limit)
        print(f"  Avg steps/game:    {avg_steps:.1f}")
        print(f"  Max steps/game:    {max_steps}")
        print(f"  Games over {step_limit} steps: {over_limit}")
        print()

    # ── Score stats ───────────────────────────────────────────────
    if game_scores:
        all_scores = [s for scores in game_scores for s in scores]
        player0_scores = [scores[0] for scores in game_scores]
        opponent_scores = [
            s
            for scores in game_scores
            for i, s in enumerate(scores)
            if i != 0
        ]

        avg_all = sum(all_scores) / len(all_scores)
        avg_p0 = sum(player0_scores) / len(player0_scores)
        avg_opp = sum(opponent_scores) / len(opponent_scores) if opponent_scores else 0.0

        print(f"  Avg player score (all):    {avg_all:.1f}  [target: 150–350]")
        print(f"  Avg player 0 score:        {avg_p0:.1f}   (random)")
        print(f"  Avg opponent score:        {avg_opp:.1f}  (the-shark AI)")
        print(f"  Player 0 score ratio:      {avg_p0 / avg_opp:.2f}x  [target: >1.0, i.e. random is worse]")
        print()
    else:
        avg_all = None
        avg_p0 = None
        avg_opp = None
        over_limit = num_games  # everything failed
        print("  No final scores recorded — cannot compute score stats.")
        print()

    # ── PASS / WARN checks ────────────────────────────────────────
    print("=" * 60)
    print("  CHECKS")
    print("=" * 60)
    print()

    checks_passed = 0
    checks_total = 0

    def check(label: str, passed: bool, detail: str = "") -> None:
        nonlocal checks_passed, checks_total
        checks_total += 1
        tag = "PASS" if passed else "WARN"
        suffix = f"  ({detail})" if detail else ""
        print(f"  [{tag}]  {label}{suffix}")
        if passed:
            checks_passed += 1

    # 1. All games complete
    check(
        "All games completed",
        games_completed == num_games,
        f"{games_completed}/{num_games}",
    )

    # 2. No game hit the step limit
    if game_steps:
        check(
            f"All games finish under {step_limit} steps",
            over_limit == 0,
            f"{over_limit} game(s) timed out",
        )
    else:
        check(f"All games finish under {step_limit} steps", False, "no step data")

    # 3. Avg score in 150–350 range
    if avg_all is not None:
        check(
            "Avg player score in 150–350 range",
            150 <= avg_all <= 350,
            f"{avg_all:.1f}",
        )
    else:
        check("Avg player score in 150–350 range", False, "no score data")

    # 4. Player 0 (random) worse than AI opponents
    if avg_p0 is not None and avg_opp is not None and avg_opp > 0:
        check(
            "Player 0 (random) scores worse than AI opponents",
            avg_p0 > avg_opp,
            f"p0={avg_p0:.1f} vs opp={avg_opp:.1f}",
        )
    else:
        check("Player 0 (random) scores worse than AI opponents", False, "no score data")

    # 5. Avg steps per game is sane (>0 and reasonable upper bound)
    if game_steps:
        avg_steps_val = sum(game_steps) / len(game_steps)
        check(
            "Avg steps/game in reasonable range (50–4000)",
            50 <= avg_steps_val <= 4000,
            f"{avg_steps_val:.1f}",
        )
    else:
        check("Avg steps/game in reasonable range", False, "no step data")

    print()
    print(f"  {checks_passed}/{checks_total} checks passed")
    print()
    print("=" * 60)


if __name__ == "__main__":
    run_validation()
