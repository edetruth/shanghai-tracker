/**
 * Node.js bridge for the Shanghai game engine.
 * Reads JSON commands from stdin, runs game logic, writes JSON results to stdout.
 * Used by the Python training pipeline to play games without porting the engine.
 *
 * Protocol:
 *   → {"cmd": "new_game", "players": 2, "seed": 12345}
 *   ← {"ok": true, "state": {...}}
 *
 *   → {"cmd": "get_actions"}
 *   ← {"ok": true, "actions": ["draw_pile", "take_discard"]}
 *
 *   → {"cmd": "take_action", "action": "draw_pile"}
 *   ← {"ok": true, "state": {...}, "reward": 0, "done": false}
 *
 *   → {"cmd": "take_action", "action": "discard", "cardIndex": 3}
 *   ← {"ok": true, "state": {...}, "reward": 0, "done": false}
 */

import { createDecks, shuffle, dealHands } from '../../src/game/deck'
import { isValidRun, isValidSet, buildMeld, canLayOff, findSwappableJoker } from '../../src/game/meld-validator'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, cardPoints } from '../../src/game/rules'
import { scoreRound } from '../../src/game/scoring'
import { aiFindBestMelds } from '../../src/game/ai'
import type { Card, Meld, RoundRequirement } from '../../src/game/types'
import * as readline from 'readline'

// ── Game State ──────────────────────────────────────────────────────────────

interface BridgeGameState {
  players: BridgePlayer[]
  currentPlayerIndex: number
  currentRound: number
  drawPile: Card[]
  discardPile: Card[]
  tableMelds: Meld[]
  requirement: RoundRequirement
  phase: 'draw' | 'action' | 'round-end' | 'game-over'
  deckCount: number
  seed: number
  roundSeeds: number[]
  gameOver: boolean
  scores: number[][] // roundScores per player
  turnCount: number  // turns this round — force end at 200
}

interface BridgePlayer {
  hand: Card[]
  hasLaidDown: boolean
  buysRemaining: number
  melds: Meld[]
}

let game: BridgeGameState | null = null

// ── Game Logic ──────────────────────────────────────────────────────────────

function initGame(playerCount: number, seed: number): BridgeGameState {
  const deckCount = playerCount <= 4 ? 2 : 3
  const roundSeed = seed
  const deck = shuffle(createDecks(deckCount), roundSeed)
  const cardsDealt = CARDS_DEALT[0]
  const { hands, remaining } = dealHands(deck, playerCount, cardsDealt)
  const topDiscard = remaining.shift()!

  const players: BridgePlayer[] = []
  for (let i = 0; i < playerCount; i++) {
    players.push({
      hand: hands[i],
      hasLaidDown: false,
      buysRemaining: 5,
      melds: [],
    })
  }

  return {
    players,
    currentPlayerIndex: 0,
    currentRound: 1,
    drawPile: remaining,
    discardPile: [topDiscard],
    tableMelds: [],
    requirement: ROUND_REQUIREMENTS[0],
    phase: 'draw',
    deckCount,
    seed,
    roundSeeds: [roundSeed],
    gameOver: false,
    scores: players.map(() => []),
    turnCount: 0,
  }
}

function getValidActions(g: BridgeGameState): string[] {
  const player = g.players[g.currentPlayerIndex]
  const actions: string[] = []

  if (g.phase === 'draw') {
    actions.push('draw_pile')
    if (g.discardPile.length > 0) actions.push('take_discard')
  } else if (g.phase === 'action') {
    // Can always discard (one card selected by index)
    for (let i = 0; i < player.hand.length; i++) {
      actions.push(`discard:${i}`)
    }
    // Can lay down if not already and has valid melds
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, g.requirement)
      if (melds) actions.push('meld')
    }
    // Can lay off if has laid down
    if (player.hasLaidDown) {
      for (let ci = 0; ci < player.hand.length; ci++) {
        for (let mi = 0; mi < g.tableMelds.length; mi++) {
          if (canLayOff(player.hand[ci], g.tableMelds[mi])) {
            actions.push(`layoff:${ci}:${mi}`)
          }
        }
      }
    }
  }

  return actions
}

