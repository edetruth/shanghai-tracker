"""
Value head pretraining for Shanghai Rummy.

The core PPO fine-tune failure mode: the imitation model has a randomly-initialized
value head. During PPO, bad value estimates produce corrupted advantage signals that
destroy the imitation policy before the critic can learn anything useful.

Fix: pretrain the value head separately using Monte Carlo returns from the frozen
imitation policy. This gives PPO a stable starting critic so policy gradients are
meaningful from the first batch.

Strategy:
  1. Load the imitation checkpoint (policy + trunk are good; value head is random).
  2. Freeze trunk and policy head entirely — zero grad, no optimizer params.
  3. Play N games under the frozen greedy policy, recording (state, reward) tuples
     for every player-0 decision step, using the same reward function as ppo.py.
  4. Compute discounted MC returns backwards through each episode.
  5. Train ONLY the value head with MSE loss.
  6. Report Pearson correlation (predicted value vs MC return) per epoch — this
     should climb from ~0 toward 0.4–0.6+ if pretraining is working.
  7. Save the full model (frozen trunk/policy + trained value head) as the output
     checkpoint, ready to drop into ppo.py --fresh-value.

Usage:
    python value_pretrain.py
    python value_pretrain.py --games 1000 --epochs 30 --model shanghai_imitation_best.pt
    python value_pretrain.py --games 500 --out shanghai_value_pretrained.pt
"""

import argparse
import random
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F

from shanghai_env import ShanghaiEnv
from network_v2 import ShanghaiNetV2
from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX
from log_utils import setup_logging

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

GAMMA = 0.99  # Must match ppo.py


# ── Action helpers (shared with ppo.py / evaluate.py) ─────────────────────────

def encode_action(action: str) -> int:
    if action == "draw_pile":
        return 0
    if action == "take_discard":
        return 1
    if action.startswith("discard:"):
        idx = int(action.split(":")[1])
        return 2 + min(idx, 21)
    if action == "buy":
        return BUY_ACTION_IDX
    if action == "decline_buy":
        return DECLINE_BUY_ACTION_IDX
    return 0


def get_action_mask(valid_actions: list) -> torch.Tensor:
    mask = torch.zeros(MAX_ACTIONS)
    for a in valid_actions:
        idx = encode_action(a)
        if 0 <= idx < MAX_ACTIONS:
            mask[idx] = 1.0
    return mask


def decode_action(index: int, valid_actions: list) -> str:
    action_to_idx = {a: encode_action(a) for a in valid_actions}
    idx_to_action = {v: k for k, v in action_to_idx.items()}
    return idx_to_action.get(index, valid_actions[0] if valid_actions else "draw_pile")


# ── Rollout collection ─────────────────────────────────────────────────────────

