"""
PPO training loop for Shanghai Rummy.

Replaces the REINFORCE-based self_play.py with a Proximal Policy Optimization
(PPO) algorithm using Generalized Advantage Estimation (GAE).

Usage:
    python ppo.py --games 5000 --batch-size 10 --lr 0.0003

The trained model is saved to ml/models/shanghai_ppo.pt
"""

import argparse
import random
import time
from pathlib import Path

import torch
import torch.optim as optim
import torch.nn.functional as F

from shanghai_env import ShanghaiEnv
from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


# ── Action encoding helpers (PPO v2: 26 strategic actions) ─────────────────────

def encode_action(action: str) -> int:
    """Map a strategic action string to index in [0, 26)."""
    if action == "draw_pile":
        return 0
    if action == "take_discard":
        return 1
    if action.startswith("discard:"):
        idx = int(action.split(":")[1])
        return 2 + min(idx, 21)  # slots 2..23
    if action == "buy":
        return BUY_ACTION_IDX
    if action == "decline_buy":
        return DECLINE_BUY_ACTION_IDX
    return 0  # fallback


def decode_action(index: int, valid_actions: list) -> str:
    """Reverse-map an integer index back to the closest valid action string."""
    action_to_idx = {a: encode_action(a) for a in valid_actions}
    idx_to_action = {v: k for k, v in action_to_idx.items()}
    return idx_to_action.get(index, valid_actions[0] if valid_actions else "draw_pile")


def get_action_mask(valid_actions: list) -> torch.Tensor:
    """Return a float mask tensor of shape (MAX_ACTIONS,) — 1 for valid, 0 for invalid."""
    mask = torch.zeros(MAX_ACTIONS)
    for a in valid_actions:
        idx = encode_action(a)
        if 0 <= idx < MAX_ACTIONS:
            mask[idx] = 1.0
    return mask


# ── Batch collection ───────────────────────────────────────────────────────────

