/**
 * Expert player — plays N games as player 0 using optimal strategy,
 * logs every (state_vector, action_index) pair for imitation learning.
 *
 * Opponents use The Shark personality.
 *
 * Usage:
 *   npx tsx ml/bridge/expert-play.ts --games 50
 *
 * Output: ml/data/expert_games.jsonl (one JSON object per game)
 */

import { createDecks, shuffle, dealHands } from '../../src/game/deck'
import { isValidRun, isValidSet, buildMeld, canLayOff, findSwappableJoker, evaluateLayOffReversal } from '../../src/game/meld-validator'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, cardPoints } from '../../src/game/rules'
import {
  aiFindBestMelds,
  aiShouldTakeDiscard,
  aiChooseDiscard,
  aiFindLayOff,
  aiFindJokerSwap,
  aiShouldBuy,
  getAIEvalConfig,
  type AIEvalConfig,
} from '../../src/game/ai'
import type { Card, Meld, RoundRequirement, AIPersonality } from '../../src/game/types'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ── Expert Config ──────────────────────────────────────────────────────────
// Tuned beyond any existing personality based on game theory analysis:
// - takeThreshold 1: take discard aggressively if it helps at all
// - buyRiskTolerance 8: buy aggressively (cards are valuable in Shanghai)
// - discardNoise 0: always optimal discard
// - goDownStyle immediate: go down ASAP to start laying off (reduces risk)
// - opponent awareness maxed out
// Use Nemesis config directly — proven best personality in simulations
const EXPERT_CONFIG: AIEvalConfig = getAIEvalConfig('the-nemesis')

const OPPONENT_PERSONALITY: AIPersonality = 'the-shark'

// ── Game State (copied from game-bridge.ts) ────────────────────────────────

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
  scores: number[][]
  turnCount: number
  lastDiscarderIndex: number
}

interface BridgePlayer {
  hand: Card[]
  hasLaidDown: boolean
  buysRemaining: number
  melds: Meld[]
}

// ── Action encoding (must match network.py) ────────────────────────────────

function encodeAction(action: string): number {
  if (action === 'draw_pile') return 0
  if (action === 'take_discard') return 1
  if (action === 'meld') return 2
  if (action.startsWith('discard:')) {
    const idx = parseInt(action.split(':')[1])
    return 3 + idx  // 3..18
  }
  if (action.startsWith('layoff:')) {
    const parts = action.split(':')
    const ci = parseInt(parts[1]), mi = parseInt(parts[2])
    return 19 + ci * 20 + mi  // 19..339
  }
  if (action === 'buy') return 339
  if (action === 'decline_buy') return 340
  return 0
}

// ── State encoding (must match game-bridge.ts) ─────────────────────────────

function encodeState(g: BridgeGameState, playerIdx: number): number[] {
  const p = g.players[playerIdx]
  const features: number[] = []

  features.push(g.currentRound / 7)
  features.push(g.requirement.sets / 3)
  features.push(g.requirement.runs / 3)
  features.push(g.drawPile.length / 108)
  features.push(g.discardPile.length / 108)
  features.push(g.tableMelds.length / 20)
  features.push(p.buysRemaining / 5)

  const suitCounts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0, joker: 0 }
  for (const c of p.hand) suitCounts[c.suit]++
  features.push(suitCounts.hearts / 12)
  features.push(suitCounts.diamonds / 12)
  features.push(suitCounts.clubs / 12)
  features.push(suitCounts.spades / 12)
  features.push(suitCounts.joker / 6)

  const rankCounts = new Array(13).fill(0)
  for (const c of p.hand) {
    if (c.rank > 0) rankCounts[c.rank - 1]++
  }
  for (const rc of rankCounts) features.push(rc / 6)

  features.push(p.hand.length / 16)
  features.push(p.hasLaidDown ? 1 : 0)
  const handPoints = p.hand.reduce((s, c) => s + cardPoints(c.rank), 0)
  features.push(handPoints / 200)

  let pairs = 0, trips = 0
  for (const rc of rankCounts) {
    if (rc >= 3) trips++
    else if (rc >= 2) pairs++
  }
  features.push(pairs / 6)
  features.push(trips / 4)

  for (let i = 0; i < 8; i++) {
    if (i < g.players.length && i !== playerIdx) {
      const opp = g.players[i]
      features.push(opp.hand.length / 16)
      features.push(opp.hasLaidDown ? 1 : 0)
      features.push(opp.buysRemaining / 5)
      features.push(g.scores[i].reduce((a, b) => a + b, 0) / 300)
    } else {
      features.push(0, 0, 0, 0)
    }
  }

  const top = g.discardPile[g.discardPile.length - 1]
  if (top && top.suit !== 'joker') {
    features.push(top.rank / 13)
    features.push(['hearts', 'diamonds', 'clubs', 'spades'].indexOf(top.suit) / 3)
    features.push(0)
  } else if (top) {
    features.push(0, 0, 1)
  } else {
    features.push(0, 0, 0)
  }

  // Buy window indicator (must match game-bridge.ts)
  features.push(0) // expert-play never pauses in buy-window, always 0

  return features
}

