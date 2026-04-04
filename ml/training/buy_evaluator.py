"""
Buy Evaluator — decides whether to buy an offered card (binary yes/no).

Uses the hand evaluator to compute labels: buy when the offered card
improves the hand score by more than a threshold.

Train:  python buy_evaluator.py --data ml/data/hybrid_training/buy_TIMESTAMP.json
"""

import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split

from state_encoder import RICH_STATE_SIZE, ENRICHED_STATE_SIZE
from hand_evaluator import HandEvalNet
from opponent_encoder import OpponentEncoderNet, build_enriched_state

MODELS_DIR = Path(__file__).parent.parent / "models"

# 6 features for offered card: rank/13, suit_onehot(4), is_joker
OFFERED_CARD_FEATURES = 6


class BuyEvalNet(nn.Module):
    """Binary classifier: should the agent buy the offered card?"""

    def __init__(self, input_size: int = ENRICHED_STATE_SIZE + 1 + OFFERED_CARD_FEATURES):
        # v2: 312 enriched state + 1 hand eval score + 6 offered card features = 319
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def encode_offered_card(card: dict) -> list:
    """Encode an offered card as 6 features matching the bridge encoding."""
    suit_map = {
        "hearts": [1, 0, 0, 0],
        "diamonds": [0, 1, 0, 0],
        "clubs": [0, 0, 1, 0],
        "spades": [0, 0, 0, 1],
        "joker": [0, 0, 0, 0],
    }
    rank_map = {
        "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
        "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13,
    }
    suit = card.get("suit", "joker")
    rank = card.get("rank", "A")
    is_joker = 1.0 if suit == "joker" else 0.0
    rank_val = rank_map.get(str(rank), 1) / 13.0
    return [rank_val] + suit_map.get(suit, [0, 0, 0, 0]) + [is_joker]


def compute_buy_labels(
    buy_samples: list,
    hand_eval: HandEvalNet,
    threshold: float = 0.1,
    encoder: OpponentEncoderNet | None = None,
) -> list:
    """Label buy decisions: 1 if offered card improves hand eval by > threshold.

    When encoder is provided and samples contain "opponent_raw", uses v2 enriched
    state for scoring. Otherwise falls back to v1 base state.
    """
    hand_eval.eval()
    if encoder is not None:
        encoder.eval()
    labeled = []

    for i, sample in enumerate(buy_samples):
        state = torch.tensor(sample["state"], dtype=torch.float32)
        offered = sample["offered_card"]
        if not offered:
            continue

        is_v2 = encoder is not None and "opponent_raw" in sample
        if is_v2:
            opp_raw = torch.tensor(sample["opponent_raw"], dtype=torch.float32)

        with torch.no_grad():
            if is_v2:
                enriched = build_enriched_state(
                    state.unsqueeze(0), opp_raw.unsqueeze(0), encoder
                )
                current_score = hand_eval(enriched).item()
            else:
                current_score = hand_eval(state.unsqueeze(0)).item()

        # Approximate: adding the offered card by encoding it into an empty hand slot
        # Find first empty slot (all zeros in the 6-feature block)
        modified = state.clone()
        card_features = encode_offered_card(offered)
        slot_found = False
        for si in range(22):
            start = si * 6
            if modified[start:start + 6].sum().item() == 0:
                modified[start:start + 6] = torch.tensor(card_features)
                slot_found = True
                break

        if not slot_found:
            continue

        with torch.no_grad():
            if is_v2:
                modified_enriched = build_enriched_state(
                    modified.unsqueeze(0), opp_raw.unsqueeze(0), encoder
                )
                new_score = hand_eval(modified_enriched).item()
            else:
                new_score = hand_eval(modified.unsqueeze(0)).item()

        improvement = new_score - current_score
        should_buy = 1 if improvement > threshold else 0

        entry = {
            "state": sample["state"],
            "hand_eval_score": current_score,
            "offered_card": card_features,
            "label": should_buy,
        }
        if is_v2:
            entry["opponent_raw"] = sample["opponent_raw"]
        labeled.append(entry)

        if (i + 1) % 10000 == 0:
            print(f"  Labeled {i+1}/{len(buy_samples)} buy samples")

    return labeled


class BuyDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples
        self.is_v2 = "opponent_raw" in self.samples[0] if self.samples else False

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        offered = torch.tensor(s["offered_card"], dtype=torch.float32)
        label = torch.tensor(s["label"], dtype=torch.float32)
        if self.is_v2:
            opp_raw = torch.tensor(s["opponent_raw"], dtype=torch.float32)
            return state, opp_raw, hand_score, offered, label
        else:
            features = torch.cat([state, hand_score, offered])
            return features, label


