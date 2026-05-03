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
import { isValidRun, isValidSet, buildMeld, canLayOff, findSwappableJoker, evaluateLayOffReversal } from '../../src/game/meld-validator'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, cardPoints } from '../../src/game/rules'
import { scoreRound } from '../../src/game/scoring'
import {
  aiFindBestMelds,
  aiShouldTakeDiscard,
  aiChooseDiscard,
  aiShouldBuy,
  aiFindLayOff,
  aiFindJokerSwap,
  aiShouldBuy,
  getAIEvalConfig,
  evaluateHand,
} from '../../src/game/ai'
import { encodeMeldPlan } from './meld-plan-encoder'
import type { Card, Meld, RoundRequirement, AIPersonality } from '../../src/game/types'
import * as readline from 'readline'

// ── V3 Opponent Action Tracking ─────────────────────────────────────────────
// 18-dim vector tracking what opponents did between player 0's turns.
// Layout:
//   [0]    total opponent actions count since last player 0 decision
//   [1]    any opponent went down (binary)
//   [2]    any opponent went out (binary)
//   [3-8]  2nd-most-recent opponent discard pickup (6 card features)
//   [9-14] most-recent opponent discard pickup (6 card features)
//   [15]   opponent buys count this interval
//   [16]   opponent layoffs count this interval
//   [17]   reserved/padding (0)

let oppActionsSinceLast: number[] = new Array(18).fill(0)

function resetOppActionsSinceLast(): void {
  oppActionsSinceLast = new Array(18).fill(0)
}

function recordOpponentAction(g: BridgeGameState, action: string, playerIdx: number): void {
  // Increment total action count
  oppActionsSinceLast[0]++

  // Check if opponent went down (melded)
  if (action === 'meld') {
    oppActionsSinceLast[1] = 1
  }

  // Check if opponent went out (hand empty after meld/layoff)
  if (g.players[playerIdx].hand.length === 0) {
    oppActionsSinceLast[2] = 1
  }

  // Track discard pickups (take_discard or buy)
  if (action === 'take_discard' || action === 'buy') {
    // Shift most-recent to 2nd-most-recent
    for (let i = 3; i <= 8; i++) {
      oppActionsSinceLast[i] = oppActionsSinceLast[i + 6]
    }
    // Encode the picked-up card as most-recent
    const hist = g.opponentHistory[playerIdx]
    const lastPickup = hist.pickups.length > 0 ? hist.pickups[hist.pickups.length - 1] : null
    if (lastPickup) {
      const encoded = encodeCard(lastPickup)
      for (let i = 0; i < 6; i++) {
        oppActionsSinceLast[9 + i] = encoded[i]
      }
    }
  }

  // Track buys
  if (action === 'buy') {
    oppActionsSinceLast[15]++
  }

  // Track layoffs
  if (action.startsWith('layoff:')) {
    oppActionsSinceLast[16]++
  }
}

// ── Game State ──────────────────────────────────────────────────────────────

interface OpponentHistory {
  discards: Card[]    // rolling last 10 discards by this player
  pickups: Card[]     // rolling last 5 cards this player took from discard pile
  layoffCount: number // number of cards laid off this round
}

interface BridgeGameState {
  players: BridgePlayer[]
  currentPlayerIndex: number
  dealerIndex: number  // rotates each round — matches production simulate.ts
  currentRound: number
  drawPile: Card[]
  discardPile: Card[]
  tableMelds: Meld[]
  requirement: RoundRequirement
  phase: 'draw' | 'action' | 'buy-window' | 'round-end' | 'game-over'
  deckCount: number
  seed: number
  roundSeeds: number[]
  gameOver: boolean
  scores: number[][] // roundScores per player
  turnCount: number  // turns this round — force end at 200
  opponentAI: AIPersonality | null  // null = random opponents (legacy), string = AI personality
  useRichState: boolean  // if true, encodeRichState() is used instead of encodeState()
  useRichStateV2: boolean  // if true, encodeRichStateV2() is used (separate opponent raw)
  useRichStateV3: boolean  // if true, v2 + meldPlan (30) + opponentActionsSinceLast (18)
  lastDiscarderIndex: number  // who discarded last (for buy window exclusion)
  buyWindowState: {
    offeredCard: Card     // the discard being offered for buying
    queue: number[]       // remaining player indices to ask about buying
    drawPlayerIndex: number // the next-in-turn player who declined free take
  } | null
  opponentHistory: OpponentHistory[]
}

interface BridgePlayer {
  hand: Card[]
  hasLaidDown: boolean
  buysRemaining: number
  melds: Meld[]
}

let game: BridgeGameState | null = null

// ── Game Logic ──────────────────────────────────────────────────────────────

function initGame(playerCount: number, seed: number, opponentAI: AIPersonality | null = null): BridgeGameState {
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

  const opponentHistory: OpponentHistory[] = []
  for (let i = 0; i < playerCount; i++) {
    opponentHistory.push({ discards: [], pickups: [], layoffCount: 0 })
  }

  return {
    players,
    currentPlayerIndex: 0,
    dealerIndex: 0,
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
    opponentAI: opponentAI,
    useRichState: false,
    useRichStateV2: false,
    useRichStateV3: false,
    lastDiscarderIndex: -1,
    buyWindowState: null,
    opponentHistory,
  }
}