// ── Game Logic ─────────────────────────────────────────────────────────────

function initGame(playerCount: number, seed: number): BridgeGameState {
  const deckCount = playerCount <= 4 ? 2 : 3
  const deck = shuffle(createDecks(deckCount), seed)
  const cardsDealt = CARDS_DEALT[0]
  const { hands, remaining } = dealHands(deck, playerCount, cardsDealt)
  const topDiscard = remaining.shift()!

  const players: BridgePlayer[] = []
  for (let i = 0; i < playerCount; i++) {
    players.push({ hand: hands[i], hasLaidDown: false, buysRemaining: 5, melds: [] })
  }

  return {
    players, currentPlayerIndex: 0, currentRound: 1,
    drawPile: remaining, discardPile: [topDiscard], tableMelds: [],
    requirement: ROUND_REQUIREMENTS[0], phase: 'draw',
    deckCount, seed, roundSeeds: [seed], gameOver: false,
    scores: players.map(() => []), turnCount: 0, lastDiscarderIndex: -1,
  }
}

function takeAction(g: BridgeGameState, action: string): { reward: number; done: boolean } {
  const player = g.players[g.currentPlayerIndex]

  if (action === 'draw_pile') {
    if (g.drawPile.length === 0) {
      const top = g.discardPile.pop()
      g.drawPile = shuffle([...g.discardPile])
      g.discardPile = top ? [top] : []
      if (g.drawPile.length === 0) g.drawPile = shuffle(createDecks(1))
    }
    player.hand.push(g.drawPile.shift()!)
    g.phase = 'action'
    return { reward: 0, done: false }
  }

  if (action === 'take_discard') {
    player.hand.push(g.discardPile.pop()!)
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
      if (player.hand.length === 0) return endRound(g)
    }
    return { reward: 0, done: false }
  }

  if (action.startsWith('layoff:')) {
    const [, ciStr, miStr] = action.split(':')
    const ci = parseInt(ciStr), mi = parseInt(miStr)
    const card = player.hand[ci]
    const meld = g.tableMelds[mi]
    if (card && meld && canLayOff(card, meld)) {
      const reversal = evaluateLayOffReversal(card, meld, player.hand, g.tableMelds)
      if (reversal.outcome === 'reversed' && reversal.discardCard) {
        const stuckIdx = player.hand.findIndex(c => c.id === reversal.discardCard!.id)
        if (stuckIdx >= 0) {
          g.discardPile.push(player.hand.splice(stuckIdx, 1)[0])
          g.lastDiscarderIndex = g.currentPlayerIndex
          g.currentPlayerIndex = (g.currentPlayerIndex + 1) % g.players.length
          g.phase = 'draw'
          g.turnCount++
          if (g.turnCount >= 200) return endRound(g)
          return { reward: 0, done: false }
        }
      }
      player.hand.splice(ci, 1)
      meld.cards.push(card)
      if (player.hand.length === 0) return endRound(g)
    }
    return { reward: 0, done: false }
  }

  if (action.startsWith('discard:')) {
    // Normal rule: can't go out by discarding last card.
    // Exception: if player has exactly 1 card and no meld/layoff is possible (deadlock),
    // allow the forced discard so the game doesn't stall.
    const hasLayoff = player.hasLaidDown && g.tableMelds.some(m => canLayOff(player.hand[0], m))
    const hasMeld = !player.hasLaidDown && !!aiFindBestMelds(player.hand, g.requirement)
    if (player.hand.length <= 1 && (hasLayoff || hasMeld)) return { reward: 0, done: false }
    if (player.hand.length < 1) return { reward: 0, done: false }
    const idx = parseInt(action.split(':')[1])
    g.discardPile.push(player.hand.splice(idx, 1)[0])
    g.lastDiscarderIndex = g.currentPlayerIndex
    g.currentPlayerIndex = (g.currentPlayerIndex + 1) % g.players.length
    g.phase = 'draw'
    g.turnCount++
    if (g.turnCount >= 200) return endRound(g)
    return { reward: 0, done: false }
  }

  return { reward: 0, done: false }
}

