# Shanghai RL Training Rewrite — PPO with Rich State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the REINFORCE training pipeline with PPO, rich card-level state encoding, separate buy/play policy heads, batch training, curriculum learning, and a proper evaluation framework — enabling the model to learn competitive 4-player Shanghai Rummy.

**Architecture:** PPO collects multiple game trajectories into a replay buffer, then performs multiple gradient updates per batch with a clipped objective that prevents catastrophic policy changes. The state encoder uses card-level features (each card as a 6-dim vector) plus game context, replacing the 66-dim histogram. Two policy heads: one for gameplay actions (draw/meld/discard/layoff), one for binary buy decisions. Training progresses through a curriculum from easy to hard opponents.

**Tech Stack:** Python 3, PyTorch, existing TypeScript game bridge (stdin/stdout JSON), Vitest for bridge validation

---

## File Structure

```
ml/
├── training/
│   ├── network_v2.py        # New: PPO network with card encoder + dual policy heads
│   ├── ppo.py               # New: PPO training loop with batch collection + clipped updates
│   ├── state_encoder.py     # New: Rich state encoding (card-level features, discard history)
│   ├── evaluate.py          # New: Evaluation framework (fixed seeds, model vs baselines)
│   ├── curriculum.py        # New: Curriculum manager (promotes model through difficulty tiers)
│   ├── shanghai_env.py      # Modify: Add richer state protocol support
│   ├── network.py           # Keep: Legacy (unchanged, for reference)
│   ├── self_play.py         # Keep: Legacy (unchanged, for reference)
│   └── pretrain.py          # Keep: Legacy (unchanged)
├── bridge/
│   ├── game-bridge.ts       # Modify: Add rich state encoding command
│   └── expert-play.ts       # Keep: Legacy
├── models/                  # Model checkpoints
├── data/                    # Training data, eval results
│   └── eval/                # New: Evaluation result logs
└── scripts/
    └── check_human_data.py  # Keep: Legacy
```

---

## Phase 1: Rich State Encoding

### Task 1: Add rich state command to bridge

**Files:**
- Modify: `ml/bridge/game-bridge.ts` (add `encode_rich_state` command handler)

The bridge currently encodes 66 features via histograms. We need a richer encoding that includes actual card identities, discard history, and meld composition.

**Rich state design (variable length, padded):**
- Hand cards: up to 16 cards × 6 features each = 96 dims
  - Per card: [rank/13, suit_onehot(4), is_joker] = 6 dims
- Discard history: last 10 discarded cards × 6 features = 60 dims
- Table melds: up to 12 melds × 5 features = 60 dims
  - Per meld: [type_is_run, card_count/8, min_rank/13, max_rank/13, has_joker]
- Game context: 15 features
  - round/7, sets_required/3, runs_required/3
  - draw_pile_size/108, discard_pile_size/108
  - buys_remaining/5, has_laid_down, hand_points/200
  - turn_count/200, is_buy_window
  - Per opponent (up to 3): hand_size/16, has_laid_down, score/300 = 9 dims
- **Total: 96 + 60 + 60 + 15 = 231 features (fixed size, zero-padded)**

- [ ] **Step 1: Add `encode_rich_state` function to bridge**

In `ml/bridge/game-bridge.ts`, add after the existing `encodeState` function:

```typescript
function encodeRichState(g: BridgeGameState, playerIdx: number): number[] {
  const p = g.players[playerIdx]
  const features: number[] = []

  // Hand cards: up to 16 cards × 6 features (rank, suit_onehot, is_joker)
  const suitMap: Record<string, number[]> = {
    hearts:   [1, 0, 0, 0],
    diamonds: [0, 1, 0, 0],
    clubs:    [0, 0, 1, 0],
    spades:   [0, 0, 0, 1],
    joker:    [0, 0, 0, 0],
  }
  for (let i = 0; i < 16; i++) {
    if (i < p.hand.length) {
      const c = p.hand[i]
      features.push(c.rank / 13)
      features.push(...suitMap[c.suit])
      features.push(c.suit === 'joker' ? 1 : 0)
    } else {
      features.push(0, 0, 0, 0, 0, 0) // padding
    }
  }

  // Discard history: last 10 cards × 6 features
  const discardStart = Math.max(0, g.discardPile.length - 10)
  for (let i = 0; i < 10; i++) {
    const idx = discardStart + i
    if (idx < g.discardPile.length) {
      const c = g.discardPile[idx]
      features.push(c.rank / 13)
      features.push(...suitMap[c.suit])
      features.push(c.suit === 'joker' ? 1 : 0)
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // Table melds: up to 12 melds × 5 features
  for (let i = 0; i < 12; i++) {
    if (i < g.tableMelds.length) {
      const m = g.tableMelds[i]
      features.push(m.type === 'run' ? 1 : 0)
      features.push(m.cards.length / 8)
      features.push((m.runMin ?? m.cards[0]?.rank ?? 0) / 13)
      features.push((m.runMax ?? m.cards[0]?.rank ?? 0) / 13)
      features.push(m.cards.some(c => c.suit === 'joker') ? 1 : 0)
    } else {
      features.push(0, 0, 0, 0, 0)
    }
  }

  // Game context: 15 features
  features.push(g.currentRound / 7)
  features.push(g.requirement.sets / 3)
  features.push(g.requirement.runs / 3)
  features.push(g.drawPile.length / 108)
  features.push(g.discardPile.length / 108)
  features.push(p.buysRemaining / 5)
  features.push(p.hasLaidDown ? 1 : 0)
  features.push(p.hand.reduce((s, c) => s + cardPoints(c.rank), 0) / 200)
  features.push(g.turnCount / 200)
  features.push(g.phase === 'buy-window' ? 1 : 0)

  // Opponent info (up to 3 opponents × 3 features + 2 padding = 11)
  let oppCount = 0
  for (let i = 0; i < g.players.length && oppCount < 3; i++) {
    if (i === playerIdx) continue
    const opp = g.players[i]
    features.push(opp.hand.length / 16)
    features.push(opp.hasLaidDown ? 1 : 0)
    features.push(g.scores[i].reduce((a, b) => a + b, 0) / 300)
    oppCount++
  }
  // Pad remaining opponent slots
  while (oppCount < 3) {
    features.push(0, 0, 0)
    oppCount++
  }
  // buys remaining for self (already above) and score
  features.push(g.scores[playerIdx].reduce((a, b) => a + b, 0) / 300)
  features.push(g.players.length / 8)

  return features // 96 + 60 + 60 + 10 + 11 = 237 features
}
```

- [ ] **Step 2: Add `get_rich_state` command to bridge protocol**

In the `rl.on('line', ...)` handler, add a new case:

```typescript
case 'get_rich_state': {
  if (!game) { respond({ ok: false, error: 'No game' }); break }
  respond({ ok: true, state: encodeRichState(game, cmd.player ?? 0) })
  break
}
```

Also update `take_action` response to include both state encodings when a flag is set:

```typescript
// In new_game handler, track flag:
game = initGame(...)
game.useRichState = cmd.rich_state ?? false

// In take_action handler:
respond({
  ok: true,
  state: game.useRichState ? encodeRichState(game, 0) : encodeState(game, 0),
  // ... rest unchanged
})
```

- [ ] **Step 3: Verify bridge compiles**

Run: `cd D:/shanghai-tracker && npx tsx --eval "import './ml/bridge/game-bridge.ts'"`
Expected: No output (clean compile)

- [ ] **Step 4: Commit**

```bash
git add ml/bridge/game-bridge.ts
git commit -m "feat(ml): add rich state encoding to bridge (card-level features, discard history, meld composition)"
```

---

### Task 2: Create Python state encoder module

**Files:**
- Create: `ml/training/state_encoder.py`

- [ ] **Step 1: Write state encoder constants and protocol**

```python
"""
State encoder — defines the rich state vector layout.
Must match the bridge's encodeRichState() output exactly.
"""

# Card features: rank/13, suit_onehot(4), is_joker
CARD_FEATURES = 6
MAX_HAND_CARDS = 16
MAX_DISCARD_HISTORY = 10
MAX_TABLE_MELDS = 12
MELD_FEATURES = 5
GAME_CONTEXT_FEATURES = 15  # round, requirements, pile sizes, buys, etc.

# Total state size (must match bridge output)
RICH_STATE_SIZE = (
    MAX_HAND_CARDS * CARD_FEATURES +      # 96: hand cards
    MAX_DISCARD_HISTORY * CARD_FEATURES +  # 60: discard history
    MAX_TABLE_MELDS * MELD_FEATURES +      # 60: table melds
    GAME_CONTEXT_FEATURES +                # 15: game context
    3 * 3 + 2                              # 11: opponent info (3 opponents × 3 + own score + player count)
)
# Total: 242

# Action encoding (unchanged from v1)
MAX_ACTIONS = 350
BUY_ACTION_IDX = 339
DECLINE_BUY_ACTION_IDX = 340
```

- [ ] **Step 2: Commit**

