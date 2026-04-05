"""
preprocess.py — Streaming JSON-to-.pt converter for Shanghai Rummy ML training data.

Converts large JSON training data files into compact PyTorch .pt tensor files
using ijson for memory-efficient streaming. Solves OOM issues with multi-GB files
on machines with limited RAM.

Usage:
    # Single file (v1/v2)
    python ml/training/preprocess.py ml/data/hybrid_training_v2/hand_eval_20260403_192200_1000games.json

    # Multiple files (v1/v2)
    python ml/training/preprocess.py ml/data/hybrid_training_v2/*.json

    # V3 mode: preprocess round sequences for LSTM
    python ml/training/preprocess.py --v3 --data ml/data/sequence_training/sequences_1000games.json

Output:
    v1/v2: Saves .pt file alongside each input JSON with the same base name.
    v3: Saves v3_*.pt tensor files in the same directory as the input JSON.
"""

import argparse
import itertools
import json
import os
import random
import sys
import time
from pathlib import Path

import ijson
import numpy as np
import torch


KNOWN_DATA_TYPES = ["hand_eval", "buy", "discard", "draw"]


def detect_data_type(filepath: str) -> str:
    """Auto-detect data type from filename prefix."""
    basename = Path(filepath).name
    for dtype in KNOWN_DATA_TYPES:
        if basename.startswith(dtype + "_") or basename == dtype + ".json":
            return dtype
    raise ValueError(
        f"Cannot detect data type from filename '{basename}'. "
        f"Expected prefix: {', '.join(KNOWN_DATA_TYPES)}"
    )


def get_count_and_check_opponent_raw(filepath: str) -> tuple[int, bool]:
    """Single pass: read 'count' field and check first sample for opponent_raw."""
    count = None
    has_opponent_raw = False
    with open(filepath, "rb") as f:
        # Read count
        parser = ijson.items(f, "count")
        for c in parser:
            count = int(c)
            break
    if count is None:
        raise ValueError(f"No 'count' field found in {filepath}")
    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for sample in samples:
            has_opponent_raw = "opponent_raw" in sample
            break
    return count, has_opponent_raw


def _validate_count(actual: int, count: int, filepath: str) -> None:
    """Validate actual sample count matches the header count."""
    if actual == 0:
        raise ValueError(f"No samples found in {filepath}")
    if actual != count:
        raise ValueError(f"Sample count mismatch in {filepath}: header says {count}, got {actual}")


def process_hand_eval(filepath: str, count: int, has_opponent_raw: bool) -> dict:
    """Stream hand_eval samples into tensors."""
    states = np.empty((count, 264), dtype=np.float32)
    labels = np.empty(count, dtype=np.float32)
    rounds = np.empty(count, dtype=np.int64)
    opponent_raw = np.empty((count, 378), dtype=np.float32) if has_opponent_raw else None
    actual = 0

    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for i, sample in enumerate(samples):
            states[i] = sample["state"]
            labels[i] = sample["label"]
            rounds[i] = sample["round"]
            if has_opponent_raw and "opponent_raw" in sample:
                opponent_raw[i] = sample["opponent_raw"]

            if (i + 1) % 50000 == 0:
                print(f"  Processed {i + 1:,}/{count:,} samples...")
            actual = i + 1

    _validate_count(actual, count, filepath)

    result = {
        "states": torch.from_numpy(states),
        "labels": torch.from_numpy(labels),
        "rounds": torch.from_numpy(rounds),
        "type": "hand_eval",
        "count": count,
    }
    if has_opponent_raw:
        result["opponent_raw"] = torch.from_numpy(opponent_raw)
    return result


def process_buy(filepath: str, count: int, has_opponent_raw: bool) -> dict:
    """Stream buy samples into tensors + list of card dicts."""
    states = np.empty((count, 264), dtype=np.float32)
    rounds = np.empty(count, dtype=np.int64)
    bought = np.empty(count, dtype=np.bool_)
    opponent_raw = np.empty((count, 378), dtype=np.float32) if has_opponent_raw else None
    offered_cards = []
    actual = 0

    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for i, sample in enumerate(samples):
            states[i] = sample["state"]
            rounds[i] = sample["round"]
            bought[i] = sample["bought"]
            # Keep offered_card as-is for encode_offered_card() at train time
            offered_cards.append(sample["offered_card"])
            if has_opponent_raw and "opponent_raw" in sample:
                opponent_raw[i] = sample["opponent_raw"]

            if (i + 1) % 50000 == 0:
                print(f"  Processed {i + 1:,}/{count:,} samples...")
            actual = i + 1

    _validate_count(actual, count, filepath)

    result = {
        "states": torch.from_numpy(states),
        "rounds": torch.from_numpy(rounds),
        "bought": torch.from_numpy(bought),
        "offered_cards": offered_cards,
        "type": "buy",
        "count": count,
    }
    if has_opponent_raw:
        result["opponent_raw"] = torch.from_numpy(opponent_raw)
    return result