function takeAction(g: BridgeGameState, action: string): { reward: number; done: boolean } {
  const player = g.players[g.currentPlayerIndex]

  if (action === 'draw_pile') {
    if (g.drawPile.length === 0) {
      // Reshuffle
      const top = g.discardPile.pop()
      g.drawPile = shuffle([...g.discardPile])
      g.discardPile = top ? [top] : []
      if (g.drawPile.length === 0) {
        g.drawPile = shuffle(createDecks(1))
      }
    }
    const card = g.drawPile.shift()!
    player.hand.push(card)
    g.phase = 'action'
    return { reward: 0, done: false }
  }

  if (action === 'take_discard') {
    const card = g.discardPile.pop()!
    player.hand.push(card)
    g.phase = 'action'
    return { reward: 0, done: false }
  }

  if (action === 'meld') {
    const meldGroups = aiFindBestMelds(player.hand, g.requirement)
    if (meldGroups) {
      const usedIds = new Set<string>()
      for (const group of meldGroups) {
        const type = isValidSet(group) ? 'set' : 'run'
        const meld = buildMeld(group, type as 'set' | 'run', `p${g.currentPlayerIndex}`, `P${g.currentPlayerIndex}`, `m-${g.tableMelds.length}`)
        g.tableMelds.push(meld)
        group.forEach(c => usedIds.add(c.id))
      }
      player.hand = player.hand.filter(c => !usedIds.has(c.id))
      player.hasLaidDown = true
      player.melds = g.tableMelds.filter(m => m.ownerId === `p${g.currentPlayerIndex}`)

      // Check going out
      if (player.hand.length === 0) {
        return endRound(g)
      }
    }
    return { reward: 0, done: false }
  }

  if (action.startsWith('layoff:')) {
    const [, ciStr, miStr] = action.split(':')
    const ci = parseInt(ciStr), mi = parseInt(miStr)
    const card = player.hand[ci]
    const meld = g.tableMelds[mi]
    if (card && meld && canLayOff(card, meld)) {
      player.hand.splice(ci, 1)
      meld.cards.push(card)
      if (player.hand.length === 0) {
        return endRound(g)
      }
    }
    return { reward: 0, done: false }
  }

  if (action.startsWith('discard:')) {
    const idx = parseInt(action.split(':')[1])
    const card = player.hand.splice(idx, 1)[0]
    g.discardPile.push(card)

    // Advance to next player
    g.currentPlayerIndex = (g.currentPlayerIndex + 1) % g.players.length
    g.phase = 'draw'
    g.turnCount++

    // Force round end after 200 turns (stalemate prevention)
    if (g.turnCount >= 200) {
      return endRound(g)
    }

    return { reward: 0, done: false }
  }

  return { reward: 0, done: false }
}

function endRound(g: BridgeGameState): { reward: number; done: boolean } {
  // Score each player
  for (let i = 0; i < g.players.length; i++) {
    const p = g.players[i]
    if (p.hand.length === 0) {
      g.scores[i].push(0) // went out
    } else if (!p.hasLaidDown) {
      // Shanghaied — double penalty
      const pts = p.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)
      g.scores[i].push(pts) // In real game this would be shanghaied scoring
    } else {
      const pts = p.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)
      g.scores[i].push(pts)
    }
  }

  // Check if game is over
  if (g.currentRound >= TOTAL_ROUNDS) {
    g.gameOver = true
    g.phase = 'game-over'
    // Reward = negative final score (lower is better)
    const totalScores = g.scores.map(rs => rs.reduce((a, b) => a + b, 0))
    return { reward: -totalScores[0], done: true } // reward for player 0
  }

  // Start next round
  g.currentRound++
  const nextSeed = g.seed + g.currentRound * 7919 // deterministic per-round seed
  g.roundSeeds.push(nextSeed)
  const deck = shuffle(createDecks(g.deckCount), nextSeed)
  const cardsDealt = CARDS_DEALT[g.currentRound - 1]
  const { hands, remaining } = dealHands(deck, g.players.length, cardsDealt)
  const topDiscard = remaining.shift()!

  g.requirement = ROUND_REQUIREMENTS[g.currentRound - 1]
  g.drawPile = remaining
  g.discardPile = [topDiscard]
  g.tableMelds = []
  g.currentPlayerIndex = 0
  g.phase = 'draw'
  g.turnCount = 0

  for (let i = 0; i < g.players.length; i++) {
    g.players[i].hand = hands[i]
    g.players[i].hasLaidDown = false
    g.players[i].buysRemaining = 5
    g.players[i].melds = []
  }

  return { reward: 0, done: false }
}

