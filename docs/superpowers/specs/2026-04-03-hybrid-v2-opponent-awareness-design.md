# Hybrid ML v2: Opponent Awareness & Draw Decision Network

**Date:** 2026-04-03
**Status:** Approved
**Builds on:** 2026-04-02-hybrid-neural-ai-design.md

## Summary

Extend the hybrid ML system with two major improvements:
1. **Learned Opponent Embeddings** — An OpponentEncoderNet that takes raw observable opponent data and produces learned 16-dim embeddings per opponent, giving all decision networks visibility into opponent behavior.
2. **DrawEvalNet** — A new neural network replacing the hardcoded 0.05-threshold heuristic for the take-discard-vs-draw-from-pile decision.

All existing networks (HandEvalNet, DiscardPolicyNet, BuyEvalNet) are retrained on fresh 5K-10K game data with the enriched state vector.

## Opponent Encoder Architecture

### Raw Observable Data Per Opponent (126 features)

| Feature Group | Features | Description |
|---|---|---|
| Discard history | 60 | Last 10 discards x 6 card features (rank/13, suit one-hot x4, is_joker) |
| Pickup history | 30 | Last 5 cards taken from discard pile x 6 features |
| Meld composition | 30 | Up to 6 melds on table x 5 features (is_run, count/8, min_rank/13, max_rank/13, has_joker) |
| Scalar stats | 6 | hand_size/16, laid_down (binary), buys_remaining/5, cards_laid_off/10, cumulative_score/300, is_winning (binary) |

### OpponentEncoderNet (shared weights across all opponent slots)

```
Input: 126 features (per opponent)
  -> Linear(126, 64) -> ReLU
  -> Linear(64, 32) -> ReLU
  -> Linear(32, 16) -> embedding

3 opponents -> 3 x 16 = 48 features total
```

- Same encoder weights applied to all opponent slots (weight sharing)
- Empty slots (2-player games) get zero-padded input, producing near-zero embeddings
- Trained jointly with HandEvalNet first, then frozen or fine-tuned (lower LR) for other networks

### Combined State Vector

- Base state: 264 features (current 273 minus 9 old opponent features)
- Opponent embeddings: 48 features
- **Total: 312 features**

## DrawEvalNet Architecture

**Purpose:** Decide whether to take the face-up discard or draw blind from the pile.

### Network

```
Input: 319 features
  - Base state with opponent embeddings: 312
  - Hand eval score of current hand: 1
  - Offered discard card features: 6 (rank/13, suit one-hot x4, is_joker)

  -> Linear(319, 128) -> ReLU
  -> Linear(128, 64) -> ReLU
  -> Linear(64, 1) -> Sigmoid

Output: probability of taking discard (> 0.5 = take, else draw from pile)
```

### Training Labels

Hand eval proxy approach:
- For each draw decision point, simulate both options:
  - **Take discard:** Encode offered card into hand, score with HandEvalNet
  - **Draw from pile:** Use current hand eval score (unknown card = no improvement assumption)
- Label = 1 if take_discard score > draw_pile score, else 0
- This avoids needing round-outcome tracking; can iterate with outcome-based labels later

## Updated Network Suite

All networks consume the enriched 312-feature state (with opponent embeddings):

| Network | Input Size | Architecture | Output | Loss |
|---|---|---|---|---|
| HandEvalNet | 312 | 312->128->64->1->Sigmoid | Meld readiness 0-1 | MSE |
| DrawEvalNet | 319 | 319->128->64->1->Sigmoid | Take discard probability | BCE |
| DiscardPolicyNet | 313 | 313->128->64->22 logits | Best card to discard | CrossEntropy |
| BuyEvalNet | 319 | 319->128->64->32->1->Sigmoid | Buy probability | BCE |

## Training Order (Dependency Chain)

1. **OpponentEncoder + HandEvalNet** (jointly) — foundation, all other networks depend on hand eval
2. **DrawEvalNet** — needs trained hand eval for label generation (simulate take vs draw)
3. **BuyEvalNet** — needs trained hand eval for labels (improvement > 0.1 threshold)
4. **DiscardPolicyNet** — needs trained hand eval for brute-force optimal discard labels

