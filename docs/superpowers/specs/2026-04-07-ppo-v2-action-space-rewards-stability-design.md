# PPO v2: Simplified Action Space, Dense Rewards, Training Stability

**Goal:** Fix the three identified PPO problems — action space bloat, reward sparsity, and training instability — to surpass the previous best result (16% win rate, 323 avg vs Shark).

**Approach:** Option A (Hybrid) — rule-based meld/layoff, PPO learns draw/discard/buy only.

**Target:** >20% win rate vs Shark, <280 avg score. Stretch: >25%, <250.

---

## 1. Simplified Action Space (#20)

### Current: 350 flat actions
- draw_pile (1), take_discard (1), meld (1), discard:0..15 (16), layoff:card:meld (320), buy (1), decline_buy (1)
- 91% of the space is layoff combinations that are rarely valid

### New: 26 actions
| Index | Action | When Valid |
|-------|--------|-----------|
| 0 | draw_pile | Draw phase |
| 1 | take_discard | Draw phase, discard pile not empty |
| 2..23 | discard:0..21 | Action phase, card at hand index exists |
| 24 | buy | Buy phase |
| 25 | decline_buy | Buy phase |

### Meld/Layoff Handling
When the bridge returns `meld` or `layoff:*` as the only valid actions (or mixed with discard), the Python wrapper auto-executes them using the rule-based AI before presenting the next real decision to PPO. This is implemented as a loop in the env wrapper:

```
while valid_actions contain only meld/layoff:
    auto_execute(best_meld_or_layoff)
    valid_actions = get_new_valid_actions()
return strategic_actions_only  # draw/discard/buy
```

The bridge is unchanged. Filtering happens in Python.

### Network Change
- `gameplay_head`: Linear(128, 26) instead of Linear(128, 350)
- `buy_head`: removed — buy/decline are now indices 24/25 in the unified head
- Simpler entropy calculation (no buy/gameplay split needed)

---

## 2. Dense Reward Shaping (#19)

### Current rewards (per step)
- Time penalty: -0.0005 (negligible)
- Score delta: -delta/100 (only fires at round end)
- Meld bonus: +0.5 (removed — model doesn't meld)
- Layoff bonus: +0.05 (removed — model doesn't layoff)

### New rewards

**Per-step base:**
- Time penalty: -0.002 (4× stronger, still small)

**After draw/take decisions:**
- Hand improvement: `(evaluateHand_after - evaluateHand_before) / 200`
- Range: roughly -0.5 to +0.5 per draw
- Computed by the bridge via `evaluate_hand` command (new)

**After discard decisions:**
- Hand quality signal: `evaluateHand_after / 200 - 0.5` (centered around 0)
- Opponent pickup penalty: if next player takes the discard within 1 turn, -0.1 retroactive penalty (delayed reward applied at next agent step)

**Round-end rewards (replace current score delta):**
- Win bonus: +2.0 if agent has lowest score this round
- Score penalty: `-(round_score) / 100`
- Going out bonus: +1.0 if agent went out first

**Game-end rewards:**
- Game win: +5.0
- Score gap: `-(final_score - winner_score) / 200` (penalize distance from winner)

**Stalling penalty (replaces timeout):**
- If hand size grows above base dealt + 4: `-0.01 * excess_cards` per step
- Scales with hand bloat, making stalling progressively more punishing

### Bridge Changes
Add `evaluate_hand` command that returns `evaluateHand(hand, requirement)` score for the current player. Called after each draw/discard to compute improvement.

---

## 3. Training Stability (#21)

### Stalling Fix
- Stalling penalty above replaces the binary -10.0 timeout
- Reduce max_steps from 3000×player_scale to 2000×player_scale
- If any single game exceeds 1.5× the average steps of recent games, terminate with penalty

### Curriculum Changes
- Increase plateau window: 500 → 1000 games
- Require >5% improvement OR >15% win rate for promotion (currently 2%)
- Add intermediate tiers between shark and nemesis:
  - Tier 7: 4P shark (unchanged)
  - Tier 7.5: 4P mixed (2× shark + 2× patient-pat)
  - Tier 8: 4P nemesis (unchanged)
- Allow demotion: if win rate drops below 5% for 500 games after promotion, drop back

### Health Monitor Recovery
Current behavior: 10 consecutive stall batches → training killed.
New behavior:
1. 5 consecutive stalls → reduce LR by 50%, reset stall counter
2. 5 more stalls at reduced LR → reduce LR by 50% again
3. 5 more stalls → save checkpoint and stop (15 total, not 10)

### Entropy Floor
- If mean entropy < 0.3: boost entropy coefficient from 0.05 to 0.15 for 50 batches
- Prevents premature policy collapse

---

## Files Modified

| File | Changes |
|------|---------|
| `ml/training/ppo.py` | New action encoding (26 actions), auto-execute meld/layoff loop, new reward shaping, stalling penalty, health monitor recovery |
| `ml/training/network_v2.py` | Simplified network: 26-action head, remove separate buy head |
| `ml/training/curriculum.py` | Stronger promotion criteria, intermediate tiers, demotion support, LR recovery |
| `ml/training/shanghai_env.py` | Add `evaluate_hand` wrapper, auto-meld/layoff action filtering |
| `ml/bridge/game-bridge.ts` | Add `evaluate_hand` command handler |
| `ml/training/evaluate.py` | Update for 26-action space, new decode_action |
| `ml/training/state_encoder.py` | Update MAX_ACTIONS = 26 |

## Testing

- Smoke test: 10 games, verify actions are only draw/discard/buy
- Reward test: verify hand improvement rewards fire after draws
- Curriculum test: verify promotion/demotion logic
- Full training run: user executes (per convention)
- Evaluation: 100 games vs Shark, 100 vs Nemesis

## Success Criteria

- Training completes through tier 7 (Shark) without health monitor kills
- Win rate vs Shark > 20% (best model from any tier)
- Avg score vs Shark < 280
- No stalling exploits (avg steps < 2× baseline)
