import { useEffect, useRef, useCallback } from 'react'
import type { PlayerConnectionState, HeartbeatPayload } from '../game/multiplayer-types'

const HEARTBEAT_INTERVAL_MS = 3_000
const DISCONNECT_THRESHOLD_MS = 10_000

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

interface UseHeartbeatReturn {
  getDisconnectedPlayers: () => number[]
  getConnectionStates: () => Map<number, PlayerConnectionState>
}

export function useHeartbeat(options: UseHeartbeatOptions): UseHeartbeatReturn {
  const {
    seatIndex,
    isHost,
    broadcast,
    onMessage,
    isConnected,
    remoteSeatIndices,
    onPlayerDisconnected,
    onPlayerReconnected,
  } = options

  // Host tracks connection state for each remote player
  const connectionStates = useRef<Map<number, PlayerConnectionState>>(new Map())

  // Ref to keep callbacks fresh without re-running effects
  const callbacksRef = useRef({ onPlayerDisconnected, onPlayerReconnected })
  callbacksRef.current = { onPlayerDisconnected, onPlayerReconnected }

  // Keep remoteSeatIndices in a ref so the monitor effect doesn't re-run on every render
  const remoteSeatIndicesRef = useRef(remoteSeatIndices)
  remoteSeatIndicesRef.current = remoteSeatIndices

  // ── Send heartbeats (everyone) ──────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected) return

    const sendHeartbeat = () => {
      broadcast('heartbeat', { seatIndex, timestamp: Date.now() })
    }

    // Immediate heartbeat on connection
    sendHeartbeat()

    const intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [isConnected, seatIndex, broadcast])

  // ── Host: initialize connection states for remote seats ─────────────────────

  useEffect(() => {
    if (!isHost) return

    const now = Date.now()
    const states = connectionStates.current

    // Add new seats
    for (const seat of remoteSeatIndices) {
      if (!states.has(seat)) {
        states.set(seat, {
          seatIndex: seat,
          lastHeartbeat: now,
          isConnected: true,
          missedBeats: 0,
        })
      }
    }

    // Remove seats that are no longer remote
    const remoteSet = new Set(remoteSeatIndices)
    for (const seat of states.keys()) {
      if (!remoteSet.has(seat)) {
        states.delete(seat)
      }
    }
  }, [isHost, remoteSeatIndices])

  // ── Host: listen for heartbeats from remote players ─────────────────────────

  useEffect(() => {
    if (!isHost) return

    const unsubscribe = onMessage('heartbeat', (payload: HeartbeatPayload) => {
      const { seatIndex: remoteSeat, timestamp } = payload
      const states = connectionStates.current
      const state = states.get(remoteSeat)

      if (!state) return

      const wasDisconnected = !state.isConnected

      state.lastHeartbeat = timestamp
      state.missedBeats = 0
      state.isConnected = true

      if (wasDisconnected) {
        callbacksRef.current.onPlayerReconnected?.(remoteSeat)
      }
    })

    return unsubscribe
  }, [isHost, onMessage])

  // ── Host: monitor for missed heartbeats ─────────────────────────────────────

  useEffect(() => {
    if (!isHost) return

    const checkInterval = setInterval(() => {
      const now = Date.now()
      const states = connectionStates.current

      for (const [seat, state] of states) {
        const elapsed = now - state.lastHeartbeat
        const newMissedBeats = Math.floor(elapsed / HEARTBEAT_INTERVAL_MS)

        if (elapsed >= DISCONNECT_THRESHOLD_MS && state.isConnected) {
          state.isConnected = false
          state.missedBeats = newMissedBeats
          callbacksRef.current.onPlayerDisconnected?.(seat)
        } else {
          state.missedBeats = newMissedBeats
        }
      }
    }, HEARTBEAT_INTERVAL_MS)

    return () => clearInterval(checkInterval)
  }, [isHost])

  // ── Public API ──────────────────────────────────────────────────────────────

  const getDisconnectedPlayers = useCallback((): number[] => {
    const result: number[] = []
    for (const [seat, state] of connectionStates.current) {
      if (!state.isConnected) result.push(seat)
    }
    return result
  }, [])

  const getConnectionStates = useCallback((): Map<number, PlayerConnectionState> => {
    return new Map(connectionStates.current)
  }, [])

  return { getDisconnectedPlayers, getConnectionStates }
}
