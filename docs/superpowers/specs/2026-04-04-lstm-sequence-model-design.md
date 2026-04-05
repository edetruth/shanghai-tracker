# Hybrid v3: LSTM Sequence Model Design

**Date:** 2026-04-04
**Status:** Approved
**Supersedes:** hybrid-v2-opponent-awareness (2026-04-03)

## Problem Statement

The hybrid v2 neural AI scores 449 avg vs Shark's 160 (4% win rate over 100 games). Per-decision classifiers achieve 88-93% accuracy on isolated decisions but fail at game-level play because:

1. **No memory across turns** — stateless feedforward networks re-evaluate from scratch every turn, can't maintain a coherent strategy, leading to circular play (30% of games hit the 6000 step limit)
2. **No meld planning** — a generic "meld readiness" scalar doesn't encode which melds the hand is working toward or what the round requires
3. **Circular labeling** — all downstream networks use the hand evaluator as their oracle; systematic biases propagate everywhere
4. **Compounding errors** — small per-decision errors snowball across ~100+ decisions per game with no recovery mechanism

## Approach

Replace four independent feedforward classifiers with a single LSTM sequence model that processes an entire round as an ordered sequence of decisions. The LSTM maintains hidden state across turns (memory), receives rule-based meld plan features (planning), trains end-to-end on expert round sequences with round-outcome auxiliary loss (breaks circular labeling), and uses scheduled sampling during training (addresses compounding errors).

Meld and layoff decisions remain rule-based — they're deterministic given the hand state and already solved. The neural model handles the three decisions that require judgment: draw/take, discard, and buy.

## Architecture

### Input Per Timestep (~323 features)

Each decision point in a round produces one timestep for the LSTM.

| Feature Group | Size | Source |
|---|---|---|
| Hand card slots | 132 | 22 slots x 6 features (rank/13, suit one-hot x4, is_joker) |
| Discard pile history | 60 | Last 10 discards x 6 features |
| Table melds | 60 | 12 meld slots x 5 features (type, card count, owner, etc.) |
| Game context | 12 | Round number, required sets/runs, pile sizes, buys remaining, hand points, turn number, buy-window flag, cumulative score, player count, laid-down flag |
| Meld plan features | 30 | See Meld Plan Features section |
| Opponent embeddings | 48 | 3 opponents x 16-dim from OpponentEncoderNet |
| Action taken (previous) | 10 | Action type one-hot (5) + card features (5) |
| Opponent actions since last turn | 18 | See Opponent Action Features section |
| Phase indicator | 3 | One-hot: draw / buy / action |
| **Total** | **~323** | Exact count pinned during implementation |

### Meld Plan Features (30 dims)

Computed by the TypeScript bridge using existing meld-finding logic from `src/game/ai.ts`.

| Feature | Dims | Description |
|---|---|---|
| Candidate plan count | 1 | Number of viable meld plans for this round |
| Best plan completeness | 1 | Cards held / cards needed (0-1) |
| Best plan cards away | 1 | Cards still needed for best plan |
| Per-requirement slots | 12 | Up to 3 requirements x 4 features each: type (set/run), completeness ratio, cards away, best partial match length |
| Flexible card count | 1 | Cards useful to multiple plans |
| Dead card count | 1 | Cards not useful to any plan |
| Jokers in hand | 1 | Count of jokers available |
| Padding | 12 | Reserved to fixed 30 dims |

### Opponent Action Features (18 dims)

Encodes what opponents did between our decision points.

| Feature | Dims | Description |
|---|---|---|
| Opponent actions count | 1 | Total opponent actions since our last decision |
| Any opponent went down | 1 | Binary flag |
| Any opponent went out | 1 | Binary flag |
| Cards drawn from discard by opponents | 12 | Last 2 opponent discard pickups x 6 card features |
| Opponent buys this interval | 1 | Count |
| Opponent layoffs this interval | 1 | Count |

### Multi-Phase Turn Handling

A single game turn can involve multiple decisions (buy window, draw, discard). Each decision point is its own LSTM timestep with a phase indicator.

Typical turn decomposition:
- Buy window opens for a discard → **buy timestep** (buy head activated)
- Draw phase → **draw timestep** (draw head activated)
- Action phase → rule-based meld/layoff check, then **discard timestep** (discard head activated)

