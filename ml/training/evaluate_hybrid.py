"""
Evaluate the hybrid neural AI — three networks combined into one player.

Rules handle: melding, layoffs, joker swaps, turn structure.
Neural nets handle: discard choice, buy decisions.
Hand evaluator provides input to both.

Usage:
    python evaluate_hybrid.py --opponent the-shark --games 100 --players 4
"""

import argparse
import json
import random
import time
from pathlib import Path

import torch

from shanghai_env import ShanghaiEnv
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX
from hand_evaluator import HandEvalNet
from discard_policy import DiscardPolicyNet, MAX_HAND
from buy_evaluator import BuyEvalNet, encode_offered_card

MODELS_DIR = Path(__file__).parent.parent / "models"
EVAL_DIR = Path(__file__).parent.parent / "data" / "eval"


def hybrid_action(
    state_vec: list,
    valid_actions: list,
    phase: str,
    hand_eval: HandEvalNet,
    discard_net: DiscardPolicyNet,
    buy_net: BuyEvalNet,
    full_state: dict,
) -> str:
    """Choose an action using the hybrid strategy."""
    state = torch.tensor(state_vec, dtype=torch.float32)

    # Buy window: use buy evaluator
    if phase == "buy-window":
        if "buy" not in valid_actions and "decline_buy" not in valid_actions:
            return valid_actions[0] if valid_actions else "decline_buy"

        offered = full_state.get("discardTop")
        if offered:
            with torch.no_grad():
                hand_score = hand_eval(state.unsqueeze(0)).item()
            card_features = torch.tensor(encode_offered_card(offered), dtype=torch.float32)
            buy_input = torch.cat([state, torch.tensor([hand_score]), card_features]).unsqueeze(0)
            with torch.no_grad():
                buy_prob = buy_net(buy_input).item()
            return "buy" if buy_prob > 0.5 and "buy" in valid_actions else "decline_buy"
        return "decline_buy" if "decline_buy" in valid_actions else valid_actions[0]

    # Draw phase: take discard if it improves hand eval, otherwise draw pile
    if phase == "draw":
        if "take_discard" in valid_actions and full_state.get("discardTop"):
            offered = full_state["discardTop"]
            # Quick check: does this card help?
            with torch.no_grad():
                current_score = hand_eval(state.unsqueeze(0)).item()
            # Approximate improvement by encoding card into empty slot
            modified = state.clone()
            card_features = encode_offered_card(offered)
            for si in range(22):
                start = si * 6
                if modified[start:start + 6].sum().item() == 0:
                    modified[start:start + 6] = torch.tensor(card_features)
                    break
            with torch.no_grad():
                new_score = hand_eval(modified.unsqueeze(0)).item()
            if new_score - current_score > 0.05:
                return "take_discard"
        return "draw_pile" if "draw_pile" in valid_actions else valid_actions[0]

    # Action phase: meld if possible (rule-based), then choose discard (neural)
    if phase == "action":
        # Always meld if we can (rule-based decision, always correct)
        if "meld" in valid_actions:
            return "meld"

        # Layoff if possible (rule-based, always good to reduce hand)
        layoff_actions = [a for a in valid_actions if a.startswith("layoff:")]
        if layoff_actions:
            return layoff_actions[0]

        # Discard: use neural network
        discard_actions = [a for a in valid_actions if a.startswith("discard:")]
        if discard_actions:
            with torch.no_grad():
                hand_score = hand_eval(state.unsqueeze(0)).item()
            features = torch.cat([state, torch.tensor([hand_score])]).unsqueeze(0)
            with torch.no_grad():
                logits = discard_net(features)[0]
            # Mask invalid slots
            hand_size = full_state.get("handSize", 10)
            mask = torch.zeros(MAX_HAND)
            mask[:hand_size] = 1.0
            logits = logits + (mask - 1.0) * 1e9
            best_idx = logits.argmax().item()
            target = f"discard:{best_idx}"
            if target in discard_actions:
                return target
            # Fallback: pick the discard action closest to our choice
            return discard_actions[0]

    return valid_actions[0] if valid_actions else "draw_pile"


