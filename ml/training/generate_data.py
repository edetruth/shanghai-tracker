"""
Generate training data for hybrid neural AI.

Plays N games through the bridge with AI opponents, capturing every
decision point with full state vectors and outcome labels.

Usage:
    python generate_data.py --games 5000 --players 4 --opponent the-shark
    python generate_data.py --games 5000 --players 4 --v2 --mixed-opponents
    python generate_data.py --games 5000 --v3  # round sequences for LSTM
"""

import argparse
import json
import time
from pathlib import Path

from shanghai_env import ShanghaiEnv
from log_utils import setup_logging

DATA_DIR_V1 = Path(__file__).parent.parent / "data" / "hybrid_training"
DATA_DIR_V2 = Path(__file__).parent.parent / "data" / "hybrid_training_v2"
DATA_DIR_V3 = Path(__file__).parent.parent / "data" / "sequence_training"

MIXED_OPPONENTS = ["the-shark", "the-nemesis", "patient-pat", "steady-sam"]

SAVE_INTERVAL = 500  # save checkpoint every N games


def encode_prev_action(action_type, card):
    """Encode previous action as 10-dim vector: action type one-hot(5) + card features(5)."""
    ACTION_TYPES = ["draw_pile", "take_discard", "discard", "buy", "pass"]
    vec = [0.0] * 10
    if action_type in ACTION_TYPES:
        vec[ACTION_TYPES.index(action_type)] = 1.0
    if card and isinstance(card, dict):
        rank = card.get("rank", 0)
        vec[5] = rank / 13.0
        suit = card.get("suit", "")
        suit_map = {"hearts": 0, "diamonds": 1, "clubs": 2, "spades": 3}
        if suit in suit_map:
            vec[6 + suit_map[suit]] = 1.0
    return vec


def parse_action(action_str, full_state):
    """Parse bridge action string into (action_type, action_detail) tuple."""
    if action_str == "draw_pile":
        return ("draw_pile", {})
    if action_str == "take_discard":
        top = full_state.get("discardTop")
        return ("take_discard", {"card_rank": top["rank"], "card_suit": top["suit"]} if top else {})
    if action_str.startswith("discard:"):
        card_idx = int(action_str.split(":")[1])
        hand = full_state.get("hand", [])
        if card_idx < len(hand):
            c = hand[card_idx]
            return ("discard", {"card_rank": c["rank"], "card_suit": c["suit"], "card_idx": card_idx})
        return ("discard", {"card_idx": card_idx})
    if action_str == "buy":
        return ("buy", {})
    if action_str == "pass":
        return ("pass", {})
    return (action_str, {})


def get_action_card(action_type, action_detail, full_state):
    """Extract the card dict associated with an action for encoding."""
    if action_type == "take_discard":
        return full_state.get("discardTop")
    if action_type == "discard" and "card_rank" in action_detail:
        return {"rank": action_detail["card_rank"], "suit": action_detail["card_suit"]}
    if action_type == "buy":
        return full_state.get("discardTop")
    return None


