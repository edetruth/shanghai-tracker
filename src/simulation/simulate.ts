/**
 * Shanghai Rummy — headless AI simulation engine.
 *
 * Replicates the full game logic from GameBoard.tsx as pure synchronous functions.
 * No React, no delays, no UI. Runs complete 7-round games at maximum speed.
 */

import type { Card, Meld, Player, GameState, PlayerConfig, AIDifficulty } from '../game/types'
import { createDecks, shuffle, dealHands } from '../game/deck'
import { buildMeld, isValidSet, findSwappableJoker, simulateLayOff, canGoOutViaChainLayOff, isLegalDiscard } from '../game/meld-validator'
import { scoreRound, calculateHandScore } from '../game/scoring'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS } from '../game/rules'
import {
  aiFindBestMelds, aiShouldTakeDiscard, aiChooseDiscard, aiShouldBuy,
  aiFindLayOff, aiFindJokerSwap, aiFindPreLayDownJokerSwap,
  getAIEvalConfig, type AIEvalConfig,
} from '../game/ai'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SimConfig {
  numGames: number
  numPlayers: number
  difficulty: AIDifficulty
  logLevel: 'summary' | 'detailed' | 'verbose'
  outputFile?: string
  onlyRounds?: number[]  // if set, only simulate specific round numbers
}

function difficultyToEvalConfig(difficulty: AIDifficulty): AIEvalConfig {
  if (difficulty === 'easy') return getAIEvalConfig('rookie-riley')
  if (difficulty === 'hard') return getAIEvalConfig('the-shark')
  return getAIEvalConfig('steady-sam')
}

export interface PlayerRoundStats {
  drewFromDiscard: number
  drewFromPile: number
  buysMade: number
  buysOffered: number
  turnLaidDown: number     // 1-based turn number; 0 = never laid down
  meldsLaidDown: number
  cardsLaidOff: number
  jokerSwaps: number
  finalHandSize: number
  finalHandValue: number
  wasShanghaied: boolean
}

export interface RoundResult {
  roundNumber: number
  requirement: string
  wentOut: string
  turnsInRound: number
  shanghaiVictims: string[]
  scores: Record<string, number>
  playerStats: Record<string, PlayerRoundStats>
  stalemate: boolean
  jokersDealt: number
  jokersStuckInHand: number
}

export interface GameResult {
  gameId: number
  players: string[]
  winner: string
  finalScores: number[]
  rounds: RoundResult[]
  totalTurns: number
  totalBuys: number
  duration: number
}

// ── Pure game helpers (mirroring GameBoard.tsx) ───────────────────────────────

function initGame(configs: PlayerConfig[]): GameState {
  const deckCount = configs.length <= 4 ? 2 : 3
  const players: Player[] = configs.map((cfg, i) => ({
    id: `p${i}`,
    name: cfg.name,
    hand: [],
    melds: [],
    hasLaidDown: false,
    buysRemaining: MAX_BUYS,
    roundScores: [],
    isAI: true,
  }))
  const deck = shuffle(createDecks(deckCount))
  const cardsDealt = CARDS_DEALT[0]
  const { hands, remaining } = dealHands(deck, players.length, cardsDealt)
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

function setupRound(state: GameState, roundNum: number): GameState {
  const roundIdx = roundNum - 1
  const requirement = ROUND_REQUIREMENTS[roundIdx]
  const cardsDealt = CARDS_DEALT[roundIdx]
  const deck = shuffle(createDecks(state.deckCount))
  const { hands, remaining } = dealHands(deck, state.players.length, cardsDealt)
  const topDiscard = remaining.shift()!
  const dealerIndex = state.roundState.dealerIndex
  const nextDealer = (dealerIndex + 1) % state.players.length
  const firstPlayer = (nextDealer + 1) % state.players.length
  const players = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    melds: [],
    hasLaidDown: false,
    buysRemaining: MAX_BUYS,
  }))
  return {
    ...state,
    players,
    currentRound: roundNum,
    gameOver: false,
    roundState: {
      roundNumber: roundNum,
      requirement,
      cardsDealt,
      drawPile: remaining,
      discardPile: [topDiscard],
      currentPlayerIndex: firstPlayer,
      dealerIndex: nextDealer,
      tablesMelds: [],
      meldIdCounter: 0,
      goOutPlayerId: null,
    },
  }
}