def collect_rollouts(
    env: ShanghaiEnv,
    net: ShanghaiNetV2,
    n_games: int,
    log_interval: int = 100,
) -> tuple[torch.Tensor, torch.Tensor]:
    """
    Play n_games under the frozen greedy policy and compute MC returns.

    Uses the identical reward function as ppo.py so the value head trains
    on targets that are in the same scale PPO will later use.

    Returns:
        states  : (N, RICH_STATE_SIZE) — all player-0 decision states
        returns : (N,)                 — discounted MC return from each state
    """
    all_states: list[torch.Tensor] = []
    all_returns: list[float] = []

    wins = 0
    total_score = 0.0
    t0 = time.time()

    net.eval()
    with torch.no_grad():
        for game_idx in range(n_games):
            state_list = env.reset()
            done = False
            step_count = 0
            max_steps = 4000

            prev_score = 0.0

            # Per-episode buffers
            ep_states: list[torch.Tensor] = []
            ep_rewards: list[float] = []
            last_agent_idx = -1

            while not done and step_count < max_steps:
                valid_actions, current_player, auto_state = env.get_strategic_actions()
                if not valid_actions:
                    break

                if auto_state is not None:
                    state_list = auto_state

                if current_player == 0:
                    state_t = torch.tensor(state_list, dtype=torch.float32)
                    policy_logits, _ = net(state_t.unsqueeze(0))

                    mask = get_action_mask(valid_actions)
                    masked_logits = policy_logits[0] + (mask - 1.0) * 1e9
                    action_idx = masked_logits.argmax().item()
                    action_str = decode_action(action_idx, valid_actions)

                    ep_states.append(state_t)
                    ep_rewards.append(-0.001)  # time penalty
                    last_agent_idx = len(ep_states) - 1

                    state_list, _, done, info = env.step(action_str)

                    # Round-end score change (primary signal)
                    if info.get("scores"):
                        current_score = float(info["scores"][0])
                        delta = current_score - prev_score
                        if delta != 0:
                            ep_rewards[-1] += -delta / 50.0
                            prev_score = current_score

                    if done and info.get("scores"):
                        scores = [float(s) for s in info["scores"]]
                        agent_score = scores[0]
                        best_score = min(scores)
                        if agent_score == best_score:
                            ep_rewards[-1] += 50.0
                            wins += 1
                        else:
                            ep_rewards[-1] -= 25.0
                        ep_rewards[-1] += -(agent_score - best_score) / 20.0
                        total_score += agent_score

                else:
                    # Opponent turn
                    action_str = random.choice(valid_actions)
                    state_list, _, done, info = env.step(action_str)

                    # Attribute round-end score change to agent's last step
                    if info.get("scores") and last_agent_idx >= 0:
                        current_score = float(info["scores"][0])
                        delta = current_score - prev_score
                        if delta != 0:
                            ep_rewards[last_agent_idx] += -delta / 50.0
                            prev_score = current_score

                    if done and last_agent_idx >= 0 and info.get("scores"):
                        scores = [float(s) for s in info["scores"]]
                        agent_score = scores[0]
                        best_score = min(scores)
                        if agent_score == best_score:
                            ep_rewards[last_agent_idx] += 50.0
                            wins += 1
                        else:
                            ep_rewards[last_agent_idx] -= 25.0
                        ep_rewards[last_agent_idx] += -(agent_score - best_score) / 20.0
                        total_score += agent_score

                step_count += 1

            # Timeout penalty
            if not done and last_agent_idx >= 0:
                ep_rewards[last_agent_idx] += -40.0

            # ── Compute discounted MC returns backwards ─────────────────────
            n_steps = len(ep_rewards)
            ep_mc = [0.0] * n_steps
            running = 0.0
            for t in reversed(range(n_steps)):
                running = ep_rewards[t] + GAMMA * running
                ep_mc[t] = running

            all_states.extend(ep_states)
            all_returns.extend(ep_mc)

            if (game_idx + 1) % log_interval == 0 or (game_idx + 1) == n_games:
                elapsed = time.time() - t0
                wr = wins / (game_idx + 1) * 100
                avg_sc = total_score / max(1, game_idx + 1)
                print(
                    f"  Collected {game_idx + 1:5d}/{n_games} games | "
                    f"Win rate: {wr:5.1f}% | Avg score: {avg_sc:7.1f} | "
                    f"Steps so far: {len(all_states):,} | {elapsed:.1f}s"
                )

    states_t = torch.stack(all_states)           # (N, RICH_STATE_SIZE)
    returns_t = torch.tensor(all_returns, dtype=torch.float32)  # (N,)
    return states_t, returns_t


# ── Value head training ────────────────────────────────────────────────────────

def pearson_r(x: torch.Tensor, y: torch.Tensor) -> float:
    """Pearson correlation between two 1D tensors."""
    xm = x - x.mean()
    ym = y - y.mean()
    num = (xm * ym).sum()
    denom = (xm.pow(2).sum() * ym.pow(2).sum()).sqrt() + 1e-8
    return (num / denom).item()


