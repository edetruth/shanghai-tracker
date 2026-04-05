"""V3 LSTM Sequence Training — teacher forcing then scheduled sampling.

Two-phase training:
  Phase 1 (epochs 1-20): Teacher forcing with packed sequences
  Phase 2 (epochs 21-50): Scheduled sampling (step-by-step LSTM)

Usage:
    python train_sequence.py --data ml/data/sequence_training/v3_sequences_1000games.pt --epochs 50
"""

import argparse
import os
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import TensorDataset, DataLoader, random_split

from network_v3 import ShanghaiLSTM, OpponentEncoderNetV3
from state_encoder import (
    V3_MAX_SEQ_LEN, V3_LSTM_HIDDEN, V3_LSTM_LAYERS,
    OPP_RAW_TOTAL, OPP_EMBEDDING_TOTAL, BASE_STATE_SIZE, MAX_HAND_CARDS,
    V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
    V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES, V3_TIMESTEP_INPUT_SIZE,
    CARD_FEATURES,
)
from log_utils import setup_logging

MODELS_DIR = Path(__file__).parent.parent / "models"

# ── Raw feature layout in the 703-dim preprocessed vector ────────────
RAW_STATE_END = 264
RAW_OPP_END = 642            # 264 + 378
RAW_MELD_END = 672            # 642 + 30
RAW_OPP_ACT_END = 690         # 672 + 18
RAW_ACT_TAKEN_END = 700       # 690 + 10
RAW_TOTAL = 703               # 700 + 3

# ── LSTM input layout (373-dim) after opponent encoding ──────────────
# base_state(264) + meld_plan(30) + opp_embeddings(48) + opp_actions(18) + action_taken(10) + phase(3)
LSTM_ACTION_TAKEN_START = 264 + 30 + 48 + 18  # = 360
LSTM_ACTION_TAKEN_END = LSTM_ACTION_TAKEN_START + V3_ACTION_TAKEN_FEATURES  # = 370

# Teacher forcing ends, scheduled sampling begins
TEACHER_FORCING_EPOCHS = 20


def build_lstm_input(raw: torch.Tensor, encoder: OpponentEncoderNetV3) -> torch.Tensor:
    """Convert (B, T, 703) raw features to (B, T, 373) LSTM input.

    Splits raw into components, compresses opponent_raw via encoder,
    and concatenates in LSTM input order.
    """
    B, T, _ = raw.shape

    base_state = raw[:, :, :RAW_STATE_END]                          # (B, T, 264)
    opp_raw = raw[:, :, RAW_STATE_END:RAW_OPP_END]                  # (B, T, 378)
    meld_plan = raw[:, :, RAW_OPP_END:RAW_MELD_END]                 # (B, T, 30)
    opp_actions = raw[:, :, RAW_MELD_END:RAW_OPP_ACT_END]           # (B, T, 18)
    action_taken = raw[:, :, RAW_OPP_ACT_END:RAW_ACT_TAKEN_END]     # (B, T, 10)
    phase = raw[:, :, RAW_ACT_TAKEN_END:RAW_TOTAL]                  # (B, T, 3)

    # Encode opponents: flatten (B, T) -> (B*T, 378), encode, reshape back
    opp_flat = opp_raw.reshape(B * T, OPP_RAW_TOTAL)
    opp_emb_flat = encoder.encode_all_opponents(opp_flat)            # (B*T, 48)
    opp_emb = opp_emb_flat.reshape(B, T, OPP_EMBEDDING_TOTAL)       # (B, T, 48)

    # Concatenate in LSTM input order: state + meld + opp_emb + opp_actions + action_taken + phase
    return torch.cat([base_state, meld_plan, opp_emb, opp_actions, action_taken, phase], dim=-1)


