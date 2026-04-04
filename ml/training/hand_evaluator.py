"""
Hand Evaluator — scores how close a hand is to melding (0-1).

Train v1: python hand_evaluator.py --data ml/data/hybrid_training/hand_eval_TIMESTAMP.json
Train v2: python hand_evaluator.py --data ml/data/hybrid_training/hand_eval_TIMESTAMP.json --v2
Eval:     python hand_evaluator.py --evaluate --model hand_evaluator.pt
"""

import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split

from state_encoder import RICH_STATE_SIZE, ENRICHED_STATE_SIZE, BASE_STATE_SIZE
from opponent_encoder import OpponentEncoderNet, build_enriched_state

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


class HandEvalNet(nn.Module):
    """Small regression network: state features -> single 0-1 score.

    v1: 273 features (RICH_STATE_SIZE)
    v2: 312 features (ENRICHED_STATE_SIZE = 264 base + 48 opponent embeddings)
    """

    def __init__(self, input_size: int = ENRICHED_STATE_SIZE):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class HandEvalDataset(Dataset):
    """Loads hand evaluator training data from .pt (preprocessed) or .json (legacy).

    .pt format: dict with 'states', 'labels', 'opponent_raw' tensors
    .json format: {"samples": [{"state": [...], "label": float, ...}, ...]}
    """

    def __init__(self, path: str):
        path = Path(path)
        if path.suffix == ".pt":
            data = torch.load(path, weights_only=False)
            self.states = data["states"]
            self.labels = data["labels"]
            self.opp_raw = data.get("opponent_raw", None)
            self.is_v2 = self.opp_raw is not None
            count = len(self.states)
        else:
            with open(path) as f:
                data = json.load(f)
            samples = data["samples"]
            self.is_v2 = "opponent_raw" in samples[0] if samples else False
            self.states = torch.tensor([s["state"] for s in samples], dtype=torch.float32)
            self.labels = torch.tensor([s["label"] for s in samples], dtype=torch.float32)
            if self.is_v2:
                self.opp_raw = torch.tensor([s["opponent_raw"] for s in samples], dtype=torch.float32)
            else:
                self.opp_raw = None
            count = len(samples)
        fmt = "v2 (enriched)" if self.is_v2 else "v1 (legacy)"
        print(f"Loaded {count} hand eval samples from {path.name} [{fmt}]")

    def __len__(self):
        return len(self.states)

    def __getitem__(self, idx):
        state = self.states[idx]
        label = self.labels[idx]
        if self.is_v2:
            opp_raw = self.opp_raw[idx]
            return state, opp_raw, label
        else:
            return state, label


def train(args):
    is_v2 = getattr(args, "v2", False)

    print("Hand Evaluator Training")
    print(f"  Data:     {args.data}")
    print(f"  Format:   {'v2 (enriched state)' if is_v2 else 'v1 (legacy)'}")
    print(f"  Epochs:   {args.epochs}")
    print(f"  LR:       {args.lr}")
    print(f"  Batch:    {args.batch_size}")
    print()

    dataset = HandEvalDataset(args.data)

    # 90/10 train/val split
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    if is_v2:
        net = HandEvalNet(input_size=ENRICHED_STATE_SIZE)
        encoder = OpponentEncoderNet()
        # Joint optimizer for both networks
        all_params = list(net.parameters()) + list(encoder.parameters())
        optimizer = optim.Adam(all_params, lr=args.lr)
    else:
        net = HandEvalNet(input_size=RICH_STATE_SIZE)
        encoder = None
        optimizer = optim.Adam(net.parameters(), lr=args.lr)

    criterion = nn.MSELoss()

    model_path = MODELS_DIR / "hand_evaluator.pt"
    encoder_path = MODELS_DIR / "opponent_encoder.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        # Train
        net.train()
        if encoder is not None:
            encoder.train()
        train_loss = 0.0
        for batch in train_loader:
            optimizer.zero_grad()
            if is_v2:
                base_state, opp_raw, labels = batch
                enriched = build_enriched_state(base_state, opp_raw, encoder)
                preds = net(enriched)
            else:
                states, labels = batch
                preds = net(states)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(labels)
        train_loss /= train_size

        # Validate
        net.eval()
        if encoder is not None:
            encoder.eval()
        val_loss = 0.0
        correct_high = 0  # predictions >0.8 where label >0.5
        total_high = 0
        embed_l2_sum = 0.0
        embed_count = 0
        with torch.no_grad():
            for batch in val_loader:
                if is_v2:
                    base_state, opp_raw, labels = batch
                    enriched = build_enriched_state(base_state, opp_raw, encoder)
                    preds = net(enriched)
                    # Monitor encoder embedding norms to detect collapse
                    opp_embeddings = encoder(opp_raw)
                    embed_l2_sum += opp_embeddings.norm(dim=1).sum().item()
                    embed_count += opp_embeddings.shape[0]
                else:
                    states, labels = batch
                    preds = net(states)
                val_loss += criterion(preds, labels).item() * len(labels)
                # Accuracy: when we predict "close to melding" (>0.8), is label >0.5?
                high_mask = preds > 0.8
                if high_mask.any():
                    total_high += high_mask.sum().item()
                    correct_high += ((labels > 0.5) & high_mask).sum().item()
        val_loss /= val_size

        high_acc = correct_high / total_high * 100 if total_high > 0 else 0

        log_line = (
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Train loss: {train_loss:.6f} | "
            f"Val loss: {val_loss:.6f} | "
            f"High-pred accuracy: {high_acc:.1f}% ({correct_high}/{total_high})"
        )
        if is_v2 and embed_count > 0:
            avg_l2 = embed_l2_sum / embed_count
            log_line += f" | Embed L2: {avg_l2:.4f}"
            if avg_l2 < 0.01:
                log_line += " [WARNING: possible encoder collapse]"
        print(log_line)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            if is_v2 and encoder is not None:
                torch.save(encoder.state_dict(), encoder_path)
            print(f"  => Saved best model (val loss: {val_loss:.6f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.6f}")
    print(f"Model saved to {model_path}")
    if is_v2:
        print(f"Encoder saved to {encoder_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train hand evaluator network")
    parser.add_argument("--data", type=str, required=True, help="Path to hand eval JSON data")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    parser.add_argument("--v2", action="store_true", help="Use v2 data format with opponent encoder")
    args = parser.parse_args()
    train(args)