Opponent encoder weights are frozen (or fine-tuned with lower LR) during steps 2-4.

## Data Generation Pipeline

### Bridge Changes

New data exposed per `get_full_state` call for each opponent:
- `opponent_discards[]` — rolling history of last 10 discards (card objects)
- `opponent_pickups[]` — rolling history of last 5 discard pile takes
- `opponent_melds[]` — current melds on table
- `opponent_buys_remaining` — buys left this round
- `opponent_cards_laid_off` — count of layoffs this round
- `opponent_cumulative_score` — total score across rounds
- `opponent_is_winning` — binary, lowest cumulative score

New `encodeOpponentRaw()` function produces 126-feature vector per opponent.

Per-player history buffers persist across turns within a round, reset between rounds where appropriate (discard/pickup history carries across rounds, buys_remaining and cards_laid_off reset).

### Sample Format

Each training sample includes:
- `state`: 264 features (base state without old opponent features)
- `opponent_raw`: 378 features (3 x 126 per opponent)
- Existing fields: hand, round, labels per network type

### New Draw Decision Samples

Collected during draw phase when `take_discard` is a valid action:
- Records: state, opponent_raw, offered_card (6 features), hand_eval_score
- Label: computed post-hoc via hand eval proxy

### Data Generation Config

- **Games:** 5,000-10,000 (up from 2,000)
- **Opponents:** Mixed — shark, nemesis, patient-pat, steady-sam (diversity prevents overfitting to one style)
- **Players:** 4 per game
- **Checkpoints:** Every 500 games
- **Estimated volume:** 15-25GB total across all sample files

## Evaluation Plan

### Primary Evaluation

100 games each against multiple opponents:

| Opponent | Current Hybrid Avg | Target |
|---|---|---|
| The Shark | 428 | < 300 |
| The Nemesis | not yet tested | < 350 |
| Random | not yet tested | < 200 |

### Incremental Checkpoints

1. **After HandEvalNet + OpponentEncoder** — compare hand eval accuracy on held-out set vs current model
2. **After DrawEvalNet** — run 100 games with only draw network swapped in. Expect 20-40 point avg score improvement.
3. **After full retrain** — complete eval suite against all opponents
4. **Ablation** — zero out opponent embeddings to measure contribution of opponent awareness vs. more data + draw network

### Failure Modes to Monitor

- **Encoder collapse:** Opponent embeddings converge to near-zero norms (not learning). Monitor embedding L2 norms during training.
- **Draw degeneracy:** Network always predicts one class. Check prediction class balance.
- **Overfitting to one opponent style:** Mixed training opponents should prevent this; validate by testing against opponent types not heavily represented in training.

## Benchmarks (Reference)

- Average human player: 227 (from 34 manual games)
- The Shark AI: 173 avg
- The Nemesis AI: 186 avg
- Current hybrid v1: 428 avg vs Shark (4% win rate)
- PPO end-to-end: 323-380 depending on opponent

## Files Affected

### New Files
- `ml/training/opponent_encoder.py` — OpponentEncoderNet definition and joint training with HandEvalNet
- `ml/training/draw_evaluator.py` — DrawEvalNet definition and training

### Modified Files
- `ml/bridge/game-bridge.ts` — Add opponent history tracking, `encodeOpponentRaw()`, expand `get_full_state` response
- `ml/training/state_encoder.py` — Update RICH_STATE_SIZE, add opponent raw feature constants
- `ml/training/generate_data.py` — Collect opponent_raw per sample, add draw decision samples, support mixed opponents
- `ml/training/hand_evaluator.py` — Input size 264->312 (consumes opponent embeddings)
- `ml/training/discard_policy.py` — Input size 274->313
- `ml/training/buy_evaluator.py` — Input size 280->319
- `ml/training/evaluate_hybrid.py` — Load opponent encoder, wire up DrawEvalNet, run ablation eval