def compute_losses(model, h_all, targets, offered, mask):
    """Compute per-head losses from LSTM hidden states.

    Args:
        model: ShanghaiLSTM
        h_all: (B, T, 192) hidden states
        targets: (B, T, 3) — [phase_idx, action_type_idx, card_idx]
        offered: (B, T, 6) — offered card features
        mask: (B, T) — valid timestep mask

    Returns:
        loss_draw, loss_buy, loss_discard, n_draw, n_buy, n_discard,
        correct_draw, correct_buy, correct_discard
    """
    B, T, _ = h_all.shape

    loss_draw = torch.tensor(0.0, device=h_all.device)
    loss_buy = torch.tensor(0.0, device=h_all.device)
    loss_discard = torch.tensor(0.0, device=h_all.device)
    n_draw = 0
    n_buy = 0
    n_discard = 0
    correct_draw = 0
    correct_buy = 0
    correct_discard = 0

    # Flatten for efficiency
    h_flat = h_all.reshape(B * T, -1)                    # (B*T, 192)
    targets_flat = targets.reshape(B * T, 3)              # (B*T, 3)
    offered_flat = offered.reshape(B * T, CARD_FEATURES)  # (B*T, 6)
    mask_flat = mask.reshape(B * T)                       # (B*T,)

    phase_idx = targets_flat[:, 0]
    action_type = targets_flat[:, 1]
    card_idx = targets_flat[:, 2]

    # Draw decisions: phase=0, action_type in {0, 1}
    draw_mask = mask_flat & (phase_idx == 0) & ((action_type == 0) | (action_type == 1))
    if draw_mask.any():
        h_draw = h_flat[draw_mask]
        off_draw = offered_flat[draw_mask]
        pred = model.draw_head_forward(h_draw, off_draw).squeeze(-1)
        # Label: 1 if take_discard (type=1), 0 if draw_pile (type=0)
        label = action_type[draw_mask].float()
        loss_draw = F.binary_cross_entropy(pred, label, reduction='mean')
        n_draw = draw_mask.sum().item()
        correct_draw = ((pred > 0.5).long() == label.long()).sum().item()

    # Buy decisions: phase=1, action_type in {2, 3}
    buy_mask = mask_flat & (phase_idx == 1) & ((action_type == 2) | (action_type == 3))
    if buy_mask.any():
        h_buy = h_flat[buy_mask]
        off_buy = offered_flat[buy_mask]
        pred = model.buy_head_forward(h_buy, off_buy).squeeze(-1)
        # Label: 1 if buy (type=2), 0 if decline (type=3)
        label = (action_type[buy_mask] == 2).float()
        loss_buy = F.binary_cross_entropy(pred, label, reduction='mean')
        n_buy = buy_mask.sum().item()
        correct_buy = ((pred > 0.5).long() == label.long()).sum().item()

    # Discard decisions: phase=2, action_type=4, card_idx >= 0
    discard_mask = mask_flat & (phase_idx == 2) & (action_type == 4) & (card_idx >= 0)
    if discard_mask.any():
        h_disc = h_flat[discard_mask]
        logits = model.discard_head_forward(h_disc)
        label = card_idx[discard_mask]
        # Clamp labels to valid range
        label = label.clamp(0, MAX_HAND_CARDS - 1)
        loss_discard = F.cross_entropy(logits, label, reduction='mean')
        n_discard = discard_mask.sum().item()
        correct_discard = (logits.argmax(dim=-1) == label).sum().item()

    return (loss_draw, loss_buy, loss_discard, n_draw, n_buy, n_discard, correct_draw, correct_buy, correct_discard)


def compute_auxiliary_loss(model, h_all, mask, outcomes):
    """MSE loss on predicted round score from last valid hidden state.

    Args:
        model: ShanghaiLSTM
        h_all: (B, T, 192)
        mask: (B, T)
        outcomes: (B,) round scores

    Returns:
        aux_loss: scalar
    """
    B = h_all.shape[0]
    # Get last valid timestep index for each sequence
    lengths = mask.sum(dim=1).long()  # (B,)
    last_idx = (lengths - 1).clamp(min=0)
    # Gather last valid hidden state
    h_last = h_all[torch.arange(B, device=h_all.device), last_idx]  # (B, 192)
    pred_score = model.auxiliary_head_forward(h_last).squeeze(-1)     # (B,)
    return F.mse_loss(pred_score, outcomes)


