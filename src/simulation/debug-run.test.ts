/**
 * Quick debug runner — 2 games, prints per-round timing.
 * Run via: npx vitest run src/simulation/debug-run.ts
 */
import { describe, it } from 'vitest'
import { simulateGame, simulateRound, type SimConfig } from './simulate'
import { ROUND_REQUIREMENTS, TOTAL_ROUNDS, CARDS_DEALT } from '../game/rules'
import { createDecks, shuffle, dealHands } from '../game/deck'
import type { GameState, Player } from '../game/types'
import { MAX_BUYS } from '../game/rules'

function initGameDirect(numPlayers: number): GameState {
  const deckCount = numPlayers <= 4 ? 2 : 3
  const players: Player[] = Array.from({ length: numPlayers }, (_, i) => ({
    id: `p${i}`,
    name: `AI ${i + 1}`,
    hand: [],
    melds: [],
    hasLaidDown: false,
    buysRemaining: MAX_BUYS,
    roundScores: [],
    isAI: true,
  }))
  const deck = shuffle(createDecks(deckCount))
  const cardsDealt = CARDS_DEALT[0]
  const { hands, remaining } = dealHands(deck, numPlayers, cardsDealt)
  players.forEach((p, i) => { p.hand = hands[i] })
  const topDiscard = remaining.shift()!
  return {
    players,
    currentRound: 1,
    deckCount,
    gameOver: false,
    buyLimit: 5,
    roundState: {
      roundNumber: 1,
      requirement: ROUND_REQUIREMENTS[0],
      cardsDealt,
      drawPile: remaining,
      discardPile: [topDiscard],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      tablesMelds: [],
      meldIdCounter: 0,
      goOutPlayerId: null,
    },
  }
}

describe('Debug: 2 games', () => {
  it('runs 2 medium games with per-round timing', { timeout: 60_000 }, () => {
    const config: SimConfig = {
      numGames: 2,
      numPlayers: 4,
      difficulty: 'medium',
      logLevel: 'detailed',
    }

    for (let g = 1; g <= config.numGames; g++) {
      console.log(`\n=== Game ${g} ===`)
      let state = initGameDirect(config.numPlayers)

      for (let roundNum = 1; roundNum <= TOTAL_ROUNDS; roundNum++) {
        if (roundNum > 1) {
          // setupRound is internal — use simulateRound directly by re-init
          // Actually let's just use simulateGame for simplicity
          break
        }
        const t0 = Date.now()
        console.log(`  Round ${roundNum} starting... (hand sizes: ${state.players.map(p => p.hand.length).join(', ')})`)
        const { state: newState, result } = simulateRound(state, config)
        const ms = Date.now() - t0
        console.log(`  Round ${roundNum}: ${result.turnsInRound} turns, went out: ${result.wentOut}, stalemate: ${result.stalemate}, ${ms}ms`)
        state = newState
      }
    }

    // Also try simulateGame
    for (let g = 1; g <= 2; g++) {
      const t0 = Date.now()
      console.log(`\n--- simulateGame ${g} ---`)
      const result = simulateGame(config, g)
      const ms = Date.now() - t0
      console.log(`  Game ${g}: ${result.totalTurns} total turns, winner: ${result.winner}, ${ms}ms`)
      result.rounds.forEach(r => {
        console.log(`    R${r.roundNumber}: ${r.turnsInRound} turns, out: ${r.wentOut}, stalemate: ${r.stalemate}`)
      })
    }
  })
})
