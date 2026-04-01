# Multiplayer Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring online multiplayer to full production quality — matching host UI, fixing action dispatch, adding robust connection infrastructure, and enforcing strict turn control.

**Architecture:** Host-authoritative model over Supabase Realtime Broadcast. Host runs GameBoard with `mode='host'`, remote players run RemoteGameBoard receiving sanitized `RemoteGameView` per state change. This overhaul: (1) rewrites RemoteGameBoard to reuse GameBoard's visual components for pixel-perfect parity, (2) adds heartbeat/ACK/disconnection infrastructure to `useMultiplayerChannel`, (3) fixes action dispatch for draw/discard/take flows, (4) enforces strict turn locking on remote clients.

**Tech Stack:** React 18, TypeScript 5, Supabase Realtime Broadcast, existing game engine components

---

## File Map

### Files to Create
- `src/multiplayer/useHeartbeat.ts` — Heartbeat send/receive hook for host + client connection monitoring
- `src/multiplayer/useActionAck.ts` — Action ACK tracking hook: pending states, timeout retries

### Files to Modify
- `src/components/play/RemoteGameBoard.tsx` — **Major rewrite**: integrate RoundAnnouncement, BuyingCinematic, GameToast, TableMelds styling, felt colors, going-out cinematic, final-card drama, turn locking
- `src/game/multiplayer-types.ts` — Add HeartbeatPayload, ActionAck, DisconnectionState types; extend RemoteGameView with new cinematic fields
- `src/game/multiplayer-host.ts` — Add heartbeat tracking, disconnection detection, turn-skip logic, game_start broadcast
- `src/game/multiplayer-client.ts` — Add ACK handling, heartbeat sending, retry logic
- `src/hooks/useMultiplayerChannel.ts` — Add heartbeat interval, ACK event routing, connection quality tracking
- `src/components/play/GameBoard.tsx` — Fix host privacy, add game_start broadcast on mount, add disconnection turn-skip timer, fix buy timeout implementation
- `src/components/play/PlayTab.tsx` — Thread game_start config to remote players

### Existing Components Reused (no changes needed)
- `src/components/play/RoundAnnouncement.tsx`
- `src/components/play/BuyingCinematic.tsx` (BuyBottomSheet, FreeTakeBottomSheet)
- `src/components/play/GameToast.tsx`
- `src/components/play/Card.tsx`
- `src/components/play/HandDisplay.tsx`
- `src/components/play/TableMelds.tsx`
- `src/components/play/MeldBuilder.tsx`

---

## Task 1: Extend Multiplayer Types

**Files:**
- Modify: `src/game/multiplayer-types.ts`

- [ ] **Step 1: Add infrastructure types**

Add these types to the existing file after the existing type definitions:

```typescript
// ── Connection Infrastructure ────────────────────────────────────────

export interface HeartbeatPayload {
  seatIndex: number
  timestamp: number
}

export interface ActionAck {
  actionId: string
  ok: boolean
  error?: string
}

export interface PendingAction {
  id: string
  action: PlayerAction
  sentAt: number
  retries: number
}

export interface PlayerConnectionState {
  seatIndex: number
  lastHeartbeat: number
  isConnected: boolean
  missedBeats: number
}
```

- [ ] **Step 2: Extend RemoteGameView with cinematic fields**

Add these fields to the `RemoteGameView` interface:

```typescript
// Add to existing RemoteGameView interface:
  // Cinematic sync
  perfectDraw?: boolean           // "Ready to lay down!" indicator
  shimmerCardId?: string | null   // Gold shimmer on drawn card
  isOnTheEdge?: boolean           // Final card drama state
  feltColor?: string              // Current round felt color (with tension adjustment)
  // Buying cinematic sync
  buyingCinematicPhase?: 'hidden' | 'reveal' | 'free-offer' | 'ai-deciding' | 'human-turn' | 'snatched' | 'unclaimed'
  buyingSnatcherName?: string | null
  // Round announcement sync
  announcementData?: {
    stage: string
    standings?: Array<{ name: string; total: number; delta?: number }>
    dealerName?: string
    firstPlayerName?: string
  }
  // Disconnection info
  disconnectedPlayers?: number[]  // seat indices of disconnected players
  turnTimeRemaining?: number      // seconds left for current player's turn
```

- [ ] **Step 3: Add new channel event types**

Extend the ChannelMessage union:

```typescript
// Add to ChannelMessage union:
  | { event: 'action_ack'; payload: ActionAck & { seatIndex: number } }
  | { event: 'heartbeat'; payload: HeartbeatPayload }
  | { event: 'player_disconnected'; payload: { seatIndex: number; playerName: string } }
  | { event: 'turn_skipped'; payload: { seatIndex: number; reason: 'timeout' | 'disconnected' } }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/game/multiplayer-types.ts
git commit -m "feat(multiplayer): extend types for heartbeat, ACK, and cinematic sync"
```

---

## Task 2: Heartbeat System

**Files:**
- Create: `src/multiplayer/useHeartbeat.ts`
- Modify: `src/hooks/useMultiplayerChannel.ts`

- [ ] **Step 1: Create useHeartbeat hook**

```typescript
// src/multiplayer/useHeartbeat.ts
import { useEffect, useRef, useCallback } from 'react'
import type { PlayerConnectionState } from '../game/multiplayer-types'

const HEARTBEAT_INTERVAL = 3000   // Send every 3s
const HEARTBEAT_TIMEOUT = 10000   // Mark disconnected after 10s (3 missed beats)
const MAX_MISSED_BEATS = 3

interface UseHeartbeatOptions {
  seatIndex: number
  isHost: boolean
  broadcast: (event: string, payload: Record<string, unknown>) => void
  onMessage: (event: string, handler: (payload: any) => void) => () => void
  isConnected: boolean
  remoteSeatIndices: number[]
  onPlayerDisconnected?: (seatIndex: number) => void
  onPlayerReconnected?: (seatIndex: number) => void
}

export function useHeartbeat({
  seatIndex,
  isHost,
  broadcast,
  onMessage,
  isConnected,
  remoteSeatIndices,
  onPlayerDisconnected,
  onPlayerReconnected,
}: UseHeartbeatOptions) {
  const connectionsRef = useRef<Map<number, PlayerConnectionState>>(new Map())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Everyone sends heartbeats
  useEffect(() => {
    if (!isConnected) return
    intervalRef.current = setInterval(() => {
      broadcast('heartbeat', { seatIndex, timestamp: Date.now() })
    }, HEARTBEAT_INTERVAL)
    // Send one immediately
    broadcast('heartbeat', { seatIndex, timestamp: Date.now() })
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isConnected, seatIndex, broadcast])

  // Host monitors remote heartbeats
  useEffect(() => {
    if (!isHost) return

    // Initialize connection states for remote players
    const now = Date.now()
    for (const idx of remoteSeatIndices) {
      if (!connectionsRef.current.has(idx)) {
        connectionsRef.current.set(idx, {
          seatIndex: idx,
          lastHeartbeat: now,
          isConnected: true,
          missedBeats: 0,
        })
      }
    }

    return onMessage('heartbeat', (payload: { seatIndex: number; timestamp: number }) => {
      const state = connectionsRef.current.get(payload.seatIndex)
      if (!state) return
      const wasDisconnected = !state.isConnected
      state.lastHeartbeat = payload.timestamp
      state.missedBeats = 0
      state.isConnected = true
      if (wasDisconnected) {
        onPlayerReconnected?.(payload.seatIndex)
      }
    })
  }, [isHost, remoteSeatIndices, onMessage, onPlayerReconnected])

  // Host checks for stale connections
  useEffect(() => {
    if (!isHost) return
    checkIntervalRef.current = setInterval(() => {
      const now = Date.now()
      for (const [idx, state] of connectionsRef.current.entries()) {
        if (now - state.lastHeartbeat > HEARTBEAT_TIMEOUT && state.isConnected) {
          state.missedBeats++
          if (state.missedBeats >= MAX_MISSED_BEATS) {
            state.isConnected = false
            onPlayerDisconnected?.(idx)
          }
        }
      }
    }, HEARTBEAT_INTERVAL)
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
    }
  }, [isHost, onPlayerDisconnected])

  const getConnectionStates = useCallback(() => {
    return new Map(connectionsRef.current)
  }, [])

  const getDisconnectedPlayers = useCallback((): number[] => {
    const disconnected: number[] = []
    for (const [idx, state] of connectionsRef.current.entries()) {
      if (!state.isConnected) disconnected.push(idx)
    }
    return disconnected
  }, [])

  return { getConnectionStates, getDisconnectedPlayers }
}
```

- [ ] **Step 2: Add 'heartbeat' to KNOWN_EVENTS in useMultiplayerChannel**