```bash
git add ml/training/state_encoder.py
git commit -m "feat(ml): add state encoder constants for rich state vector"
```

---

### Task 3: Update environment for rich state

**Files:**
- Modify: `ml/training/shanghai_env.py`

- [ ] **Step 1: Add rich_state flag to environment**

Update `ShanghaiEnv.__init__` and `reset` to pass `rich_state: true` in the `new_game` command:

```python
class ShanghaiEnv:
    def __init__(self, player_count=2, opponent_ai=None, rich_state=False):
        self.player_count = player_count
        self.opponent_ai = opponent_ai
        self.rich_state = rich_state
        self.proc = None
        self._start_bridge()
```

Update `reset`:

```python
def reset(self, seed=None) -> list:
    import random
    if seed is None:
        seed = random.randint(0, 2147483647)
    cmd = {"cmd": "new_game", "players": self.player_count, "seed": seed}
    if self.opponent_ai:
        cmd["opponent_ai"] = self.opponent_ai
    if self.rich_state:
        cmd["rich_state"] = True
    result = self._send(cmd)
    if not result.get("ok"):
        raise RuntimeError(f"Failed to start game: {result}")
    return result["state"]
```

- [ ] **Step 2: Commit**

```bash
git add ml/training/shanghai_env.py
git commit -m "feat(ml): add rich_state flag to environment"
```

---

## Phase 2: PPO Network and Training

### Task 4: Create PPO network with dual policy heads

**Files:**
- Create: `ml/training/network_v2.py`

- [ ] **Step 1: Write the network**

```python
"""
PPO Network v2 — richer architecture for Shanghai Rummy.

- Larger shared trunk (256 → 256 → 128)
- Separate gameplay policy head (draw/meld/discard/layoff)
- Separate buy policy head (binary: buy vs decline)
- Value head (expected return)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX


class ShanghaiNetV2(nn.Module):
    def __init__(self, state_size=RICH_STATE_SIZE, hidden_size=256):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, 128),
            nn.ReLU(),
        )
        # Gameplay policy head (all actions except buy/decline)
        self.gameplay_head = nn.Linear(128, MAX_ACTIONS)
        # Buy policy head (binary: buy vs decline)
        self.buy_head = nn.Sequential(
            nn.Linear(128, 32),
            nn.ReLU(),
            nn.Linear(32, 2),  # [buy_logit, decline_logit]
        )
        # Value head
        self.value_head = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, state, is_buy_step=None):
        """
        Args:
            state: (batch, state_size)
            is_buy_step: (batch,) bool tensor or None
        Returns:
            policy_logits: (batch, MAX_ACTIONS) — gameplay logits with buy slots overwritten
            value: (batch, 1)
        """
        trunk_out = self.trunk(state)
        gameplay_logits = self.gameplay_head(trunk_out)
        buy_logits = self.buy_head(trunk_out)  # (batch, 2)
        value = self.value_head(trunk_out)

        # Merge: overwrite buy/decline slots in gameplay_logits with buy_head output
        policy_logits = gameplay_logits.clone()
        policy_logits[:, BUY_ACTION_IDX] = buy_logits[:, 0]
        policy_logits[:, DECLINE_BUY_ACTION_IDX] = buy_logits[:, 1]

        return policy_logits, value

    def get_gameplay_entropy(self, policy_logits, action_mask, is_buy_step):
        """Compute entropy only for gameplay steps (not buy decisions)."""
        gameplay_mask = ~is_buy_step
        if not gameplay_mask.any():
            return torch.tensor(0.0)

        gl = policy_logits[gameplay_mask]
        am = action_mask[gameplay_mask]
        masked = gl + (am - 1) * 1e9
        probs = F.softmax(masked, dim=1)
        log_probs = F.log_softmax(masked, dim=1)
        entropy = -(probs * log_probs).sum(dim=1).mean()
        return entropy
```

- [ ] **Step 2: Commit**

```bash
git add ml/training/network_v2.py
git commit -m "feat(ml): PPO network v2 with dual policy heads and larger trunk"
```

---

### Task 5: Create PPO training loop

**Files:**
- Create: `ml/training/ppo.py`

This is the core rewrite. PPO collects N trajectories, then does multiple update epochs per batch.

- [ ] **Step 1: Write trajectory collection**