function endRound(g: BridgeGameState): { reward: number; done: boolean } {
  for (let i = 0; i < g.players.length; i++) {
    const p = g.players[i]
    if (p.hand.length === 0) {
      g.scores[i].push(0)
    } else {
      g.scores[i].push(p.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0))
    }
  }

  if (g.currentRound >= TOTAL_ROUNDS) {
    g.gameOver = true
    g.phase = 'game-over'
    const totalScores = g.scores.map(rs => rs.reduce((a, b) => a + b, 0))
    return { reward: -totalScores[0], done: true }
  }

  g.currentRound++
  const nextSeed = g.seed + g.currentRound * 7919
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
  g.lastDiscarderIndex = -1

  for (let i = 0; i < g.players.length; i++) {
    g.players[i].hand = hands[i]
    g.players[i].hasLaidDown = false
    g.players[i].buysRemaining = 5
    g.players[i].melds = []
  }

  return { reward: 0, done: false }
}

// ── Expert Turn Logic ──────────────────────────────────────────────────────

interface DecisionLog {
  state: number[]
  action: string
  actionIndex: number
}

function playExpertTurn(g: BridgeGameState, logs: DecisionLog[]): { reward: number; done: boolean } {
  const player = g.players[0]  // expert is always player 0

  // Draw phase
  if (g.phase === 'draw') {
    const stateVec = encodeState(g, 0)
    const topDiscard = g.discardPile[g.discardPile.length - 1]
    let shouldTake = false

    if (topDiscard) {
      shouldTake = aiShouldTakeDiscard(
        player.hand, topDiscard, g.requirement, player.hasLaidDown,
        EXPERT_CONFIG, g.tableMelds
      )
    }

    const action = shouldTake ? 'take_discard' : 'draw_pile'
    logs.push({ state: stateVec, action, actionIndex: encodeAction(action) })
    const result = takeAction(g, action)
    if (result.done) return result
  }

  // Action phase
  if (g.phase === 'action') {
    // Try to meld
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, g.requirement)
      if (melds) {
        const stateVec = encodeState(g, 0)
        logs.push({ state: stateVec, action: 'meld', actionIndex: encodeAction('meld') })
        const result = takeAction(g, 'meld')
        if (result.done) return result
      }
    }

    // Joker swaps
    if (player.hasLaidDown) {
      const swap = aiFindJokerSwap(player.hand, g.tableMelds)
      if (swap) {
        const ci = player.hand.findIndex(c => c.id === swap.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === swap.meld.id)
        if (ci >= 0 && mi >= 0) {
          const meld = g.tableMelds[mi]
          const jokerIdx = meld.cards.findIndex(c => c.suit === 'joker')
          if (jokerIdx >= 0) {
            const joker = meld.cards[jokerIdx]
            meld.cards[jokerIdx] = player.hand[ci]
            player.hand.splice(ci, 1)
            player.hand.push(joker)
          }
        }
      }
    }

    // Lay offs — log each one
    if (player.hasLaidDown) {
      let layoff = aiFindLayOff(player.hand, g.tableMelds)
      let maxLayoffs = 10
      while (layoff && maxLayoffs-- > 0) {
        const ci = player.hand.findIndex(c => c.id === layoff!.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === layoff!.meld.id)
        if (ci >= 0 && mi >= 0) {
          const stateVec = encodeState(g, 0)
          const action = `layoff:${ci}:${mi}`
          logs.push({ state: stateVec, action, actionIndex: encodeAction(action) })
          const result = takeAction(g, action)
          if (result.done) return result
        } else break
        layoff = aiFindLayOff(player.hand, g.tableMelds)
      }
    }

    // Discard — this is the most important decision
    if (g.phase === 'action' && player.hand.length > 0) {
      const stateVec = encodeState(g, 0)
      const discardCard = aiChooseDiscard(player.hand, g.requirement, EXPERT_CONFIG, g.tableMelds)
      const discardIdx = player.hand.findIndex(c => c.id === discardCard.id)
      const idx = discardIdx >= 0 ? discardIdx : player.hand.length - 1
      const action = `discard:${idx}`
      logs.push({ state: stateVec, action, actionIndex: encodeAction(action) })
      return takeAction(g, action)
    }
  }

  return { reward: 0, done: false }
}