function getCurrentPlayer(state: GameState): Player {
  return state.players[state.roundState.currentPlayerIndex]
}

function advancePlayer(state: GameState): GameState {
  const next = (state.roundState.currentPlayerIndex + 1) % state.players.length
  return { ...state, roundState: { ...state.roundState, currentPlayerIndex: next } }
}

function buildBuyerOrderForDiscard(state: GameState, discarderIndex: number): number[] {
  const order: number[] = []
  const count = state.players.length
  for (let i = 1; i < count; i++) {
    const idx = (discarderIndex + i) % count
    if (state.players[idx].buysRemaining > 0) order.push(idx)
  }
  return order
}

function buildPostDrawBuyerOrder(state: GameState, drewPlayerIdx: number): number[] {
  const order: number[] = []
  const count = state.players.length
  for (let i = 1; i < count; i++) {
    const idx = (drewPlayerIdx + i) % count
    if (state.players[idx].buysRemaining > 0) order.push(idx)
  }
  return order
}

// ── State transformation helpers ─────────────────────────────────────────────

/** Draw a card from the draw pile (reshuffle discard if empty). */
function simDrawFromPile(state: GameState): { state: GameState; reshuffled: boolean } {
  let drawPile = [...state.roundState.drawPile]
  let discardPile = [...state.roundState.discardPile]
  let reshuffled = false
  if (drawPile.length === 0) {
    const top = discardPile.pop()
    drawPile = shuffle([...discardPile])
    discardPile = top ? [top] : []
    reshuffled = true
  }
  const card = drawPile.shift()
  if (!card) return { state, reshuffled }
  const playerIdx = state.roundState.currentPlayerIndex
  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: [...p.hand, card] } : p
  )
  return {
    state: { ...state, players, roundState: { ...state.roundState, drawPile, discardPile } },
    reshuffled,
  }
}

/** Take the top discard card (for free — Rule 9A or player choice). */
function simTakeDiscard(state: GameState): GameState {
  const discardPile = [...state.roundState.discardPile]
  const card = discardPile.pop()
  if (!card) return state
  const playerIdx = state.roundState.currentPlayerIndex
  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: [...p.hand, card] } : p
  )
  return { ...state, players, roundState: { ...state.roundState, discardPile } }
}

/** Discard a card. Returns null if the discard would empty the hand (GDD 6.3: going out via discard is illegal). */
function simDiscard(state: GameState, cardId: string): { state: GameState; card: Card } | null {
  const playerIdx = state.roundState.currentPlayerIndex
  const player = state.players[playerIdx]
  const card = player.hand.find(c => c.id === cardId)
  if (!card) return null
  if (!isLegalDiscard(player.hand, cardId)) return null  // GDD 6.3: cannot discard last card
  const newHand = player.hand.filter(c => c.id !== cardId)
  const discardPile = [...state.roundState.discardPile, card]
  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand } : p
  )
  return {
    state: { ...state, players, roundState: { ...state.roundState, discardPile } },
    card,
  }
}