def process_discard(filepath: str, count: int, has_opponent_raw: bool) -> dict:
    """Stream discard samples into tensors (hands dropped — labels computed at train time)."""
    states = np.empty((count, 264), dtype=np.float32)
    rounds = np.empty(count, dtype=np.int64)
    hand_sizes = np.empty(count, dtype=np.int64)
    opponent_raw = np.empty((count, 378), dtype=np.float32) if has_opponent_raw else None
    actual = 0

    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for i, sample in enumerate(samples):
            states[i] = sample["state"]
            rounds[i] = sample["round"]
            hand_sizes[i] = sample["hand_size"]
            if has_opponent_raw and "opponent_raw" in sample:
                opponent_raw[i] = sample["opponent_raw"]

            if (i + 1) % 50000 == 0:
                print(f"  Processed {i + 1:,}/{count:,} samples...")
            actual = i + 1

    _validate_count(actual, count, filepath)

    result = {
        "states": torch.from_numpy(states),
        "rounds": torch.from_numpy(rounds),
        "hand_sizes": torch.from_numpy(hand_sizes),
        "type": "discard",
        "count": count,
    }
    if has_opponent_raw:
        result["opponent_raw"] = torch.from_numpy(opponent_raw)
    return result


def process_draw(filepath: str, count: int, has_opponent_raw: bool) -> dict:
    """Stream draw samples into tensors + list of card dicts."""
    states = np.empty((count, 264), dtype=np.float32)
    rounds = np.empty(count, dtype=np.int64)
    opponent_raw = np.empty((count, 378), dtype=np.float32) if has_opponent_raw else None
    offered_cards = []
    actual = 0

    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for i, sample in enumerate(samples):
            states[i] = sample["state"]
            rounds[i] = sample["round"]
            # Keep offered_card as-is for encode_offered_card() at train time
            offered_cards.append(sample["offered_card"])
            if has_opponent_raw and "opponent_raw" in sample:
                opponent_raw[i] = sample["opponent_raw"]

            if (i + 1) % 50000 == 0:
                print(f"  Processed {i + 1:,}/{count:,} samples...")
            actual = i + 1

    _validate_count(actual, count, filepath)

    result = {
        "states": torch.from_numpy(states),
        "rounds": torch.from_numpy(rounds),
        "offered_cards": offered_cards,
        "type": "draw",
        "count": count,
    }
    if has_opponent_raw:
        result["opponent_raw"] = torch.from_numpy(opponent_raw)
    return result


PROCESSORS = {
    "hand_eval": process_hand_eval,
    "buy": process_buy,
    "discard": process_discard,
    "draw": process_draw,
}


def preprocess_file(filepath: str) -> str:
    """
    Convert a single JSON training data file to .pt format.

    Returns the output .pt file path.
    """
    filepath = os.path.abspath(filepath)
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    dtype = detect_data_type(filepath)
    out_path = filepath.rsplit(".", 1)[0] + ".pt"
    basename = os.path.basename(filepath)

    print(f"\n{'='*60}")
    print(f"Processing: {basename}")
    print(f"Data type:  {dtype}")
    print(f"{'='*60}")

    # Single pass: get count and check for opponent_raw
    t0 = time.time()
    count, has_opponent_raw = get_count_and_check_opponent_raw(filepath)
    print(f"  Sample count: {count:,} (read in {time.time() - t0:.1f}s)")
    print(f"  Has opponent_raw: {has_opponent_raw}")

    # Pass 2: stream and fill arrays
    t1 = time.time()
    print(f"  Streaming samples...")
    result = PROCESSORS[dtype](filepath, count, has_opponent_raw)
    elapsed = time.time() - t1
    print(f"  Streamed {count:,} samples in {elapsed:.1f}s ({count / max(elapsed, 0.01):.0f} samples/s)")

    # Save atomically via temp file
    out = Path(out_path)
    tmp = out.with_suffix(".pt.tmp")
    torch.save(result, str(tmp))
    os.replace(str(tmp), out_path)
    file_size_mb = os.path.getsize(out_path) / (1024 * 1024)
    json_size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"  Saved: {os.path.basename(out_path)} ({file_size_mb:.1f} MB, {json_size_mb / max(file_size_mb, 0.01):.1f}x compression)")
    print(f"  Total time: {time.time() - t0:.1f}s")

    return out_path


