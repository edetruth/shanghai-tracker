import * as readline from 'readline'
import chalk from 'chalk'
import type { Card, GameState, Player } from './types'
import { createDecks, shuffle, dealHands } from './deck'
import { isValidSet, isValidRun, meetsRoundRequirement, buildMeld, canLayOff, findSwappableJoker } from './meld-validator'
import { scoreRound } from './scoring'
import {
  displayHand,
  displayDiscard,
  displayTableMelds,
  displayRoundHeader,
  displayTurnHeader,
  displayRoundScores,
  displayFinalResults,
  displayHandoff,
  cardStr,
} from './display'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS } from './rules'

// ─── readline helper ───
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim())))
}
async function pressEnter(msg = 'Press ENTER to continue...'): Promise<void> {
  await ask(chalk.dim(msg))
}

// ─── Game init ───
function createPlayer(name: string, index: number): Player {
  return {
    id: `p${index}`,
    name,
    hand: [],
    melds: [],
    hasLaidDown: false,
    buysRemaining: MAX_BUYS,
    roundScores: [],
  }
}

async function getPlayerNames(): Promise<string[]> {
  console.clear()
  console.log(chalk.yellow.bold('\n  SHANGHAI RUMMY\n'))
  const countStr = await ask('How many players? (2-4): ')
  const count = Math.min(4, Math.max(2, parseInt(countStr) || 2))
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const name = await ask(`Player ${i + 1} name: `)
    names.push(name.trim() || `Player ${i + 1}`)
  }
  return names
}

function initGame(names: string[]): GameState {
  const players = names.map((n, i) => createPlayer(n, i))
  const deckCount = players.length <= 4 ? 2 : 3
  return {
    players,
    currentRound: 1,
    deckCount,
    gameOver: false,
    roundState: null as unknown as import('./types').RoundState,
  }
}

// ─── Round setup ───
function setupRound(state: GameState, roundNum: number): void {
  const req = ROUND_REQUIREMENTS[roundNum - 1]
  const cardsDealt = CARDS_DEALT[roundNum - 1]
  const dealerIndex = (roundNum - 1) % state.players.length

  const deck = shuffle(createDecks(state.deckCount))
  const { hands, remaining } = dealHands(deck, state.players.length, cardsDealt)

  // Reset player round state
  state.players.forEach((p, i) => {
    p.hand = hands[i]
    p.melds = []
    p.hasLaidDown = false
  })

  // First player is left of dealer
  const firstPlayerIndex = (dealerIndex + 1) % state.players.length

  // Flip top card to start discard pile
  const firstDiscard = remaining.shift()
  state.roundState = {
    roundNumber: roundNum,
    requirement: req,
    cardsDealt,
    drawPile: remaining,
    discardPile: firstDiscard ? [firstDiscard] : [],
    currentPlayerIndex: firstPlayerIndex,
    dealerIndex,
    tablesMelds: [],
    meldIdCounter: 1,
    goOutPlayerId: null,
  }
}

// ─── Meld input parsing ───
function parseCardIndices(input: string, hand: Card[]): Card[] | null {
  const parts = input.trim().split(/\s+/)
  const cards: Card[] = []
  for (const p of parts) {
    const idx = parseInt(p)
    if (isNaN(idx) || idx < 1 || idx > hand.length) return null
    const card = hand[idx - 1]
    if (cards.some(c => c.id === card.id)) return null // duplicate
    cards.push(card)
  }
  return cards
}

function removeCardsFromHand(hand: Card[], toRemove: Card[]): void {
  for (const card of toRemove) {
    const i = hand.findIndex(c => c.id === card.id)
    if (i !== -1) hand.splice(i, 1)
  }
}

// ─── Turn phases ───