/** Lay down meld groups. Returns the new state. */
function simMeld(state: GameState, meldGroups: Card[][]): GameState {
  const playerIdx = state.roundState.currentPlayerIndex
  const player = state.players[playerIdx]
  let counter = state.roundState.meldIdCounter
  const meldedIds = new Set(meldGroups.flatMap(g => g.map(c => c.id)))
  const requirement = state.roundState.requirement
  const newMelds: Meld[] = meldGroups.map(cards => {
    // Respect round type: runs-only rounds must classify as run, sets-only as set
    let type: 'set' | 'run'
    if (requirement.sets === 0) type = 'run'
    else if (requirement.runs === 0) type = 'set'
    else type = isValidSet(cards) ? 'set' : 'run'
    const meldId = `meld-${counter++}`
    return buildMeld(cards, type, player.id, player.name, meldId)
  })
  const tablesMelds = [...state.roundState.tablesMelds, ...newMelds]
  const newHand = player.hand.filter(c => !meldedIds.has(c.id))
  const wentOut = newHand.length === 0
  const goOutPlayerId = wentOut ? player.id : state.roundState.goOutPlayerId
  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand, hasLaidDown: true, melds: [...p.melds, ...newMelds] } : p
  )
  return { ...state, players, roundState: { ...state.roundState, tablesMelds, meldIdCounter: counter, goOutPlayerId } }
}

/** Lay off a card onto an existing meld. Returns null if the lay-off would strand the player. */
function simLayOff(state: GameState, card: Card, meld: Meld, jokerPosition?: 'low' | 'high'): GameState | null {
  const playerIdx = state.roundState.currentPlayerIndex
  const player = state.players[playerIdx]
  const newHand = player.hand.filter(c => c.id !== card.id)

  // Safety: block lay-off that leaves 1 card that can't be played anywhere
  if (newHand.length === 1) {
    const simMeld_ = simulateLayOff(card, meld, jokerPosition)
    const updatedMelds = state.roundState.tablesMelds.map(m => m.id === meld.id ? simMeld_ : m)
    if (!canGoOutViaChainLayOff(newHand, updatedMelds)) return null
  }

  // Update meld
  const newJokerMappings = [...meld.jokerMappings]
  let updatedRunMin = meld.runMin
  let updatedRunMax = meld.runMax
  let updatedRunAceHigh = meld.runAceHigh
  let newMeldCards: Card[]

  if (meld.type === 'run') {
    if (card.suit === 'joker') {
      if (jokerPosition === 'low') {
        const newMin = (meld.runMin ?? 1) - 1
        updatedRunMin = newMin
        newJokerMappings.push({ cardId: card.id, representsRank: newMin, representsSuit: meld.runSuit! })
        newMeldCards = [card, ...meld.cards]
      } else {
        const newMax = (meld.runMax ?? 0) + 1
        updatedRunMax = newMax
        newJokerMappings.push({ cardId: card.id, representsRank: newMax, representsSuit: meld.runSuit! })
        newMeldCards = [...meld.cards, card]
      }
    } else {
      let r = card.rank
      if (card.rank === 1 && meld.runMax === 13) {
        r = 14; updatedRunMax = 14; updatedRunAceHigh = true
        newMeldCards = [...meld.cards, card]
      } else {
        if (meld.runAceHigh && card.rank === 1) r = 14
        if (r < (meld.runMin ?? 999)) {
          updatedRunMin = r; newMeldCards = [card, ...meld.cards]
        } else {
          if (r > (meld.runMax ?? 0)) updatedRunMax = r
          newMeldCards = [...meld.cards, card]
        }
      }
    }
  } else {
    newMeldCards = [...meld.cards, card]
  }

  const updatedMeld: Meld = {
    ...meld, cards: newMeldCards, jokerMappings: newJokerMappings,
    runMin: updatedRunMin, runMax: updatedRunMax, runAceHigh: updatedRunAceHigh,
  }
  const tablesMelds = state.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
  const wentOut = newHand.length === 0
  const goOutPlayerId = wentOut ? player.id : state.roundState.goOutPlayerId
  const players = state.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)
  return { ...state, players, roundState: { ...state.roundState, tablesMelds, goOutPlayerId } }
}