def verify_pt_file(pt_path: str) -> None:
    """Load and print summary of a .pt file for verification."""
    data = torch.load(pt_path, weights_only=False)
    print(f"\n  Verification of {os.path.basename(pt_path)}:")
    print(f"    type:  {data['type']}")
    print(f"    count: {data['count']:,}")
    for key, val in data.items():
        if isinstance(val, torch.Tensor):
            print(f"    {key}: {val.dtype} {list(val.shape)}")
        elif isinstance(val, list):
            print(f"    {key}: list[{len(val)}]", end="")
            if val:
                print(f", first={val[0]}", end="")
            print()
        elif key not in ("type", "count"):
            print(f"    {key}: {val}")


# ---------------------------------------------------------------------------
# V3: Round sequence preprocessing with suit augmentation
# ---------------------------------------------------------------------------

# Suit indices in card feature blocks: [rank/13, hearts, diamonds, clubs, spades, is_joker]
SUIT_NAMES = ["hearts", "diamonds", "clubs", "spades"]
SUIT_TO_IDX = {s: i for i, s in enumerate(SUIT_NAMES)}

# All 24 possible suit permutations
ALL_SUIT_PERMS = list(itertools.permutations(range(4)))

# Phase and action type mappings for target encoding
PHASE_MAP = {"draw": 0, "buy-window": 1, "action": 2}
ACTION_TYPE_MAP = {
    "draw_pile": 0,
    "take_discard": 1,
    "buy": 2,
    "decline_buy": 3,
    "pass": 3,          # "pass" from data gen maps to decline_buy
    "discard": 4,
    "meld": 5,
    "layoff": 6,
}

# Feature dimensions (must match state_encoder.py)
CARD_FEAT = 6
STATE_DIM = 264        # hand(132) + discard_history(60) + table_melds(60) + game_context(12)
OPP_RAW_DIM = 378      # 3 opponents x 126 each
MELD_PLAN_DIM = 30
OPP_ACTIONS_DIM = 18
ACTION_TAKEN_DIM = 10
PHASE_DIM = 3
TIMESTEP_DIM = STATE_DIM + OPP_RAW_DIM + MELD_PLAN_DIM + OPP_ACTIONS_DIM + ACTION_TAKEN_DIM + PHASE_DIM  # 703
MAX_SEQ_LEN = 80

# Card block locations within state (264-dim)
STATE_HAND_START = 0
STATE_HAND_END = 22 * CARD_FEAT          # 132
STATE_DISCARD_START = 132
STATE_DISCARD_END = 132 + 10 * CARD_FEAT  # 192

# Card block locations within per-opponent raw (126-dim each)
OPP_DISCARD_START = 0
OPP_DISCARD_END = 10 * CARD_FEAT          # 60
OPP_PICKUP_START = 60
OPP_PICKUP_END = 60 + 5 * CARD_FEAT       # 90
OPP_PER_FEATURES = 126


def encode_card_features(card_dict):
    """Encode a card dict {rank, suit} into 6 floats: [rank/13, hearts, diamonds, clubs, spades, is_joker]."""
    if not card_dict:
        return [0.0] * CARD_FEAT
    rank = card_dict.get("rank", 0)
    suit = card_dict.get("suit", "")
    is_joker = 1.0 if suit == "joker" or rank == 0 else 0.0
    vec = [rank / 13.0, 0.0, 0.0, 0.0, 0.0, is_joker]
    if suit in SUIT_TO_IDX:
        vec[1 + SUIT_TO_IDX[suit]] = 1.0
    return vec