def teacher_forcing_step(model, encoder, raw, mask, targets, offered, outcomes):
    """Phase 1: full-sequence teacher forcing with packed sequences."""
    lstm_input = build_lstm_input(raw, encoder)
    h_all, _ = model.lstm_forward(lstm_input, mask)

    loss_draw, loss_buy, loss_discard, n_draw, n_buy, n_discard, c_draw, c_buy, c_disc = compute_losses(model, h_all, targets, offered, mask)
    aux_loss = compute_auxiliary_loss(model, h_all, mask, outcomes)

    total_loss = loss_discard + loss_draw + loss_buy + 0.1 * aux_loss
    return total_loss, loss_draw, loss_buy, loss_discard, aux_loss, n_draw, n_buy, n_discard, c_draw, c_buy, c_disc


def scheduled_sampling_step(model, encoder, raw, mask, targets, offered, outcomes, sample_p):
    """Phase 2: step-by-step LSTM with scheduled sampling.

    With probability sample_p, the NEXT timestep's action_taken features
    are replaced by the model's own prediction from the current step.
    """
    B, T, _ = raw.shape
    device = raw.device

    # Build full LSTM input (we will selectively overwrite action_taken)
    lstm_input = build_lstm_input(raw, encoder)  # (B, T, 373)
    # Make a writable copy for scheduled sampling overwrites
    lstm_input = lstm_input.clone()

    # Step through LSTM one timestep at a time
    h_all = torch.zeros(B, T, V3_LSTM_HIDDEN, device=device)
    hx = None  # LSTM will initialize to zeros

    for t in range(T):
        x_t = lstm_input[:, t:t+1, :]  # (B, 1, 373)
        out, hx = model.lstm(x_t, hx)
        h_all[:, t, :] = out.squeeze(1)

        # Scheduled sampling: with probability sample_p, overwrite the NEXT step's action_taken
        if t < T - 1 and sample_p > 0:
            # Check which sequences still have valid next timestep
            next_valid = mask[:, t + 1]  # (B,)
            if not next_valid.any():
                continue

            # Decide which samples get model predictions (Bernoulli sampling)
            sample_mask = torch.rand(B, device=device) < sample_p
            sample_mask = sample_mask & next_valid

            if sample_mask.any():
                h_t = out.squeeze(1)  # (B, 192)
                # Get the phase at current timestep from targets
                phase_t = targets[:, t, 0]  # (B,)

                # Build action_taken encoding from model predictions
                action_taken_pred = torch.zeros(B, V3_ACTION_TAKEN_FEATURES, device=device)

                # Draw phase: predict take/draw
                draw_sel = sample_mask & (phase_t == 0)
                if draw_sel.any():
                    off_t = offered[:, t, :]
                    prob = model.draw_head_forward(h_t[draw_sel], off_t[draw_sel]).squeeze(-1)
                    take = (prob > 0.5).long()
                    # One-hot action type: index 0=draw_pile, 1=take_discard
                    action_taken_pred[draw_sel, 0] = (1 - take).float()  # draw_pile
                    action_taken_pred[draw_sel, 1] = take.float()        # take_discard
                    # Card features (slots 5-9) left as zero for draw decisions

                # Buy phase: predict buy/decline
                buy_sel = sample_mask & (phase_t == 1)
                if buy_sel.any():
                    off_t = offered[:, t, :]
                    prob = model.buy_head_forward(h_t[buy_sel], off_t[buy_sel]).squeeze(-1)
                    do_buy = (prob > 0.5).long()
                    action_taken_pred[buy_sel, 2] = do_buy.float()            # buy
                    action_taken_pred[buy_sel, 3] = (1 - do_buy).float()      # decline

                # Action phase: predict discard
                disc_sel = sample_mask & (phase_t == 2)
                if disc_sel.any():
                    logits = model.discard_head_forward(h_t[disc_sel])
                    chosen = logits.argmax(dim=-1)  # (n,)
                    action_taken_pred[disc_sel, 4] = 1.0  # discard action type
                    # Encode card index as normalized value in slot 5
                    action_taken_pred[disc_sel, 5] = chosen.float() / MAX_HAND_CARDS

                # Overwrite next timestep's action_taken in the LSTM input
                lstm_input[sample_mask, t + 1, LSTM_ACTION_TAKEN_START:LSTM_ACTION_TAKEN_END] = action_taken_pred[sample_mask]

    # Now compute losses from collected h_all
    loss_draw, loss_buy, loss_discard, n_draw, n_buy, n_discard, c_draw, c_buy, c_disc = compute_losses(model, h_all, targets, offered, mask)
    aux_loss = compute_auxiliary_loss(model, h_all, mask, outcomes)

    total_loss = loss_discard + loss_draw + loss_buy + 0.1 * aux_loss
    return total_loss, loss_draw, loss_buy, loss_discard, aux_loss, n_draw, n_buy, n_discard, c_draw, c_buy, c_disc


