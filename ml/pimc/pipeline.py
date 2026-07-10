"""
Autonomous training pipeline for Shanghai Rummy ML.

Reads pipeline_config.json at the start of every iteration — edit that file
to redirect the pipeline without restarting it.

Stop signal: create a file named pipeline_stop.flag in this directory.
Pipeline exits cleanly after the current step finishes.

Usage:
    cd ml/pimc
    python pipeline.py            # production run (reads config)
    python pipeline.py --test     # quick demo: tiny jobs, fast cycles
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
LOG_FILE = HERE / "pipeline_log.jsonl"
CONFIG_FILE = HERE / "pipeline_config.json"
STOP_FLAG = HERE / "pipeline_stop.flag"


# ── Logging ───────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str) -> None:
    print(f"[{_ts()}] {msg}", flush=True)


def log_result(action: str, iteration: int, result: dict) -> None:
    record = {"ts": _ts(), "iteration": iteration, "action": action, **result}
    with LOG_FILE.open("a") as f:
        f.write(json.dumps(record) + "\n")
    # Print a compact summary (skip raw_tail)
    summary = {k: v for k, v in result.items() if k != "raw_tail"}
    log(f"  -> {summary}")


# ── Config ────────────────────────────────────────────────────────────────────

def read_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception as e:
        log(f"ERROR reading config: {e}")
        return {"action": "idle"}


def save_config(config: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


# ── Health check ──────────────────────────────────────────────────────────────

def check_training_health(save_dir: str, cfg: dict) -> dict:
    """
    Read the runner's training_log.jsonl and check for collapse signals.

    Returns dict with keys:
        ok (bool), reason (str), latest_entropy, latest_avg100, baseline_avg100
    """
    log_path = HERE / save_dir / "training_log.jsonl"
    if not log_path.exists():
        return {"ok": True, "reason": "no log yet"}

    entries = []
    with log_path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    if len(entries) < 2:
        return {"ok": True, "reason": "too few entries to judge"}

    latest = entries[-1]
    latest_entropy = latest.get("entropy")
    latest_avg100 = latest.get("avg100")

    # Use baseline from config (set on first batch), or first entry
    baseline = cfg.get("baseline_avg100") or entries[0].get("avg100", 999)

    entropy_min = cfg.get("entropy_min", 0.85)
    avg100_max_increase = cfg.get("avg100_max_increase", 25)

    reasons = []
    if latest_entropy is not None and latest_entropy < entropy_min:
        reasons.append(f"entropy collapsed ({latest_entropy:.3f} < {entropy_min})")
    if latest_avg100 is not None and latest_avg100 > baseline + avg100_max_increase:
        reasons.append(f"avg100 degraded ({latest_avg100:.1f} > baseline {baseline:.1f} + {avg100_max_increase})")

    return {
        "ok": len(reasons) == 0,
        "reason": "; ".join(reasons) if reasons else "healthy",
        "latest_entropy": latest_entropy,
        "latest_avg100": latest_avg100,
        "baseline_avg100": baseline,
    }


# ── Steps ─────────────────────────────────────────────────────────────────────

def run_quick_eval(cfg: dict, test: bool = False) -> dict:
    model = cfg.get("model", "network_v7.pt")
    games = 20 if test else cfg.get("games", 200)
    args = [sys.executable, str(HERE / "evaluate_network.py"), "--model", model, "--games", str(games)]
    if cfg.get("discard_only", True):
        args.append("--discard-only")
    log(f"  quick_eval: {model} x{games} games")
    result = subprocess.run(args, capture_output=True, text=True, cwd=str(HERE))
    output = result.stdout + result.stderr
    avg_score, win_rate = _parse_eval_output(output)
    return {"model": model, "games": games, "avg_score": avg_score, "win_rate": win_rate, "raw_tail": output[-400:]}


def run_bridge_eval(cfg: dict) -> dict:
    model = cfg.get("model", "network_v7.pt")
    games = cfg.get("games", 30)
    opponent = cfg.get("opponent", "the-mastermind")
    args = [sys.executable, str(HERE / "network_bridge_eval.py"), "--model", model, "--games", str(games), "--opponent", opponent]
    log(f"  bridge_eval: {model} vs {opponent} x{games} games")
    result = subprocess.run(args, capture_output=True, text=True, cwd=str(HERE))
    output = result.stdout + result.stderr
    avg_score, win_rate = _parse_eval_output(output)
    return {"model": model, "games": games, "opponent": opponent, "avg_score": avg_score, "win_rate": win_rate, "raw_tail": output[-600:]}


def run_self_play_batch(cfg: dict, test: bool = False) -> dict:
    """
    Run one batch of self_play, then return. Health is checked by caller.
    Batch size: cfg['batch_iterations'] (default 200, or 5 in test mode).
    """
    batch = 5 if test else cfg.get("batch_iterations", 200)
    save_dir = cfg.get("save_dir", "alphazero/checkpoints_run")
    games_per_iter = 4 if test else cfg.get("games_per_iter", 32)
    lr = cfg.get("lr", 1e-4)

    bridge_workers  = cfg.get("bridge_workers", 0)
    bridge_opponent = cfg.get("bridge_opponent", "the-mastermind")

    args = [
        sys.executable, "-m", "alphazero.runner",
        "--save-dir", save_dir,
        "--iterations", str(batch),
        "--games-per-iter", str(games_per_iter),
        "--lr", str(lr),
    ]

    if bridge_workers > 0:
        args += ["--bridge-workers", str(bridge_workers), "--bridge-opponent", bridge_opponent]

    resume = cfg.get("resume", False)
    from_ckpt = cfg.get("from_checkpoint")
    warm_start = cfg.get("warm_start")

    if resume:
        args.append("--resume")
    elif from_ckpt:
        args += ["--from-checkpoint", from_ckpt]
    elif warm_start:
        args += ["--warm-start", warm_start]

    iterations_done = cfg.get("iterations_done", 0)
    log(f"  self_play batch: iters {iterations_done + 1}-{iterations_done + batch} x {games_per_iter} games -> {save_dir}")

    result = subprocess.run(args, cwd=str(HERE))  # streams to terminal

    best_src = HERE / save_dir / "best.pt"
    if result.returncode == 0 and best_src.exists():
        best_copy = HERE / "models" / "vacation_best.pt"
        shutil.copy2(best_src, best_copy)

    return {
        "save_dir": save_dir,
        "batch_iterations": batch,
        "iterations_done": iterations_done + batch if result.returncode == 0 else iterations_done,
        "exit_code": result.returncode,
    }


def run_collect(cfg: dict, test: bool = False) -> dict:
    games = 5 if test else cfg.get("games", 1000)
    rollouts = 1 if test else cfg.get("rollouts", 20)
    args = [sys.executable, str(HERE / "collect_data_v2.py"), "--games", str(games), "--rollouts", str(rollouts)]
    if cfg.get("opponent_model"):
        args += ["--opponent-model", cfg["opponent_model"]]
    if cfg.get("resume") and not test:
        args.append("--resume")
    log(f"  collect: {games} games x{rollouts} rollouts")
    result = subprocess.run(args, capture_output=True, text=True, cwd=str(HERE))
    return {"games": games, "rollouts": rollouts, "exit_code": result.returncode, "raw_tail": (result.stdout + result.stderr)[-400:]}


def run_idle(seconds: int = 60) -> dict:
    log(f"  idle: waiting {seconds}s...")
    time.sleep(seconds)
    return {"waited_seconds": seconds}


# ── Output parsers ────────────────────────────────────────────────────────────

def _parse_eval_output(text: str) -> tuple[float | None, float | None]:
    avg_score = win_rate = None
    for line in text.splitlines():
        low = line.lower()
        if "avg" in low and "score" in low:
            for token in line.split():
                try:
                    avg_score = float(token.replace(",", "")); break
                except ValueError:
                    continue
        if "win rate" in low or "win_rate" in low:
            for token in line.split():
                try:
                    v = float(token.strip("%"))
                    win_rate = v if v <= 1.0 else v / 100.0; break
                except ValueError:
                    continue
    return avg_score, win_rate


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()

    log("=== PIPELINE STARTED (test mode) ===" if args.test else "=== PIPELINE STARTED ===")
    log(f"Config: {CONFIG_FILE}  |  Log: {LOG_FILE}  |  Stop: create {STOP_FLAG.name}\n")

    iteration = 0
    while True:
        iteration += 1

        if STOP_FLAG.exists():
            log(f"Stop flag detected — exiting cleanly.")
            STOP_FLAG.unlink()
            break

        config = read_config()
        action = config.get("action", "idle")
        log(f"--- Iteration {iteration} | action={action} ---")

        # ── self_play (batched + watchdog) ────────────────────────────────────
        if action == "self_play":
            sp_cfg = config.get("self_play", {})
            total = sp_cfg.get("total_iterations", 8000)
            done = sp_cfg.get("iterations_done", 0)

            if done >= total:
                log(f"  self_play complete ({done}/{total} iters) — switching to bridge_eval.")
                config["action"] = "bridge_eval"
                config["bridge_eval"]["model"] = "vacation_best.pt"
                save_config(config)
            else:
                result = run_self_play_batch(sp_cfg, test=args.test)
                log_result("self_play", iteration, result)

                if result["exit_code"] != 0:
                    log("  self_play batch failed — retrying after 30s.")
                    time.sleep(30)
                else:
                    # Update iterations_done and switch to resume
                    config["self_play"]["iterations_done"] = result["iterations_done"]
                    config["self_play"]["resume"] = True
                    config["self_play"].pop("from_checkpoint", None)
                    config["self_play"].pop("warm_start", None)

                    # Set baseline on first successful batch
                    health_cfg = config["self_play"].setdefault("health", {})
                    health = check_training_health(sp_cfg.get("save_dir", "alphazero/checkpoints_run"), health_cfg)
                    if health_cfg.get("baseline_avg100") is None and health.get("latest_avg100"):
                        config["self_play"]["health"]["baseline_avg100"] = health["latest_avg100"]

                    _ent = health.get('latest_entropy')
                    _a100 = health.get('latest_avg100')
                    log(f"  health: {health['reason']}  entropy={_ent:.3f if _ent is not None else '?'}  avg100={_a100:.1f if _a100 is not None else '?'}")

                    if not health["ok"]:
                        log(f"  !! WATCHDOG triggered — switching to bridge_eval of best.pt")
                        config["action"] = "bridge_eval"
                        config["bridge_eval"]["model"] = "vacation_best.pt"

                    save_config(config)

        # ── bridge_eval ───────────────────────────────────────────────────────
        elif action == "bridge_eval":
            result = run_bridge_eval(config.get("bridge_eval", {}))
            log_result("bridge_eval", iteration, result)
            if result.get("avg_score") is not None:
                log(f"  bridge_eval done: avg={result['avg_score']}  wr={result.get('win_rate', '?')}")
                config["action"] = "idle"
                save_config(config)
            else:
                log("  bridge_eval returned no score — retrying.")

        # ── quick_eval ────────────────────────────────────────────────────────
        elif action == "quick_eval":
            result = run_quick_eval(config.get("quick_eval", {}), test=args.test)
            log_result("quick_eval", iteration, result)

        # ── collect ───────────────────────────────────────────────────────────
        elif action == "collect":
            result = run_collect(config.get("collect", {}), test=args.test)
            log_result("collect", iteration, result)

        # ── idle ──────────────────────────────────────────────────────────────
        elif action == "idle":
            result = run_idle(30 if args.test else 60)
            log_result("idle", iteration, result)

        else:
            log(f"Unknown action '{action}' — idling 30s.")
            time.sleep(30)

        log(f"--- Iteration {iteration} complete. Re-reading config...\n")


if __name__ == "__main__":
    main()
