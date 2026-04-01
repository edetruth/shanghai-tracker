import { describe, it, expect } from 'vitest'
import { initReplayState, applyAction } from '../replay-engine'
import type { ReplayState } from '../replay-engine'
import type { ActionLogEntry } from '../../lib/actionLog'

function action(
  seq: number,
  playerIndex: number,
  type: string,
  data: Record<string, unknown> = {},
): ActionLogEntry {
  return { game_id: 'test', seq, player_index: playerIndex, action_type: type, action_data: data }
}

const PLAYER_NAMES = ['Alice', 'Bob', 'Charlie']

describe('Replay Engine', () => {
  describe('initReplayState', () => {
    it('returns null when no round_start action exists', () => {
      const actions = [action(1, 0, 'draw_pile')]
      const result = initReplayState(actions, PLAYER_NAMES)
      expect(result).toBeNull()
    })

    it('returns null when round_start has no seed', () => {
      const actions = [action(1, 0, 'round_start', { round: 1 })]
      const result = initReplayState(actions, PLAYER_NAMES)
      expect(result).toBeNull()
    })

    it('with valid seed returns state with correct player count and dealt hands', () => {
      const actions = [action(1, 0, 'round_start', { round: 1, seed: 42 })]
      const state = initReplayState(actions, PLAYER_NAMES)
      expect(state).not.toBeNull()
      expect(state!.players).toHaveLength(3)
      // Round 1 deals 10 cards
      expect(state!.players[0].hand).toHaveLength(10)
      expect(state!.players[1].hand).toHaveLength(10)
      expect(state!.players[2].hand).toHaveLength(10)
      expect(state!.discardPile).toHaveLength(1)
      expect(state!.drawPile.length).toBeGreaterThan(0)
    })

    it('same seed produces same initial hands (deterministic)', () => {
      const actions = [action(1, 0, 'round_start', { round: 1, seed: 42 })]
      const state1 = initReplayState(actions, PLAYER_NAMES)
      const state2 = initReplayState(actions, PLAYER_NAMES)
      expect(state1!.players[0].hand.map(c => c.id)).toEqual(
        state2!.players[0].hand.map(c => c.id),
      )
      expect(state1!.discardPile[0].id).toBe(state2!.discardPile[0].id)
    })
  })

  describe('applyAction', () => {
    function getInitState(): ReplayState {
      const actions = [action(1, 0, 'round_start', { round: 1, seed: 42 })]
      return initReplayState(actions, PLAYER_NAMES)!
    }

    it('draw_pile moves card from drawPile to player hand', () => {
      const state = getInitState()
      const drawPileBefore = state.drawPile.length
      const handBefore = state.players[0].hand.length
      const topCard = state.drawPile[0]

      const next = applyAction(state, action(2, 0, 'draw_pile'))
      expect(next.drawPile).toHaveLength(drawPileBefore - 1)
      expect(next.players[0].hand).toHaveLength(handBefore + 1)
      expect(next.players[0].hand[next.players[0].hand.length - 1].id).toBe(topCard.id)
    })

    it('take_discard moves top of discardPile to player hand', () => {
      const state = getInitState()
      const discardTop = state.discardPile[state.discardPile.length - 1]
      const handBefore = state.players[0].hand.length

      const next = applyAction(state, action(2, 0, 'take_discard'))
      expect(next.discardPile).toHaveLength(0)
      expect(next.players[0].hand).toHaveLength(handBefore + 1)
      expect(next.players[0].hand[next.players[0].hand.length - 1].id).toBe(discardTop.id)
    })

    it('discard moves card from player hand to discardPile', () => {
      const state = getInitState()
      const cardToDiscard = state.players[0].hand[0]
      const handBefore = state.players[0].hand.length
      const discardBefore = state.discardPile.length

      const next = applyAction(
        state,
        action(2, 0, 'discard', { cardId: cardToDiscard.id, cardLabel: 'test' }),
      )
      expect(next.players[0].hand).toHaveLength(handBefore - 1)
      expect(next.discardPile).toHaveLength(discardBefore + 1)
      expect(next.discardPile[next.discardPile.length - 1].id).toBe(cardToDiscard.id)
    })

    it('buy gives player the discard + a penalty card from draw pile', () => {
      const state = getInitState()
      const discardTop = state.discardPile[state.discardPile.length - 1]
      const drawTop = state.drawPile[0]
      const handBefore = state.players[1].hand.length

      const next = applyAction(
        state,
        action(2, 1, 'buy', { wantsToBuy: true }),
      )
      expect(next.players[1].hand).toHaveLength(handBefore + 2)
      // The bought card (from discard) and penalty (from draw) should be in hand
      const newCardIds = next.players[1].hand.map(c => c.id)
      expect(newCardIds).toContain(discardTop.id)
      expect(newCardIds).toContain(drawTop.id)
    })

    it('going_out sets goingOutPlayer', () => {
      const state = getInitState()
      const next = applyAction(state, action(2, 0, 'going_out'))
      expect(next.goingOutPlayer).toBe('Alice')
    })

    it('round_end sets phase to round-end', () => {
      const state = getInitState()
      const next = applyAction(state, action(2, 0, 'round_end', { round: 1 }))
      expect(next.phase).toBe('round-end')
    })

    it('state is immutable — applying an action does not mutate the original', () => {
      const state = getInitState()
      const originalHandLength = state.players[0].hand.length
      const originalDrawLength = state.drawPile.length

      applyAction(state, action(2, 0, 'draw_pile'))

      expect(state.players[0].hand).toHaveLength(originalHandLength)
      expect(state.drawPile).toHaveLength(originalDrawLength)
    })
  })
})
