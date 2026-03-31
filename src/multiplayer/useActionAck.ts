import { useState, useRef, useCallback, useEffect } from 'react'
import type { PlayerAction, PendingAction, ActionAck } from '../game/multiplayer-types'

interface UseActionAckOptions {
  seatIndex: number
  broadcast: (event: string, payload: Record<string, unknown>) => void
  onMessage: (event: string, handler: (payload: any) => void) => () => void
}

interface UseActionAckReturn {
  sendWithAck: (action: PlayerAction) => void
  pendingAction: PendingAction | null
  isPending: boolean
  lastError: string | null
  clearPending: () => void
}

const ACK_TIMEOUT_MS = 5000
const MAX_RETRIES = 2 // 2 retries = 3 total attempts

function random4chars(): string {
  return Math.random().toString(36).substring(2, 6)
}

export function useActionAck({
  seatIndex,
  broadcast,
  onMessage,
}: UseActionAckOptions): UseActionAckReturn {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PendingAction | null>(null)
  const mountedRef = useRef(true)

  // Keep ref in sync with state for use in callbacks
  const updatePending = useCallback((p: PendingAction | null) => {
    pendingRef.current = p
    setPendingAction(p)
  }, [])

  const clearAllTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
  }, [])

  const clearPending = useCallback(() => {
    clearAllTimers()
    updatePending(null)
  }, [clearAllTimers, updatePending])

  const setErrorWithAutoClear = useCallback((msg: string) => {
    setLastError(msg)
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current)
    }
    errorTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setLastError(null)
      }
      errorTimerRef.current = null
    }, 3000)
  }, [])

  const sendAction = useCallback((pending: PendingAction) => {
    broadcast('player_action', {
      seatIndex,
      action: { ...pending.action, actionId: pending.id },
    })

    // Set timeout for ACK
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      const current = pendingRef.current
      if (!current || current.id !== pending.id) return

      if (current.retries < MAX_RETRIES) {
        // Retry
        const retried: PendingAction = {
          ...current,
          retries: current.retries + 1,
          sentAt: Date.now(),
        }
        updatePending(retried)
        sendAction(retried)
      } else {
        // Give up after 3 total attempts
        updatePending(null)
        setErrorWithAutoClear('Action failed — no response from host after 3 attempts')
      }
    }, ACK_TIMEOUT_MS)
  }, [broadcast, seatIndex, updatePending, setErrorWithAutoClear])

  const sendWithAck = useCallback((action: PlayerAction) => {
    // Clear any existing pending action
    clearAllTimers()

    const actionId = `${seatIndex}-${Date.now()}-${random4chars()}`
    const pending: PendingAction = {
      id: actionId,
      action,
      sentAt: Date.now(),
      retries: 0,
    }

    updatePending(pending)
    sendAction(pending)
  }, [seatIndex, clearAllTimers, updatePending, sendAction])

  // Listen for action_ack events
  useEffect(() => {
    const cleanup = onMessage('action_ack', (payload: ActionAck & { seatIndex: number }) => {
      if (payload.seatIndex !== seatIndex) return

      const current = pendingRef.current
      if (!current || current.id !== payload.actionId) return

      // ACK matches our pending action
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      updatePending(null)

      if (!payload.ok) {
        setErrorWithAutoClear(payload.error || 'Action rejected by host')
      }
    })

    return cleanup
  }, [seatIndex, onMessage, updatePending, setErrorWithAutoClear])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  return {
    sendWithAck,
    pendingAction,
    isPending: pendingAction !== null,
    lastError,
    clearPending,
  }
}