A 15-turn round produces ~30-40 timesteps. Rounds with heavy buying can reach 50-60. All sequences padded to max 80 timesteps with loss masking on padded positions.

### LSTM Backbone

| Parameter | Value |
|---|---|
| Input size | ~323 |
| Hidden size | 192 |
| Layers | 2 (stacked) |
| Dropout (between layers) | 0.2 |
| Hidden state reset | At each round boundary |

Cumulative score carries across rounds as a game context feature.

### OpponentEncoderNet (kept from v2)

Weight-shared encoder, one instance applied per opponent:

- Input: 126 raw features per opponent (discard history 60, pickup history 30, melds 30, scalar stats 6)
- Architecture: 126 → 64 (ReLU) → 32 (ReLU) → 16 (linear)
- Output: 16-dim embedding per opponent, 48 total
- Trained jointly with LSTM backbone

### Specialized Heads

All heads read from the LSTM hidden state h_t (192 dims).

**Draw Head** (take discard vs. draw from pile):
- Input: h_t (192) + offered card (6) = 198
- Architecture: 198 → 64 (ReLU) → 1 (sigmoid)
- Loss: BCE
- Activated when: phase = draw AND take_discard is valid

**Discard Head** (which card to discard):
- Input: h_t (192)
- Architecture: 192 → 96 (ReLU) → 22 (logits per hand slot)
- Invalid slots masked with -inf before softmax
- Loss: CrossEntropy
- Activated when: phase = action AND no meld/layoff available

**Buy Head** (buy offered card vs. pass):
- Input: h_t (192) + offered card (6) = 198
- Architecture: 198 → 64 (ReLU) → 1 (sigmoid)
- Loss: BCE
- Activated when: phase = buy

**Auxiliary Head — Round Outcome Prediction:**
- Input: Final h_t of round sequence (192)
- Architecture: 192 → 32 (ReLU) → 1 (linear, predicts round score)
- Loss: MSE, weighted 0.1x
- Purpose: Pushes hidden state to encode strategic round context

**Combined loss:**
```
L = L_discard + L_draw + L_buy + 0.1 * L_round_outcome
```

### Meld and Layoff (Rule-Based)

Not neural. At each action phase:
1. If hand meets round meld requirements → meld (deterministic)
2. If layoff is possible onto existing table melds → layoff (deterministic)
3. Otherwise → invoke discard head

These are recorded in training sequences as context (the model sees that a meld happened via the state change at the next timestep) but are NOT training targets.

### Estimated Model Size

| Component | Params (approx) |
|---|---|
| LSTM (2-layer, 323→192) | ~400K |
| Opponent encoder | ~12K |
| Draw head | ~13K |
| Discard head | ~20K |
| Buy head | ~13K |
| Auxiliary head | ~6.2K |
| **Total** | **~465K params, ~500KB** |

Well within browser ONNX budget (~2MB limit).

## Data Pipeline

### Generation

**Command:** `python generate_data.py --v3 --games 5000 --mixed-opponents`

Mixed opponents: Shark, Nemesis, Patient-Pat, Steady-Sam in 4-player games. Different combinations across games for diversity.

**Output per game:** Round sequences (one per player per round). Each sequence contains the ordered list of every decision point in that round with full state.

**Filtering:** Only sequences from Shark and Nemesis players are retained for training. Weaker players' sequences are discarded during preprocessing to avoid teaching suboptimal play.

**Round sequence JSON structure:**
```json
{
  "game_seed": 10042,
  "round_number": 3,
  "round_score": 85,
  "went_out": false,
  "player_name": "the-shark",
  "turns": [
    {
      "step": 0,
      "state": [302 base features],
      "opponent_raw": [378 features],
      "meld_plan": [30 features],
      "opponent_actions": [18 features],
      "phase": "draw",
      "action_type": "take_discard",
      "action_detail": { "card_rank": 7, "card_suit": 2 },
      "valid_actions": ["draw_pile", "take_discard"]
    },
    ...
  ]
}
```

**Bridge protocol (v3):** New fields in state response:
- `meld_plan`: 30-dim float array computed by existing meld-finding logic
- `opponent_actions_since_last`: 18-dim float array tracking what opponents did

**Checkpointing:** Save every 500 games. Expected runtime: several hours for 5,000 games.

### Preprocessing

**Command:** `python preprocess.py --v3`

