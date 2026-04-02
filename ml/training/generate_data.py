"""
Generate training data for hybrid neural AI.

Plays N games through the bridge with AI opponents, capturing every
decision point with full state vectors and outcome labels.

Usage:
    python generate_data.py --games 5000 --players 4 --opponent the-shark
"""

import argparse
import json
import random
import time
from pathlib import Path

from shanghai_env import ShanghaiEnv

DATA_DIR = Path(__file__).parent.parent / "data" / "hybrid_training"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def generate_games(args):
    print(f"Generating training data")
    print(f"  Games:    {args.games}")
    print(f"  Players:  {args.players}")
    print(f"  Opponent: {args.opponent or 'random'}")
    print()

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state=True,
    )

    all_discard_samples = []  # (state_vec, hand, round, card_discarded_idx)
    all_buy_samples = []      # (state_vec, hand, round, offered_card, bought)
    all_hand_snapshots = []   # (state_vec, round, turns_until_meld, did_meld)

    games_completed = 0
    start = time.time()

    for game_i in range(args.games):
        seed = 50000 + game_i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 3000 * max(1, args.players // 2)

        # Per-round tracking: snapshots taken this round, keyed by round number
        round_snapshots = []  # list of (state_vec, round_num, snapshot_turn)
        current_round = 1
        round_turn = 0
        meld_turn = None  # turn within this round when player 0 melded

        while not done and step_count < max_steps:
            valid_actions, current_player = env.get_valid_actions()
            if not valid_actions:
                break

            # Get full state for player 0 data capture
            full_state = env.get_full_state(player=0)
            state_vec = full_state["state"]
            phase = full_state["phase"]
            hand = full_state["hand"]
            has_laid_down = full_state["hasLaidDown"]
            game_round = full_state["round"]

            # Detect round change — flush snapshots with meld outcome
            if game_round != current_round:
                # Label all snapshots from the previous round
                for snap_state, snap_round, snap_turn in round_snapshots:
                    if meld_turn is not None:
                        turns_to_meld = meld_turn - snap_turn
                        label = max(0.0, 1.0 - turns_to_meld / 50.0)
                    else:
                        label = 0.0  # never melded = worst score
                    all_hand_snapshots.append({
                        "state": snap_state,
                        "round": snap_round,
                        "label": round(label, 4),
                    })
                round_snapshots = []
                current_round = game_round
                round_turn = 0
                meld_turn = None

            if current_player == 0:
                round_turn += 1

                # Snapshot hand state every turn for hand evaluator training
                if phase in ("draw", "action") and not has_laid_down:
                    round_snapshots.append((state_vec, game_round, round_turn))

                # Detect melding
                if not has_laid_down and "meld" in valid_actions:
                    # Check after action if they melded
                    pass  # we detect via has_laid_down changing

                # Capture discard decisions
                discard_actions = [a for a in valid_actions if a.startswith("discard:")]
                if phase == "action" and discard_actions and len(hand) > 1:
                    # Choose action (use AI's choice via bridge)
                    action = random.choice(valid_actions)
                    if action.startswith("discard:"):
                        card_idx = int(action.split(":")[1])
                        all_discard_samples.append({
                            "state": state_vec,
                            "hand": hand,
                            "round": game_round,
                            "discarded_idx": card_idx,
                            "hand_size": len(hand),
                        })

                # Capture buy decisions
                if phase == "buy-window":
                    bought = "buy" in valid_actions
                    offered = full_state.get("discardTop")
                    action = random.choice(valid_actions)
                    is_buy = action == "buy"
                    if offered:
                        all_buy_samples.append({
                            "state": state_vec,
                            "hand": hand,
                            "round": game_round,
                            "offered_card": offered,
                            "bought": is_buy,
                        })
                else:
                    action = random.choice(valid_actions)

                # Track meld detection
                state_vec_after, _, done, info = env.step(action)
                after_state = env.get_full_state(player=0)
                if not has_laid_down and after_state["hasLaidDown"]:
                    meld_turn = round_turn

            else:
                action = random.choice(valid_actions)
                _, _, done, info = env.step(action)

            step_count += 1

        # Flush final round snapshots
        for snap_state, snap_round, snap_turn in round_snapshots:
            if meld_turn is not None:
                turns_to_meld = meld_turn - snap_turn
                label = max(0.0, 1.0 - turns_to_meld / 50.0)
            else:
                label = 0.0
            all_hand_snapshots.append({
                "state": snap_state,
                "round": snap_round,
                "label": round(label, 4),
            })

        games_completed += 1
        if games_completed % 100 == 0 or games_completed == args.games:
            elapsed = time.time() - start
            print(
                f"  Game {games_completed:5d}/{args.games} | "
                f"Hand samples: {len(all_hand_snapshots):7d} | "
                f"Discard samples: {len(all_discard_samples):7d} | "
                f"Buy samples: {len(all_buy_samples):6d} | "
                f"Time: {elapsed:.1f}s"
            )

    env.close()

    # Save data
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    hand_path = DATA_DIR / f"hand_eval_{timestamp}.json"
    with open(hand_path, "w") as f:
        json.dump({"count": len(all_hand_snapshots), "samples": all_hand_snapshots}, f)
    print(f"\nHand evaluator data: {len(all_hand_snapshots)} samples -> {hand_path}")

    discard_path = DATA_DIR / f"discard_{timestamp}.json"
    with open(discard_path, "w") as f:
        json.dump({"count": len(all_discard_samples), "samples": all_discard_samples}, f)
    print(f"Discard policy data: {len(all_discard_samples)} samples -> {discard_path}")

    buy_path = DATA_DIR / f"buy_{timestamp}.json"
    with open(buy_path, "w") as f:
        json.dump({"count": len(all_buy_samples), "samples": all_buy_samples}, f)
    print(f"Buy evaluator data:  {len(all_buy_samples)} samples -> {buy_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate training data for hybrid neural AI")
    parser.add_argument("--games", type=int, default=5000, help="Number of games to play")
    parser.add_argument("--players", type=int, default=4, help="Players per game")
    parser.add_argument("--opponent", type=str, default="the-shark", help="AI personality for all players")
    args = parser.parse_args()
    generate_games(args)
