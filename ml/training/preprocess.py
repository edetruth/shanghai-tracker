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
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Verify output .pt files after saving (default: True).",
    )
    args = parser.parse_args()
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