async function drawPhase(state: GameState, player: Player): Promise<void> {
  const rs = state.roundState
  const topDiscard = rs.discardPile[rs.discardPile.length - 1]

  while (true) {
    displayDiscard(topDiscard)
    console.log()
    console.log(chalk.bold('Draw:'))
    console.log('  D - Draw from draw pile')
    if (topDiscard) console.log(`  T - Take discard (${cardStr(topDiscard)})`)
    const ans = (await ask('> ')).toUpperCase()

    if (ans === 'D') {
      let card = rs.drawPile.shift()
      if (!card) {
        // Reshuffle discard pile (keep top)
        const top = rs.discardPile.pop()
        rs.drawPile.push(...shuffle(rs.discardPile))
        rs.discardPile.length = 0
        if (top) rs.discardPile.push(top)
        card = rs.drawPile.shift()
      }
      if (card) {
        player.hand.push(card)
        console.log(`You drew: ${cardStr(card)}`)
      } else {
        console.log(chalk.red('No cards left to draw!'))
      }
      break
    } else if (ans === 'T' && topDiscard) {
      rs.discardPile.pop()
      player.hand.push(topDiscard)
      console.log(`You took: ${cardStr(topDiscard)}`)
      break
    } else {
      console.log(chalk.red('Invalid choice.'))
    }
  }
}

async function meldPhase(state: GameState, player: Player): Promise<void> {
  const rs = state.roundState
  const req = rs.requirement

  console.log(chalk.yellow(`\nLay down your required hand: ${req.description}`))
  console.log(chalk.dim('Enter card numbers for each meld, or SKIP to skip melding.'))

  const meldCardGroups: Card[][] = []
  const meldTypes: ('set' | 'run')[] = []

  const totalMeldsNeeded = req.sets + req.runs
  let meldsEntered = 0

  // We'll track removed cards temporarily
  const tempRemoved: Card[] = []

  while (meldsEntered < totalMeldsNeeded) {
    displayHand(player.hand)
    const meldNum = meldsEntered + 1
    const typeHint = meldsEntered < req.sets ? '(set)' : '(run)'

    const input = await ask(`Meld ${meldNum} ${typeHint} (card numbers, or SKIP): `)
    if (input.toUpperCase() === 'SKIP') {
      // Put temp-removed cards back
      player.hand.push(...tempRemoved)
      return
    }

    const cards = parseCardIndices(input, player.hand)
    if (!cards || cards.length === 0) {
      console.log(chalk.red('Invalid card numbers.'))
      continue
    }

    // Determine type
    let type: 'set' | 'run' | null = null
    if (isValidSet(cards)) type = 'set'
    else if (isValidRun(cards)) type = 'run'

    if (!type) {
      console.log(chalk.red('Invalid meld. Must be a set (3+ same rank) or run (4+ same suit in sequence).'))
      continue
    }

    meldCardGroups.push(cards)
    meldTypes.push(type)
    meldsEntered++
    console.log(chalk.green(`  Valid ${type}: ${cards.map(c => cardStr(c)).join(' ')}`))

    // Temporarily remove from hand for next meld selection
    removeCardsFromHand(player.hand, cards)
    tempRemoved.push(...cards)
  }

  // Validate full requirement
  if (!meetsRoundRequirement(meldCardGroups, req)) {
    console.log(chalk.red(`Melds don't satisfy the requirement (${req.description}). Returning cards to hand.`))
    // Put cards back
    player.hand.push(...tempRemoved)
    return
  }

  // Commit melds
  for (let i = 0; i < meldCardGroups.length; i++) {
    const cards = meldCardGroups[i]
    const type = meldTypes[i]
    const id = String(rs.meldIdCounter++)
    const meld = buildMeld(cards, type, player.id, player.name, id)
    player.melds.push(meld)
    rs.tablesMelds.push(meld)
    // Cards already removed from hand above
  }

  player.hasLaidDown = true
  console.log(chalk.green.bold('  Hand laid down!'))
}

