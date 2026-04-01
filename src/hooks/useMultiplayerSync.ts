import { useState, useEffect, useRef } from 'react'
import type { GameState, Card as CardType, Meld } from '../game/types'
import type { PlayerAction, EmotePayload } from '../game/multiplayer-types'
import type { BuyingPhase } from '../components/play/BuyingCinematic'
import type { AnnouncementStage } from '../components/play/RoundAnnouncement'
import { useMultiplayerChannel } from './useMultiplayerChannel'
import { useHeartbeat } from '../multiplayer/useHeartbeat'
import { sanitizeGameViewForPlayer, mapActionToHandler } from '../game/multiplayer-host'
import { saveGameStateSnapshot } from '../lib/gameStore'
import { notifyTurn } from '../lib/notifications'
import { cardPoints } from '../game/rules'
import { EMOTE_MAP } from '../components/play/EmoteBar'

// ── Types ────────────────────────────────────────────────────────────────────

export interface UseMultiplayerSyncOptions {
  mode: 'local' | 'host'
  roomCode?: string
  hostSeatIndex: number
  remoteSeatIndices: number[]
  // Refs to current game state (for reading in callbacks without stale closures)
  gameStateRef: React.MutableRefObject<GameState>
  uiPhaseRef: React.MutableRefObject<string>
  buyingPhaseRef: React.MutableRefObject<BuyingPhase>
  buyerOrderRef: React.MutableRefObject<number[]>
  buyerStepRef: React.MutableRefObject<number>
  pendingBuyDiscardRef: React.MutableRefObject<CardType | null>
  // Values that trigger re-broadcast
  gameState: GameState
  uiPhase: string
  buyingPhase: BuyingPhase
  buyerStep: number
  buyerOrder: number[]
  buyingPassedPlayers: string[]
  buyingSnatcherName: string | undefined
  roundResults: { playerId: string; score: number; shanghaied: boolean }[] | null
  goingOutSequence: 'idle' | 'flash' | 'announce'
  goOutPlayerName: string
  announcementStage: AnnouncementStage | null
  remoteEvent: string | null
  remoteToast: { message: string; style: string; icon?: string } | null
  raceMessage: string
  shimmerCardId: string | null
  perfectDrawActive: boolean
  // Handlers that remote actions dispatch to
  handlers: {
    handleDrawFromPile: () => void
    handleTakeDiscard: () => void
    handleDeclineFreeOffer: () => void
    handleMeldConfirm: (groups: CardType[][], jokerPositions?: Map<string, number>) => void
    handleLayOff: (card: CardType, meld: Meld, jokerPosition?: 'low' | 'high') => void
    handleJokerSwap: (card: CardType, meld: Meld) => void
    handleDiscard: (cardId?: string) => void
    handleBuyDecision: (wantsToBuy: boolean) => void
  }
  // Callbacks
  setRemoteEvent: (e: string | null) => void
  setRemoteToast: (t: { message: string; style: string; icon?: string } | null) => void
  buyLimit: number
  buyingDiscard: CardType | null
  streaksRef: React.MutableRefObject<Map<string, number>>
}

export interface UseMultiplayerSyncReturn {
  mpChannel: ReturnType<typeof useMultiplayerChannel>
  activeEmotes: Map<number, string>
  handleEmoteSend: (emoteId: string) => void
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMultiplayerSync(opts: UseMultiplayerSyncOptions): UseMultiplayerSyncReturn {
  const {
    mode, roomCode, hostSeatIndex, remoteSeatIndices,
    gameStateRef, uiPhaseRef, buyingPhaseRef, buyerOrderRef, buyerStepRef, pendingBuyDiscardRef,
    gameState, uiPhase, buyingPhase, buyerStep, buyerOrder, buyingPassedPlayers, buyingSnatcherName,
    roundResults, goingOutSequence, goOutPlayerName, announcementStage,
    remoteEvent, remoteToast, raceMessage, shimmerCardId, perfectDrawActive,
    handlers, setRemoteEvent, setRemoteToast,
    buyLimit, buyingDiscard, streaksRef,
  } = opts

  // ── Channel ──────────────────────────────────────────────────────────────
  const mpChannel = useMultiplayerChannel(mode === 'host' ? roomCode ?? null : null)

  // ── Emote state ──────────────────────────────────────────────────────────
  const [activeEmotes, setActiveEmotes] = useState<Map<number, string>>(new Map())

  // ── Disconnection tracking ───────────────────────────────────────────────
  const disconnectedPlayersRef = useRef<Set<number>>(new Set())

  // ── Heartbeat ────────────────────────────────────────────────────────────
  // getDisconnectedPlayers available for future use (e.g. UI indicators)
  const { getDisconnectedPlayers: _getDisconnectedPlayers } = useHeartbeat({
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
    },
  })

