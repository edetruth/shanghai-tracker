import { useState, useRef, useCallback } from 'react'
import { logAction, loadActionLog } from '../lib/actionLog'
import type { ActionLogEntry } from '../lib/actionLog'

export function useActionLogger(initialLogData?: Record<string, unknown>) {
  const [gameLogId] = useState(() => {
    const id = crypto.randomUUID()
    if (initialLogData) {
      logAction(id, 1, -1, 'round_start', initialLogData)
    }
    return id
  })
  const seqRef = useRef(initialLogData ? 1 : 0) // starts at 1 if initial log was written

  const log = useCallback((playerIndex: number, actionType: string, data: Record<string, unknown> = {}) => {
    logAction(gameLogId, ++seqRef.current, playerIndex, actionType, data)
  }, [gameLogId])

  const getLog = useCallback((): Promise<ActionLogEntry[]> => loadActionLog(gameLogId), [gameLogId])

  return { gameLogId, log, getLog }
}
