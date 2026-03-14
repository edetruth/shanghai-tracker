import { useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useRealtimeScores(
  gameId: string | null,
  onUpdate: () => void
) {
  const refresh = useCallback(onUpdate, [onUpdate])

  useEffect(() => {
    if (!gameId) return

    const channel = supabase
      .channel(`game-scores-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_scores',
          filter: `game_id=eq.${gameId}`,
        },
        () => refresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        () => refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, refresh])
}