```python
"""
PPO training loop for Shanghai Rummy.

Key differences from REINFORCE:
- Collects batch of trajectories before updating (less noise)
- Clipped surrogate objective (prevents destructive updates)
- Multiple epochs per batch (more efficient)
- GAE (Generalized Advantage Estimation) for variance reduction
- Separate entropy tracking for gameplay vs buy decisions
"""

import argparse
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F
import torch.optim as optim

from shanghai_env import ShanghaiEnv
from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


def get_action_mask(valid_actions):
    """Create mask tensor where valid actions are 1, invalid are 0."""
    mask = torch.zeros(MAX_ACTIONS)
    for action in valid_actions:
        mask[encode_action(action)] = 1.0
    return mask


def encode_action(action):
    """Convert action string to index (same as network.py)."""
    if action == "draw_pile": return 0
    if action == "take_discard": return 1
    if action == "meld": return 2
    if action.startswith("discard:"):
        return 3 + int(action.split(":")[1])
    if action.startswith("layoff:"):
        parts = action.split(":")
        return 19 + int(parts[1]) * 20 + int(parts[2])
    if action == "buy": return BUY_ACTION_IDX
    if action == "decline_buy": return DECLINE_BUY_ACTION_IDX
    return 0


def decode_action(index, valid_actions):
    """Convert index back to action string."""
    action_to_idx = {a: encode_action(a) for a in valid_actions}
    idx_to_action = {v: k for k, v in action_to_idx.items()}
    return idx_to_action.get(index, valid_actions[0] if valid_actions else "draw_pile")


def collect_batch(env, net, batch_size, temperature=1.0):
    """Collect multiple trajectories for PPO update.

    Returns a dict with batched tensors for all steps across all games.
    """
    all_states, all_actions, all_rewards = [], [], []
    all_log_probs, all_values, all_masks = [], [], []
    all_is_buy, all_dones = [], []
    game_rewards = []  # total reward per game for logging

    games_played = 0
    while games_played < batch_size:
        state = env.reset()
        done = False
        step_count = 0
        max_steps = 3000
        prev_score = 0
        game_total = 0

        ep_states, ep_actions, ep_rewards = [], [], []
        ep_log_probs, ep_values, ep_masks = [], [], []
        ep_is_buy, ep_dones = [], []

        while not done and step_count < max_steps:
            valid_actions, current_player = env.get_valid_actions()
            if not valid_actions:
                break

            if current_player == 0:
                state_tensor = torch.tensor([state], dtype=torch.float32)
                with torch.no_grad():
                    policy_logits, value = net(state_tensor)

                mask = get_action_mask(valid_actions)
                masked_logits = policy_logits[0] + (mask - 1) * 1e9
                probs = F.softmax(masked_logits / temperature, dim=0)
                action_idx = torch.multinomial(probs, 1).item()
                action_str = decode_action(action_idx, valid_actions)
                log_prob = F.log_softmax(masked_logits / temperature, dim=0)[action_idx]

                ep_states.append(state_tensor.squeeze(0))
                ep_actions.append(action_idx)
                ep_log_probs.append(log_prob.item())
                ep_values.append(value.item())
                ep_masks.append(mask)
                ep_is_buy.append(action_str in ('buy', 'decline_buy'))

                state, reward, done, info = env.step(action_str)

                step_reward = 0.0
                if info.get("scores"):
                    current_score = info["scores"][0] if info["scores"] else 0
                    delta = current_score - prev_score
                    if delta != 0:
                        step_reward = -delta / 100.0
                        prev_score = current_score

                ep_rewards.append(step_reward)
                ep_dones.append(done)
                game_total += step_reward
            else:
                action = random.choice(valid_actions)
                state, reward, done, info = env.step(action)
                if info.get("scores"):
                    current_score = info["scores"][0] if info["scores"] else 0
                    delta = current_score - prev_score
                    if delta != 0 and ep_rewards:
                        ep_rewards[-1] += -delta / 100.0
                        game_total += -delta / 100.0
                        prev_score = current_score

            step_count += 1

        if ep_states:
            all_states.extend(ep_states)
            all_actions.extend(ep_actions)
            all_rewards.extend(ep_rewards)
            all_log_probs.extend(ep_log_probs)
            all_values.extend(ep_values)
            all_masks.extend(ep_masks)
            all_is_buy.extend(ep_is_buy)
            all_dones.extend(ep_dones)
            game_rewards.append(-prev_score)  # original scale

        games_played += 1

    return {
        'states': torch.stack(all_states),
        'actions': torch.tensor(all_actions, dtype=torch.long),
        'rewards': all_rewards,
        'old_log_probs': torch.tensor(all_log_probs, dtype=torch.float32),
        'values': torch.tensor(all_values, dtype=torch.float32),
        'masks': torch.stack(all_masks),
        'is_buy': torch.tensor(all_is_buy, dtype=torch.bool),
        'dones': all_dones,
        'game_rewards': game_rewards,
    }
```