def _remap_card_block_suits(block, suit_map):
    """Remap suit one-hots in a flat list of 6-feature card blocks in-place.

    suit_map: list of 4 ints — suit_map[old_idx] = new_idx.
    Each card block: [rank/13, hearts, diamonds, clubs, spades, is_joker].
    """
    num_cards = len(block) // CARD_FEAT
    for c in range(num_cards):
        base = c * CARD_FEAT
        # Extract old suit one-hots (positions 1-4)
        old_suits = [block[base + 1 + s] for s in range(4)]
        # Clear and remap
        for s in range(4):
            block[base + 1 + s] = 0.0
        for old_s in range(4):
            if old_suits[old_s] > 0.5:
                block[base + 1 + suit_map[old_s]] = old_suits[old_s]


def remap_state_vector(state, suit_map):
    """Remap card block suits in the 264-dim state vector. Returns new list."""
    state = list(state)
    # Hand: 22 cards x 6 features at [0:132]
    hand_block = state[STATE_HAND_START:STATE_HAND_END]
    _remap_card_block_suits(hand_block, suit_map)
    state[STATE_HAND_START:STATE_HAND_END] = hand_block
    # Discard history: 10 cards x 6 features at [132:192]
    discard_block = state[STATE_DISCARD_START:STATE_DISCARD_END]
    _remap_card_block_suits(discard_block, suit_map)
    state[STATE_DISCARD_START:STATE_DISCARD_END] = discard_block
    return state


def remap_opp_raw_suits(opp_raw, suit_map):
    """Remap card block suits in the 378-dim opponent raw vector. Returns new list."""
    opp_raw = list(opp_raw)
    for opp_i in range(3):
        base = opp_i * OPP_PER_FEATURES
        # Discard history: 10 cards x 6 at offset 0
        d_start = base + OPP_DISCARD_START
        d_end = base + OPP_DISCARD_END
        discard_block = opp_raw[d_start:d_end]
        _remap_card_block_suits(discard_block, suit_map)
        opp_raw[d_start:d_end] = discard_block
        # Pickup history: 5 cards x 6 at offset 60
        p_start = base + OPP_PICKUP_START
        p_end = base + OPP_PICKUP_END
        pickup_block = opp_raw[p_start:p_end]
        _remap_card_block_suits(pickup_block, suit_map)
        opp_raw[p_start:p_end] = pickup_block
    return opp_raw


def _remap_action_taken_suits(action_taken, suit_map):
    """Remap suit one-hots in the 10-dim action_taken vector.

    Layout: action_type_onehot(5) + [rank/13, suit_h, suit_d, suit_c, suit_s].
    Suit one-hots are at positions 6-9.
    """
    action_taken = list(action_taken)
    old_suits = [action_taken[6 + s] for s in range(4)]
    for s in range(4):
        action_taken[6 + s] = 0.0
    for old_s in range(4):
        if old_suits[old_s] > 0.5:
            action_taken[6 + suit_map[old_s]] = old_suits[old_s]
    return action_taken


def permute_sequence_suits(seq, perm):
    """Apply a suit permutation to all card features in a sequence. Returns new sequence dict."""
    suit_map = list(perm)  # suit_map[old_idx] = new_idx

    new_turns = []
    for turn in seq["turns"]:
        new_turn = dict(turn)
        new_turn["state"] = remap_state_vector(turn["state"], suit_map)
        new_turn["opponent_raw"] = remap_opp_raw_suits(turn["opponent_raw"], suit_map)
        new_turn["action_taken"] = _remap_action_taken_suits(turn["action_taken"], suit_map)
        # Remap hand card suits for target card index matching
        if "hand" in turn:
            new_hand = []
            for card in turn["hand"]:
                new_card = dict(card)
                old_suit = card.get("suit", "")
                if old_suit in SUIT_TO_IDX:
                    new_card["suit"] = SUIT_NAMES[suit_map[SUIT_TO_IDX[old_suit]]]
                new_hand.append(new_card)
            new_turn["hand"] = new_hand
        # Remap action_detail card if present
        if "action_detail" in turn and "card_suit" in turn.get("action_detail", {}):
            new_detail = dict(turn["action_detail"])
            old_suit = new_detail["card_suit"]
            if old_suit in SUIT_TO_IDX:
                new_detail["card_suit"] = SUIT_NAMES[suit_map[SUIT_TO_IDX[old_suit]]]
            new_turn["action_detail"] = new_detail
        new_turns.append(new_turn)

    return {
        "game_seed": seq["game_seed"],
        "round_number": seq["round_number"],
        "round_score": seq["round_score"],
        "went_out": seq["went_out"],
        "player_name": seq["player_name"],
        "turns": new_turns,
    }


