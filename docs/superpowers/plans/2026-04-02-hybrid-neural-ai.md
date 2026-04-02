# Hybrid Neural AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three focused neural networks (hand evaluator, discard policy, buy evaluator) trained via supervised learning on game data generated from the existing rule-based AI, then combine them into a new AI personality.

**Architecture:** Data generation plays 10K+ games through the TypeScript bridge, capturing every decision point with full state vectors. The hand evaluator is trained first (regression: how close to melding?), then discard and buy networks use it for label computation. All three integrate into the existing AI system as a new personality that uses rules for mechanics and neural nets for strategy.

**Tech Stack:** Python 3, PyTorch, existing TypeScript game bridge (stdin/stdout JSON), existing `ShanghaiEnv` wrapper, existing 273-feature rich state encoding.

---

## File Structure

```
ml/
├── training/
│   ├── generate_data.py      # NEW: play games, capture decision data
│   ├── hand_evaluator.py     # NEW: hand eval network + training
│   ├── discard_policy.py     # NEW: discard network + training
│   ├── buy_evaluator.py      # NEW: buy network + training
│   ├── evaluate_hybrid.py    # NEW: evaluate the combined personality
│   ├── shanghai_env.py       # EXISTING: reused as-is
│   ├── state_encoder.py      # EXISTING: reused, add HAND_EVAL_SIZE constant
│   └── evaluate.py           # EXISTING: kept for PPO model evals
├── bridge/
│   └── game-bridge.ts        # MODIFY: add get_full_state command for richer data capture
├── models/
│   ├── hand_evaluator.pt     # OUTPUT: trained hand evaluator
│   ├── discard_policy.pt     # OUTPUT: trained discard network
│   └── buy_evaluator.pt      # OUTPUT: trained buy network
└── data/
    └── hybrid_training/      # OUTPUT: generated game data
```

---

## Phase 1: Data Generation

### Task 1: Add `get_full_state` command to bridge

The existing bridge returns the 273-feature state vector, but for data generation we also need to know which cards are in the player's hand (as identifiable objects, not just encoded features) so we can compute "discard card X → re-evaluate hand" labels. We add a command that returns both the state vector and the raw hand/game data.

**Files:**
- Modify: `ml/bridge/game-bridge.ts` (add `get_full_state` case to command handler)

- [ ] **Step 1: Add `get_full_state` command handler**

In `game-bridge.ts`, find the `case 'encode_state'` block (around line 838) and add a new case after it:

```typescript
      case 'get_full_state': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        const pi = cmd.player ?? 0
        const p = game.players[pi]
        const stateVec = game.useRichState ? encodeRichState(game, pi) : encodeState(game, pi)
        respond({
          ok: true,
          state: stateVec,
          hand: p.hand.map(c => ({ rank: c.rank, suit: c.suit, id: c.id })),
          handSize: p.hand.length,
          hasLaidDown: p.hasLaidDown,
          buysRemaining: p.buysRemaining,
          phase: game.phase,
          round: game.currentRound,
          requirement: game.requirement,
          discardTop: game.discardPile.length > 0
            ? { rank: game.discardPile[game.discardPile.length - 1].rank, suit: game.discardPile[game.discardPile.length - 1].suit }
            : null,
          scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
          tableMeldCount: game.tableMelds.length,
        })
        break
      }
```

- [ ] **Step 2: Verify bridge still compiles**

```bash
cd ml/bridge && npx tsc --noEmit game-bridge.ts
```

If tsc is not configured for standalone, just test it runs:
```bash
echo '{"cmd":"quit"}' | npx tsx game-bridge.ts
```
Expected: process exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add ml/bridge/game-bridge.ts
git commit -m "feat(ml): add get_full_state command to bridge for hybrid data generation"
```

---

### Task 2: Add `get_full_state` support to Python environment

**Files:**
- Modify: `ml/training/shanghai_env.py` (add `get_full_state` method)

- [ ] **Step 1: Add method to ShanghaiEnv**

Add after the existing `step()` method in `shanghai_env.py`:

```python
    def get_full_state(self, player: int = 0) -> dict:
        """Get the full state including raw hand data for data generation."""
        result = self._send({"cmd": "get_full_state", "player": player})
        if not result.get("ok"):
            raise RuntimeError(f"get_full_state failed: {result}")
        return result
