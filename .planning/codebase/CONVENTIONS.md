# Shanghai Tracker Coding Conventions

## TypeScript / React Frontend

### Naming Conventions

**Files**:
- Components: PascalCase (HomePage.tsx, GameSummary.tsx)
- Utilities: camelCase (gameStore.ts, meld-validator.ts)
- Hooks: camelCase with use prefix (useGameAudio.ts)
- Tests: .test.ts or .spec.ts (sets.test.ts)

**Code**:
- Variables & functions: camelCase (isValidSet, hasLaidDown)
- Boolean prefixes: is, has, can, should
- Constants: UPPER_SNAKE_CASE (ROUND_REQUIREMENTS, MAX_BUYS)
- Interfaces: PascalCase (GameState, Card, Meld)
- Type aliases: PascalCase unions (Section = 'home' | 'play')

### Component Structure

Files: /d/shanghai-tracker/src/components/HomePage.tsx, ErrorBoundary.tsx

Functional components with explicit Props interface. Props explicitly typed with interface. Event handlers: (arg: Type) => void. Functional components only. Tailwind CSS for styling. Inline styles for animations/dynamic values.

### State Management

Zustand (/d/shanghai-tracker/src/stores/gameStore.ts):
- Support both direct values and updater functions (prev) => T
- Batch updates via .batch() for atomic multi-field changes
- Reset via .reset() for new game initialization
- Local state via useState() for component UI state

### Async & Error Handling

From /d/shanghai-tracker/src/lib/gameStore.ts:
- Returns Promise<T> or Promise<T | null>
- Throws errors to caller
- Null returns for "not found" cases
- Error Boundaries catch React render errors

### Type Imports

Use 'import type' for type-only imports to reduce bundle size.

### Game Logic Patterns

From /d/shanghai-tracker/src/game/meld-validator.ts:
- Pure functions (no side effects)
- Immutable data (no mutations)
- Early returns with guard clauses
- Comments reference GDD sections
- Joker handling explicit (suit 'joker', rank 0)

### Known Bugs

All-joker melds - /d/shanghai-tracker/src/game/__tests__/sets.test.ts:33
GDD allows 3+ joker sets/runs, but implementation rejects them.

Bonus meld type restriction - /d/shanghai-tracker/src/game/__tests__/requirements.test.ts
GDD Section 3.4: sets-only rounds should reject runs as bonus melds.

### Anti-Patterns to Avoid

1. No global mutable state (use Zustand)
2. Game logic isolated from React
3. No tight prop drilling (use Zustand)
4. No magic numbers (use constants)
5. No state mutation; create new objects/arrays

---

## Python / ML Backend

### Naming Conventions

Files:
- Modules: snake_case (train_network.py, card_tracker.py)
- Classes: PascalCase (ShanghaiNetAgent, ShanghaiNet)
- Functions: snake_case (_ctype, predict_discard)
- Constants: UPPER_SNAKE_CASE (ACTION_DISCARD, MAX_TURNS)
- Private: prefix with _ (_POINTS_LUT)

### Code Style

From /d/shanghai-tracker/ml/pimc/alphazero/agent.py:
- PEP 8 compliance (snake_case, 2 blank lines)
- Full type hints on all public APIs
- Module-level and method docstrings
- Import grouping: stdlib, third-party, local

### Game Engine Pattern

From /d/shanghai-tracker/ml/pimc/engine.py:

Integer card encoding: card = suit * 16 + rank
- suit: 0=clubs, 1=diamonds, 2=hearts, 3=spades, 4=joker
- rank: 1=Ace, 2-10, 11=Jack, 12=Queen, 13=King; joker=0

Patterns:
- Bit operations extract suit >> 4, rank & 15
- Pre-computed lookup tables (_POINTS_LUT)
- Target: 100+ games/second

### Neural Networks

From /d/shanghai-tracker/ml/pimc/alphazero/network.py:

ShanghaiNet(nn.Module):
- torch.nn.Module inheritance with super().__init__()
- State dict loading with compatibility checks
- Separate forward() and forward_onnx() for ONNX
- @torch.no_grad() on inference methods

### Trajectory Recording

From /d/shanghai-tracker/ml/pimc/alphazero/agent.py:

ShanghaiNetAgent:
- One trajectory per game; reset between games
- Records steps only for agent's player_idx
- Returns None for other players

### Anti-Patterns to Avoid

1. No global mutable state
2. Avoid dense numpy without comments
3. Type hints required on public APIs
4. No hardcoded paths (use Path())
5. Never mutate state directly

---

## Cross-Codebase Patterns

### Game Rules Identical

ROUND_REQUIREMENTS, CARDS_DEALT, MAX_BUYS synchronized:
- TS: /d/shanghai-tracker/src/game/rules.ts
- Python: /d/shanghai-tracker/ml/pimc/engine.py

Values: [10,10,10,10,12,12,12] for cards per round

### Card Encoding

TypeScript (/d/shanghai-tracker/src/game/types.ts):
- id: string (e.g. "h7-1")
- suit: Suit (hearts | diamonds | clubs | spades | joker)
- rank: number (1=Ace, 2-10, 11=Jack, 12=Queen, 13=King)

Python (integer encoding, performance-critical):
- card_int = suit * 16 + rank
- Integer encoding used only in fast rollout

### Testing Philosophy

Test locations: __tests__/ (TS), tests/ (Python)
TS framework: Vitest (vitest run, vitest --watch)
Python framework: pytest
Test helpers: helpers.ts for card creation (c(), joker())
Fixtures: conftest.py for Python setup
GDD verification: Tests reference GDD sections
Known bugs: Documented with [BUG: ...] in test names
Coverage: Game logic heavily tested (100+ test cases)

---

## File Structure

/src
  /components          # React components
    /play             # Game UI subcomponents
  /game               # Game logic
    /__tests__        # Test files (.test.ts)
  /hooks              # Custom React hooks
  /lib                # Utilities
  /stores             # Zustand stores
  /App.tsx
  /main.tsx

/ml
  /pimc               # Monte Carlo simulation
    /alphazero        # AlphaZero training
      /tests          # Python tests
    /engine.py        # Fast simulation
  /training           # Training utilities
  /scripts            # Data analysis

---

## Build & Development

TypeScript:
- npm run dev - Vite dev server
- npm run build - tsc && vite build
- npm run test - vitest run
- npm run test:watch - vitest watch
- npm run lint - ESLint (--max-warnings 0)

Python:
- pytest - Run all tests
- pytest -v - Verbose
- pytest path/to/test.py::test_name - Single test
