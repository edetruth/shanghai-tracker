"""
Evaluation framework for Shanghai Rummy RL models.

Plays N games with fixed seeds (10000 + i) to produce reproducible, comparable
results across model versions. Player 0 uses the trained model with a greedy
(argmax) policy; other players use the configured opponent AI or random actions.

Usage:
    python evaluate.py --model shanghai_ppo_best.pt --opponent the-shark --games 100 --players 4
    python evaluate.py --model shanghai_ppo_best.pt --games 50
"""

import argparse
import json
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from shanghai_env import ShanghaiEnv
from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX

MODELS_DIR = Path(__file__).parent.parent / "models"
EVAL_DIR = Path(__file__).parent.parent / "data" / "eval"


# ── Action helpers ────────────────────────────────────────────────────────────

def encode_action(action: str) -> int:
    """Convert an action string to a network output index."""
    if action == "draw_pile":
        return 0
    if action == "take_discard":
        return 1
    if action == "meld":
        return 2
    if action.startswith("discard:"):
        return 3 + int(action.split(":")[1])
    if action.startswith("layoff:"):
        parts = action.split(":")
        return 19 + int(parts[1]) * 20 + int(parts[2])
    if action == "buy":
        return BUY_ACTION_IDX
    if action == "decline_buy":
        return DECLINE_BUY_ACTION_IDX
    return 0


def get_action_mask(valid_actions: list) -> torch.Tensor:
    """Create a mask tensor where valid actions are 1, invalid are 0."""
    mask = torch.zeros(MAX_ACTIONS)
    for a in valid_actions:
        mask[encode_action(a)] = 1.0
    return mask


def decode_action(index: int, valid_actions: list) -> str:
    """
    Convert a network output index back to an action string.
    Falls back to the first valid action if the index has no match.
    """
    action_to_idx = {a: encode_action(a) for a in valid_actions}
    idx_to_action = {v: k for k, v in action_to_idx.items()}
    if index in idx_to_action:
        return idx_to_action[index]
    return valid_actions[0] if valid_actions else "draw_pile"


# ── Greedy policy ─────────────────────────────────────────────────────────────

def greedy_action(net: ShanghaiNetV2, state: list, valid_actions: list) -> str:
    """
    Select the highest-probability valid action using argmax (no temperature).
    Invalid actions are masked to -inf before taking the argmax.
    """
    state_tensor = torch.tensor([state], dtype=torch.float32)
    with torch.no_grad():
        policy_logits, _ = net(state_tensor)

    mask = get_action_mask(valid_actions)
    # Set logits of invalid actions to -inf so argmax ignores them
    masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
    action_idx = masked_logits.argmax().item()
    return decode_action(action_idx, valid_actions)


# ── Single-game evaluation ────────────────────────────────────────────────────

def evaluate_game(
    env: ShanghaiEnv,
    net: ShanghaiNetV2,
    seed: int,
    use_ai_opponents: bool,
) -> dict:
    """
    Play one complete game and return result metrics for player 0.

    Returns:
        {
            "my_score":        final cumulative score for player 0,
            "best_opp_score":  lowest (best) score among all opponents,
            "won":             True if player 0's score <= best opponent score,
            "steps":           number of steps taken,
        }
    """
    state = env.reset(seed=seed)
    done = False
    step_count = 0
    max_steps = 3000

    while not done and step_count < max_steps:
        valid_actions, current_player = env.get_valid_actions()
        if not valid_actions:
            break

        if current_player == 0:
            # Trained agent — greedy policy (argmax, no temperature)
            action = greedy_action(net, state, valid_actions)
        else:
            # Opponent — only reached in random mode (AI opponents auto-play in bridge)
            action = random.choice(valid_actions)

        state, _reward, done, info = env.step(action)
        step_count += 1

    # Extract final scores from the last info payload
    scores = info.get("scores") if "info" not in dir() else []
    # Re-query scores after loop (last `info` holds final game state)
    my_score = scores[0] if scores and len(scores) > 0 else 0
    opp_scores = scores[1:] if scores and len(scores) > 1 else []
    best_opp_score = min(opp_scores) if opp_scores else float("inf")

    return {
        "my_score": my_score,
        "best_opp_score": best_opp_score if best_opp_score != float("inf") else None,
        "won": my_score <= best_opp_score if opp_scores else False,
        "steps": step_count,
    }


# ── Main evaluation loop ──────────────────────────────────────────────────────