In `src/hooks/useMultiplayerChannel.ts`, the KNOWN_EVENTS array already includes 'heartbeat'. Verify this. If not, add it.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/useHeartbeat.ts src/hooks/useMultiplayerChannel.ts
git commit -m "feat(multiplayer): add heartbeat system for connection monitoring"
```

---

## Task 3: Action ACK System

**Files:**
- Create: `src/multiplayer/useActionAck.ts`
- Modify: `src/game/multiplayer-client.ts`

- [ ] **Step 1: Create useActionAck hook**

```typescript
// src/multiplayer/useActionAck.ts
import { useState, useRef, useCallback, useEffect } from 'react'
import type { PlayerAction, PendingAction } from '../game/multiplayer-types'

const ACK_TIMEOUT = 5000    // Wait 5s for ACK
const MAX_RETRIES = 2

interface UseActionAckOptions {
  seatIndex: number
  broadcast: (event: string, payload: Record<string, unknown>) => void
  onMessage: (event: string, handler: (payload: any) => void) => () => void
}

export function useActionAck({ seatIndex, broadcast, onMessage }: UseActionAckOptions) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PendingAction | null>(null)

  // Listen for ACKs
  useEffect(() => {
    return onMessage('action_ack', (payload: { seatIndex: number; actionId: string; ok: boolean; error?: string }) => {
      if (payload.seatIndex !== seatIndex) return
      const pending = pendingRef.current
      if (!pending || pending.id !== payload.actionId) return

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      pendingRef.current = null
      setPendingAction(null)

      if (!payload.ok) {
        setLastError(payload.error ?? 'Action rejected')
        // Clear error after 3s
        setTimeout(() => setLastError(null), 3000)
      }
    })
  }, [seatIndex, onMessage])

  const sendWithAck = useCallback((action: PlayerAction) => {
    const id = `${seatIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const pending: PendingAction = { id, action, sentAt: Date.now(), retries: 0 }
    pendingRef.current = pending
    setPendingAction(pending)
    setLastError(null)

    broadcast('player_action', { seatIndex, action: { ...action, actionId: id } })

    // Retry on timeout
    const scheduleTimeout = (p: PendingAction) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        if (pendingRef.current?.id !== p.id) return
        if (p.retries < MAX_RETRIES) {
          const retried = { ...p, retries: p.retries + 1, sentAt: Date.now() }
          pendingRef.current = retried
          setPendingAction(retried)
          broadcast('player_action', { seatIndex, action: { ...action, actionId: p.id } })
          scheduleTimeout(retried)
        } else {
          // Give up
          pendingRef.current = null
          setPendingAction(null)
          setLastError('Connection lost — action may not have been received')
          setTimeout(() => setLastError(null), 5000)
        }
      }, ACK_TIMEOUT)
    }
    scheduleTimeout(pending)
  }, [seatIndex, broadcast])

  const clearPending = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    pendingRef.current = null
    setPendingAction(null)
  }, [])

  return {
    sendWithAck,
    pendingAction,
    isPending: pendingAction !== null,
    lastError,
    clearPending,
  }
}
```

- [ ] **Step 2: Update multiplayer-client.ts to support actionId**

Replace the entire file:

```typescript
// src/game/multiplayer-client.ts
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { PlayerAction } from './multiplayer-types'

/**
 * Send a player action to the host via broadcast.
 * Used by useActionAck for ACK-tracked sends, and as a fallback for simple sends.
 */
export function sendAction(
  channel: RealtimeChannel,
  seatIndex: number,
  action: PlayerAction,
): void {
  channel.send({
    type: 'broadcast',
    event: 'player_action',
    payload: { seatIndex, action },
  })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/useActionAck.ts src/game/multiplayer-client.ts
git commit -m "feat(multiplayer): add action ACK system with retry logic"
```

---

## Task 4: Host Infrastructure — Game Start, Disconnection Handling, ACK Sending, Privacy Fix

**Files:**
- Modify: `src/components/play/GameBoard.tsx`
- Modify: `src/game/multiplayer-host.ts`

- [ ] **Step 1: Add game_start broadcast on mount**

In GameBoard.tsx, add a new useEffect after the channel initialization (around line 673):

```typescript
// ── Host: broadcast game_start when game initializes ──────────────────
useEffect(() => {
  if (mode !== 'host' || !mpChannel.isConnected) return
  // Broadcast initial game config to all remote players
  mpChannel.broadcast('game_start', {
    playerNames: gameState.players.map(p => p.name),
    playerCount: gameState.players.length,
    currentRound: gameState.currentRound,
    buyLimit,
    hostSeatIndex,
    remoteSeatIndices,
  })
}, [mode, mpChannel.isConnected]) // Only on initial connection
```

- [ ] **Step 2: Integrate heartbeat into GameBoard host**

In GameBoard.tsx, import and wire up the heartbeat hook:

```typescript
import { useHeartbeat } from '../../multiplayer/useHeartbeat'

// Inside GameBoard component, after mpChannel:
const disconnectedPlayersRef = useRef<Set<number>>(new Set())

const { getDisconnectedPlayers } = useHeartbeat({
  seatIndex: hostSeatIndex ?? 0,
  isHost: mode === 'host',
  broadcast: mpChannel.broadcast,
  onMessage: mpChannel.onMessage,
  isConnected: mpChannel.isConnected,
  remoteSeatIndices: remoteSeatIndices ?? [],
  onPlayerDisconnected: (seat) => {
    disconnectedPlayersRef.current.add(seat)
    mpChannel.broadcast('player_disconnected', {
      seatIndex: seat,
      playerName: gameState.players[seat]?.name ?? 'Unknown',
    })
  },
  onPlayerReconnected: (seat) => {
    disconnectedPlayersRef.current.delete(seat)
    // Re-broadcast state (existing reconnection handler covers this)
  },
})
```

- [ ] **Step 3: Add disconnected player turn-skip timer**

In GameBoard.tsx, add a new useEffect for auto-skipping disconnected players' turns:

```typescript
// ── Host: auto-skip disconnected player turns ─────────────────────────
const turnSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
useEffect(() => {
  if (mode !== 'host') return
  if (turnSkipTimerRef.current) clearTimeout(turnSkipTimerRef.current)

  const currentIdx = gameState.currentPlayerIndex
  if (!remoteSeatIndices?.includes(currentIdx)) return
  if (!disconnectedPlayersRef.current.has(currentIdx)) return

  // Disconnected player's turn — auto-skip after 15 seconds
  turnSkipTimerRef.current = setTimeout(() => {
    if (disconnectedPlayersRef.current.has(currentIdx)) {
      // Force a draw from pile + discard highest card
      const player = gameState.players[currentIdx]
      if (player && uiPhase === 'draw') {
        handleDrawFromPile()
        // After draw, auto-discard highest point card
        setTimeout(() => {
          const highest = [...player.hand].sort((a, b) => cardPoints(b.rank) - cardPoints(a.rank))[0]
          if (highest) handleDiscard(highest.id)
        }, 500)
      }
      mpChannel.broadcast('turn_skipped', { seatIndex: currentIdx, reason: 'disconnected' })
    }
  }, 15000)

  return () => {
    if (turnSkipTimerRef.current) clearTimeout(turnSkipTimerRef.current)
  }
}, [mode, gameState.currentPlayerIndex, uiPhase])
```

- [ ] **Step 4: Send ACKs after processing remote actions**

In GameBoard.tsx, modify the player_action handler to send ACKs:

```typescript
// Replace the existing player_action handler (lines ~716-739):
return mpChannel.onMessage('player_action', (payload: { seatIndex: number; action: PlayerAction & { actionId?: string } }) => {
  if (!remoteSeatIndices?.includes(payload.seatIndex)) return
  const actionId = payload.action.actionId
  const result = mapActionToHandler(
    payload.action,
    payload.seatIndex,
    gameStateRef.current,
    {
      handleDrawFromPile,
      handleTakeDiscard,
      handleDeclineFreeOffer,
      handleMeldConfirm,
      handleLayOff,
      handleJokerSwap,
      handleDiscard,
      handleBuyDecision,
    },
  )
  // Send ACK back to the player
  if (actionId) {
    mpChannel.broadcast('action_ack', {
      seatIndex: payload.seatIndex,
      actionId,
      ok: result.ok,
      error: result.ok ? undefined : (result.error ?? 'Invalid action'),
    })
  }
  if (!result.ok) {
    mpChannel.broadcast('action_rejected', { seatIndex: payload.seatIndex, reason: result.error ?? 'Invalid action' })
  }
})
```

- [ ] **Step 5: Fix host privacy — host player sees privacy screens like everyone else**

In GameBoard.tsx, find the `nextPhaseForPlayer` function (around line 662-669) and fix the host mode logic:

```typescript
// Replace the host mode privacy skip:
if (mode === 'host') {
  // Remote humans skip privacy (they have their own device)
  // But the HOST player still gets privacy screens in pass-and-play-style local view
  // Actually in host mode, the host is the only local player, so skip privacy for them too
  // since there's no one looking over their shoulder
  if (remoteSeatIndices?.includes(playerIdx)) return 'draw'
  // Host player: no privacy screen needed (they're the only local player)
  return 'draw'
}
```

Actually, since in host mode the host is the only person on this device, privacy screens are unnecessary. The current code is correct. The fairness issue is about the host being able to see the UI phase transition, which is inherent to being the host. No change needed here.

- [ ] **Step 6: Include disconnected players and cinematic data in state broadcasts**

In the broadcast useEffect (around line 673-713), add disconnected players info to the sanitize call:

```typescript
// In the sanitizeGameViewForPlayer call, add:
disconnectedPlayers: [...disconnectedPlayersRef.current],
feltColor: feltBg,  // pass the computed felt color
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 8: Commit**

```bash
git add src/components/play/GameBoard.tsx src/game/multiplayer-host.ts
git commit -m "feat(multiplayer): add game_start broadcast, heartbeat integration, disconnection handling, ACKs"
```

---

## Task 5: Sanitize Extended Game View

**Files:**
- Modify: `src/game/multiplayer-host.ts`

- [ ] **Step 1: Extend sanitizeGameViewForPlayer to include new fields**

Add the new cinematic/infrastructure fields to the sanitization output. In the function's options parameter, add:

```typescript
// Add to the options parameter of sanitizeGameViewForPlayer:
  disconnectedPlayers?: number[]
  feltColor?: string
  perfectDraw?: boolean
  shimmerCardId?: string | null
```

And in the return object, add:

```typescript
  disconnectedPlayers: options.disconnectedPlayers ?? [],
  feltColor: options.feltColor,
  perfectDraw: options.perfectDraw,
  shimmerCardId: options.shimmerCardId,
  isOnTheEdge: targetPlayer.hasLaidDown && targetPlayer.hand.length <= 2 && targetPlayer.hand.length > 0,
  buyingCinematicPhase: options.buyingState?.buyingPhase ?? 'hidden',
  buyingSnatcherName: options.buyingState?.snatcherName ?? null,
  announcementData: options.announcementStage ? {
    stage: options.announcementStage,
    standings: options.standings,
    dealerName: options.dealerName,
    firstPlayerName: options.firstPlayerName,
  } : undefined,
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/game/multiplayer-host.ts
git commit -m "feat(multiplayer): extend sanitized view with cinematic and infrastructure data"
```

---

## Task 6: RemoteGameBoard — Full UI Parity Rewrite

**Files:**
- Modify: `src/components/play/RemoteGameBoard.tsx`

This is the largest task. The goal is to make RemoteGameBoard visually identical to GameBoard by reusing the same components and matching all animations/transitions/cinematics.

- [ ] **Step 1: Add imports for shared components and hooks**

Add at top of RemoteGameBoard.tsx:

```typescript
import RoundAnnouncement from './RoundAnnouncement'
import { BuyBottomSheet, FreeTakeBottomSheet, BuyingCinematic as BuyingCinematicOverlay } from './BuyingCinematic'
import GameToast from './GameToast'
import { useHeartbeat } from '../../multiplayer/useHeartbeat'
import { useActionAck } from '../../multiplayer/useActionAck'
```

- [ ] **Step 2: Replace round announcement with real RoundAnnouncement component**

Replace the simplified round announcement (the `if (view.announcementStage && uiPhase === 'round-start')` block) with the actual `RoundAnnouncement` component that GameBoard uses. Pass the announcement data from the view:

```typescript
if (view.announcementData && uiPhase === 'round-start') {
  return (
    <RoundAnnouncement
      roundNumber={currentRound}
      requirement={requirement}
      stage={view.announcementData.stage}
      standings={view.announcementData.standings}
      dealerName={view.announcementData.dealerName}
      firstPlayerName={view.announcementData.firstPlayerName}
      playerCount={allPlayers.length}
    />
  )
}
```

Note: RoundAnnouncement is self-contained and handles its own animations/staging. If it requires props that RemoteGameView doesn't have, fall back to the existing simplified version. Check RoundAnnouncement props interface first.

- [ ] **Step 3: Replace going-out cinematic with full cinematic matching GameBoard**

Replace the simplified going-out flash/announce blocks with the full cinematic from GameBoard:

```typescript
{/* Going out — white impact flash */}
{showGoingOutFlash && (
  <div
    className="go-impact-flash"
    style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'white',
      pointerEvents: 'none',
    }}
  />
)}

