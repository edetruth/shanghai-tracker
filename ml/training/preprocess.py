"""
preprocess.py — Streaming JSON-to-.pt converter for Shanghai Rummy ML training data.

Converts large JSON training data files into compact PyTorch .pt tensor files
using ijson for memory-efficient streaming. Solves OOM issues with multi-GB files
on machines with limited RAM.

Usage:
    # Single file
    python ml/training/preprocess.py ml/data/hybrid_training_v2/hand_eval_20260403_192200_1000games.json

    # Multiple files
    python ml/training/preprocess.py ml/data/hybrid_training_v2/*.json

    # All v2 data
    python ml/training/preprocess.py ml/data/hybrid_training_v2/hand_eval_*.json ml/data/hybrid_training_v2/buy_*.json

Output:
    Saves .pt file alongside each input JSON with the same base name.
    e.g. hand_eval_20260403_192200_1000games.json -> hand_eval_20260403_192200_1000games.pt
"""

import argparse
import os
import sys
import time
from pathlib import Path

import ijson
import numpy as np
import torch


# Data type definitions: maps type name -> processing config
DATA_TYPES = {
    "hand_eval": {
        "state_dim": 264,
        "opponent_raw_dim": 378,
    },
    "buy": {
        "state_dim": 264,
        "opponent_raw_dim": 378,
    },
    "discard": {
        "state_dim": 264,
        "opponent_raw_dim": 378,
    },
    "draw": {
        "state_dim": 264,
        "opponent_raw_dim": 378,
    },
}


def detect_data_type(filepath: str) -> str:
    """Auto-detect data type from filename prefix."""
    basename = Path(filepath).name
    for dtype in DATA_TYPES:
        if basename.startswith(dtype + "_") or basename == dtype + ".json":
            return dtype
    raise ValueError(
        f"Cannot detect data type from filename '{basename}'. "
        f"Expected prefix: {', '.join(DATA_TYPES.keys())}"
    )


def get_count(filepath: str) -> int:
    """First pass: read the 'count' field from the JSON header."""
    with open(filepath, "rb") as f:
        parser = ijson.items(f, "count")
        for count in parser:
            return int(count)
    raise ValueError(f"No 'count' field found in {filepath}")


def check_has_opponent_raw(filepath: str) -> bool:
    """Check if the first sample has opponent_raw (v2 data)."""
    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for sample in samples:
            return "opponent_raw" in sample
    return False


def process_hand_eval(filepath: str, count: int, has_opponent_raw: bool) -> dict:
    """Stream hand_eval samples into tensors."""
    states = np.empty((count, 264), dtype=np.float32)
    labels = np.empty(count, dtype=np.float32)
    rounds = np.empty(count, dtype=np.int64)
    opponent_raw = np.empty((count, 378), dtype=np.float32) if has_opponent_raw else None

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

    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for i, sample in enumerate(samples):
            states[i] = sample["state"]
            rounds[i] = sample["round"]
            bought[i] = sample["bought"]
            # Keep offered_card as dict for encode_offered_card() at train time
            card = sample["offered_card"]
            offered_cards.append({"rank": int(card["rank"]), "suit": card["suit"]})
            if has_opponent_raw and "opponent_raw" in sample:
                opponent_raw[i] = sample["opponent_raw"]

            if (i + 1) % 50000 == 0:
                print(f"  Processed {i + 1:,}/{count:,} samples...")

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

    with open(filepath, "rb") as f:
        samples = ijson.items(f, "samples.item")
        for i, sample in enumerate(samples):
            states[i] = sample["state"]
            rounds[i] = sample["round"]
            card = sample["offered_card"]
            offered_cards.append({"rank": int(card["rank"]), "suit": card["suit"]})
            if has_opponent_raw and "opponent_raw" in sample:
                opponent_raw[i] = sample["opponent_raw"]

            if (i + 1) % 50000 == 0:
                print(f"  Processed {i + 1:,}/{count:,} samples...")

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

    # Pass 1: get count
    t0 = time.time()
    count = get_count(filepath)
    print(f"  Sample count: {count:,} (read in {time.time() - t0:.1f}s)")

    # Check for opponent_raw (v2 feature)
    has_opponent_raw = check_has_opponent_raw(filepath)
    print(f"  Has opponent_raw: {has_opponent_raw}")

    # Pass 2: stream and fill arrays
    t1 = time.time()
    print(f"  Streaming samples...")
    result = PROCESSORS[dtype](filepath, count, has_opponent_raw)
    elapsed = time.time() - t1
    print(f"  Streamed {count:,} samples in {elapsed:.1f}s ({count / max(elapsed, 0.01):.0f} samples/s)")

    # Save
    t2 = time.time()
    torch.save(result, out_path)
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


def main():
    parser = argparse.ArgumentParser(
        description="Convert JSON training data to compact .pt tensor files via streaming.",
        epilog="Example: python preprocess.py ml/data/hybrid_training_v2/*.json",
    )
    parser.add_argument(
        "files",
        nargs="+",
        help="One or more JSON training data files to convert.",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        default=True,
        help="Verify output .pt files after saving (default: True).",
    )
    parser.add_argument(
        "--no-verify",
        action="store_true",
        help="Skip verification step.",
    )
    args = parser.parse_args()
    do_verify = args.verify and not args.no_verify

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
    main()