/** Swap a natural card from hand with a joker in a run meld. */
function simJokerSwap(state: GameState, naturalCard: Card, meld: Meld): GameState | null {
  const playerIdx = state.roundState.currentPlayerIndex
  const player = state.players[playerIdx]
  const joker = findSwappableJoker(naturalCard, meld)
  if (!joker) return null
  const newMeldCards = meld.cards.map(c => c.id === joker.id ? naturalCard : c)
  const newJokerMappings = meld.jokerMappings.filter(m => m.cardId !== joker.id)
  const updatedMeld: Meld = { ...meld, cards: newMeldCards, jokerMappings: newJokerMappings }
  const tablesMelds = state.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
  const newHand = player.hand.filter(c => c.id !== naturalCard.id).concat(joker)
  const players = state.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)
  return { ...state, players, roundState: { ...state.roundState, tablesMelds } }
}

// ── Buying window ─────────────────────────────────────────────────────────────

interface BuyStats { [playerId: string]: { offered: number; bought: number } }

/**
 * Process buying window. Each eligible buyer decides in order; first to say yes gets it.
 * isPostDraw = true: Rule 9A post-draw window (drewPlayerIdx just drew from pile, others may buy)
 * isPostDraw = false: going-out window (any player except the one who went out may buy)
 */
function simProcessBuying(
  state: GameState,
  activePlayerIdx: number,
  discardCard: Card,
  isPostDraw: boolean,
  difficulty: AIDifficulty,
  buyStats: BuyStats,
): GameState {
  const buyerOrder = isPostDraw
    ? buildPostDrawBuyerOrder(state, activePlayerIdx)
    : buildBuyerOrderForDiscard(state, activePlayerIdx)

  let current = state
  for (const buyerIdx of buyerOrder) {
    const buyer = current.players[buyerIdx]
    if (buyer.buysRemaining <= 0) continue

    buyStats[buyer.id] = buyStats[buyer.id] ?? { offered: 0, bought: 0 }
    buyStats[buyer.id].offered++

    const evalCfg = difficultyToEvalConfig(difficulty)
    const opponents = current.players.filter((_, i) => i !== buyerIdx)
      .map(p => ({ hand: { length: p.hand.length }, hasLaidDown: p.hasLaidDown }))
    const shouldBuy = aiShouldBuy(buyer.hand, discardCard, current.roundState.requirement, buyer.buysRemaining, evalCfg, opponents)

    if (shouldBuy) {
      buyStats[buyer.id].bought++
      const drawPile = [...current.roundState.drawPile]
      const penaltyCard = drawPile.shift()
      const newHand = [...buyer.hand, discardCard, ...(penaltyCard ? [penaltyCard] : [])]
      const discardPile = current.roundState.discardPile.slice(0, -1)
      const players = current.players.map((p, i) =>
        i === buyerIdx ? { ...p, hand: newHand, buysRemaining: p.buysRemaining - 1 } : p
      )
      current = { ...current, players, roundState: { ...current.roundState, drawPile, discardPile } }
      break  // only one buyer per discard
    }
  }
  return current
}

// ── AI action phase (mirrors executeAIAction in GameBoard.tsx) ────────────────

interface ActionResult {
  state: GameState
  action: 'meld' | 'layoff' | 'jokerswap' | 'discard' | 'stuck'
  meldsCount?: number
  cardsLaidOff?: number
  swapped?: boolean
  isJokerLayOff?: boolean
}

