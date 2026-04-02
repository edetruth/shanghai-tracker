"""
Discard Policy — chooses which card to discard after drawing.

Uses the hand evaluator to compute optimal discard labels:
for each possible discard, score the remaining hand, best = label.

Train:  python discard_policy.py --data ml/data/hybrid_training/discard_TIMESTAMP.json
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
from hand_evaluator import HandEvalNet

MODELS_DIR = Path(__file__).parent.parent / "models"
MAX_HAND = 22


class DiscardPolicyNet(nn.Module):
    """Scores each card slot for discard quality. Highest = best discard."""

    def __init__(self, input_size: int = RICH_STATE_SIZE + 1):
        # +1 for hand evaluator score of current hand
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, MAX_HAND),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def compute_optimal_discards(discard_samples: list, hand_eval_net: HandEvalNet) -> list:
    """
    For each discard sample, compute the optimal discard by brute force:
    remove each card, re-encode the hand features in the state vector,
    score with hand evaluator, pick the card whose removal gives the best score.

    Since re-encoding requires the bridge, we approximate: zero out each
    card's 6-feature slot in the state vector and re-score. This is imperfect
    but fast and sufficient for training labels.
    """
    hand_eval_net.eval()
    labeled = []

    for i, sample in enumerate(discard_samples):
        state = torch.tensor(sample["state"], dtype=torch.float32)
        hand_size = sample["hand_size"]

        if hand_size <= 1:
            continue

        # Try removing each card (zero out its 6-feature slot in positions 0..131)
        best_score = -1.0
        best_idx = 0
        scores = []

        for ci in range(min(hand_size, MAX_HAND)):
            modified = state.clone()
            # Zero out card slot ci (6 features starting at ci * 6)
            start = ci * 6
            end = start + 6
            modified[start:end] = 0.0
            with torch.no_grad():
                score = hand_eval_net(modified.unsqueeze(0)).item()
            scores.append(score)
            if score > best_score:
                best_score = score
                best_idx = ci

        labeled.append({
            "state": sample["state"],
            "hand_eval_score": hand_eval_net(state.unsqueeze(0)).item(),
            "optimal_discard": best_idx,
            "hand_size": hand_size,
        })

        if (i + 1) % 10000 == 0:
            print(f"  Labeled {i+1}/{len(discard_samples)} discard samples")

    return labeled


class DiscardDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        features = torch.cat([state, hand_score])
        label = s["optimal_discard"]
        mask = torch.zeros(MAX_HAND)
        mask[:s["hand_size"]] = 1.0
        return features, label, mask


def train(args):
    print("Discard Policy Training")
    print(f"  Data:       {args.data}")
    print(f"  Evaluator:  {args.evaluator}")
    print(f"  Epochs:     {args.epochs}")
    print()

    # Load hand evaluator
    hand_eval = HandEvalNet()
    eval_path = MODELS_DIR / args.evaluator
    hand_eval.load_state_dict(torch.load(eval_path, weights_only=True))
    hand_eval.eval()
    print(f"Loaded hand evaluator from {eval_path}")

    # Load raw discard data
    with open(args.data) as f:
        raw = json.load(f)
    print(f"Loaded {raw['count']} raw discard samples")

    # Compute optimal discard labels using hand evaluator
    print("Computing optimal discard labels (brute force)...")
    labeled = compute_optimal_discards(raw["samples"], hand_eval)
    print(f"Labeled {len(labeled)} samples")

    dataset = DiscardDataset(labeled)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    net = DiscardPolicyNet()
    optimizer = optim.Adam(net.parameters(), lr=args.lr)
    criterion = nn.CrossEntropyLoss()

    model_path = MODELS_DIR / "discard_policy.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0
        for features, labels, masks in train_loader:
            optimizer.zero_grad()
            logits = net(features)
            # Mask invalid hand slots
            logits = logits + (masks - 1.0) * 1e9
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(features)
            train_correct += (logits.argmax(dim=1) == labels).sum().item()
            train_total += len(features)
        train_loss /= train_size
        train_acc = train_correct / train_total * 100

        net.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for features, labels, masks in val_loader:
                logits = net(features)
                logits = logits + (masks - 1.0) * 1e9
                val_loss += criterion(logits, labels).item() * len(features)
                val_correct += (logits.argmax(dim=1) == labels).sum().item()
                val_total += len(features)
        val_loss /= val_size
        val_acc = val_correct / val_total * 100

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Train loss: {train_loss:.4f} acc: {train_acc:.1f}% | "
            f"Val loss: {val_loss:.4f} acc: {val_acc:.1f}%"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            print(f"  => Saved best model (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train discard policy network")
    parser.add_argument("--data", type=str, required=True, help="Path to discard JSON data")
    parser.add_argument("--evaluator", type=str, default="hand_evaluator.pt", help="Hand evaluator model filename")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    args = parser.parse_args()
    train(args)
