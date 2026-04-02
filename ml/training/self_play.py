"""
Self-play training loop for Shanghai Rummy.

Uses REINFORCE with baseline (policy gradient) to train the network.
The agent plays games against itself, collects trajectories, and updates
the network to favor actions that led to lower scores.

Usage:
    python self_play.py --games 1000 --lr 0.001 --save-every 100

The trained model is saved to ml/models/shanghai_policy.pt
"""

import argparse
import random
import time
from pathlib import Path

import torch
import torch.optim as optim
import torch.nn.functional as F

from shanghai_env import ShanghaiEnv
from network import ShanghaiNet, encode_action, decode_action, get_action_mask, STATE_SIZE, MAX_ACTIONS

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


def collect_trajectory(env: ShanghaiEnv, net: ShanghaiNet, temperature=1.0):
    """
    Play one complete game, collecting (state, action, reward) at each step.
    The agent controls player 0; opponents are either random or AI (handled by bridge).

    When opponent_ai is set, the bridge auto-plays opponents after each agent action,
    so every get_actions/step call is for player 0.

    Reward scheme: only per-round score deltas (no double-counting).

    Returns:
        states: list of state tensors
        actions: list of action indices
        rewards: list of per-step rewards
        total_reward: final game reward for player 0
    """
    state = env.reset()
    states, actions, rewards, is_buy_step = [], [], [], []
    done = False
    step_count = 0
    max_steps = 3000  # Safety limit
    use_ai_opponents = env.opponent_ai is not None

    prev_score = 0  # track agent's cumulative score for delta rewards

    while not done and step_count < max_steps:
        valid_actions, current_player = env.get_valid_actions()
        if not valid_actions:
            break

        if current_player == 0:
            # Agent's turn — use the network
            state_tensor = torch.tensor([state], dtype=torch.float32)
            with torch.no_grad():
                policy_logits, _ = net(state_tensor)

            # Mask invalid actions
            mask = get_action_mask(valid_actions)
            masked_logits = policy_logits[0] + (mask - 1) * 1e9  # -inf for invalid

            # Sample from policy with temperature
            probs = F.softmax(masked_logits / temperature, dim=0)
            action_idx = torch.multinomial(probs, 1).item()
            action_str = decode_action(action_idx, valid_actions)

            states.append(state_tensor.squeeze(0))
            actions.append(action_idx)
            is_buy_step.append(action_str in ('buy', 'decline_buy'))

            # step() returns after AI opponents have also played (if opponent_ai set)
            state, reward, done, info = env.step(action_str)

            # Reward = negative score delta (captures both agent and opponent round outcomes)
            step_reward = 0.0
            if info.get("scores"):
                current_score = info["scores"][0] if info["scores"] else 0
                delta = current_score - prev_score
                if delta != 0:
                    step_reward = -delta / 100.0  # scale down to prevent gradient explosion
                    prev_score = current_score

            rewards.append(step_reward)
        else:
            # Opponent's turn — only reached when NOT using AI opponents (random mode)
            action = random.choice(valid_actions)
            state, reward, done, info = env.step(action)

            # Attribute opponent-caused score changes to agent's last step
            if states and info.get("scores"):
                current_score = info["scores"][0] if info["scores"] else 0
                delta = current_score - prev_score
                if delta != 0:
                    rewards[-1] += -delta / 100.0
                    prev_score = current_score

        step_count += 1

    # total_reward in original scale for logging
    total_reward = -prev_score  # negative final score (lower = better)
    return states, actions, rewards, total_reward, is_buy_step


def compute_returns(rewards, gamma=0.99):
    """Compute discounted returns for each timestep."""
    returns = []
    G = 0
    for r in reversed(rewards):
        G = r + gamma * G
        returns.insert(0, G)
    return returns


