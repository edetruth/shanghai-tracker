import type { RealtimeChannel } from '@supabase/supabase-js'
import type { PlayerAction } from './multiplayer-types'

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
