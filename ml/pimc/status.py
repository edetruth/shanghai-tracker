"""
Quick pipeline status — paste this output to Claude for analysis.

Usage:
    cd ml/pimc
    python status.py
    python status.py --full     # show all log entries, not just last 5
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).parent
LOG_FILE = HERE / "pipeline_log.jsonl"
CONFIG_FILE = HERE / "pipeline_config.json"
STOP_FLAG = HERE / "pipeline_stop.flag"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()

    print("=" * 55)
    print("PIPELINE STATUS")
    print("=" * 55)

    # Config
    try:
        config = json.loads(CONFIG_FILE.read_text())
        action = config.get("action", "?")
        print(f"Current action : {action}")
        if action == "sequence":
            seq = config.get("sequence", [])
            step = config.get("current_step", 0)
            print(f"Sequence       : step {step}/{len(seq)}", end="")
            if step < len(seq):
                print(f" → next: {seq[step]}", end="")
            print()
            for i, s in enumerate(seq):
                marker = "✓" if i < step else ("▶" if i == step else "·")
                print(f"  {marker} {i+1}. {s}")
        else:
            action_cfg = config.get(action, {})
            if action_cfg:
                for k, v in action_cfg.items():
                    print(f"  {k}: {v}")
    except FileNotFoundError:
        print("Config file not found.")

    # Stop flag
    if STOP_FLAG.exists():
        print("Stop flag      : SET (pipeline will exit after current step)")

    print()

    # Log
    if not LOG_FILE.exists():
        print("No log entries yet — pipeline hasn't completed a step.")
        return

    entries = []
    with LOG_FILE.open() as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    if not entries:
        print("Log file is empty.")
        return

    show = entries if args.full else entries[-5:]
    print(f"Recent log ({len(show)} of {len(entries)} total):")
    print("-" * 55)

    for e in show:
        action = e.get("action", "?")
        ts = e.get("ts", "?")
        iteration = e.get("iteration", "?")
        line = f"  [{ts}] iter={iteration} action={action}"

        if action in ("quick_eval", "bridge_eval"):
            avg = e.get("avg_score")
            wr = e.get("win_rate")
            model = e.get("model", "?")
            avg_str = f"{avg:.1f}" if avg is not None else "?"
            wr_str = f"{wr*100:.1f}%" if wr is not None else "?"
            line += f"  model={Path(model).name}  avg={avg_str}  wr={wr_str}"

        elif action == "collect":
            games = e.get("games", "?")
            rollouts = e.get("rollouts", "?")
            rc = e.get("exit_code", "?")
            line += f"  games={games}  rollouts={rollouts}  exit={rc}"

        elif action == "train":
            val = e.get("val_acc")
            val_str = f"{val:.4f}" if val is not None else "?"
            line += f"  val_acc={val_str}  exit={e.get('exit_code', '?')}"

        elif action == "idle":
            line += f"  waited={e.get('waited_seconds', '?')}s"

        print(line)

    print("-" * 55)

    # Summary of best result
    eval_entries = [e for e in entries if e.get("action") in ("quick_eval", "bridge_eval") and e.get("avg_score") is not None]
    if eval_entries:
        best = min(eval_entries, key=lambda e: e["avg_score"])
        print(f"\nBest result so far: avg={best['avg_score']:.1f}  wr={best.get('win_rate', 0)*100:.1f}%  [{best['action']} iter={best['iteration']}]")

    print("=" * 55)


if __name__ == "__main__":
    main()