{/* Going out — announce overlay */}
{showGoingOutAnnounce && view.goingOutPlayerName && (
  <div
    className="go-backdrop-fade"
    style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 4,
    }}
  >
    <span
      className="slam-in"
      style={{
        color: '#e2b858',
        fontSize: 32,
        fontWeight: 900,
        textShadow: '0 0 30px rgba(226,184,88,0.6)',
        letterSpacing: 2,
      }}
    >
      {view.goingOutPlayerName}
    </span>
    <span
      className="slam-in"
      style={{
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 700,
        animationDelay: '0.15s',
      }}
    >
      GOES OUT!
    </span>
  </div>
)}
```

- [ ] **Step 4: Replace inline toast with GameToast component**

Replace the custom toast rendering with the shared GameToast:

```typescript
{activeToast && (
  <GameToast
    message={activeToast.message}
    style={activeToast.style}
    icon={activeToast.icon}
  />
)}
```

Verify GameToast accepts these props. If the props don't match exactly, adapt the toast data transformation.

- [ ] **Step 5: Replace inline buying UI with BuyBottomSheet/FreeTakeBottomSheet**

Replace the inline free-offer and buy-offer blocks with the real cinematic components:

For buying overlay (non-human-turn phases):
```typescript
{buyingState && buyingState.buyingPhase !== 'hidden' && buyingState.buyingPhase !== 'human-turn' && (
  <BuyingCinematicOverlay
    phase={view.buyingCinematicPhase ?? 'hidden'}
    card={buyingState.buyingDiscard}
    snatcherName={view.buyingSnatcherName}
  />
)}
```

For human buy decision:
```typescript
{isBuyingMyTurn && buyingState && (
  <BuyBottomSheet
    card={buyingState.buyingDiscard}
    buysRemaining={view.myBuysRemaining}
    onBuy={() => send({ type: 'buy', wantsToBuy: true })}
    onPass={() => send({ type: 'buy', wantsToBuy: false })}
  />
)}
```

For free take:
```typescript
{hasFreeOffer && view.pendingFreeOffer && (
  <FreeTakeBottomSheet
    card={discardTop!}
    onTake={() => send({ type: 'take_discard' })}
    onPass={() => send({ type: 'decline_free_offer' })}
  />
)}
```

Check BuyingCinematic.tsx exports to confirm prop interfaces match.

- [ ] **Step 6: Match the top bar to GameBoard's design**

Replace the top bar with GameBoard's Zone 1 design, including the connection indicator, round badge, and requirement badge with identical sizing and styling.

- [ ] **Step 7: Match opponent strip to GameBoard's Zone 2**

Update the opponent strip to match GameBoard's player card design — same sizing, borders, current-turn highlighting, gold dot indicator, hand size display, and "DOWN" badge.

- [ ] **Step 8: Match draw/discard piles to GameBoard's Zone 3**

Update pile rendering to match GameBoard's card-back pattern, pile sizing, labels, and animations (ready-pulse when active).

- [ ] **Step 9: Add felt color from host and tension-adjusted background**

Use the `feltColor` from RemoteGameView instead of computing locally:

```typescript
const feltBg = view.feltColor ?? feltColors[(currentRound - 1) % feltColors.length]
```

- [ ] **Step 10: Add final card drama matching GameBoard**

Add the vignette spotlight and edge glow when player has 1-2 cards and has laid down:

```typescript
{view.isOnTheEdge && (
  <div style={{
    position: 'fixed',
    inset: 0,
    background: 'radial-gradient(ellipse at center bottom, transparent 30%, rgba(0,0,0,0.4) 100%)',
    pointerEvents: 'none',
    zIndex: 5,
  }} />
)}
```

And thread `edgeGlow` prop to Card components when `isOnTheEdge`.

- [ ] **Step 11: Add action pending indicator**

Wire up the ACK hook and show a subtle pending state:

```typescript
const { sendWithAck, isPending, lastError } = useActionAck({
  seatIndex: mySeatIndex,
  broadcast: mpChannel.broadcast,
  onMessage: mpChannel.onMessage,
})

