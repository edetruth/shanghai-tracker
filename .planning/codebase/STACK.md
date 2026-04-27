# Technology Stack

## Frontend (React/TypeScript SPA)

### Core Framework & Build
- **React** 18.3.1 — UI library
- **TypeScript** 5.4.2 — type safety
- **Vite** 5.1.6 — build tool, dev server, ESM bundler
- **Vitest** 4.1.0 — unit testing framework (1454 tests)

### UI & Styling
- **Tailwind CSS** 3.4.1 — utility-first CSS framework
- **Lucide React** 0.344.0 — icon library (53+ icons)
- **Recharts** 2.12.1 — React charting library for stats/trends
- **PostCSS** 8.4.35 — CSS transformations (Tailwind pipeline)
- **Autoprefixer** 10.4.18 — vendor prefixes

### State Management
- **Zustand** 5.0.12 — lightweight state store for game engine state
- React `useState` — UI-only state (selections, modals, animations)

### Backend & Persistence
- **Supabase JS Client** 2.39.3 — PostgreSQL backend + Realtime WebSocket subscriptions
  - Database: PostgreSQL (managed)
  - Realtime: Broadcast channels for multiplayer sync
  - No custom backend API

### Data & Utilities
- **XLSX** 0.18.5 — Excel/CSV import/export
- **date-fns** 3.3.1 — date parsing and formatting
- **Workbox** 7.1.0 — service worker caching (PWA offline support)

### PWA & Caching
- **vite-plugin-pwa** 1.2.0 — service worker generation, web manifest
- Browser APIs: Notification API, Web Audio API, Vibration API

### Dev Tools
- **ESLint** — code quality (configured via package.json lint script)
- **@vitejs/plugin-react** 4.3.1 — Vite React plugin with JSX transform
- **@vitest/coverage-v8** 4.1.0 — code coverage reporting

### TypeScript Configuration
- Target: ES2020
- Module: ESNext
- Strict mode: enabled
- JSX: react-jsx (automatic transform)
- Resolves .ts/.tsx files with bundler module resolution

## Backend (Python ML Pipeline)

### Core ML Frameworks
- **PyTorch** 2.0+ — neural networks, training loops, inference
- **NumPy** 1.24+ — numerical arrays, card state vectors
- **ONNX** 1.14+ — model export format (inference compatibility)
- **ijson** 3.2+ — streaming JSON parsing

### ML Architecture (ml/pimc/alphazero/)
- **ShanghaiNet** — Multi-head policy + value network
  - Backbone: 3-layer MLP (170→256→256→256) with LayerNorm + ReLU + Dropout(0.1)
  - 5 output heads:
    - `discard_head` (256→53): card discard logits
    - `draw_head` (256→2): draw vs take logit
    - `buy_head` (256→1): binary buy decision
    - `laydown_head` (256→1): binary lay-down decision
    - `value_head` (256→1): game value regression

### Training Pipeline
- **PPO (Proximal Policy Optimization)** — policy gradient with clipped surrogate loss
  - Generalized Advantage Estimation (GAE) with λ=0.95, γ=0.99
  - Value regression with normalized targets
  - Entropy regularization (coefficient 0.01–0.05)
  - Gradient clipping (norm 1.0)

### Self-Play & Data Collection
- Opponent pool sampling with fixed/rotating checkpoints
- PIMC rollout integration (Monte Carlo tree search fallback)
- 170-dimensional state vectors:
  - [0-52]: hand cards (53 card types)
  - [53-105]: seen discard history (53 types)
  - [106-158]: top discard card (53 types)
  - [159-165]: round index (one-hot, 7 rounds)
  - [166]: has_laid_down flag
  - [167-169]: opponent hand sizes (3 opponents, normalized 0-1)

### Game Engine (Pure Python)
- **ml/pimc/engine.py** — fast Shanghai Rummy simulator
  - Card encoding: `card_int = suit*16 + rank` (0-80 range)
  - Suits: 0=clubs, 1=diamonds, 2=hearts, 3=spades, 4=joker
  - Ranks: 1=Ace, 2-10=pips, 11=Jack, 12=Queen, 13=King, 0=joker
  - Joker special: 64 (4*16+0)
  - Rules: 2 decks (108 cards), 7 rounds, 10-12 card deals
  - Performance target: ≥100 games/sec single-threaded

### Checkpointing
- Directory structure: `alphazero/checkpoints_v1/..._v7/`
- Format: PyTorch `.pt` files (state_dict)
- Warm-starting: load PIMC backbone + discard head, random init for other heads

### Python Versions & Dependencies
- Python 3.7+ (inferred from code style)
- No explicit version pinning in requirements.txt (flexible)

## TypeScript/JavaScript Subprojects

### Game CLI (game-cli/)
- **TypeScript** 5.3.0
- **ts-node** 10.9.2 — runtime TypeScript execution
- **Chalk** 4.1.2 — terminal color output
- Pass-and-play terminal UI for Shanghai Rummy

### ML Bridge (ml/bridge/)
- **TypeScript** (ES2022 target, CommonJS output)
- Bridges Python engine to TypeScript: `game-bridge.ts` (52KB), `expert-play.ts` (23KB)
- Compiles to CommonJS for Node.js interop

## Deployment & Hosting

### Frontend
- **Vercel** — SPA hosting, zero-config deployment
  - `vercel.json` rewrites all routes to `index.html`
  - CDN edge caching
  - Auto-deploys on git push

### Backend
- **Supabase Cloud** — managed PostgreSQL + Realtime
  - Tables: players, games, game_scores, shanghai_events, ai_decisions, player_round_stats, player_game_stats, game_rooms, game_room_players, player_achievements, game_action_log, tournaments, tournament_matches
  - RLS disabled (public anon key access)
  - Realtime enabled on key tables

## Optional/Future
- PWA manifest: standalone app, portrait orientation, warm cream theme (#f8f6f1)
- Notifications: localStorage for volume settings
- Sound: Web Audio API (2-channel mixer)

## Browser APIs Used
- Notification API (local only)
- Vibration API (haptic feedback)
- Web Audio API (game sounds)
- Service Worker API (PWA caching)
- localStorage (settings, achievements, sound volume)
