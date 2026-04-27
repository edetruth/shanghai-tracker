# Directory Structure & Module Boundaries

## Root Level

shanghai-tracker/
├── .planning/codebase/          [OUTPUT] Codebase documentation
├── src/                          Frontend React SPA (TypeScript)
├── game-cli/                     Terminal pass-and-play game (ts-node)
├── ml/                           Python ML training pipeline
├── supabase/                     Database migrations (SQL)
├── dist/                         Production build output
├── package.json                  Root npm dependencies
├── tsconfig.json                 TypeScript configuration
├── vite.config.ts                Vite build config
└── vercel.json                   SPA routing rewrite

## Frontend (src/)

src/
├── App.tsx                       Root: section routing, state machine
├── main.tsx                      React entry point
├── index.css                     Tailwind + custom styles
├── lib/
│   ├── types.ts                  Shared types (Player, Game, GameScore)
│   ├── constants.ts              ROUNDS, PLAYER_COLORS
│   ├── gameStore.ts              [KEY] All Supabase queries (20KB)
│   ├── achievements.ts           Badge system
│   ├── sounds.ts                 Web Audio API mixer
│   ├── notifications.ts          Notification API
│   ├── supabase.ts               Client init
│   ├── haptics.ts                Vibration API
│   ├── actionLog.ts              Replay logging
│   └── tournamentStore.ts        Tournament logic
├── stores/
│   └── gameStore.ts              [KEY] Zustand game state
├── hooks/
│   ├── useRealtimeScores.ts       postgres_changes subscription
│   ├── useActionAck.ts           Multiplayer ack
│   └── useHeartbeat.ts           Multiplayer presence
├── game/                         [KEY] Pure game engine (no DB)
│   ├── types.ts                  Card, Meld, RoundState, GameState
│   ├── deck.ts                   Deck ops
│   ├── meld-validator.ts         Validation (20KB)
│   ├── rules.ts                  Constants
│   ├── scoring.ts                Points
│   ├── turn-manager.ts           Turn flow
│   ├── buy-manager.ts            Buying logic
│   ├── round-manager.ts          Round ops
│   ├── game-manager.ts           Game orchestration
│   ├── ai.ts                     [KEY] AI logic (79KB)
│   ├── opponent-model.ts         Adaptive AI
│   ├── card-tracker.ts           Card tracking
│   ├── hand-inference.ts         Opponent inference
│   ├── replay-engine.ts          Replay logic
│   ├── multiplayer-types.ts      MP types
│   ├── multiplayer-host.ts       Host logic
│   ├── multiplayer-client.ts     Client logic
│   ├── tutorial-script.ts        Tutorial sequences
│   └── __tests__/                ~18 test files
├── components/
│   ├── HomePage.tsx
│   ├── PlayTab.tsx               [KEY] Orchestrates digital game
│   ├── ScoreTrackerPage.tsx
│   ├── ScoreEntry.tsx
│   ├── GameSummary.tsx
│   ├── GameCard.tsx
│   ├── StatsLeaderboard.tsx
│   ├── DrilldownModal.tsx        6 view types
│   ├── PlayerProfileModal.tsx
│   ├── JoinGame.tsx
│   ├── TutorialOverlay.tsx
│   ├── ExportData.tsx
│   ├── ImportData.tsx
│   ├── AnalyticsPage.tsx
│   ├── TournamentUI.tsx
│   └── play/                     Digital game UI
│       ├── GameSetup.tsx         Player/AI config
│       ├── GameBoard.tsx          [KEY] 3000-line orchestrator
│       ├── GameOver.tsx           Results save
│       ├── Card.tsx              Card component
│       ├── HandDisplay.tsx        Hand fan UI
│       ├── MeldBuilder.tsx        Meld editor
│       ├── SpectatorBoard.tsx    Spectator view
│       ├── ReplayViewer.tsx       Replay viewer
│       └── zones/
│           ├── TopBar.tsx
│           ├── OpponentStrip.tsx
│           ├── PileArea.tsx
│           ├── HandArea.tsx
│           └── ActionBar.tsx
├── multiplayer/                  (hooks for MP)
└── simulation/
    └── run.test.ts               Benchmarks