function simExecuteAIAction(
  state: GameState,
  difficulty: AIDifficulty,
  layOffDoneThisTurn: boolean,
): ActionResult {
  const player = getCurrentPlayer(state)
  const { tablesMelds, requirement } = state.roundState
  const isHard = difficulty === 'hard'
  const isEasy = difficulty === 'easy'

  // Easy AI: lay down when possible, 1 lay-off per turn, random-ish discard
  if (isEasy) {
    if (!player.hasLaidDown) {
      const melds = aiFindBestMelds(player.hand, requirement)
      if (melds && melds.length > 0) {
        const newState = simMeld(state, melds)
        return { state: newState, action: 'meld', meldsCount: melds.length }
      }
    }
    // Easy: 1 lay-off per turn (jokers exempt from cap)
    const hasJoker = player.hand.some(c => c.suit === 'joker')
    if (player.hasLaidDown && tablesMelds.length > 0 && (!layOffDoneThisTurn || hasJoker)) {
      const layOff = aiFindLayOff(player.hand, tablesMelds)
      if (layOff) {
        const newState = simLayOff(state, layOff.card, layOff.meld, layOff.jokerPosition)
        if (newState) {
          const isJokerLayOff = layOff.card.suit === 'joker'
          return { state: newState, action: 'layoff', cardsLaidOff: 1, isJokerLayOff }
        }
      }
    }
    const easyEvalCfg = difficultyToEvalConfig('easy')
    const card = aiChooseDiscard(player.hand, requirement, easyEvalCfg)
    const result = simDiscard(state, card.id)
    if (!result) return { state, action: 'stuck' }
    return { state: result.state, action: 'discard' }
  }

  // Medium/Hard: try pre-lay-down joker swap
  if (!player.hasLaidDown && tablesMelds.length > 0) {
    const swap = aiFindPreLayDownJokerSwap(player.hand, tablesMelds, requirement)
    if (swap) {
      const newState = simJokerSwap(state, swap.card, swap.meld)
      if (newState) {
        // After swap, immediately try to meld (re-run action on new state)
        const afterSwap = simExecuteAIAction(newState, difficulty, layOffDoneThisTurn)
        return { ...afterSwap, swapped: true }
      }
    }
  }

  // Medium/Hard: lay down (required melds only)
  if (!player.hasLaidDown) {
    const melds = aiFindBestMelds(player.hand, requirement)
    if (melds && melds.length > 0) {
      const newState = simMeld(state, melds)
      return { state: newState, action: 'meld', meldsCount: melds.length }
    }
  }

  // Hard only: joker swap to reclaim joker
  if (isHard && player.hasLaidDown && tablesMelds.length > 0) {
    const swap = aiFindJokerSwap(player.hand, tablesMelds)
    if (swap) {
      const newState = simJokerSwap(state, swap.card, swap.meld)
      if (newState) {
        // After joker swap, re-run to lay off the recovered joker
        const afterSwap = simExecuteAIAction(newState, difficulty, layOffDoneThisTurn)
        return { ...afterSwap, swapped: true }
      }
    }
  }

  // Try to lay off (Medium: max 2 per turn; Hard: unlimited; jokers always exempt from cap)
  const hasJokerInHand = player.hand.some(c => c.suit === 'joker')
  if (player.hasLaidDown && tablesMelds.length > 0 &&
      (isHard || !layOffDoneThisTurn || player.hand.length === 1 || hasJokerInHand)) {
    const layOff = aiFindLayOff(player.hand, tablesMelds)
    if (layOff) {
      const newState = simLayOff(state, layOff.card, layOff.meld, layOff.jokerPosition)
      if (newState) {
        const isJokerLayOff = layOff.card.suit === 'joker'
        if (isHard && !newState.roundState.goOutPlayerId) {
          // Hard AI: keep laying off until can't
          const next = simExecuteAIAction(newState, difficulty, true)
          return { ...next, cardsLaidOff: (next.cardsLaidOff ?? 0) + 1, isJokerLayOff: isJokerLayOff || next.isJokerLayOff }
        }
        return { state: newState, action: 'layoff', cardsLaidOff: 1, isJokerLayOff }
      }
    }
  }

  // Discard
  if (player.hand.length > 0) {
    const discardEvalCfg = difficultyToEvalConfig(difficulty)
    const card = aiChooseDiscard(player.hand, requirement, discardEvalCfg, tablesMelds)
    const result = simDiscard(state, card.id)
    if (!result) {
      // Stuck with 1 card that can't be discarded
      return { state, action: 'stuck' }
    }
    return { state: result.state, action: 'discard' }
  }

  return { state, action: 'stuck' }
}