Steps:
1. Stream JSON sequences from generation output
2. Filter to Shark/Nemesis sequences only
3. Apply suit permutation augmentation (4-6 random permutations per sequence)
4. Pad sequences to max 80 timesteps, generate attention masks
5. Build per-timestep targets: action type + action detail (card index for discard, binary for draw/buy)
6. Attach round outcome labels
7. Save as `.pt` tensors

**Suit permutation augmentation:** For each sequence, generate N random permutations of the 4 suits (e.g., hearts↔clubs, diamonds↔spades). Apply consistently to ALL card features in the sequence: hand cards, discard history, offered cards, opponent history, meld plan features involving suits. Runs must maintain suit consistency within each permutation. Recommended: 5 permutations per sequence (6x total including original).

**Data volume estimates (5,000 games):**
- Raw: 2 strong players x 7 rounds x 5,000 games = 70,000 sequences
- After augmentation (6x): ~420,000 sequences
- At ~35 timesteps avg per sequence: ~14.7M decision-level samples
- Estimated disk: ~2-4GB as .pt

### Preprocessing Output

```
ml/data/sequence_training/
  sequences_v3.pt        # Padded input tensors [N, 80, 323]
  masks_v3.pt            # Attention masks [N, 80]
  targets_v3.pt          # Action targets per timestep [N, 80, ...]
  outcomes_v3.pt         # Round scores [N]
  metadata_v3.pt         # Round numbers, player names, game seeds
```

## Training

**Single script:** `train_sequence.py` replaces the four separate training scripts.

### Data Loading

- Load preprocessed `.pt` files
- Batch size: 32 sequences (~1,100 timesteps per batch)
- 80/20 train/val split, stratified by round number

### Phase 1: Teacher Forcing (Epochs 1-20)

- Each timestep receives ground-truth previous action as input
- All four losses active (discard + draw + buy + 0.1x round outcome)
- Opponent encoder jointly trained at 0.5x base LR
- Model learns to imitate expert decisions given perfect history

### Phase 2: Scheduled Sampling (Epochs 21-50)

- At each timestep, probability p of using model's own prediction vs. ground truth for the action-taken input
- p ramps linearly: 0.1 (epoch 21) → 0.5 (epoch 50)
- When using model's prediction: sample from head output (argmax for discard, threshold 0.5 for binary heads), encode as next timestep's action-taken features
- Teaches model to handle its own imperfect decisions

### Hyperparameters

| Parameter | Value |
|---|---|
| Optimizer | Adam |
| Learning rate | 1e-3 |
| LR schedule | Cosine annealing → 1e-5 over 50 epochs |
| Gradient clipping | Max norm 1.0 |
| Early stopping | Patience 10 epochs on combined val loss |
| Opponent encoder LR | 0.5x base |

### Validation Metrics

| Head | Metrics |
|---|---|
| Draw | Accuracy, take/draw balance |
| Discard | Top-1 accuracy, top-3 accuracy |
| Buy | Accuracy, buy/pass balance |
| Round outcome | MSE, Pearson correlation |
| Overall | Combined val loss |

### Checkpointing

- Save every 5 epochs + best model
- Output: `ml/models/shanghai_lstm.pt`, `ml/models/opponent_encoder_v3.pt`
- Logging: tee to `ml/training/logs/train_sequence.log`

## Inference

### Decision Loop

At game start:
1. Load `shanghai_lstm.pt` + `opponent_encoder_v3.pt`
2. Initialize LSTM hidden state (h, c) to zeros

At each decision point:
1. Encode current state (~323 features including meld plan, opponent embeddings, previous action, opponent actions, phase)
2. Feed through LSTM → update hidden state → get h_t
3. Based on phase:
   - **Draw:** Draw head(h_t, offered_card) → take if prob > 0.5
   - **Buy:** Buy head(h_t, offered_card) → buy if prob > 0.5
   - **Action:** Rule-based meld/layoff check first. If neither applies: discard head(h_t) → select card (argmax or temperature sampling)

At round boundary:
- Reset LSTM hidden state to zeros
- Cumulative score carries forward in game context features

### Temperature Sampling

Configurable via `--temperature` flag (default 1.0):
- Discard head: apply temperature to logits before softmax, sample from distribution
- Binary heads: scale logit by 1/temperature before sigmoid
- Evaluate at temperatures 0.7, 0.8, 0.9, 1.0 to find optimal setting

## Evaluation