def run_epoch(model, encoder, loader, optimizer, scheduler, device, epoch, total_epochs, is_train=True):
    """Run one training or validation epoch."""
    if is_train:
        model.train()
        encoder.train()
    else:
        model.eval()
        encoder.eval()

    # Determine training phase and sample_p
    use_scheduled_sampling = is_train and epoch >= TEACHER_FORCING_EPOCHS
    if use_scheduled_sampling:
        ss_epochs = total_epochs - TEACHER_FORCING_EPOCHS
        epoch_in_ss = epoch - TEACHER_FORCING_EPOCHS
        sample_p = 0.1 + 0.4 * min(epoch_in_ss / max(ss_epochs - 1, 1), 1.0)
    else:
        sample_p = 0.0

    total_loss = 0.0
    total_draw_loss = 0.0
    total_buy_loss = 0.0
    total_discard_loss = 0.0
    total_aux_loss = 0.0
    total_n_draw = 0
    total_n_buy = 0
    total_n_discard = 0
    total_c_draw = 0
    total_c_buy = 0
    total_c_discard = 0
    n_batches = 0

    ctx = torch.no_grad() if not is_train else torch.enable_grad()
    with ctx:
        for batch in loader:
            raw, mask, targets, offered, outcomes, rounds = [b.to(device) for b in batch]

            if use_scheduled_sampling:
                loss, ld, lb, ldisc, laux, nd, nb, ndisc, cd, cb, cdisc = scheduled_sampling_step(model, encoder, raw, mask, targets, offered, outcomes, sample_p)
            else:
                loss, ld, lb, ldisc, laux, nd, nb, ndisc, cd, cb, cdisc = teacher_forcing_step(model, encoder, raw, mask, targets, offered, outcomes)

            if is_train:
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(list(model.parameters()) + list(encoder.parameters()), 1.0)
                optimizer.step()

            total_loss += loss.item()
            total_draw_loss += ld.item()
            total_buy_loss += lb.item()
            total_discard_loss += ldisc.item()
            total_aux_loss += laux.item()
            total_n_draw += nd
            total_n_buy += nb
            total_n_discard += ndisc
            total_c_draw += cd
            total_c_buy += cb
            total_c_discard += cdisc
            n_batches += 1

    if is_train and scheduler is not None:
        scheduler.step()

    avg_loss = total_loss / max(n_batches, 1)
    draw_acc = total_c_draw / max(total_n_draw, 1)
    buy_acc = total_c_buy / max(total_n_buy, 1)
    discard_acc = total_c_discard / max(total_n_discard, 1)

    return avg_loss, draw_acc, buy_acc, discard_acc, sample_p