def train(args):
    print(f"Shanghai RL Training")
    print(f"  Games: {args.games}")
    print(f"  Learning rate: {args.lr}")
    print(f"  Temperature: {args.temperature}")
    print(f"  Players: {args.players}")
    print(f"  Opponent AI: {args.opponent_ai or 'random'}")
    print(f"  Entropy coef: {args.entropy_coef} ({'adaptive' if args.adaptive_entropy else 'fixed'})")
    print(f"  Entropy target: {args.entropy_target}")
    print(f"  Save every: {args.save_every} games")
    print()

    env = ShanghaiEnv(player_count=args.players, opponent_ai=args.opponent_ai)
    net = ShanghaiNet(state_size=STATE_SIZE)
    optimizer = optim.Adam(net.parameters(), lr=args.lr)

    # Load existing model if available
    model_path = MODELS_DIR / "shanghai_policy.pt"
    best_path = MODELS_DIR / "shanghai_policy_best.pt"
    if args.from_best and best_path.exists() and not args.fresh:
        print(f"Loading best model from {best_path}")
        net.load_state_dict(torch.load(best_path, weights_only=True))
    elif model_path.exists() and not args.fresh:
        print(f"Loading existing model from {model_path}")
        net.load_state_dict(torch.load(model_path, weights_only=True))

    all_rewards = []
    best_avg_reward = float("-inf")
    entropy_coef = args.entropy_coef  # mutable — adaptive mode adjusts this

    for game_num in range(1, args.games + 1):
        start = time.time()

        # Collect a trajectory
        states, actions, rewards, total_reward, is_buy_step = collect_trajectory(
            env, net, temperature=args.temperature
        )
        all_rewards.append(total_reward)

        if not states:
            print(f"Game {game_num}: No states collected (game may have errored)")
            continue

        # Compute returns
        returns = compute_returns(rewards)
        returns_tensor = torch.tensor(returns, dtype=torch.float32)

        # Normalize returns
        if len(returns_tensor) > 1:
            returns_tensor = (returns_tensor - returns_tensor.mean()) / (returns_tensor.std() + 1e-8)

        # Clip returns to prevent extreme targets
        returns_tensor = returns_tensor.clamp(-10.0, 10.0)

        # Forward pass
        state_batch = torch.stack(states)
        policy_logits, values = net(state_batch)

        # Policy loss (REINFORCE with baseline)
        log_probs = F.log_softmax(policy_logits, dim=1)
        action_log_probs = log_probs[range(len(actions)), actions]
        advantages = returns_tensor - values.squeeze(1).detach()
        # Clip advantages to stabilize gradients
        advantages = advantages.clamp(-5.0, 5.0)
        policy_loss = -(action_log_probs * advantages).mean()

        # Entropy bonus — computed only on gameplay actions (not buy/decline)
        # Buy decisions are binary and dominate the action count, collapsing entropy
        probs = F.softmax(policy_logits, dim=1)
        per_step_entropy = -(probs * log_probs).sum(dim=1)

        buy_mask = torch.tensor(is_buy_step, dtype=torch.bool)
        gameplay_mask = ~buy_mask
        if gameplay_mask.any():
            entropy = per_step_entropy[gameplay_mask].mean()
        else:
            entropy = per_step_entropy.mean()  # fallback if all steps are buy decisions

        # Full entropy (including buys) still used for the loss on buy steps
        entropy_all = per_step_entropy.mean()

        # Adaptive entropy: proportional control toward target
        if args.adaptive_entropy:
            entropy_val = entropy.item()
            # Positive error = entropy too low, need more exploration
            # Negative error = entropy too high, can allow specialization
            entropy_error = args.entropy_target - entropy_val
            # Gentle proportional adjustment — 0.0005 per unit of error per game
            # e.g., entropy 4.7 with target 5.2 → error 0.5 → +0.00025/game
            entropy_coef = entropy_coef + 0.0005 * entropy_error
            entropy_coef = max(0.01, min(0.15, entropy_coef))  # floor at 0.01, never too low

        entropy_bonus = -entropy_coef * entropy_all  # applied to all steps including buys

        # Value loss
        value_loss = F.mse_loss(values.squeeze(1), returns_tensor)

        # Combined loss
        loss = policy_loss + 0.5 * value_loss + entropy_bonus

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        optimizer.step()

        elapsed = time.time() - start

        # Logging
        if game_num % 10 == 0 or game_num == 1:
            recent = all_rewards[-100:]
            avg = sum(recent) / len(recent)
            ent_str = f"Entropy: {entropy.item():.3f}"
            if args.adaptive_entropy:
                ent_str += f" (coef: {entropy_coef:.4f})"
            print(
                f"Game {game_num:5d} | "
                f"Reward: {total_reward:7.1f} | "
                f"Avg(100): {avg:7.1f} | "
                f"Loss: {loss.item():10.4f} | "
                f"{ent_str} | "
                f"Steps: {len(states):4d} | "
                f"Time: {elapsed:.1f}s"
            )

        # Save checkpoint
        if game_num % args.save_every == 0:
            torch.save(net.state_dict(), model_path)
            recent = all_rewards[-100:]
            avg = sum(recent) / len(recent)
            if avg > best_avg_reward:
                best_avg_reward = avg
                best_path = MODELS_DIR / "shanghai_policy_best.pt"
                torch.save(net.state_dict(), best_path)
                print(f"  => New best model saved! Avg reward: {avg:.1f}")
            else:
                print(f"  => Checkpoint saved")

    # Final save
    torch.save(net.state_dict(), model_path)
    print(f"\nTraining complete. Model saved to {model_path}")
    print(f"Best avg reward: {best_avg_reward:.1f}")

    env.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Shanghai Rummy AI via self-play")
    parser.add_argument("--games", type=int, default=1000, help="Number of games to play")
    parser.add_argument("--lr", type=float, default=0.0003, help="Learning rate")
    parser.add_argument("--entropy-coef", type=float, default=0.03, help="Entropy bonus coefficient")
    parser.add_argument("--temperature", type=float, default=1.0, help="Action sampling temperature (lower = more greedy)")
    parser.add_argument("--players", type=int, default=2, help="Number of players (2-8)")
    parser.add_argument("--save-every", type=int, default=100, help="Save model every N games")
    parser.add_argument("--fresh", action="store_true", help="Start fresh (ignore existing model)")
    parser.add_argument("--from-best", action="store_true", help="Load from best model instead of latest checkpoint")
    parser.add_argument("--adaptive-entropy", action="store_true", help="Auto-adjust entropy coef to stay near target")
    parser.add_argument("--entropy-target", type=float, default=5.2, help="Target entropy for adaptive mode (default: 5.2)")
    parser.add_argument("--opponent-ai", type=str, default=None,
                        help="AI personality for opponents (e.g., the-shark, the-nemesis). Default: random")
    args = parser.parse_args()
    train(args)
