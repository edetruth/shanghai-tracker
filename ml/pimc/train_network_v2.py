"""
Train discard-only PIMCNet on self-play data (data_v2/).

Key differences from train_network.py (v1):
  - PIMCDiscardNet: discard head only — no draw head
  - Filters dataset to discard records (type==0)
  - Trains on data_v2/ by default (--data-dir to override)
  - Saves to models/network_v2.pt
  - Draw head was proven harmful in bridge eval (−18.7 pts vs Mastermind)

Usage:
    python train_network_v2.py                         # 30 epochs, data_v2/
    python train_network_v2.py --epochs 50             # longer run
    python train_network_v2.py --data-dir data          # retrain on v1 data (baseline)
    python train_network_v2.py --validate-only          # eval saved model on val set
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset

# ── Paths ─────────────────────────────────────────────────────────
_HERE     = Path(__file__).parent
MODEL_DIR = _HERE / "models"


# ── Model ─────────────────────────────────────────────────────────

class PIMCDiscardNet(nn.Module):
    """
    Discard + draw MLP that approximates PIMC decisions.

    Identical backbone to PIMCNet (v1).
    Discard head: logits over 53 card types — argmax masked to hand cards.
    Draw head:    single logit — sigmoid > 0.5 means take from discard pile.

    Co-training draw and discard is required: a discard-only policy trained
    without draw labels assumes "always draw from pile" and degrades when a
    draw heuristic is added post-hoc (distribution shift).
    """

    def __init__(self, state_dim: int = 170, hidden: int = 256, dropout: float = 0.1):
        super().__init__()
        self.backbone = nn.Sequential(
            nn.Linear(state_dim, hidden),
            nn.LayerNorm(hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden),
            nn.LayerNorm(hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden),
            nn.LayerNorm(hidden),
            nn.ReLU(),
        )
        self.discard_head = nn.Linear(hidden, 53)
        self.draw_head    = nn.Linear(hidden, 1)   # binary: 1=take, 0=draw_pile

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (B, 170) float32
        Returns:
            discard_logits: (B, 53)
        """
        return self.discard_head(self.backbone(x))

    @torch.no_grad()
    def predict_discard(self, state: torch.Tensor) -> torch.Tensor:
        """
        Return the recommended discard card type index for each sample.
        Masks logits to only cards present in hand (state[0:53] > 0).
        Jokers (type 52) are never discarded.

        Args:
            state: (B, 170) or (170,) float32
        Returns:
            (B,) or scalar int64 card type indices
        """
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)
        logits    = self.forward(state)
        hand_mask = (state[:, :53] > 0).clone()
        hand_mask[:, 52] = False    # never discard joker
        logits = logits.masked_fill(~hand_mask, float('-inf'))
        result = logits.argmax(dim=1)
        return result.squeeze(0) if single else result

    @torch.no_grad()
    def predict_draw(self, state: torch.Tensor) -> torch.Tensor:
        """
        Return 1 (take discard) or 0 (draw from pile) for each sample.

        Args:
            state: (B, 170) or (170,) float32
        Returns:
            (B,) or scalar int64
        """
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)
        feat   = self.backbone(state)
        logit  = self.draw_head(feat).squeeze(-1)   # (B,)
        result = (logit > 0).long()
        return result.squeeze(0) if single else result


# ── Data loading ──────────────────────────────────────────────────

def load_dataset_discard_only(data_dir: Path) -> dict:
    """Load NPZ chunks, keep only discard records (label_type == 0)."""
    chunks = sorted(data_dir.glob("chunk_*.npz"))
    if not chunks:
        raise FileNotFoundError(f"No chunks found in {data_dir}")

    states_list, labels_list, evs_list, rounds_list = [], [], [], []
    total_all = 0
    for p in chunks:
        d = np.load(p)
        mask = d["label_types"] == 0   # discard records only
        total_all += len(d["labels"])
        if mask.sum() == 0:
            continue
        states_list.append(d["states"][mask])
        labels_list.append(d["labels"][mask])
        evs_list.append(d["ev_scores"][mask])
        rounds_list.append(d["round_idx"][mask])

    n_kept = sum(len(s) for s in states_list)
    print(f"  Loaded {total_all:,} total records, kept {n_kept:,} discard records "
          f"({n_kept/total_all:.1%})")

    return {
        "states":    np.concatenate(states_list,  axis=0),
        "labels":    np.concatenate(labels_list,  axis=0),
        "ev_scores": np.concatenate(evs_list,     axis=0),
        "round_idx": np.concatenate(rounds_list,  axis=0),
    }


