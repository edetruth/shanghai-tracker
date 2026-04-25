"""
AlphaZero-lite training loop for Shanghai Rummy.

train_iteration() — one step: collect → label → batch → loss → update
run_training()    — full training with opponent pool + checkpointing

Usage
-----
    cd ml/pimc
    python -m alphazero.runner \\
        --warm-start models/network_v7.pt \\
        --save-dir alphazero/checkpoints \\
        --iterations 2000 \\
        --games-per-iter 32 \\
        --lr 1e-4

    # Resume after interruption
    python -m alphazero.runner \\
        --warm-start models/network_v7.pt \\
        --save-dir alphazero/checkpoints \\
        --iterations 2000 \\
        --games-per-iter 32 \\
        --resume

The warm-started checkpoint is optional; if omitted, training starts from
a randomly initialised ShanghaiNet.
"""
from __future__ import annotations

import copy
import json
import random
import sys
import time
from pathlib import Path
from typing import List, Optional

import torch
import torch.optim as optim

_PIMC_DIR = Path(__file__).parent.parent
if str(_PIMC_DIR) not in sys.path:
    sys.path.insert(0, str(_PIMC_DIR))

from alphazero.network       import ShanghaiNet
from alphazero.self_play     import collect_games
from alphazero.value_labeler  import label_values
from alphazero.train         import build_batch, compute_losses


def train_iteration(
    model: ShanghaiNet,
    optimizer: torch.optim.Optimizer,
    opponent_pool: List[ShanghaiNet],
    pimc_pool: Optional[List[ShanghaiNet]] = None,
    pimc_ratio: float = 0.0,
    n_games: int = 16,
    temperature: float = 1.0,
    entropy_coef: float = 0.05,
    seed: Optional[int] = None,
) -> dict:
    """
    One training iteration.

    1. Collect n_games self-play games (player 0 = model, others = pool)
    2. Label each step with value_label = final_score
    3. Flatten steps → batch
    4. Forward + loss + backward + clip + step

    collect_games() sets model to eval(); we switch back to train() before
    the gradient update.

    Returns:
        dict with float values: policy_loss, value_loss, entropy,
        total_loss, avg_score, n_steps.
    """
    trajectories = collect_games(
        model, n_games, opponent_pool,
        pimc_pool=pimc_pool, pimc_ratio=pimc_ratio,
        temperature=temperature, seed=seed,
    )
    label_values(trajectories)

    all_steps = [step for t in trajectories for step in t["steps"]]
    if not all_steps:
        return {"policy_loss": 0.0, "value_loss": 0.0,
                "entropy": 0.0, "total_loss": 0.0,
                "avg_score": 0.0, "n_steps": 0}

    batch = build_batch(all_steps)
    model.train()
    optimizer.zero_grad()
    losses = compute_losses(model, batch, entropy_coef=entropy_coef)
    losses["total_loss"].backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()

    avg_score = sum(t["final_score"] for t in trajectories) / len(trajectories)
    return {
        **{k: v.item() for k, v in losses.items()},
        "avg_score": avg_score,
        "n_steps":   len(all_steps),
    }


def _temperature_for(iteration: int, total: int) -> float:
    """Three-phase schedule: 1.0 → 0.5 → 0.2."""
    phase = iteration / max(total, 1)
    if phase < 1 / 3:
        return 1.0
    if phase < 2 / 3:
        return 0.5
    return 0.2


def _frozen_copy(model: ShanghaiNet) -> ShanghaiNet:
    snap = copy.deepcopy(model)
    snap.eval()
    return snap


