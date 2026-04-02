"""
Imitation learning pre-training — teaches the model from expert game data.

Loads expert (state, action) pairs from ml/data/expert_games.json and trains
the policy head via supervised cross-entropy loss. This gives the model a
warm start before RL self-play training.

Usage:
    python pretrain.py --epochs 10 --lr 0.001 --batch-size 128
"""

import argparse
import json
import random
from pathlib import Path

import torch
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

from network import ShanghaiNet, STATE_SIZE, MAX_ACTIONS

MODELS_DIR = Path(__file__).parent.parent / "models"
DATA_DIR = Path(__file__).parent.parent / "data"


class ExpertDataset(Dataset):
    """Dataset of (state, action) pairs from expert play."""

    def __init__(self, data_path: Path):
        with open(data_path) as f:
            data = json.load(f)

        self.states = []
        self.actions = []

        for game in data["games"]:
            for state, action in zip(game["states"], game["actions"]):
                # Filter out invalid action indices
                if 0 <= action < MAX_ACTIONS:
                    self.states.append(state)
                    self.actions.append(action)

        print(f"Loaded {len(self.states)} expert decisions from {len(data['games'])} games")
        print(f"Metadata: {json.dumps(data['metadata'], indent=2)}")

    def __len__(self):
        return len(self.states)

    def __getitem__(self, idx):
        return (
            torch.tensor(self.states[idx], dtype=torch.float32),
            torch.tensor(self.actions[idx], dtype=torch.long),
        )


def train(args):
    print(f"Imitation Learning Pre-training")
    print(f"  Epochs: {args.epochs}")
    print(f"  Learning rate: {args.lr}")
    print(f"  Batch size: {args.batch_size}")
    print()

    # Load data
    data_path = DATA_DIR / "expert_games.json"
    if not data_path.exists():
        print(f"Error: {data_path} not found. Run expert-play.ts first.")
        return

    dataset = ExpertDataset(data_path)
    # Split 90/10 train/val
    val_size = max(1, len(dataset) // 10)
    train_size = len(dataset) - val_size
    train_set, val_set = torch.utils.data.random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    print(f"  Train: {train_size} samples, Val: {val_size} samples\n")

    # Create model
    net = ShanghaiNet(state_size=STATE_SIZE)
    optimizer = optim.Adam(net.parameters(), lr=args.lr)

    best_val_acc = 0.0
    model_path = MODELS_DIR / "shanghai_policy.pt"
    best_path = MODELS_DIR / "shanghai_policy_best.pt"

    for epoch in range(1, args.epochs + 1):
        # Train
        net.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for states, actions in train_loader:
            policy_logits, _ = net(states)
            loss = F.cross_entropy(policy_logits, actions)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            optimizer.step()

            train_loss += loss.item() * states.size(0)
            preds = policy_logits.argmax(dim=1)
            train_correct += (preds == actions).sum().item()
            train_total += states.size(0)

        # Validate
        net.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for states, actions in val_loader:
                policy_logits, _ = net(states)
                loss = F.cross_entropy(policy_logits, actions)
                val_loss += loss.item() * states.size(0)
                preds = policy_logits.argmax(dim=1)
                val_correct += (preds == actions).sum().item()
                val_total += states.size(0)

        train_acc = 100 * train_correct / train_total
        val_acc = 100 * val_correct / val_total
        avg_train_loss = train_loss / train_total
        avg_val_loss = val_loss / val_total

        saved = ""
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(net.state_dict(), best_path)
            saved = " => Best model saved!"

        print(
            f"Epoch {epoch:3d} | "
            f"Train loss: {avg_train_loss:.4f} acc: {train_acc:.1f}% | "
            f"Val loss: {avg_val_loss:.4f} acc: {val_acc:.1f}%{saved}"
        )

    # Save final model
    torch.save(net.state_dict(), model_path)
    print(f"\nPre-training complete.")
    print(f"  Best val accuracy: {best_val_acc:.1f}%")
    print(f"  Model saved to: {model_path}")
    print(f"  Best model saved to: {best_path}")
    print(f"\nNext: run self-play RL with --from-best to continue training")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pre-train Shanghai AI from expert data")
    parser.add_argument("--epochs", type=int, default=10, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size")
    args = parser.parse_args()
    train(args)
