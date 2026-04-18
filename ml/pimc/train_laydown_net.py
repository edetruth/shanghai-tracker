"""
Train LaydownNet binary classifier on lay-down timing data.

Input:  ml/pimc/data_laydown/  (NPZ chunks from collect_laydown_data.py)
Output: ml/pimc/models/laydown_net.pt

Usage:
    python train_laydown_net.py
    python train_laydown_net.py --epochs 50
    python train_laydown_net.py --data-dir data_laydown_custom
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

_HERE     = Path(__file__).parent
MODEL_DIR = _HERE / "models"

if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


def load_dataset(data_dir: Path):
    """Load all NPZ chunks. Returns (states, labels, rounds) numpy arrays."""
    chunks = sorted(data_dir.glob("chunk_*.npz"))
    if not chunks:
        raise FileNotFoundError(f"No chunks found in {data_dir}")

    states_list, labels_list, rounds_list = [], [], []
    for p in chunks:
        d = np.load(p)
        states_list.append(d["states"])
        labels_list.append(d["labels"])
        rounds_list.append(d["round_idx"])

    states = np.concatenate(states_list, axis=0)
    labels = np.concatenate(labels_list, axis=0).astype(np.int8)
    rounds = np.concatenate(rounds_list, axis=0).astype(np.int8)

    n_pos = int((labels == 1).sum())
    n_neg = int((labels == 0).sum())
    print(f"  Loaded {len(states):,} records from {len(chunks)} chunks")
    print(f"  Label 1 (lay down now): {n_pos:,}  ({n_pos/len(labels):.1%})")
    print(f"  Label 0 (wait)        : {n_neg:,}  ({n_neg/len(labels):.1%})")
    return states, labels, rounds


def train(args) -> None:
    from laydown_net import LaydownNet, LAYDOWN_STATE_DIM

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    data_dir = _HERE / args.data_dir
    out_path = MODEL_DIR / args.out

    print(f"Loading dataset from {data_dir} ...")
    t0                      = time.perf_counter()
    states, labels, rounds  = load_dataset(data_dir)
    print(f"  Loaded in {time.perf_counter() - t0:.1f}s\n")

    # Train / val split (90/10)
    rng    = torch.Generator().manual_seed(args.seed)
    n      = len(states)
    idx    = torch.randperm(n, generator=rng)
    n_val  = int(n * 0.1)
    val_idx, train_idx = idx[:n_val], idx[n_val:]

    s_t = torch.from_numpy(states).float()
    l_t = torch.from_numpy(labels.astype(np.float32))   # BCE expects float
    r_t = torch.from_numpy(rounds.astype(np.int64))

    train_ds = TensorDataset(s_t[train_idx], l_t[train_idx], r_t[train_idx])
    val_ds   = TensorDataset(s_t[val_idx],   l_t[val_idx],   r_t[val_idx])

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,  num_workers=0)
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False, num_workers=0)

    # Class imbalance: weight the loss so both classes contribute equally
    n_pos      = float((labels == 1).sum())
    n_neg      = float((labels == 0).sum())
    pos_weight = torch.tensor([n_neg / max(n_pos, 1)])   # scalar tensor

    model    = LaydownNet(input_dim=LAYDOWN_STATE_DIM, hidden=args.hidden)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model: LaydownNet  params={n_params:,}  hidden={args.hidden}")
    print(f"  pos_weight={pos_weight.item():.3f}  (neg/pos ratio)")

    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.01
    )

    best_val_loss = float("inf")
    patience_left = args.patience

    print(f"\n{'Epoch':>5} {'TrLoss':>8} {'TrAcc':>8} {'VaLoss':>8} {'VaAcc':>8}")
    print("-" * 46)

    for epoch in range(1, args.epochs + 1):
        model.train()
        tr_loss = tr_acc_sum = tr_n = 0.0

        for states_b, labels_b, _ in train_loader:
            logits = model(states_b)
            loss   = criterion(logits, labels_b)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            preds       = (logits > 0).float()
            b           = states_b.shape[0]
            tr_loss    += loss.item()
            tr_acc_sum += (preds == labels_b).float().mean().item() * b
            tr_n       += b

        scheduler.step()

        # Validation
        model.eval()
        va_loss = va_acc_sum = va_n = 0.0
        with torch.no_grad():
            for states_b, labels_b, _ in val_loader:
                logits      = model(states_b)
                loss        = criterion(logits, labels_b)
                preds       = (logits > 0).float()
                b           = states_b.shape[0]
                va_loss    += loss.item()
                va_acc_sum += (preds == labels_b).float().mean().item() * b
                va_n       += b

        tr_loss_avg = tr_loss / len(train_loader)
        va_loss_avg = va_loss / len(val_loader)
        tr_acc      = tr_acc_sum / tr_n
        va_acc      = va_acc_sum / va_n
        print(f"{epoch:5d} {tr_loss_avg:8.4f} {tr_acc:8.3%} {va_loss_avg:8.4f} {va_acc:8.3%}")

        if va_loss_avg < best_val_loss:
            best_val_loss  = va_loss_avg
            patience_left  = args.patience
            torch.save(model.state_dict(), out_path)
            print(f"  -> saved (val_loss={best_val_loss:.4f}  acc={va_acc:.1%})")
        else:
            patience_left -= 1
            if patience_left <= 0:
                print(f"  Early stop (patience={args.patience})")
                break

    print(f"\nBest model: val_loss={best_val_loss:.4f}")
    print(f"Saved: {out_path}")

    # Per-round accuracy breakdown
    print("\nPer-round val accuracy (best model):")
    saved_state = torch.load(out_path, map_location="cpu", weights_only=True)
    model.load_state_dict(saved_state)
    model.eval()
    round_stats: dict = {}
    with torch.no_grad():
        for states_b, labels_b, rounds_b in val_loader:
            logits  = model(states_b)
            preds   = (logits > 0).float()
            correct = (preds == labels_b).float()
            for i in range(len(rounds_b)):
                ri = int(rounds_b[i].item())
                if ri not in round_stats:
                    round_stats[ri] = [0, 0]
                round_stats[ri][0] += correct[i].item()
                round_stats[ri][1] += 1

    print(f"   {'Round':>8}  {'Acc':>8}  {'N':>8}")
    for ri in sorted(round_stats):
        corr, total_r = round_stats[ri]
        print(f"  Round {ri+1:2d}:  {corr/total_r:6.1%}  ({total_r:5d})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train LaydownNet")
    parser.add_argument("--data-dir",   type=str,   default="data_laydown")
    parser.add_argument("--out",        type=str,   default="laydown_net.pt")
    parser.add_argument("--epochs",     type=int,   default=30)
    parser.add_argument("--batch-size", type=int,   default=512)
    parser.add_argument("--hidden",     type=int,   default=128)
    parser.add_argument("--lr",         type=float, default=3e-4)
    parser.add_argument("--patience",   type=int,   default=8)
    parser.add_argument("--seed",       type=int,   default=42)
    args = parser.parse_args()

    train(args)


if __name__ == "__main__":
    main()