- [ ] **Step 2: Write GAE and PPO update**

Continue in `ppo.py`:

```python
def compute_gae(rewards, values, dones, gamma=0.99, lam=0.95):
    """Generalized Advantage Estimation."""
    advantages = []
    gae = 0
    # Append 0 as terminal value
    next_value = 0
    for t in reversed(range(len(rewards))):
        if dones[t]:
            next_value = 0
            gae = 0
        delta = rewards[t] + gamma * next_value - values[t]
        gae = delta + gamma * lam * gae
        advantages.insert(0, gae)
        next_value = values[t]
    advantages = torch.tensor(advantages, dtype=torch.float32)
    returns = advantages + torch.tensor(values, dtype=torch.float32) if isinstance(values, list) else advantages + values
    return advantages, returns


def ppo_update(net, optimizer, batch, epochs=4, clip_eps=0.2, entropy_coef=0.05):
    """Perform PPO clipped update on collected batch."""
    states = batch['states']
    actions = batch['actions']
    old_log_probs = batch['old_log_probs']
    masks = batch['masks']
    is_buy = batch['is_buy']

    advantages, returns = compute_gae(
        batch['rewards'], batch['values'].tolist(), batch['dones']
    )

    # Normalize advantages
    if len(advantages) > 1:
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
    advantages = advantages.clamp(-5.0, 5.0)
    returns = returns.clamp(-10.0, 10.0)

    total_loss_sum = 0
    gameplay_entropy_sum = 0

    for epoch in range(epochs):
        # Forward pass
        policy_logits, values = net(states, is_buy)
        masked_logits = policy_logits + (masks - 1) * 1e9
        log_probs = F.log_softmax(masked_logits, dim=1)
        action_log_probs = log_probs[range(len(actions)), actions]

        # PPO clipped objective
        ratio = torch.exp(action_log_probs - old_log_probs.detach())
        clipped_ratio = torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps)
        policy_loss = -torch.min(ratio * advantages, clipped_ratio * advantages).mean()

        # Value loss
        value_loss = F.mse_loss(values.squeeze(1), returns)

        # Entropy (gameplay only — excludes buy decisions)
        gameplay_entropy = net.get_gameplay_entropy(policy_logits, masks, is_buy)
        entropy_bonus = -entropy_coef * gameplay_entropy

        loss = policy_loss + 0.5 * value_loss + entropy_bonus

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
        optimizer.step()

        total_loss_sum += loss.item()
        gameplay_entropy_sum += gameplay_entropy.item()

    avg_loss = total_loss_sum / epochs
    avg_entropy = gameplay_entropy_sum / epochs
    return avg_loss, avg_entropy
```

- [ ] **Step 3: Write main training loop**

Continue in `ppo.py`:

```python
def train(args):
    print(f"Shanghai PPO Training")
    print(f"  Total games: {args.games}")
    print(f"  Batch size: {args.batch_size} games per update")
    print(f"  PPO epochs: {args.ppo_epochs}")
    print(f"  Learning rate: {args.lr}")
    print(f"  Entropy coef: {args.entropy_coef}")
    print(f"  Players: {args.players}")
    print(f"  Opponent: {args.opponent_ai or 'random'}")
    print(f"  Clip epsilon: {args.clip_eps}")
    print()

    env = ShanghaiEnv(
        player_count=args.players,
        opponent_ai=args.opponent_ai,
        rich_state=True,
    )
    net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)
    optimizer = optim.Adam(net.parameters(), lr=args.lr)

    model_path = MODELS_DIR / "shanghai_ppo.pt"
    best_path = MODELS_DIR / "shanghai_ppo_best.pt"

    if model_path.exists() and not args.fresh:
        print(f"Loading model from {model_path}")
        net.load_state_dict(torch.load(model_path, weights_only=True))

    all_rewards = []
    best_avg_reward = float("-inf")
    games_completed = 0

    while games_completed < args.games:
        t0 = time.time()

        # Collect batch of trajectories
        batch = collect_batch(env, net, args.batch_size, args.temperature)
        batch_rewards = batch['game_rewards']
        games_completed += len(batch_rewards)
        all_rewards.extend(batch_rewards)

        # PPO update (multiple epochs on this batch)
        avg_loss, avg_entropy = ppo_update(
            net, optimizer, batch,
            epochs=args.ppo_epochs,
            clip_eps=args.clip_eps,
            entropy_coef=args.entropy_coef,
        )

        elapsed = time.time() - t0
        recent = all_rewards[-100:]
        avg = sum(recent) / len(recent)
        batch_avg = sum(batch_rewards) / len(batch_rewards)

        print(
            f"Games {games_completed:5d} | "
            f"Batch avg: {batch_avg:7.1f} | "
            f"Avg(100): {avg:7.1f} | "
            f"Loss: {avg_loss:8.4f} | "
            f"Entropy: {avg_entropy:.3f} | "
            f"Time: {elapsed:.1f}s"
        )

        # Save checkpoint every N games
        if games_completed % (args.batch_size * 10) == 0 or games_completed >= args.games:
            torch.save(net.state_dict(), model_path)
            if avg > best_avg_reward:
                best_avg_reward = avg
                torch.save(net.state_dict(), best_path)
                print(f"  => New best model! Avg reward: {avg:.1f}")
            else:
                print(f"  => Checkpoint saved")

    torch.save(net.state_dict(), model_path)
    print(f"\nTraining complete. Best avg reward: {best_avg_reward:.1f}")
    env.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Shanghai Rummy AI via PPO")
    parser.add_argument("--games", type=int, default=5000)
    parser.add_argument("--batch-size", type=int, default=10, help="Games per PPO update")
    parser.add_argument("--ppo-epochs", type=int, default=4, help="Gradient steps per batch")
    parser.add_argument("--lr", type=float, default=0.0003)
    parser.add_argument("--entropy-coef", type=float, default=0.05)
    parser.add_argument("--clip-eps", type=float, default=0.2, help="PPO clip epsilon")
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--players", type=int, default=4)
    parser.add_argument("--opponent-ai", type=str, default=None)
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()
    train(args)
```