def save_sequences(sequences, path):
    """Save round sequences to JSON with count header."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"count": len(sequences), "sequences": sequences}, f)
    return path


def generate_v3_data(args):
    """V3 mode: collect ordered round sequences for LSTM training."""
    setup_logging("generate_data_v3")
    data_dir = DATA_DIR_V3
    data_dir.mkdir(parents=True, exist_ok=True)

    print("Generating V3 sequence training data")
    print(f"  Games:    {args.games}")
    print(f"  Players:  4 (fixed for v3)")
    print(f"  Opponents: cycling {MIXED_OPPONENTS}")
    print(f"  Data dir: {data_dir}")
    print()

    current_opponent = MIXED_OPPONENTS[0]
    env = ShanghaiEnv(player_count=4, opponent_ai=current_opponent, rich_state_v3=True)

    all_sequences = []
    games_completed = 0
    start = time.time()

    for game_i in range(args.games):
        next_opponent = MIXED_OPPONENTS[game_i % len(MIXED_OPPONENTS)]
        if next_opponent != current_opponent:
            env.close()
            current_opponent = next_opponent
            env = ShanghaiEnv(player_count=4, opponent_ai=current_opponent, rich_state_v3=True)

        seed = 50000 + game_i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 6000

        current_round = 1
        current_round_turns = []
        turn_step = 0
        prev_action_type = None
        prev_action_card = None
        prev_cumulative_score = 0
        info = None

        while not done and step_count < max_steps:
            valid_actions, current_player = env.get_valid_actions()
            if not valid_actions:
                break

            full_state = env.get_full_state(player=0)
            phase = full_state["phase"]
            game_round = full_state["round"]

            # Detect round change: save previous round sequence
            if game_round != current_round:
                # Round score = difference in cumulative scores across round boundary
                cumulative_scores = full_state.get("scores", [0, 0, 0, 0])
                p0_cumulative = cumulative_scores[0] if len(cumulative_scores) > 0 else 0
                round_score = p0_cumulative - prev_cumulative_score
                went_out = round_score == 0

                if current_round_turns:
                    all_sequences.append({
                        "game_seed": seed,
                        "round_number": current_round,
                        "round_score": round_score,
                        "went_out": went_out,
                        "player_name": current_opponent,
                        "turns": current_round_turns,
                    })

                prev_cumulative_score = p0_cumulative
                current_round = game_round
                current_round_turns = []
                turn_step = 0
                prev_action_type = None
                prev_action_card = None

            # Only record decision points for player 0 in relevant phases
            if phase in ("draw", "action", "buy-window"):
                state_vec = full_state["state"]
                opp_raw = full_state.get("opponentRaw", [])
                meld_plan = full_state.get("meld_plan", [0.0] * 30)
                opp_actions = full_state.get("opponent_actions", [0.0] * 18)
                hand = full_state.get("hand", [])

                action_str = env.get_ai_action()
                action_type, action_detail = parse_action(action_str, full_state)
                action_card = get_action_card(action_type, action_detail, full_state)

                prev_action_vec = encode_prev_action(prev_action_type, prev_action_card)

                turn_record = {
                    "step": turn_step,
                    "state": state_vec,
                    "opponent_raw": opp_raw,
                    "meld_plan": meld_plan,
                    "opponent_actions": opp_actions,
                    "action_taken": prev_action_vec,
                    "phase": phase,
                    "action_type": action_type,
                    "action_detail": action_detail,
                    "valid_actions": valid_actions,
                    "hand": [{"rank": c["rank"], "suit": c["suit"]} for c in hand],
                }
                current_round_turns.append(turn_record)
                turn_step += 1

                _, _, done, info = env.step(action_str)
                prev_action_type = action_type
                prev_action_card = action_card
            else:
                # Non-decision phase, just step through
                action_str = env.get_ai_action()
                _, _, done, info = env.step(action_str)

            step_count += 1

        # Flush final round sequence
        if current_round_turns:
            if done and info and info.get("scores"):
                cumulative_scores = info["scores"]
                p0_cumulative = cumulative_scores[0] if len(cumulative_scores) > 0 else 0
            else:
                try:
                    fs = env.get_full_state(player=0)
                    cumulative_scores = fs.get("scores", [0, 0, 0, 0])
                    p0_cumulative = cumulative_scores[0] if len(cumulative_scores) > 0 else 0
                except Exception:
                    p0_cumulative = prev_cumulative_score
            round_score = p0_cumulative - prev_cumulative_score
            went_out = round_score == 0

            all_sequences.append({
                "game_seed": seed,
                "round_number": current_round,
                "round_score": round_score,
                "went_out": went_out,
                "player_name": current_opponent,
                "turns": current_round_turns,
            })

        games_completed += 1
        if games_completed % 10 == 0 or games_completed == args.games:
            elapsed = time.time() - start
            print(f"  Game {games_completed:5d}/{args.games} | Sequences: {len(all_sequences):7d} | Time: {elapsed:.1f}s")

        # Periodic checkpoint
        if games_completed % SAVE_INTERVAL == 0 and games_completed < args.games:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            cp_path = data_dir / f"sequences_{timestamp}_{games_completed}games.json"
            save_sequences(all_sequences, cp_path)
            print(f"  ** Checkpoint saved ({games_completed} games) -> {cp_path}")

    env.close()

    # Final save
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    final_path = data_dir / f"sequences_{timestamp}_{games_completed}games.json"
    save_sequences(all_sequences, final_path)
    print(f"\nV3 sequence data: {len(all_sequences)} sequences -> {final_path}")
    avg_turns = sum(len(s["turns"]) for s in all_sequences) / max(1, len(all_sequences))
    print(f"Average turns per sequence: {avg_turns:.1f}")


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
    parser.add_argument("--v3", action="store_true", help="V3 mode: collect round sequences for LSTM training")
    parser.add_argument("--mixed-opponents", action="store_true", help="Cycle through shark/nemesis/patient/steady")
    args = parser.parse_args()
    if args.v3:
        generate_v3_data(args)
    else:
        generate_games(args)
