"""
Diagnostic suite for Shanghai PPO training.

Runs multiple analyses to identify why the agent isn't learning:
  1. Action distribution — what actions does the model actually pick?
  2. Random baseline — what score does pure random play achieve?
  3. Game flow analysis — step counts per round, game completion rate
  4. Reward component breakdown — which reward signals dominate?
  5. Value function sanity — are value estimates meaningful?

Usage:
    python diagnose.py                          # all diagnostics, default model
    python diagnose.py --model shanghai_ppo.pt  # specific checkpoint
    python diagnose.py --test random-baseline   # single diagnostic
    python diagnose.py --games 200              # more games for tighter stats
"""

import argparse
import json
import random
import time
from collections import Counter, defaultdict
from pathlib import Path

import torch
import torch.nn.functional as F

from shanghai_env import ShanghaiEnv
from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX

MODELS_DIR = Path(__file__).parent.parent / "models"

# Action names for readability
ACTION_NAMES = {
    0: "draw_pile",
    1: "take_discard",
    **{i: f"discard:{i-2}" for i in range(2, 24)},
    24: "buy",
    25: "decline_buy",
}


def encode_action(action: str) -> int:
    if action == "draw_pile": return 0
    if action == "take_discard": return 1
    if action.startswith("discard:"):
        idx = int(action.split(":")[1])
        return 2 + min(idx, 21)
    if action == "buy": return BUY_ACTION_IDX
    if action == "decline_buy": return DECLINE_BUY_ACTION_IDX
    return 0


def decode_action(index: int, valid_actions: list) -> str:
    action_to_idx = {a: encode_action(a) for a in valid_actions}
    idx_to_action = {v: k for k, v in action_to_idx.items()}
    return idx_to_action.get(index, valid_actions[0] if valid_actions else "draw_pile")


def get_action_mask(valid_actions: list) -> torch.Tensor:
    mask = torch.zeros(MAX_ACTIONS)
    for a in valid_actions:
        idx = encode_action(a)
        if 0 <= idx < MAX_ACTIONS:
            mask[idx] = 1.0
    return mask