def _encode_phase_onehot(phase_str):
    """Encode phase as 3-dim one-hot: [draw, buy, action]."""
    vec = [0.0] * PHASE_DIM
    idx = PHASE_MAP.get(phase_str, -1)
    if 0 <= idx < PHASE_DIM:
        vec[idx] = 1.0
    return vec


def _get_offered_card_features(turn):
    """Extract offered card features (6-dim) for draw/buy decisions."""
    action_type = turn.get("action_type", "")
    action_detail = turn.get("action_detail", {})
    # For take_discard and buy, the offered card is the discard top
    if action_type in ("take_discard", "buy"):
        if "card_rank" in action_detail:
            return encode_card_features({"rank": action_detail["card_rank"], "suit": action_detail.get("card_suit", "")})
    # For draw_pile, no offered card (well, we still need the discard top for the draw/take decision)
    # Actually for the draw head, the offered card is always the discard top at decision time
    # The valid_actions can tell us if take_discard was available
    phase = turn.get("phase", "")
    if phase in ("draw", "buy-window"):
        # Try to get discard top from valid_actions context or action_detail
        if action_type == "draw_pile" and "card_rank" in action_detail:
            return encode_card_features({"rank": action_detail["card_rank"], "suit": action_detail.get("card_suit", "")})
    return [0.0] * CARD_FEAT


def _get_target(turn):
    """Extract target triple: [phase_idx, action_type_idx, card_index_or_neg1]."""
    phase_idx = PHASE_MAP.get(turn.get("phase", ""), 0)
    action_type = turn.get("action_type", "")
    action_type_idx = ACTION_TYPE_MAP.get(action_type, 0)
    card_idx = -1
    if action_type == "discard":
        detail = turn.get("action_detail", {})
        card_idx = detail.get("card_idx", -1)
    return [phase_idx, action_type_idx, card_idx]


def _sequence_to_tensors(seq):
    """Convert a single sequence dict to numpy arrays for one row.

    Returns: (features, mask, targets, offered, round_score, round_number)
      features: (max_seq_len, 703)
      mask: (max_seq_len,)
      targets: (max_seq_len, 3)
      offered: (max_seq_len, 6)
    """
    turns = seq["turns"]
    num_turns = min(len(turns), MAX_SEQ_LEN)

    features = np.zeros((MAX_SEQ_LEN, TIMESTEP_DIM), dtype=np.float32)
    mask = np.zeros(MAX_SEQ_LEN, dtype=np.bool_)
    targets = np.full((MAX_SEQ_LEN, 3), -1, dtype=np.int64)
    offered = np.zeros((MAX_SEQ_LEN, CARD_FEAT), dtype=np.float32)

    for t in range(num_turns):
        turn = turns[t]
        # Build 703-dim feature vector
        state_vec = turn["state"]                    # 264
        opp_raw = turn.get("opponent_raw", [0.0] * OPP_RAW_DIM)  # 378
        meld_plan = turn.get("meld_plan", [0.0] * MELD_PLAN_DIM)  # 30
        opp_actions = turn.get("opponent_actions", [0.0] * OPP_ACTIONS_DIM)  # 18
        action_taken = turn.get("action_taken", [0.0] * ACTION_TAKEN_DIM)  # 10
        phase_vec = _encode_phase_onehot(turn.get("phase", ""))  # 3

        # Concatenate: state(264) + opp_raw(378) + meld_plan(30) + opp_actions(18) + action_taken(10) + phase(3) = 703
        row = state_vec + opp_raw + meld_plan + opp_actions + action_taken + phase_vec
        features[t, :len(row)] = row[:TIMESTEP_DIM]
        mask[t] = True
        targets[t] = _get_target(turn)
        offered[t] = _get_offered_card_features(turn)

    round_score = float(seq.get("round_score", 0))
    round_number = int(seq.get("round_number", 1))

    return features, mask, targets, offered, round_score, round_number