def evaluate(args):
    model_path = MODELS_DIR / args.model
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    opponent_label = args.opponent if args.opponent else "random"

    print(f"Shanghai Rummy — Model Evaluation")
    print(f"  Model:    {args.model}")
    print(f"  Opponent: {opponent_label}")
    print(f"  Games:    {args.games}")
    print(f"  Players:  {args.players}")
    print()

    # Load model
    net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)
    net.load_state_dict(torch.load(model_path, weights_only=True))
    net.eval()
    print(f"Loaded model from {model_path}")

    # Create environment
    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state=True,
    )

    use_ai_opponents = args.opponent is not None
    results = []
    start_total = time.time()

    for i in range(args.games):
        seed = 10000 + i
        game_start = time.time()

        result = evaluate_game(env, net, seed=seed, use_ai_opponents=use_ai_opponents)
        result["seed"] = seed
        result["game_index"] = i
        results.append(result)

        if (i + 1) % 20 == 0 or (i + 1) == args.games:
            elapsed = time.time() - start_total
            completed = i + 1
            wins_so_far = sum(r["won"] for r in results)
            win_rate = wins_so_far / completed * 100
            avg_score = sum(r["my_score"] for r in results) / completed
            print(
                f"  Game {completed:4d}/{args.games} | "
                f"Win rate: {win_rate:5.1f}% | "
                f"Avg score: {avg_score:7.1f} | "
                f"Elapsed: {elapsed:.1f}s"
            )

    env.close()

    # ── Final report ──────────────────────────────────────────────────────────
    total_games = len(results)
    wins = sum(r["won"] for r in results)
    win_rate = wins / total_games * 100
    avg_my_score = sum(r["my_score"] for r in results) / total_games

    opp_scores_valid = [r["best_opp_score"] for r in results if r["best_opp_score"] is not None]
    avg_opp_score = sum(opp_scores_valid) / len(opp_scores_valid) if opp_scores_valid else float("nan")

    avg_steps = sum(r["steps"] for r in results) / total_games
    total_time = time.time() - start_total

    print()
    print("=" * 55)
    print("Evaluation Results")
    print("=" * 55)
    print(f"  Model:             {args.model}")
    print(f"  Opponent:          {opponent_label}")
    print(f"  Games played:      {total_games}")
    print(f"  Players per game:  {args.players}")
    print(f"  Win rate:          {win_rate:.1f}%  ({wins}/{total_games})")
    print(f"  Avg score (ours):  {avg_my_score:.1f}")
    print(f"  Avg opp score:     {avg_opp_score:.1f}")
    print(f"  Avg steps/game:    {avg_steps:.0f}")
    print(f"  Total time:        {total_time:.1f}s  ({total_time/total_games:.2f}s/game)")
    print("=" * 55)

    # ── Save JSON results ─────────────────────────────────────────────────────
    EVAL_DIR.mkdir(parents=True, exist_ok=True)

    # Derive a clean stem for the filename (strip .pt extension)
    model_stem = Path(args.model).stem
    out_path = EVAL_DIR / f"eval_{model_stem}_vs_{opponent_label}.json"

    output = {
        "model": args.model,
        "opponent": opponent_label,
        "games": total_games,
        "players": args.players,
        "win_rate": round(win_rate, 4),
        "wins": wins,
        "avg_my_score": round(avg_my_score, 4),
        "avg_opp_score": round(avg_opp_score, 4) if opp_scores_valid else None,
        "avg_steps": round(avg_steps, 1),
        "total_time_s": round(total_time, 2),
        "per_game": results,
    }

    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nResults saved to {out_path}")

    return output


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Evaluate a trained Shanghai Rummy RL model against a fixed opponent."
    )
    parser.add_argument(
        "--model",
        type=str,
        default="shanghai_ppo_best.pt",
        help="Model filename inside ml/models/ (default: shanghai_ppo_best.pt)",
    )
    parser.add_argument(
        "--opponent",
        type=str,
        default=None,
        help="AI personality for opponents (e.g. the-shark, the-nemesis). Omit for random.",
    )
    parser.add_argument(
        "--games",
        type=int,
        default=100,
        help="Number of evaluation games (default: 100)",
    )
    parser.add_argument(
        "--players",
        type=int,
        default=4,
        help="Total players per game including the agent (default: 4)",
    )
    args = parser.parse_args()
    evaluate(args)