- [ ] **Step 4: Test PPO runs end-to-end**

```bash
cd ml/training
python ppo.py --games 20 --batch-size 5 --fresh --opponent-ai the-shark --players 4
```

Expected: 4 batches of 5 games each, entropy ~5.8, no crashes.

- [ ] **Step 5: Commit**

```bash
git add ml/training/ppo.py
git commit -m "feat(ml): PPO training loop with batch collection, GAE, clipped objective"
```

---

## Phase 3: Curriculum Learning

### Task 6: Create curriculum manager

**Files:**
- Create: `ml/training/curriculum.py`

- [ ] **Step 1: Write the curriculum manager**

```python
"""
Curriculum manager — promotes the model through difficulty tiers.

Tiers:
  1. 2-player, random opponent (learn basic mechanics)
  2. 2-player, rookie-riley (learn against weak strategy)
  3. 4-player, steady-sam (learn multiplayer + buying basics)
  4. 4-player, patient-pat (learn patience and timing)
  5. 4-player, the-shark (learn competitive play)
  6. 4-player, the-nemesis (learn adaptive play)

Promotion: avg reward over last 200 games improves less than 2% over 500 games (plateaued).
"""

TIERS = [
    {"players": 2, "opponent": None,          "label": "2P random"},
    {"players": 2, "opponent": "rookie-riley", "label": "2P rookie"},
    {"players": 4, "opponent": "steady-sam",   "label": "4P steady"},
    {"players": 4, "opponent": "patient-pat",  "label": "4P patient"},
    {"players": 4, "opponent": "the-shark",    "label": "4P shark"},
    {"players": 4, "opponent": "the-nemesis",  "label": "4P nemesis"},
]


class CurriculumManager:
    def __init__(self, plateau_window=500, improvement_threshold=0.02):
        self.tier = 0
        self.plateau_window = plateau_window
        self.improvement_threshold = improvement_threshold
        self.rewards_at_tier = []

    @property
    def current(self):
        return TIERS[min(self.tier, len(TIERS) - 1)]

    @property
    def max_tier(self):
        return len(TIERS) - 1

    def record(self, reward):
        self.rewards_at_tier.append(reward)

    def should_promote(self):
        if self.tier >= self.max_tier:
            return False
        if len(self.rewards_at_tier) < self.plateau_window:
            return False

        recent = self.rewards_at_tier[-200:]
        earlier = self.rewards_at_tier[-self.plateau_window:-self.plateau_window + 200]
        if not earlier:
            return False

        recent_avg = sum(recent) / len(recent)
        earlier_avg = sum(earlier) / len(earlier)

        # Improvement less than threshold = plateaued
        if earlier_avg == 0:
            return True
        improvement = (recent_avg - earlier_avg) / abs(earlier_avg)
        return improvement < self.improvement_threshold

    def promote(self):
        if self.tier < self.max_tier:
            self.tier += 1
            self.rewards_at_tier = []
            print(f"\n{'='*50}")
            print(f"  PROMOTED TO TIER {self.tier}: {self.current['label']}")
            print(f"{'='*50}\n")
            return True
        return False
```

