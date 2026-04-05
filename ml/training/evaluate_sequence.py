"""
Evaluate the V3 LSTM sequence model against specified opponents.

The LSTM hidden state is maintained across a full game (reset at round boundaries).
Decision heads:
  - Draw/Buy: binary sigmoid -> take if prob > 0.5
  - Discard: masked argmax (or temperature sampling) over 22 hand slots
  - Meld/Layoff: rule-based (always meld/layoff when valid)

Usage:
    python evaluate_sequence.py --opponent the-shark --games 100 --players 4
    python evaluate_sequence.py --opponent the-shark --games 50 --temperature 0.8
"""

import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from network_v3 import ShanghaiLSTM, OpponentEncoderNetV3
from shanghai_env import ShanghaiEnv
from state_encoder import (
    CARD_FEATURES, MAX_HAND_CARDS,
    OPP_RAW_TOTAL, OPP_EMBEDDING_TOTAL,
    V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
    V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES,
    V3_LSTM_HIDDEN, V3_LSTM_LAYERS,
    V3_PHASE_DRAW, V3_PHASE_BUY, V3_PHASE_ACTION,
    V3_ACT_DRAW_PILE, V3_ACT_TAKE_DISCARD, V3_ACT_BUY, V3_ACT_DECLINE_BUY, V3_ACT_DISCARD,
)
from log_utils import setup_logging

MODELS_DIR = Path(__file__).parent.parent / "models"
EVAL_DIR = Path(__file__).parent.parent / "data" / "eval"


# ── Feature helpers ──────────────────────────────────────────────────────────

def encode_card_features(card_dict: dict) -> list:
    """Encode a card dict to 6 floats: rank/13, suit_onehot(4), is_joker."""
    if card_dict is None:
        return [0.0] * CARD_FEATURES
    rank = card_dict.get("rank", 0)
    suit = card_dict.get("suit", "")
    is_joker = 1.0 if card_dict.get("isJoker", False) else 0.0
    rank_norm = rank / 13.0
    suit_map = {"clubs": 0, "diamonds": 1, "hearts": 2, "spades": 3}
    suit_idx = suit_map.get(suit, -1)
    suit_onehot = [0.0, 0.0, 0.0, 0.0]
    if suit_idx >= 0:
        suit_onehot[suit_idx] = 1.0
    return [rank_norm] + suit_onehot + [is_joker]


def encode_prev_action(action_type: int, card: dict) -> list:
    """Encode action type + card to 10 floats: type_onehot(5) + card_features(5).

    action_type: one of V3_ACT_* constants (0-4)
    card: card dict or None
    Returns 10 floats: [type_onehot x5, rank_norm, suit_onehot x3, is_joker]
    Note: only 5 card features here (no 4th suit needed — space constrained to 5)
    """
    type_onehot = [0.0] * 5
    if 0 <= action_type < 5:
        type_onehot[action_type] = 1.0

    # Compact card encoding: rank_norm + 3 suit bits + is_joker = 5 floats
    if card is not None:
        rank = card.get("rank", 0)
        suit = card.get("suit", "")
        is_joker = 1.0 if card.get("isJoker", False) else 0.0
        rank_norm = rank / 13.0
        suit_map = {"clubs": 0, "diamonds": 1, "hearts": 2}
        suit_idx = suit_map.get(suit, -1)
        suit_bits = [0.0, 0.0, 0.0]
        if suit_idx >= 0:
            suit_bits[suit_idx] = 1.0
        card_feats = [rank_norm] + suit_bits + [is_joker]
    else:
        card_feats = [0.0] * 5

    return type_onehot + card_feats