def load_dataset(data_dir: Path) -> dict:
    """Load NPZ chunks, returning discard and draw records separately."""
    chunks = sorted(data_dir.glob("chunk_*.npz"))
    if not chunks:
        raise FileNotFoundError(f"No chunks found in {data_dir}")

    d_states, d_labels, d_evs, d_rounds = [], [], [], []
    r_states, r_labels = [], []
    total_all = 0
    for p in chunks:
        d = np.load(p)
        total_all += len(d["labels"])
        mask_d = d["label_types"] == 0
        mask_r = d["label_types"] == 1
        if mask_d.sum() > 0:
            d_states.append(d["states"][mask_d])
            d_labels.append(d["labels"][mask_d])
            d_evs.append(d["ev_scores"][mask_d])
            d_rounds.append(d["round_idx"][mask_d])
        if mask_r.sum() > 0:
            r_states.append(d["states"][mask_r])
            r_labels.append(d["labels"][mask_r])

    nd = sum(len(s) for s in d_states)
    nr = sum(len(s) for s in r_states)
    print(f"  Loaded {total_all:,} total records: {nd:,} discard, {nr:,} draw")

    result = {
        "discard_states":  np.concatenate(d_states),
        "discard_labels":  np.concatenate(d_labels).astype(np.int64),
        "discard_evs":     np.concatenate(d_evs),
        "discard_rounds":  np.concatenate(d_rounds),
    }
    if nr > 0:
        result["draw_states"] = np.concatenate(r_states)
        result["draw_labels"] = np.concatenate(r_labels).astype(np.float32)
    return result


def make_tensors(data: dict) -> dict:
    """Convert combined dataset dict to tensors. Handles both old and new format."""
    if "discard_states" in data:
        # New combined format
        result = {
            "states":    torch.from_numpy(data["discard_states"]).float(),
            "labels":    torch.from_numpy(data["discard_labels"]).long(),
            "ev_scores": torch.from_numpy(data["discard_evs"]).float(),
            "round_idx": torch.from_numpy(data["discard_rounds"]).long(),
        }
        if "draw_states" in data:
            result["draw_states"] = torch.from_numpy(data["draw_states"]).float()
            result["draw_labels"] = torch.from_numpy(data["draw_labels"])
        return result
    # Legacy format (discard-only)
    return {
        "states":    torch.from_numpy(data["states"]).float(),
        "labels":    torch.from_numpy(data["labels"]).long(),
        "ev_scores": torch.from_numpy(data["ev_scores"]).float(),
        "round_idx": torch.from_numpy(data["round_idx"]).long(),
    }


def train_val_split(tensors: dict, val_frac: float = 0.1, seed: int = 42):
    n   = tensors["states"].shape[0]
    rng = torch.Generator().manual_seed(seed)
    idx = torch.randperm(n, generator=rng)
    n_val = int(n * val_frac)
    val_idx, train_idx = idx[:n_val], idx[n_val:]

    return (
        {k: v[train_idx] for k, v in tensors.items()},
        {k: v[val_idx]   for k, v in tensors.items()},
    )


# ── Loss ──────────────────────────────────────────────────────────

def compute_loss(
    model: PIMCDiscardNet,
    states: torch.Tensor,
    labels: torch.Tensor,
    ev_scores: torch.Tensor,
) -> tuple:
    """
    EV-spread-weighted cross-entropy loss for discard decisions.

    Higher EV spread = PIMC was more confident = higher sample weight.
    Returns (loss, accuracy).
    """
    logits = model(states)                       # (B, 53)

    # EV spread weighting
    ev_valid = ev_scores > 0
    ev_max   = ev_scores.masked_fill(~ev_valid, 0.0).max(dim=1).values
    ev_min   = ev_scores.masked_fill(~ev_valid, 1e9).min(dim=1).values
    spread      = (ev_max - ev_min).clamp(min=0)
    mean_spread = spread.mean().clamp(min=1.0)
    weights     = (spread / mean_spread).clamp(0.2, 5.0)

    ce   = F.cross_entropy(logits, labels, reduction="none")
    loss = (ce * weights).mean()
    acc  = (logits.argmax(dim=1) == labels).float().mean().item()
    return loss, acc


# ── Training ──────────────────────────────────────────────────────