- [ ] **Step 2: Integrate curriculum into ppo.py**

Add to the main training loop in `ppo.py`: before the while loop, create a `CurriculumManager`. After each batch, call `record()` and `should_promote()`. On promotion, create a new environment with the new tier's settings.

```python
# In train(), before the while loop:
from curriculum import CurriculumManager
curriculum = CurriculumManager()
tier = curriculum.current
env = ShanghaiEnv(player_count=tier['players'], opponent_ai=tier['opponent'], rich_state=True)
print(f"Starting at tier {curriculum.tier}: {tier['label']}")

# After updating all_rewards in the loop:
for r in batch_rewards:
    curriculum.record(r)

if curriculum.should_promote():
    curriculum.promote()
    tier = curriculum.current
    env.close()
    env = ShanghaiEnv(player_count=tier['players'], opponent_ai=tier['opponent'], rich_state=True)
```

- [ ] **Step 3: Commit**

```bash
git add ml/training/curriculum.py ml/training/ppo.py
git commit -m "feat(ml): curriculum learning — auto-promote through difficulty tiers"
```

---

## Phase 4: Evaluation Framework

### Task 7: Create evaluation script

**Files:**
- Create: `ml/training/evaluate.py`

- [ ] **Step 1: Write evaluation framework**

```python
"""
Evaluation framework — measures model skill on fixed seed games.

Plays N games with fixed seeds so results are comparable across model versions.
Reports: win rate, avg score, avg score vs opponent, per-round stats.

Usage:
    python evaluate.py --model shanghai_ppo_best.pt --opponent the-shark --games 100 --players 4
"""

import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from shanghai_env import ShanghaiEnv
from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS

MODELS_DIR = Path(__file__).parent.parent / "models"
DATA_DIR = Path(__file__).parent.parent / "data" / "eval"


def encode_action(action):
    if action == "draw_pile": return 0
    if action == "take_discard": return 1
    if action == "meld": return 2
    if action.startswith("discard:"): return 3 + int(action.split(":")[1])
    if action.startswith("layoff:"):
        parts = action.split(":")
        return 19 + int(parts[1]) * 20 + int(parts[2])
    if action == "buy": return 339
    if action == "decline_buy": return 340
    return 0


def get_action_mask(valid_actions):
    mask = torch.zeros(MAX_ACTIONS)
    for a in valid_actions:
        mask[encode_action(a)] = 1.0
    return mask


def evaluate(args):
    env = ShanghaiEnv(player_count=args.players, opponent_ai=args.opponent, rich_state=True)
    net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)

    model_path = MODELS_DIR / args.model
    if not model_path.exists():
        print(f"Error: {model_path} not found")
        return
    net.load_state_dict(torch.load(model_path, weights_only=True))
    net.eval()

    wins, total_score, total_opp_score = 0, 0, 0
    results = []

    print(f"Evaluating {args.model} vs {args.opponent or 'random'} ({args.games} games, {args.players} players)\n")

    for i in range(args.games):
        seed = 10000 + i  # fixed seeds for reproducibility
        state = env.reset(seed=seed)
        done = False
        steps = 0

        while not done and steps < 3000:
            actions, player = env.get_valid_actions()
            if not actions:
                break
            if player == 0:
                state_tensor = torch.tensor([state], dtype=torch.float32)
                with torch.no_grad():
                    logits, _ = net(state_tensor)
                mask = get_action_mask(actions)
                masked = logits[0] + (mask - 1) * 1e9
                action_idx = masked.argmax().item()  # greedy at eval time
                action_str = {encode_action(a): a for a in actions}.get(action_idx, actions[0])
            else:
                import random
                action_str = random.choice(actions)
            state, _, done, info = env.step(action_str)
            steps += 1

        scores = info.get("scores", [0])
        my_score = scores[0] if scores else 0
        opp_best = min(scores[1:]) if len(scores) > 1 else 0
        won = my_score <= opp_best

        wins += won
        total_score += my_score
        total_opp_score += opp_best
        results.append({"seed": seed, "score": my_score, "opp_score": opp_best, "won": won})

        if (i + 1) % 20 == 0:
            wr = 100 * wins / (i + 1)
            print(f"  Game {i+1:4d} | Win rate: {wr:.1f}% | Avg: {total_score/(i+1):.0f} vs {total_opp_score/(i+1):.0f}")

    env.close()

    wr = 100 * wins / args.games
    avg_score = total_score / args.games
    avg_opp = total_opp_score / args.games

    print(f"\n{'='*50}")
    print(f"  EVALUATION RESULTS")
    print(f"{'='*50}")
    print(f"  Model:         {args.model}")
    print(f"  Opponent:      {args.opponent or 'random'}")
    print(f"  Games:         {args.games}")
    print(f"  Win rate:      {wr:.1f}%")
    print(f"  Avg score:     {avg_score:.1f}")
    print(f"  Avg opponent:  {avg_opp:.1f}")
    print(f"{'='*50}")

    # Save results
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DATA_DIR / f"eval_{args.model.replace('.pt','')}_vs_{args.opponent or 'random'}.json"
    json.dump({"metadata": vars(args), "win_rate": wr, "avg_score": avg_score, "results": results}, open(out_path, "w"), indent=2)
    print(f"  Saved to: {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="shanghai_ppo_best.pt")
    parser.add_argument("--opponent", default="the-shark")
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--players", type=int, default=4)
    args = parser.parse_args()
    evaluate(args)
```

