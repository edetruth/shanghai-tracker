# Hybrid Neural AI — Design Spec

**Date:** 2026-04-02
**Goal:** Build three focused neural networks (hand evaluator, discard policy, buy evaluator) that integrate into the existing rule-based AI system as a new personality. Rules handle game mechanics, neural nets handle strategy.

**Context:** The monolithic PPO approach (run #2, 9,430 games) plateaued at ~323-380 avg score in 4P — worse than both rule-based AIs (171-186) and average humans (227). The neural net learned basic card play but couldn't learn strategy through the full 350-action RL loop. This hybrid approach decomposes the problem into three tractable supervised learning tasks.

---

## Architecture

Three small, independent networks. All trained in Python (PyTorch). No browser deployment yet.

### Network 1: Hand Evaluator

- **Purpose:** Score how close a hand is to meeting the round's meld requirement (0-1).
- **Input:** 273 features (existing rich state encoding).
- **Output:** Single float (0-1), sigmoid. 0 = hopeless, 1 = ready to meld.
- **Architecture:** 273 → 128 → 64 → 1. ~25K parameters.
- **Loss:** MSE.
- **Label generation:** Play 100K+ games with Shark AI. At each turn, snapshot hand and record turns until player melded. Score = `1.0 - (turns_to_meld / max_turns)`, or `0.0` if shanghaied.
- **Validation:** When network predicts >0.9, verify `aiFindBestMelds()` finds valid melds. Target >90% agreement.

### Network 2: Discard Policy

- **Purpose:** Choose which card to discard after drawing.
- **Input:** 274 features (273 state + hand evaluator score for current hand).
- **Output:** 22 logits (one per hand slot). Highest = best discard.
- **Architecture:** 274 → 128 → 64 → 22. ~25K parameters.
- **Loss:** Cross-entropy against optimal discard label.
- **Label generation:** For each discard decision, compute hand evaluator score for every possible discard. The card whose removal yields the highest score is the label. Pure supervised learning — no RL needed.
- **Validation:** Compare discard choices against rule-based AI. Measure score improvement over Shark's heuristic discard logic.

### Network 3: Buy Evaluator

- **Purpose:** Decide whether to buy an offered card (binary yes/no).
- **Input:** 280 features (273 state + hand evaluator score + 6 offered card features).
- **Output:** Single float (0-1), sigmoid. Above 0.5 = buy.
- **Architecture:** 280 → 64 → 32 → 1. ~12K parameters.
- **Loss:** Binary cross-entropy.
- **Label generation:** At each buy opportunity, compute hand evaluator score with and without the offered card. Label is 1 (buy) when the score improves by >0.1 (10% of the 0-1 range), accounting for hand size increase from the penalty card. Label is 0 (pass) otherwise. The 0.1 threshold is tunable during training.
- **Validation:** Compare buy rate and outcomes against rule-based AI buy logic.

---

## Training Data Generation

- Play 100K+ games using Shark AI (all players) via the existing TypeScript bridge.
- At every decision point, capture the full 273-feature state vector plus decision-specific context.
- Store as compressed JSON or binary format in `ml/data/`.
- All three networks share the same game dataset — just different labels extracted from different decision points.

---

## Integration

The three networks combine into a new AI personality within the existing system:

- **Game mechanics (rule-based):** Meld finding (`aiFindBestMelds`), layoffs (`canLayOff`), joker swaps, turn structure.
- **Strategy (neural):** `evaluateHand()` → hand evaluator, `chooseDiscard()` → discard policy, `shouldBuy()` → buy evaluator.

The personality is registered in `src/game/types.ts` but NOT exposed in the UI until testing is complete.

---

## Evaluation Plan

1. Train hand evaluator, validate against `aiFindBestMelds()`.
2. Train discard network using hand evaluator scores as labels.
3. Train buy network using hand evaluator scores as labels.
4. Combine all three into the new personality.
5. Run `evaluate.py` — 100 games each against Shark and Nemesis in 4P.
6. Compare against current rule-based AIs and PPO model.

### Success Criteria

| Metric | Target |
|--------|--------|
| Hand evaluator accuracy (predicting meld-ready) | >90% |
| New personality avg score vs Shark (4P) | <200 |
| Win rate vs Nemesis (4P) | >25% |

### Not In Scope

- Browser deployment (ONNX/TF.js conversion)
- UI personality selector changes
- Modifications to existing AI personalities
- Production deployment

---

## File Structure

```
ml/
├── training/
│   ├── hand_evaluator.py     # New: hand evaluation network + training
│   ├── discard_policy.py     # New: discard policy network + training
│   ├── buy_evaluator.py      # New: buy evaluator network + training
│   ├── generate_data.py      # New: play 100K+ games, capture decision data
│   ├── network_v2.py         # Existing: PPO network (kept for reference)
│   ├── ppo.py                # Existing: PPO training (kept for reference)
│   └── evaluate.py           # Existing: evaluation framework (reused)
├── bridge/
│   └── game-bridge.ts        # Existing: game engine bridge (reused)
├── models/
│   ├── hand_evaluator.pt     # Trained hand evaluator
│   ├── discard_policy.pt     # Trained discard network
│   └── buy_evaluator.pt      # Trained buy network
└── data/
    ├── training_games/       # Generated game data for all three networks
    └── eval/                 # Existing: evaluation results
```

---

## Dependencies

- Existing bridge (`game-bridge.ts`) — reused as-is for data generation and evaluation.
- Existing state encoder (`state_encoder.py`) — 273-feature encoding reused.
- Existing evaluation framework (`evaluate.py`) — reused for final benchmarking.
- Hand evaluator must be trained first — discard and buy networks depend on it for labels.