def run_training(
    warm_start: Optional[str] = None,
    from_checkpoint: Optional[str] = None,
    pimc_checkpoint: Optional[str] = None,
    pimc_ratio: float = 0.33,
    save_dir: str = "alphazero/checkpoints",
    n_iterations: int = 1000,
    games_per_iter: int = 16,
    pool_size: int = 5,
    pool_every: int = 10,
    lr: float = 1e-4,
    entropy_coef: float = 0.05,
    save_every: int = 50,
    log_every: int = 10,
    seed: Optional[int] = None,
    resume: bool = False,
) -> None:
    """
    Full training loop.

    Opponent pool: updated every `pool_every` iterations with a frozen
    snapshot of the current model.  Keeps the last `pool_size` snapshots.
    This is separate from checkpointing (save_every) so the pool diversifies
    quickly even with infrequent saves.

    Checkpoints saved as:
        <save_dir>/ckpt_<iteration>.pt  — state dict only
        <save_dir>/best.pt              — lowest avg100 so far
        <save_dir>/training_log.jsonl   — one JSON line per logged iteration

    Resume: if --resume is passed, the latest ckpt_*.pt is loaded and
    training continues from the next iteration.

    from_checkpoint: load a raw state-dict .pt file (not PIMC format).
    Use this to restart from best.pt after a divergence without --resume
    picking up the bad latest checkpoint.
    """
    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)
    log_file  = save_path / "training_log.jsonl"

    rng = random.Random(seed)

    if resume and from_checkpoint:
        print("[WARN] --resume and --from-checkpoint both set; "
              "--resume will overwrite --from-checkpoint weights with latest ckpt_*.pt")

    # ── Model ────────────────────────────────────────────────────────
    if from_checkpoint:
        model = ShanghaiNet()
        model.load_state_dict(
            torch.load(from_checkpoint, map_location="cpu", weights_only=True)
        )
        print(f"Loaded checkpoint {from_checkpoint}")
    elif warm_start:
        model = ShanghaiNet.from_pimc_checkpoint(warm_start)
        print(f"Warm-started from {warm_start}")
    else:
        model = ShanghaiNet()
        print("Starting from random initialisation")

    # ── PIMC opponent pool ────────────────────────────────────────────
    pimc_pool: List[ShanghaiNet] = []
    if pimc_checkpoint:
        _pimc = ShanghaiNet.from_pimc_checkpoint(pimc_checkpoint)
        pimc_pool = [_frozen_copy(_pimc)]
        print(f"PIMC opponents loaded from {pimc_checkpoint} (ratio={pimc_ratio:.0%})")
    else:
        pimc_ratio = 0.0

    optimizer = optim.Adam(model.parameters(), lr=lr)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=20, min_lr=1e-6
    )

    # ── Resume ───────────────────────────────────────────────────────
    start_iteration = 1
    history: List[float] = []
    if resume:
        ckpts = sorted(save_path.glob("ckpt_*.pt"))
        if ckpts:
            latest = ckpts[-1]
            model.load_state_dict(
                torch.load(latest, map_location="cpu", weights_only=True)
            )
            start_iteration = int(latest.stem.split("_")[1]) + 1
            print(f"Resumed from {latest.name} — continuing at iteration {start_iteration}")
            # Rebuild history from log so avg100 is meaningful
            if log_file.exists():
                with open(log_file) as f:
                    for line in f:
                        try:
                            history.append(json.loads(line)["avg_score"])
                        except (KeyError, json.JSONDecodeError):
                            pass
        else:
            print("--resume: no checkpoints found, starting fresh")

    # ── Opponent pool — starts with a snapshot of the initial model ──
    opponent_pool: List[ShanghaiNet] = [_frozen_copy(model)]

    # Restore best_avg_score from log so --resume doesn't overwrite a better best.pt
    best_avg_score = float("inf")
    if resume and log_file.exists():
        with open(log_file) as f:
            for line in f:
                try:
                    best_avg_score = min(best_avg_score, json.loads(line)["avg100"])
                except (KeyError, json.JSONDecodeError):
                    pass

    print(f"Training: {n_iterations} iters, {games_per_iter} games/iter, "
          f"pool_size={pool_size}, pool_every={pool_every}, lr={lr}")
    print()

    for iteration in range(start_iteration, n_iterations + 1):
        temperature = _temperature_for(iteration, n_iterations)
        iter_seed   = rng.randint(0, 2 ** 31)
        t0          = time.time()

        stats = train_iteration(
            model, optimizer, opponent_pool,
            pimc_pool=pimc_pool, pimc_ratio=pimc_ratio,
            n_games=games_per_iter,
            temperature=temperature,
            entropy_coef=entropy_coef,
            seed=iter_seed,
        )
        elapsed = time.time() - t0
        history.append(stats["avg_score"])

        # ── LR schedule + health checks ──────────────────────────────
        scheduler.step(stats["value_loss"])
        if stats["entropy"] < 0.3 and stats["n_steps"] > 0:
            current_lr = optimizer.param_groups[0]["lr"]
            print(f"  [WARN] entropy={stats['entropy']:.4f} < 0.3 — policy collapsing  "
                  f"(iter={iteration}, lr={current_lr:.2e})")

        # ── Opponent pool update ─────────────────────────────────────
        if iteration % pool_every == 0:
            opponent_pool.append(_frozen_copy(model))
            if len(opponent_pool) > pool_size:
                opponent_pool.pop(0)

        # ── Logging ─────────────────────────────────────────────────
        if iteration % log_every == 0 or iteration == start_iteration:
            avg100 = sum(history[-100:]) / len(history[-100:])
            current_lr = optimizer.param_groups[0]["lr"]
            row = {
                "iteration":   iteration,
                "temperature": temperature,
                **stats,
                "avg100":      avg100,
                "lr":          current_lr,
                "pimc_ratio":  pimc_ratio,
                "elapsed_s":   round(elapsed, 2),
            }
            with open(log_file, "a") as f:
                f.write(json.dumps(row) + "\n")
            print(
                f"[{iteration:5d}] temp={temperature:.1f}  "
                f"avg_score={stats['avg_score']:7.1f}  "
                f"avg100={avg100:7.1f}  "
                f"policy={stats['policy_loss']:8.4f}  "
                f"value={stats['value_loss']:8.4f}  "
                f"entropy={stats['entropy']:.4f}  "
                f"lr={current_lr:.1e}  "
                f"steps={stats['n_steps']:4d}  "
                f"({elapsed:.1f}s)"
            )

        # ── Checkpoint ──────────────────────────────────────────────
        if iteration % save_every == 0:
            ckpt_path = save_path / f"ckpt_{iteration:05d}.pt"
            torch.save(model.state_dict(), ckpt_path)

            avg100 = sum(history[-100:]) / len(history[-100:])
            if avg100 < best_avg_score:
                best_avg_score = avg100
                torch.save(model.state_dict(), save_path / "best.pt")
                print(f"  => New best: avg100={avg100:.1f} -> best.pt")
            else:
                print(f"  => Checkpoint saved: {ckpt_path.name}")

    torch.save(model.state_dict(), save_path / "final.pt")
    print(f"\nTraining complete. Final model: {save_path / 'final.pt'}")
    print(f"Best avg100 score: {best_avg_score:.1f}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AlphaZero-lite training for Shanghai Rummy")
    parser.add_argument("--warm-start",     default=None,                  help="PIMC checkpoint to warm-start from")
    parser.add_argument("--save-dir",       default="alphazero/checkpoints")
    parser.add_argument("--iterations",     type=int,   default=1000)
    parser.add_argument("--games-per-iter", type=int,   default=16)
    parser.add_argument("--pool-size",      type=int,   default=5)
    parser.add_argument("--pool-every",     type=int,   default=10,         help="Add pool snapshot every N iters")
    parser.add_argument("--lr",              type=float, default=1e-4)
    parser.add_argument("--entropy-coef",    type=float, default=0.05)
    parser.add_argument("--save-every",      type=int,   default=50)
    parser.add_argument("--log-every",       type=int,   default=10)
    parser.add_argument("--seed",            type=int,   default=None)
    parser.add_argument("--resume",          action="store_true",           help="Resume from latest checkpoint in save-dir")
    parser.add_argument("--from-checkpoint", default=None,                  help="Load raw state-dict .pt (bypasses PIMC format)")
    parser.add_argument("--pimc-pool",       default=None,                  help="PIMC checkpoint to use as fixed opponent pool")
    parser.add_argument("--pimc-ratio",      type=float, default=0.33,      help="Fraction of opponent slots filled by PIMC (default 0.33)")
    args = parser.parse_args()

    run_training(
        warm_start      = args.warm_start,
        from_checkpoint = args.from_checkpoint,
        pimc_checkpoint = args.pimc_pool,
        pimc_ratio      = args.pimc_ratio,
        save_dir        = args.save_dir,
        n_iterations    = args.iterations,
        games_per_iter  = args.games_per_iter,
        pool_size       = args.pool_size,
        pool_every      = args.pool_every,
        lr              = args.lr,
        entropy_coef    = args.entropy_coef,
        save_every      = args.save_every,
        log_every       = args.log_every,
        seed            = args.seed,
        resume          = args.resume,
    )
