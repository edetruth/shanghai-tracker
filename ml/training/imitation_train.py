"""
Supervised imitation training — warm-starts ShanghaiNetV2 from an expert dataset.

Loads (state, action) pairs collected from shark self-play and trains the
policy head via cross-entropy to mimic the shark's action choices. The value
head is left random — PPO fine-tuning will train it later.

Outputs a checkpoint at ml/models/shanghai_imitation.pt that can be loaded
directly by diagnose.py or ppo.py for evaluation / fine-tuning.

Usage:
    python imitation_train.py --dataset expert_shark_2p.npz --epochs 20
    python imitation_train.py --dataset expert_shark_2p.npz --epochs 20 --batch-size 512 --lr 1e-3
"""

import argparse
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import torch.optim as optim

from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS

DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


def train(args):
    data_path = DATA_DIR / args.dataset
    if not data_path.exists():
        raise FileNotFoundError(f"Dataset not found: {data_path}. Run collect_expert_data.py first.")

    print(f"Loading dataset: {data_path}")
    data = np.load(data_path)
    states_np = data["states"]
    actions_np = data["actions"]
    n = len(states_np)
    print(f"  Samples: {n:,}")
    print(f"  State shape: {states_np.shape}")
    print(f"  Action distribution (top 10):")
    counts = np.bincount(actions_np, minlength=MAX_ACTIONS)
    top = sorted(range(MAX_ACTIONS), key=lambda i: -counts[i])[:10]
    for idx in top:
        if counts[idx] == 0:
            break
        label = {0: "draw_pile", 1: "take_discard", 24: "buy", 25: "decline_buy"}.get(idx, f"discard:{idx-2}")
        print(f"    {label:14s} {counts[idx]:7d} ({counts[idx]/n*100:5.1f}%)")
    print()

    # Split train/val
    rng = np.random.default_rng(args.seed)
    perm = rng.permutation(n)
    val_size = max(1, int(n * args.val_frac))
    val_idx = perm[:val_size]
    train_idx = perm[val_size:]
    print(f"  Train: {len(train_idx):,} | Val: {len(val_idx):,}")

    states = torch.from_numpy(states_np)
    actions = torch.from_numpy(actions_np)

    # Class weights to offset the ~70% "discard" dominance — optional but helps
    # the model learn draw/take decisions rather than memorizing "discard:0".
    if args.class_weights:
        class_counts = counts.clip(min=1)
        weights = 1.0 / np.sqrt(class_counts)
        weights = weights / weights.sum() * MAX_ACTIONS
        class_weight_t = torch.from_numpy(weights.astype(np.float32))
        print(f"  Class weighting: ON (inverse-sqrt frequency)")
    else:
        class_weight_t = None
        print(f"  Class weighting: OFF")
    print()

    net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)
    optimizer = optim.Adam(net.parameters(), lr=args.lr)

    best_val_acc = 0.0
    best_path = MODELS_DIR / "shanghai_imitation_best.pt"
    final_path = MODELS_DIR / "shanghai_imitation.pt"

    print(f"Training — epochs={args.epochs}, batch_size={args.batch_size}, lr={args.lr}")
    print()

    for epoch in range(args.epochs):
        t0 = time.time()

        # ── Train ──
        net.train()
        shuffle = torch.from_numpy(rng.permutation(len(train_idx)))
        train_idx_t = torch.from_numpy(train_idx)[shuffle]

        total_loss = 0.0
        total_correct = 0
        total_count = 0

        for i in range(0, len(train_idx_t), args.batch_size):
            batch_idx = train_idx_t[i:i + args.batch_size]
            s = states[batch_idx]
            a = actions[batch_idx]

            policy_logits, _ = net(s)
            loss = F.cross_entropy(policy_logits, a, weight=class_weight_t)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            optimizer.step()

            total_loss += loss.item() * len(batch_idx)
            total_correct += (policy_logits.argmax(1) == a).sum().item()
            total_count += len(batch_idx)

        train_loss = total_loss / total_count
        train_acc = total_correct / total_count

        # ── Validate ──
        net.eval()
        with torch.no_grad():
            val_idx_t = torch.from_numpy(val_idx)
            val_loss_sum = 0.0
            val_correct = 0
            # Batch the val set to avoid OOM on large datasets
            for i in range(0, len(val_idx_t), args.batch_size):
                b = val_idx_t[i:i + args.batch_size]
                vs = states[b]
                va = actions[b]
                vl, _ = net(vs)
                val_loss_sum += F.cross_entropy(vl, va, weight=class_weight_t, reduction="sum").item()
                val_correct += (vl.argmax(1) == va).sum().item()
            val_loss = val_loss_sum / len(val_idx_t)
            val_acc = val_correct / len(val_idx_t)

        elapsed = time.time() - t0

        marker = ""
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(net.state_dict(), best_path)
            marker = " *"

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"train_loss={train_loss:.4f} train_acc={train_acc:.3f} | "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.3f}{marker} | "
            f"{elapsed:.1f}s"
        )

    # Save final model too
    torch.save(net.state_dict(), final_path)

    print()
    print("=" * 60)
    print(f"Training complete")
    print("=" * 60)
    print(f"  Best val accuracy: {best_val_acc:.3f}")
    print(f"  Best checkpoint:   {best_path}")
    print(f"  Final checkpoint:  {final_path}")
    print()
    print("Next: evaluate with diagnose.py")
    print(f"  python diagnose.py --model shanghai_imitation.pt --games 100 --players 2")
    print(f"  (or shanghai_imitation_best.pt for the best-val-acc checkpoint)")


if __name__ == "__main__":
    from log_utils import setup_logging
    setup_logging("imitation_train")

    parser = argparse.ArgumentParser(description="Supervised imitation training from shark expert dataset")
    parser.add_argument("--dataset",       type=str,   default="expert_shark_2p.npz", help="Dataset file in ml/data/")
    parser.add_argument("--epochs",        type=int,   default=20,                    help="Number of training epochs")
    parser.add_argument("--batch-size",    type=int,   default=512,                   help="Mini-batch size")
    parser.add_argument("--lr",            type=float, default=1e-3,                  help="Adam learning rate")
    parser.add_argument("--val-frac",      type=float, default=0.1,                   help="Fraction of data for validation")
    parser.add_argument("--seed",          type=int,   default=42,                    help="Random seed for split + shuffle")
    parser.add_argument("--class-weights", action="store_true",                        help="Use inverse-sqrt class weighting to offset discard dominance")
    args = parser.parse_args()

    print("Shanghai Imitation Training")
    print(f"  Dataset:      {args.dataset}")
    print(f"  Epochs:       {args.epochs}")
    print(f"  Batch size:   {args.batch_size}")
    print(f"  LR:           {args.lr}")
    print(f"  Val fraction: {args.val_frac}")
    print(f"  Seed:         {args.seed}")
    print()

    train(args)
