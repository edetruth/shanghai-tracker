"""
Train a neural network to approximate PIMC discard and draw decisions.

Loads the NPZ dataset from ml/pimc/data/ and trains a dual-head MLP:
  - Discard head (53 outputs): predicts EV ranking over all card types
  - Draw head (1 output):      predicts probability of taking the discard

Loss:
  - Discard: cross-entropy on chosen card type, weighted by EV spread
             (high spread = confident PIMC decision = higher weight)
  - Draw:    binary cross-entropy on take (1) vs draw (0)

State encoding (170 dims, from collect_data.py):
  [0:53]    hand card counts per type
  [53:106]  seen card counts per type
  [106:159] discard-top one-hot
  [159:166] round one-hot
  [166]     has_laid_down
  [167:170] opponent hand sizes (normalized)

Usage:
    python train_network.py                         # 20 epochs, all defaults
    python train_network.py --epochs 40 --lr 3e-4   # longer run
    python train_network.py --validate-only         # eval saved model on val set
"""

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset

# ── Paths ─────────────────────────────────────────────────────────

_HERE    = Path(__file__).parent
DATA_DIR = _HERE / "data"
MODEL_DIR = _HERE / "models"

# ── Card type point values (mirrors engine._POINTS_LUT) ──────────

_TYPE_POINTS = np.zeros(53, dtype=np.float32)
for _t in range(52):
    _rank = (_t % 13) + 1
    _TYPE_POINTS[_t] = 15.0 if _rank == 1 else (10.0 if _rank >= 10 else 5.0)
_TYPE_POINTS[52] = 25.0   # joker

# ── Model ─────────────────────────────────────────────────────────