function getValidActions(g: BridgeGameState): string[] {
  const player = g.players[g.currentPlayerIndex]
  const actions: string[] = []

  if (g.phase === 'buy-window') {
    actions.push('buy')
    actions.push('decline_buy')
  } else if (g.phase === 'draw') {
    actions.push('draw_pile')
    if (g.discardPile.length > 0) actions.push('take_discard')
  } else if (g.phase === 'action') {
    // Can discard unless it's your last card (can't go out by discarding).
    // IMPORTANT: discard slots are indices into the SORTED hand (sortHandForEncoding),
    // not the raw hand. This matches the state encoder so the model sees the
    // same card at slot N as it removes by saying discard:N.
    if (player.hand.length > 1) {
      for (let i = 0; i < player.hand.length; i++) {
        actions.push(`discard:${i}`)
      }
    }
    // Can lay down if not already and has valid melds
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, g.requirement)
      if (melds) actions.push('meld')
    }
    // Can lay off if has laid down.
    // Layoff indices still use the RAW hand order (not sorted) because
    // layoff is auto-executed by the env wrapper, not chosen by the model.
    if (player.hasLaidDown) {
      for (let ci = 0; ci < player.hand.length; ci++) {
        for (let mi = 0; mi < g.tableMelds.length; mi++) {
          if (canLayOff(player.hand[ci], g.tableMelds[mi])) {
            actions.push(`layoff:${ci}:${mi}`)
          }
        }
      }
    }
    // Deadlock prevention: if player has 1 card and no actions available, force discard
    if (actions.length === 0 && player.hand.length === 1) {
      actions.push('discard:0')
    }
  }

  return actions
}

