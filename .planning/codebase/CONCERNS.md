# Shanghai Tracker — Technical Debt & Concerns

## 1. Oversized Files / God Objects

### 1.1 GameBoard.tsx (~3,087 lines, 120+ KB)
**File:** `src/components/play/GameBoard.tsx`

- **Issue:** Single component handling game orchestration, state management, UI rendering, and complex game flow
- **Contains:** 
  - Core game state initialization and round/turn management
  - Player action handlers (handleDrawPile, handleTakeDiscard, handleMeld, handleDiscard, handleBuy)
  - Buying window logic with multiple state flags (pendingBuyDiscard, freeOfferDeclined, etc.)
  - Multiplayer sync via useMultiplayerSync hook
  - AI automation via useAIAutomation hook
  - Audio/haptics/achievements integration
  - Tournament integration
  - 20+ useState hooks managing UI state separately from game state
  - Complex timing logic with setTimeout/setInterval refs (freeOfferDeclinedRef, pendingBuyDiscardRef, etc.)
- **Root Cause:** Incremental feature additions without refactoring
- **Risk:** Changes to one feature affect 10+ other features via stale-closure bugs; testing nearly impossible; concurrent React mode issues; difficult onboarding

### 1.2 ai.ts (~1,908 lines, 80 KB)
**File:** `src/game/ai.ts`

- **Issue:** Monolithic AI module containing all decision logic
- **Contains:** Hand grouping, meld-finding strategies, take/discard decision logic, buy logic, lay-off logic, opponent awareness, hand evaluation, personality modifiers
- **Root Cause:** All AI strategies in one file for simplicity
- **Risk:** Hard to profile expensive heuristics; difficult A/B testing; no separation between strategy and evaluation; 200+ line functions with nested loops

### 1.3 game-bridge.ts (~1,355 lines, 52 KB)
**File:** `ml/bridge/game-bridge.ts`

- **Issue:** Bridge between TypeScript game engine and Python ML pipeline; must maintain exact state parity
- **Root Cause:** Coupling to Python training loop requires bridge to duplicate game logic
- **Risk:** CRITICAL — TypeScript and Python engines can drift; state encoding changes must be synchronized manually

---

## 2. TODO / FIXME / HACK Comments

**Search Result:** No explicit TODO/FIXME/HACK comments found in source code.

**Implication:** Technical debt is embedded as complexity rather than marked explicitly.

---

## 3. Pre-Existing Test Failures

### 3.1 test_value_labeler.py
**File:** `ml/pimc/alphazero/tests/test_value_labeler.py`

**Status:** Appears to pass

**Potential Issues:**
- Tests create synthetic trajectories but don't validate against real data distributions
- No test for handling `round_cumulative` dict with missing round keys (value_labeler.py line 57 edge case)

### 3.2 test_export.py
**File:** `ml/pimc/alphazero/tests/test_export.py`

**Fragile Aspects:**
- `test_forward_onnx_shapes()` line 37 hardcodes output shapes (discard:53, draw:2, buy:1, laydown:1, value:1)
- If ShanghaiNet architecture changes, test breaks immediately with no version pinning
- `test_export_with_onnxruntime()` silently skips if onnxruntime not installed
- verify=True can fail on numerical precision (1e-4 tolerance) due to platform differences
- **No contract testing between TS game engine and Python ML exporter**

---

## 4. Security Concerns

### 4.1 No Row-Level Security (RLS) on Supabase
**Location:** `src/lib/supabase.ts`, `supabase/*.sql`

**Issue:** All tables use public anon key with policies: `CREATE POLICY anon_all_<table> ON <table> FOR ALL USING (true) WITH CHECK (true);`

**Impact:**
- Any authenticated user can read/write ANY game, player, score, tournament record
- Leaderboards unreliable; tournament results untrustable; achievements gamifiable
- Affected: games, game_scores, players, player_achievements, tournaments, shanghai_events, game_action_log

**Fix:** Add `auth.uid()` checks to policies; implement tournament ownership/validation; sign game results

### 4.2 Anon Key Exposure
**File:** `.env.local`

- Supabase anon key and VAPID keys committed to repo
- Standard practice: rotate regularly; monitor for unusual query patterns

---

## 5. Performance Concerns

### 5.1 Large Bundle Sizes
**Dist Assets:**
- index-*.js: 483 KB
- recharts-*.js: 513 KB (very large for basic line charts)
- xlsx-*.js: 415 KB
- supabase-*.js: 172 KB
- **Total ~1.6 MB uncompressed, ~400 KB gzipped**

**Fix:** Code-split analytics (recharts only there); lazy-load Excel export; use lighter charting library

### 5.2 Game State in GameBoard Closures
**File:** `src/components/play/GameBoard.tsx` lines 1000–1100

- Multiple refs (freeOfferDeclinedRef, pendingBuyDiscardRef) to handle React 18 concurrent mode stale closures
- **Risk:** Double-processing of actions; race conditions in buying window; difficult debugging

### 5.3 AI Performance in aiChooseDiscard
**File:** `src/game/ai.ts`

