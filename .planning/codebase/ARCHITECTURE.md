# High-Level Architecture

## System Overview

Shanghai Tracker is a Progressive Web App (PWA) for playing and scoring Shanghai Rummy, with an embedded AlphaZero-style ML training pipeline for AI agents.

Frontend:
- Browser: React SPA + PWA with Zustand game state
- Supabase: PostgreSQL + Realtime WebSocket

Backend ML Pipeline:
- Python: AlphaZero training (PPO), self-play collection
- PyTorch: ShanghaiNet (5-head policy+value network)
- Game Engine: Fast integer-encoded simulator (100+ games/sec)

## Frontend Architecture (React SPA)

Component Hierarchy:
- App.tsx: root state orchestrator (section routing, scoreTrackerState machine)
- PlayTab: digital game pass-and-play + AI play
  - GameBoard (3000-line orchestrator): hand, melds, discard, action bar
- ScoreTrackerPage: manual score tracking, import/export
- StatsLeaderboard: game history, player profiles, drilldowns
- Other: HomePage, TutorialOverlay, JoinGame, TournamentUI

State Management:
- App.tsx: section, scoreTrackerState, activeGame, activePlayers, selectedPlayerId
- Zustand (src/stores/gameStore.ts): play mode game state (gameState, uiPhase, actions)
- useState: UI-only (modals, animations, selections)

Data Access (src/lib/gameStore.ts):
- All Supabase queries centralized
- Player ops: getPlayers(), upsertPlayer()
- Game ops: createGame(), getGame(), completeGame()
- Score ops: updateRoundScore(), saveAllRoundScores()
- Multiplayer: generateRoomCode(), room management
- Telemetry: optional saveShanghaiEvents(), saveAIDecisions(), saveActionLog()

Real-Time Sync:
- useRealtimeScores hook: subscribes to postgres_changes events
- game_scores, game_rooms, game_room_players table changes trigger refresh
- No polling; WebSocket-driven instant updates

## Game Engine Architecture (src/game/)

Core Modules:
- types.ts: Card, Meld, RoundState, GameState, BuyRequest
- deck.ts: deck creation, shuffle, deal
- meld-validator.ts: set/run validation, joker logic
- rules.ts: point values (Ace=1, Joker=25), round requirements
- scoring.ts: hand points, Shanghai detection (0 score)
- turn-manager.ts: draw → meld → layoff → discard flow
- buy-manager.ts: buying windows, priority, penalty cards
- round-manager.ts: round setup, scoring, advancement
- game-manager.ts: 7-round orchestration
- ai.ts (79KB): Medium/Hard AI with hand tracking, meld finding
- opponent-model.ts: Adaptive AI based on opponent history

Game Flow:
- GameManager orchestrates 7 rounds
- Each round: deal, turn loop, buy resolution, scoring
- Each turn: draw/take, meld, layoff, discard
- Scoring: hand points, zero = "out" (first place), lowest wins

AI Decision Logic:
- Medium: greedy melds, heuristic discard, probabilistic buys
- Hard: opponent-aware discard, aggressive buying, hand tracking

## Python ML Pipeline (ml/pimc/alphazero/)

Training Loop (runner.py):
1. Collect n_games self-play with current network + opponent pool
2. Label steps with value_label = final score outcome
3. Flatten steps into batch tensors
4. Compute PPO loss (policy + value + entropy)
5. Backward + gradient clip + optimizer step
6. Checkpoint best agents to opponent pool

Self-Play (self_play.py):
- Player 0 = current network (record=True for trajectory)
- Players 1-3 = random sample from opponent pool
- Returns trajectories with steps + final score per game

State Representation (agent.py, 170-dim):
- [0-52]: hand card counts (53 card types)
- [53-105]: seen discard history (observed top-of-pile per type)
- [106-158]: current discard top (one-hot)
- [159-165]: round index (one-hot, 7 rounds)
- [166]: has_laid_down flag
- [167-169]: opponent hand sizes (normalized 0-1)

Network (network.py: ShanghaiNet):
- Backbone: 170 → 256 → 256 → 256 (LayerNorm + ReLU + Dropout)
- 5 output heads:
  - discard_head (256 → 53): card logits
  - draw_head (256 → 2): draw vs take
  - buy_head (256 → 1): binary buy
  - laydown_head (256 → 1): binary lay-down
  - value_head (256 → 1): expected return (higher = better)

PPO Training (ppo.py):
- Generalized Advantage Estimation (GAE): γ=0.99, λ=0.95
- Policy loss: clipped surrogate with advantage
- Value loss: MSE on normalized targets
- Entropy bonus: per-head entropy weighted by step counts
- Total: policy_loss + 0.5×value_loss - entropy_coef×entropy

Game Engine (engine.py):
- Fast integer encoding: card_int = suit*16 + rank
- 100+ games/sec single-threaded performance
- 2 decks, 7 rounds, 10-12 card deals
- Rules mirror TypeScript engine (buying, joker swaps, etc.)
- PIMC simplifications for speed: no buying, greedy play

Checkpointing:
- Format: PyTorch .pt files (state_dict)
- Directories: checkpoints_v1 through checkpoints_v7
- Warm-start: load PIMC backbone + discard head, random other heads

## Multiplayer Architecture

Host-Authoritative Model:
- Host runs full game engine
- Remote clients receive sanitized RemoteGameView (own hand visible, others hidden)
- All actions validated by host before execution
- Prevents cheating, simplifies state sync

Realtime Channels:
- Broadcast: game:{roomCode} for action dispatch
- Presence: player online status via heartbeat
- Subscriptions: game state snapshots broadcast to all clients

Action Flow:
1. Remote player sends action via broadcast
2. Host receives, validates in full engine
3. Host executes and broadcasts new game state
4. All clients re-render from new state snapshot

## Database Schema (Supabase PostgreSQL)

Core Tables:
- players (id, name, created_at)
- games (id, date, room_code, notes, is_complete, game_type, created_at)
  - game_type: 'manual' | 'pass-and-play' | 'ai' | 'online'
- game_scores (id, game_id, player_id, round_scores[], total_score)
  - round_scores: array of 7 per-round scores
  - total_score: generated column (SUM)

Multiplayer:
- game_rooms (id, room_code, host_player_name, status, game_config)
- game_room_players (id, room_code, player_name, seat_index, is_ai, is_connected)

Optional Telemetry:
- shanghai_events, ai_decisions, player_round_stats, player_game_stats
- game_action_log (action replay with action_type, action_data JSONB)
- player_achievements, tournaments, tournament_matches

No RLS: public anon key (social-play focus, no auth)

## Key Design Decisions

1. No Custom Backend: all persistence via Supabase
2. Zustand for Game State: lightweight, functional
3. Pure TypeScript Game Engine: reusable, bridges to Python
4. Host-Authoritative Multiplayer: prevents cheating
5. PPO Training: on-policy, value baseline, stable
6. Integer Card Encoding: fast PIMC rollouts (100+ games/sec)
7. 170-Dim State Vector: hand + seen + top + round + opponent info
8. Warm-Start from PIMC: leverage discard network
9. PWA with Workbox: offline play, auto-update
10. No Auth/RLS: simplified, social-play design