def pretrain_value_head(
    net: ShanghaiNetV2,
    states: torch.Tensor,
    returns: torch.Tensor,
    epochs: int,
    batch_size: int,
    lr: float,
) -> None:
    """
    Train only the value head parameters against MC returns.

    Trunk and policy head are frozen — their parameters receive no gradients
    and are not in the optimizer. This preserves the imitation policy exactly.
    """
    # Only optimize value_head parameters
    optimizer = optim.Adam(net.value_head.parameters(), lr=lr)

    n = len(states)
    print(f"\nValue head pretraining:")
    print(f"  Samples : {n:,}")
    print(f"  Epochs  : {epochs}")
    print(f"  Batch   : {batch_size}")
    print(f"  LR      : {lr}")
    print(f"  Return range: [{returns.min():.1f}, {returns.max():.1f}]  mean={returns.mean():.2f}")
    print()

    net.train()

    for epoch in range(1, epochs + 1):
        perm = torch.randperm(n)
        epoch_loss = 0.0
        n_batches = 0

        for start in range(0, n, batch_size):
            idx = perm[start:start + batch_size]
            s_batch = states[idx]
            r_batch = returns[idx]

            # Trunk is frozen: compute its output with no_grad, then pass the
            # detached features to value_head. This avoids a backward pass
            # through the trunk entirely — only value_head params get gradients.
            with torch.no_grad():
                trunk_out = net.trunk(s_batch)
            value = net.value_head(trunk_out).squeeze(1)

            loss = F.mse_loss(value, r_batch)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.value_head.parameters(), 1.0)
            optimizer.step()

            epoch_loss += loss.item()
            n_batches += 1

        # Correlation on a sample of 4096 points (avoid OOM on large datasets)
        with torch.no_grad():
            sample_n = min(n, 4096)
            idx_s = torch.randperm(n)[:sample_n]
            _, v_sample = net(states[idx_s])
            corr = pearson_r(v_sample.squeeze(1), returns[idx_s])

        avg_loss = epoch_loss / max(1, n_batches)
        print(f"  Epoch {epoch:3d}/{epochs} | Loss: {avg_loss:8.4f} | Pearson r(value, return): {corr:+.4f}")

    print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main(args):
    setup_logging("value_pretrain")

    print("Shanghai Rummy — Value Head Pretraining")
    print(f"  Source model : {args.model}")
    print(f"  Output model : {args.out}")
    print(f"  Rollout games: {args.games}")
    print(f"  Train epochs : {args.epochs}")
    print(f"  Batch size   : {args.batch_size}")
    print(f"  Value LR     : {args.lr}")
    print()

    model_path = MODELS_DIR / args.model
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    # ── Load model ────────────────────────────────────────────────────────────
    net = ShanghaiNetV2(state_size=RICH_STATE_SIZE)
    net.load_state_dict(torch.load(model_path, weights_only=True))
    print(f"Loaded checkpoint: {model_path}")

    # ── Freeze trunk + policy head ────────────────────────────────────────────
    for param in net.trunk.parameters():
        param.requires_grad = False
    for param in net.policy_head.parameters():
        param.requires_grad = False
    print("Frozen: trunk, policy_head")
    print("Trainable: value_head only")
    print()

    # ── Collect rollouts ──────────────────────────────────────────────────────
    # 2P random matches the tier-0 PPO environment for comparable value targets.
    env = ShanghaiEnv(player_count=2, opponent_ai=None, rich_state=True)

    print(f"Collecting {args.games} rollout games (2P random, greedy policy)...")
    states, returns = collect_rollouts(env, net, n_games=args.games, log_interval=100)
    env.close()

    print(f"\nDataset: {len(states):,} player-0 decision steps collected")
    print(f"  Return stats: min={returns.min():.2f}  max={returns.max():.2f}  "
          f"mean={returns.mean():.2f}  std={returns.std():.2f}")

    # Baseline correlation before any training
    net.eval()
    with torch.no_grad():
        sample_n = min(len(states), 4096)
        idx_s = torch.randperm(len(states))[:sample_n]
        _, v_before = net(states[idx_s])
        corr_before = pearson_r(v_before.squeeze(1), returns[idx_s])
    print(f"  Pearson r before training: {corr_before:+.4f}  (random init baseline, expect ~0)")

    # ── Pretrain value head ───────────────────────────────────────────────────
    pretrain_value_head(
        net,
        states,
        returns,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
    )

    # ── Correlation check after training ─────────────────────────────────────
    net.eval()
    with torch.no_grad():
        idx_s = torch.randperm(len(states))[:sample_n]
        _, v_after = net(states[idx_s])
        corr_after = pearson_r(v_after.squeeze(1), returns[idx_s])
    print(f"Pearson r after training : {corr_after:+.4f}  (target: > 0.30 before PPO fine-tune)")

    if corr_after < 0.15:
        print("  WARNING: correlation is low. The trunk representations may not encode")
        print("  enough outcome information. Consider --games 2000 or trunk fine-tuning.")
    elif corr_after < 0.30:
        print("  OK: moderate correlation. PPO should be more stable than from random init.")
    else:
        print("  GOOD: strong correlation. Value head is a useful critic for PPO.")

    # ── Unfreeze all parameters before saving ─────────────────────────────────
    # ppo.py trains the whole network — unfreeze so saved weights are all trainable
    for param in net.trunk.parameters():
        param.requires_grad = True
    for param in net.policy_head.parameters():
        param.requires_grad = True

    # ── Save checkpoint ───────────────────────────────────────────────────────
    out_path = MODELS_DIR / args.out
    torch.save(net.state_dict(), out_path)
    print(f"\nSaved: {out_path}")
    print("Ready for PPO fine-tune:")
    print(f"  copy ml\\models\\{args.out} ml\\models\\shanghai_ppo.pt")
    print(f"  python ppo.py --games 5000 --batch-size 32 --curriculum")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Pretrain value head of ShanghaiNetV2 from MC rollouts."
    )
    parser.add_argument(
        "--model",
        type=str,
        default="shanghai_imitation_best.pt",
        help="Source checkpoint in ml/models/ (default: shanghai_imitation_best.pt)",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="shanghai_value_pretrained.pt",
        help="Output checkpoint name in ml/models/ (default: shanghai_value_pretrained.pt)",
    )
    parser.add_argument(
        "--games",
        type=int,
        default=500,
        help="Games to play for MC return collection (default: 500)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=20,
        help="Training epochs over the collected dataset (default: 20)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=512,
        help="Minibatch size for value head training (default: 512)",
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=1e-3,
        help="Learning rate for value head optimizer (default: 1e-3)",
    )
    args = parser.parse_args()
    main(args)