def train(args) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    data_dir = _HERE / args.data_dir
    out_path = MODEL_DIR / args.out

    print(f"Loading dataset from {data_dir} ...")
    t0      = time.perf_counter()
    data    = load_dataset(data_dir)
    tensors = make_tensors(data)
    n_total = tensors["states"].shape[0]
    has_draw = "draw_states" in tensors
    print(f"  {n_total:,} discard records loaded in {time.perf_counter()-t0:.1f}s")
    if has_draw:
        print(f"  {tensors['draw_states'].shape[0]:,} draw records loaded")

    train_t, val_t = train_val_split(tensors, val_frac=0.1, seed=args.seed)
    print(f"  Discard — Train: {train_t['states'].shape[0]:,}  Val: {val_t['states'].shape[0]:,}\n")

    def _loader(t, shuffle):
        ds = TensorDataset(t["states"], t["labels"], t["ev_scores"])
        return DataLoader(ds, batch_size=args.batch_size, shuffle=shuffle, num_workers=0)

    train_loader = _loader(train_t, shuffle=True)
    val_loader   = _loader(val_t,   shuffle=False)

    # Draw loaders (if draw data present)
    if has_draw:
        draw_ds    = TensorDataset(tensors["draw_states"], tensors["draw_labels"])
        draw_loader = DataLoader(draw_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)

    model    = PIMCDiscardNet(state_dim=170, hidden=args.hidden, dropout=args.dropout)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model: PIMCDiscardNet  params={n_params:,}  hidden={args.hidden}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr,
                                  weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.01
    )

    best_val_loss = float("inf")
    patience_left = args.patience
    history       = []

    print(f"\n{'Epoch':>5} {'TrLoss':>8} {'TrAcc':>8} {'VaLoss':>8} {'VaAcc':>8} {'LR':>8}")
    print("-" * 56)

    for epoch in range(1, args.epochs + 1):
        t_ep = time.perf_counter()
        model.train()
        tr_loss = tr_acc_sum = tr_n = 0.0

        for states, labels, evs in train_loader:
            loss, acc = compute_loss(model, states, labels, evs)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            b = states.shape[0]
            tr_loss    += loss.item()
            tr_acc_sum += acc * b
            tr_n       += b

        # Draw loss (separate pass, weighted 0.3 — draw labels are noisier)
        draw_loss_ep = 0.0
        if has_draw:
            model.train()
            for draw_s, draw_y in draw_loader:
                feat  = model.backbone(draw_s)
                logit = model.draw_head(feat).squeeze(-1)
                dloss = F.binary_cross_entropy_with_logits(logit, draw_y) * 0.3
                optimizer.zero_grad(set_to_none=True)
                dloss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                draw_loss_ep += dloss.item()

        scheduler.step()

        model.eval()
        va_loss = va_acc_sum = va_n = 0.0
        with torch.no_grad():
            for states, labels, evs in val_loader:
                loss, acc = compute_loss(model, states, labels, evs)
                b = states.shape[0]
                va_loss    += loss.item()
                va_acc_sum += acc * b
                va_n       += b

        tr_loss_avg = tr_loss / len(train_loader)
        va_loss_avg = va_loss / len(val_loader)
        tr_acc_avg  = tr_acc_sum / max(tr_n, 1)
        va_acc_avg  = va_acc_sum / max(va_n, 1)
        cur_lr      = scheduler.get_last_lr()[0]
        ep_sec      = time.perf_counter() - t_ep

        history.append({
            "epoch": epoch,
            "tr_loss": round(tr_loss_avg, 4),
            "tr_acc":  round(tr_acc_avg,  4),
            "va_loss": round(va_loss_avg, 4),
            "va_acc":  round(va_acc_avg,  4),
            "lr":      round(cur_lr, 6),
        })
        draw_str = f"  draw={draw_loss_ep/max(len(draw_loader),1):.4f}" if has_draw else ""
        print(
            f"{epoch:>5d}"
            f" {tr_loss_avg:>8.4f} {tr_acc_avg:>8.3%}"
            f" {va_loss_avg:>8.4f} {va_acc_avg:>8.3%}"
            f" {cur_lr:>8.2e}  [{ep_sec:.1f}s]{draw_str}"
        )

        if va_loss_avg < best_val_loss:
            best_val_loss = va_loss_avg
            patience_left = args.patience
            torch.save(model.state_dict(), out_path)
        else:
            patience_left -= 1
            if patience_left <= 0:
                print(f"\nEarly stopping at epoch {epoch} (patience={args.patience})")
                break

    # ── Per-round val accuracy ────────────────────────────────
    print("\nPer-round val accuracy (best model):")
    best_model = PIMCDiscardNet(state_dim=170, hidden=args.hidden)
    best_model.load_state_dict(torch.load(out_path, weights_only=True))
    best_model.eval()
    print(f"  {'Round':>6} {'Acc':>8} {'N':>8}")
    for ri in range(7):
        mask = val_t["round_idx"] == ri
        if mask.sum() == 0:
            continue
        s = val_t["states"][mask]
        l = val_t["labels"][mask]
        with torch.no_grad():
            logits = best_model(s)
        acc = (logits.argmax(1) == l).float().mean().item()
        print(f"  Round {ri+1:>2d}: {acc:>7.1%}  ({mask.sum().item():,})")

    # ── Save metadata ─────────────────────────────────────────
    best = min(history, key=lambda r: r["va_loss"])
    meta = {
        "best_epoch":  best["epoch"],
        "best_va_loss": best["va_loss"],
        "best_va_acc":  best["va_acc"],
        "args":         vars(args),
        "n_train":      train_t["states"].shape[0],
        "n_val":        val_t["states"].shape[0],
        "n_params":     n_params,
        "history":      history,
    }
    meta_path = out_path.with_suffix("").with_name(out_path.stem + "_meta.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"\nBest model: epoch {best['epoch']}"
          f"  val_loss={best['va_loss']:.4f}"
          f"  discard_acc={best['va_acc']:.1%}")
    print(f"Saved: {out_path}")
    print(f"       {meta_path}")


