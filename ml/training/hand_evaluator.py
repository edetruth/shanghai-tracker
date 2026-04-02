"""
Hand Evaluator — scores how close a hand is to melding (0-1).

Train:  python hand_evaluator.py --data ml/data/hybrid_training/hand_eval_TIMESTAMP.json
Eval:   python hand_evaluator.py --evaluate --model hand_evaluator.pt
"""

import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split

from state_encoder import RICH_STATE_SIZE

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


class HandEvalNet(nn.Module):
    """Small regression network: 273 features -> single 0-1 score."""

    def __init__(self, input_size: int = RICH_STATE_SIZE):
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
    """Loads hand evaluator training data from JSON."""

    def __init__(self, path: str):
        with open(path) as f:
            data = json.load(f)
        self.samples = data["samples"]
        print(f"Loaded {len(self.samples)} hand eval samples from {path}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        label = torch.tensor(s["label"], dtype=torch.float32)
        return state, label


def train(args):
    print("Hand Evaluator Training")
    print(f"  Data:     {args.data}")
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

    net = HandEvalNet()
    optimizer = optim.Adam(net.parameters(), lr=args.lr)
    criterion = nn.MSELoss()

    model_path = MODELS_DIR / "hand_evaluator.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        # Train
        net.train()
        train_loss = 0.0
        for states, labels in train_loader:
            optimizer.zero_grad()
            preds = net(states)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(states)
        train_loss /= train_size

        # Validate
        net.eval()
        val_loss = 0.0
        correct_high = 0  # predictions >0.8 where label >0.5
        total_high = 0
        with torch.no_grad():
            for states, labels in val_loader:
                preds = net(states)
                val_loss += criterion(preds, labels).item() * len(states)
                # Accuracy: when we predict "close to melding" (>0.8), is label >0.5?
                high_mask = preds > 0.8
                if high_mask.any():
                    total_high += high_mask.sum().item()
                    correct_high += ((labels > 0.5) & high_mask).sum().item()
        val_loss /= val_size

        high_acc = correct_high / total_high * 100 if total_high > 0 else 0

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Train loss: {train_loss:.6f} | "
            f"Val loss: {val_loss:.6f} | "
            f"High-pred accuracy: {high_acc:.1f}% ({correct_high}/{total_high})"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            print(f"  => Saved best model (val loss: {val_loss:.6f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.6f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train hand evaluator network")
    parser.add_argument("--data", type=str, required=True, help="Path to hand eval JSON data")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    args = parser.parse_args()
    train(args)