// Replace all `send()` calls with `sendWithAck()` — the hook handles retries and error display

// Show pending indicator:
{isPending && (
  <div style={{
    position: 'fixed', bottom: 'max(100px, env(safe-area-inset-bottom, 12px) + 88px)',
    left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(15,34,24,0.9)',
    border: '1px solid #2d5a3a',
    borderRadius: 20,
    padding: '6px 16px',
    color: '#a8d0a8',
    fontSize: 11,
    zIndex: 30,
    animation: 'ready-pulse 1.5s ease-in-out infinite',
  }}>
    Sending...
  </div>
)}

// Show error toast:
{lastError && (
  <div style={{
    position: 'fixed', top: 'max(60px, env(safe-area-inset-top, 44px) + 16px)',
    left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(184,50,50,0.9)',
    borderRadius: 10,
    padding: '8px 16px',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 600,
    zIndex: 40,
  }}>
    {lastError}
  </div>
)}
```

- [ ] **Step 12: Add disconnected player indicators**

Show disconnected badges on opponent cards and a banner if someone is disconnected:

```typescript
// In the opponent strip, add to each player card:
{view.disconnectedPlayers?.includes(p.seatIndex) && (
  <div style={{
    position: 'absolute', top: -3, left: -3,
    width: 8, height: 8, borderRadius: '50%',
    background: '#e07a5f',
    boxShadow: '0 0 4px rgba(224,122,95,0.6)',
  }} />
)}
```

- [ ] **Step 13: Enforce strict turn locking — disable all interactions when not your turn**

Ensure all interactive elements (card taps, draw/discard buttons, action buttons, meld builder, table meld interactions) check `isMyTurn` before allowing any action:

```typescript
// Card taps — already checks isMyTurn in onToggle, but also disable during pending:
onToggle={(cardId: string) => {
  if (!isMyTurn || isPending) return
  // ... existing logic
}}

