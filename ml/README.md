# Shanghai Rummy — ML Training Pipeline

Self-play reinforcement learning for training a neural network AI that learns to play Shanghai Rummy from scratch.

## Architecture

```
ml/
├── bridge/
│   ├── game-bridge.ts     # Node.js bridge — exposes game engine via stdin/stdout JSON protocol
│   └── tsconfig.json      # TypeScript config for the bridge
├── training/
│   ├── shanghai_env.py    # Gym-like environment wrapping the Node.js bridge
│   ├── network.py         # PyTorch neural network (policy + value heads)
│   ├── self_play.py       # REINFORCE training loop with self-play
│   ├── export_model.py    # Export trained model to ONNX for browser
│   └── requirements.txt   # Python dependencies
├── models/                # Trained models (created by training)
└── README.md
```

## How It Works

1. **Game Bridge**: Python calls the Node.js game engine via subprocess. The bridge reads JSON commands from stdin and writes results to stdout. This means we use the EXACT same game rules as the web app — no porting, no divergence.

2. **Self-Play**: The neural network plays Shanghai against itself (or random opponents). Each game generates a trajectory of (state, action, reward). After each game, the network updates to favor actions that led to lower scores.

3. **Export**: The trained PyTorch model is exported to ONNX format and copied to `public/models/` for browser inference via ONNX Runtime Web.

## Prerequisites

- Node.js 18+ (for the game bridge)
- Python 3.10+ (for training)
- PyTorch 2.0+ (`pip install torch`)

## Quick Start

```bash
# 1. Install Python dependencies
cd ml/training
pip install -r requirements.txt

# 2. Install tsx for running TypeScript bridge
cd ../..
npm install -g tsx  # or: npx tsx

# 3. Train the model (start with 100 games to test)
cd ml/training
python self_play.py --games 100 --players 2

# 4. Train longer for better results
python self_play.py --games 10000 --players 2 --lr 0.0003 --temperature 0.8

# 5. Export to ONNX for the web app
python export_model.py
```

## Training Tips

- **Start with 2 players** — faster games, simpler to learn
- **Lower temperature** as training progresses (1.0 → 0.5) — less random exploration
- **Lower learning rate** for longer runs (0.001 → 0.0003)
- **More games = better** — 1K games is a quick test, 100K+ for competitive play
- **GPU not required** for this model size (65 inputs, 128 hidden) but speeds up training 5-10x
- **Check rewards**: early training shows random scores (~-150), good training converges toward -50 to -80

## Training Progress

The training loop prints:
```
Game   100 | Reward:  -87.0 | Avg(100): -142.3 | Loss: 0.4521 | Steps:  234 | Time: 1.2s
Game   200 | Reward: -105.0 | Avg(100): -128.7 | Loss: 0.3892 | Steps:  198 | Time: 0.9s
```

- **Reward**: negative final score (closer to 0 = better play)
- **Avg(100)**: rolling average over last 100 games
- **Loss**: training loss (should decrease over time)
- **Steps**: actions taken (fewer = more efficient play)

## Integrating into the Web App

After exporting, the model file lands at `public/models/shanghai_oracle.onnx`. To use it:

1. Install ONNX Runtime Web: `npm install onnxruntime-web`
2. Create `src/game/ml-oracle.ts` that loads the model and provides `evaluateStateML(features) → { policy, value }`
3. Create a new AI personality "The Oracle" that uses the ML model for decisions
4. The Oracle calls the bridge's state encoder to get features, then runs inference

The integration code for the web app is NOT in this folder — it goes in `src/game/` when you're ready to wire it up.

## State Encoding

The bridge encodes game state as a 65-element float vector:

| Features | Count | Description |
|----------|-------|-------------|
| Round info | 7 | round number, set/run requirement, pile sizes, buys remaining |
| Suit counts | 5 | hearts, diamonds, clubs, spades, joker counts in hand |
| Rank histogram | 13 | count of each rank (A through K) in hand |
| Hand stats | 5 | hand size, has laid down, total points, pairs, trips |
| Opponent info | 28 | per-opponent: hand size, laid down, buys, total score (7 opponents max) |
| Discard top | 3 | rank, suit, is-joker of top discard card |

All values are normalized to 0-1 range for stable training.

## Action Space

| Action | Index Range | Count |
|--------|------------|-------|
| draw_pile | 0 | 1 |
| take_discard | 1 | 1 |
| meld | 2 | 1 |
| discard:N | 3-18 | 16 |
| layoff:C:M | 19-339 | 320 |
| **Total** | | **339** |

Invalid actions are masked to -infinity before softmax, so the network never picks impossible moves.