class PIMCNet(nn.Module):
    """
    Dual-head MLP that approximates PIMC decisions.

    Discard head: logits over 53 card types — use argmax (masked to hand)
                  to pick the discard recommendation.
    Draw head:    sigmoid output — > 0.5 means 'take', <= 0.5 means 'draw'.
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
        self.draw_head    = nn.Linear(hidden, 1)

    def forward(self, x: torch.Tensor):
        """
        Args:
            x: (B, state_dim) float32
        Returns:
            discard_logits: (B, 53)  — logits per card type
            draw_logit:     (B, 1)   — raw logit for take decision
        """
        h = self.backbone(x)
        return self.discard_head(h), self.draw_head(h)

    @torch.no_grad()
    def predict_discard(self, state: torch.Tensor) -> torch.Tensor:
        """
        Return the recommended discard card type index for each sample.
        Masks logits to only cards present in hand (state[0:53] > 0).

        Args:
            state: (B, 170) or (170,) float32
        Returns:
            (B,) int64 card type indices
        """
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)
        logits, _ = self.forward(state)
        hand_mask = state[:, :53] > 0            # cards present in hand
        joker_mask = state[:, :53] > 0            # jokers too
        joker_mask[:, 52] = False                 # never discard joker
        # Apply mask: set non-hand cards to -inf
        logits = logits.masked_fill(~joker_mask, float('-inf'))
        result = logits.argmax(dim=1)
        return result.squeeze(0) if single else result

    @torch.no_grad()
    def predict_draw(self, state: torch.Tensor) -> torch.Tensor:
        """
        Return draw decision: 1 = take, 0 = draw from pile.

        Args:
            state: (B, 170) or (170,) float32
        Returns:
            (B,) int64 — 1 (take) or 0 (draw)
        """
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)
        _, draw_logit = self.forward(state)
        result = (draw_logit.squeeze(-1) > 0).long()
        return result.squeeze(0) if single else result


# ── Data loading ──────────────────────────────────────────────────

def load_dataset(data_dir: Path) -> dict:
    """Load all NPZ chunks into memory and return concatenated arrays."""
    chunks = sorted(data_dir.glob("chunk_*.npz"))
    if not chunks:
        raise FileNotFoundError(f"No chunks found in {data_dir}")

    states_list, labels_list, types_list, evs_list, rounds_list = [], [], [], [], []
    for p in chunks:
        d = np.load(p)
        states_list.append(d["states"])
        labels_list.append(d["labels"])
        types_list.append(d["label_types"])
        evs_list.append(d["ev_scores"])
        rounds_list.append(d["round_idx"])

    return {
        "states":      np.concatenate(states_list,  axis=0),
        "labels":      np.concatenate(labels_list,  axis=0),
        "label_types": np.concatenate(types_list,   axis=0),
        "ev_scores":   np.concatenate(evs_list,     axis=0),
        "round_idx":   np.concatenate(rounds_list,  axis=0),
    }


def make_tensors(data: dict) -> dict:
    return {
        "states":      torch.from_numpy(data["states"]).float(),
        "labels":      torch.from_numpy(data["labels"]).long(),
        "label_types": torch.from_numpy(data["label_types"]).long(),
        "ev_scores":   torch.from_numpy(data["ev_scores"]).float(),
        "round_idx":   torch.from_numpy(data["round_idx"]).long(),
    }


def train_val_split(tensors: dict, val_frac: float = 0.1, seed: int = 42):
    """Random 90/10 split at record level."""
    n = tensors["states"].shape[0]
    rng = torch.Generator().manual_seed(seed)
    idx = torch.randperm(n, generator=rng)
    n_val = int(n * val_frac)
    val_idx, train_idx = idx[:n_val], idx[n_val:]

    def _split(t):
        return t[train_idx], t[val_idx]

    return (
        {k: _split(v)[0] for k, v in tensors.items()},
        {k: _split(v)[1] for k, v in tensors.items()},
    )


# ── Loss and metrics ──────────────────────────────────────────────

def compute_loss_and_metrics(
    model: PIMCNet,
    states: torch.Tensor,
    labels: torch.Tensor,
    label_types: torch.Tensor,
    ev_scores: torch.Tensor,
) -> tuple:
    """
    Returns (loss, discard_acc, draw_acc, n_discard, n_draw).
    Handles batches that may contain only discard, only draw, or both.
    """
    discard_logits, draw_logit = model(states)

    is_discard = label_types == 0
    is_draw    = label_types == 1

    loss = torch.tensor(0.0, requires_grad=True)
    discard_acc = draw_acc = 0.0
    n_d = is_discard.sum().item()
    n_dr = is_draw.sum().item()

    # ── Discard loss ───────────────────────────────────────────
    if n_d > 0:
        d_logits = discard_logits[is_discard]    # (n_d, 53)
        d_labels = labels[is_discard]             # (n_d,)
        d_ev     = ev_scores[is_discard]          # (n_d, 5)

        # EV spread weighting: high spread = PIMC was confident
        ev_valid_mask = d_ev > 0                   # ignore padding
        ev_for_max    = d_ev.masked_fill(~ev_valid_mask, 0.0)
        ev_for_min    = d_ev.masked_fill(~ev_valid_mask, 1e9)
        spread = (ev_for_max.max(dim=1).values - ev_for_min.min(dim=1).values).clamp(min=0)
        mean_spread = spread.mean().clamp(min=1.0)
        weights = (spread / mean_spread).clamp(0.2, 5.0)

        d_ce = F.cross_entropy(d_logits, d_labels, reduction="none")
        d_loss = (d_ce * weights).mean()
        loss = loss + d_loss

        discard_acc = (d_logits.argmax(dim=1) == d_labels).float().mean().item()

    # ── Draw loss ──────────────────────────────────────────────
    if n_dr > 0:
        dr_logit  = draw_logit[is_draw].squeeze(-1)   # (n_dr,)
        dr_labels = labels[is_draw].float()            # (n_dr,) — 0.0 or 1.0
        dr_loss   = F.binary_cross_entropy_with_logits(dr_logit, dr_labels)
        loss = loss + dr_loss

        dr_preds = (dr_logit > 0).long()
        draw_acc = (dr_preds == labels[is_draw]).float().mean().item()

    return loss, discard_acc, draw_acc, n_d, n_dr


# ── Training ──────────────────────────────────────────────────────

def train(args) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load data ─────────────────────────────────────────────
    print("Loading dataset...")
    t0 = time.perf_counter()
    data = load_dataset(DATA_DIR)
    tensors = make_tensors(data)
    n_total = tensors["states"].shape[0]
    print(f"  {n_total:,} records loaded in {time.perf_counter()-t0:.1f}s")

    n_discard = int((tensors["label_types"] == 0).sum())
    n_draw    = int((tensors["label_types"] == 1).sum())
    print(f"  Discard: {n_discard:,}  Draw: {n_draw:,}")

    train_t, val_t = train_val_split(tensors, val_frac=0.1, seed=args.seed)
    print(f"  Train: {train_t['states'].shape[0]:,}  Val: {val_t['states'].shape[0]:,}\n")

    # ── Dataset / DataLoader ──────────────────────────────────
    def _loader(t: dict, shuffle: bool) -> DataLoader:
        ds = TensorDataset(
            t["states"], t["labels"], t["label_types"], t["ev_scores"]
        )
        return DataLoader(ds, batch_size=args.batch_size, shuffle=shuffle,
                          num_workers=0, pin_memory=False)

    train_loader = _loader(train_t, shuffle=True)
    val_loader   = _loader(val_t,   shuffle=False)

    # ── Model / optimizer ─────────────────────────────────────
    model = PIMCNet(state_dim=170, hidden=args.hidden, dropout=args.dropout)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model: PIMCNet  params={n_params:,}  hidden={args.hidden}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr,
                                  weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.01
    )

    # ── Training loop ─────────────────────────────────────────
    best_val_loss = float("inf")
    patience_left = args.patience
    history = []

    print(f"\n{'Epoch':>5} {'TrLoss':>8} {'TrDAcc':>8} {'TrDrAcc':>8} "
          f"{'VaLoss':>8} {'VaDAcc':>8} {'VaDrAcc':>8} {'LR':>8}")
    print("-" * 72)

    for epoch in range(1, args.epochs + 1):
        t_ep = time.perf_counter()
        model.train()
        tr_loss = tr_d_acc = tr_dr_acc = tr_nd = tr_ndr = 0.0

        for states, labels, types, evs in train_loader:
            loss, d_acc, dr_acc, nd, ndr = compute_loss_and_metrics(
                model, states, labels, types, evs
            )
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            tr_loss  += loss.item()
            tr_d_acc  += d_acc * nd
            tr_dr_acc += dr_acc * ndr
            tr_nd    += nd
            tr_ndr   += ndr

        scheduler.step()

        # ── Validation ────────────────────────────────────────
        model.eval()
        va_loss = va_d_acc = va_dr_acc = va_nd = va_ndr = 0.0
        with torch.no_grad():
            for states, labels, types, evs in val_loader:
                loss, d_acc, dr_acc, nd, ndr = compute_loss_and_metrics(
                    model, states, labels, types, evs
                )
                va_loss  += loss.item()
                va_d_acc  += d_acc * nd
                va_dr_acc += dr_acc * ndr
                va_nd    += nd
                va_ndr   += ndr

        tr_loss_avg  = tr_loss / len(train_loader)
        va_loss_avg  = va_loss / len(val_loader)
        tr_d_acc_avg = tr_d_acc / max(tr_nd, 1)
        va_d_acc_avg = va_d_acc / max(va_nd, 1)
        tr_dr_avg    = tr_dr_acc / max(tr_ndr, 1)
        va_dr_avg    = va_dr_acc / max(va_ndr, 1)
        cur_lr       = scheduler.get_last_lr()[0]
        ep_sec       = time.perf_counter() - t_ep

        row = {
            "epoch": epoch, "tr_loss": round(tr_loss_avg, 4),
            "tr_d_acc": round(tr_d_acc_avg, 4), "tr_dr_acc": round(tr_dr_avg, 4),
            "va_loss": round(va_loss_avg, 4),
            "va_d_acc": round(va_d_acc_avg, 4), "va_dr_acc": round(va_dr_avg, 4),
            "lr": round(cur_lr, 6), "sec": round(ep_sec, 1),
        }
        history.append(row)

        print(
            f"{epoch:>5d}"
            f" {tr_loss_avg:>8.4f} {tr_d_acc_avg:>8.3%} {tr_dr_avg:>8.3%}"
            f" {va_loss_avg:>8.4f} {va_d_acc_avg:>8.3%} {va_dr_avg:>8.3%}"
            f" {cur_lr:>8.2e}  [{ep_sec:.1f}s]"
        )

        # ── Early stopping + checkpointing ────────────────────
        if va_loss_avg < best_val_loss:
            best_val_loss = va_loss_avg
            patience_left = args.patience
            torch.save(model.state_dict(), MODEL_DIR / "network_v1.pt")
        else:
            patience_left -= 1
            if patience_left <= 0:
                print(f"\nEarly stopping at epoch {epoch} (patience={args.patience})")
                break

    # ── Save metadata ─────────────────────────────────────────
    best = min(history, key=lambda r: r["va_loss"])
    meta = {
        "best_epoch":   best["epoch"],
        "best_va_loss": best["va_loss"],
        "best_va_d_acc": best["va_d_acc"],
        "best_va_dr_acc": best["va_dr_acc"],
        "args": vars(args),
        "n_train": train_t["states"].shape[0],
        "n_val":   val_t["states"].shape[0],
        "n_params": n_params,
        "history": history,
    }
    meta_path = MODEL_DIR / "network_v1_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"\nBest model: epoch {best['epoch']}"
          f"  val_loss={best['va_loss']:.4f}"
          f"  discard_acc={best['va_d_acc']:.1%}"
          f"  draw_acc={best['va_dr_acc']:.1%}")
    print(f"Saved: {MODEL_DIR / 'network_v1.pt'}")
    print(f"       {meta_path}")


# ── Validation only ───────────────────────────────────────────────

def validate_only(args) -> None:
    model_path = MODEL_DIR / "network_v1.pt"
    if not model_path.exists():
        print(f"No model found at {model_path}. Train first.")
        return

    data = load_dataset(DATA_DIR)
    tensors = make_tensors(data)
    _, val_t = train_val_split(tensors, val_frac=0.1, seed=args.seed)

    model = PIMCNet(state_dim=170, hidden=args.hidden)
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model.eval()

    val_loader = DataLoader(
        TensorDataset(val_t["states"], val_t["labels"],
                      val_t["label_types"], val_t["ev_scores"]),
        batch_size=args.batch_size, shuffle=False,
    )

    va_loss = va_d_acc = va_dr_acc = va_nd = va_ndr = 0.0
    with torch.no_grad():
        for states, labels, types, evs in val_loader:
            loss, d_acc, dr_acc, nd, ndr = compute_loss_and_metrics(
                model, states, labels, types, evs
            )
            va_loss  += loss.item()
            va_d_acc  += d_acc * nd
            va_dr_acc += dr_acc * ndr
            va_nd    += nd
            va_ndr   += ndr

    print(f"Validation ({val_t['states'].shape[0]:,} records):")
    print(f"  Loss        : {va_loss / len(val_loader):.4f}")
    print(f"  Discard acc : {va_d_acc / max(va_nd,1):.1%}  ({int(va_nd):,} samples)")
    print(f"  Draw acc    : {va_dr_acc / max(va_ndr,1):.1%}  ({int(va_ndr):,} samples)")

    # ── Per-round breakdown ───────────────────────────────────
    print("\nPer-round discard accuracy:")
    print(f"  {'Round':>6} {'Acc':>8} {'N':>8}")
    for ri in range(7):
        mask = (val_t["label_types"] == 0) & (val_t["round_idx"] == ri)
        if mask.sum() == 0:
            continue
        s = val_t["states"][mask]
        l = val_t["labels"][mask]
        with torch.no_grad():
            logits, _ = model(s)
        acc = (logits.argmax(1) == l).float().mean().item()
        print(f"  Round {ri+1:>2d}: {acc:>7.1%}  ({mask.sum().item():,})")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Train PIMC approximation network")
    parser.add_argument("--epochs",       type=int,   default=30)
    parser.add_argument("--batch-size",   type=int,   default=1024)
    parser.add_argument("--lr",           type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--hidden",       type=int,   default=256)
    parser.add_argument("--dropout",      type=float, default=0.1)
    parser.add_argument("--patience",     type=int,   default=5,
                        help="Early stopping patience (epochs)")
    parser.add_argument("--seed",         type=int,   default=42)
    parser.add_argument("--validate-only", action="store_true",
                        help="Only run validation on saved model")
    args = parser.parse_args()

    if args.validate_only:
        validate_only(args)
    else:
        train(args)


if __name__ == "__main__":
    main()
