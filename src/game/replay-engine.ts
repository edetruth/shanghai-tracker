import type { Card, Meld } from './types'
import { createDecks, shuffle, dealHands } from './deck'
import { ROUND_REQUIREMENTS, CARDS_DEALT } from './rules'
import type { ActionLogEntry } from '../lib/actionLog'
import type { RoundRequirement } from './types'

export interface ReplayState {
  players: ReplayPlayer[]
  currentPlayerIndex: number
  currentRound: number
  tableMelds: Meld[]
  discardPile: Card[]
  drawPile: Card[]
  requirement: RoundRequirement
  phase: 'draw' | 'action' | 'round-end' | 'game-over'
  lastAction?: string
  goingOutPlayer?: string
}

export interface ReplayPlayer {
  name: string
  hand: Card[]
  melds: Meld[]
  hasLaidDown: boolean
  buysRemaining: number
  roundScores: number[]
  isAI: boolean
}

/**
 * Build the initial state from the seed embedded in the first round_start action.
 */
export function initReplayState(actions: ActionLogEntry[], playerNames: string[]): ReplayState | null {
  // Find the first round_start to get the seed
  const firstAction = actions.find(a => a.action_type === 'round_start')
  if (!firstAction) return null

  const seed = firstAction.action_data.seed as number | undefined
  const deckCount = (firstAction.action_data.deckCount as number) ?? (playerNames.length <= 4 ? 2 : 3)

  if (seed === undefined) return null // Can't replay without seed

  const deck = shuffle(createDecks(deckCount), seed)
  const cardsDealt = CARDS_DEALT[0]
  const { hands, remaining } = dealHands(deck, playerNames.length, cardsDealt)
  const topDiscard = remaining.shift()!

  const players: ReplayPlayer[] = playerNames.map((name, i) => ({
    name,
    hand: hands[i],
    melds: [],
    hasLaidDown: false,
    buysRemaining: 5,
    roundScores: [],
    isAI: false, // In replay, doesn't matter
  }))

  return {
    players,
    currentPlayerIndex: 0,
    currentRound: 1,
    tableMelds: [],
    discardPile: [topDiscard],
    drawPile: remaining,
    requirement: ROUND_REQUIREMENTS[0],
    phase: 'action',
  }
}

/**
 * Apply a single action to the replay state, returning a new state.
 * Handles the main actions that change visible state.
 */
export function applyAction(state: ReplayState, action: ActionLogEntry): ReplayState {
  const s = deepCloneState(state)

  switch (action.action_type) {
    case 'round_start': {
      // For subsequent rounds, re-deal from the round's seed
      const round = action.action_data.round as number ?? s.currentRound
      const seed = action.action_data.seed as number | undefined
      const deckCount = (action.action_data.deckCount as number) ?? (s.players.length <= 4 ? 2 : 3)

      if (seed !== undefined && round > 1) {
        const deck = shuffle(createDecks(deckCount), seed)
        const cardsDealt = CARDS_DEALT[round - 1] ?? 10
        const { hands, remaining } = dealHands(deck, s.players.length, cardsDealt)
        const topDiscard = remaining.shift()!
        s.players.forEach((p, i) => {
          p.hand = hands[i]
          p.melds = []
          p.hasLaidDown = false
          p.buysRemaining = 5
        })
        s.drawPile = remaining
        s.discardPile = [topDiscard]
        s.tableMelds = []
        s.goingOutPlayer = undefined
      }

      s.currentRound = round
      s.requirement = ROUND_REQUIREMENTS[round - 1] ?? ROUND_REQUIREMENTS[0]
      s.phase = 'action'
      s.lastAction = `Round ${round} started`
      break
    }

    case 'draw_pile': {
      const player = s.players[action.player_index]
      if (player && s.drawPile.length > 0) {
        const card = s.drawPile.shift()!
        player.hand.push(card)
        s.currentPlayerIndex = action.player_index
        s.phase = 'action'
        s.lastAction = `${player.name} drew from pile`
      }
      break
    }

    case 'take_discard': {
      const player = s.players[action.player_index]
      if (player && s.discardPile.length > 0) {
        const card = s.discardPile.pop()!
        player.hand.push(card)
        s.currentPlayerIndex = action.player_index
        s.phase = 'action'
        s.lastAction = `${player.name} took from discard`
      }
      break
    }

    case 'discard': {
      const player = s.players[action.player_index]
      const cardId = action.action_data.cardId as string
      if (player && cardId) {
        const idx = player.hand.findIndex(c => c.id === cardId)
        if (idx !== -1) {
          const [card] = player.hand.splice(idx, 1)
          s.discardPile.push(card)
          s.lastAction = `${player.name} discarded ${action.action_data.cardLabel ?? 'a card'}`
          s.currentPlayerIndex = (action.player_index + 1) % s.players.length
          s.phase = 'draw'
        }
      }
      break
    }

    case 'meld_confirm': {
      const player = s.players[action.player_index]
      if (player) {
        player.hasLaidDown = true
        s.lastAction = `${player.name} laid down melds`
      }
      break
    }

    case 'lay_off': {
      const player = s.players[action.player_index]
      const cardId = action.action_data.cardId as string
      if (player && cardId) {
        const idx = player.hand.findIndex(c => c.id === cardId)
        if (idx !== -1) {
          player.hand.splice(idx, 1)
          s.lastAction = `${player.name} laid off a card`
        }
      }
      break
    }

    case 'joker_swap': {
      const player = s.players[action.player_index]
      if (player) {
        s.lastAction = `${player.name} swapped a joker`
      }
      break
    }

    case 'buy': {
      const player = s.players[action.player_index]
      if (player && action.action_data.wantsToBuy) {
        if (s.discardPile.length > 0) {
          const boughtCard = s.discardPile.pop()!
          player.hand.push(boughtCard)
        }
        if (s.drawPile.length > 0) {
          const penalty = s.drawPile.shift()!
          player.hand.push(penalty)
        }
        player.buysRemaining = Math.max(0, player.buysRemaining - 1)
        s.lastAction = `${player.name} bought a card`
      } else if (player) {
        s.lastAction = `${player.name} passed`
      }
      break
    }

    case 'going_out': {
      const player = s.players[action.player_index]
      if (player) {
        s.goingOutPlayer = player.name
        s.lastAction = `${player.name} went out!`
      }
      break
    }

    case 'round_end': {
      s.phase = 'round-end'
      s.goingOutPlayer = undefined
      s.lastAction = `Round ${action.action_data.round ?? s.currentRound} ended`
      break
    }

    case 'decline_free_offer': {
      const player = s.players[action.player_index]
      if (player) {
        s.lastAction = `${player.name} declined free offer`
      }
      break
    }
  }

  return s
}

function deepCloneState(state: ReplayState): ReplayState {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      hand: [...p.hand],
      melds: p.melds.map(m => ({ ...m, cards: [...m.cards] })),
      roundScores: [...p.roundScores],
    })),
    tableMelds: state.tableMelds.map(m => ({ ...m, cards: [...m.cards] })),
    discardPile: [...state.discardPile],
    drawPile: [...state.drawPile],
  }
}
