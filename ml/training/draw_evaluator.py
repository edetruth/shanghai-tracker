"""
Draw Evaluator — decides whether to take the face-up discard or draw blind.

Uses hand evaluator proxy for labels: simulate both options, pick better one.

Train:  python draw_evaluator.py --data ml/data/hybrid_training_v2/draw_TIMESTAMP.json
"""

import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split

from state_encoder import ENRICHED_STATE_SIZE, OFFERED_CARD_FEATURES
from hand_evaluator import HandEvalNet
from opponent_encoder import OpponentEncoderNet, build_enriched_state
from buy_evaluator import encode_offered_card

MODELS_DIR = Path(__file__).parent.parent / "models"

# Input: enriched state (312) + hand eval score (1) + offered card (6) = 319
DRAW_INPUT_SIZE = ENRICHED_STATE_SIZE + 1 + OFFERED_CARD_FEATURES


class DrawEvalNet(nn.Module):
    """Binary classifier: should the agent take the discard?"""

    def __init__(self, input_size: int = DRAW_INPUT_SIZE):
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


def compute_draw_labels(
    draw_samples: list,
    hand_eval: HandEvalNet,
    encoder: OpponentEncoderNet,
) -> list:
    """
    Label draw decisions using hand eval proxy:
    - Simulate taking discard: encode card into hand, score with hand eval
    - Compare against current score (drawing blind = no expected improvement)
    - Label = 1 if taking discard gives better score, else 0
    """
    hand_eval.eval()
    encoder.eval()
    labeled = []

    for i, sample in enumerate(draw_samples):
        base_state = torch.tensor(sample["state"], dtype=torch.float32)
        opp_raw = torch.tensor(sample["opponent_raw"], dtype=torch.float32)
        offered = sample["offered_card"]
        if not offered:
            continue

        with torch.no_grad():
            enriched = build_enriched_state(
                base_state.unsqueeze(0), opp_raw.unsqueeze(0), encoder
            )
            current_score = hand_eval(enriched).item()

        # Simulate taking the discard: encode into first empty hand slot
        modified_base = base_state.clone()
        card_features = encode_offered_card(offered)
        for si in range(22):
            start = si * 6
            if modified_base[start:start + 6].sum().item() == 0:
                modified_base[start:start + 6] = torch.tensor(card_features)
                break

        with torch.no_grad():
            modified_enriched = build_enriched_state(
                modified_base.unsqueeze(0), opp_raw.unsqueeze(0), encoder
            )
            take_score = hand_eval(modified_enriched).item()

        should_take = 1 if take_score > current_score else 0

        labeled.append({
            "state": sample["state"],
            "opponent_raw": sample["opponent_raw"],
            "hand_eval_score": current_score,
            "offered_card": card_features,
            "label": should_take,
        })

        if (i + 1) % 10000 == 0:
            print(f"  Labeled {i+1}/{len(draw_samples)} draw samples")

    return labeled


class DrawDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        opp_raw = torch.tensor(s["opponent_raw"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        offered = torch.tensor(s["offered_card"], dtype=torch.float32)
        label = torch.tensor(s["label"], dtype=torch.float32)
        return state, opp_raw, hand_score, offered, label


def train(args):
    print("Draw Evaluator Training (V2)")
    print(f"  Data:   {args.data}")
    print(f"  Epochs: {args.epochs}")
    print()

    # Load hand evaluator and opponent encoder (for label computation)
    hand_eval = HandEvalNet(input_size=ENRICHED_STATE_SIZE)
    hand_eval.load_state_dict(torch.load(MODELS_DIR / "hand_evaluator.pt", weights_only=True))
    hand_eval.eval()

    encoder = OpponentEncoderNet()
    encoder.load_state_dict(torch.load(MODELS_DIR / "opponent_encoder.pt", weights_only=True))
    print("Loaded hand evaluator and opponent encoder")

    # Load raw draw data
    with open(args.data) as f:
        raw = json.load(f)
    print(f"Loaded {raw['count']} raw draw samples")

    # Compute labels
    print("Computing draw labels via hand eval proxy...")
    labeled = compute_draw_labels(raw["samples"], hand_eval, encoder)
    take_count = sum(s["label"] for s in labeled)
    print(f"Labeled {len(labeled)} samples ({take_count} take, {len(labeled) - take_count} draw)")

    dataset = DrawDataset(labeled)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    net = DrawEvalNet()
    # Fine-tune encoder at 0.1x LR
    optimizer = optim.Adam([
        {"params": net.parameters(), "lr": args.lr},
        {"params": encoder.parameters(), "lr": args.lr * 0.1},
    ])
    criterion = nn.BCELoss()

    model_path = MODELS_DIR / "draw_evaluator.pt"
    encoder_path = MODELS_DIR / "opponent_encoder.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        encoder.train()
        train_loss = 0.0

        for base_state, opp_raw, hand_score, offered, labels in train_loader:
            optimizer.zero_grad()
            enriched = build_enriched_state(base_state, opp_raw, encoder)
            features = torch.cat([enriched, hand_score, offered], dim=1)
            preds = net(features)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(labels)
        train_loss /= train_size

        net.eval()
        encoder.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        val_take = 0
        with torch.no_grad():
            for base_state, opp_raw, hand_score, offered, labels in val_loader:
                enriched = build_enriched_state(base_state, opp_raw, encoder)
                features = torch.cat([enriched, hand_score, offered], dim=1)
                preds = net(features)
                val_loss += criterion(preds, labels).item() * len(labels)
                predicted = (preds > 0.5).float()
                val_correct += (predicted == labels).sum().item()
                val_take += predicted.sum().item()
                val_total += len(labels)
        val_loss /= val_size
        val_acc = val_correct / val_total * 100
        take_pct = val_take / val_total * 100

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Train loss: {train_loss:.4f} | "
            f"Val loss: {val_loss:.4f} | "
            f"Val acc: {val_acc:.1f}% | "
            f"Take%: {take_pct:.1f}%"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            torch.save(encoder.state_dict(), encoder_path)
            print(f"  => Saved (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train draw evaluator network")
    parser.add_argument("--data", type=str, required=True, help="Path to draw JSON data")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    args = parser.parse_args()
    train(args)