def collect_batch(
    env: ShanghaiEnv,
    net: ShanghaiNetV2,
    batch_size: int,
    temperature: float = 1.0,
    player_count: int = 2,
) -> dict:
    """
    Play `batch_size` complete games and collect all player-0 experience tuples.

    Returns a dict with:
        states      : (N, RICH_STATE_SIZE) float tensor
        actions     : (N,) long tensor
        log_probs   : (N,) float tensor — log-prob of chosen action under old policy
        values      : (N,) float tensor — value estimates from the critic
        rewards     : (N,) float tensor — per-step scalar reward
        masks       : (N, MAX_ACTIONS) float tensor — action validity masks
        is_buy      : (N,) bool tensor — True if the step was a buy/decline_buy
        dones       : (N,) float tensor — 1.0 at the last step of each episode
        game_rewards: list[float] — total reward per game (for logging)
    """
    all_states: list[torch.Tensor] = []
    all_actions: list[int] = []
    all_log_probs: list[float] = []
    all_values: list[float] = []
    all_rewards: list[float] = []
    all_masks: list[torch.Tensor] = []
    all_is_buy: list[bool] = []
    all_dones: list[float] = []

    game_rewards: list[float] = []
    game_wins: list[bool] = []

    use_ai_opponents = env.opponent_ai is not None

    net.eval()
    with torch.no_grad():
        for _ in range(batch_size):
            state_list = env.reset()
            done = False
            step_count = 0
            # Scale step budget with player count: 4P games have buy windows
            # and more opponent turns that generate RL decision points.
            # Needs to be generous — rounds can cycle 300+ steps without going out,
            # and diagnose showed 94% timeout at 2000 for 2P.
            max_steps = 4000 * max(1, player_count // 2)

            prev_score = 0.0
            agent_won = False
            # Track the last index written by player 0 for done marking
            last_agent_idx: int = -1

            # Indices into the shared lists for this episode (needed for dones)
            episode_start = len(all_states)

            while not done and step_count < max_steps:
                valid_actions, current_player, auto_state = env.get_strategic_actions()
                if not valid_actions:
                    break

                # If auto-meld/layoff updated the state, use the fresh one
                if auto_state is not None:
                    state_list = auto_state

                if current_player == 0:
                    state_tensor = torch.tensor(state_list, dtype=torch.float32).unsqueeze(0)
                    policy_logits, value = net(state_tensor)

                    mask = get_action_mask(valid_actions)
                    masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
                    probs = F.softmax(masked_logits / temperature, dim=0)
                    dist = torch.distributions.Categorical(probs)
                    action_idx_t = dist.sample()
                    action_idx = action_idx_t.item()
                    log_prob = dist.log_prob(action_idx_t).item()
                    action_str = decode_action(action_idx, valid_actions)
                    is_buy = action_str in ("buy", "decline_buy")

                    all_states.append(state_tensor.squeeze(0))
                    all_actions.append(action_idx)
                    all_log_probs.append(log_prob)
                    all_values.append(value.item())
                    all_masks.append(mask)
                    all_is_buy.append(is_buy)
                    all_rewards.append(0.0)
                    all_dones.append(0.0)
                    last_agent_idx = len(all_states) - 1

                    state_list, _, done, info = env.step(action_str)

                    # ── Outcome-based reward ──
                    # No hand-eval shaping: it was dominating the signal (~95% of
                    # reward magnitude) and training the model to chase hand_eval
                    # deltas instead of winning. Pure game-outcome signal is sparse
                    # but faithful — score changes fire at every round end.
                    step_reward = -0.001  # small time penalty to discourage stalling

                    # Score change at round end — primary learning signal.
                    # info.scores is cumulative total, so delta = round points scored.
                    if info.get("scores"):
                        current_score = float(info["scores"][0])
                        delta = current_score - prev_score
                        if delta != 0:
                            # -delta/50 gives ~-2 for a 100-point round, ~0 for going out
                            step_reward += -delta / 50.0
                            prev_score = current_score

                    all_rewards[last_agent_idx] = step_reward

                    if done:
                        all_dones[last_agent_idx] = 1.0
                        # Game-end bonuses — scaled 5x vs the previous run.
                        # Prior values (+10 / -5 / spread/100) left the value
                        # function tracking round number (corr +0.109 instead
                        # of negative). Bigger terminals force the critic to
                        # learn outcome prediction rather than a step-count proxy.
                        if info.get("scores"):
                            scores = [float(s) for s in info["scores"]]
                            agent_score = scores[0]
                            best_score = min(scores)
                            if agent_score == best_score:
                                all_rewards[last_agent_idx] += 50.0  # game win
                                agent_won = True
                            else:
                                all_rewards[last_agent_idx] -= 25.0  # game loss
                            # Score-spread penalty scales with how badly we lost
                            all_rewards[last_agent_idx] += -(agent_score - best_score) / 20.0

                else:
                    # Opponent turn — random when no opponent_ai bridge
                    action_str = random.choice(valid_actions)
                    state_list, _, done, info = env.step(action_str)

                    # Round-end score change: attribute to agent's last step
                    if info.get("scores") and last_agent_idx >= 0:
                        current_score = float(info["scores"][0])
                        delta = current_score - prev_score
                        if delta != 0:
                            all_rewards[last_agent_idx] += -delta / 50.0
                            prev_score = current_score

                    if done and last_agent_idx >= 0:
                        all_dones[last_agent_idx] = 1.0
                        # Check if agent won even though game ended on opponent turn.
                        # Scaled 5x — must match the agent-turn path above.
                        if info.get("scores"):
                            scores = [float(s) for s in info["scores"]]
                            agent_score = scores[0]
                            best_score = min(scores)
                            if agent_score == best_score:
                                all_rewards[last_agent_idx] += 50.0
                                agent_won = True
                            else:
                                all_rewards[last_agent_idx] -= 25.0
                            all_rewards[last_agent_idx] += -(agent_score - best_score) / 20.0

                step_count += 1

            # Timeout penalty — scaled to match the new 5x terminal magnitude.
            # A timeout is strictly worse than a loss (you didn't even finish),
            # so it should hurt more than the -25 loss penalty.
            if not done and last_agent_idx >= 0:
                all_rewards[last_agent_idx] += -40.0

            # Log the actual game score (not the reward signal) for readable tracking
            game_rewards.append(-prev_score)  # negative final score in original scale
            game_wins.append(agent_won)

            # Mark the very last agent step as done if the loop exited via
            # max_steps (done flag may still be False in that case)
            if last_agent_idx >= 0:
                all_dones[last_agent_idx] = 1.0

    net.train()

    return {
        "states":       torch.stack(all_states),
        "actions":      torch.tensor(all_actions, dtype=torch.long),
        "log_probs":    torch.tensor(all_log_probs, dtype=torch.float32),
        "values":       torch.tensor(all_values, dtype=torch.float32),
        "rewards":      torch.tensor(all_rewards, dtype=torch.float32),
        "masks":        torch.stack(all_masks),
        "is_buy":       torch.tensor(all_is_buy, dtype=torch.bool),
        "dones":        torch.tensor(all_dones, dtype=torch.float32),
        "game_rewards": game_rewards,
        "game_wins": game_wins,
    }


# ── GAE computation ────────────────────────────────────────────────────────────

def compute_gae(
    rewards: torch.Tensor,
    values: torch.Tensor,
    dones: torch.Tensor,
    gamma: float = 0.99,
    lam: float = 0.95,
) -> tuple[torch.Tensor, torch.Tensor]:
    """
    Generalized Advantage Estimation.

    Walks backwards through the flattened multi-episode trajectory.
    Episode boundaries are detected via the `dones` tensor (1.0 = last step).

    Returns:
        advantages : (N,) float tensor — GAE advantages
        returns    : (N,) float tensor — advantages + values (TD-lambda targets)
    """
    n = len(rewards)
    advantages = torch.zeros(n)
    gae = 0.0

    for t in reversed(range(n)):
        # next_value is 0 at episode boundaries (done == 1)
        next_value = 0.0 if dones[t] == 1.0 else values[t + 1].item() if t + 1 < n else 0.0
        delta = rewards[t].item() + gamma * next_value - values[t].item()
        # Reset GAE accumulator at episode boundaries
        gae = delta + gamma * lam * gae * (1.0 - dones[t].item())
        advantages[t] = gae

    returns = advantages + values
    return advantages, returns


# ── PPO update ────────────────────────────────────────────────────────────────

def ppo_update(
    net: ShanghaiNetV2,
    optimizer: torch.optim.Optimizer,
    batch: dict,
    epochs: int = 4,
    clip_eps: float = 0.2,
    entropy_coef: float = 0.05,
) -> tuple[float, float]:
    """
    PPO clipped surrogate objective update.

    Runs `epochs` gradient steps over the entire batch.

    Returns:
        mean_loss    : average total loss across all epochs
        mean_entropy : average gameplay entropy across all epochs
    """
    states      = batch["states"]        # (N, RICH_STATE_SIZE)
    actions     = batch["actions"]       # (N,)
    old_log_probs = batch["log_probs"]   # (N,)
    masks       = batch["masks"]         # (N, MAX_ACTIONS)
    is_buy      = batch["is_buy"]        # (N,) bool
    advantages  = batch["advantages"]    # (N,)
    returns     = batch["returns"]       # (N,)

    # Normalize advantages batch-wide
    adv = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
    adv = adv.clamp(-5.0, 5.0)

    total_loss = 0.0
    total_entropy = 0.0

    for _ in range(epochs):
        policy_logits, values = net(states)  # (N, MAX_ACTIONS), (N, 1)
        values = values.squeeze(1)           # (N,)

        # Compute new log-probs under current policy
        masked_logits = policy_logits + (masks - 1.0) * 1e9
        log_probs_all = F.log_softmax(masked_logits, dim=-1)  # (N, MAX_ACTIONS)
        new_log_probs = log_probs_all[torch.arange(len(actions)), actions]  # (N,)

        # Importance sampling ratio
        ratio = torch.exp(new_log_probs - old_log_probs)  # (N,)

        # Clipped surrogate policy loss
        surr1 = ratio * adv
        surr2 = torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps) * adv
        policy_loss = -torch.min(surr1, surr2).mean()

        # Value loss (MSE against GAE returns)
        value_loss = F.mse_loss(values, returns)

        # Entropy bonus — all steps (buy/decline now unified in action space)
        entropy = net.get_entropy(policy_logits, masks)

        # Combined loss
        loss = policy_loss + 0.5 * value_loss - entropy_coef * entropy

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
        optimizer.step()

        total_loss += loss.item()
        total_entropy += entropy.item()

    return total_loss / epochs, total_entropy / epochs