def build_timestep_input(
    state: list,
    opp_raw: list,
    meld_plan: list,
    opp_actions: list,
    action_taken: list,
    phase: int,
    encoder: OpponentEncoderNetV3,
    device: torch.device,
) -> torch.Tensor:
    """Build a (1, 1, 373) input tensor for one LSTM timestep.

    Layout: state(264) + meld_plan(30) + opp_embeddings(48) + opp_actions(18) + action_taken(10) + phase(3)
    """
    state_t = torch.tensor(state, dtype=torch.float32, device=device)               # (264,)
    opp_raw_t = torch.tensor(opp_raw, dtype=torch.float32, device=device)           # (378,)
    meld_plan_t = torch.tensor(meld_plan, dtype=torch.float32, device=device)       # (30,)
    opp_actions_t = torch.tensor(opp_actions, dtype=torch.float32, device=device)   # (18,)
    action_taken_t = torch.tensor(action_taken, dtype=torch.float32, device=device) # (10,)

    phase_onehot = torch.zeros(V3_PHASE_FEATURES, device=device)
    if 0 <= phase < V3_PHASE_FEATURES:
        phase_onehot[phase] = 1.0

    with torch.no_grad():
        opp_emb = encoder.encode_all_opponents(opp_raw_t.unsqueeze(0)).squeeze(0)   # (48,)

    x = torch.cat([
        state_t,        # 264
        meld_plan_t,    # 30
        opp_emb,        # 48
        opp_actions_t,  # 18
        action_taken_t, # 10
        phase_onehot,   # 3
    ])  # (373,)

    return x.unsqueeze(0).unsqueeze(0)  # (1, 1, 373)


# ── Hidden state helpers ─────────────────────────────────────────────────────

def make_zero_hidden(device: torch.device) -> tuple:
    """Return (h, c) with shape (V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN), all zeros."""
    h = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN, device=device)
    c = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN, device=device)
    return h, c


# ── LSTM action selection ────────────────────────────────────────────────────