// ── Round simulation ──────────────────────────────────────────────────────────

function makePlayerRoundStats(player: Player): PlayerRoundStats {
  return {
    drewFromDiscard: 0,
    drewFromPile: 0,
    buysMade: 0,
    buysOffered: 0,
    turnLaidDown: 0,
    meldsLaidDown: 0,
    cardsLaidOff: 0,
    jokerSwaps: 0,
    finalHandSize: player.hand.length,
    finalHandValue: 0,
    wasShanghaied: false,
  }
}

export function simulateRound(gameState: GameState, difficulty: AIDifficulty): { state: GameState; result: RoundResult } {
  let state = gameState
  let noProgressTurns = 0
  let drawPileDepletions = 0
  let turnCount = 0
  let pendingBuyEligible = false  // true after a discard, until next player's draw decision

  const playerIds = state.players.map(p => p.id)
  const statsMap: Record<string, PlayerRoundStats> = {}
  playerIds.forEach(id => {
    const p = state.players.find(p => p.id === id)!
    statsMap[id] = makePlayerRoundStats(p)
  })

  const buyStats: BuyStats = {}
  playerIds.forEach(id => { buyStats[id] = { offered: 0, bought: 0 } })

  // Count jokers dealt this round
  const jokersDealt = state.players.reduce((sum, p) => sum + p.hand.filter(c => c.suit === 'joker').length, 0)

  let stalemate = false
  // Hard cap: max 60 turns per player regardless of stalemate heuristics
  const MAX_TURNS_PER_ROUND = state.players.length * 60

  // Main round loop
  mainLoop: while (!state.roundState.goOutPlayerId) {
    turnCount++
    if (turnCount > MAX_TURNS_PER_ROUND) {
      stalemate = true
      break mainLoop
    }
    const playerIdx = state.roundState.currentPlayerIndex
    const player = getCurrentPlayer(state)
    const pid = player.id

    // ── DRAW PHASE ──────────────────────────────────────────────────────────
    const topDiscard = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null
    const takeEvalCfg = difficultyToEvalConfig(difficulty)
    const shouldTake = topDiscard !== null &&
      aiShouldTakeDiscard(player.hand, topDiscard, state.roundState.requirement, player.hasLaidDown, takeEvalCfg)

    if (shouldTake) {
      statsMap[pid].drewFromDiscard++
      state = simTakeDiscard(state)
      pendingBuyEligible = false
      // No buying window when player takes discard
    } else {
      statsMap[pid].drewFromPile++
      const discardForBuying = pendingBuyEligible ? topDiscard : null
      const { state: newState, reshuffled } = simDrawFromPile(state)
      state = newState
      if (reshuffled) drawPileDepletions++
      pendingBuyEligible = false

      // Rule 9A: open buying window for other players
      if (discardForBuying) {
        const totalBoughtBefore = Object.values(buyStats).reduce((s, b) => s + b.bought, 0)
        state = simProcessBuying(state, playerIdx, discardForBuying, true, difficulty, buyStats)
        const totalBoughtAfter = Object.values(buyStats).reduce((s, b) => s + b.bought, 0)
        // Buying is progress — someone acquired a card they wanted
        if (totalBoughtAfter > totalBoughtBefore) noProgressTurns = Math.max(0, noProgressTurns - 2)
        // Update stats from buyStats
        playerIds.forEach(id => {
          if (buyStats[id]) {
            const prev = statsMap[id]
            if (buyStats[id].offered > prev.buysOffered) {
              const delta = buyStats[id].offered - prev.buysOffered
              statsMap[id].buysOffered += delta
            }
            if (buyStats[id].bought > prev.buysMade) {
              const delta = buyStats[id].bought - prev.buysMade
              statsMap[id].buysMade += delta
            }
          }
        })
      }
    }

    // ── ACTION PHASE: loop until player discards, goes out, or is stuck ─────
    // One call to simExecuteAIAction handles ONE step (meld, layoff, or discard).
    // After meld/layoff the player still needs to finish their turn with a discard.
    // Cap: easy=1 lay-off/turn, medium=2, hard=unlimited. Joker lay-offs never count toward cap.
    const layOffCap = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : Infinity
    let layOffCount = 0
    let turnDone = false
    let actionSteps = 0

    while (!turnDone && !state.roundState.goOutPlayerId && actionSteps < 50) {
      actionSteps++
      const actionResult = simExecuteAIAction(state, difficulty, layOffCount >= layOffCap)
      state = actionResult.state

      if (actionResult.swapped) statsMap[pid].jokerSwaps++

      switch (actionResult.action) {
        case 'meld':
          statsMap[pid].meldsLaidDown += actionResult.meldsCount ?? 0
          if (statsMap[pid].turnLaidDown === 0) statsMap[pid].turnLaidDown = turnCount
          layOffCount = 0  // reset after melding
          noProgressTurns = 0  // melding is significant progress
          break

        case 'layoff':
          statsMap[pid].cardsLaidOff += actionResult.cardsLaidOff ?? 1
          if (!actionResult.isJokerLayOff) layOffCount++  // jokers don't count toward cap
          break

        case 'discard':
          noProgressTurns++  // count every discard; player didn't go out this turn
          pendingBuyEligible = true
          turnDone = true
          break

        case 'stuck':
          // AI has 1 card and can't lay off or discard — stalemate safety
          noProgressTurns++
          turnDone = true
          break
      }
    }

    // Safety valve: if action loop hit the step limit, force a stalemate
    if (actionSteps >= 50) {
      noProgressTurns += state.players.length
    }

    // ── STALEMATE CHECK ────────────────────────────────────────────────────
    // Scale stalemate tolerance by round complexity: run-heavy rounds need more time
    const req = state.roundState.requirement
    const complexityMultiplier = req.runs >= 3 ? 20 : req.runs >= 2 ? 15 : req.sets >= 3 ? 12 : 8
    if (drawPileDepletions >= 2 && noProgressTurns > state.players.length * complexityMultiplier) {
      stalemate = true
      break mainLoop
    }

    // ── DID PLAYER GO OUT (mid-action-loop)? ─────────────────────────────
    if (state.roundState.goOutPlayerId) {
      const lastDiscard = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null
      if (lastDiscard) {
        const goOutIdx = state.players.findIndex(p => p.id === state.roundState.goOutPlayerId)
        const prevBuyStats = playerIds.reduce((acc, id) => ({ ...acc, [id]: { ...buyStats[id] } }), {} as BuyStats)
        state = simProcessBuying(state, goOutIdx, lastDiscard, false, difficulty, buyStats)
        playerIds.forEach(id => {
          if (buyStats[id] && prevBuyStats[id]) {
            statsMap[id].buysOffered += buyStats[id].offered - prevBuyStats[id].offered
            statsMap[id].buysMade += buyStats[id].bought - prevBuyStats[id].bought
          }
        })
      }
      break mainLoop
    }

    // ── ADVANCE PLAYER ────────────────────────────────────────────────────
    state = advancePlayer(state)
  }

  // ── SCORE THE ROUND ───────────────────────────────────────────────────────
  let scoreResults: { playerId: string; score: number; shanghaied: boolean }[]
  if (stalemate || !state.roundState.goOutPlayerId) {
    // Stalemate: all players score their remaining hand
    scoreResults = state.players.map(p => ({
      playerId: p.id,
      score: calculateHandScore(p.hand),
      shanghaied: !p.hasLaidDown,
    }))
  } else {
    scoreResults = scoreRound(state.players, state.roundState.goOutPlayerId)
  }

  // Apply scores to players
  const scoredPlayers = state.players.map(p => {
    const r = scoreResults.find(sr => sr.playerId === p.id)
    return r ? { ...p, roundScores: [...p.roundScores, r.score] } : p
  })
  state = { ...state, players: scoredPlayers }

  // ── FINALIZE STATS ────────────────────────────────────────────────────────
  const shanghaiVictims: string[] = []
  let jokersStuckInHand = 0

  scoreResults.forEach(r => {
    const player = state.players.find(p => p.id === r.playerId)!
    statsMap[r.playerId].finalHandSize = player.hand.length
    statsMap[r.playerId].finalHandValue = r.score
    statsMap[r.playerId].wasShanghaied = r.shanghaied
    if (r.shanghaied) shanghaiVictims.push(player.name)
    jokersStuckInHand += player.hand.filter(c => c.suit === 'joker').length
  })

  const goOutPlayer = state.players.find(p => p.id === state.roundState.goOutPlayerId)

  const result: RoundResult = {
    roundNumber: state.roundState.roundNumber,
    requirement: state.roundState.requirement.description,
    wentOut: goOutPlayer?.name ?? '(stalemate)',
    turnsInRound: turnCount,
    shanghaiVictims,
    scores: Object.fromEntries(scoreResults.map(r => {
      const p = state.players.find(pp => pp.id === r.playerId)!
      return [p.name, r.score]
    })),
    playerStats: Object.fromEntries(playerIds.map(id => {
      const p = state.players.find(pp => pp.id === id)!
      return [p.name, statsMap[id]]
    })),
    stalemate,
    jokersDealt,
    jokersStuckInHand,
  }

  return { state, result }
}