def preprocess_v3(args):
    """V3 mode: convert round sequences JSON to padded PyTorch tensors with suit augmentation."""
    filepath = os.path.abspath(args.data)
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    augment_count = args.augment
    filter_players = [p.strip() for p in args.filter_players.split(",")]
    out_dir = os.path.dirname(filepath)

    print(f"\n{'='*60}")
    print(f"V3 Preprocessing: {os.path.basename(filepath)}")
    print(f"  Augment: {augment_count} permutations + 1 original = {augment_count + 1}x")
    print(f"  Filter players: {filter_players}")
    print(f"  Max seq len: {MAX_SEQ_LEN}")
    print(f"  Timestep dim: {TIMESTEP_DIM}")
    print(f"{'='*60}")

    # Load JSON (sequences are much smaller than v1/v2 individual sample files)
    t0 = time.time()
    print(f"  Loading JSON...")
    with open(filepath, "r") as f:
        data = json.load(f)

    raw_sequences = data["sequences"]
    raw_count = len(raw_sequences)
    print(f"  Loaded {raw_count} sequences in {time.time() - t0:.1f}s")

    # Filter by player name
    sequences = [s for s in raw_sequences if s.get("player_name", "") in filter_players]
    filtered_count = len(sequences)
    print(f"  After player filter: {filtered_count} sequences ({raw_count - filtered_count} removed)")
    del raw_sequences  # free memory

    if filtered_count == 0:
        print("  WARNING: No sequences after filtering. Nothing to save.")
        return

    # Calculate total output size (original + augmented)
    total_count = filtered_count * (1 + augment_count)
    print(f"  Total with augmentation: {total_count} sequences")

    # Pre-allocate output tensors
    print(f"  Allocating tensors...")
    all_features = np.zeros((total_count, MAX_SEQ_LEN, TIMESTEP_DIM), dtype=np.float32)
    all_masks = np.zeros((total_count, MAX_SEQ_LEN), dtype=np.bool_)
    all_targets = np.full((total_count, MAX_SEQ_LEN, 3), -1, dtype=np.int64)
    all_offered = np.zeros((total_count, MAX_SEQ_LEN, CARD_FEAT), dtype=np.float32)
    all_outcomes = np.zeros(total_count, dtype=np.float32)
    all_rounds = np.zeros(total_count, dtype=np.int64)

    mem_mb = (all_features.nbytes + all_masks.nbytes + all_targets.nbytes +
              all_offered.nbytes + all_outcomes.nbytes + all_rounds.nbytes) / (1024 * 1024)
    print(f"  Tensor memory: {mem_mb:.1f} MB")

    # Process sequences: original + augmented
    t1 = time.time()
    out_idx = 0

    # Pre-sample random permutations for all sequences
    random.seed(42)

    for seq_i, seq in enumerate(sequences):
        # Original (identity permutation)
        feat, mask, tgt, off, score, rnd = _sequence_to_tensors(seq)
        all_features[out_idx] = feat
        all_masks[out_idx] = mask
        all_targets[out_idx] = tgt
        all_offered[out_idx] = off
        all_outcomes[out_idx] = score
        all_rounds[out_idx] = rnd
        out_idx += 1

        # Augmented copies with random suit permutations
        if augment_count > 0:
            perms = random.sample(ALL_SUIT_PERMS, min(augment_count, len(ALL_SUIT_PERMS)))
            # If augment_count > 24, sample with replacement for the excess
            while len(perms) < augment_count:
                perms.append(random.choice(ALL_SUIT_PERMS))

            for perm in perms:
                # Skip identity permutation (already included as original)
                if perm == (0, 1, 2, 3):
                    # Replace with another random non-identity perm
                    non_identity = [p for p in ALL_SUIT_PERMS if p != (0, 1, 2, 3)]
                    perm = random.choice(non_identity)

                aug_seq = permute_sequence_suits(seq, perm)
                feat, mask, tgt, off, score, rnd = _sequence_to_tensors(aug_seq)
                all_features[out_idx] = feat
                all_masks[out_idx] = mask
                all_targets[out_idx] = tgt
                all_offered[out_idx] = off
                all_outcomes[out_idx] = score
                all_rounds[out_idx] = rnd
                out_idx += 1

        if (seq_i + 1) % 500 == 0 or seq_i + 1 == filtered_count:
            elapsed = time.time() - t1
            print(f"  Processed {seq_i + 1:,}/{filtered_count:,} sequences "
                  f"({out_idx:,} total with augmentation, {elapsed:.1f}s)")

        # Free the sequence dict to reduce memory pressure
        sequences[seq_i] = None

    assert out_idx == total_count, f"Output count mismatch: {out_idx} vs {total_count}"

    # Convert to PyTorch tensors
    print(f"  Converting to PyTorch tensors...")
    sequences_tensor = torch.from_numpy(all_features)
    masks_tensor = torch.from_numpy(all_masks)
    targets_tensor = torch.from_numpy(all_targets)
    offered_tensor = torch.from_numpy(all_offered)
    outcomes_tensor = torch.from_numpy(all_outcomes)
    rounds_tensor = torch.from_numpy(all_rounds)

    # Free numpy arrays
    del all_features, all_masks, all_targets, all_offered, all_outcomes, all_rounds

    # Save tensors
    basename = Path(filepath).stem
    save_data = {
        "sequences": sequences_tensor,
        "masks": masks_tensor,
        "targets": targets_tensor,
        "offered": offered_tensor,
        "outcomes": outcomes_tensor,
        "rounds": rounds_tensor,
        "type": "v3_sequences",
        "count": total_count,
        "source_file": os.path.basename(filepath),
        "augment_factor": augment_count + 1,
        "filter_players": filter_players,
    }

    out_path = os.path.join(out_dir, f"v3_{basename}.pt")
    tmp_path = out_path + ".tmp"
    print(f"  Saving to {os.path.basename(out_path)}...")
    torch.save(save_data, tmp_path)
    os.replace(tmp_path, out_path)

    file_size_mb = os.path.getsize(out_path) / (1024 * 1024)
    json_size_mb = os.path.getsize(filepath) / (1024 * 1024)
    total_time = time.time() - t0

    print(f"\n  Output: {os.path.basename(out_path)}")
    print(f"  Sequences: {total_count:,} ({filtered_count:,} original x {augment_count + 1})")
    print(f"  Tensor shapes:")
    print(f"    sequences: {list(sequences_tensor.shape)}")
    print(f"    masks:     {list(masks_tensor.shape)}")
    print(f"    targets:   {list(targets_tensor.shape)}")
    print(f"    offered:   {list(offered_tensor.shape)}")
    print(f"    outcomes:  {list(outcomes_tensor.shape)}")
    print(f"    rounds:    {list(rounds_tensor.shape)}")
    print(f"  File size: {file_size_mb:.1f} MB (JSON was {json_size_mb:.1f} MB)")
    print(f"  Total time: {total_time:.1f}s")

    return out_path