  // ── Host: broadcast game_start when game initializes ─────────────────────
  useEffect(() => {
    if (mode !== 'host' || !mpChannel.isConnected) return
    mpChannel.broadcast('game_start', {
      playerNames: gameState.players.map(p => p.name),
      playerCount: gameState.players.length,
      currentRound: gameState.currentRound,
      buyLimit,
      hostSeatIndex,
      remoteSeatIndices,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mpChannel.isConnected])

  // ── Host: auto-skip disconnected player turns ────────────────────────────
  const turnSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnSkipStartRef = useRef<number | null>(null)
  useEffect(() => {
    if (mode !== 'host') return
    if (turnSkipTimerRef.current) clearTimeout(turnSkipTimerRef.current)
    turnSkipStartRef.current = null

    const currentIdx = gameState.roundState.currentPlayerIndex
    if (!remoteSeatIndices.includes(currentIdx)) return
    if (!disconnectedPlayersRef.current.has(currentIdx)) return

    // Disconnected player's turn — auto-skip after 15 seconds
    turnSkipStartRef.current = Date.now()
    turnSkipTimerRef.current = setTimeout(() => {
      if (disconnectedPlayersRef.current.has(currentIdx)) {
        if (uiPhaseRef.current === 'draw') {
          handlers.handleDrawFromPile()
          // After draw, auto-discard highest point card
          setTimeout(() => {
            const player = gameStateRef.current.players[currentIdx]
            if (player) {
              const highest = [...player.hand].sort((a, b) => cardPoints(b.rank) - cardPoints(a.rank))[0]
              if (highest) handlers.handleDiscard(highest.id)
            }
          }, 500)
        }
        mpChannel.broadcast('turn_skipped', { seatIndex: currentIdx, reason: 'disconnected' })
      }
    }, 15000)

    return () => {
      if (turnSkipTimerRef.current) clearTimeout(turnSkipTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gameState.roundState.currentPlayerIndex, uiPhase])

  // ── Broadcast sanitized state to all remote players after every relevant change ──
  // Throttled: at most one broadcast per 80ms to avoid hammering Supabase
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const broadcastPendingRef = useRef(false)
  useEffect(() => {
    if (mode !== 'host' || !mpChannel.isConnected) return

    const doBroadcast = () => {
      broadcastPendingRef.current = false
      // Build streak info from streaksRef
      let streakInfo: { playerName: string; streak: number } | null = null
      for (const [pid, streak] of streaksRef.current.entries()) {
        if (streak >= 2) {
          const p = gameStateRef.current.players.find(pl => pl.id === pid)
          if (p) streakInfo = { playerName: p.name, streak }
        }
      }
      // Compute felt color for broadcast
      const ROUND_FELT_MAP: Record<number, string> = {
        1: '#1a3a2a', 2: '#1a2f3a', 3: '#2a1a3a', 4: '#1a3a30',
        5: '#3a1a24', 6: '#1a2a3a', 7: '#2e2a1a',
      }
      const gs = gameStateRef.current
      const broadcastFeltColor = ROUND_FELT_MAP[gs.currentRound] ?? '#1a3a2a'

      for (const remoteSeat of remoteSeatIndices) {
        const view = sanitizeGameViewForPlayer({
          gameState: gs,
          uiPhase: uiPhaseRef.current,
          targetSeatIndex: remoteSeat,
          buyingState: buyingPhaseRef.current !== 'hidden' ? {
            buyingDiscard: buyingDiscard,
            buyerOrder: buyerOrderRef.current,
            buyerStep: buyerStepRef.current,
            buyingPhase: buyingPhaseRef.current,
            passedPlayers: buyingPassedPlayers,
            snatcherName: buyingSnatcherName,
          } : null,
          pendingFreeOffer: pendingBuyDiscardRef.current,
          roundResults: roundResults as any,
          goingOutPlayerName: goOutPlayerName,
          goingOutSequence,
          announcementStage,
          gameOver: gs.gameOver,
          toast: remoteToast,
          lastEvent: remoteEvent ?? undefined,
          raceMessage: raceMessage || undefined,
          streakInfo,
          feltColor: broadcastFeltColor,
          shimmerCardId,
          perfectDraw: perfectDrawActive,
          disconnectedPlayers: [...disconnectedPlayersRef.current],
          turnTimeRemaining: turnSkipStartRef.current
            ? Math.max(0, Math.round((15000 - (Date.now() - turnSkipStartRef.current)) / 1000))
            : undefined,
        })
        mpChannel.broadcast('game_state', { targetSeatIndex: remoteSeat, view })
      }
      // Broadcast spectator view (all hands visible)
      const spectatorView = {
        players: gs.players.map((p, i) => ({
          name: p.name,
          hand: [...p.hand],
          hasLaidDown: p.hasLaidDown,
          buysRemaining: p.buysRemaining,
          isAI: !!p.isAI,
          seatIndex: i,
          melds: p.melds,
        })),
        tableMelds: gs.roundState.tablesMelds,
        discardTop: gs.roundState.discardPile.length > 0
          ? gs.roundState.discardPile[gs.roundState.discardPile.length - 1]
          : null,
        drawPileSize: gs.roundState.drawPile.length,
        currentPlayerIndex: gs.roundState.currentPlayerIndex,
        uiPhase: uiPhaseRef.current,
        currentRound: gs.currentRound,
        roundRequirement: gs.roundState.requirement,
        scores: gs.players.map(p => ({ name: p.name, roundScores: [...p.roundScores] })),
        buyLimit: gs.buyLimit,
        goingOutPlayerName: goOutPlayerName,
        goingOutSequence,
        announcementStage,
        gameOver: gs.gameOver,
        winner: gs.gameOver
          ? gs.players.reduce((best, p) => {
              const t = p.roundScores.reduce((a, b) => a + b, 0)
              const bt = best.roundScores.reduce((a, b) => a + b, 0)
              return t < bt ? p : best
            }).name
          : undefined,
        feltColor: broadcastFeltColor,
        toast: remoteToast as any,
        roundResults: roundResults
          ? (roundResults as any[]).map(r => ({
              playerName: gs.players.find(p => p.id === r.playerId)?.name ?? r.playerId,
              score: r.score,
              shanghaied: r.shanghaied,
              wentOut: r.score === 0,
            }))
          : undefined,
      }
      mpChannel.broadcast('spectator_view', { view: spectatorView })

      // Clear ephemeral events after broadcasting so they are not re-sent
      if (remoteEvent) setTimeout(() => setRemoteEvent(null), 100)
      if (remoteToast) setTimeout(() => setRemoteToast(null), 100)
    }

    // Throttle: if a broadcast is already scheduled, mark pending instead
    if (broadcastTimerRef.current) {
      broadcastPendingRef.current = true
    } else {
      doBroadcast()
      broadcastTimerRef.current = setTimeout(() => {
        broadcastTimerRef.current = null
        if (broadcastPendingRef.current) doBroadcast()
      }, 80)
    }

    return () => {
      // Don't clear the throttle timer on cleanup — let pending broadcasts flush
    }
  }, [mode, mpChannel.isConnected, gameState, uiPhase, buyingPhase, buyerStep, buyingPassedPlayers, buyingSnatcherName, roundResults, goingOutSequence, announcementStage, remoteEvent, remoteToast, raceMessage, shimmerCardId, perfectDrawActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Receive and dispatch remote player actions ───────────────────────────
  useEffect(() => {
    if (mode !== 'host') return
    return mpChannel.onMessage('player_action', (payload: { seatIndex: number; action: PlayerAction & { actionId?: string } }) => {
      if (!remoteSeatIndices.includes(payload.seatIndex)) return
      const actionId = (payload.action as any).actionId as string | undefined
      const result = mapActionToHandler(
        payload.action,
        payload.seatIndex,
        gameStateRef.current,
        {
          handleDrawFromPile: handlers.handleDrawFromPile,
          handleTakeDiscard: handlers.handleTakeDiscard,
          handleDeclineFreeOffer: handlers.handleDeclineFreeOffer,
          handleMeldConfirm: handlers.handleMeldConfirm,
          handleLayOff: handlers.handleLayOff,
          handleJokerSwap: handlers.handleJokerSwap,
          handleDiscard: handlers.handleDiscard,
          handleBuyDecision: handlers.handleBuyDecision,
        },
        uiPhaseRef.current,
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
  }, [mode, mpChannel.onMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Emote system — send and receive ──────────────────────────────────────
  function handleEmoteSend(emoteId: string) {
    if (mode !== 'host' || !mpChannel.isConnected) return
    const seatIndex = hostSeatIndex ?? 0
    mpChannel.broadcast('emote', { seatIndex, emoteId, timestamp: Date.now() })
    // Show own emote locally
    const emoji = EMOTE_MAP[emoteId] ?? '\u{1F60A}'
    setActiveEmotes(prev => { const next = new Map(prev); next.set(seatIndex, emoji); return next })
    setTimeout(() => setActiveEmotes(prev => { const next = new Map(prev); next.delete(seatIndex); return next }), 2500)
  }

  useEffect(() => {
    if (mode !== 'host') return
    return mpChannel.onMessage('emote', (payload: EmotePayload) => {
      const emoji = EMOTE_MAP[payload.emoteId] ?? '\u{1F60A}'
      setActiveEmotes(prev => { const next = new Map(prev); next.set(payload.seatIndex, emoji); return next })
      setTimeout(() => setActiveEmotes(prev => { const next = new Map(prev); next.delete(payload.seatIndex); return next }), 2500)
    })
  }, [mode, mpChannel.onMessage])

  // ── Host: persist game state snapshot periodically + on key transitions ──
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (mode !== 'host' || !roomCode) return

    // Save immediately on round-end or game-over
    if (uiPhase === 'round-end' || uiPhase === 'game-over') {
      saveGameStateSnapshot(roomCode, { gameState: gameStateRef.current, uiPhase, currentRound: gameStateRef.current.currentRound })
    }

    // Periodic 10-second snapshot
    if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current)
    snapshotTimerRef.current = setInterval(() => {
      saveGameStateSnapshot(roomCode!, { gameState: gameStateRef.current, uiPhase: uiPhaseRef.current, currentRound: gameStateRef.current.currentRound })
    }, 10_000)

    return () => {
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current)
    }
  }, [mode, roomCode, uiPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Host: browser notification when it's the host's turn ────────────────
  useEffect(() => {
    if (mode !== 'host' || !roomCode) return
    const currentIdx = gameState.roundState.currentPlayerIndex
    if (currentIdx === hostSeatIndex && document.hidden) {
      notifyTurn(roomCode)
    }
  }, [mode, roomCode, gameState.roundState.currentPlayerIndex, hostSeatIndex])

  // ── Host: handle remote player reconnections ────────────────────────────
  useEffect(() => {
    if (mode !== 'host') return
    return mpChannel.onMessage('player_reconnected', (payload: { seatIndex: number }) => {
      const remoteSeat = payload.seatIndex
      if (!remoteSeatIndices.includes(remoteSeat)) return
      // Re-broadcast current state to the reconnected player
      const view = sanitizeGameViewForPlayer({
        gameState: gameStateRef.current,
        uiPhase: uiPhaseRef.current,
        targetSeatIndex: remoteSeat,
        buyingState: buyingPhaseRef.current !== 'hidden' ? {
          buyingDiscard: buyingDiscard,
          buyerOrder: buyerOrderRef.current,
          buyerStep: buyerStepRef.current,
          buyingPhase: buyingPhaseRef.current,
          passedPlayers: buyingPassedPlayers,
          snatcherName: buyingSnatcherName,
        } : null,
        pendingFreeOffer: pendingBuyDiscardRef.current,
        roundResults: roundResults as any,
        goingOutPlayerName: goOutPlayerName,
        goingOutSequence,
        announcementStage,
        gameOver: gameStateRef.current.gameOver,
        disconnectedPlayers: [...disconnectedPlayersRef.current],
      })
      mpChannel.broadcast('game_state', { targetSeatIndex: remoteSeat, view })
    })
  }, [mode, mpChannel.onMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Buy timeout for remote players (15 seconds) ─────────────────────────
  const buyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (mode !== 'host' || uiPhase !== 'buying') return
    if (buyTimeoutRef.current) clearTimeout(buyTimeoutRef.current)
    const currentBuyerIdx = buyerOrder[buyerStep]
    if (currentBuyerIdx !== undefined && remoteSeatIndices.includes(currentBuyerIdx)) {
      const buyer = gameState.players[currentBuyerIdx]
      if (buyer && !buyer.isAI) {
        buyTimeoutRef.current = setTimeout(() => {
          handlers.handleBuyDecision(false) // auto-pass
        }, 15000)
      }
    }
    return () => {
      if (buyTimeoutRef.current) clearTimeout(buyTimeoutRef.current)
    }
  }, [mode, uiPhase, buyerStep]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    mpChannel,
    activeEmotes,
    handleEmoteSend,
  }
}