// Draw pile — already checks drawActive, which requires isMyTurn
// Discard pile — already checks discardActive

// Lay off / joker swap on table melds:
onLayOff={view.myHasLaidDown && isMyTurn && uiPhase === 'action' && !isPending ? ... : undefined}
onJokerSwap={view.myHasLaidDown && isMyTurn && uiPhase === 'action' && !isPending ? ... : undefined}

// Action buttons — already gated by isMyTurn && uiPhase === 'action'
// Buy buttons — gated by isBuyingMyTurn
```

Also add a visual "locked" state to the hand when it's not your turn:

```typescript
// In Zone 4, when not your turn, add slight opacity reduction:
<div style={{
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  padding: '0 8px',
  opacity: isMyTurn ? 1 : 0.7,
  transition: 'opacity 0.3s ease',
}}>
```

- [ ] **Step 14: Wire heartbeat into RemoteGameBoard**

```typescript
useHeartbeat({
  seatIndex: mySeatIndex,
  isHost: false,
  broadcast: mpChannel.broadcast,
  onMessage: mpChannel.onMessage,
  isConnected,
  remoteSeatIndices: [], // clients don't monitor others
})
```

- [ ] **Step 15: Add turn timer display**

Show a countdown when it's the current player's turn (especially for disconnected players):

```typescript
{view.turnTimeRemaining !== undefined && view.turnTimeRemaining <= 10 && (
  <div style={{
    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
    color: view.turnTimeRemaining <= 5 ? '#e07a5f' : '#a8d0a8',
    fontSize: 11,
    fontWeight: 700,
  }}>
    {view.turnTimeRemaining}s
  </div>
)}
```

- [ ] **Step 16: Match round-end screen to GameBoard's round summary**

Update the round-end UI to match GameBoard's round summary design — same card layout, Shanghai exposure animation (badge + card fan), score count-up.

- [ ] **Step 17: Match game-over screen to GameBoard's GameOver component**

Update the game-over screen to match GameBoard's end screen — same rank badges, winner highlight, total scores, and exit button styling.

- [ ] **Step 18: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 19: Commit**

```bash
git add src/components/play/RemoteGameBoard.tsx
git commit -m "feat(multiplayer): RemoteGameBoard full UI parity — shared components, cinematics, turn locking"
```

---

## Task 7: Fix Discard/Take Action Dispatch

**Files:**
- Modify: `src/game/multiplayer-host.ts` (mapActionToHandler)
- Modify: `src/components/play/RemoteGameBoard.tsx` (action sending)

- [ ] **Step 1: Audit mapActionToHandler for draw/discard/take flow**

Read the current `mapActionToHandler` function. Verify:
1. `draw_pile` action calls `handleDrawFromPile()` — should work for current player only
2. `take_discard` action calls `handleTakeDiscard()` — should work during draw phase AND free offer
3. `decline_free_offer` action calls `handleDeclineFreeOffer()` — should only work when free offer pending
4. `discard` action resolves cardId from hand and calls `handleDiscard(cardId)`

Known issue: The `take_discard` action validation may require the player to be the current player, but during free offer the current player IS the one with the offer. Verify this flow.

- [ ] **Step 2: Fix take_discard validation for free offer phase**

In `mapActionToHandler`, ensure `take_discard` works in both:
1. Regular draw phase (current player takes discard instead of drawing)
2. Free offer phase (current player accepts the free offer)

The validation should check that the player IS the current player (both cases are current player):

```typescript
case 'take_discard': {
  if (gameState.currentPlayerIndex !== seatIndex) {
    return { ok: false, error: 'Not your turn' }
  }
  handlers.handleTakeDiscard()
  return { ok: true }
}
```

- [ ] **Step 3: Fix decline_free_offer validation**

Ensure decline only works when a free offer is actually pending for the current player:

```typescript
case 'decline_free_offer': {
  if (gameState.currentPlayerIndex !== seatIndex) {
    return { ok: false, error: 'Not your turn' }
  }
  handlers.handleDeclineFreeOffer()
  return { ok: true }
}
```

- [ ] **Step 4: Fix discard action — ensure card exists in player's hand**

The discard action needs to resolve the card ID from the player's actual hand:

```typescript
case 'discard': {
  if (gameState.currentPlayerIndex !== seatIndex) {
    return { ok: false, error: 'Not your turn' }
  }
  const player = gameState.players[seatIndex]
  const card = player.hand.find(c => c.id === action.cardId)
  if (!card) {
    return { ok: false, error: 'Card not in hand' }
  }
  handlers.handleDiscard(action.cardId)
  return { ok: true }
}
```

- [ ] **Step 5: Fix buy action — must NOT require current player turn**

Buy actions come from non-current players. Verify:

```typescript
case 'buy': {
  // Buy actions are from non-current players — no turn check
  handlers.handleBuyDecision(action.wantsToBuy)
  return { ok: true }
}
```

- [ ] **Step 6: Verify RemoteGameBoard sends correct action payloads**

Audit all `send()` calls in RemoteGameBoard to ensure they match the action types expected by mapActionToHandler:

- Draw: `send({ type: 'draw_pile' })` ✓
- Take discard: `send({ type: 'take_discard' })` ✓
- Decline free offer: `send({ type: 'decline_free_offer' })` ✓
- Discard: `send({ type: 'discard', cardId: selectedCardId })` ✓
- Meld: `send({ type: 'meld_confirm', meldCardIds: [...], jokerPositions: {...} })` ✓
- Lay off: `send({ type: 'lay_off', cardId: card.id, meldId: meld.id })` ✓
- Joker swap: `send({ type: 'joker_swap', cardId: card.id, meldId: meld.id })` ✓
- Buy: `send({ type: 'buy', wantsToBuy: true/false })` ✓

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 8: Commit**

```bash
git add src/game/multiplayer-host.ts src/components/play/RemoteGameBoard.tsx
git commit -m "fix(multiplayer): fix draw/discard/take action dispatch and validation"
```

---

## Task 8: Integration Testing — Manual Verification

- [ ] **Step 1: Build and verify no errors**

Run: `npm run build`

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`