def main():
    parser = argparse.ArgumentParser(description="Train v3 LSTM sequence model")
    parser.add_argument('--data', type=str, required=True, help='Path to v3 preprocessed .pt file')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--patience', type=int, default=10)
    args = parser.parse_args()

    setup_logging('train_sequence')

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"\n{'='*60}")
    print(f"V3 LSTM Sequence Training")
    print(f"  Device: {device}")
    print(f"  Data: {args.data}")
    print(f"  Epochs: {args.epochs}")
    print(f"  Batch size: {args.batch_size}")
    print(f"  LR: {args.lr}")
    print(f"  Patience: {args.patience}")
    print(f"  Teacher forcing epochs: {TEACHER_FORCING_EPOCHS}")
    print(f"  Scheduled sampling epochs: {args.epochs - TEACHER_FORCING_EPOCHS}")
    print(f"{'='*60}")

    # ── Load data ────────────────────────────────────────────────────
    data_path = os.path.abspath(args.data)
    if not os.path.exists(data_path):
        print(f"ERROR: Data file not found: {data_path}")
        sys.exit(1)

    print(f"\nLoading data from {data_path}...")
    t0 = time.time()
    data = torch.load(data_path, weights_only=False)

    sequences = data["sequences"]    # (N, T, 703)
    masks = data["masks"]            # (N, T)
    targets = data["targets"]        # (N, T, 3)
    offered = data["offered"]        # (N, T, 6)
    outcomes = data["outcomes"]      # (N,)
    rounds = data["rounds"]          # (N,)

    N = sequences.shape[0]
    print(f"  Loaded {N:,} sequences in {time.time() - t0:.1f}s")
    print(f"  Shapes: sequences={list(sequences.shape)}, masks={list(masks.shape)}, targets={list(targets.shape)}")
    print(f"  offered={list(offered.shape)}, outcomes={list(outcomes.shape)}, rounds={list(rounds.shape)}")

    # ── Train/val split ──────────────────────────────────────────────
    dataset = TensorDataset(sequences, masks, targets, offered, outcomes, rounds)
    val_size = int(0.2 * N)
    train_size = N - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size], generator=torch.Generator().manual_seed(42))

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0, pin_memory=(device.type == 'cuda'))
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0, pin_memory=(device.type == 'cuda'))

    print(f"  Train: {train_size:,} sequences, Val: {val_size:,} sequences")
    print(f"  Train batches: {len(train_loader)}, Val batches: {len(val_loader)}")

    # ── Initialize models ────────────────────────────────────────────
    model = ShanghaiLSTM().to(device)
    encoder = OpponentEncoderNetV3().to(device)

    model_params = sum(p.numel() for p in model.parameters())
    encoder_params = sum(p.numel() for p in encoder.parameters())
    print(f"\n  Model params: {model_params:,}")
    print(f"  Encoder params: {encoder_params:,}")
    print(f"  Total params: {model_params + encoder_params:,}")

    # ── Optimizer with two param groups ──────────────────────────────
    optimizer = torch.optim.Adam([
        {'params': model.parameters(), 'lr': args.lr},
        {'params': encoder.parameters(), 'lr': args.lr * 0.5},
    ])
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-5)

    # ── Training loop ────────────────────────────────────────────────
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    best_val_loss = float('inf')
    patience_counter = 0

    print(f"\n{'='*60}")
    print(f"Starting training...")
    print(f"{'='*60}\n")

    for epoch in range(args.epochs):
        t_epoch = time.time()

        train_loss, train_draw_acc, train_buy_acc, train_disc_acc, sample_p = run_epoch(model, encoder, train_loader, optimizer, scheduler, device, epoch, args.epochs, is_train=True)

        val_loss, val_draw_acc, val_buy_acc, val_disc_acc, _ = run_epoch(model, encoder, val_loader, None, None, device, epoch, args.epochs, is_train=False)

        elapsed = time.time() - t_epoch
        phase_str = "SS" if epoch >= TEACHER_FORCING_EPOCHS else "TF"

        print(f"Epoch {epoch+1:3d}/{args.epochs} [{phase_str}] | train_loss={train_loss:.4f} val_loss={val_loss:.4f} | draw_acc={val_draw_acc:.3f} buy_acc={val_buy_acc:.3f} disc_acc={val_disc_acc:.3f} | sample_p={sample_p:.2f} | {elapsed:.1f}s")

        # Checkpointing: best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            torch.save(model.state_dict(), MODELS_DIR / "shanghai_lstm.pt")
            torch.save(encoder.state_dict(), MODELS_DIR / "opponent_encoder_v3.pt")
            print(f"  -> Saved best model (val_loss={best_val_loss:.4f})")
        else:
            patience_counter += 1

        # Periodic checkpoint every 5 epochs
        if (epoch + 1) % 5 == 0:
            torch.save(model.state_dict(), MODELS_DIR / f"shanghai_lstm_epoch{epoch+1}.pt")
            torch.save(encoder.state_dict(), MODELS_DIR / f"opponent_encoder_v3_epoch{epoch+1}.pt")
            print(f"  -> Periodic checkpoint at epoch {epoch+1}")

        # Early stopping
        if patience_counter >= args.patience:
            print(f"\nEarly stopping at epoch {epoch+1} (no improvement for {args.patience} epochs)")
            break

    print(f"\n{'='*60}")
    print(f"Training complete!")
    print(f"  Best val loss: {best_val_loss:.4f}")
    print(f"  Models saved to: {MODELS_DIR}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