## Game Engine (src/game/)

Core modules:
- types.ts: Card, Meld, RoundState, GameState
- deck.ts: deck creation, shuffle
- meld-validator.ts: validation logic
- rules.ts: point values, requirements
- scoring.ts: hand points
- turn-manager.ts: turn flow (draw, meld, layoff, discard)
- buy-manager.ts: buying windows
- round-manager.ts: round setup/scoring
- game-manager.ts: 7-round orchestration
- ai.ts: Medium/Hard AI (79KB)
  - aiFindBestMelds()
  - aiChooseDiscard(), aiChooseDiscardHard()
  - aiShouldBuy(), aiShouldBuyHard()
  - aiFindLayOff(), aiFindJokerSwap()
- opponent-model.ts: Adaptive AI (Nemesis)
- card-tracker.ts: Track seen cards
- hand-inference.ts: Infer opponent holdings
- replay-engine.ts: Reconstruct from logs
- multiplayer-*: Host/client logic

All modules are pure (no Supabase calls).

## Python ML Pipeline (ml/)

ml/
├── training/
│   └── requirements.txt
├── pimc/
│   ├── engine.py                 [KEY] Fast simulator (100+ games/sec)
│   ├── card_tracker.py
│   ├── evaluate_*.py
│   ├── alphazero/
│   │   ├── agent.py              [KEY] ShanghaiNetAgent wrapper
│   │   ├── network.py            [KEY] ShanghaiNet (5-head network)
│   │   ├── ppo.py                [KEY] PPO training (GAE, loss)
│   │   ├── self_play.py          [KEY] collect_games()
│   │   ├── train.py              Training utils
│   │   ├── runner.py             [KEY] Training loop + checkpointing
│   │   ├── evaluate.py           Eval
│   │   ├── export.py             ONNX export
│   │   ├── value_labeler.py      Value labeling
│   │   ├── checkpoints_v1-v7/    Checkpoint directories (.pt files)
│   │   └── tests/                ~12 unit tests
│   └── collect_data*.py          Data collection
├── bridge/                       TS↔Python interop
│   └── src/
│       ├── game-bridge.ts        [KEY] 52KB bridge
│       ├── expert-play.ts        23KB expert logic
│       └── meld-plan-encoder.ts
├── data/                         Datasets
└── models/                       Pre-trained models

## Database Migrations (supabase/)

supabase/
├── add_game_type.sql
├── add_game_rooms.sql            Multiplayer tables
├── add_shanghai_events.sql
├── add_game_events.sql
├── add_telemetry.sql
├── add_achievements.sql
├── add_action_log.sql
└── add_tournaments.sql

All enable RLS, publish to Realtime where needed.

## Build & Deployment

dist/                            Vite output (Vercel CDN)
- index.html
- assets/ (code-split JS, CSS)
- sounds/ (game SFX)

Code Splitting (vite.config.ts):
- react-vendor
- recharts-vendor
- xlsx-vendor
- supabase-vendor
- main chunk

Service Worker: generated by vite-plugin-pwa
- Precache static assets
- Runtime cache Supabase (24h)

## Key Design Decisions

1. Pure TS Game Engine — no Supabase in src/game/
2. Centralized DB Access — src/lib/gameStore.ts
3. Zustand for Game State — lightweight
4. GameBoard.tsx — 3000+ lines (could refactor)
5. ai.ts — 79KB monolithic (could split)
6. Integer Card Encoding — Python: suit*16+rank
7. 170-Dim State Vectors — fixed size
8. Host-Authoritative MP — prevents cheating
9. No Auth/RLS — public anon key
10. PWA-First — Workbox caching, installable
