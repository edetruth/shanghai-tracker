"""
Discard Policy — chooses which card to discard after drawing.

Uses the hand evaluator to compute optimal discard labels:
for each possible discard, score the remaining hand, best = label.

Train:  python discard_policy.py --data ml/data/hybrid_training/discard_TIMESTAMP.json
"""

import argparse
import json
import random
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split

from state_encoder import RICH_STATE_SIZE, ENRICHED_STATE_SIZE
from hand_evaluator import HandEvalNet
from opponent_encoder import OpponentEncoderNet, build_enriched_state

MODELS_DIR = Path(__file__).parent.parent / "models"
MAX_HAND = 22


class DiscardPolicyNet(nn.Module):
    """Scores each card slot for discard quality. Highest = best discard."""

    def __init__(self, input_size: int = ENRICHED_STATE_SIZE + 1):
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


def compute_optimal_discards(
    discard_samples: list,
    hand_eval_net: HandEvalNet,
    encoder: OpponentEncoderNet | None = None,
) -> list:
    """
    For each discard sample, compute the optimal discard by brute force:
    remove each card, re-encode the hand features in the state vector,
    score with hand evaluator, pick the card whose removal gives the best score.

    Since re-encoding requires the bridge, we approximate: zero out each
    card's 6-feature slot in the state vector and re-score. This is imperfect
    but fast and sufficient for training labels.

    When encoder is provided and samples contain "opponent_raw", uses v2
    enriched state for scoring. Otherwise falls back to v1 base state.
    """
    hand_eval_net.eval()
    if encoder is not None:
        encoder.eval()
    labeled = []

    for i, sample in enumerate(discard_samples):
        state = torch.tensor(sample["state"], dtype=torch.float32)
        hand_size = sample["hand_size"]

        if hand_size <= 1:
            continue

        is_v2 = encoder is not None and "opponent_raw" in sample
        if is_v2:
            opp_raw = torch.tensor(sample["opponent_raw"], dtype=torch.float32)

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
                if is_v2:
                    enriched = build_enriched_state(
                        modified.unsqueeze(0), opp_raw.unsqueeze(0), encoder
                    )
                    score = hand_eval_net(enriched).item()
                else:
                    score = hand_eval_net(modified.unsqueeze(0)).item()
            scores.append(score)
            if score > best_score:
                best_score = score
                best_idx = ci

        # Score current (unmodified) hand
        with torch.no_grad():
            if is_v2:
                enriched_current = build_enriched_state(
                    state.unsqueeze(0), opp_raw.unsqueeze(0), encoder
                )
                current_score = hand_eval_net(enriched_current).item()
            else:
                current_score = hand_eval_net(state.unsqueeze(0)).item()

        entry = {
            "state": sample["state"],
            "hand_eval_score": current_score,
            "optimal_discard": best_idx,
            "hand_size": hand_size,
        }
        if is_v2:
            entry["opponent_raw"] = sample["opponent_raw"]
        labeled.append(entry)

        if (i + 1) % 10000 == 0:
            print(f"  Labeled {i+1}/{len(discard_samples)} discard samples")

    return labeled


class DiscardDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples
        self.is_v2 = "opponent_raw" in self.samples[0] if self.samples else False

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        label = s["optimal_discard"]
        mask = torch.zeros(MAX_HAND)
        mask[:s["hand_size"]] = 1.0
        if self.is_v2:
            opp_raw = torch.tensor(s["opponent_raw"], dtype=torch.float32)
            return state, opp_raw, hand_score, label, mask
        else:
            features = torch.cat([state, hand_score])
            return features, label, mask


def train(args):
    v2 = getattr(args, "v2", False)
    print(f"Discard Policy Training {'(V2)' if v2 else '(V1)'}")
    print(f"  Data:       {args.data}")
    print(f"  Evaluator:  {args.evaluator}")
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

    # Load raw discard data
    data_path = Path(args.data)
    if data_path.suffix == ".pt":
        raw_data = torch.load(data_path, weights_only=False)
        # Reconstruct sample dicts for compute_optimal_discards
        samples = []
        has_opp = "opponent_raw" in raw_data
        for i in range(raw_data["count"]):
            s = {
                "state": raw_data["states"][i].tolist(),
                "hand_size": raw_data["hand_sizes"][i].item(),
            }
            if has_opp:
                s["opponent_raw"] = raw_data["opponent_raw"][i].tolist()
            samples.append(s)
        print(f"Loaded {raw_data['count']} raw discard samples from {data_path.name}")
    else:
        with open(data_path) as f:
            raw = json.load(f)
        samples = raw["samples"]
        print(f"Loaded {raw['count']} raw discard samples")
    if args.max_samples and args.max_samples < len(samples):
        print(f"Subsampling {args.max_samples} of {len(samples)} samples...")
        samples = random.sample(samples, args.max_samples)

    # Compute optimal discard labels using hand evaluator
    print("Computing optimal discard labels (brute force)...")
    labeled = compute_optimal_discards(samples, hand_eval, encoder=encoder)
    print(f"Labeled {len(labeled)} samples")

    dataset = DiscardDataset(labeled)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    if v2:
        net = DiscardPolicyNet()  # default: ENRICHED_STATE_SIZE + 1 = 313
        optimizer = optim.Adam([
            {"params": net.parameters(), "lr": args.lr},
            {"params": encoder.parameters(), "lr": args.lr * 0.1},
        ])
    else:
        net = DiscardPolicyNet(input_size=RICH_STATE_SIZE + 1)
        optimizer = optim.Adam(net.parameters(), lr=args.lr)

    criterion = nn.CrossEntropyLoss()

    model_path = MODELS_DIR / "discard_policy.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        if v2:
            encoder.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        if v2:
            for base_state, opp_raw, hand_score, labels, masks in train_loader:
                optimizer.zero_grad()
                enriched = build_enriched_state(base_state, opp_raw, encoder)
                features = torch.cat([enriched, hand_score], dim=1)
                logits = net(features)
                logits = logits + (masks - 1.0) * 1e9
                loss = criterion(logits, labels)
                loss.backward()
                optimizer.step()
                train_loss += loss.item() * len(labels)
                train_correct += (logits.argmax(dim=1) == labels).sum().item()
                train_total += len(labels)
        else:
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
        if v2:
            encoder.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            if v2:
                for base_state, opp_raw, hand_score, labels, masks in val_loader:
                    enriched = build_enriched_state(base_state, opp_raw, encoder)
                    features = torch.cat([enriched, hand_score], dim=1)
                    logits = net(features)
                    logits = logits + (masks - 1.0) * 1e9
                    val_loss += criterion(logits, labels).item() * len(labels)
                    val_correct += (logits.argmax(dim=1) == labels).sum().item()
                    val_total += len(labels)
            else:
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
            if v2:
                torch.save(encoder.state_dict(), MODELS_DIR / "opponent_encoder.pt")
            print(f"  => Saved best model (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    from log_utils import setup_logging
    setup_logging("discard_policy")
    parser = argparse.ArgumentParser(description="Train discard policy network")
    parser.add_argument("--data", type=str, required=True, help="Path to discard JSON data")
    parser.add_argument("--evaluator", type=str, default="hand_evaluator.pt", help="Hand evaluator model filename")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    parser.add_argument("--max-samples", type=int, default=None, help="Max samples to use (random subset)")
    parser.add_argument("--v2", action="store_true", help="Use v2 enriched state with opponent encoder")
    args = parser.parse_args()
    train(args)