function playOpponentTurn(g: BridgeGameState): { reward: number; done: boolean } {
  const config = getAIEvalConfig(OPPONENT_PERSONALITY)
  const player = g.players[g.currentPlayerIndex]

  if (g.phase === 'draw') {
    const topDiscard = g.discardPile[g.discardPile.length - 1]
    let shouldTake = false
    if (topDiscard) {
      shouldTake = aiShouldTakeDiscard(player.hand, topDiscard, g.requirement, player.hasLaidDown, config, g.tableMelds)
    }
    const result = takeAction(g, shouldTake ? 'take_discard' : 'draw_pile')
    if (result.done) return result
  }

  if (g.phase === 'action') {
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, g.requirement)
      if (melds) {
        const result = takeAction(g, 'meld')
        if (result.done) return result
      }
    }

    if (player.hasLaidDown) {
      const swap = aiFindJokerSwap(player.hand, g.tableMelds)
      if (swap) {
        const ci = player.hand.findIndex(c => c.id === swap.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === swap.meld.id)
        if (ci >= 0 && mi >= 0) {
          const meld = g.tableMelds[mi]
          const jokerIdx = meld.cards.findIndex(c => c.suit === 'joker')
          if (jokerIdx >= 0) {
            const joker = meld.cards[jokerIdx]
            meld.cards[jokerIdx] = player.hand[ci]
            player.hand.splice(ci, 1)
            player.hand.push(joker)
          }
        }
      }
    }

    if (player.hasLaidDown) {
      let layoff = aiFindLayOff(player.hand, g.tableMelds)
      let max = 10
      while (layoff && max-- > 0) {
        const ci = player.hand.findIndex(c => c.id === layoff!.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === layoff!.meld.id)
        if (ci >= 0 && mi >= 0) {
          const result = takeAction(g, `layoff:${ci}:${mi}`)
          if (result.done) return result
        } else break
        layoff = aiFindLayOff(player.hand, g.tableMelds)
      }
    }

    if (g.phase === 'action' && player.hand.length > 0) {
      const discardCard = aiChooseDiscard(player.hand, g.requirement, config, g.tableMelds)
      const idx = player.hand.findIndex(c => c.id === discardCard.id)
      return takeAction(g, `discard:${idx >= 0 ? idx : player.hand.length - 1}`)
    }
  }

  return { reward: 0, done: false }
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * After a discard, the next player gets free take (handled by their draw phase).
 * If they draw from pile (declining free take), offer buying to remaining players.
 * Called after each draw_pile action in the game loop.
 */
function resolveBuyWindow(g: BridgeGameState, drawPlayerIndex: number, logs: DecisionLog[]): void {
  if (g.players.length <= 2) return  // no buying in 2-player
  if (g.lastDiscarderIndex < 0) return
  const topDiscard = g.discardPile[g.discardPile.length - 1]
  if (!topDiscard) return

  const opponentConfig = getAIEvalConfig(OPPONENT_PERSONALITY)

  for (let offset = 1; offset < g.players.length; offset++) {
    const pi = (drawPlayerIndex + offset) % g.players.length
    if (pi === g.lastDiscarderIndex) continue
    if (g.players[pi].buysRemaining <= 0) continue

    const buyPlayer = g.players[pi]
    const config = pi === 0 ? EXPERT_CONFIG : opponentConfig
    const shouldBuy = aiShouldBuy(buyPlayer.hand, topDiscard, g.requirement, buyPlayer.buysRemaining, config)

    if (shouldBuy) {
      // Log if expert is buying
      if (pi === 0) {
        const stateVec = encodeState(g, 0)
        logs.push({ state: stateVec, action: 'buy', actionIndex: 339 })
      }
      // Execute buy: discard + penalty card
      if (g.drawPile.length === 0) {
        const top = g.discardPile.pop()
        g.drawPile = shuffle([...g.discardPile])
        g.discardPile = top ? [top] : []
      }
      const penaltyCard = g.drawPile.shift()!
      const boughtCard = g.discardPile.pop()!
      buyPlayer.hand.push(boughtCard)
      buyPlayer.hand.push(penaltyCard)
      buyPlayer.buysRemaining--
      return  // only one player can buy
    } else if (pi === 0) {
      // Log expert declining
      const stateVec = encodeState(g, 0)
      logs.push({ state: stateVec, action: 'decline_buy', actionIndex: 340 })
    }
  }
}