// ── Encode state for the neural network ─────────────────────────────────────

function encodeState(g: BridgeGameState, playerIdx: number): number[] {
  const p = g.players[playerIdx]
  const features: number[] = []

  // Round info (7 features)
  features.push(g.currentRound / 7) // normalized round number
  features.push(g.requirement.sets / 3) // normalized set requirement
  features.push(g.requirement.runs / 3) // normalized run requirement
  features.push(g.drawPile.length / 108) // normalized draw pile size
  features.push(g.discardPile.length / 108)
  features.push(g.tableMelds.length / 20)
  features.push(p.buysRemaining / 5)

  // Hand composition (18 features)
  // Suit counts
  const suitCounts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0, joker: 0 }
  for (const c of p.hand) suitCounts[c.suit]++
  features.push(suitCounts.hearts / 12)
  features.push(suitCounts.diamonds / 12)
  features.push(suitCounts.clubs / 12)
  features.push(suitCounts.spades / 12)
  features.push(suitCounts.joker / 6)

  // Rank histogram (13 features)
  const rankCounts = new Array(13).fill(0)
  for (const c of p.hand) {
    if (c.rank > 0) rankCounts[c.rank - 1]++
  }
  for (const rc of rankCounts) features.push(rc / 6) // max 6 with 3 decks

  // Hand stats (5 features)
  features.push(p.hand.length / 16) // normalized hand size
  features.push(p.hasLaidDown ? 1 : 0)
  const handPoints = p.hand.reduce((s, c) => s + cardPoints(c.rank), 0)
  features.push(handPoints / 200) // normalized point value

  // Pair/set counts
  let pairs = 0, trips = 0
  for (const rc of rankCounts) {
    if (rc >= 3) trips++
    else if (rc >= 2) pairs++
  }
  features.push(pairs / 6)
  features.push(trips / 4)

  // Opponent info (4 features per opponent, max 7 opponents = 28 features)
  for (let i = 0; i < 8; i++) {
    if (i < g.players.length && i !== playerIdx) {
      const opp = g.players[i]
      features.push(opp.hand.length / 16)
      features.push(opp.hasLaidDown ? 1 : 0)
      features.push(opp.buysRemaining / 5)
      features.push(g.scores[i].reduce((a, b) => a + b, 0) / 300) // normalized total score
    } else {
      features.push(0, 0, 0, 0)
    }
  }

  // Discard top card (3 features)
  const top = g.discardPile[g.discardPile.length - 1]
  if (top && top.suit !== 'joker') {
    features.push(top.rank / 13)
    features.push(['hearts', 'diamonds', 'clubs', 'spades'].indexOf(top.suit) / 3)
    features.push(0) // not a joker
  } else if (top) {
    features.push(0, 0, 1) // joker
  } else {
    features.push(0, 0, 0) // empty
  }

  return features // Total: ~65 features
}

// ── STDIO Bridge ────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin })

function respond(data: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(data) + '\n')
}

rl.on('line', (line) => {
  try {
    const cmd = JSON.parse(line)

    switch (cmd.cmd) {
      case 'new_game': {
        game = initGame(cmd.players ?? 2, cmd.seed ?? Math.floor(Math.random() * 2147483647))
        respond({ ok: true, state: encodeState(game, 0), raw_phase: game.phase, round: game.currentRound })
        break
      }

      case 'get_actions': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        respond({ ok: true, actions: getValidActions(game), phase: game.phase, currentPlayer: game.currentPlayerIndex })
        break
      }

      case 'take_action': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        const { reward, done } = takeAction(game, cmd.action)
        respond({
          ok: true,
          state: encodeState(game, 0),
          reward,
          done,
          phase: game.phase,
          round: game.currentRound,
          currentPlayer: game.currentPlayerIndex,
          scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
        })
        break
      }

      case 'encode_state': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        respond({ ok: true, state: encodeState(game, cmd.player ?? 0) })
        break
      }

      case 'quit': {
        process.exit(0)
      }

      default:
        respond({ ok: false, error: `Unknown command: ${cmd.cmd}` })
    }
  } catch (e) {
    respond({ ok: false, error: String(e) })
  }
})