def main():
    parser = argparse.ArgumentParser(
        description="Convert JSON training data to compact .pt tensor files via streaming.",
        epilog="Example: python preprocess.py ml/data/hybrid_training_v2/*.json",
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="One or more JSON training data files to convert (v1/v2 mode).",
    )
    parser.add_argument(
        "--verify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Verify output .pt files after saving (default: True).",
    )
    # V3 arguments
    parser.add_argument(
        "--v3",
        action="store_true",
        help="V3 mode: preprocess round sequences for LSTM",
    )
    parser.add_argument(
        "--data",
        type=str,
        help="Input JSON file path (required for --v3 mode)",
    )
    parser.add_argument(
        "--augment",
        type=int,
        default=5,
        help="Number of suit permutations per sequence (v3, default: 5)",
    )
    parser.add_argument(
        "--filter-players",
        type=str,
        default="the-shark,the-nemesis",
        help="Comma-separated player names to keep (v3, default: 'the-shark,the-nemesis')",
    )
    args = parser.parse_args()

    # V3 mode
    if args.v3:
        if not args.data:
            parser.error("--v3 requires --data <path>")
        preprocess_v3(args)
        return

    # V1/V2 mode
    if not args.files:
        parser.error("positional files required (or use --v3 --data <path>)")

    do_verify = args.verify
    total_start = time.time()
    results = []

    for filepath in args.files:
        try:
            out_path = preprocess_file(filepath)
            if do_verify:
                verify_pt_file(out_path)
            results.append((filepath, out_path, True))
        except Exception as e:
            print(f"\n  ERROR processing {filepath}: {e}", file=sys.stderr)
            results.append((filepath, None, False))

    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY — {len(results)} file(s) in {time.time() - total_start:.1f}s")
    print(f"{'='*60}")
    for filepath, out_path, success in results:
        status = "OK" if success else "FAILED"
        name = os.path.basename(filepath)
        print(f"  [{status}] {name}")

    failed = sum(1 for _, _, s in results if not s)
    if failed:
        print(f"\n{failed} file(s) failed.")
        sys.exit(1)


if __name__ == "__main__":
    from log_utils import setup_logging
    setup_logging("preprocess")
    main()