def evaluate(args):
    opponent_label = args.opponent or "random"
    print(f"Hybrid Neural AI Evaluation")
    print(f"  Opponent: {opponent_label}")
    print(f"  Games:    {args.games}")
    print(f"  Players:  {args.players}")
    print()

    # Load all three networks
    hand_eval = HandEvalNet()
    hand_eval.load_state_dict(torch.load(MODELS_DIR / "hand_evaluator.pt", weights_only=True))
    hand_eval.eval()

    discard_net = DiscardPolicyNet()
    discard_net.load_state_dict(torch.load(MODELS_DIR / "discard_policy.pt", weights_only=True))
    discard_net.eval()

    buy_net = BuyEvalNet()
    buy_net.load_state_dict(torch.load(MODELS_DIR / "buy_evaluator.pt", weights_only=True))
    buy_net.eval()

    print("Loaded all three networks")

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state=True,
    )

    results = []
    start_total = time.time()

    for i in range(args.games):
        seed = 10000 + i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 3000 * max(1, args.players // 2)
        info = {}

        while not done and step_count < max_steps:
            valid_actions, current_player = env.get_valid_actions()
            if not valid_actions:
                break

            if current_player == 0:
                full_state = env.get_full_state(player=0)
                action = hybrid_action(
                    full_state["state"], valid_actions, full_state["phase"],
                    hand_eval, discard_net, buy_net, full_state,
                )
            else:
                action = random.choice(valid_actions)

            _, _, done, info = env.step(action)
            step_count += 1

        scores = info.get("scores", [])
        my_score = scores[0] if scores else 0
        opp_scores = scores[1:] if len(scores) > 1 else []
        best_opp = min(opp_scores) if opp_scores else float("inf")

        results.append({
            "seed": seed,
            "my_score": my_score,
            "best_opp_score": best_opp if best_opp != float("inf") else None,
            "won": my_score <= best_opp if opp_scores else False,
            "steps": step_count,
        })

        if (i + 1) % 20 == 0 or (i + 1) == args.games:
            wins = sum(r["won"] for r in results)
            avg = sum(r["my_score"] for r in results) / len(results)
            print(f"  Game {i+1:4d}/{args.games} | Win rate: {wins/(i+1)*100:5.1f}% | Avg score: {avg:7.1f}")

    env.close()

    # Final report
    total = len(results)
    wins = sum(r["won"] for r in results)
    avg_score = sum(r["my_score"] for r in results) / total
    opp_valid = [r["best_opp_score"] for r in results if r["best_opp_score"] is not None]
    avg_opp = sum(opp_valid) / len(opp_valid) if opp_valid else 0

    print()
    print("=" * 55)
    print("Hybrid Neural AI -- Evaluation Results")
    print("=" * 55)
    print(f"  Opponent:         {opponent_label}")
    print(f"  Games:            {total}")
    print(f"  Win rate:         {wins/total*100:.1f}%  ({wins}/{total})")
    print(f"  Avg score (ours): {avg_score:.1f}")
    print(f"  Avg opp score:    {avg_opp:.1f}")
    print("=" * 55)

    # Save
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EVAL_DIR / f"eval_hybrid_vs_{opponent_label}.json"
    with open(out_path, "w") as f:
        json.dump({
            "model": "hybrid (hand_eval + discard + buy)",
            "opponent": opponent_label,
            "games": total, "players": args.players,
            "win_rate": round(wins / total * 100, 2),
            "avg_my_score": round(avg_score, 1),
            "avg_opp_score": round(avg_opp, 1),
            "per_game": results,
        }, f, indent=2)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate hybrid neural AI")
    parser.add_argument("--opponent", type=str, default="the-shark")
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--players", type=int, default=4)
    args = parser.parse_args()
    evaluate(args)