def lstm_action(
    full_state: dict,
    valid_actions: list,
    model: ShanghaiLSTM,
    encoder: OpponentEncoderNetV3,
    hidden: tuple,
    prev_action_feats: list,
    temperature: float,
    device: torch.device,
) -> tuple:
    """Choose an action using the LSTM model, returning (action, h_t, new_hidden).

    Meld and layoff decisions are rule-based (always execute when valid).
    Draw, buy, and discard decisions go through the LSTM heads.

    Returns:
        action: str — chosen action string
        h_t: (1, 192) hidden state for this timestep
        new_hidden: (h_new, c_new) updated LSTM state
    """
    phase_str = full_state.get("phase", "action")
    current_round = full_state.get("round", 1)

    # Map phase string to phase index for LSTM input
    if phase_str == "draw":
        phase_idx = V3_PHASE_DRAW
    elif phase_str == "buy-window":
        phase_idx = V3_PHASE_BUY
    else:
        phase_idx = V3_PHASE_ACTION

    state_vec = full_state.get("state", [])
    opp_raw_vec = full_state.get("opponentRaw", [0.0] * OPP_RAW_TOTAL)
    meld_plan = full_state.get("meld_plan", [0.0] * V3_MELD_PLAN_FEATURES)
    opp_actions = full_state.get("opponent_actions", [0.0] * V3_OPP_ACTIONS_FEATURES)

    # Pad/truncate vectors to expected sizes
    def pad(vec, size):
        if len(vec) >= size:
            return vec[:size]
        return vec + [0.0] * (size - len(vec))

    state_vec = pad(state_vec, 264)
    opp_raw_vec = pad(opp_raw_vec, OPP_RAW_TOTAL)
    meld_plan = pad(meld_plan, V3_MELD_PLAN_FEATURES)
    opp_actions = pad(opp_actions, V3_OPP_ACTIONS_FEATURES)

    x_t = build_timestep_input(
        state_vec, opp_raw_vec, meld_plan, opp_actions,
        prev_action_feats, phase_idx, encoder, device,
    )

    with torch.no_grad():
        h_t, new_hidden = model.step_inference(x_t, hidden)

    # ── Rule-based: always meld/layoff ──────────────────────────────────
    if phase_idx == V3_PHASE_ACTION:
        if "meld" in valid_actions:
            return "meld", h_t, new_hidden
        layoff_actions = [a for a in valid_actions if a.startswith("layoff:")]
        if layoff_actions:
            return layoff_actions[0], h_t, new_hidden

    # ── Neural: draw decision ────────────────────────────────────────────
    if phase_idx == V3_PHASE_DRAW:
        discard_top = full_state.get("discardTop")
        if "take_discard" in valid_actions and discard_top:
            offered_feats = encode_card_features(discard_top)
            offered_t = torch.tensor(offered_feats, dtype=torch.float32, device=device).unsqueeze(0)
            with torch.no_grad():
                prob = model.draw_head_forward(h_t, offered_t).item()
            if temperature != 1.0:
                # Scale logit by 1/temperature before applying sigmoid interpretation
                logit = torch.log(torch.tensor(prob / (1.0 - prob + 1e-8)))
                prob = torch.sigmoid(logit / temperature).item()
            if prob > 0.5:
                return "take_discard", h_t, new_hidden
        return "draw_pile" if "draw_pile" in valid_actions else valid_actions[0], h_t, new_hidden

    # ── Neural: buy decision ─────────────────────────────────────────────
    if phase_idx == V3_PHASE_BUY:
        if "buy" not in valid_actions and "decline_buy" not in valid_actions:
            return valid_actions[0] if valid_actions else "decline_buy", h_t, new_hidden
        discard_top = full_state.get("discardTop")
        if discard_top and "buy" in valid_actions:
            offered_feats = encode_card_features(discard_top)
            offered_t = torch.tensor(offered_feats, dtype=torch.float32, device=device).unsqueeze(0)
            with torch.no_grad():
                prob = model.buy_head_forward(h_t, offered_t).item()
            if temperature != 1.0:
                logit = torch.log(torch.tensor(prob / (1.0 - prob + 1e-8)))
                prob = torch.sigmoid(logit / temperature).item()
            if prob > 0.5:
                return "buy", h_t, new_hidden
        return "decline_buy" if "decline_buy" in valid_actions else valid_actions[0], h_t, new_hidden

    # ── Neural: discard decision ─────────────────────────────────────────
    discard_actions = [a for a in valid_actions if a.startswith("discard:")]
    if discard_actions:
        with torch.no_grad():
            logits = model.discard_head_forward(h_t)[0]  # (22,)
        # Mask invalid slots
        hand_size = full_state.get("handSize", 10)
        mask = torch.full((MAX_HAND_CARDS,), -1e9, device=device)
        mask[:hand_size] = 0.0
        logits = logits + mask

        if temperature != 1.0 and temperature > 0:
            probs = F.softmax(logits / temperature, dim=-1)
            chosen_idx = torch.multinomial(probs, 1).item()
        else:
            chosen_idx = logits.argmax().item()

        target = f"discard:{chosen_idx}"
        if target in discard_actions:
            return target, h_t, new_hidden
        # Fallback: pick first valid discard
        return discard_actions[0], h_t, new_hidden

    return valid_actions[0] if valid_actions else "draw_pile", h_t, new_hidden


# ── Main evaluation loop ─────────────────────────────────────────────────────