function takeAction(g: BridgeGameState, action: string): { reward: number; done: boolean } {
  const player = g.players[g.currentPlayerIndex]

  // ── Buy / Decline Buy ────────────────────────────────────────────────────
  if (action === 'buy') {
    if (!g.buyWindowState) return { reward: 0, done: false }
    const bws = g.buyWindowState
    // Player buys: gets the offered discard + 1 penalty card from pile
    ensureDrawPile(g)
    const penaltyCard = g.drawPile.shift()!
    player.hand.push(bws.offeredCard)
    player.hand.push(penaltyCard)
    player.buysRemaining--
    // Track the pickup (buying = picking up from discard)
    g.opponentHistory[g.currentPlayerIndex].pickups.push(bws.offeredCard)
    if (g.opponentHistory[g.currentPlayerIndex].pickups.length > 5) {
      g.opponentHistory[g.currentPlayerIndex].pickups.shift()
    }
    // Remove the offered card from discard pile
    const discIdx = g.discardPile.findIndex(c => c.id === bws.offeredCard.id)
    if (discIdx >= 0) g.discardPile.splice(discIdx, 1)
    // Buy resolved — next-in-turn player now draws from pile
    g.currentPlayerIndex = bws.drawPlayerIndex
    g.phase = 'draw'
    g.buyWindowState = null
    g.lastDiscarderIndex = -1
    return { reward: 0, done: false }
  }

  if (action === 'decline_buy') {
    if (!g.buyWindowState) return { reward: 0, done: false }
    const bws = g.buyWindowState
    // Player 0 declined — continue asking remaining AI players in queue
    const resolved = processBuyQueueAI(g, bws)
    if (resolved) return { reward: 0, done: false } // an AI bought, state already updated
    // Nobody bought — next-in-turn player draws from pile
    g.currentPlayerIndex = bws.drawPlayerIndex
    g.phase = 'draw'
    g.buyWindowState = null
    // Clear lastDiscarderIndex so the subsequent draw_pile doesn't re-open the same buy window
    g.lastDiscarderIndex = -1
    return { reward: 0, done: false }
  }

  // ── Draw from pile (= decline free take → may open buy window) ──────────
  if (action === 'draw_pile') {
    const topDiscard = g.discardPile.length > 0 ? g.discardPile[g.discardPile.length - 1] : null

    // Check if this is a "decline free take" — open buy window for other players
    if (topDiscard && g.players.length > 2 && g.lastDiscarderIndex >= 0) {
      const buyResult = openBuyWindow(g, topDiscard)
      if (buyResult === 'paused') {
        // Buy window paused for player 0's decision — don't draw yet
        return { reward: 0, done: false }
      }
      // buyResult === 'resolved' or 'nobody' — continue with draw
    }

    ensureDrawPile(g)
    const card = g.drawPile.shift()!
    player.hand.push(card)
    g.phase = 'action'
    return { reward: 0, done: false }
  }

  // ── Take discard (= free take under Rule 9A) ───────────────────────────
  if (action === 'take_discard') {
    const card = g.discardPile.pop()!
    player.hand.push(card)
    g.opponentHistory[g.currentPlayerIndex].pickups.push(card)
    if (g.opponentHistory[g.currentPlayerIndex].pickups.length > 5) {
      g.opponentHistory[g.currentPlayerIndex].pickups.shift()
    }
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
      // Scenario C: check if lay-off would leave exactly 1 unplayable card
      const reversal = evaluateLayOffReversal(card, meld, player.hand, g.tableMelds)
      if (reversal.outcome === 'reversed' && reversal.discardCard) {
        // Reverse: don't lay off, force discard the stuck card instead
        const stuckIdx = player.hand.findIndex(c => c.id === reversal.discardCard!.id)
        if (stuckIdx >= 0) {
          const reversedCard = player.hand.splice(stuckIdx, 1)[0]
          g.discardPile.push(reversedCard)
          // Track the discard from reversal
          g.opponentHistory[g.currentPlayerIndex].discards.push(reversedCard)
          if (g.opponentHistory[g.currentPlayerIndex].discards.length > 10) {
            g.opponentHistory[g.currentPlayerIndex].discards.shift()
          }
          g.currentPlayerIndex = (g.currentPlayerIndex + 1) % g.players.length
          g.phase = 'draw'
          g.turnCount++
          if (g.turnCount >= 200) return endRound(g)
          return { reward: 0, done: false }
        }
      }
      // Normal lay-off
      player.hand.splice(ci, 1)
      meld.cards.push(card)
      g.opponentHistory[g.currentPlayerIndex].layoffCount++
      if (player.hand.length === 0) {
        return endRound(g)
      }
    }
    return { reward: 0, done: false }
  }

  if (action.startsWith('discard:')) {
    // Can't go out by discarding last card — must meld or lay off
    if (player.hand.length <= 1) return { reward: 0, done: false }
    // The incoming index refers to the SORTED hand (what the model sees).
    // Translate it to the raw hand index by matching card id.
    const sortedIdx = parseInt(action.split(':')[1])
    const sortedHand = sortHandForEncoding(player.hand)
    if (sortedIdx < 0 || sortedIdx >= sortedHand.length) {
      return { reward: 0, done: false }
    }
    const targetCard = sortedHand[sortedIdx]
    const rawIdx = player.hand.findIndex(c => c.id === targetCard.id)
    if (rawIdx < 0) return { reward: 0, done: false }
    const card = player.hand.splice(rawIdx, 1)[0]
    g.discardPile.push(card)

    // Track the discard in opponent history
    g.opponentHistory[g.currentPlayerIndex].discards.push(card)
    if (g.opponentHistory[g.currentPlayerIndex].discards.length > 10) {
      g.opponentHistory[g.currentPlayerIndex].discards.shift()
    }

    // Track who discarded (for buy window exclusion)
    g.lastDiscarderIndex = g.currentPlayerIndex

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

// ── Buy Window Helpers ────────────────────────────────────────────────────

function ensureDrawPile(g: BridgeGameState) {
  if (g.drawPile.length === 0) {
    const top = g.discardPile.pop()
    g.drawPile = shuffle([...g.discardPile])
    g.discardPile = top ? [top] : []
    if (g.drawPile.length === 0) {
      g.drawPile = shuffle(createDecks(1))
    }
  }
}

/**
 * Open a buy window after the next-in-turn player declines the free take.
 * Returns 'paused' if player 0 has a buy decision, 'resolved' if an AI bought,
 * or 'nobody' if no one wanted to buy.
 */
function openBuyWindow(g: BridgeGameState, offeredCard: Card): 'paused' | 'resolved' | 'nobody' {
  const drawPlayerIndex = g.currentPlayerIndex  // the player who declined free take
  const discarderIndex = g.lastDiscarderIndex

  // Build buy queue: all players except discarder and next-in-turn, with buys remaining
  const queue: number[] = []
  for (let offset = 1; offset < g.players.length; offset++) {
    const pi = (drawPlayerIndex + offset) % g.players.length
    if (pi === discarderIndex) continue
    if (g.players[pi].buysRemaining <= 0) continue
    queue.push(pi)
  }

  if (queue.length === 0) return 'nobody'

  // Process AI players before player 0
  for (let i = 0; i < queue.length; i++) {
    const pi = queue[i]
    if (pi === 0) {
      // Player 0's turn to decide — pause for RL agent
      g.buyWindowState = {
        offeredCard,
        queue: queue.slice(i + 1), // remaining AI players after player 0
        drawPlayerIndex,
      }
      g.currentPlayerIndex = 0
      g.phase = 'buy-window'
      return 'paused'
    }

    // AI player decides
    if (g.opponentAI) {
      const config = getAIEvalConfig(g.opponentAI)
      const aiPlayer = g.players[pi]
      const shouldBuy = aiShouldBuy(
        aiPlayer.hand, offeredCard, g.requirement, aiPlayer.buysRemaining, config
      )
      if (shouldBuy) {
        // AI buys: gets discard + penalty card
        ensureDrawPile(g)
        const penaltyCard = g.drawPile.shift()!
        aiPlayer.hand.push(offeredCard)
        aiPlayer.hand.push(penaltyCard)
        aiPlayer.buysRemaining--
        // Track the pickup (AI buying from discard)
        g.opponentHistory[pi].pickups.push(offeredCard)
        if (g.opponentHistory[pi].pickups.length > 5) {
          g.opponentHistory[pi].pickups.shift()
        }
        // Remove offered card from discard pile
        const discIdx = g.discardPile.findIndex(c => c.id === offeredCard.id)
        if (discIdx >= 0) g.discardPile.splice(discIdx, 1)
        // V3: record opponent buy action
        if (g.useRichStateV3 && pi !== 0) recordOpponentAction(g, 'buy', pi)
        return 'resolved'
      }
    }
  }

  return 'nobody'
}

/**
 * Continue processing the buy queue after player 0 declined.
 * Returns true if an AI player bought (state updated), false if nobody bought.
 */
function processBuyQueueAI(g: BridgeGameState, bws: NonNullable<BridgeGameState['buyWindowState']>): boolean {
  if (!g.opponentAI) return false

  const config = getAIEvalConfig(g.opponentAI)
  for (const pi of bws.queue) {
    const aiPlayer = g.players[pi]
    if (aiPlayer.buysRemaining <= 0) continue
    const shouldBuy = aiShouldBuy(
      aiPlayer.hand, bws.offeredCard, g.requirement, aiPlayer.buysRemaining, config
    )
    if (shouldBuy) {
      ensureDrawPile(g)
      const penaltyCard = g.drawPile.shift()!
      aiPlayer.hand.push(bws.offeredCard)
      aiPlayer.hand.push(penaltyCard)
      aiPlayer.buysRemaining--
      // Track the pickup (AI buying from discard)
      g.opponentHistory[pi].pickups.push(bws.offeredCard)
      if (g.opponentHistory[pi].pickups.length > 5) {
        g.opponentHistory[pi].pickups.shift()
      }
      const discIdx = g.discardPile.findIndex(c => c.id === bws.offeredCard.id)
      if (discIdx >= 0) g.discardPile.splice(discIdx, 1)
      // V3: record opponent buy action
      if (g.useRichStateV3 && pi !== 0) recordOpponentAction(g, 'buy', pi)
      // Next-in-turn player draws
      g.currentPlayerIndex = bws.drawPlayerIndex
      g.phase = 'draw'
      g.buyWindowState = null
      return true
    }
  }
  return false
}

function endRound(g: BridgeGameState): { reward: number; done: boolean } {
  // Score each player
  for (let i = 0; i < g.players.length; i++) {
    const p = g.players[i]
    if (p.hand.length === 0) {
      g.scores[i].push(0) // went out
    } else if (!p.hasLaidDown) {
      // Shanghaied — normal hand score (no multiplier; flag is just metadata)
      const pts = p.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)
      g.scores[i].push(pts)
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
  // Rotate dealer; starting player = (nextDealer + 1) mod N.
  // Matches production src/simulation/simulate.ts — without this, player 0
  // starts every round and gains a ~135-point compounded advantage in 2P.
  const nextDealer = (g.dealerIndex + 1) % g.players.length
  g.dealerIndex = nextDealer
  g.currentPlayerIndex = (nextDealer + 1) % g.players.length
  g.phase = 'draw'
  g.turnCount = 0
  g.lastDiscarderIndex = -1
  g.buyWindowState = null

  for (let i = 0; i < g.players.length; i++) {
    g.players[i].hand = hands[i]
    g.players[i].hasLaidDown = false
    g.players[i].buysRemaining = 5
    g.players[i].melds = []
    g.opponentHistory[i].layoffCount = 0
  }

  // V3: reset opponent action tracking at round boundaries
  if (g.useRichStateV3) resetOppActionsSinceLast()

  return { reward: 0, done: false }
}

// ── AI Opponent Logic ──────────────────────────────────────────────────────

/** Play one full turn for an AI opponent (draw → actions → discard). */
function playAITurn(g: BridgeGameState): { reward: number; done: boolean } {
  const personality = g.opponentAI!
  const config = getAIEvalConfig(personality)
  const player = g.players[g.currentPlayerIndex]
  const oppIdx = g.currentPlayerIndex

  // Phase: draw — decide whether to take discard or draw from pile
  if (g.phase === 'draw') {
    const topDiscard = g.discardPile[g.discardPile.length - 1]
    let shouldTake = false
    if (topDiscard) {
      shouldTake = aiShouldTakeDiscard(
        player.hand, topDiscard, g.requirement, player.hasLaidDown,
        config, g.tableMelds
      )
    }
    const drawAction = shouldTake ? 'take_discard' : 'draw_pile'
    const drawResult = takeAction(g, drawAction)
    if (g.useRichStateV3) recordOpponentAction(g, drawAction, oppIdx)
    if (drawResult.done) return drawResult
    // If draw_pile opened a buy window for player 0, stop here
    if (g.phase === 'buy-window') return { reward: 0, done: false }
  }

  // Phase: action — meld if possible, then lay off, then discard
  if (g.phase === 'action') {
    // Try to meld
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, g.requirement)
      if (melds) {
        const meldResult = takeAction(g, 'meld')
        if (g.useRichStateV3) recordOpponentAction(g, 'meld', oppIdx)
        if (meldResult.done) return meldResult
      }
    }

    // Try joker swaps
    if (player.hasLaidDown) {
      const swap = aiFindJokerSwap(player.hand, g.tableMelds)
      if (swap) {
        // Find matching card and meld indices
        const ci = player.hand.findIndex(c => c.id === swap.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === swap.meld.id)
        if (ci >= 0 && mi >= 0) {
          // Joker swap: replace joker in meld with natural card, take joker
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

    // Try lay offs
    if (player.hasLaidDown) {
      let layoff = aiFindLayOff(player.hand, g.tableMelds)
      let maxLayoffs = 10 // safety limit
      while (layoff && maxLayoffs-- > 0) {
        const ci = player.hand.findIndex(c => c.id === layoff!.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === layoff!.meld.id)
        if (ci >= 0 && mi >= 0) {
          const layoffAction = `layoff:${ci}:${mi}`
          const result = takeAction(g, layoffAction)
          if (g.useRichStateV3) recordOpponentAction(g, layoffAction, oppIdx)
          if (result.done) return result
        } else {
          break
        }
        layoff = aiFindLayOff(player.hand, g.tableMelds)
      }
    }

    // Discard — emit sorted index (takeAction expects sorted index since
    // the discard-indexing fix that aligned actions with the state encoder).
    if (g.phase === 'action' && player.hand.length > 0) {
      const discardCard = aiChooseDiscard(player.hand, g.requirement, config, g.tableMelds)
      const sortedHand = sortHandForEncoding(player.hand)
      const sortedIdx = sortedHand.findIndex(c => c.id === discardCard.id)
      if (sortedIdx >= 0) {
        const discardAction = `discard:${sortedIdx}`
        if (g.useRichStateV3) recordOpponentAction(g, discardAction, oppIdx)
        return takeAction(g, discardAction)
      }
      // Fallback: discard last sorted slot
      const fallbackAction = `discard:${sortedHand.length - 1}`
      if (g.useRichStateV3) recordOpponentAction(g, fallbackAction, oppIdx)
      return takeAction(g, fallbackAction)
    }
  }

  return { reward: 0, done: false }
}

/** Return the AI's recommended action for the current player/phase without executing it. */
function getAIRecommendedAction(g: BridgeGameState): string {
  const personality = g.opponentAI ?? 'the-shark'
  const config = getAIEvalConfig(personality as AIPersonality)
  const player = g.players[g.currentPlayerIndex]

  if (g.phase === 'buy-window') {
    const offered = g.buyWindowState?.offeredCard
    if (offered) {
      const shouldBuy = aiShouldBuy(
        player.hand, offered, g.requirement, player.buysRemaining, config
      )
      return shouldBuy ? 'buy' : 'decline_buy'
    }
    return 'decline_buy'
  }

  if (g.phase === 'draw') {
    const topDiscard = g.discardPile[g.discardPile.length - 1]
    if (topDiscard) {
      const shouldTake = aiShouldTakeDiscard(
        player.hand, topDiscard, g.requirement, player.hasLaidDown,
        config, g.tableMelds
      )
      if (shouldTake) return 'take_discard'
    }
    return 'draw_pile'
  }

  if (g.phase === 'action') {
    // Meld if possible
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, g.requirement)
      if (melds) return 'meld'
    }

    // Layoff if possible
    if (player.hasLaidDown) {
      const layoff = aiFindLayOff(player.hand, g.tableMelds)
      if (layoff) {
        const ci = player.hand.findIndex(c => c.id === layoff.card.id)
        const mi = g.tableMelds.findIndex(m => m.id === layoff.meld.id)
        if (ci >= 0 && mi >= 0) return `layoff:${ci}:${mi}`
      }
    }

    // Discard — emit sorted index (see takeAction for why).
    if (player.hand.length > 0) {
      const discardCard = aiChooseDiscard(player.hand, g.requirement, config, g.tableMelds)
      const sortedHand = sortHandForEncoding(player.hand)
      const sortedIdx = sortedHand.findIndex(c => c.id === discardCard.id)
      if (sortedIdx >= 0) return `discard:${sortedIdx}`
      return `discard:${sortedHand.length - 1}`
    }
  }

  return 'draw_pile'
}

/** Auto-play all opponent turns until it's player 0's turn, a buy window opens, or game ends. */
function autoPlayOpponents(g: BridgeGameState): { reward: number; done: boolean } {
  let result = { reward: 0, done: false }
  let safety = 500 // prevent infinite loops

  while (g.currentPlayerIndex !== 0 && !g.gameOver && g.phase !== 'buy-window' && safety-- > 0) {
    result = playAITurn(g)
    if (result.done) return result
    // If a buy window opened for player 0 during AI play, stop
    if (g.phase === 'buy-window') return result
  }

  return result
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

  // Buy window indicator (1 feature)
  features.push(g.phase === 'buy-window' ? 1 : 0)

  return features // Total: ~66 features
}

/**
 * Encode a single card into 6 features:
 *   [rank/13, hearts?, diamonds?, clubs?, spades?, is_joker?]
 * Suit encoding is one-hot: hearts=[1,0,0,0], diamonds=[0,1,0,0],
 *   clubs=[0,0,1,0], spades=[0,0,0,1], joker=[0,0,0,0] (is_joker=1).
 */
function encodeCard(card: Card): number[] {
  if (card.suit === 'joker') {
    return [0, 0, 0, 0, 0, 1]
  }
  const suitVec = [
    card.suit === 'hearts'   ? 1 : 0,
    card.suit === 'diamonds' ? 1 : 0,
    card.suit === 'clubs'    ? 1 : 0,
    card.suit === 'spades'   ? 1 : 0,
  ]
  return [card.rank / 13, ...suitVec, 0]
}

/**
 * Deterministic sort used by BOTH state encoding AND discard action indexing.
 *
 * Sort order: rank-first ascending, then suit, with jokers at the END.
 * Rationale:
 *   - Slot 0 = lowest-rank card, slot N-1 = highest-rank non-joker (or joker).
 *   - This gives the model a stable semantic mapping: "discard highest slot"
 *     consistently means "discard the highest-rank card."
 *   - Jokers (rank=0) are placed last so they're rarely targeted by a naive
 *     high-slot heuristic — the model can learn "avoid the last slot if joker."
 *   - Tie-breaking by suit then id ensures full determinism across state reads.
 *
 * CRITICAL: getValidActions and takeAction('discard:N') MUST use this same
 * ordering so the action index the model picks corresponds to the card the
 * model actually sees at slot N in the state vector.
 */
const SUIT_ORDER: Record<string, number> = {
  hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4,
}

function sortHandForEncoding(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    // Jokers (rank 0) go to the end — treat as rank 14
    const ra = a.suit === 'joker' ? 14 : a.rank
    const rb = b.suit === 'joker' ? 14 : b.rank
    if (ra !== rb) return ra - rb
    const sa = SUIT_ORDER[a.suit]
    const sb = SUIT_ORDER[b.suit]
    if (sa !== sb) return sa - sb
    // Final tie-break by id for full determinism across duplicate cards
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Encode raw observable data for a single opponent — 126 features.
 *
 * Layout:
 *   Discard history  60 (10 × 6 card features)
 *   Pickup history   30 (5 × 6 card features)
 *   Meld composition 30 (6 × 5 meld features)
 *   Scalar stats      6
 *                   ---
 *   Total           126
 */
function encodeOpponentRaw(
  g: BridgeGameState,
  oppIdx: number,
  playerIdx: number,
): number[] {
  const opp = g.players[oppIdx]
  const hist = g.opponentHistory[oppIdx]
  const features: number[] = []

  // ── Discard history (60 features: 10 × 6) ──
  const MAX_OPP_DISCARDS = 10
  for (let i = 0; i < MAX_OPP_DISCARDS; i++) {
    if (i < hist.discards.length) {
      features.push(...encodeCard(hist.discards[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Pickup history (30 features: 5 × 6) ──
  const MAX_OPP_PICKUPS = 5
  for (let i = 0; i < MAX_OPP_PICKUPS; i++) {
    if (i < hist.pickups.length) {
      features.push(...encodeCard(hist.pickups[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Meld composition (30 features: 6 × 5) ──
  const MAX_OPP_MELDS = 6
  for (let i = 0; i < MAX_OPP_MELDS; i++) {
    if (i < opp.melds.length) {
      const meld = opp.melds[i]
      const isRun = meld.type === 'run' ? 1 : 0
      const cardCount = meld.cards.length / 8
      const hasJoker = meld.cards.some(c => c.suit === 'joker') ? 1 : 0
      let minRank: number, maxRank: number
      if (meld.type === 'run') {
        const naturalRanks = meld.cards.filter(c => c.suit !== 'joker').map(c => c.rank)
        minRank = meld.runMin !== undefined ? meld.runMin : (naturalRanks.length > 0 ? Math.min(...naturalRanks) : 0)
        maxRank = meld.runMax !== undefined ? meld.runMax : (naturalRanks.length > 0 ? Math.max(...naturalRanks) : 0)
      } else {
        const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank ?? 0
        minRank = setRank
        maxRank = setRank
      }
      features.push(isRun, cardCount, minRank / 13, maxRank / 13, hasJoker)
    } else {
      features.push(0, 0, 0, 0, 0)
    }
  }

  // ── Scalar stats (6 features) ──
  const oppScore = g.scores[oppIdx].reduce((a, b) => a + b, 0)
  const allScores = g.scores.map(rs => rs.reduce((a, b) => a + b, 0))
  const minScore = Math.min(...allScores)

  features.push(opp.hand.length / 16)           // hand size
  features.push(opp.hasLaidDown ? 1 : 0)         // laid down
  features.push(opp.buysRemaining / 5)            // buys remaining
  features.push(hist.layoffCount / 10)             // cards laid off this round
  features.push(oppScore / 300)                    // cumulative score
  features.push(oppScore === minScore ? 1 : 0)    // is winning

  return features // Total: 126
}

/**
 * V2 Rich state encoding — returns base state (264) + opponent raw (378) separately.
 *
 * Base state layout:
 *   Hand cards      132 (22 × 6)
 *   Discard history  60 (10 × 6)
 *   Table melds      60 (12 × 5)
 *   Game context     12 (no opponent features — those are in opponent_raw)
 *                   ---
 *   Total           264
 */
function encodeRichStateV2(
  g: BridgeGameState,
  playerIdx: number,
): { state: number[]; opponentRaw: number[] } {
  const p = g.players[playerIdx]
  const features: number[] = []

  // ── Hand cards (132 features: 22 × 6) — same as v1 ──
  // Rank-first sort — see sortHandForEncoding docstring.
  const sortedHand = sortHandForEncoding(p.hand)
  const MAX_HAND = 22
  for (let i = 0; i < MAX_HAND; i++) {
    if (i < sortedHand.length) {
      features.push(...encodeCard(sortedHand[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Discard history (60 features: 10 × 6) — same as v1 ──
  const MAX_DISCARD = 10
  const discardSlice = g.discardPile.slice(-MAX_DISCARD)
  for (let i = 0; i < MAX_DISCARD; i++) {
    if (i < discardSlice.length) {
      features.push(...encodeCard(discardSlice[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0)
    }
  }

  // ── Table melds (60 features: 12 × 5) — same as v1 ──
  const MAX_MELDS = 12
  for (let i = 0; i < MAX_MELDS; i++) {
    if (i < g.tableMelds.length) {
      const meld = g.tableMelds[i]
      const isRun = meld.type === 'run' ? 1 : 0
      const cardCount = meld.cards.length / 8
      const hasJoker = meld.cards.some(c => c.suit === 'joker') ? 1 : 0
      let minRank: number, maxRank: number
      if (meld.type === 'run') {
        const naturalRanks = meld.cards.filter(c => c.suit !== 'joker').map(c => c.rank)
        minRank = meld.runMin !== undefined ? meld.runMin : (naturalRanks.length > 0 ? Math.min(...naturalRanks) : 0)
        maxRank = meld.runMax !== undefined ? meld.runMax : (naturalRanks.length > 0 ? Math.max(...naturalRanks) : 0)
      } else {
        const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank ?? 0
        minRank = setRank
        maxRank = setRank
      }
      features.push(isRun, cardCount, minRank / 13, maxRank / 13, hasJoker)
    } else {
      features.push(0, 0, 0, 0, 0)
    }
  }

  // ── Game context V2 (12 features — NO opponent features) ──
  features.push(g.currentRound / 7)
  features.push(g.requirement.sets / 3)
  features.push(g.requirement.runs / 3)
  features.push(g.drawPile.length / 108)
  features.push(g.discardPile.length / 108)
  features.push(p.buysRemaining / 5)
  features.push(p.hasLaidDown ? 1 : 0)
  const handPoints = p.hand.reduce((s, c) => s + cardPoints(c.rank), 0)
  features.push(handPoints / 200)
  features.push(g.turnCount / 200)
  features.push(g.phase === 'buy-window' ? 1 : 0)
  const ownScore = g.scores[playerIdx].reduce((a, b) => a + b, 0)
  features.push(ownScore / 300)
  features.push(g.players.length / 8)

  // ── Opponent raw features (3 × 126 = 378) ──
  const MAX_OPPONENTS = 3
  const opponentRaw: number[] = []
  let oppSlot = 0
  for (let i = 0; i < g.players.length && oppSlot < MAX_OPPONENTS; i++) {
    if (i === playerIdx) continue
    opponentRaw.push(...encodeOpponentRaw(g, i, playerIdx))
    oppSlot++
  }
  while (oppSlot < MAX_OPPONENTS) {
    for (let f = 0; f < 126; f++) opponentRaw.push(0)
    oppSlot++
  }

  return { state: features, opponentRaw }
}

/**
 * Rich state encoding — 237 features total.
 *
 * Layout:
 *   Hand cards      132 (22 slots × 6 features, zero-padded, sorted by suit then rank)
 *   Discard history 60  (10 slots × 6 features, zero-padded)
 *   Table melds     60  (12 slots × 5 features, zero-padded)
 *   Game context    21
 *                  ---
 *   Total          273
 */
function encodeRichState(g: BridgeGameState, playerIdx: number): number[] {
  const p = g.players[playerIdx]
  const features: number[] = []

  // ── Hand cards (132 features: 22 × 6) ────────────────────────────────────
  // Rank-first sort — see sortHandForEncoding docstring.
  // This MUST match the sort used by getValidActions/takeAction for discards.
  const sortedHand = sortHandForEncoding(p.hand)
  const MAX_HAND = 22
  for (let i = 0; i < MAX_HAND; i++) {
    if (i < sortedHand.length) {
      features.push(...encodeCard(sortedHand[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0) // padding
    }
  }

  // ── Discard history (60 features: 10 × 6) ────────────────────────────────
  // Take the last 10 cards from the discard pile (most recent last)
  const MAX_DISCARD = 10
  const discardSlice = g.discardPile.slice(-MAX_DISCARD)
  for (let i = 0; i < MAX_DISCARD; i++) {
    if (i < discardSlice.length) {
      features.push(...encodeCard(discardSlice[i]))
    } else {
      features.push(0, 0, 0, 0, 0, 0) // padding
    }
  }

  // ── Table melds (60 features: 12 × 5) ────────────────────────────────────
  // Per meld: [type_is_run, card_count/8, min_rank/13, max_rank/13, has_joker]
  const MAX_MELDS = 12
  for (let i = 0; i < MAX_MELDS; i++) {
    if (i < g.tableMelds.length) {
      const meld = g.tableMelds[i]
      const isRun = meld.type === 'run' ? 1 : 0
      const cardCount = meld.cards.length / 8
      const hasJoker = meld.cards.some(c => c.suit === 'joker') ? 1 : 0
      let minRank: number
      let maxRank: number
      if (meld.type === 'run') {
        // Use runMin/runMax if available, otherwise compute from cards
        const naturalRanks = meld.cards
          .filter(c => c.suit !== 'joker')
          .map(c => c.rank)
        minRank = meld.runMin !== undefined
          ? meld.runMin
          : (naturalRanks.length > 0 ? Math.min(...naturalRanks) : 0)
        maxRank = meld.runMax !== undefined
          ? meld.runMax
          : (naturalRanks.length > 0 ? Math.max(...naturalRanks) : 0)
      } else {
        // Set: all cards share the same rank
        const setRank = meld.cards.find(c => c.suit !== 'joker')?.rank ?? 0
        minRank = setRank
        maxRank = setRank
      }
      features.push(isRun, cardCount, minRank / 13, maxRank / 13, hasJoker)
    } else {
      features.push(0, 0, 0, 0, 0) // padding
    }
  }

  // ── Game context (21 features) ────────────────────────────────────────────
  // Basic round info (8 features)
  features.push(g.currentRound / 7)
  features.push(g.requirement.sets / 3)
  features.push(g.requirement.runs / 3)
  features.push(g.drawPile.length / 108)
  features.push(g.discardPile.length / 108)
  features.push(p.buysRemaining / 5)
  features.push(p.hasLaidDown ? 1 : 0)
  const handPoints = p.hand.reduce((s, c) => s + cardPoints(c.rank), 0)
  features.push(handPoints / 200)

  // Turn info + buy window (2 features)
  features.push(g.turnCount / 200)
  features.push(g.phase === 'buy-window' ? 1 : 0)

  // Per opponent (3 slots × 3 features = 9 features)
  // Slots are filled for opponents only (up to 3), skipping playerIdx
  const MAX_OPPONENTS = 3
  let oppSlot = 0
  for (let i = 0; i < g.players.length && oppSlot < MAX_OPPONENTS; i++) {
    if (i === playerIdx) continue
    const opp = g.players[i]
    const oppScore = g.scores[i].reduce((a, b) => a + b, 0)
    features.push(opp.hand.length / 16)
    features.push(opp.hasLaidDown ? 1 : 0)
    features.push(oppScore / 300)
    oppSlot++
  }
  // Pad remaining opponent slots
  while (oppSlot < MAX_OPPONENTS) {
    features.push(0, 0, 0)
    oppSlot++
  }

  // Own cumulative score + player count (2 features)
  const ownScore = g.scores[playerIdx].reduce((a, b) => a + b, 0)
  features.push(ownScore / 300)
  features.push(g.players.length / 8)

  return features // Total: 96 + 60 + 60 + 21 = 237 features
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
        const ai = cmd.opponent_ai ?? null  // e.g., "the-shark", "the-nemesis"
        game = initGame(cmd.players ?? 2, cmd.seed ?? Math.floor(Math.random() * 2147483647), ai)
        game.useRichState = cmd.rich_state === true
        game.useRichStateV2 = cmd.rich_state_v2 === true || cmd.rich_state_v3 === true
        game.useRichStateV3 = cmd.rich_state_v3 === true
        if (game.useRichStateV3) resetOppActionsSinceLast()
        // If player 0 doesn't go first, auto-play opponents up to player 0
        if (game.opponentAI && game.currentPlayerIndex !== 0) {
          autoPlayOpponents(game)
        }
        const stateVec = game.useRichStateV2
          ? encodeRichStateV2(game, 0).state
          : (game.useRichState ? encodeRichState(game, 0) : encodeState(game, 0))
        respond({ ok: true, state: stateVec, raw_phase: game.phase, round: game.currentRound })
        break
      }

      case 'evaluate_hand': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        const pi = cmd.player ?? game.currentPlayerIndex
        const p = game.players[pi]
        const req = ROUND_REQUIREMENTS[game.currentRound - 1]
        const score = evaluateHand(p.hand, req)
        respond({ ok: true, score })
        break
      }

      case 'get_actions': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        respond({ ok: true, actions: getValidActions(game), phase: game.phase, currentPlayer: game.currentPlayerIndex })
        break
      }

      case 'take_action': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        let { reward, done } = takeAction(game, cmd.action)

        // Auto-play AI opponents after the agent's action (unless buy-window is pending)
        if (!done && game.opponentAI && game.currentPlayerIndex !== 0 && game.phase !== 'buy-window') {
          const oppResult = autoPlayOpponents(game)
          if (oppResult.done) {
            done = true
            reward = oppResult.reward
          }
        }

        const stateVec = game.useRichStateV2
          ? encodeRichStateV2(game, 0).state
          : (game.useRichState ? encodeRichState(game, 0) : encodeState(game, 0))
        const response: Record<string, unknown> = {
          ok: true,
          state: stateVec,
          reward,
          done,
          phase: game.phase,
          round: game.currentRound,
          currentPlayer: game.currentPlayerIndex,
          scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
        }
        if (game.useRichStateV3) {
          response.meldPlan = encodeMeldPlan(game.players[0].hand, game.currentRound)
          response.opponentActionsSinceLast = [...oppActionsSinceLast]
          resetOppActionsSinceLast()
        }
        respond(response)
        break
      }

      case 'encode_state': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        respond({ ok: true, state: encodeState(game, cmd.player ?? 0) })
        break
      }

      case 'get_full_state': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        const pi = cmd.player ?? 0
        const p = game.players[pi]
        if (game.useRichStateV2) {
          const { state: stateVec, opponentRaw } = encodeRichStateV2(game, pi)
          const fullStateResponse: Record<string, unknown> = {
            ok: true,
            state: stateVec,
            opponentRaw,
            hand: p.hand.map(c => ({ rank: c.rank, suit: c.suit, id: c.id })),
            handSize: p.hand.length,
            hasLaidDown: p.hasLaidDown,
            buysRemaining: p.buysRemaining,
            phase: game.phase,
            round: game.currentRound,
            requirement: game.requirement,
            discardTop: game.discardPile.length > 0
              ? { rank: game.discardPile[game.discardPile.length - 1].rank, suit: game.discardPile[game.discardPile.length - 1].suit }
              : null,
            scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
            tableMeldCount: game.tableMelds.length,
          }
          if (game.useRichStateV3) {
            fullStateResponse.meldPlan = encodeMeldPlan(p.hand, game.currentRound)
            fullStateResponse.opponentActionsSinceLast = [...oppActionsSinceLast]
          }
          respond(fullStateResponse)
        } else {
          const stateVec = game.useRichState ? encodeRichState(game, pi) : encodeState(game, pi)
          respond({
            ok: true,
            state: stateVec,
            hand: p.hand.map(c => ({ rank: c.rank, suit: c.suit, id: c.id })),
            handSize: p.hand.length,
            hasLaidDown: p.hasLaidDown,
            buysRemaining: p.buysRemaining,
            phase: game.phase,
            round: game.currentRound,
            requirement: game.requirement,
            discardTop: game.discardPile.length > 0
              ? { rank: game.discardPile[game.discardPile.length - 1].rank, suit: game.discardPile[game.discardPile.length - 1].suit }
              : null,
            scores: game.scores.map(rs => rs.reduce((a, b) => a + b, 0)),
            tableMeldCount: game.tableMelds.length,
          })
        }
        break
      }

      case 'get_ai_action': {
        if (!game) { respond({ ok: false, error: 'No game' }); break }
        const action = getAIRecommendedAction(game)
        respond({ ok: true, action })
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
