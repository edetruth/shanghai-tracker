import { supabase } from './supabase'

export interface ActionLogEntry {
  game_id: string
  seq: number
  player_index: number
  action_type: string
  action_data: Record<string, unknown>
}

/**
 * Log a game action. Fire-and-forget — never blocks gameplay.
 */
export function logAction(
  gameId: string,
  seq: number,
  playerIndex: number,
  actionType: string,
  actionData: Record<string, unknown> = {},
): void {
  Promise.resolve(
    supabase.from('game_action_log').insert({
      game_id: gameId,
      seq,
      player_index: playerIndex,
      action_type: actionType,
      action_data: actionData,
    })
  ).catch(() => {})
  // Silent fire-and-forget — same pattern as telemetry
}

/**
 * Load the full action log for a game, ordered by sequence.
 */
export async function loadActionLog(gameId: string): Promise<ActionLogEntry[]> {
  try {
    const { data } = await supabase
      .from('game_action_log')
      .select('*')
      .eq('game_id', gameId)
      .order('seq')
    return (data as ActionLogEntry[]) ?? []
  } catch {
    return []
  }
}

/**
 * Check if a game has an action log (for showing "Watch Replay" button).
 */
export async function hasActionLog(gameId: string): Promise<boolean> {
  try {
    const { count } = await supabase
      .from('game_action_log')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', gameId)
    return (count ?? 0) > 0
  } catch {
    return false
  }
}