def evaluate(args):
    setup_logging("evaluate_sequence")

    opponent_label = args.opponent
    print("LSTM V3 Sequence Model Evaluation")
    print(f"  Opponent:    {opponent_label}")
    print(f"  Games:       {args.games}")
    print(f"  Players:     {args.players}")
    print(f"  Temperature: {args.temperature}")
    print()

    device = torch.device("cpu")

    # Load models
    encoder = OpponentEncoderNetV3()
    encoder.load_state_dict(torch.load(MODELS_DIR / "opponent_encoder_v3.pt", weights_only=True))
    encoder.eval()

    model = ShanghaiLSTM()
    model.load_state_dict(torch.load(MODELS_DIR / "shanghai_lstm.pt", weights_only=True))
    model.eval()

    print("Loaded shanghai_lstm.pt and opponent_encoder_v3.pt")

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state_v3=True,
    )

    results = []
    start_total = time.time()
    prev_round = None

    for game_i in range(args.games):
        seed = 10000 + game_i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 6000
        info = {}

        # Initialize LSTM hidden state and action tracking at game start
        hidden = make_zero_hidden(device)
        prev_action_feats = [0.0] * V3_ACTION_TAKEN_FEATURES
        prev_round = None

        while not done and step_count < max_steps:
            valid_actions, _ = env.get_valid_actions()
            if not valid_actions:
                break

            full_state = env.get_full_state(player=0)

            # Reset hidden state at round boundary
            current_round = full_state.get("round", 1)
            if prev_round is not None and current_round != prev_round:
                hidden = make_zero_hidden(device)
                prev_action_feats = [0.0] * V3_ACTION_TAKEN_FEATURES
            prev_round = current_round

            action, h_t, hidden = lstm_action(
                full_state, valid_actions,
                model, encoder, hidden,
                prev_action_feats,
                args.temperature, device,
            )

            # Build prev_action_feats for the next timestep
            phase_str = full_state.get("phase", "action")
            discard_top = full_state.get("discardTop")

            if action == "draw_pile":
                prev_action_feats = encode_prev_action(V3_ACT_DRAW_PILE, None)
            elif action == "take_discard":
                prev_action_feats = encode_prev_action(V3_ACT_TAKE_DISCARD, discard_top)
            elif action == "buy":
                prev_action_feats = encode_prev_action(V3_ACT_BUY, discard_top)
            elif action == "decline_buy":
                prev_action_feats = encode_prev_action(V3_ACT_DECLINE_BUY, None)
            elif action.startswith("discard:"):
                try:
                    slot_idx = int(action.split(":")[1])
                    hand = full_state.get("hand", [])
                    card = hand[slot_idx] if slot_idx < len(hand) else None
                except (ValueError, IndexError):
                    card = None
                prev_action_feats = encode_prev_action(V3_ACT_DISCARD, card)
            else:
                # meld, layoff, etc. — no card context tracked for prev_action
                prev_action_feats = [0.0] * V3_ACTION_TAKEN_FEATURES

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

        if (game_i + 1) % 10 == 0 or (game_i + 1) == args.games:
            wins = sum(r["won"] for r in results)
            avg = sum(r["my_score"] for r in results) / len(results)
            print(f"  Game {game_i+1:4d}/{args.games} | Win rate: {wins/(game_i+1)*100:5.1f}% | Avg score: {avg:7.1f}")

    env.close()

    # Final report
    total = len(results)
    wins = sum(r["won"] for r in results)
    avg_score = sum(r["my_score"] for r in results) / total
    opp_valid = [r["best_opp_score"] for r in results if r["best_opp_score"] is not None]
    avg_opp = sum(opp_valid) / len(opp_valid) if opp_valid else 0.0
    elapsed = time.time() - start_total

    print()
    print("=" * 55)
    print("LSTM V3 -- Evaluation Results")
    print("=" * 55)
    print(f"  Opponent:         {opponent_label}")
    print(f"  Games:            {total}")
    print(f"  Win rate:         {wins/total*100:.1f}%  ({wins}/{total})")
    print(f"  Avg score (ours): {avg_score:.1f}")
    print(f"  Avg opp score:    {avg_opp:.1f}")
    print(f"  Temperature:      {args.temperature}")
    print(f"  Elapsed:          {elapsed:.1f}s")
    print("=" * 55)

    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EVAL_DIR / f"eval_lstm_vs_{opponent_label}.json"
    with open(out_path, "w") as f:
        json.dump({
            "model": "lstm_v3",
            "opponent": opponent_label,
            "games": total,
            "players": args.players,
            "temperature": args.temperature,
            "win_rate": round(wins / total * 100, 2),
            "avg_my_score": round(avg_score, 1),
            "avg_opp_score": round(avg_opp, 1),
            "elapsed_s": round(elapsed, 1),
            "per_game": results,
        }, f, indent=2)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate V3 LSTM sequence model")
    parser.add_argument("--opponent", type=str, required=True)
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--players", type=int, default=4)
    parser.add_argument("--temperature", type=float, default=1.0)
    args = parser.parse_args()
    evaluate(args)