async function layOffPhase(state: GameState, player: Player): Promise<void> {
  if (!player.hasLaidDown) return
  const rs = state.roundState
  if (rs.tablesMelds.length === 0) return

  while (true) {
    displayHand(player.hand)
    if (player.hand.length === 0) break
    displayTableMelds(rs.tablesMelds)

    console.log(chalk.bold('Lay off options:'))
    console.log('  L <card#> <meld#> - lay off a card on a meld')
    console.log('  W <card#> <meld#> - swap a joker in a meld')
    console.log('  DONE - stop laying off')
    const input = await ask('> ')
    const parts = input.trim().toUpperCase().split(/\s+/)

    if (parts[0] === 'DONE' || parts[0] === '') break

    if (parts[0] === 'L') {
      const cardIdx = parseInt(parts[1])
      const meldId = parts[2]
      if (isNaN(cardIdx) || cardIdx < 1 || cardIdx > player.hand.length) {
        console.log(chalk.red('Invalid card number.')); continue
      }
      const card = player.hand[cardIdx - 1]
      const meld = rs.tablesMelds.find(m => m.id === meldId)
      if (!meld) { console.log(chalk.red('Invalid meld ID.')); continue }

      if (!canLayOff(card, meld)) {
        console.log(chalk.red(`Cannot lay ${cardStr(card)} off on meld #${meldId}.`)); continue
      }

      // Add card to meld, update bounds for runs
      removeCardsFromHand(player.hand, [card])
      meld.cards.push(card)
      if (meld.type === 'run') {
        // Update runMin / runMax
        let cardRank = card.rank
        if (meld.runAceHigh && card.rank === 1) cardRank = 14
        if (meld.runMin !== undefined && cardRank < meld.runMin) meld.runMin = cardRank
        if (meld.runMax !== undefined && cardRank > meld.runMax) meld.runMax = cardRank
      }
      console.log(chalk.green(`  Laid ${cardStr(card)} on meld #${meldId}`))

    } else if (parts[0] === 'W') {
      const cardIdx = parseInt(parts[1])
      const meldId = parts[2]
      if (isNaN(cardIdx) || cardIdx < 1 || cardIdx > player.hand.length) {
        console.log(chalk.red('Invalid card number.')); continue
      }
      const naturalCard = player.hand[cardIdx - 1]
      if (naturalCard.suit === 'joker') { console.log(chalk.red('Cannot swap a joker for a joker.')); continue }
      const meld = rs.tablesMelds.find(m => m.id === meldId)
      if (!meld) { console.log(chalk.red('Invalid meld ID.')); continue }

      const joker = findSwappableJoker(naturalCard, meld)
      if (!joker) {
        console.log(chalk.red(`No swappable joker found in meld #${meldId} for ${cardStr(naturalCard)}.`)); continue
      }

      // Swap: remove natural from hand, add joker to hand
      removeCardsFromHand(player.hand, [naturalCard])
      const jokerIndex = meld.cards.findIndex(c => c.id === joker.id)
      meld.cards[jokerIndex] = naturalCard
      player.hand.push(joker)
      // Remove joker mapping
      meld.jokerMappings = meld.jokerMappings.filter(m => m.cardId !== joker.id)
      console.log(chalk.green(`  Swapped ${cardStr(naturalCard)} for joker in meld #${meldId}. Joker returned to hand.`))

    } else {
      console.log(chalk.dim('Enter L <card#> <meld#>, W <card#> <meld#>, or DONE'))
    }

    // Check if went out
    if (player.hand.length === 0) {
      rs.goOutPlayerId = player.id
      break
    }
  }
}

async function discardPhase(state: GameState, player: Player): Promise<boolean> {
  const rs = state.roundState
  if (player.hand.length === 0) return true // went out without discarding

  while (true) {
    displayHand(player.hand)
    const input = await ask('Discard card # : ')
    const idx = parseInt(input)
    if (isNaN(idx) || idx < 1 || idx > player.hand.length) {
      console.log(chalk.red('Invalid card number.')); continue
    }
    const card = player.hand[idx - 1]
    removeCardsFromHand(player.hand, [card])
    rs.discardPile.push(card)
    console.log(`Discarded: ${cardStr(card)}`)
    // Check if went out
    if (player.hand.length === 0) {
      rs.goOutPlayerId = player.id
      return true
    }
    return false
  }
}

async function buyingWindow(state: GameState, discarder: Player): Promise<void> {
  const rs = state.roundState
  const topDiscard = rs.discardPile[rs.discardPile.length - 1]
  if (!topDiscard) return

  const n = state.players.length
  const discarderIdx = state.players.findIndex(p => p.id === discarder.id)

  // Other players in turn order starting from player after discarder
  const otherIndices: number[] = []
  for (let i = 1; i < n; i++) {
    otherIndices.push((discarderIdx + i) % n)
  }

  for (const idx of otherIndices) {
    const buyer = state.players[idx]
    if (buyer.buysRemaining <= 0) continue

    // Privacy screen for buyer
    console.clear()
    console.log(chalk.dim(`\nBuying window — ${topDiscard ? cardStr(topDiscard) : ''} was discarded`))
    console.log(`\n${buyer.name}: Do you want to buy ${cardStr(topDiscard)}?`)
    console.log(chalk.dim(`(Buys remaining: ${buyer.buysRemaining} | You get the discard + 1 penalty card)`))
    const ans = (await ask('[Y/N]: ')).toUpperCase()

    if (ans === 'Y') {
      // Execute buy
      const penaltyCard = rs.drawPile.shift()
      rs.discardPile.pop() // remove the card being bought
      buyer.hand.push(topDiscard)
      if (penaltyCard) buyer.hand.push(penaltyCard)
      buyer.buysRemaining--

      console.log(chalk.green(`\n${buyer.name} bought ${cardStr(topDiscard)}!`))
      if (penaltyCard) console.log(chalk.yellow(`Penalty card: ${cardStr(penaltyCard)}`))
      console.log(chalk.dim(`Buys remaining: ${buyer.buysRemaining}`))
      await pressEnter()
      break // only one player can buy a given discard
    }
  }
}