# ── Main training loop ────────────────────────────────────────────────────────

def train(args):
    from log_utils import setup_logging
    setup_logging("ppo")

    print("Shanghai PPO Training")
    print(f"  Total games   : {args.games}")
    print(f"  Batch size    : {args.batch_size} games/update")
    print(f"  PPO epochs    : {args.ppo_epochs}")
    print(f"  Learning rate : {args.lr}")
    print(f"  Clip eps      : {args.clip_eps}")
    print(f"  Entropy coef  : {args.entropy_coef}")
    print(f"  Temperature   : {args.temperature}")
    print(f"  Players       : {args.players}")
    print(f"  Opponent AI   : {args.opponent_ai or 'random'}")
    print()

    # Curriculum learning: auto-promote through difficulty tiers
    curriculum = None
    if args.curriculum:
        from curriculum import CurriculumManager
        curriculum = CurriculumManager()
        tier = curriculum.current
        print(f"  Curriculum    : ON - starting at tier 0: {tier['label']}")
        env = ShanghaiEnv(
            player_count=tier['players'],
            opponent_ai=tier['opponent'],
            rich_state=True,
        )
    else:
        env = ShanghaiEnv(
            player_count=args.players,
            opponent_ai=args.opponent_ai,
            rich_state=True,
        )

    net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)
    optimizer = optim.Adam(net.parameters(), lr=args.lr)

    model_path = MODELS_DIR / "shanghai_ppo.pt"
    best_path  = MODELS_DIR / "shanghai_ppo_best.pt"

    if not args.fresh and model_path.exists():
        print(f"Loading existing model from {model_path}")
        net.load_state_dict(torch.load(model_path, weights_only=True))

    all_game_rewards: list[float] = []
    best_avg_reward = float("-inf")
    games_completed = 0
    batch_num = 0

    total_batches = (args.games + args.batch_size - 1) // args.batch_size

    while games_completed < args.games:
        # Clamp the last batch so we don't overshoot --games
        this_batch_size = min(args.batch_size, args.games - games_completed)
        batch_num += 1
        t0 = time.time()

        # ── Collect experience ──────────────────────────────────────────────
        current_players = curriculum.current['players'] if curriculum else args.players
        batch = collect_batch(env, net, this_batch_size, temperature=args.temperature, player_count=current_players)
        game_rewards = batch.pop("game_rewards")
        game_wins = batch.pop("game_wins")
        all_game_rewards.extend(game_rewards)
        games_completed += this_batch_size

        if batch["states"].shape[0] == 0:
            print(f"Batch {batch_num}: no agent steps collected - skipping update")
            continue

        # ── Compute GAE ─────────────────────────────────────────────────────
        advantages, returns = compute_gae(
            batch["rewards"],
            batch["values"],
            batch["dones"],
            gamma=0.99,
            lam=0.95,
        )
        batch["advantages"] = advantages
        batch["returns"]    = returns

        # ── PPO update ───────────────────────────────────────────────────────
        mean_loss, mean_entropy = ppo_update(
            net,
            optimizer,
            batch,
            epochs=args.ppo_epochs,
            clip_eps=args.clip_eps,
            entropy_coef=args.entropy_coef,
        )

        elapsed = time.time() - t0
        batch_avg = sum(game_rewards) / len(game_rewards)
        batch_wins = sum(game_wins)
        # Avg score is the negative of game_rewards (game_rewards = -score)
        batch_score = -batch_avg
        rolling = all_game_rewards[-100:]
        rolling_avg = sum(rolling) / len(rolling)
        rolling_score = -rolling_avg

        print(
            f"Batch {batch_num:4d}/{total_batches} | "
            f"Games: {games_completed:5d} | "
            f"Score: {batch_score:5.0f} ({rolling_score:5.0f}) | "
            f"Wins: {batch_wins}/{this_batch_size} | "
            f"Loss: {mean_loss:9.4f} | "
            f"Entropy: {mean_entropy:.3f} | "
            f"Steps: {batch['states'].shape[0]:5d} | "
            f"Time: {elapsed:.1f}s"
        )

        # ── Health monitoring — detect and recover from exploits ──────────────
        total_steps = batch['states'].shape[0]
        avg_steps_per_game = total_steps / this_batch_size

        player_scale = max(1, current_players // 2)
        stall_threshold = 2000 * player_scale
        zero_reward_threshold = 1500 * player_scale

        if not hasattr(train, '_health'):
            train._health = {'stall_count': 0, 'zero_reward_count': 0, 'lr_reductions': 0}

        if avg_steps_per_game > stall_threshold:
            train._health['stall_count'] += 1
        else:
            train._health['stall_count'] = max(0, train._health['stall_count'] - 1)

        if abs(batch_avg) < 1.0 and avg_steps_per_game > zero_reward_threshold:
            train._health['zero_reward_count'] += 1
        else:
            train._health['zero_reward_count'] = max(0, train._health['zero_reward_count'] - 1)

        # Recovery ladder: reduce LR twice before giving up
        stall_limit = 5
        if train._health['stall_count'] >= stall_limit or train._health['zero_reward_count'] >= stall_limit:
            train._health['lr_reductions'] += 1
            if train._health['lr_reductions'] <= 2:
                # Reduce LR by 50% and retry
                for pg in optimizer.param_groups:
                    pg['lr'] *= 0.5
                new_lr = optimizer.param_groups[0]['lr']
                print(f"  [!] Health recovery #{train._health['lr_reductions']}: LR reduced to {new_lr:.6f}")
                train._health['stall_count'] = 0
                train._health['zero_reward_count'] = 0
            else:
                # 3rd strike — save and stop
                print(f"\n{'!'*60}")
                print(f"  HEALTH WARNING: Training stuck after 2 LR reductions")
                print(f"  Avg steps/game: {avg_steps_per_game:.0f}, Batch avg: {batch_avg:.1f}")
                print(f"  Saving checkpoint and stopping.")
                print(f"{'!'*60}\n")
                torch.save(net.state_dict(), model_path)
                torch.save(net.state_dict(), MODELS_DIR / "shanghai_ppo_stopped.pt")
                break

        # Entropy floor: boost entropy coefficient if policy is collapsing
        if not hasattr(train, '_entropy_boost_batches'):
            train._entropy_boost_batches = 0
        if mean_entropy < 0.3 and train._entropy_boost_batches == 0:
            train._entropy_boost_batches = 50
            print(f"  [!] Entropy floor triggered: boosting entropy coef to 0.15 for 50 batches")
        if train._entropy_boost_batches > 0:
            entropy_coef = 0.15
            train._entropy_boost_batches -= 1
            if train._entropy_boost_batches == 0:
                entropy_coef = args.entropy_coef
                print(f"  Entropy boost ended, restored to {entropy_coef}")

        # ── LR warmup after tier promotion ──────────────────────────────────
        if hasattr(train, '_warmup_batches_left') and train._warmup_batches_left > 0:
            train._warmup_batches_left -= 1
            warmup_total = 20  # ramp over 20 batches
            progress = 1.0 - train._warmup_batches_left / warmup_total
            warmup_lr = args.lr * (0.1 + 0.9 * progress)  # 10% -> 100%
            for pg in optimizer.param_groups:
                pg['lr'] = warmup_lr
            if train._warmup_batches_left == 0:
                for pg in optimizer.param_groups:
                    pg['lr'] = args.lr
                print(f"  LR warmup complete - restored to {args.lr}")

        # ── Curriculum promotion/demotion check ───────────────────────────────
        if curriculum:
            for r, won in zip(game_rewards, game_wins):
                curriculum.record(r, won=won)
            if batch_num % 10 == 0:
                print(f"  [Curriculum] Tier {curriculum._tier_index}: {curriculum.current['label']} | "
                      f"WinRate: {curriculum.win_rate:.1%} ({curriculum._wins}/{curriculum._games})")

            if curriculum.should_demote():
                curriculum.demote()
                tier = curriculum.current
                env.close()
                env = ShanghaiEnv(
                    player_count=tier['players'],
                    opponent_ai=tier['opponent'] if tier['opponent'] != 'mixed-hard' else 'the-shark',
                    rich_state=True,
                )
                train._health = {'stall_count': 0, 'zero_reward_count': 0, 'lr_reductions': 0}
            elif curriculum.should_promote():
                curriculum.promote()
                tier = curriculum.current
                env.close()
                env = ShanghaiEnv(
                    player_count=tier['players'],
                    opponent_ai=tier['opponent'] if tier['opponent'] != 'mixed-hard' else 'the-shark',
                    rich_state=True,
                )
                train._warmup_batches_left = 20
                warmup_lr = args.lr * 0.1
                for pg in optimizer.param_groups:
                    pg['lr'] = warmup_lr
                print(f"  LR warmup started: {warmup_lr:.6f} -> {args.lr} over 20 batches")
                train._health = {'stall_count': 0, 'zero_reward_count': 0, 'lr_reductions': 0}

        # ── Checkpointing ────────────────────────────────────────────────────
        if batch_num % 10 == 0 or games_completed >= args.games:
            torch.save(net.state_dict(), model_path)
            if rolling_avg > best_avg_reward:
                best_avg_reward = rolling_avg
                torch.save(net.state_dict(), best_path)
                print(f"  => New best model saved! Avg(100): {rolling_avg:.1f}")
            else:
                print(f"  => Checkpoint saved (best so far: {best_avg_reward:.1f})")

    # Final save
    torch.save(net.state_dict(), model_path)
    print(f"\nTraining complete. Model saved to {model_path}")
    print(f"Best rolling avg reward: {best_avg_reward:.1f}")

    env.close()


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Shanghai Rummy AI via PPO self-play")
    parser.add_argument("--games",        type=int,   default=5000,       help="Total games to play")
    parser.add_argument("--batch-size",   type=int,   default=10,         help="Games per PPO update")
    parser.add_argument("--ppo-epochs",   type=int,   default=4,          help="Gradient steps per batch")
    parser.add_argument("--lr",           type=float, default=0.0003,     help="Adam learning rate")
    parser.add_argument("--entropy-coef", type=float, default=0.1,        help="Entropy bonus coefficient (raised from 0.05 to combat discard-slot-0 collapse)")
    parser.add_argument("--clip-eps",     type=float, default=0.2,        help="PPO clip epsilon")
    parser.add_argument("--temperature",  type=float, default=0.7,        help="Action sampling temperature (0.7 = sharper than uniform; 1.0 was too noisy — argmax win rate diverged from sampled by ~17pp)")
    parser.add_argument("--players",      type=int,   default=4,          help="Number of players (2-8)")
    parser.add_argument("--opponent-ai",  type=str,   default=None,
                        help="AI personality for opponents (e.g. the-shark). Default: random")
    parser.add_argument("--fresh",        action="store_true",
                        help="Start from scratch (ignore existing checkpoint)")
    parser.add_argument("--curriculum",   action="store_true",
                        help="Use curriculum learning (auto-promote through difficulty tiers)")
    args = parser.parse_args()
    train(args)
