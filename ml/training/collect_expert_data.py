"""
Expert dataset collection for imitation bootstrap.

Plays shark-vs-shark 2P games and records (state, action) pairs for player 0
only. Both seats use the bridge's `get_ai_action` (which defaults to the-shark
when opponentAI is null), so game quality is expert-level throughout.

We can only record player 0's decisions because the bridge always encodes state
from player 0's perspective. To compensate, we play ~2x more games than we
would if we could record both sides.

Output: ml/data/expert_shark_2p.npz
    states  : (N, 273) float32
    actions : (N,)     int64  — index into the 26-action space (see encode_action)

Usage:
    python collect_expert_data.py --games 500
    python collect_expert_data.py --games 1000 --players 2 --out expert_shark_2p.npz
"""

import argparse
import time
from pathlib import Path

import numpy as np

from shanghai_env import ShanghaiEnv
from ppo import encode_action
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)


def collect(games: int, players: int, out_name: str, opponent_ai: str = 'the-shark'):
    # opponent_ai controls which personality the bridge uses for ALL players.
    # getAIRecommendedAction(game) uses game.opponentAI ?? 'the-shark', so the
    # expert label we record for player 0 matches the chosen personality.
    # autoPlayOpponents also uses this personality for P1+, so all four seats
    # play the same style in self-play mode (e.g. mastermind-vs-mastermind).
    env = ShanghaiEnv(player_count=players, opponent_ai=opponent_ai, rich_state=True)

    all_states: list[np.ndarray] = []
    all_actions: list[int] = []

    games_completed = 0
    games_max_steps = 0
    games_empty_actions = 0
    skipped_invalid = 0
    total_steps_by_reason = {"completed": [], "max_steps": [], "empty_actions": []}

    t0 = time.time()

    for g in range(games):
        state_list = env.reset()
        done = False
        step_count = 0
        broke_empty_actions = False
        # The bridge caps each round at 200 turns, so worst-case game length
        # is 7 rounds × 200 turns × ~3 decisions/turn ≈ 4200. The default 4000
        # cap was truncating competent-play games. Use 6000 to ensure all
        # shark-quality games finish naturally.
        max_steps = 6000 * max(1, players // 2)

        while not done and step_count < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                broke_empty_actions = True
                break
            if auto_state is not None:
                state_list = auto_state

            # Ask the bridge for the shark's recommended action for whoever's turn it is.
            # (getAIRecommendedAction defaults to 'the-shark' when opponentAI is null,
            # and uses currentPlayerIndex — so both players get expert-quality moves.)
            try:
                shark_action = env.get_ai_action()
            except Exception:
                # Some phases may not have a recommendation — fall back to valid[0]
                shark_action = valid_actions[0]

            if shark_action not in valid_actions:
                # Shouldn't happen after get_strategic_actions auto-execs meld/layoff,
                # but if it does (e.g. shark recommends meld that was already auto-exec'd),
                # fall back to any valid action.
                skipped_invalid += 1
                shark_action = valid_actions[0]

            # Record only player 0's decisions — state is always encoded for player 0,
            # so player 1's state/action pairs would be mislabeled.
            if current_player == 0:
                state_arr = np.asarray(state_list, dtype=np.float32)
                if state_arr.shape[0] != RICH_STATE_SIZE:
                    # Defensive — should never happen but catch silently
                    skipped_invalid += 1
                else:
                    action_idx = encode_action(shark_action)
                    if 0 <= action_idx < MAX_ACTIONS:
                        all_states.append(state_arr)
                        all_actions.append(action_idx)
                    else:
                        skipped_invalid += 1

            state_list, _, done, info = env.step(shark_action)
            step_count += 1

        if done:
            games_completed += 1
            total_steps_by_reason["completed"].append(step_count)
        elif broke_empty_actions:
            games_empty_actions += 1
            total_steps_by_reason["empty_actions"].append(step_count)
        else:
            games_max_steps += 1
            total_steps_by_reason["max_steps"].append(step_count)

        if (g + 1) % 25 == 0:
            elapsed = time.time() - t0
            rate = (g + 1) / elapsed
            eta = (games - (g + 1)) / rate if rate > 0 else 0
            print(
                f"  [{g+1:5d}/{games}] "
                f"samples={len(all_states):7d}  "
                f"done={games_completed}  max_steps={games_max_steps}  empty={games_empty_actions}  "
                f"rate={rate:.2f} games/s  eta={eta/60:.1f}m"
            )

    env.close()

    states_arr = np.stack(all_states) if all_states else np.empty((0, RICH_STATE_SIZE), dtype=np.float32)
    actions_arr = np.asarray(all_actions, dtype=np.int64)

    out_path = DATA_DIR / out_name
    np.savez_compressed(out_path, states=states_arr, actions=actions_arr)

    elapsed = time.time() - t0
    print()
    print("=" * 60)
    print(f"Collection complete in {elapsed/60:.1f} minutes")
    print("=" * 60)
    print(f"  Games played:       {games}")
    print(f"    completed:        {games_completed}")
    print(f"    hit max_steps:    {games_max_steps}")
    print(f"    empty actions:    {games_empty_actions}")
    # Per-reason step averages help diagnose what's stopping games
    for reason, steps in total_steps_by_reason.items():
        if steps:
            avg = sum(steps) / len(steps)
            print(f"      avg steps ({reason}): {avg:.0f}")
    print(f"  Samples recorded:   {len(all_states)}")
    print(f"  Skipped invalid:    {skipped_invalid}")
    print(f"  Per-game avg:       {len(all_states) / max(games, 1):.1f} decisions")
    print(f"  Action distribution:")
    if len(all_actions) > 0:
        counts = np.bincount(actions_arr, minlength=MAX_ACTIONS)
        total = len(all_actions)
        action_names = {
            0: "draw_pile", 1: "take_discard", 24: "buy", 25: "decline_buy",
        }
        for idx in range(MAX_ACTIONS):
            if counts[idx] == 0:
                continue
            if idx in action_names:
                label = action_names[idx]
            else:
                label = f"discard:{idx - 2}"
            print(f"    {label:14s} {counts[idx]:7d} ({counts[idx]/total*100:5.1f}%)")
    print()
    print(f"  Saved to: {out_path}")
    print(f"  File size: {out_path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    from log_utils import setup_logging
    setup_logging("collect_expert_data")

    parser = argparse.ArgumentParser(description="Collect expert self-play dataset for imitation training")
    parser.add_argument("--games",       type=int, default=500,          help="Number of games to play")
    parser.add_argument("--players",     type=int, default=2,            help="Players per game (2 or 4)")
    parser.add_argument("--out",         type=str, default="expert_shark_2p.npz", help="Output filename (in ml/data/)")
    parser.add_argument("--opponent-ai", type=str, default="the-shark",  help="AI personality for all seats (default: the-shark)")
    args = parser.parse_args()

    print(f"Expert data collection — {args.opponent_ai} vs {args.opponent_ai}")
    print(f"  Games:       {args.games}")
    print(f"  Players:     {args.players}")
    print(f"  Opponent AI: {args.opponent_ai}")
    print(f"  Output:      ml/data/{args.out}")
    print()

    collect(args.games, args.players, args.out, opponent_ai=args.opponent_ai)
