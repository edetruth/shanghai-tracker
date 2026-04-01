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
    The agent controls player 0; other players use random valid actions.

    Returns:
        states: list of state tensors
        actions: list of action indices
        rewards: list of per-step rewards (all 0 except final)
        total_reward: final game reward for player 0
    """
    state = env.reset()
    states, actions, rewards = [], [], []
    done = False
    step_count = 0
    max_steps = 3000  # Safety limit — bridge forces round-end at 200 turns per round

    prev_scores = [0] * env.player_count  # track cumulative scores to compute per-round delta

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

            state, reward, done, info = env.step(action_str)

            # Compute intermediate reward from score changes
            step_reward = reward  # final game reward (non-zero only at game end)
            if info.get("scores"):
                current_score = info["scores"][0] if info["scores"] else 0
                delta = current_score - prev_scores[0]
                if delta != 0:
                    step_reward = -delta  # negative score delta = reward (lower score is better)
                    prev_scores[0] = current_score

            rewards.append(step_reward)
        else:
            # Opponent's turn — random valid action
            action = random.choice(valid_actions)
            state, reward, done, info = env.step(action)

            # If opponent's action ended the game, attribute final reward to agent
            if done and states:
                final_scores = info.get("scores", [0])
                agent_score = final_scores[0] if final_scores else 0
                rewards[-1] += -agent_score  # add final score penalty to last agent step

        step_count += 1

    total_reward = sum(rewards)
    return states, actions, rewards, total_reward


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
    print(f"  Save every: {args.save_every} games")
    print()

    env = ShanghaiEnv(player_count=args.players)
    net = ShanghaiNet(state_size=STATE_SIZE)
    optimizer = optim.Adam(net.parameters(), lr=args.lr)

    # Load existing model if available
    model_path = MODELS_DIR / "shanghai_policy.pt"
    if model_path.exists() and not args.fresh:
        print(f"Loading existing model from {model_path}")
        net.load_state_dict(torch.load(model_path, weights_only=True))

    all_rewards = []
    best_avg_reward = float("-inf")

    for game_num in range(1, args.games + 1):
        start = time.time()

        # Collect a trajectory
        states, actions, rewards, total_reward = collect_trajectory(
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

        # Forward pass
        state_batch = torch.stack(states)
        policy_logits, values = net(state_batch)

        # Policy loss (REINFORCE with baseline)
        log_probs = F.log_softmax(policy_logits, dim=1)
        action_log_probs = log_probs[range(len(actions)), actions]
        advantages = returns_tensor - values.squeeze(1).detach()
        policy_loss = -(action_log_probs * advantages).mean()

        # Value loss
        value_loss = F.mse_loss(values.squeeze(1), returns_tensor)

        # Combined loss
        loss = policy_loss + 0.5 * value_loss

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        optimizer.step()

        elapsed = time.time() - start

        # Logging
        if game_num % 10 == 0 or game_num == 1:
            recent = all_rewards[-100:]
            avg = sum(recent) / len(recent)
            print(
                f"Game {game_num:5d} | "
                f"Reward: {total_reward:7.1f} | "
                f"Avg(100): {avg:7.1f} | "
                f"Loss: {loss.item():.4f} | "
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
                print(f"  → New best model saved! Avg reward: {avg:.1f}")
            else:
                print(f"  → Checkpoint saved")

    # Final save
    torch.save(net.state_dict(), model_path)
    print(f"\nTraining complete. Model saved to {model_path}")
    print(f"Best avg reward: {best_avg_reward:.1f}")

    env.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Shanghai Rummy AI via self-play")
    parser.add_argument("--games", type=int, default=1000, help="Number of games to play")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--temperature", type=float, default=1.0, help="Action sampling temperature (lower = more greedy)")
    parser.add_argument("--players", type=int, default=2, help="Number of players (2-8)")
    parser.add_argument("--save-every", type=int, default=100, help="Save model every N games")
    parser.add_argument("--fresh", action="store_true", help="Start fresh (ignore existing model)")
    args = parser.parse_args()
    train(args)
