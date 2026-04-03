"""
Generate training data for hybrid neural AI.

Plays N games through the bridge with AI opponents, capturing every
decision point with full state vectors and outcome labels.

Usage:
    python generate_data.py --games 5000 --players 4 --opponent the-shark
    python generate_data.py --games 5000 --players 4 --v2 --mixed-opponents
"""

import argparse
import json
import time
from pathlib import Path

from shanghai_env import ShanghaiEnv

DATA_DIR_V1 = Path(__file__).parent.parent / "data" / "hybrid_training"
DATA_DIR_V2 = Path(__file__).parent.parent / "data" / "hybrid_training_v2"

MIXED_OPPONENTS = ["the-shark", "the-nemesis", "patient-pat", "steady-sam"]

SAVE_INTERVAL = 500  # save checkpoint every N games


def save_data(hand_snapshots, discard_samples, buy_samples, tag="",
              draw_samples=None, data_dir=None):
    """Save datasets to JSON. Returns the paths."""
    if data_dir is None:
        data_dir = DATA_DIR_V1
    data_dir.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    suffix = f"_{tag}" if tag else ""

    hand_path = data_dir / f"hand_eval_{timestamp}{suffix}.json"
    with open(hand_path, "w") as f:
        json.dump({"count": len(hand_snapshots), "samples": hand_snapshots}, f)

    discard_path = data_dir / f"discard_{timestamp}{suffix}.json"
    with open(discard_path, "w") as f:
        json.dump({"count": len(discard_samples), "samples": discard_samples}, f)

    buy_path = data_dir / f"buy_{timestamp}{suffix}.json"
    with open(buy_path, "w") as f:
        json.dump({"count": len(buy_samples), "samples": buy_samples}, f)

    paths = [hand_path, discard_path, buy_path]

    if draw_samples is not None:
        draw_path = data_dir / f"draw_{timestamp}{suffix}.json"
        with open(draw_path, "w") as f:
            json.dump({"count": len(draw_samples), "samples": draw_samples}, f)
        paths.append(draw_path)

    return tuple(paths)


