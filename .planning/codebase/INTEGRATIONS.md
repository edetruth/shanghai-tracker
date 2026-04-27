# External Integrations & Services

## Production Services

### Supabase (Backend-as-a-Service)
- **URL**: `https://myldjuyelyljmygxusuo.supabase.co`
- **Access**: Anon key (public, no row-level security)
- **Services**:
  - **PostgreSQL Database**: 12+ tables for game/player/score tracking
  - **Realtime Subscriptions**: WebSocket channels for:
    - Multiplayer score sync (`game_scores` table changes)
    - Game room state (`game_rooms` table changes)
    - Lobby updates (`game_room_players` table changes)
  - **Broadcast Channels**: `game:{roomCode}` for action dispatch in multiplayer
- **Environment Vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (.env.local)

### Vercel (Frontend Hosting)
- **Platform**: Serverless SPA hosting with edge CDN
- **Config**: `vercel.json` rewrites all routes → `index.html` (SPA routing)
- **Features**:
  - Zero-config deployment (git push triggers build)
  - Automatic HTTPS, custom domain support
  - Edge network caching static assets
- **Build Output**: Vite dist/ bundled to Vercel Functions (if needed for edge middleware)

## Browser APIs & Web Standards

### Notifications
- **Notification API**: Native push notifications (desktop/mobile)
- **Implementation**: `src/lib/notifications.ts`
- **Scope**: Local notifications only (no push service)

### Audio & Haptics
- **Web Audio API**: Game SFX (card play, discard, win chime)
- **Vibration API**: Haptic feedback on card interactions
- **Storage**: Volume preference in localStorage

### Service Worker & Caching
- **Workbox (via vite-plugin-pwa)**:
  - Precache: all static assets (.js, .css, .html, .png, .svg, .woff2, .mp3, .wav)
  - Runtime cache: Supabase API responses (24h max age, 50 max entries)
  - Strategy: NetworkFirst for API, CacheFirst for static
- **Offline Support**: PWA caching allows partial offline play (reads from cache)

### Web Manifest & PWA
- **vite-plugin-pwa** generates manifest.json:
  - Name: "Shanghai Tracker"
  - Display: standalone (full-screen app)
  - Orientation: portrait
  - Theme color: #f8f6f1 (warm cream)
  - Icons: 192x192 and 512x512 PNG + maskable variant
- **Installation**: "Add to Home Screen" on iOS/Android/desktop

## Data Import/Export Formats

### XLSX (Excel/CSV)
- **Library**: `xlsx` 0.18.5
- **Use Cases**:
  - Import: Excel/CSV game scorecards
  - Export: All games as XLSX or JSON
- **No external service**: Local file parsing (browser-side)

## Email & Messaging (Placeholder)
- **Push Notifications**: VAPID keys configured (.env.local)
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  - Not yet integrated (placeholder for future Web Push implementation)

## Code Organization (No External Service)
- **Bridge Layer**: `ml/bridge/` compiles TypeScript to CommonJS for Node.js interop with Python
  - Allows TypeScript game rules to be reused in training pipeline
  - No external service — local compilation

## Third-Party CDN/Libraries

### Icon Library (Lucide React)
- **lucide-react** 0.344.0 — Icon SVG components (no external fetch)

### Chart Library (Recharts)
- **recharts** 2.12.1 — React charts (no external API, client-side rendering)

### Date Utilities (date-fns)
- **date-fns** 3.3.1 — No external calls, pure utility functions

## Analytics & Telemetry
- **Supabase tables** for optional tracking:
  - `ai_decisions` — AI move logs
  - `player_round_stats` — per-round metrics
  - `player_game_stats` — aggregated game stats
  - `game_action_log` — complete action sequences (for replay)
  - `player_achievements` — badge tracking
- **No external analytics vendor** (Google Analytics, Mixpanel, etc.)
- **Implementation**: `src/lib/actionLog.ts`, `src/lib/achievements.ts`

## Game Design & Rules Reference
- **Authoritative GDD**: `Shanghai_GDD_v1.3.md`
- **Rules document**: `RULES_TEST.md`, `GAME_DESIGN.md`
- **ML training reference**: Mirror rules in Python engine (`ml/pimc/engine.py`)

## Database Tables (Supabase)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `players` | Player registry | id, name, created_at |
| `games` | Game sessions | id, date, room_code, is_complete, game_type, created_at |
| `game_scores` | Round scores (denormalized) | id, game_id, player_id, round_scores (array), total_score |
| `shanghai_events` | Optional: Shanghai tracking | id, game_id, player_id, round_number |
| `ai_decisions` | Optional: AI telemetry | id, game_id, round_number, decision_type, decision_result |
| `player_round_stats` | Optional: Round stats | id, game_id, round_number, player_name, round_score, went_out |
| `player_game_stats` | Optional: Game aggregates | id, game_id, player_name, total_score, final_rank, won |
| `game_rooms` | Multiplayer lobby | id, room_code, host_player_name, game_config (jsonb), status |
| `game_room_players` | Multiplayer participants | id, room_code, player_name, seat_index, is_ai, is_connected |
| `player_achievements` | Badge tracking | id, player_name, achievement_id, unlocked_at |
| `game_action_log` | Action replay | id, game_id, seq, action_type, action_data (jsonb) |
| `tournaments` | Tournament hosting | id, code, host_name, player_count, format, status |
| `tournament_matches` | Match records | id, tournament_id, round_number, player_names (array), winner_name |

## No External Integrations (By Design)
- **No OAuth/authentication** — public anon key only
- **No payment processing** — app is free
- **No email/SMS** — Notifications API only
- **No third-party analytics** — optional Supabase telemetry tables
- **No social login** — no user accounts
- **No external ML inference** — all models run in browser (no cloud API)