function playGame(seed: number, playerCount: number): {
  logs: DecisionLog[]
  expertScore: number
  opponentScore: number
  winner: 'expert' | 'opponent'
} {
  const g = initGame(playerCount, seed)
  const logs: DecisionLog[] = []
  let safety = 10000

  while (!g.gameOver && safety-- > 0) {
    // Track phase before turn to detect draw_pile (= declined free take)
    const prevDiscardLen = g.discardPile.length
    const currentPlayer = g.currentPlayerIndex

    if (g.currentPlayerIndex === 0) {
      const result = playExpertTurn(g, logs)
      if (result.done) break
    } else {
      const result = playOpponentTurn(g)
      if (result.done) break
    }

    // After a draw phase where the player drew from pile (discard pile unchanged),
    // resolve buying window for other players
    if (g.phase === 'action' && g.discardPile.length === prevDiscardLen && g.discardPile.length > 0) {
      resolveBuyWindow(g, currentPlayer, logs)
    }
  }

  const totalScores = g.scores.map(rs => rs.reduce((a, b) => a + b, 0))
  const expertScore = totalScores[0]
  const opponentScore = totalScores.slice(1).reduce((a, b) => Math.min(a, b), Infinity)

  return {
    logs,
    expertScore,
    opponentScore,
    winner: expertScore <= opponentScore ? 'expert' : 'opponent',
  }
}

// Parse args
const numGames = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--games') ?? '50')
const playerCount = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--players') ?? '2')

console.log(`\nClaude Expert Play — ${numGames} games, ${playerCount} players`)
console.log(`  Expert config: take=${EXPERT_CONFIG.takeThreshold}, buy=${EXPERT_CONFIG.buyRiskTolerance}, danger=${EXPERT_CONFIG.dangerWeight}`)
console.log(`  Opponent: ${OPPONENT_PERSONALITY}\n`)

const dataDir = join(process.cwd(), 'ml', 'data')
mkdirSync(dataDir, { recursive: true })

let totalDecisions = 0
let expertWins = 0
let totalExpertScore = 0
let totalOpponentScore = 0
const allLogs: { states: number[][]; actions: number[]; expertScore: number; opponentScore: number }[] = []

for (let i = 0; i < numGames; i++) {
  const seed = 42 + i * 997  // deterministic but varied seeds
  const t0 = Date.now()
  const result = playGame(seed, playerCount)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)

  totalDecisions += result.logs.length
  if (result.winner === 'expert') expertWins++
  totalExpertScore += result.expertScore
  totalOpponentScore += result.opponentScore

  allLogs.push({
    states: result.logs.map(l => l.state),
    actions: result.logs.map(l => l.actionIndex),
    expertScore: result.expertScore,
    opponentScore: result.opponentScore,
  })

  if ((i + 1) % 10 === 0 || i === 0) {
    const winRate = (100 * expertWins / (i + 1)).toFixed(1)
    const avgExpert = (totalExpertScore / (i + 1)).toFixed(0)
    const avgOpp = (totalOpponentScore / (i + 1)).toFixed(0)
    console.log(
      `Game ${String(i + 1).padStart(3)} | ` +
      `Expert: ${String(result.expertScore).padStart(4)} | ` +
      `Opponent: ${String(result.opponentScore).padStart(4)} | ` +
      `${result.winner === 'expert' ? 'WIN ' : 'LOSS'} | ` +
      `Win rate: ${winRate}% | ` +
      `Avg: ${avgExpert} vs ${avgOpp} | ` +
      `Decisions: ${result.logs.length} | ` +
      `${elapsed}s`
    )
  }
}

// Save training data
const outPath = join(dataDir, 'expert_games.json')
writeFileSync(outPath, JSON.stringify({
  metadata: {
    numGames,
    playerCount,
    totalDecisions,
    expertWinRate: expertWins / numGames,
    avgExpertScore: totalExpertScore / numGames,
    avgOpponentScore: totalOpponentScore / numGames,
    expertConfig: EXPERT_CONFIG,
    opponentPersonality: OPPONENT_PERSONALITY,
  },
  games: allLogs,
}, null, 2))

console.log(`\n${'═'.repeat(60)}`)
console.log(`  RESULTS`)
console.log(`${'═'.repeat(60)}`)
console.log(`  Games played:      ${numGames}`)
console.log(`  Expert wins:       ${expertWins}/${numGames} (${(100 * expertWins / numGames).toFixed(1)}%)`)
console.log(`  Avg expert score:  ${(totalExpertScore / numGames).toFixed(1)}`)
console.log(`  Avg opponent score: ${(totalOpponentScore / numGames).toFixed(1)}`)
console.log(`  Total decisions:   ${totalDecisions}`)
console.log(`  Saved to:          ${outPath}`)
console.log(`${'═'.repeat(60)}\n`)
