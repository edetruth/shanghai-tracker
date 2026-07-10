"""
Quick diagnostic to verify PPO v2 fixes before a full training run.

Tests:
  1. State vector size is 273
  2. State freshness — state updates after auto-meld
  3. Win detection — actual game outcomes are tracked
  4. Baseline sanity — random policy gets ~50% wins in 2P

Also includes unit tests (run with pytest).

Usage:
    python test_ppo_v2.py          # Run diagnostic
    pytest test_ppo_v2.py -v       # Run unit tests
"""

import random
import sys


# ── Diagnostic tests (run directly) ─────────────────────────────────────────


def diag_state_size():
    """Verify state vector is exactly 273 features."""
    from shanghai_env import ShanghaiEnv

    print("=" * 60)
    print("TEST 1: State vector size")
    print("=" * 60)

    env = ShanghaiEnv(player_count=2, rich_state=True)
    state = env.reset(seed=99)
    env.close()

    print(f"  State size: {len(state)} (expected: 273)")
    ok = len(state) == 273
    print(f"  {'PASS' if ok else 'FAIL'}")
    print()
    return ok


def diag_state_freshness():
    """Verify get_strategic_actions returns updated state after auto-melds."""
    from shanghai_env import ShanghaiEnv

    print("=" * 60)
    print("TEST 2: State freshness after auto-meld")
    print("=" * 60)

    env = ShanghaiEnv(player_count=2, rich_state=True)

    meld_updates_total = 0
    games_with_melds = 0
    num_games = 10

    for g in range(num_games):
        state = env.reset(seed=g * 13 + 7)
        done = False
        steps = 0
        meld_updates = 0

        while not done and steps < 2000:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break

            if auto_state is not None:
                meld_updates += 1
                if meld_updates <= 2 and g == 0:
                    changed = state != auto_state
                    print(f"  Game 0 auto-meld #{meld_updates}: state changed = {changed}")
                state = auto_state

            action = random.choice(valid_actions)
            state, _, done, info = env.step(action)
            steps += 1

        meld_updates_total += meld_updates
        if meld_updates > 0:
            games_with_melds += 1

    env.close()
    print(f"  {num_games} games: {meld_updates_total} auto-meld updates in {games_with_melds} games")
    if meld_updates_total > 0:
        print("  PASS: State updates are being captured")
    else:
        print("  WARN: No auto-melds triggered (unusual but possible)")
    print()
    return meld_updates_total


def diag_win_detection():
    """Play games with random policy and verify win detection."""
    from shanghai_env import ShanghaiEnv

    print("=" * 60)
    print("TEST 3: Win detection + baseline win rate (20 games)")
    print("=" * 60)

    env = ShanghaiEnv(player_count=2, rich_state=True)
    num_games = 20
    wins = 0
    losses = 0
    ties = 0
    no_scores = 0

    for g in range(num_games):
        state = env.reset(seed=g * 7 + 1)
        done = False
        steps = 0
        last_info = {}

        while not done and steps < 2000:
            valid_actions, current_player, auto_state = env.get_strategic_actions()
            if not valid_actions:
                break
            if auto_state is not None:
                state = auto_state
            action = random.choice(valid_actions)
            state, _, done, last_info = env.step(action)
            steps += 1

        scores = last_info.get("scores", [])
        if scores and len(scores) >= 2:
            p0 = float(scores[0])
            p1 = float(scores[1])
            if p0 < p1:
                wins += 1
                tag = "WIN"
            elif p0 == p1:
                ties += 1
                tag = "TIE"
            else:
                losses += 1
                tag = "LOSS"
            print(f"  Game {g:2d}: P0={p0:5.0f}  P1={p1:5.0f}  {tag}  ({steps} steps)")
        else:
            no_scores += 1
            print(f"  Game {g:2d}: NO SCORES (done={done}, steps={steps})")

    env.close()
    win_rate = wins / num_games if num_games > 0 else 0
    print(f"\n  Results: {wins}W / {losses}L / {ties}T  ({win_rate:.0%} win rate)")
    if no_scores > 0:
        print(f"  WARNING: {no_scores} games had no scores!")

    ok = wins > 0 and no_scores == 0
    if wins == 0:
        print("  FAIL: 0 wins in 20 games — still broken")
    elif 0.15 <= win_rate <= 0.85:
        print(f"  PASS: {win_rate:.0%} is in expected range for random vs random")
    else:
        print(f"  WARN: {win_rate:.0%} is outside typical range but not zero")
    print()
    return ok, wins, num_games