# ── Validation only ───────────────────────────────────────────────

def validate_only(args) -> None:
    data_dir   = _HERE / args.data_dir
    model_path = MODEL_DIR / args.out

    if not model_path.exists():
        print(f"No model at {model_path}. Train first.")
        return

    data    = load_dataset_discard_only(data_dir)
    tensors = make_tensors(data)
    _, val_t = train_val_split(tensors, val_frac=0.1, seed=args.seed)

    model = PIMCDiscardNet(state_dim=170, hidden=args.hidden)
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model.eval()

    loader = DataLoader(
        TensorDataset(val_t["states"], val_t["labels"], val_t["ev_scores"]),
        batch_size=args.batch_size, shuffle=False,
    )

    va_loss = va_acc_sum = va_n = 0.0
    with torch.no_grad():
        for states, labels, evs in loader:
            loss, acc = compute_loss(model, states, labels, evs)
            b = states.shape[0]
            va_loss    += loss.item()
            va_acc_sum += acc * b
            va_n       += b

    print(f"Validation ({val_t['states'].shape[0]:,} discard records):")
    print(f"  Loss        : {va_loss / len(loader):.4f}")
    print(f"  Discard acc : {va_acc_sum / max(va_n,1):.1%}")

    print("\nPer-round accuracy:")
    print(f"  {'Round':>6} {'Acc':>8} {'N':>8}")
    for ri in range(7):
        mask = val_t["round_idx"] == ri
        if mask.sum() == 0:
            continue
        s = val_t["states"][mask]
        l = val_t["labels"][mask]
        with torch.no_grad():
            logits = model(s)
        acc = (logits.argmax(1) == l).float().mean().item()
        print(f"  Round {ri+1:>2d}: {acc:>7.1%}  ({mask.sum().item():,})")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train discard-only PIMCNet on self-play data"
    )
    parser.add_argument("--epochs",        type=int,   default=30)
    parser.add_argument("--batch-size",    type=int,   default=1024)
    parser.add_argument("--lr",            type=float, default=1e-3)
    parser.add_argument("--weight-decay",  type=float, default=1e-4)
    parser.add_argument("--hidden",        type=int,   default=256)
    parser.add_argument("--dropout",       type=float, default=0.1)
    parser.add_argument("--patience",      type=int,   default=5,
                        help="Early stopping patience (epochs)")
    parser.add_argument("--seed",          type=int,   default=42)
    parser.add_argument("--data-dir",      type=str,   default="data_v2",
                        help="Dataset directory relative to ml/pimc/ (default: data_v2)")
    parser.add_argument("--out",           type=str,   default="network_v3.pt",
                        help="Output model filename in models/ (default: network_v3.pt)")
    parser.add_argument("--validate-only", action="store_true",
                        help="Only run validation on saved model")
    args = parser.parse_args()

    if args.validate_only:
        validate_only(args)
    else:
        train(args)


if __name__ == "__main__":
    main()
