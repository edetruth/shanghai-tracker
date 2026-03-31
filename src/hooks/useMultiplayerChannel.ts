import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

type MessageHandler = (payload: any) => void

export function useMultiplayerChannel(roomCode: string | null) {
  const [isConnected, setIsConnected] = useState(false)
  const [connectedPlayerCount, setConnectedPlayerCount] = useState(0)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map())

  useEffect(() => {
    if (!roomCode) {
      setIsConnected(false)
      return
    }

    const channel = supabase.channel(`game:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: roomCode },
      },
    })

    // Register broadcast listeners for each known event type
    // Supabase Realtime Broadcast does NOT support wildcard event: '*'
    const KNOWN_EVENTS = [
      'game_state',
      'player_action',
      'action_rejected',
      'action_ack',
      'game_start',
      'player_joined',
      'player_left',
      'player_reconnected',
      'player_disconnected',
      'turn_skipped',
      'heartbeat',
      'emote',
      'spectator_view',
    ] as const

    for (const eventName of KNOWN_EVENTS) {
      channel.on('broadcast', { event: eventName }, ({ payload }) => {
        const handlers = handlersRef.current.get(eventName)
        if (handlers) {
          for (const handler of handlers) {
            handler(payload)
          }
        }
      })
    }

    // Track presence for connection count
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      setConnectedPlayerCount(Object.keys(state).length)
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true)
        await channel.track({ joined_at: Date.now() })
      } else {
        setIsConnected(false)
      }
    })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
      setIsConnected(false)
    }
  }, [roomCode])

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current
    if (!channel) return
    channel.send({
      type: 'broadcast',
      event,
      payload,
    })
  }, [])

  const onMessage = useCallback((event: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set())
    }
    handlersRef.current.get(event)!.add(handler)

    // Return cleanup function
    return () => {
      handlersRef.current.get(event)?.delete(handler)
    }
  }, [])

  return {
    channel: channelRef.current,
    channelRef,
    broadcast,
    onMessage,
    isConnected,
    connectedPlayerCount,
  }
}