def generate_games(args):
    v2 = getattr(args, "v2", False)
    mixed = getattr(args, "mixed_opponents", False)
    data_dir = DATA_DIR_V2 if v2 else DATA_DIR_V1

    print(f"Generating training data {'(v2)' if v2 else '(v1)'}")
    print(f"  Games:    {args.games}")
    print(f"  Players:  {args.players}")
    if mixed:
        print(f"  Opponents: mixed {MIXED_OPPONENTS}")
    else:
        print(f"  Opponent: {args.opponent or 'random'}")
    print(f"  Data dir: {data_dir}")
    print()

    def create_env(opponent):
        if v2:
            return ShanghaiEnv(
                player_count=args.players,
                opponent_ai=opponent,
                rich_state_v2=True,
            )
        else:
            return ShanghaiEnv(
                player_count=args.players,
                opponent_ai=opponent,
                rich_state=True,
            )

    current_opponent = args.opponent
    env = create_env(current_opponent)

    all_discard_samples = []  # (state_vec, hand, round, card_discarded_idx)
    all_buy_samples = []      # (state_vec, hand, round, offered_card, bought)
    all_hand_snapshots = []   # (state_vec, round, turns_until_meld, did_meld)
    all_draw_samples = []     # v2 only: (state_vec, opponent_raw, offered_card, round)

    games_completed = 0
    start = time.time()

    for game_i in range(args.games):
        # Mixed opponents: cycle through the pool, recreate env when opponent changes
        if mixed:
            next_opponent = MIXED_OPPONENTS[game_i % len(MIXED_OPPONENTS)]
            if next_opponent != current_opponent:
                env.close()
                current_opponent = next_opponent
                env = create_env(current_opponent)

        seed = 50000 + game_i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 3000 * max(1, args.players // 2)

        # Per-round tracking: snapshots taken this round, keyed by round number
        round_snapshots = []  # list of (state_vec, opp_raw_or_none, round_num, snapshot_turn)
        current_round = 1
        round_turn = 0
        meld_turn = None  # turn within this round when player 0 melded

        while not done and step_count < max_steps:
            valid_actions, _ = env.get_valid_actions()
            if not valid_actions:
                break

            # Bridge auto-plays AI opponents after each step — get_valid_actions
            # always returns current_player=0 when opponent_ai is set.
            full_state = env.get_full_state(player=0)
            state_vec = full_state["state"]
            phase = full_state["phase"]
            hand = full_state["hand"]
            has_laid_down = full_state["hasLaidDown"]
            game_round = full_state["round"]

            # V2: extract opponent_raw from bridge response (camelCase -> snake_case)
            opp_raw = full_state.get("opponentRaw") if v2 else None

            # Detect round change — flush snapshots with meld outcome
            if game_round != current_round:
                for snap_state, snap_opp_raw, snap_round, snap_turn in round_snapshots:
                    if meld_turn is not None:
                        turns_to_meld = meld_turn - snap_turn
                        label = max(0.0, 1.0 - turns_to_meld / 50.0)
                    else:
                        label = 0.0  # never melded = worst score
                    sample = {
                        "state": snap_state,
                        "round": snap_round,
                        "label": round(label, 4),
                    }
                    if v2 and snap_opp_raw is not None:
                        sample["opponent_raw"] = snap_opp_raw
                    all_hand_snapshots.append(sample)
                round_snapshots = []
                current_round = game_round
                round_turn = 0
                meld_turn = None

            round_turn += 1
            action = None

            # Snapshot hand state every turn for hand evaluator training
            if phase in ("draw", "action") and not has_laid_down:
                round_snapshots.append((state_vec, opp_raw, game_round, round_turn))

            # V2: Capture draw decisions (take_discard vs draw from deck)
            if v2 and phase == "draw" and "take_discard" in valid_actions:
                offered = full_state.get("discardTop")
                if offered:
                    all_draw_samples.append({
                        "state": state_vec,
                        "opponent_raw": opp_raw,
                        "offered_card": offered,
                        "round": game_round,
                    })

            # Use AI personality for all decisions (realistic game trajectories)
            action = env.get_ai_action()

            # Capture discard decisions
            if phase == "action" and action.startswith("discard:") and len(hand) > 1:
                card_idx = int(action.split(":")[1])
                sample = {
                    "state": state_vec,
                    "hand": hand,
                    "round": game_round,
                    "discarded_idx": card_idx,
                    "hand_size": len(hand),
                }
                if v2 and opp_raw is not None:
                    sample["opponent_raw"] = opp_raw
                all_discard_samples.append(sample)

            # Capture buy decisions
            if phase == "buy-window":
                offered = full_state.get("discardTop")
                if offered:
                    sample = {
                        "state": state_vec,
                        "hand": hand,
                        "round": game_round,
                        "offered_card": offered,
                        "bought": action == "buy",
                    }
                    if v2 and opp_raw is not None:
                        sample["opponent_raw"] = opp_raw
                    all_buy_samples.append(sample)

            # Track meld detection
            _, _, done, info = env.step(action)
            after_state = env.get_full_state(player=0)
            if not has_laid_down and after_state["hasLaidDown"]:
                meld_turn = round_turn

            step_count += 1

        # Flush final round snapshots
        for snap_state, snap_opp_raw, snap_round, snap_turn in round_snapshots:
            if meld_turn is not None:
                turns_to_meld = meld_turn - snap_turn
                label = max(0.0, 1.0 - turns_to_meld / 50.0)
            else:
                label = 0.0
            sample = {
                "state": snap_state,
                "round": snap_round,
                "label": round(label, 4),
            }
            if v2 and snap_opp_raw is not None:
                sample["opponent_raw"] = snap_opp_raw
            all_hand_snapshots.append(sample)

        games_completed += 1
        if games_completed % 10 == 0 or games_completed == args.games:
            elapsed = time.time() - start
            draw_part = f"Draw samples: {len(all_draw_samples):6d} | " if v2 else ""
            print(
                f"  Game {games_completed:5d}/{args.games} | "
                f"Hand samples: {len(all_hand_snapshots):7d} | "
                f"Discard samples: {len(all_discard_samples):7d} | "
                f"Buy samples: {len(all_buy_samples):6d} | "
                f"{draw_part}"
                f"Time: {elapsed:.1f}s"
            )

        # Periodic checkpoint save
        if games_completed % SAVE_INTERVAL == 0 and games_completed < args.games:
            paths = save_data(
                all_hand_snapshots, all_discard_samples, all_buy_samples,
                tag=f"{games_completed}games",
                draw_samples=all_draw_samples if v2 else None,
                data_dir=data_dir,
            )
            print(f"  ** Checkpoint saved ({games_completed} games) -> {paths[0].parent}")

    env.close()

    # Final save (overwrites nothing — unique timestamp)
    paths = save_data(
        all_hand_snapshots, all_discard_samples, all_buy_samples,
        draw_samples=all_draw_samples if v2 else None,
        data_dir=data_dir,
    )
    print(f"\nHand evaluator data: {len(all_hand_snapshots)} samples -> {paths[0]}")
    print(f"Discard policy data: {len(all_discard_samples)} samples -> {paths[1]}")
    print(f"Buy evaluator data:  {len(all_buy_samples)} samples -> {paths[2]}")
    if v2:
        print(f"Draw decision data:  {len(all_draw_samples)} samples -> {paths[3]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate training data for hybrid neural AI")
    parser.add_argument("--games", type=int, default=5000, help="Number of games to play")
    parser.add_argument("--players", type=int, default=4, help="Players per game")
    parser.add_argument("--opponent", type=str, default="the-shark", help="AI personality for all players")
    parser.add_argument("--v2", action="store_true", help="Generate v2 data with opponent raw features")
    parser.add_argument("--mixed-opponents", action="store_true", help="Cycle through shark/nemesis/patient/steady")
    args = parser.parse_args()
    generate_games(args)
