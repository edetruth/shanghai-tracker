import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getGameRoom, getGameRoomPlayers } from '../lib/gameStore'
import type { GameRoom, GameRoomPlayer } from '../game/multiplayer-types'

export function useGameLobby(roomCode: string | null) {
  const [players, setPlayers] = useState<GameRoomPlayer[]>([])
  const [room, setRoom] = useState<GameRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!roomCode) return
    try {
      const [r, p] = await Promise.all([
        getGameRoom(roomCode),
        getGameRoomPlayers(roomCode),
      ])
      setRoom(r)
      setPlayers(p)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load room')
    } finally {
      setLoading(false)
    }
  }, [roomCode])

  // Initial fetch
  useEffect(() => {
    if (!roomCode) {
      setLoading(false)
      return
    }
    refresh()
  }, [roomCode, refresh])

  // Real-time subscription for player changes
  useEffect(() => {
    if (!roomCode) return

    const channel = supabase
      .channel(`lobby-${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_room_players',
          filter: `room_code=eq.${roomCode}`,
        },
        () => refresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_rooms',
          filter: `room_code=eq.${roomCode}`,
        },
        () => refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomCode, refresh])

  return { players, room, loading, error, refresh }
}