# ── Unit tests (run with pytest) ────────────────────────────────────────────


def test_action_encoding():
    from ppo import encode_action, decode_action, get_action_mask
    from state_encoder import MAX_ACTIONS, BUY_ACTION_IDX, DECLINE_BUY_ACTION_IDX

    assert MAX_ACTIONS == 26
    assert encode_action("draw_pile") == 0
    assert encode_action("take_discard") == 1
    assert encode_action("discard:0") == 2
    assert encode_action("discard:5") == 7
    assert encode_action("discard:21") == 23
    assert encode_action("buy") == BUY_ACTION_IDX
    assert encode_action("decline_buy") == DECLINE_BUY_ACTION_IDX

    mask = get_action_mask(["draw_pile", "take_discard"])
    assert mask.shape == (26,)
    assert mask[0] == 1.0
    assert mask[1] == 1.0
    assert mask[2] == 0.0

    actions = ["draw_pile", "discard:3", "discard:7"]
    assert decode_action(0, actions) == "draw_pile"
    assert decode_action(5, actions) == "discard:3"
    assert decode_action(9, actions) == "discard:7"


def test_network_forward():
    import torch
    from network_v2 import ShanghaiNetV2
    from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS

    net = ShanghaiNetV2()
    state = torch.randn(1, RICH_STATE_SIZE)
    logits, value = net(state)
    assert logits.shape == (1, MAX_ACTIONS)
    assert value.shape == (1, 1)

    mask = torch.ones(1, MAX_ACTIONS)
    entropy = net.get_entropy(logits, mask)
    assert entropy.item() > 0


def test_network_batch():
    import torch
    from network_v2 import ShanghaiNetV2
    from state_encoder import RICH_STATE_SIZE, MAX_ACTIONS

    net = ShanghaiNetV2()
    batch = torch.randn(8, RICH_STATE_SIZE)
    logits, values = net(batch)
    assert logits.shape == (8, MAX_ACTIONS)
    assert values.shape == (8, 1)


def test_curriculum_requires_wins_to_promote():
    from curriculum import CurriculumManager

    cm = CurriculumManager(plateau_window=10, improvement_threshold=0.05)
    assert cm.current["label"] == "2P random"

    # Flat rewards but NO wins — should NOT promote (the v2 fix)
    for _ in range(15):
        cm.record(-300.0, won=False)
    assert not cm.should_promote(), "Should not promote with 0% win rate!"

    # Now add enough wins to meet 60% threshold
    cm._rewards = []
    cm._wins = 0
    cm._games = 0
    for i in range(15):
        cm.record(-300.0, won=(i % 3 != 0))  # 66% win rate
    assert cm.should_promote(), "Should promote with 66% win rate + plateau"


def test_curriculum_demotion():
    from curriculum import CurriculumManager

    cm = CurriculumManager(plateau_window=10)
    # Force to tier 1
    cm._tier_index = 1

    # Poor results — below half of tier 1's min_win_rate (0.40 * 0.5 = 0.20)
    for _ in range(510):
        cm.record(-500.0, won=False)
    assert cm.should_demote()

    cm.demote()
    assert cm.current["label"] == "2P random"


# ── Main ────────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    print("\nPPO v2 Diagnostic Tests\n")

    size_ok = diag_state_size()
    meld_updates = diag_state_freshness()
    win_ok, wins, total = diag_win_detection()

    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    all_pass = size_ok and win_ok
    print(f"  State size correct:  {'YES' if size_ok else 'NO'}")
    print(f"  Auto-meld captured:  {'YES' if meld_updates > 0 else 'NEEDS MORE GAMES'}")
    print(f"  Wins vs random:      {wins}/{total}")
    print()
    if all_pass:
        print("All checks passed. Ready to train.")
    else:
        print("Issues detected. Review output above.")
    sys.exit(0 if all_pass else 1)
