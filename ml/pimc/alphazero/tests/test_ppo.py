import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import numpy as np
import torch
from alphazero.network import ShanghaiNet
from alphazero.agent import ShanghaiNetAgent


def _make_agent(temperature=1.0):
    model = ShanghaiNet()
    model.eval()
    return ShanghaiNetAgent(model, player_idx=0, n_players=4,
                            temperature=temperature, record=True)


def test_log_prob_old_present_in_every_step():
    """Every recorded trajectory step must contain a finite log_prob_old."""
    from alphazero.self_play import collect_games
    model = ShanghaiNet()
    trajectories = collect_games(model, n_games=2, opponent_pool=[model],
                                 temperature=1.0, seed=0)
    for traj in trajectories:
        for step in traj["steps"]:
            assert "log_prob_old" in step, "missing log_prob_old"
            lp = step["log_prob_old"]
            assert isinstance(lp, float), f"expected float, got {type(lp)}"
            assert np.isfinite(lp), f"log_prob_old is not finite: {lp}"
            assert lp <= 0.0, f"log_prob_old must be <= 0, got {lp}"


def test_log_prob_old_matches_temperature_one():
    """log_prob_old must be computed at temperature=1, not collection temp."""
    import torch.nn.functional as F
    from alphazero.agent import ShanghaiNetAgent, _ctype
    from engine import JOKER_INT

    model = ShanghaiNet()
    model.eval()
    agent = ShanghaiNetAgent(model, player_idx=0, n_players=4,
                             temperature=5.0, record=True)

    hand = [0x11, 0x21]  # rank 1 suit 1, rank 1 suit 2 — two distinct ctypes

    # Build expected_lps using the same state vector the agent will use
    agent._maybe_new_round(0)
    sv = agent._state_vec(hand, -1, round_idx=0, has_laid_down=False)
    with torch.no_grad():
        out = model(torch.from_numpy(sv).unsqueeze(0))
        logits = out["discard_logits"].squeeze(0)
        hand_types = sorted(list({_ctype(c) for c in hand}))
        neg_inf = torch.full_like(logits, float("-inf"))
        for idx in hand_types:
            neg_inf[idx] = logits[idx]
        # expected log_prob for each valid action at temperature=1
        lp_all = F.log_softmax(neg_inf, dim=-1)
        expected_lps = {idx: float(lp_all[idx].item()) for idx in hand_types}

    agent.discard(player_idx=0, hand=hand, has_laid_down=False,
                  table_melds=[], round_idx=0)
    assert len(agent.trajectory) == 1, "discard step was not recorded"
    step = agent.trajectory[-1]
    chosen_type = step["action_taken"]
    assert chosen_type in expected_lps, f"chosen type {chosen_type} not in hand"
    assert abs(step["log_prob_old"] - expected_lps[chosen_type]) < 1e-5


def test_terminal_step_marked():
    """Last step of each trajectory must have is_terminal=True; others False."""
    from alphazero.self_play import collect_games
    model = ShanghaiNet()
    trajectories = collect_games(model, n_games=3, opponent_pool=[model],
                                 temperature=1.0, seed=1)
    for traj in trajectories:
        steps = traj["steps"]
        if not steps:
            continue
        for i, step in enumerate(steps):
            assert "is_terminal" in step
            if i < len(steps) - 1:
                assert step["is_terminal"] is False
            else:
                assert step["is_terminal"] is True


def test_compute_gae_terminal_only_reward():
    """
    For a 3-step episode with terminal reward R:
      delta_2 = R - V(s_2)          (terminal step, V_next=0)
      delta_1 = gamma*V(s_2) - V(s_1)
      delta_0 = gamma*V(s_1) - V(s_0)
      A_2 = delta_2
      A_1 = delta_1 + gamma*lam*A_2
      A_0 = delta_0 + gamma*lam*A_1
      value_target_t = A_t + V(s_t)
    """
    from alphazero.ppo import compute_gae

    gamma, lam = 0.99, 0.95
    R = -200.0  # terminal return (negative score)

    model = ShanghaiNet()
    model.eval()

    # Override value head to return known values [10, 20, 30]
    v_vals = [10.0, 20.0, 30.0]
    _orig_forward = model.forward
    call_count = [0]
    def _mock_forward(x):
        out = _orig_forward(x)
        n = x.shape[0]
        out["value"] = torch.tensor(
            [v_vals[call_count[0] + i] for i in range(n)],
            dtype=torch.float32
        ).unsqueeze(1)
        call_count[0] += n
        return out
    model.forward = _mock_forward

    steps = [
        {"state_vec": np.zeros(170, dtype=np.float32),
         "is_terminal": False, "log_prob_old": -1.0,
         "action_type": 0, "action_taken": 0, "hand": [],
         "round_idx": 0, "has_laid_down": False, "opp_sizes": []},
        {"state_vec": np.zeros(170, dtype=np.float32),
         "is_terminal": False, "log_prob_old": -1.0,
         "action_type": 0, "action_taken": 0, "hand": [],
         "round_idx": 0, "has_laid_down": False, "opp_sizes": []},
        {"state_vec": np.zeros(170, dtype=np.float32),
         "is_terminal": True,  "log_prob_old": -1.0,
         "action_type": 0, "action_taken": 0, "hand": [],
         "round_idx": 0, "has_laid_down": False, "opp_sizes": []},
    ]
    traj = {"steps": steps, "final_score": 200.0}  # R = -200

    compute_gae([traj], model, gamma=gamma, lam=lam)

    v0, v1, v2 = 10.0, 20.0, 30.0
    delta2 = R + 0.0 - v2             # terminal: r=R, v_next=0
    delta1 = 0.0 + gamma * v2 - v1   # non-terminal: r=0
    delta0 = 0.0 + gamma * v1 - v0

    A2 = delta2
    A1 = delta1 + gamma * lam * A2
    A0 = delta0 + gamma * lam * A1

    assert abs(steps[2]["advantage"]    - A2)      < 1e-4
    assert abs(steps[1]["advantage"]    - A1)      < 1e-4
    assert abs(steps[0]["advantage"]    - A0)      < 1e-4
    assert abs(steps[2]["value_target"] - (A2+v2)) < 1e-4
    assert abs(steps[1]["value_target"] - (A1+v1)) < 1e-4
    assert abs(steps[0]["value_target"] - (A0+v0)) < 1e-4