### Script

`evaluate_sequence.py` — same interface as `evaluate_hybrid.py`:
```
python evaluate_sequence.py --opponent the-shark --games 100 --players 4
python evaluate_sequence.py --opponent the-nemesis --games 100 --players 4
python evaluate_sequence.py --opponent random --games 100 --players 4
```

### Success Criteria

| Opponent | Current v2 | Target v3 | Stretch |
|---|---|---|---|
| Shark (170 avg) | 449 avg, 4% win | < 250 avg, > 15% win | < 200 avg, > 20% win |
| Nemesis (186 avg) | ~450 est. | < 300 avg, > 10% win | < 250 avg, > 15% win |
| Random | ~350 est. | < 150 avg, > 60% win | < 100 avg, > 80% win |

Human average: 227. Hitting stretch targets makes the neural AI competitive with human players.

### Ablation Runs

| Ablation | What it tests |
|---|---|
| LSTM with vs. without meld plan features | Value of explicit meld planning input |
| Teacher forcing only vs. scheduled sampling | Impact on compounding error resistance |
| With vs. without opponent embeddings | Whether opponent awareness helps with a proper backbone |
| With vs. without suit augmentation | Data augmentation value |
| Temperature sweep (0.7-1.0) | Optimal inference stochasticity |

## ONNX Export & Browser Integration

### Export

After evaluation passes targets:
- `python export_model.py --v3`
- Exports LSTM + heads + opponent encoder as single ONNX graph
- LSTM hidden state as explicit I/O: `(input_features, h_prev, c_prev) -> (action_output, h_next, c_next)`
- Estimated size: ~500KB ONNX

### Browser Integration

- New AI personality: `'neural-v3'` in `src/game/types.ts`
- `src/game/ai.ts` gets new code path: load ONNX, maintain hidden state per round, call model per decision, rule-based meld/layoff
- Meld plan feature extraction: thin adapter calling existing meld-finder, encoding output as 30-dim vector
- Package: `onnxruntime-web`
- Full browser integration is a separate effort after Python evaluation succeeds

## Known Limitations & Future Work

### Behavioral Cloning Ceiling

This design clones Shark/Nemesis behavior. The theoretical ceiling is matching their play quality, not exceeding it. The architecture is designed to support the transition to self-play RL (v4):

- Same LSTM + heads architecture
- Add a value head (h_t → scalar) for PPO critic
- Replace behavioral cloning loss with policy gradient
- Initialize from v3 weights (warm-start RL from imitation)
- Self-play: model plays against itself + rule-based opponents

This is not in scope for v3 but the architecture accommodates it without changes.

### Buy Window Priority

The buy head outputs buy/pass, but the player may not receive the card if another player earlier in turn order also buys. The model learns this implicitly from the training data (Shark/Nemesis account for priority in their decisions), but it's not explicitly modeled.

### Data Scale

5,000 games may be insufficient for the LSTM to fully generalize. If v3 results are promising but below targets, the first lever to pull is more data (10K-20K games) before architectural changes.

## File Summary

### New Files

| File | Purpose |
|---|---|
| `ml/training/train_sequence.py` | Single training script for LSTM model |
| `ml/training/evaluate_sequence.py` | Evaluation script for LSTM model |
| `ml/training/network_v3.py` | LSTM backbone + heads + opponent encoder |
| `ml/bridge/meld-plan-encoder.ts` | Meld plan feature extraction in bridge |

### Modified Files

| File | Changes |
|---|---|
| `ml/training/generate_data.py` | Add `--v3` mode: round sequence output, meld plan features, opponent action tracking |
| `ml/training/preprocess.py` | Add `--v3` mode: sequence padding, suit augmentation, filtering |
| `ml/training/state_encoder.py` | Add v3 constants (input dims, phase encoding) |
| `ml/training/export_model.py` | Add `--v3` ONNX export with explicit LSTM state I/O |
| `ml/bridge/game-bridge.ts` | Add meld_plan and opponent_actions_since_last to state response |

### Unchanged

- `ml/training/hand_evaluator.py`, `buy_evaluator.py`, `discard_policy.py`, `draw_evaluator.py` — v2 scripts, kept for reference but not used in v3
- `ml/training/network.py`, `network_v2.py` — legacy architectures, kept for reference
- `ml/training/opponent_encoder.py` — logic moves into `network_v3.py`