// ─── Full player turn ───
async function playerTurn(state: GameState, player: Player): Promise<void> {
  const rs = state.roundState

  // Privacy handoff
  displayHandoff(player.name)
  await pressEnter(`Press ENTER when you're ready, ${player.name}...`)
  console.clear()

  displayTurnHeader(player, rs)
  displayTableMelds(rs.tablesMelds)

  // Draw phase
  await drawPhase(state, player)

  // Meld phase (if not yet laid down)
  if (!player.hasLaidDown) {
    displayHand(player.hand)
    const ans = (await ask('Do you want to lay down your hand? [Y/N]: ')).toUpperCase()
    if (ans === 'Y') {
      await meldPhase(state, player)
    }
  }

  // Lay off / joker swap (if laid down)
  if (player.hasLaidDown && player.hand.length > 0) {
    displayHand(player.hand)
    const ans = (await ask('Do you want to lay off cards or swap jokers? [Y/N]: ')).toUpperCase()
    if (ans === 'Y') {
      await layOffPhase(state, player)
    }
  }

  // Check if went out after lay-off
  if (player.hand.length === 0) {
    rs.goOutPlayerId = player.id
    console.log(chalk.green.bold(`\n${player.name} went out!`))
    await pressEnter()
    return
  }

  // Discard phase
  console.log(chalk.bold('\nDiscard a card:'))
  await discardPhase(state, player)

  if (rs.goOutPlayerId) {
    console.log(chalk.green.bold(`\n${player.name} went out!`))
    await pressEnter()
    return
  }

  // Buying window
  await buyingWindow(state, player)
}

// ─── Round loop ───
async function playRound(state: GameState): Promise<void> {
  const rs = state.roundState

  while (!rs.goOutPlayerId) {
    if (rs.drawPile.length === 0) {
      // Reshuffle discard into draw pile
      const top = rs.discardPile.pop()
      rs.drawPile.push(...shuffle(rs.discardPile))
      rs.discardPile.length = 0
      if (top) rs.discardPile.push(top)
    }

    const player = state.players[rs.currentPlayerIndex]
    await playerTurn(state, player)

    if (!rs.goOutPlayerId) {
      rs.currentPlayerIndex = (rs.currentPlayerIndex + 1) % state.players.length
    }
  }
}

function applyRoundScores(state: GameState, results: { playerId: string; score: number }[]): void {
  for (const r of results) {
    const p = state.players.find(pl => pl.id === r.playerId)!
    p.roundScores.push(r.score)
  }
}

// ─── Main ───
export async function runGame(): Promise<void> {
  const names = await getPlayerNames()
  const state = initGame(names)

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    state.currentRound = round
    setupRound(state, round)

    console.clear()
    displayRoundHeader(round, ROUND_REQUIREMENTS[round - 1], CARDS_DEALT[round - 1])
    console.log(chalk.dim(`Dealer: ${state.players[state.roundState.dealerIndex].name}`))
    console.log(chalk.dim(`First player: ${state.players[state.roundState.currentPlayerIndex].name}`))
    await pressEnter()

    await playRound(state)

    // Score the round
    const results = scoreRound(state.players, state.roundState.goOutPlayerId!)
    applyRoundScores(state, results)

    console.clear()
    displayRoundScores(state.players, results, round)
    await pressEnter('Press ENTER to continue to next round...')
  }

  console.clear()
  displayFinalResults(state.players)
  rl.close()
}