- [ ] **Step 2: Commit**

```bash
git add ml/training/evaluate.py
git commit -m "feat(ml): evaluation framework with fixed seeds and win rate tracking"
```

---

## Phase 5: Bridge Validation

### Task 8: Validate bridge game stats match simulation

**Files:**
- Create: `ml/scripts/validate_bridge.py`

- [ ] **Step 1: Write bridge validation script**

Run 30 games through the bridge with Shark AI on both sides and compare stats (avg score, turns per round, meld timing) against the simulation results from `src/simulation/results/hard-report.txt`.

```python
"""Validate bridge produces games similar to the simulation framework."""

from shanghai_env import ShanghaiEnv
import random, json

def run_validation(num_games=30, players=4):
    env = ShanghaiEnv(player_count=players, opponent_ai='the-shark')
    scores = []
    steps_list = []

    for i in range(num_games):
        state = env.reset(seed=42 + i)
        done = False
        steps = 0
        while not done and steps < 5000:
            actions, player = env.get_valid_actions()
            if not actions: break
            if player == 0:
                action = random.choice(actions)  # random player 0
            state, _, done, info = env.step(action)
            steps += 1

        game_scores = info.get("scores", [])
        scores.append(game_scores)
        steps_list.append(steps)

    env.close()

    # Report
    all_player_scores = [s[i] for s in scores for i in range(len(s))]
    avg_score = sum(all_player_scores) / len(all_player_scores) if all_player_scores else 0
    avg_steps = sum(steps_list) / len(steps_list)

    print(f"Bridge Validation ({num_games} games, {players} players)")
    print(f"  Avg player score: {avg_score:.1f}")
    print(f"  Avg steps/game: {avg_steps:.0f}")
    print(f"  Target (from simulation): avg ~230, games complete normally")
    print(f"  {'PASS' if 100 < avg_score < 500 else 'WARN'}: Score range reasonable")
    print(f"  {'PASS' if avg_steps < 4000 else 'WARN'}: Games completing")

if __name__ == "__main__":
    run_validation()
```

- [ ] **Step 2: Run validation**

```bash
cd ml/training
python ../scripts/validate_bridge.py
```

Expected: avg scores in 150-350 range, all games completing.

- [ ] **Step 3: Commit**

```bash
git add ml/scripts/validate_bridge.py
git commit -m "feat(ml): bridge validation script to verify game stats match simulation"
```

---

## Execution Order

1. **Task 1** — Rich state bridge encoding
2. **Task 2** — Python state encoder constants
3. **Task 3** — Environment rich state flag
4. **Task 4** — PPO network v2
5. **Task 5** — PPO training loop
6. **Task 6** — Curriculum manager
7. **Task 7** — Evaluation framework
8. **Task 8** — Bridge validation

Tasks 1-3 are sequential (each builds on the last). Tasks 4-5 are sequential. Tasks 6-8 can be done in parallel after Task 5.

## Success Criteria

- **Tier 1 (2P random):** avg score < 400 within 500 games
- **Tier 2 (2P rookie):** avg score < 350 within 1000 games
- **Tier 3 (4P steady):** avg score < 300 within 2000 games
- **Tier 4 (4P patient):** avg score < 250 within 3000 games
- **Tier 5 (4P shark):** avg score < 200 (matching Shark's own avg)
- **Tier 6 (4P nemesis):** avg score < 191 (beating the best AI)
- **Ultimate:** win rate > 50% against Nemesis in 100 fixed-seed games