- O(n * m) discard evaluation with no caching
- Expensive during training when called every turn × players × rounds

---

## 6. Fragile Coupling: TypeScript Engine ↔ Python ML Bridge

### 6.1 State Encoding Contract
**Bridge Location:** `ml/bridge/game-bridge.ts`

**Multiple incompatible formats:**
- encodeState() — 170-dim basic
- encodeRichState() — extended
- encodeRichStateV2() — opponent raw separate
- encodeRichStateV3() — + meldPlan (30) + oppActionsSinceLast (18)

**Fragility:**
- State dimension must match exactly (lines 1224–1226 select encoding by flag)
- Python value_labeler.py assumes state_vec[159:166] is round one-hot (value_labeler.py line 56)
- **If state dimensions change, labeler silently uses wrong round indices**
- No automated contract testing

### 6.2 Output Names Contract
**File:** `ml/pimc/alphazero/export.py` line 36

Hardcoded: `OUTPUT_NAMES = ["discard_logits", "draw_logits", "buy_logit", "laydown_logit", "value"]`

- Web app inference expects exact names
- If architecture changes, model becomes incompatible
- No version negotiation

---

## 7. Missing Error Boundaries & Unhandled Edge Cases

### 7.1 ErrorBoundary Only at App Root
**File:** `src/components/ErrorBoundary.tsx`

- Single error boundary wraps entire app
- If GameBoard throws, entire app resets
- **No granular error recovery**

### 7.2 Async Errors in GameBoard Not Caught
**File:** `src/components/play/GameBoard.tsx`

- DB operations have `.catch(console.error)`
- Multiplayer rejected actions might not retry
- Network errors during buying window leave UI inconsistent

### 7.3 No Timeout / Stalemate Detection
**File:** `src/components/play/GameBoard.tsx` line 122

- turnCount tracked but enforcement not visible
- **Game can hang forever if logic enters infinite draw-buy loop**

### 7.4 Multiplayer State Desync Unrecoverable
- Host crash during turn → remote players hang forever
- No heartbeat recovery or reconnection resync
- Buying window timeouts hardcoded

---

## 8. Type Safety Issues

### 8.1 Unknown in Multiplayer Types
**File:** `src/game/multiplayer-types.ts` line 15

`game_state_snapshot?: unknown` — no type validation; schema drift undetected

### 8.2 Record<string, unknown> in Opponent Model
**File:** `src/game/opponent-model.ts`

`action_data: Record<string, unknown>` — impossible to type-check action fields

### 8.3 Loose Type Defaults in UI
- Phase state unions without exhaustive checks
- Possible undefined/typo'd phase states

---

## 9. Test Coverage Gaps

### 9.1 No Integration Tests for Complete Round Flow
**File:** `src/game/__tests__/`

- Meld-validator, scoring, deck tests exist (1454 total)
- **Missing:** complete round flow (draw → action → buy → round-end)
- **Missing:** AI decision logic integration

### 9.2 No Tests for GameBoard State Machine
- Phase transitions (draw → action → buying → round-end) untested
- Multiplayer sync untested
- Buying window race conditions untested

### 9.3 No Contract Tests (TS ↔ Python)
- Python tests use synthetic data
- No validation that Python decoder handles all TS game states
- No round-trip validation (Python trajectories → TS bridge)

---

## 10. Other Technical Debt

### 10.1 Opponent Model Persistence
**File:** `src/game/opponent-model.ts`

- Models stored in localStorage by name
- Name change (typo fix) → model orphaned forever
- No migration/cleanup

### 10.2 Incomplete Docstrings on Critical Paths
**File:** `src/game/ai.ts`

- Helper functions have minimal docs
- Complex heuristics unexplained
- New developers cannot understand design decisions

### 10.3 Hardcoded Constants in ML Pipeline
**Files:** value_labeler.py, game-bridge.ts

- Round one-hot at [159:166]
- Card encoding (6 features) hardcoded
- No configuration or versioning

### 10.4 No AI Quality Telemetry
**Database:** ai_decisions table lacks A/B testing framework

- No systematic personality variant comparison
- No decision confidence logging
- Hard to detect rule change impact

### 10.5 Deprecated Game Type Handling
**File:** CLAUDE.md line 119

`game_type` can be NULL for backward compatibility

- Query logic must handle; easy to forget edge case

---

## 11. Build & Deployment Concerns

### 11.1 No Pre-Commit Hooks Visible
- No linting enforcement before commit
- TypeScript types may not validate in CI

### 11.2 No Documented Deployment Process
- How is ML model updated on web app?
- How are ONNX exports tested before deploy?
- If Python training breaks contract → undetected

---

## Summary: Priority Items

**CRITICAL (Must Fix Before Production):**
1. RLS policies (game spoofing possible)
2. GameBoard refactoring (maintenance blocker)
3. TS ↔ Python contract testing
4. Timeout/stalemate detection

**HIGH (Fix Soon):**
5. Bundle size optimization
6. Multiplayer reconnection logic
7. AI decision logging for testing

**MEDIUM (Nice to Have):**
8. Granular error boundaries
9. Opponent model cleanup
10. Formal state encoding versioning