- [ ] **Step 3: Start dev server and test multiplayer flow**

1. Open two browser tabs
2. Tab 1: Start online game as host → create room
3. Tab 2: Join room with code
4. Verify: Both tabs show same round announcement
5. Verify: Turn indicator clearly shows whose turn it is
6. Verify: Non-active player cannot interact with cards/piles
7. Verify: Draw from pile works for remote player
8. Verify: Take discard works for remote player
9. Verify: Discard works for remote player
10. Verify: Buy/pass works during buying window
11. Verify: Going-out cinematic plays on both screens
12. Verify: Round transitions happen simultaneously
13. Verify: Disconnection is detected (close tab, reopen)

- [ ] **Step 4: Final commit with any fixes from testing**

```bash
git add -A
git commit -m "fix(multiplayer): integration fixes from manual testing"
```

---

## Execution Notes

- Tasks 1-5 are infrastructure and can be done in sequence (each builds on the prior)
- Task 6 (RemoteGameBoard rewrite) is the largest and depends on Tasks 1-5
- Task 7 (action dispatch fixes) can be done in parallel with Task 6
- Task 8 (integration testing) must be last
- When reusing GameBoard components (RoundAnnouncement, BuyingCinematic, etc.), check their prop interfaces before wiring them up. If a component requires state that RemoteGameBoard doesn't have, either thread the data through RemoteGameView or use a simplified fallback.