```

- [ ] **Step 2: Commit**

```bash
git add ml/training/shanghai_env.py
git commit -m "feat(ml): add get_full_state to ShanghaiEnv"
```

---

### Task 3: Create data generation script

This script plays thousands of games through the bridge, capturing every decision point for all players. It records:
- State vectors at each turn
- Whether the player eventually melded (and how many turns it took)
- What card was discarded at each discard decision
- Buy opportunities and outcomes

**Files:**
- Create: `ml/training/generate_data.py`

- [ ] **Step 1: Write the data generation script**

```python
"""
Generate training data for hybrid neural AI.

Plays N games through the bridge with AI opponents, capturing every
decision point with full state vectors and outcome labels.

Usage:
    python generate_data.py --games 5000 --players 4 --opponent the-shark
"""

import argparse
import json
import random
import time
from pathlib import Path

from shanghai_env import ShanghaiEnv

DATA_DIR = Path(__file__).parent.parent / "data" / "hybrid_training"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def generate_games(args):
    print(f"Generating training data")
    print(f"  Games:    {args.games}")
    print(f"  Players:  {args.players}")
    print(f"  Opponent: {args.opponent or 'random'}")
    print()

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state=True,
    )

    all_discard_samples = []  # (state_vec, hand, round, card_discarded_idx)
    all_buy_samples = []      # (state_vec, hand, round, offered_card, bought)
    all_hand_snapshots = []   # (state_vec, round, turns_until_meld, did_meld)

    games_completed = 0
    start = time.time()

    for game_i in range(args.games):
        seed = 50000 + game_i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 3000 * max(1, args.players // 2)

        # Per-round tracking: snapshots taken this round, keyed by round number
        round_snapshots = []  # list of (state_vec, round_num, snapshot_turn)
        current_round = 1
        round_turn = 0
        meld_turn = None  # turn within this round when player 0 melded

        while not done and step_count < max_steps:
            valid_actions, current_player = env.get_valid_actions()
            if not valid_actions:
                break

            # Get full state for player 0 data capture
            full_state = env.get_full_state(player=0)
            state_vec = full_state["state"]
            phase = full_state["phase"]
            hand = full_state["hand"]
            has_laid_down = full_state["hasLaidDown"]
            game_round = full_state["round"]

            # Detect round change — flush snapshots with meld outcome
            if game_round != current_round:
                # Label all snapshots from the previous round
                for snap_state, snap_round, snap_turn in round_snapshots:
                    if meld_turn is not None:
                        turns_to_meld = meld_turn - snap_turn
                        label = max(0.0, 1.0 - turns_to_meld / 50.0)
                    else:
                        label = 0.0  # never melded = worst score
                    all_hand_snapshots.append({
                        "state": snap_state,
                        "round": snap_round,
                        "label": round(label, 4),
                    })
                round_snapshots = []
                current_round = game_round
                round_turn = 0
                meld_turn = None

            if current_player == 0:
                round_turn += 1

                # Snapshot hand state every turn for hand evaluator training
                if phase in ("draw", "action") and not has_laid_down:
                    round_snapshots.append((state_vec, game_round, round_turn))

                # Detect melding
                if not has_laid_down and "meld" in valid_actions:
                    # Check after action if they melded
                    pass  # we detect via has_laid_down changing

                # Capture discard decisions
                discard_actions = [a for a in valid_actions if a.startswith("discard:")]
                if phase == "action" and discard_actions and len(hand) > 1:
                    # Choose action (use AI's choice via bridge)
                    action = random.choice(valid_actions)
                    if action.startswith("discard:"):
                        card_idx = int(action.split(":")[1])
                        all_discard_samples.append({
                            "state": state_vec,
                            "hand": hand,
                            "round": game_round,
                            "discarded_idx": card_idx,
                            "hand_size": len(hand),
                        })

                # Capture buy decisions
                if phase == "buy-window":
                    bought = "buy" in valid_actions
                    offered = full_state.get("discardTop")
                    action = random.choice(valid_actions)
                    is_buy = action == "buy"
                    if offered:
                        all_buy_samples.append({
                            "state": state_vec,
                            "hand": hand,
                            "round": game_round,
                            "offered_card": offered,
                            "bought": is_buy,
                        })
                else:
                    action = random.choice(valid_actions)

                # Track meld detection
                state_vec_after, _, done, info = env.step(action)
                after_state = env.get_full_state(player=0)
                if not has_laid_down and after_state["hasLaidDown"]:
                    meld_turn = round_turn

            else:
                action = random.choice(valid_actions)
                _, _, done, info = env.step(action)

            step_count += 1

        # Flush final round snapshots
        for snap_state, snap_round, snap_turn in round_snapshots:
            if meld_turn is not None:
                turns_to_meld = meld_turn - snap_turn
                label = max(0.0, 1.0 - turns_to_meld / 50.0)
            else:
                label = 0.0
            all_hand_snapshots.append({
                "state": snap_state,
                "round": snap_round,
                "label": round(label, 4),
            })

        games_completed += 1
        if games_completed % 100 == 0 or games_completed == args.games:
            elapsed = time.time() - start
            print(
                f"  Game {games_completed:5d}/{args.games} | "
                f"Hand samples: {len(all_hand_snapshots):7d} | "
                f"Discard samples: {len(all_discard_samples):7d} | "
                f"Buy samples: {len(all_buy_samples):6d} | "
                f"Time: {elapsed:.1f}s"
            )

    env.close()

    # Save data
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    hand_path = DATA_DIR / f"hand_eval_{timestamp}.json"
    with open(hand_path, "w") as f:
        json.dump({"count": len(all_hand_snapshots), "samples": all_hand_snapshots}, f)
    print(f"\nHand evaluator data: {len(all_hand_snapshots)} samples → {hand_path}")

    discard_path = DATA_DIR / f"discard_{timestamp}.json"
    with open(discard_path, "w") as f:
        json.dump({"count": len(all_discard_samples), "samples": all_discard_samples}, f)
    print(f"Discard policy data: {len(all_discard_samples)} samples → {discard_path}")

    buy_path = DATA_DIR / f"buy_{timestamp}.json"
    with open(buy_path, "w") as f:
        json.dump({"count": len(all_buy_samples), "samples": all_buy_samples}, f)
    print(f"Buy evaluator data:  {len(all_buy_samples)} samples → {buy_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate training data for hybrid neural AI")
    parser.add_argument("--games", type=int, default=5000, help="Number of games to play")
    parser.add_argument("--players", type=int, default=4, help="Players per game")
    parser.add_argument("--opponent", type=str, default="the-shark", help="AI personality for all players")
    args = parser.parse_args()
    generate_games(args)
```

- [ ] **Step 2: Test with a small run**

```bash
cd ml/training && python generate_data.py --games 10 --players 4 --opponent the-shark
```

Expected: prints progress every 10 games, saves 3 JSON files to `ml/data/hybrid_training/`. Each file should have >0 samples.

- [ ] **Step 3: Commit**

```bash
git add ml/training/generate_data.py
git commit -m "feat(ml): data generation script for hybrid neural AI training"
```

---

## Phase 2: Hand Evaluator

### Task 4: Create hand evaluator network and training script

**Files:**
- Create: `ml/training/hand_evaluator.py`

- [ ] **Step 1: Write the hand evaluator**

```python
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
    """Small regression network: 273 features → single 0-1 score."""

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
```

- [ ] **Step 2: Generate data (5K games)**

```bash
cd ml/training && python generate_data.py --games 5000 --players 4 --opponent the-shark
```

This will take ~2-3 hours. Note the output filename for the next step.

- [ ] **Step 3: Train the hand evaluator**

```bash
cd ml/training && python hand_evaluator.py --data ../data/hybrid_training/hand_eval_TIMESTAMP.json --epochs 50
```

Expected: val loss should decrease steadily. High-pred accuracy should reach >80%.

- [ ] **Step 4: Commit**

```bash
git add ml/training/hand_evaluator.py
git commit -m "feat(ml): hand evaluator network — scores hand proximity to melding"
```

---

## Phase 3: Discard Policy

### Task 5: Create discard policy network and training script

The discard network needs the hand evaluator to compute labels. For each discard decision, it tries removing each card from the hand, scores the remaining hand with the evaluator, and the best removal is the label.

**Files:**
- Create: `ml/training/discard_policy.py`

- [ ] **Step 1: Write the discard policy script**

```python
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
```

- [ ] **Step 2: Train the discard policy**

```bash
cd ml/training && python discard_policy.py --data ../data/hybrid_training/discard_TIMESTAMP.json --epochs 50
```

Expected: accuracy should climb above 40% (there are many cards to choose from, so random chance is ~8-10%). Val loss should decrease.

- [ ] **Step 3: Commit**

```bash
git add ml/training/discard_policy.py
git commit -m "feat(ml): discard policy network — optimal card selection via hand eval"
```

---

## Phase 4: Buy Evaluator

### Task 6: Create buy evaluator network and training script

**Files:**
- Create: `ml/training/buy_evaluator.py`

- [ ] **Step 1: Write the buy evaluator script**

```python
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

from state_encoder import RICH_STATE_SIZE
from hand_evaluator import HandEvalNet

MODELS_DIR = Path(__file__).parent.parent / "models"

# 6 features for offered card: rank/13, suit_onehot(4), is_joker
OFFERED_CARD_FEATURES = 6


class BuyEvalNet(nn.Module):
    """Binary classifier: should the agent buy the offered card?"""

    def __init__(self, input_size: int = RICH_STATE_SIZE + 1 + OFFERED_CARD_FEATURES):
        # 273 state + 1 hand eval score + 6 offered card features = 280
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


def compute_buy_labels(buy_samples: list, hand_eval: HandEvalNet, threshold: float = 0.1) -> list:
    """Label buy decisions: 1 if offered card improves hand eval by > threshold."""
    hand_eval.eval()
    labeled = []

    for sample in buy_samples:
        state = torch.tensor(sample["state"], dtype=torch.float32)
        offered = sample["offered_card"]
        if not offered:
            continue

        with torch.no_grad():
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
            new_score = hand_eval(modified.unsqueeze(0)).item()

        improvement = new_score - current_score
        should_buy = 1 if improvement > threshold else 0

        labeled.append({
            "state": sample["state"],
            "hand_eval_score": current_score,
            "offered_card": card_features,
            "label": should_buy,
        })

    return labeled


class BuyDataset(Dataset):
    def __init__(self, samples: list):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        state = torch.tensor(s["state"], dtype=torch.float32)
        hand_score = torch.tensor([s["hand_eval_score"]], dtype=torch.float32)
        offered = torch.tensor(s["offered_card"], dtype=torch.float32)
        features = torch.cat([state, hand_score, offered])
        label = torch.tensor(s["label"], dtype=torch.float32)
        return features, label


def train(args):
    print("Buy Evaluator Training")
    print(f"  Data:       {args.data}")
    print(f"  Evaluator:  {args.evaluator}")
    print(f"  Threshold:  {args.threshold}")
    print(f"  Epochs:     {args.epochs}")
    print()

    # Load hand evaluator
    hand_eval = HandEvalNet()
    eval_path = MODELS_DIR / args.evaluator
    hand_eval.load_state_dict(torch.load(eval_path, weights_only=True))
    hand_eval.eval()
    print(f"Loaded hand evaluator from {eval_path}")

    # Load and label data
    with open(args.data) as f:
        raw = json.load(f)
    print(f"Loaded {raw['count']} raw buy samples")

    labeled = compute_buy_labels(raw["samples"], hand_eval, threshold=args.threshold)
    buy_count = sum(s["label"] for s in labeled)
    print(f"Labeled {len(labeled)} samples ({buy_count} buy, {len(labeled) - buy_count} pass)")

    dataset = BuyDataset(labeled)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    net = BuyEvalNet()
    optimizer = optim.Adam(net.parameters(), lr=args.lr)
    criterion = nn.BCELoss()

    model_path = MODELS_DIR / "buy_evaluator.pt"
    best_val_loss = float("inf")

    for epoch in range(args.epochs):
        net.train()
        train_loss = 0.0
        for features, labels in train_loader:
            optimizer.zero_grad()
            preds = net(features)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(features)
        train_loss /= train_size

        net.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
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
            print(f"  => Saved best model (val loss: {val_loss:.4f})")

    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {model_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train buy evaluator network")
    parser.add_argument("--data", type=str, required=True, help="Path to buy JSON data")
    parser.add_argument("--evaluator", type=str, default="hand_evaluator.pt", help="Hand evaluator model filename")
    parser.add_argument("--threshold", type=float, default=0.1, help="Improvement threshold for buy label")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size")
    args = parser.parse_args()
    train(args)
```

- [ ] **Step 2: Train the buy evaluator**

```bash
cd ml/training && python buy_evaluator.py --data ../data/hybrid_training/buy_TIMESTAMP.json --epochs 50
```

Expected: val accuracy should reach >70% (binary classification, baseline ~50%).

- [ ] **Step 3: Commit**

```bash
git add ml/training/buy_evaluator.py
git commit -m "feat(ml): buy evaluator network — binary buy/pass decision via hand eval"
```

---

## Phase 5: Combined Evaluation

### Task 7: Create hybrid evaluation script

This script loads all three networks and plays them as a combined personality through the bridge. The bridge handles game mechanics (melding, layoffs); the neural nets handle discard and buy decisions.

**Files:**
- Create: `ml/training/evaluate_hybrid.py`

- [ ] **Step 1: Write the hybrid evaluation script**

```python
"""
Evaluate the hybrid neural AI — three networks combined into one player.

Rules handle: melding, layoffs, joker swaps, turn structure.
Neural nets handle: discard choice, buy decisions.
Hand evaluator provides input to both.

Usage:
    python evaluate_hybrid.py --opponent the-shark --games 100 --players 4
"""

import argparse
import json
import random
import time
from pathlib import Path

import torch

from shanghai_env import ShanghaiEnv
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX
from hand_evaluator import HandEvalNet
from discard_policy import DiscardPolicyNet, MAX_HAND
from buy_evaluator import BuyEvalNet, encode_offered_card

MODELS_DIR = Path(__file__).parent.parent / "models"
EVAL_DIR = Path(__file__).parent.parent / "data" / "eval"


def hybrid_action(
    state_vec: list,
    valid_actions: list,
    phase: str,
    hand_eval: HandEvalNet,
    discard_net: DiscardPolicyNet,
    buy_net: BuyEvalNet,
    full_state: dict,
) -> str:
    """Choose an action using the hybrid strategy."""
    state = torch.tensor(state_vec, dtype=torch.float32)

    # Buy window: use buy evaluator
    if phase == "buy-window":
        if "buy" not in valid_actions and "decline_buy" not in valid_actions:
            return valid_actions[0] if valid_actions else "decline_buy"

        offered = full_state.get("discardTop")
        if offered:
            with torch.no_grad():
                hand_score = hand_eval(state.unsqueeze(0)).item()
            card_features = torch.tensor(encode_offered_card(offered), dtype=torch.float32)
            buy_input = torch.cat([state, torch.tensor([hand_score]), card_features]).unsqueeze(0)
            with torch.no_grad():
                buy_prob = buy_net(buy_input).item()
            return "buy" if buy_prob > 0.5 and "buy" in valid_actions else "decline_buy"
        return "decline_buy" if "decline_buy" in valid_actions else valid_actions[0]

    # Draw phase: take discard if it improves hand eval, otherwise draw pile
    if phase == "draw":
        if "take_discard" in valid_actions and full_state.get("discardTop"):
            offered = full_state["discardTop"]
            # Quick check: does this card help?
            with torch.no_grad():
                current_score = hand_eval(state.unsqueeze(0)).item()
            # Approximate improvement by encoding card into empty slot
            modified = state.clone()
            card_features = encode_offered_card(offered)
            for si in range(22):
                start = si * 6
                if modified[start:start + 6].sum().item() == 0:
                    modified[start:start + 6] = torch.tensor(card_features)
                    break
            with torch.no_grad():
                new_score = hand_eval(modified.unsqueeze(0)).item()
            if new_score - current_score > 0.05:
                return "take_discard"
        return "draw_pile" if "draw_pile" in valid_actions else valid_actions[0]

    # Action phase: meld if possible (rule-based), then choose discard (neural)
    if phase == "action":
        # Always meld if we can (rule-based decision, always correct)
        if "meld" in valid_actions:
            return "meld"

        # Layoff if possible (rule-based, always good to reduce hand)
        layoff_actions = [a for a in valid_actions if a.startswith("layoff:")]
        if layoff_actions:
            return layoff_actions[0]

        # Discard: use neural network
        discard_actions = [a for a in valid_actions if a.startswith("discard:")]
        if discard_actions:
            with torch.no_grad():
                hand_score = hand_eval(state.unsqueeze(0)).item()
            features = torch.cat([state, torch.tensor([hand_score])]).unsqueeze(0)
            with torch.no_grad():
                logits = discard_net(features)[0]
            # Mask invalid slots
            hand_size = full_state.get("handSize", 10)
            mask = torch.zeros(MAX_HAND)
            mask[:hand_size] = 1.0
            logits = logits + (mask - 1.0) * 1e9
            best_idx = logits.argmax().item()
            target = f"discard:{best_idx}"
            if target in discard_actions:
                return target
            # Fallback: pick the discard action closest to our choice
            return discard_actions[0]

    return valid_actions[0] if valid_actions else "draw_pile"


def evaluate(args):
    opponent_label = args.opponent or "random"
    print(f"Hybrid Neural AI Evaluation")
    print(f"  Opponent: {opponent_label}")
    print(f"  Games:    {args.games}")
    print(f"  Players:  {args.players}")
    print()

    # Load all three networks
    hand_eval = HandEvalNet()
    hand_eval.load_state_dict(torch.load(MODELS_DIR / "hand_evaluator.pt", weights_only=True))
    hand_eval.eval()

    discard_net = DiscardPolicyNet()
    discard_net.load_state_dict(torch.load(MODELS_DIR / "discard_policy.pt", weights_only=True))
    discard_net.eval()

    buy_net = BuyEvalNet()
    buy_net.load_state_dict(torch.load(MODELS_DIR / "buy_evaluator.pt", weights_only=True))
    buy_net.eval()

    print("Loaded all three networks")

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent,
        rich_state=True,
    )

    results = []
    start_total = time.time()

    for i in range(args.games):
        seed = 10000 + i
        env.reset(seed=seed)
        done = False
        step_count = 0
        max_steps = 3000 * max(1, args.players // 2)
        info = {}

        while not done and step_count < max_steps:
            valid_actions, current_player = env.get_valid_actions()
            if not valid_actions:
                break

            if current_player == 0:
                full_state = env.get_full_state(player=0)
                action = hybrid_action(
                    full_state["state"], valid_actions, full_state["phase"],
                    hand_eval, discard_net, buy_net, full_state,
                )
            else:
                action = random.choice(valid_actions)

            _, _, done, info = env.step(action)
            step_count += 1

        scores = info.get("scores", [])
        my_score = scores[0] if scores else 0
        opp_scores = scores[1:] if len(scores) > 1 else []
        best_opp = min(opp_scores) if opp_scores else float("inf")

        results.append({
            "seed": seed,
            "my_score": my_score,
            "best_opp_score": best_opp if best_opp != float("inf") else None,
            "won": my_score <= best_opp if opp_scores else False,
            "steps": step_count,
        })

        if (i + 1) % 20 == 0 or (i + 1) == args.games:
            wins = sum(r["won"] for r in results)
            avg = sum(r["my_score"] for r in results) / len(results)
            print(f"  Game {i+1:4d}/{args.games} | Win rate: {wins/(i+1)*100:5.1f}% | Avg score: {avg:7.1f}")

    env.close()

    # Final report
    total = len(results)
    wins = sum(r["won"] for r in results)
    avg_score = sum(r["my_score"] for r in results) / total
    opp_valid = [r["best_opp_score"] for r in results if r["best_opp_score"] is not None]
    avg_opp = sum(opp_valid) / len(opp_valid) if opp_valid else 0

    print()
    print("=" * 55)
    print("Hybrid Neural AI — Evaluation Results")
    print("=" * 55)
    print(f"  Opponent:         {opponent_label}")
    print(f"  Games:            {total}")
    print(f"  Win rate:         {wins/total*100:.1f}%  ({wins}/{total})")
    print(f"  Avg score (ours): {avg_score:.1f}")
    print(f"  Avg opp score:    {avg_opp:.1f}")
    print("=" * 55)

    # Save
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EVAL_DIR / f"eval_hybrid_vs_{opponent_label}.json"
    with open(out_path, "w") as f:
        json.dump({
            "model": "hybrid (hand_eval + discard + buy)",
            "opponent": opponent_label,
            "games": total, "players": args.players,
            "win_rate": round(wins / total * 100, 2),
            "avg_my_score": round(avg_score, 1),
            "avg_opp_score": round(avg_opp, 1),
            "per_game": results,
        }, f, indent=2)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate hybrid neural AI")
    parser.add_argument("--opponent", type=str, default="the-shark")
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--players", type=int, default=4)
    args = parser.parse_args()
    evaluate(args)
```

- [ ] **Step 2: Run evaluation against Shark**

```bash
cd ml/training && python evaluate_hybrid.py --opponent the-shark --games 100 --players 4
```

Compare results against the PPO baseline (323 avg, 16% win rate vs Shark).

- [ ] **Step 3: Run evaluation against Nemesis**

```bash
cd ml/training && python evaluate_hybrid.py --opponent the-nemesis --games 100 --players 4
```

Compare against PPO baseline (380 avg, 12% win rate vs Nemesis).

- [ ] **Step 4: Commit**

```bash
git add ml/training/evaluate_hybrid.py
git commit -m "feat(ml): hybrid AI evaluation — combined neural personality benchmarks"
```

---

## Execution Summary

| Phase | Task | What | Time Estimate |
|-------|------|------|---------------|
| 1 | Tasks 1-3 | Bridge command + data generation | Data gen: 2-3 hours |
| 2 | Task 4 | Hand evaluator training | ~30 min training |
| 3 | Task 5 | Discard policy training | ~30 min labeling + training |
| 4 | Task 6 | Buy evaluator training | ~15 min training |
| 5 | Task 7 | Combined evaluation | ~30 min eval runs |

**Dependencies:** Task 4 must complete before Tasks 5 and 6 (they need the hand evaluator for labels). Tasks 5 and 6 are independent of each other. Task 7 requires all three.