// ── Full game simulation ──────────────────────────────────────────────────────

export function simulateGame(config: SimConfig, gameId: number): GameResult {
  const t0 = Date.now()

  const playerNames = Array.from({ length: config.numPlayers }, (_, i) => `AI ${i + 1}`)
  const playerConfigs: PlayerConfig[] = playerNames.map(name => ({ name, isAI: true }))

  let state = initGame(playerConfigs)
  const roundResults: RoundResult[] = []

  for (let roundNum = 1; roundNum <= TOTAL_ROUNDS; roundNum++) {
    if (roundNum > 1) state = setupRound(state, roundNum)

    if (config.onlyRounds && !config.onlyRounds.includes(roundNum)) {
      // Skip this round — just record a placeholder
      const req = ROUND_REQUIREMENTS[roundNum - 1]
      const placeholder: RoundResult = {
        roundNumber: roundNum,
        requirement: req.description,
        wentOut: '(skipped)',
        turnsInRound: 0,
        shanghaiVictims: [],
        scores: {},
        playerStats: {},
        stalemate: false,
        jokersDealt: 0,
        jokersStuckInHand: 0,
      }
      roundResults.push(placeholder)

      // Advance round state without playing
      if (roundNum < TOTAL_ROUNDS) state = setupRound(state, roundNum + 1)
      continue
    }

    const { state: newState, result } = simulateRound(state, config.difficulty)
    state = newState
    roundResults.push(result)

    if (config.onlyRounds) break  // stop after first matched round
  }

  // Compute final scores
  const finalScores = state.players.map(p => p.roundScores.reduce((s, n) => s + n, 0))
  const minScore = Math.min(...finalScores)
  const winnerIdx = finalScores.indexOf(minScore)
  const winner = state.players[winnerIdx].name

  const totalTurns = roundResults.reduce((s, r) => s + r.turnsInRound, 0)
  const totalBuys = roundResults.reduce((s, r) =>
    s + Object.values(r.playerStats).reduce((ps, stats) => ps + stats.buysMade, 0), 0)

  return {
    gameId,
    players: playerNames,
    winner,
    finalScores,
    rounds: roundResults,
    totalTurns,
    totalBuys,
    duration: Date.now() - t0,
  }
}

// ── Run a full simulation batch ───────────────────────────────────────────────

export function runSimulation(config: SimConfig): GameResult[] {
  const results: GameResult[] = []
  for (let i = 0; i < config.numGames; i++) {
    results.push(simulateGame(config, i + 1))
  }
  return results
}