# ═══════════════════════════════════════════════════════════════════════════════
# Diagnostic 1: Action Distribution
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_action_distribution(net, games=100, players=2):
    """Track what actions the trained model actually selects."""
    print("\n" + "=" * 70)
    print("DIAGNOSTIC 1: Action Distribution (model choices)")
    print("=" * 70)

    env = ShanghaiEnv(player_count=players, rich_state=True)
    action_counts = Counter()
    action_by_phase = defaultdict(Counter)  # phase -> action -> count
    valid_action_sets = Counter()  # track what choices are actually available
    total_decisions = 0
    games_completed = 0
    games_timed_out = 0

    for i in range(games):
        state = env.reset(seed=20000 + i)
        done = False
        steps = 0
        max_steps = 4000 * max(1, players // 2)

        while not done and steps < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break

            if auto_state is not None:
                state = auto_state

            if current_player == 0:
                # Model picks action (greedy)
                state_tensor = torch.tensor([state], dtype=torch.float32)
                with torch.no_grad():
                    policy_logits, _ = net(state_tensor)
                mask = get_action_mask(valid_actions)
                masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
                action_idx = masked_logits.argmax().item()
                action_str = decode_action(action_idx, valid_actions)

                # Record
                action_type = action_str.split(":")[0] if ":" in action_str else action_str
                action_counts[action_str] += 1
                total_decisions += 1

                # Track which actions were available
                available = frozenset(a.split(":")[0] if ":" in a else a for a in valid_actions)
                valid_action_sets[str(sorted(available))] += 1

                state, _, done, info = env.step(action_str)
            else:
                action_str = random.choice(valid_actions)
                state, _, done, info = env.step(action_str)

            steps += 1

        if done:
            games_completed += 1
        else:
            games_timed_out += 1

    env.close()

    print(f"\n  Games: {games} ({games_completed} completed, {games_timed_out} timed out)")
    print(f"  Total agent decisions: {total_decisions}")
    print(f"  Avg decisions/game: {total_decisions / games:.1f}")

    # Group discards together
    draw_count = action_counts.get("draw_pile", 0)
    take_count = action_counts.get("take_discard", 0)
    buy_count = action_counts.get("buy", 0)
    decline_count = action_counts.get("decline_buy", 0)
    discard_count = sum(v for k, v in action_counts.items() if k.startswith("discard:"))

    print(f"\n  Action breakdown:")
    print(f"    draw_pile:    {draw_count:6d} ({draw_count/max(total_decisions,1)*100:5.1f}%)")
    print(f"    take_discard: {take_count:6d} ({take_count/max(total_decisions,1)*100:5.1f}%)")
    print(f"    discard:      {discard_count:6d} ({discard_count/max(total_decisions,1)*100:5.1f}%)")
    print(f"    buy:          {buy_count:6d} ({buy_count/max(total_decisions,1)*100:5.1f}%)")
    print(f"    decline_buy:  {decline_count:6d} ({decline_count/max(total_decisions,1)*100:5.1f}%)")

    # Discard slot distribution (are they always discarding slot 0?)
    if discard_count > 0:
        print(f"\n  Discard slot distribution (top 10):")
        discard_slots = {k: v for k, v in action_counts.items() if k.startswith("discard:")}
        for slot, count in sorted(discard_slots.items(), key=lambda x: -x[1])[:10]:
            print(f"    {slot}: {count:5d} ({count/discard_count*100:5.1f}%)")

    # Draw/take ratio (should be taking discards sometimes)
    if draw_count + take_count > 0:
        take_pct = take_count / (draw_count + take_count) * 100
        print(f"\n  Take-discard rate (of draw decisions): {take_pct:.1f}%")
        print(f"  (Good AI takes ~20-40% discards; random = ~50%)")

    # Buy rate
    if buy_count + decline_count > 0:
        buy_pct = buy_count / (buy_count + decline_count) * 100
        print(f"\n  Buy rate (of buy windows): {buy_pct:.1f}%")

    # Most common valid action sets
    print(f"\n  Most common action set types (top 5):")
    for action_set, count in valid_action_sets.most_common(5):
        print(f"    {action_set}: {count}")

    return action_counts


# ═══════════════════════════════════════════════════════════════════════════════
# Diagnostic 2: Random Baseline
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_random_baseline(games=200, players=2):
    """Establish what score a purely random player achieves."""
    print("\n" + "=" * 70)
    print("DIAGNOSTIC 2: Random Baseline (no model, pure random)")
    print("=" * 70)

    env = ShanghaiEnv(player_count=players, rich_state=True)
    scores = []
    wins = 0
    timeouts = 0
    steps_list = []

    for i in range(games):
        state = env.reset(seed=30000 + i)
        done = False
        steps = 0
        max_steps = 4000 * max(1, players // 2)
        info = {}

        while not done and steps < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break
            if auto_state is not None:
                state = auto_state

            # ALL players play randomly
            action_str = random.choice(valid_actions)
            state, _, done, info = env.step(action_str)
            steps += 1

        if not done:
            timeouts += 1

        game_scores = info.get("scores", [])
        if game_scores and len(game_scores) >= players:
            my_score = game_scores[0]
            best_opp = min(game_scores[1:])
            scores.append(my_score)
            steps_list.append(steps)
            if my_score <= best_opp:
                wins += 1

        if (i + 1) % 50 == 0:
            avg = sum(scores) / len(scores) if scores else 0
            wr = wins / (i + 1) * 100
            print(f"  Game {i+1:4d}/{games} | Avg score: {avg:.1f} | Win rate: {wr:.1f}%")

    env.close()

    avg_score = sum(scores) / len(scores) if scores else 0
    win_rate = wins / games * 100
    avg_steps = sum(steps_list) / len(steps_list) if steps_list else 0

    print(f"\n  Random baseline ({players}P):")
    print(f"    Games:        {games} ({timeouts} timed out)")
    print(f"    Avg score:    {avg_score:.1f}")
    print(f"    Win rate:     {win_rate:.1f}% (expected ~{100/players:.0f}% for {players}P)")
    print(f"    Avg steps:    {avg_steps:.0f}")

    if scores:
        scores.sort()
        print(f"    Score range:  {min(scores)} - {max(scores)}")
        print(f"    Median score: {scores[len(scores)//2]}")
        print(f"    P25/P75:      {scores[len(scores)//4]} / {scores[3*len(scores)//4]}")

    return {"avg_score": avg_score, "win_rate": win_rate, "avg_steps": avg_steps}


# ═══════════════════════════════════════════════════════════════════════════════
# Diagnostic 3: Game Flow Analysis
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_game_flow(net, games=50, players=2):
    """Track round-by-round progression — does the game actually advance?"""
    print("\n" + "=" * 70)
    print("DIAGNOSTIC 3: Game Flow Analysis (round progression, step counts)")
    print("=" * 70)

    env = ShanghaiEnv(player_count=players, rich_state=True)
    round_steps = defaultdict(list)  # round_num -> [steps_in_this_round]
    round_scores = defaultdict(list)  # round_num -> [p0 round score]
    games_reaching_round = Counter()
    total_melds = 0
    went_out_count = 0
    final_scores = []
    final_rounds = []

    for i in range(games):
        state = env.reset(seed=40000 + i)
        done = False
        steps = 0
        max_steps = 4000 * max(1, players // 2)
        current_round = 0
        round_step_count = 0
        prev_score = 0
        info = {}

        while not done and steps < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break
            if auto_state is not None:
                state = auto_state

            if current_player == 0:
                state_tensor = torch.tensor([state], dtype=torch.float32)
                with torch.no_grad():
                    policy_logits, _ = net(state_tensor)
                mask = get_action_mask(valid_actions)
                masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
                action_idx = masked_logits.argmax().item()
                action_str = decode_action(action_idx, valid_actions)
                state, _, done, info = env.step(action_str)
            else:
                action_str = random.choice(valid_actions)
                state, _, done, info = env.step(action_str)

            steps += 1
            round_step_count += 1

            # Track round transitions
            new_round = info.get("round", current_round)
            if new_round != current_round and new_round is not None:
                round_steps[current_round].append(round_step_count)
                games_reaching_round[current_round] += 1

                # Track round score
                if info.get("scores"):
                    new_score = float(info["scores"][0])
                    round_score = new_score - prev_score
                    round_scores[current_round].append(round_score)
                    if round_score == 0:
                        went_out_count += 1
                    prev_score = new_score

                current_round = new_round
                round_step_count = 0

        # Final round
        if round_step_count > 0:
            round_steps[current_round].append(round_step_count)
            games_reaching_round[current_round] += 1

        final_rounds.append(current_round)
        if info.get("scores"):
            final_scores.append(float(info["scores"][0]))

    env.close()

    print(f"\n  Games: {games}")
    print(f"  Went out (score 0 in a round): {went_out_count} times")

    print(f"\n  Round-by-round breakdown:")
    print(f"  {'Round':>5} | {'Games':>5} | {'Avg Steps':>9} | {'Avg Score':>9} | {'Score=0':>7}")
    print(f"  {'-'*5}-+-{'-'*5}-+-{'-'*9}-+-{'-'*9}-+-{'-'*7}")
    for r in sorted(round_steps.keys()):
        avg_s = sum(round_steps[r]) / len(round_steps[r])
        sc = round_scores.get(r, [])
        avg_sc = sum(sc) / len(sc) if sc else float('nan')
        zeros = sum(1 for s in sc if s == 0)
        print(f"  {r:5d} | {games_reaching_round[r]:5d} | {avg_s:9.1f} | {avg_sc:9.1f} | {zeros:7d}")

    # Distribution of final rounds reached
    print(f"\n  Final round reached distribution:")
    for r in sorted(set(final_rounds)):
        count = final_rounds.count(r)
        print(f"    Round {r}: {count} games ({count/games*100:.1f}%)")

    if final_scores:
        print(f"\n  Final score stats:")
        print(f"    Mean:   {sum(final_scores)/len(final_scores):.1f}")
        print(f"    Min:    {min(final_scores):.0f}")
        print(f"    Max:    {max(final_scores):.0f}")

    return round_steps


# ═══════════════════════════════════════════════════════════════════════════════
# Diagnostic 4: Reward Component Breakdown
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_rewards(net, games=50, players=2):
    """Break down each reward component to see what dominates."""
    print("\n" + "=" * 70)
    print("DIAGNOSTIC 4: Reward Component Breakdown")
    print("=" * 70)

    env = ShanghaiEnv(player_count=players, rich_state=True)

    # Accumulators per component
    time_penalties = []
    hand_improvements = []
    discard_qualities = []
    score_changes = []
    stall_penalties = []
    win_bonuses = []
    score_spreads = []
    timeout_penalties = []
    total_rewards = []

    for i in range(games):
        state = env.reset(seed=50000 + i)
        done = False
        steps = 0
        max_steps = 4000 * max(1, players // 2)
        prev_score = 0.0

        game_time = 0.0
        game_hand = 0.0
        game_discard = 0.0
        game_score_change = 0.0
        game_stall = 0.0
        game_win = 0.0
        game_spread = 0.0
        game_timeout = 0.0

        while not done and steps < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break
            if auto_state is not None:
                state = auto_state

            if current_player == 0:
                hand_eval_before = env.evaluate_hand(0)

                state_tensor = torch.tensor([state], dtype=torch.float32)
                with torch.no_grad():
                    policy_logits, _ = net(state_tensor)
                mask = get_action_mask(valid_actions)
                masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
                action_idx = masked_logits.argmax().item()
                action_str = decode_action(action_idx, valid_actions)

                state, _, done, info = env.step(action_str)

                hand_eval_after = env.evaluate_hand(0) if not done else 0.0

                # Mirror exact reward logic from ppo.py
                time_r = -0.002 / max(1, players // 2)
                game_time += time_r

                hand_r = 0.0
                if action_str in ("draw_pile", "take_discard", "buy"):
                    hand_r = (hand_eval_after - hand_eval_before) / 200.0
                game_hand += hand_r

                discard_r = 0.0
                if action_str.startswith("discard:"):
                    discard_r = (hand_eval_after / 200.0) - 0.5
                game_discard += discard_r

                score_r = 0.0
                if info.get("scores"):
                    current_score = float(info["scores"][0])
                    delta = current_score - prev_score
                    if delta != 0:
                        score_r = -delta / 100.0
                        prev_score = current_score
                game_score_change += score_r

                stall_r = 0.0
                if info.get("phase") == "action" and hand_eval_after < 20:
                    stall_r = -0.005
                game_stall += stall_r

                if done and info.get("scores"):
                    scores = [float(s) for s in info["scores"]]
                    if scores[0] == min(scores):
                        game_win += 5.0
                    game_spread += -(scores[0] - min(scores)) / 200.0

            else:
                action_str = random.choice(valid_actions)
                state, _, done, info = env.step(action_str)
                # Attribute opponent-turn score changes to game_score_change
                # (matches ppo.py attribution to agent's last step)
                if info.get("scores"):
                    current_score = float(info["scores"][0])
                    delta = current_score - prev_score
                    if delta != 0:
                        game_score_change += -delta / 100.0
                        prev_score = current_score

            steps += 1

        if not done:
            game_timeout += -5.0

        time_penalties.append(game_time)
        hand_improvements.append(game_hand)
        discard_qualities.append(game_discard)
        score_changes.append(game_score_change)
        stall_penalties.append(game_stall)
        win_bonuses.append(game_win)
        score_spreads.append(game_spread)
        timeout_penalties.append(game_timeout)
        total = game_time + game_hand + game_discard + game_score_change + game_stall + game_win + game_spread + game_timeout
        total_rewards.append(total)

    env.close()

    def stats(label, values):
        avg = sum(values) / len(values) if values else 0
        mn = min(values) if values else 0
        mx = max(values) if values else 0
        nonzero = sum(1 for v in values if v != 0)
        print(f"  {label:25s} | avg: {avg:8.3f} | min: {mn:8.3f} | max: {mx:8.3f} | nonzero: {nonzero}/{len(values)}")

    print(f"\n  Per-game reward component breakdown ({games} games):\n")
    print(f"  {'Component':25s} | {'Avg':>12s} | {'Min':>12s} | {'Max':>12s} | {'NonZero':>12s}")
    print(f"  {'-'*25}-+-{'-'*12}-+-{'-'*12}-+-{'-'*12}-+-{'-'*12}")
    stats("Time penalty", time_penalties)
    stats("Hand improvement", hand_improvements)
    stats("Discard quality", discard_qualities)
    stats("Score change", score_changes)
    stats("Stall penalty", stall_penalties)
    stats("Win bonus (+5)", win_bonuses)
    stats("Score spread", score_spreads)
    stats("Timeout penalty (-5)", timeout_penalties)
    stats("TOTAL REWARD", total_rewards)

    # Magnitude comparison
    print(f"\n  Relative magnitude (absolute avg):")
    components = [
        ("Time penalty", time_penalties),
        ("Hand improvement", hand_improvements),
        ("Discard quality", discard_qualities),
        ("Score change", score_changes),
        ("Stall penalty", stall_penalties),
        ("Win bonus", win_bonuses),
        ("Score spread", score_spreads),
        ("Timeout penalty", timeout_penalties),
    ]
    total_abs = sum(abs(sum(v)/len(v)) for _, v in components)
    if total_abs > 0:
        for label, values in sorted(components, key=lambda x: -abs(sum(x[1])/len(x[1]))):
            abs_avg = abs(sum(values) / len(values))
            pct = abs_avg / total_abs * 100
            bar = "#" * int(pct / 2)
            print(f"    {label:25s} {pct:5.1f}% {bar}")


# ═══════════════════════════════════════════════════════════════════════════════
# Diagnostic 5: Value Function Sanity
# ═══════════════════════════════════════════════════════════════════════════════

def diagnose_value_function(net, games=50, players=2):
    """Check if the value function distinguishes good from bad states."""
    print("\n" + "=" * 70)
    print("DIAGNOSTIC 5: Value Function Sanity Check")
    print("=" * 70)

    env = ShanghaiEnv(player_count=players, rich_state=True)
    values_by_round = defaultdict(list)
    values_at_start = []
    values_at_end = []
    all_values = []
    value_vs_outcome = []  # (initial_value, final_score)

    for i in range(games):
        state = env.reset(seed=60000 + i)
        done = False
        steps = 0
        max_steps = 4000 * max(1, players // 2)
        game_values = []
        info = {}

        while not done and steps < max_steps:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break
            if auto_state is not None:
                state = auto_state

            if current_player == 0:
                state_tensor = torch.tensor([state], dtype=torch.float32)
                with torch.no_grad():
                    _, value = net(state_tensor)
                v = value.item()
                game_values.append(v)
                all_values.append(v)
                current_round = info.get("round", 0)
                values_by_round[current_round].append(v)

                mask = get_action_mask(valid_actions)
                masked_logits = torch.zeros(MAX_ACTIONS)  # dummy for action selection
                with torch.no_grad():
                    policy_logits, _ = net(state_tensor)
                masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
                action_idx = masked_logits.argmax().item()
                action_str = decode_action(action_idx, valid_actions)
                state, _, done, info = env.step(action_str)
            else:
                action_str = random.choice(valid_actions)
                state, _, done, info = env.step(action_str)

            steps += 1

        if game_values:
            values_at_start.append(game_values[0])
            values_at_end.append(game_values[-1])
            if info.get("scores"):
                value_vs_outcome.append((game_values[0], float(info["scores"][0])))

    env.close()

    if not all_values:
        print("  No values collected!")
        return

    print(f"\n  Value estimate statistics ({len(all_values)} samples from {games} games):")
    print(f"    Mean:     {sum(all_values)/len(all_values):.4f}")
    print(f"    Min:      {min(all_values):.4f}")
    print(f"    Max:      {max(all_values):.4f}")
    print(f"    Std:      {(sum((v - sum(all_values)/len(all_values))**2 for v in all_values)/len(all_values))**0.5:.4f}")

    if values_at_start and values_at_end:
        print(f"\n    Start-of-game avg: {sum(values_at_start)/len(values_at_start):.4f}")
        print(f"    End-of-game avg:   {sum(values_at_end)/len(values_at_end):.4f}")

    print(f"\n  Value by round:")
    for r in sorted(values_by_round.keys()):
        vals = values_by_round[r]
        if vals:
            avg = sum(vals) / len(vals)
            print(f"    Round {r}: avg={avg:.4f}, n={len(vals)}")

    # Correlation check: do higher initial values predict lower scores?
    if len(value_vs_outcome) > 10:
        vals = [v for v, s in value_vs_outcome]
        scrs = [s for v, s in value_vs_outcome]
        mean_v = sum(vals) / len(vals)
        mean_s = sum(scrs) / len(scrs)
        cov = sum((v - mean_v) * (s - mean_s) for v, s in zip(vals, scrs)) / len(vals)
        std_v = (sum((v - mean_v) ** 2 for v in vals) / len(vals)) ** 0.5
        std_s = (sum((s - mean_s) ** 2 for s in scrs) / len(scrs)) ** 0.5
        corr = cov / (std_v * std_s) if std_v > 0 and std_s > 0 else 0
        print(f"\n  Value-outcome correlation: {corr:.3f}")
        print(f"    (Should be negative: higher value = lower score = better)")
        print(f"    (0.0 = value function is random noise, <-0.3 = meaningful)")


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main(args):
    from log_utils import setup_logging
    setup_logging("diagnose")

    print("Shanghai PPO — Diagnostic Suite")
    print(f"  Model: {args.model}")
    print(f"  Games per test: {args.games}")
    print(f"  Players: {args.players}")
    start = time.time()

    # Load model
    net = None
    model_path = MODELS_DIR / args.model
    if model_path.exists():
        net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)
        net.load_state_dict(torch.load(model_path, weights_only=True))
        net.eval()
        print(f"  Loaded model from {model_path}")
    else:
        print(f"  WARNING: Model not found at {model_path}")
        if args.test and args.test != "random-baseline":
            print("  Cannot run model-dependent diagnostics without a model.")
            return

    tests = args.test.split(",") if args.test else ["all"]

    if "all" in tests or "action-dist" in tests:
        if net:
            diagnose_action_distribution(net, games=args.games, players=args.players)

    if "all" in tests or "random-baseline" in tests:
        diagnose_random_baseline(games=args.games, players=args.players)

    if "all" in tests or "game-flow" in tests:
        if net:
            diagnose_game_flow(net, games=args.games, players=args.players)

    if "all" in tests or "rewards" in tests:
        if net:
            diagnose_rewards(net, games=args.games, players=args.players)

    if "all" in tests or "value-fn" in tests:
        if net:
            diagnose_value_function(net, games=args.games, players=args.players)

    elapsed = time.time() - start
    print(f"\n{'=' * 70}")
    print(f"Diagnostics complete in {elapsed:.1f}s")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Diagnostic suite for Shanghai PPO training")
    parser.add_argument("--model", type=str, default="shanghai_ppo.pt", help="Model file in ml/models/")
    parser.add_argument("--games", type=int, default=100, help="Games per diagnostic (default: 100)")
    parser.add_argument("--players", type=int, default=2, help="Players per game (default: 2)")
    parser.add_argument("--test", type=str, default=None, help="Run specific test(s): action-dist,random-baseline,game-flow,rewards,value-fn (comma-separated, or 'all')")
    args = parser.parse_args()
    main(args)