def train(args):
    v2 = getattr(args, "v2", False)
    print(f"Buy Evaluator Training {'(V2)' if v2 else '(V1)'}")
    print(f"  Data:       {args.data}")
    print(f"  Evaluator:  {args.evaluator}")
    print(f"  Threshold:  {args.threshold}")
    print(f"  Epochs:     {args.epochs}")
    print()

    # Load hand evaluator
    eval_input_size = ENRICHED_STATE_SIZE if v2 else RICH_STATE_SIZE
    hand_eval = HandEvalNet(input_size=eval_input_size)
    eval_path = MODELS_DIR / args.evaluator
    hand_eval.load_state_dict(torch.load(eval_path, weights_only=True))
    hand_eval.eval()
    print(f"Loaded hand evaluator from {eval_path}")

    # Load opponent encoder for v2
    encoder = None
    if v2:
        encoder = OpponentEncoderNet()
        encoder_path = MODELS_DIR / "opponent_encoder.pt"
        encoder.load_state_dict(torch.load(encoder_path, weights_only=True))
        print(f"Loaded opponent encoder from {encoder_path}")

    # Load raw data
    data_path = Path(args.data)
    if data_path.suffix == ".pt":
        raw_data = torch.load(data_path, weights_only=False)
        # Reconstruct sample dicts for compute_buy_labels
        samples = []
        has_opp = "opponent_raw" in raw_data
        for i in range(raw_data["count"]):
            s = {
                "state": raw_data["states"][i].tolist(),
                "offered_card": raw_data["offered_cards"][i],
            }
            if has_opp:
                s["opponent_raw"] = raw_data["opponent_raw"][i].tolist()
            samples.append(s)
        print(f"Loaded {raw_data['count']} raw buy samples from {data_path.name}")
    else:
        with open(data_path) as f:
            raw = json.load(f)
        samples = raw["samples"]
        print(f"Loaded {raw['count']} raw buy samples")

    print("Computing buy labels via hand eval proxy...")
    labeled = compute_buy_labels(
        samples, hand_eval, threshold=args.threshold, encoder=encoder
    )
    buy_count = sum(s["label"] for s in labeled)
    print(f"Labeled {len(labeled)} samples ({buy_count} buy, {len(labeled) - buy_count} pass)")

    dataset = BuyDataset(labeled)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    if v2:
        net = BuyEvalNet()  # default: ENRICHED_STATE_SIZE + 1 + 6 = 319
        optimizer = optim.Adam([
            {"params": net.parameters(), "lr": args.lr},
            {"params": encoder.parameters(), "lr": args.lr * 0.1},
        ])
    else:
        net = BuyEvalNet(input_size=RICH_STATE_SIZE + 1 + OFFERED_CARD_FEATURES)
        optimizer = optim.Adam(net.parameters(), lr=args.lr)

    criterion = nn.BCELoss()

    model_path = MODELS_DIR / "buy_evaluator.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        if v2:
            encoder.train()
        train_loss = 0.0

        if v2:
            for base_state, opp_raw, hand_score, offered, labels in train_loader:
                optimizer.zero_grad()
                enriched = build_enriched_state(base_state, opp_raw, encoder)
                features = torch.cat([enriched, hand_score, offered], dim=1)
                preds = net(features)
                loss = criterion(preds, labels)
                loss.backward()
                optimizer.step()
                train_loss += loss.item() * len(labels)
        else:
            for features, labels in train_loader:
                optimizer.zero_grad()
                preds = net(features)
                loss = criterion(preds, labels)
                loss.backward()
                optimizer.step()
                train_loss += loss.item() * len(features)
        train_loss /= train_size

        net.eval()
        if v2:
            encoder.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            if v2:
                for base_state, opp_raw, hand_score, offered, labels in val_loader:
                    enriched = build_enriched_state(base_state, opp_raw, encoder)
                    features = torch.cat([enriched, hand_score, offered], dim=1)
                    preds = net(features)
                    val_loss += criterion(preds, labels).item() * len(labels)
                    predicted = (preds > 0.5).float()
                    val_correct += (predicted == labels).sum().item()
                    val_total += len(labels)
            else:
                for features, labels in val_loader:
                    preds = net(features)
                    val_loss += criterion(preds, labels).item() * len(features)
                    predicted = (preds > 0.5).float()
                    val_correct += (predicted == labels).sum().item()
                    val_total += len(features)
        val_loss /= val_size
        val_acc = val_correct / val_total * 100

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Train loss: {train_loss:.4f} | "
            f"Val loss: {val_loss:.4f} | "
            f"Val acc: {val_acc:.1f}%"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(net.state_dict(), model_path)
            if v2:
                torch.save(encoder.state_dict(), MODELS_DIR / "opponent_encoder.pt")
            print(f"  => Saved best model (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    from log_utils import setup_logging
    setup_logging("buy_evaluator")
    parser = argparse.ArgumentParser(description="Train buy evaluator network")
    parser.add_argument("--data", type=str, required=True, help="Path to buy JSON data")
    parser.add_argument("--evaluator", type=str, default="hand_evaluator.pt", help="Hand evaluator model filename")
    parser.add_argument("--threshold", type=float, default=0.1, help="Improvement threshold for buy label")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    parser.add_argument("--v2", action="store_true", help="Use v2 enriched state with opponent encoder")
    args = parser.parse_args()
    train(args)
