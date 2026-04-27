# Shanghai Tracker Testing Patterns

## TypeScript Frontend Testing

Framework: Vitest 4.1.0
Location: /d/shanghai-tracker/src/game/__tests__/*.test.ts
Commands: npm run test (once), npm run test:watch (watch mode)

Test files: 20+ files, 200+ test cases total
- sets.test.ts, runs.test.ts, buying.test.ts, ai.test.ts
- scoring.test.ts, deck.test.ts, goingout.test.ts, and more

Test Framework Import:
import { describe, it, expect } from 'vitest'

Test Structure:
describe('TestSuite', () => {
  it('test description', () => {
    expect(result).toBe(expected)
  })
})

Test Helpers from /d/shanghai-tracker/src/game/__tests__/helpers.ts:
- c(suit, rank, id?) - Create test card
- joker(id?) - Create test joker
- makeMeld(cards, type) - Create test meld
- resetIds() - Reset ID counter between tests

What's Tested (100+ test cases):
- Meld validation (sets, runs, all variants)
- AI buying logic (easy, medium, hard)
- Card scoring and points
- Deck initialization and shuffling
- Go-out and layoff mechanics
- Joker swaps and placement
- Card tracking and inference
- Replay engine mechanics
- Achievements and tournament tracking

Coverage Gaps:
- React components (UI layer)
- Multiplayer synchronization
- Audio and haptics
- Export/import functionality
- Analytics calculations
- Error handling edge cases

Known Bugs (Documented in Tests):

From /d/shanghai-tracker/src/game/__tests__/sets.test.ts:33
GDD Section 3.1: 3 jokers = valid set
BUG: implementation rejects all-joker sets
Test marked: [BUG: implementation returns false]

From /d/shanghai-tracker/src/game/__tests__/runs.test.ts
GDD Section 3.2: 4+ jokers = valid run
BUG: implementation rejects all-joker runs
Test marked: [BUG: implementation returns false]

From /d/shanghai-tracker/src/game/__tests__/requirements.test.ts
GDD Section 3.4: Bonus meld type restriction
BUG: Sets-only rounds allow runs, runs-only allow sets
Tests marked: [BUG: returns true]

No @skip decorators. Bugs documented with comments in test names.

Test Patterns:
const req = ROUND_REQUIREMENTS[0]
const hand = [c('hearts', 7), c('diamonds', 7), c('clubs', 5)]
const discard = c('spades', 7)
expect(isValidSet(cards)).toBe(true)
expect(result).not.toBeNull()
expect(result).toHaveLength(2)

No mocking: Pure functions with helper-created data only.
No database mocks, no async mocking.

---

## Python ML Testing

Framework: pytest
Location: /d/shanghai-tracker/ml/pimc/alphazero/tests/
Conftest: /d/shanghai-tracker/ml/pimc/alphazero/tests/conftest.py

Sets up import paths for cross-module access

Test Files:
- test_agent.py - Agent hook outputs, trajectory recording
- test_network.py - Forward pass shapes, warm-start loading
- test_evaluate.py - Model evaluation
- test_export.py - ONNX/checkpoint export
- test_ppo.py - PPO training
- test_runner.py - Training loop
- test_self_play.py - Self-play data collection
- test_train.py - Training tests
- test_value_labeler.py - Value head labeling

Additional test files:
- /d/shanghai-tracker/ml/training/test_ppo_v2.py
- /d/shanghai-tracker/ml/training/test_random_symmetry.py
- /d/shanghai-tracker/ml/training/test_v3.py

Test Structure:
def test_discard_hook_returns_card_in_hand():
    from agent import ShanghaiNetAgent
    net = _fresh_net()
    agent = ShanghaiNetAgent(net, player_idx=0)
    calls = []
    original_discard = agent.discard
    def recording_discard(...):
        result = original_discard(...)
        if result is not None:
            calls.append((list(hand), result))
        return result
    agent.discard = recording_discard
    play_game(n_players=4, discard_hook=agent.discard)
    assert len(calls) > 0

Well-tested areas:
- Agent hook outputs (discard, draw, buy, laydown)
- Agent trajectory recording per game
- Network forward pass output shapes
- Checkpoint warm-start loading
- Network head initialization
- ONNX export compatibility
- Engine game simulation
- PPO training loop
- Value labeling

Coverage Gaps:
- Full training pipeline end-to-end
- Real game dataset evaluation
- Performance benchmarking
- Data collection scaling

Conditional Skips:
Example from test_network.py:34
if not ckpt.exists():
    pytest.skip("network_v7.pt not found")

No @skip decorators. Tests skip gracefully when model files missing.

Fixtures & Mocking:
Helper pattern:
def _fresh_net():
    from network import ShanghaiNet
    return ShanghaiNet()

Monkey-patching for recording:
original_discard = agent.discard
def recording_discard(...):
    result = original_discard(...)
    calls.append((list(hand), result))
    return result
agent.discard = recording_discard

Data sources: Random generation, pre-computed constants, model weights from disk.
No fixtures.py. conftest.py handles path setup only.

---

## Running Tests

TypeScript:
npm run test - Run tests once
npm run test:watch - Watch mode

Python:
pytest - All tests
pytest -v - Verbose output
pytest ml/pimc/alphazero/tests/test_network.py - Single file
pytest path/to/test.py::test_name - Single test
pytest -s - Show print output
pytest -x - Stop on first failure

---

## Test Utilities Summary

TypeScript Helpers (/d/shanghai-tracker/src/game/__tests__/helpers.ts):
- resetIds() - Reset ID counter
- c(suit, rank, id?) - Create card
- joker(id?) - Create joker
- makeMeld(cards, type, jokerPositions?) - Create meld

Python Fixtures (/d/shanghai-tracker/ml/pimc/alphazero/tests/conftest.py):
Path setup for imports. Module-level helpers in test files.

Common Vitest Assertions:
expect(...).toBe(true/false)
expect(...).not.toBeNull()
expect(...).toHaveLength(n)
expect(...).toEqual({...})
expect(...).toMatch(/regex/)

Common Pytest Assertions:
assert condition
assert value == expected
assert len(list) > 0
assert shape == (3, 53)

---

## CI & Pre-Commit

No pre-commit hooks configured.
ESLint runs via npm run lint (manual, not automatic).
Pytest runs manually via command line.
No GitHub Actions CI configured.

Tests run locally only. Manual execution required.

---

## Summary

TypeScript: Game logic heavily tested (200+ test cases)
Python: Model training and export tested
Gaps: UI components, multiplayer, audio, analytics
Known bugs: All-joker melds and bonus type restriction documented
CI: None configured, local testing only