def test_build_ppo_batch_shapes():
    """build_ppo_batch produces correctly shaped tensors."""
    from alphazero.self_play import collect_games
    from alphazero.ppo import compute_gae, build_ppo_batch

    model = ShanghaiNet()
    trajectories = collect_games(model, n_games=4, opponent_pool=[model],
                                 temperature=1.0, seed=2)
    compute_gae(trajectories, model)

    all_steps = [s for t in trajectories for s in t["steps"]]
    N = len(all_steps)
    assert N > 0

    batch = build_ppo_batch(all_steps)

    assert batch["state_vecs"].shape    == (N, 170)
    assert batch["action_types"].shape  == (N,)
    assert batch["action_takens"].shape == (N,)
    assert batch["log_probs_old"].shape == (N,)
    assert batch["advantages"].shape    == (N,)
    assert batch["value_targets"].shape == (N,)
    # discard_masks: (N_discard, 53) bool tensor
    n_discard = int((batch["action_types"] == 0).sum().item())
    assert batch["discard_masks"].shape == (n_discard, 53)
    # All log_probs_old must be finite and <= 0
    assert torch.isfinite(batch["log_probs_old"]).all()
    assert (batch["log_probs_old"] <= 0).all()


def test_ppo_loss_ratio_clipping():
    """
    PPO loss must return a dict with all expected keys and valid properties.
    """
    from alphazero.self_play import collect_games
    from alphazero.ppo import compute_gae, build_ppo_batch, compute_ppo_losses

    model = ShanghaiNet()
    trajectories = collect_games(model, n_games=8, opponent_pool=[model],
                                 temperature=1.0, seed=3)
    compute_gae(trajectories, model)
    all_steps = [s for t in trajectories for s in t["steps"]]
    batch = build_ppo_batch(all_steps)

    adv = batch["advantages"]
    adv_norm = (adv - adv.mean()) / (adv.std() + 1e-8)

    model.train()
    losses = compute_ppo_losses(model, batch, adv_norm, clip_eps=0.2,
                                entropy_coef=0.05, value_coef=0.5)

    assert "policy_loss" in losses
    assert "value_loss"  in losses
    assert "entropy"     in losses
    assert "total_loss"  in losses
    # Total loss must be a scalar with gradient
    assert losses["total_loss"].ndim == 0
    assert losses["total_loss"].requires_grad
    # Entropy must be positive
    assert losses["entropy"].item() > 0


def test_ppo_policy_loss_has_model_gradients():
    """policy_loss must produce non-zero gradients through model parameters."""
    import torch.optim as optim
    from alphazero.self_play import collect_games
    from alphazero.ppo import compute_gae, build_ppo_batch, compute_ppo_losses

    model = ShanghaiNet()
    trajectories = collect_games(model, n_games=4, opponent_pool=[model],
                                 temperature=1.0, seed=4)
    compute_gae(trajectories, model)
    all_steps = [s for t in trajectories for s in t["steps"]]
    batch = build_ppo_batch(all_steps)

    adv = batch["advantages"]
    adv_norm = (adv - adv.mean()) / (adv.std() + 1e-8)

    model.train()
    model.zero_grad()
    losses = compute_ppo_losses(model, batch, adv_norm)
    losses["policy_loss"].backward()

    # At least one parameter must have a non-zero gradient from policy_loss alone
    has_nonzero_grad = any(
        p.grad is not None and p.grad.abs().max().item() > 0
        for p in model.parameters()
    )
    assert has_nonzero_grad, "policy_loss produced no gradient through model parameters"


def test_ppo_iteration_returns_valid_stats():
    """ppo_iteration must return a dict with all expected keys and finite values."""
    import torch.optim as optim
    from alphazero.ppo import ppo_iteration

    model = ShanghaiNet()
    optimizer = optim.Adam(model.parameters(), lr=1e-4)

    stats = ppo_iteration(
        model=model,
        optimizer=optimizer,
        opponent_pool=[model],
        n_games=4,
        n_epochs=2,
        temperature=1.0,
        seed=42,
    )

    for key in ["policy_loss", "value_loss", "entropy", "total_loss",
                "avg_score", "n_steps", "approx_kl", "clip_fraction"]:
        assert key in stats, f"missing key: {key}"
        assert np.isfinite(stats[key]), f"{key} is not finite: {stats[key]}"
