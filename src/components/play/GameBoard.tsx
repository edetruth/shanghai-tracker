import { useState, useEffect, useRef, useMemo } from 'react'
import { Pause } from 'lucide-react'
import type { GameState, Player, Card as CardType, Meld, PlayerConfig, AIDifficulty } from '../../game/types'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS } from '../../game/rules'
import { createDecks, shuffle, dealHands } from '../../game/deck'
import { buildMeld, isValidSet, canLayOff, findSwappableJoker, getNextJokerOptions } from '../../game/meld-validator'
import { scoreRound } from '../../game/scoring'
import {
  aiFindBestMelds, aiFindAllMelds, aiShouldTakeDiscard, aiChooseDiscard, aiChooseDiscardHard, aiChooseDiscardEasy,
  aiShouldBuy, aiShouldBuyHard,
  aiFindLayOff, aiFindJokerSwap, aiFindPreLayDownJokerSwap
} from '../../game/ai'
import { SUIT_ORDER } from './HandDisplay'
import { haptic } from '../../lib/haptics'
import PrivacyScreen from './PrivacyScreen'
import MeldModal from './MeldModal'
import LayOffModal from './LayOffModal'
import RoundSummary from './RoundSummary'
import GameOver from './GameOver'
import HandDisplay from './HandDisplay'
import TableMelds from './TableMelds'
import CardComponent from './Card'

interface Props {
  initialPlayers: PlayerConfig[]
  aiDifficulty?: AIDifficulty
  onExit: () => void
}

type UIPhase =
  | 'round-start'
  | 'privacy'
  | 'draw'
  | 'action'
  | 'buying'
  | 'round-end'
  | 'game-over'

type GameSpeed = 'fast' | 'normal' | 'slow'

interface UndoState {
  card: CardType
  preDiscardState: GameState
  discarderIdx: number
  timerId: ReturnType<typeof setTimeout>
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
    isAI: cfg.isAI,
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

  // Reset buys to MAX_BUYS for each new round
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

function nextPhaseForPlayer(player: Player): UIPhase {
  return player.isAI ? 'draw' : 'privacy'
}

function buildBuyerOrder(state: GameState, discarderIndex: number): number[] {
  const order: number[] = []
  const count = state.players.length
  for (let i = 1; i < count; i++) {
    const idx = (discarderIndex + i) % count
    if (state.players[idx].buysRemaining > 0) order.push(idx)
  }
  return order
}

function getAIDelay(speed: GameSpeed): number {
  if (speed === 'fast') return 200 + Math.random() * 200
  if (speed === 'slow') return 2000 + Math.random() * 1000
  return 700 + Math.random() * 500
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GameBoard({ initialPlayers, aiDifficulty = 'medium', onExit }: Props) {
  const [gameState, setGameState] = useState<GameState>(() => initGame(initialPlayers))
  const [uiPhase, setUiPhase] = useState<UIPhase>('round-start')
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [handSort, setHandSort] = useState<'rank' | 'suit'>('rank')
  const [showMeldModal, setShowMeldModal] = useState(false)
  const [showLayOffModal, setShowLayOffModal] = useState(false)
  const [buyerOrder, setBuyerOrder] = useState<number[]>([])
  const [buyerStep, setBuyerStep] = useState(0)
  const [roundResults, setRoundResults] = useState<{ playerId: string; score: number; shanghaied: boolean }[] | null>(null)
  const [buyingDiscard, setBuyingDiscard] = useState<CardType | null>(null)
  const [pendingUndo, setPendingUndo] = useState<UndoState | null>(null)
  const [pendingBuyDiscard, setPendingBuyDiscard] = useState<CardType | null>(null)
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [reshuffleMsg, setReshuffleMsg] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set())
  const [aiActionTick, setAiActionTick] = useState(0)
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>('normal')
  const [discardError, setDiscardError] = useState<string | null>(null)
  const [layOffError, setLayOffError] = useState<string | null>(null)
  const [preLayDownSwap, setPreLayDownSwap] = useState(false)
  const [showPreLayDownSwapModal, setShowPreLayDownSwapModal] = useState(false)
  // Snapshot of game state BEFORE any pre-lay-down joker swaps — used to undo if player can't lay down after all swaps
  const preLayDownSwapBaseStateRef = useRef<GameState | null>(null)
  // Stalemate tracking (turns without any meld)
  const noProgressTurnsRef = useRef(0)
  const drawPileDepletionsRef = useRef(0)

  // Post-draw buying: when true, after buying window resolves the CURRENT player acts (they already drew)
  const buyingIsPostDrawRef = useRef(false)

  // Stable refs so AI callbacks always have current values
  const gameStateRef = useRef(gameState)
  const uiPhaseRef = useRef(uiPhase)
  const buyerOrderRef = useRef(buyerOrder)
  const buyerStepRef = useRef(buyerStep)
  const pendingBuyDiscardRef = useRef(pendingBuyDiscard)
  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { uiPhaseRef.current = uiPhase }, [uiPhase])
  useEffect(() => { buyerOrderRef.current = buyerOrder }, [buyerOrder])
  useEffect(() => { buyerStepRef.current = buyerStep }, [buyerStep])
  useEffect(() => { pendingBuyDiscardRef.current = pendingBuyDiscard }, [pendingBuyDiscard])

  // Medium AI: max 1 lay-off per turn
  const aiLayOffDoneRef = useRef(false)

  // Auto-clear new card indicator after 3 seconds
  useEffect(() => {
    if (newCardIds.size === 0) return
    const timer = setTimeout(() => setNewCardIds(new Set()), 3000)
    return () => clearTimeout(timer)
  }, [newCardIds])

  const rs = gameState.roundState
  const currentPlayer = getCurrentPlayer(gameState)
  const topDiscard = rs.discardPile[rs.discardPile.length - 1] ?? null

  // Hand sorted to match player's chosen sort order
  const sortedCurrentHand = useMemo(() => {
    return [...currentPlayer.hand].sort((a, b) => {
      if (handSort === 'suit') {
        const s = (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4)
        if (s !== 0) return s
        return a.rank - b.rank
      }
      if (a.suit === 'joker') return 1
      if (b.suit === 'joker') return -1
      return a.rank - b.rank
    })
  }, [currentPlayer.hand, handSort])

  // ── Toggle card selection ─────────────────────────────────────────────────
  function toggleCard(cardId: string) {
    setNewCardIds(new Set()) // clear new badge on any action
    setSelectedCardIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  // ── Draw from pile (with reshuffle if empty) ──────────────────────────────
  function handleDrawFromPile() {
    // Use ref to avoid stale closure in AI setTimeout callbacks
    const hasPendingBuy = pendingBuyDiscardRef.current !== null
    const pendingCard = pendingBuyDiscardRef.current
    const currentIdx = rs.currentPlayerIndex
    const needsReshuffle = gameState.roundState.drawPile.length === 0

    // Determine the card that will be drawn BEFORE calling setGameState,
    // so setNewCardIds is never dependent on a value captured inside the updater.
    let drawPileSnapshot = [...gameState.roundState.drawPile]
    let discardPileSnapshot = [...gameState.roundState.discardPile]
    if (drawPileSnapshot.length === 0) {
      const top = discardPileSnapshot.pop()
      drawPileSnapshot = shuffle([...discardPileSnapshot])
      discardPileSnapshot = top ? [top] : []
    }
    const drawnCard = drawPileSnapshot[0] ?? null

    let updatedState: GameState | null = null

    setGameState(prev => {
      let drawPile = [...prev.roundState.drawPile]
      let discardPile = [...prev.roundState.discardPile]

      if (drawPile.length === 0) {
        const top = discardPile.pop()
        drawPile = shuffle([...discardPile])
        discardPile = top ? [top] : []
        drawPileDepletionsRef.current += 1
      }

      const card = drawPile.shift()
      if (!card) return prev

      const players = prev.players.map((p, i) =>
        i === prev.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, card] }
          : p
      )
      updatedState = { ...prev, players, roundState: { ...prev.roundState, drawPile, discardPile } }
      return updatedState
    })

    if (drawnCard) setNewCardIds(new Set([drawnCard.id]))

    if (needsReshuffle) {
      setReshuffleMsg(true)
      setTimeout(() => setReshuffleMsg(false), 2500)
    }

    if (hasPendingBuy && pendingCard && updatedState) {
      setPendingBuyDiscard(null)
      // Player passed on the discard — open buying window for players AFTER current
      startBuyingWindowPostDraw(updatedState, currentIdx, pendingCard)
    } else {
      setUiPhase('action')
    }
  }

  // ── Take top discard ──────────────────────────────────────────────────────
  function handleTakeDiscard() {
    const card = gameState.roundState.discardPile[gameState.roundState.discardPile.length - 1]
    if (!card) return

    setPendingBuyDiscard(null) // clear pending buy — card is taken
    setNewCardIds(new Set([card.id]))

    setGameState(prev => {
      const discardPile = [...prev.roundState.discardPile]
      discardPile.pop()
      const players = prev.players.map((p, i) =>
        i === prev.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, card] }
          : p
      )
      return { ...prev, players, roundState: { ...prev.roundState, discardPile } }
    })
    setUiPhase('action')
  }

  // ── Start buying window (normal — before next player draws) ───────────────
  function startBuyingWindow(state: GameState, discarder: number, discardCard: CardType | null) {
    const order = buildBuyerOrder(state, discarder)
    setBuyingDiscard(discardCard)
    setBuyerOrder(order)
    setBuyerStep(0)
    buyingIsPostDrawRef.current = false

    if (order.length === 0) {
      if (state.roundState.goOutPlayerId !== null) {
        endRound(state)
      } else {
        const next = advancePlayer(state)
        const nextPlayer = next.players[next.roundState.currentPlayerIndex]
        setGameState(next)
        setUiPhase(nextPhaseForPlayer(nextPlayer))
      }
    } else {
      setUiPhase('buying')
    }
  }

  // ── Start buying window AFTER current player drew from pile (Rule 9A) ─────
  // Buyers are players AFTER currentPlayerIdx; current player will act after buying resolves
  function startBuyingWindowPostDraw(state: GameState, drewPlayerIdx: number, discardCard: CardType) {
    const order: number[] = []
    const count = state.players.length
    for (let i = 1; i < count; i++) {
      const idx = (drewPlayerIdx + i) % count
      if (state.players[idx].buysRemaining > 0) order.push(idx)
    }

    const drewPlayer = state.players[drewPlayerIdx]
    const buyerNames = order.map(i => state.players[i].name).join(', ')
    console.log(`[Buy] ${drewPlayer.name} (next-in-turn) passed on discard [${discardCard.rank === 0 ? 'Joker' : `${discardCard.rank}${discardCard.suit}`}]. Buy window open for: ${buyerNames || 'nobody'}`)

    setBuyingDiscard(discardCard)
    setBuyerOrder(order)
    setBuyerStep(0)
    buyingIsPostDrawRef.current = true

    if (order.length === 0) {
      buyingIsPostDrawRef.current = false
      if (state.roundState.goOutPlayerId !== null) {
        endRound(state)
      } else {
        setGameState(state)
        setUiPhase('action')
      }
    } else {
      setUiPhase('buying')
    }
  }

  // ── Score and end round ───────────────────────────────────────────────────
  function endRound(state: GameState) {
    const goOutId = state.roundState.goOutPlayerId
    if (!goOutId) return
    noProgressTurnsRef.current = 0
    drawPileDepletionsRef.current = 0
    const results = scoreRound(state.players, goOutId)
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setUiPhase('round-end')
  }

  // ── Force end round (stalemate) ───────────────────────────────────────────
  function forceEndRound(state: GameState) {
    // If nobody has gone out, score all remaining hands (nobody gets 0)
    const results = state.players.map(p => ({
      playerId: p.id,
      score: p.hand.reduce((sum, c) => sum + (c.rank === 0 ? 50 : c.rank === 1 ? 20 : c.rank >= 11 ? 10 : c.rank), 0),
      shanghaied: !p.hasLaidDown,
    }))
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setUiPhase('round-end')
    setAiMessage('Round ended — no one went out (stalemate)')
    setTimeout(() => setAiMessage(null), 4000)
  }

  // ── Meld confirmation ─────────────────────────────────────────────────────
  function handleMeldConfirm(meldGroups: CardType[][], jokerPositions?: Map<string, number>) {
    const prev = gameState
    let counter = prev.roundState.meldIdCounter
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]

    const meldedIds = new Set(meldGroups.flatMap(g => g.map(c => c.id)))
    const newMelds: Meld[] = meldGroups.map(cards => {
      const type = isValidSet(cards) ? 'set' : 'run'
      const meldId = `meld-${counter++}`
      return buildMeld(cards, type, player.id, player.name, meldId, jokerPositions)
    })

    const tablesMelds = [...prev.roundState.tablesMelds, ...newMelds]
    const newHand = player.hand.filter(c => !meldedIds.has(c.id))
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : prev.roundState.goOutPlayerId

    const players = prev.players.map((p, i) =>
      i === playerIdx
        ? { ...p, hand: newHand, hasLaidDown: true, melds: [...p.melds, ...newMelds] }
        : p
    )

    const updated: GameState = {
      ...prev,
      players,
      roundState: { ...prev.roundState, tablesMelds, meldIdCounter: counter, goOutPlayerId },
    }

    // Reset progress counter when a meld happens
    noProgressTurnsRef.current = 0
    setGameState(updated)
    setShowMeldModal(false)
    setPreLayDownSwap(false)
    setSelectedCardIds(new Set()) // always reset selection after meld
    haptic(wentOut ? 'success' : 'heavy')

    if (wentOut) {
      const topCard = updated.roundState.discardPile[updated.roundState.discardPile.length - 1] ?? null
      startBuyingWindow(updated, playerIdx, topCard)
    }
  }

  // ── Lay off ───────────────────────────────────────────────────────────────
  function handleLayOff(card: CardType, meld: Meld, jokerPosition?: 'low' | 'high') {
    const prev = gameState
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]
    const newHand = player.hand.filter(c => c.id !== card.id)

    let updatedRunMin = meld.runMin
    let updatedRunMax = meld.runMax
    let updatedRunAceHigh = meld.runAceHigh
    let newJokerMappings = [...meld.jokerMappings]
    let newMeldCards: CardType[]

    if (meld.type === 'run') {
      if (card.suit === 'joker') {
        if (jokerPosition === 'low') {
          const newMin = (meld.runMin ?? 1) - 1
          updatedRunMin = newMin
          newJokerMappings.push({ cardId: card.id, representsRank: newMin, representsSuit: meld.runSuit! })
          newMeldCards = [card, ...meld.cards]
        } else {
          // Default: extend at high end
          const newMax = (meld.runMax ?? 0) + 1
          updatedRunMax = newMax
          newJokerMappings.push({ cardId: card.id, representsRank: newMax, representsSuit: meld.runSuit! })
          newMeldCards = [...meld.cards, card]
        }
      } else {
        let r = card.rank
        const isAceHighExt = card.rank === 1 && meld.runMax === 13
        if (isAceHighExt) {
          // Ace going at the high end (K-A)
          r = 14
          updatedRunMax = 14
          updatedRunAceHigh = true
          newMeldCards = [...meld.cards, card] // append ace at end
        } else {
          if (meld.runAceHigh && card.rank === 1) r = 14
          if (r < (meld.runMin ?? 999)) {
            updatedRunMin = r
            newMeldCards = [card, ...meld.cards] // prepend at low end
          } else {
            if (r > (meld.runMax ?? 0)) updatedRunMax = r
            newMeldCards = [...meld.cards, card] // append at high end
          }
        }
      }
    } else {
      newMeldCards = [...meld.cards, card]
    }

    // Track who laid off this card (only if it's onto someone else's meld)
    const newCardOwners = { ...meld.cardOwners }
    if (player.id !== meld.ownerId) {
      newCardOwners[card.id] = player.name
    }

    const updatedMeld: Meld = {
      ...meld,
      cards: newMeldCards,
      jokerMappings: newJokerMappings,
      cardOwners: newCardOwners,
      runMin: updatedRunMin,
      runMax: updatedRunMax,
      runAceHigh: updatedRunAceHigh,
    }
    const tablesMelds = prev.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : prev.roundState.goOutPlayerId
    const players = prev.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)

    // Safety net: if lay-off would leave exactly 1 card that can't be played anywhere,
    // block it before committing — player would be stuck (can't discard last card, can't go out)
    if (newHand.length === 1 && !tablesMelds.some(m => canLayOff(newHand[0], m))) {
      setLayOffError('Lay-off blocked — your remaining card can\'t be played anywhere, and you can\'t go out by discarding. Keep at least 2 cards so you can discard.')
      haptic('error')
      setTimeout(() => setLayOffError(null), 4000)
      return
    }

    const updated: GameState = { ...prev, players, roundState: { ...prev.roundState, tablesMelds, goOutPlayerId } }
    setGameState(updated)
    setSelectedCardIds(new Set())
    setLayOffError(null)

    if (wentOut) {
      setShowLayOffModal(false)
      const topCard = updated.roundState.discardPile[updated.roundState.discardPile.length - 1] ?? null
      startBuyingWindow(updated, playerIdx, topCard)
    }
  }

  // ── Joker swap — pure computation (used by both human and AI paths) ────────
  function computeJokerSwap(state: GameState, naturalCard: CardType, meld: Meld): GameState | null {
    const playerIdx = state.roundState.currentPlayerIndex
    const player = state.players[playerIdx]
    const joker = findSwappableJoker(naturalCard, meld)
    if (!joker) return null

    const newMeldCards = meld.cards.map(c => c.id === joker.id ? naturalCard : c)
    const newJokerMappings = meld.jokerMappings.filter(m => m.cardId !== joker.id)
    const newCardOwners = { ...meld.cardOwners }
    if (player.id !== meld.ownerId) {
      newCardOwners[naturalCard.id] = player.name
    }
    delete newCardOwners[joker.id]
    const updatedMeld: Meld = { ...meld, cards: newMeldCards, jokerMappings: newJokerMappings, cardOwners: newCardOwners }
    const tablesMelds = state.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
    const newHand = player.hand.filter(c => c.id !== naturalCard.id).concat(joker)
    const players = state.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)
    return { ...state, players, roundState: { ...state.roundState, tablesMelds } }
  }

  // ── Joker swap ────────────────────────────────────────────────────────────
  function handleJokerSwap(naturalCard: CardType, meld: Meld) {
    setGameState(prev => computeJokerSwap(prev, naturalCard, meld) ?? prev)
    setSelectedCardIds(new Set())
  }

  // ── Discard (with undo support for human players) ─────────────────────────
  function handleDiscard(overrideCardId?: string) {
    const cardId = overrideCardId ?? [...selectedCardIds][0]
    if (!cardId) return

    const playerIdx = rs.currentPlayerIndex
    const player = gameState.players[playerIdx]
    const card = player.hand.find(c => c.id === cardId)
    if (!card) return

    const newHand = player.hand.filter(c => c.id !== cardId)

    // Rule: you cannot go out by discarding — discard is blocked when it would empty your hand
    if (newHand.length === 0 && !player.isAI) {
      setDiscardError('You cannot go out by discarding. You must lay off your last card to go out.')
      haptic('error')
      setTimeout(() => setDiscardError(null), 3500)
      return
    }
    // AI with 1 card: skip discard, increment stalemate counter, advance turn
    if (newHand.length === 0 && player.isAI) {
      noProgressTurnsRef.current += 1
      const advanced = advancePlayer(gameState)
      const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
      setGameState(advanced)
      setUiPhase(nextPhaseForPlayer(nextPlayer))
      return
    }

    const preDiscardState = gameState
    const discardPile = [...rs.discardPile, card]

    const players = gameState.players.map((p, i) =>
      i === playerIdx ? { ...p, hand: newHand } : p
    )
    const afterDiscard: GameState = {
      ...gameState,
      players,
      roundState: { ...rs, discardPile },
    }

    setGameState(afterDiscard)
    setSelectedCardIds(new Set())
    haptic('heavy')

    // Increment no-progress counter
    if (!player.hasLaidDown) noProgressTurnsRef.current += 1

    // Check stalemate conditions
    const totalPlayers = gameState.players.length
    if (drawPileDepletionsRef.current >= 2 && noProgressTurnsRef.current > totalPlayers * 8) {
      setTimeout(() => forceEndRound(afterDiscard), 500)
      return
    }

    function afterUndoExpires() {
      setPendingUndo(null)
      // Rule 9A: advance to next player who gets first right to take the discard
      const advanced = advancePlayer(afterDiscard)
      const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
      setPendingBuyDiscard(card!)
      setGameState(advanced)
      setUiPhase(nextPhaseForPlayer(nextPlayer))
    }

    if (!player.isAI) {
      const timerId = setTimeout(afterUndoExpires, 3000)
      setPendingUndo({ card, preDiscardState, discarderIdx: playerIdx, timerId })
    } else {
      afterUndoExpires()
    }
  }

  function handleUndoDiscard() {
    if (!pendingUndo) return
    clearTimeout(pendingUndo.timerId)
    setGameState(pendingUndo.preDiscardState)
    setPendingUndo(null)
    // Stay in 'action' phase
  }

  // ── Buy decision ──────────────────────────────────────────────────────────
  function handleBuyDecision(wantsToBuy: boolean) {
    const isPostDraw = buyingIsPostDrawRef.current

    if (wantsToBuy) {
      const buyerIdx = buyerOrder[buyerStep]
      const buyer = gameState.players[buyerIdx]
      if (!buyingDiscard || buyer.buysRemaining <= 0) return

      const drawPile = [...gameState.roundState.drawPile]
      const penaltyCard = drawPile.shift()
      const newHand = [...buyer.hand, buyingDiscard, ...(penaltyCard ? [penaltyCard] : [])]
      const discardPile = gameState.roundState.discardPile.slice(0, -1)
      const players = gameState.players.map((p, i) =>
        i === buyerIdx ? { ...p, hand: newHand, buysRemaining: p.buysRemaining - 1 } : p
      )

      const withBuy: GameState = {
        ...gameState,
        players,
        roundState: { ...gameState.roundState, drawPile, discardPile },
      }

      // Highlight newly received buy cards
      const buyNewIds = new Set<string>()
      if (buyingDiscard) buyNewIds.add(buyingDiscard.id)
      if (penaltyCard) buyNewIds.add(penaltyCard.id)
      if (buyNewIds.size > 0) setNewCardIds(buyNewIds)

      if (isPostDraw) {
        // Post-draw buy: current player (who drew from pile) still acts after this
        buyingIsPostDrawRef.current = false
        setBuyerOrder([])
        setBuyerStep(0)
        if (withBuy.roundState.goOutPlayerId !== null) {
          endRound(withBuy)
        } else {
          setGameState(withBuy)
          setUiPhase('action')
        }
      } else {
        const advanced = advancePlayer(withBuy)
        if (withBuy.roundState.goOutPlayerId !== null) {
          endRound(advanced)
        } else {
          const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
          setGameState(advanced)
          setUiPhase(nextPhaseForPlayer(nextPlayer))
        }
      }
    } else {
      const nextStep = buyerStep + 1
      if (nextStep < buyerOrder.length) {
        setBuyerStep(nextStep)
      } else {
        // All buyers passed
        if (isPostDraw) {
          buyingIsPostDrawRef.current = false
          if (gameState.roundState.goOutPlayerId !== null) {
            endRound(gameState)
          } else {
            setUiPhase('action')
          }
        } else {
          const advanced = advancePlayer(gameState)
          if (gameState.roundState.goOutPlayerId !== null) {
            endRound(advanced)
          } else {
            const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
            setGameState(advanced)
            setUiPhase(nextPhaseForPlayer(nextPlayer))
          }
        }
      }
    }
  }

  // ── Next round / game over ────────────────────────────────────────────────
  function handleNextRound() {
    const nextRound = gameState.currentRound + 1
    if (nextRound > TOTAL_ROUNDS) {
      setGameState(prev => ({ ...prev, gameOver: true }))
      setUiPhase('game-over')
    } else {
      const next = setupRound(gameState, nextRound)
      setGameState(next)
      setRoundResults(null)
      setSelectedCardIds(new Set())
      setPendingBuyDiscard(null)
      setUiPhase('round-start')
    }
  }

  // ── AI: execute action phase turn ─────────────────────────────────────────
  function executeAIAction() {
    const state = gameStateRef.current
    const player = getCurrentPlayer(state)
    const { tablesMelds, requirement } = state.roundState
    const isHard = aiDifficulty === 'hard'
    const isEasy = aiDifficulty === 'easy'

    // Build joker positions for AI runs: place extra jokers at the low end
    function aiJokerPositions(meldGroups: CardType[][]): Map<string, number> {
      const positions = new Map<string, number>()
      for (const cards of meldGroups) {
        if (isValidSet(cards)) continue
        // Iteratively resolve ambiguous jokers, always picking the low-end option
        let placed = new Map<string, number>()
        for (;;) {
          const placement = getNextJokerOptions(cards, placed)
          if (!placement) break
          // options[0] is low-end, options[1] is high-end — pick low end
          const choice = placement.options[0]
          placed.set(placement.joker.id, choice.rank)
        }
        placed.forEach((rank, id) => positions.set(id, rank))
      }
      return positions
    }

    // Easy AI: only lay down required melds (no bonus), never lay off
    if (isEasy) {
      if (!player.hasLaidDown) {
        const melds = aiFindBestMelds(player.hand, requirement)
        if (melds && melds.length > 0) {
          setAiMessage(`${player.name} lays down`)
          setTimeout(() => setAiMessage(null), 1200)
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        }
      }
      // Easy: discard highest-value card
      aiLayOffDoneRef.current = false
      const card = aiChooseDiscardEasy(player.hand)
      setAiMessage(`${player.name} discards`)
      setTimeout(() => setAiMessage(null), 800)
      handleDiscard(card.id)
      return
    }

    // Medium/Hard: try pre-lay-down joker swap if it unlocks laying down
    if (!player.hasLaidDown && tablesMelds.length > 0) {
      const swap = aiFindPreLayDownJokerSwap(player.hand, tablesMelds, requirement)
      if (swap) {
        setAiMessage(`${player.name} swaps a joker to lay down`)
        setTimeout(() => setAiMessage(null), 1500)
        handleJokerSwap(swap.card, swap.meld)
        setAiActionTick(t => t + 1) // re-trigger AI so it can now meld
        return
      }
    }

    // Medium/Hard: try to lay down including bonus melds
    if (!player.hasLaidDown) {
      const melds = aiFindAllMelds(player.hand, requirement)
      if (melds && melds.length > 0) {
        aiLayOffDoneRef.current = false
        noProgressTurnsRef.current = 0
        setAiMessage(`${player.name} lays down!`)
        setTimeout(() => setAiMessage(null), 1500)
        handleMeldConfirm(melds, aiJokerPositions(melds))
        return
      }
    }

    // Hard only: try joker swap to reclaim a joker
    if (isHard && player.hasLaidDown && tablesMelds.length > 0) {
      const swap = aiFindJokerSwap(player.hand, tablesMelds)
      if (swap) {
        setAiMessage(`${player.name} swaps a joker`)
        setTimeout(() => setAiMessage(null), 1200)
        handleJokerSwap(swap.card, swap.meld)
        setAiActionTick(t => t + 1)
        return
      }
    }

    // Try to lay off (Medium: max 1 per turn, EXCEPT the final going-out lay-off; Hard: unlimited)
    if (player.hasLaidDown && tablesMelds.length > 0 && (isHard || !aiLayOffDoneRef.current || player.hand.length === 1)) {
      const layOff = aiFindLayOff(player.hand, tablesMelds)
      if (layOff) {
        aiLayOffDoneRef.current = true
        setAiMessage(`${player.name} lays off`)
        setTimeout(() => setAiMessage(null), 1000)
        handleLayOff(layOff.card, layOff.meld, layOff.jokerPosition)
        return
      }
    }

    // Discard
    if (player.hand.length > 0) {
      aiLayOffDoneRef.current = false
      const card = isHard
        ? aiChooseDiscardHard(player.hand, tablesMelds)
        : aiChooseDiscard(player.hand, requirement, tablesMelds)
      console.log(`[Buy] AI ${player.name} discarded [${card.rank === 0 ? 'Joker' : `${card.rank}${card.suit}`}]`)
      setAiMessage(`${player.name} discards`)
      setTimeout(() => setAiMessage(null), 800)
      handleDiscard(card.id)
    }
  }

  // ── AI turn automation (draw + action) ───────────────────────────────────
  const handLen = currentPlayer.hand.length
  useEffect(() => {
    if (!currentPlayer.isAI) return
    if (uiPhase !== 'draw' && uiPhase !== 'action') return

    const delay = getAIDelay(gameSpeed)
    const timerId = setTimeout(() => {
      if (uiPhaseRef.current === 'draw') {
        const state = gameStateRef.current
        const player = getCurrentPlayer(state)
        const top = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null

        const isEasy = aiDifficulty === 'easy'
        const shouldTake = !isEasy && top !== null &&
          aiShouldTakeDiscard(player.hand, top, state.roundState.requirement, player.hasLaidDown)

        setAiMessage(shouldTake
          ? `${player.name} takes the discard`
          : `${player.name} draws from pile`)
        setTimeout(() => setAiMessage(null), 1000)

        if (shouldTake) handleTakeDiscard()
        else handleDrawFromPile()
      } else if (uiPhaseRef.current === 'action') {
        executeAIAction()
      }
    }, delay)

    return () => clearTimeout(timerId)
  }, [uiPhase, currentPlayer.isAI, handLen, rs.currentPlayerIndex, aiActionTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI buying automation ──────────────────────────────────────────────────
  useEffect(() => {
    if (uiPhase !== 'buying') return
    const buyerIdx = buyerOrder[buyerStep]
    if (buyerIdx === undefined) return
    const buyer = gameState.players[buyerIdx]
    if (!buyer?.isAI) return

    const delay = getAIDelay(gameSpeed)
    const timerId = setTimeout(() => {
      const state = gameStateRef.current
      const currentBuyer = state.players[buyerOrderRef.current[buyerStepRef.current]]
      const disc = buyingDiscard
      const req = state.roundState.requirement
      if (!disc || !currentBuyer) {
        handleBuyDecision(false)
        return
      }
      const isEasy = aiDifficulty === 'easy'
      const shouldBuy = isEasy
        ? false
        : aiDifficulty === 'hard'
          ? aiShouldBuyHard(currentBuyer.hand, disc, req)
          : aiShouldBuy(currentBuyer.hand, disc, req)

      if (shouldBuy) setAiMessage(`${currentBuyer.name} buys!`)
      else setAiMessage(`${currentBuyer.name} passes`)
      setTimeout(() => setAiMessage(null), 800)
      handleBuyDecision(shouldBuy)
    }, Math.min(delay, 900))

    return () => clearTimeout(timerId)
  }, [uiPhase, buyerStep, buyerOrder]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Determine display for buying phase ────────────────────────────────────
  const buyerIdx = buyerOrder[buyerStep]
  const activeBuyer = buyerIdx !== undefined ? gameState.players[buyerIdx] : null
  const isHumanBuyerTurn = uiPhase === 'buying' && activeBuyer !== null && !activeBuyer.isAI
  // During human buying: display buyer's hand; otherwise: display current player's hand
  const displayPlayer = isHumanBuyerTurn ? activeBuyer : currentPlayer

  // When AI is playing, find the next human player so they can see their hand and plan
  const aiTurnHumanViewer = useMemo(() => {
    if (!currentPlayer.isAI) return null
    if (isHumanBuyerTurn) return null
    const count = gameState.players.length
    for (let i = 1; i < count; i++) {
      const idx = (rs.currentPlayerIndex + i) % count
      if (!gameState.players[idx].isAI) return gameState.players[idx]
    }
    return null
  }, [currentPlayer.isAI, isHumanBuyerTurn, gameState.players, rs.currentPlayerIndex])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // True when the current human player (before laying down) holds a natural card
  // that can swap for a joker in a table meld — enabling the pre-lay-down swap button
  const hasSwappableJokersBeforeLayDown =
    uiPhase === 'action' &&
    !currentPlayer.hasLaidDown &&
    !currentPlayer.isAI &&
    rs.tablesMelds.some(meld =>
      meld.jokerMappings.length > 0 &&
      currentPlayer.hand.some(c => c.suit !== 'joker' && findSwappableJoker(c, meld) !== null)
    )

  if (uiPhase === 'round-start') {
    // Show round info + first player's starting state
    const firstHumanPlayer = gameState.players.find(p => !p.isAI)
    return (
      <div className="min-h-screen bg-[#1a3a2a] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          <div className="w-16 h-16 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-[#2c1810]">{gameState.currentRound}</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Round {gameState.currentRound}</h2>
          <p className="text-base text-[#a8d0a8] mb-1">{rs.requirement.description}</p>
          <p className="text-sm text-[#6aad7a] mb-6">{rs.cardsDealt} cards dealt · {MAX_BUYS} buys available</p>

          {firstHumanPlayer && (
            <p className="text-xs text-[#6aad7a] mb-4">
              Starting player: {gameState.players[rs.currentPlayerIndex]?.name}
            </p>
          )}

          <button
            onClick={() => setUiPhase(nextPhaseForPlayer(currentPlayer))}
            className="bg-[#e2b858] text-[#2c1810] font-bold rounded-xl px-8 py-3 text-base active:opacity-80 w-full"
          >
            Begin Round
          </button>
        </div>
      </div>
    )
  }

  if (uiPhase === 'privacy') {
    return (
      <PrivacyScreen
        playerName={currentPlayer.name}
        onReady={() => setUiPhase('draw')}
      />
    )
  }

  if (uiPhase === 'round-end' && roundResults) {
    return (
      <RoundSummary
        players={gameState.players}
        roundResults={roundResults}
        roundNum={gameState.currentRound}
        onNext={handleNextRound}
        isLastRound={gameState.currentRound === TOTAL_ROUNDS}
      />
    )
  }

  if (uiPhase === 'game-over') {
    return (
      <GameOver
        players={gameState.players}
        onPlayAgain={() => {
          setGameState(initGame(initialPlayers))
          setUiPhase('round-start')
          setRoundResults(null)
          setSelectedCardIds(new Set())
          setPendingUndo(null)
          setPendingBuyDiscard(null)
          noProgressTurnsRef.current = 0
          drawPileDepletionsRef.current = 0
        }}
        onBack={onExit}
      />
    )
  }

  // ── Main board: draw / action / buying ────────────────────────────────────
  return (
    <div
      className="bg-[#1a3a2a] flex flex-col overflow-hidden"
      style={{ height: '100dvh' }}
    >
      {/* ── ZONE 1: Fixed Header — never moves ─────────────────────────── */}
      <div
        className="flex-shrink-0 bg-[#0f2218] border-b border-[#2d5a3c]"
        style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        {/* Top bar: round info, turn indicator, buys, pause */}
        <div className="px-4 py-2 flex items-center justify-between">
          <div>
            <p className="text-xs text-[#6aad7a]">Round {gameState.currentRound} of {TOTAL_ROUNDS} · {rs.requirement.description}</p>
            <p className="text-sm font-bold text-white">
              {uiPhase === 'buying' ? (
                isHumanBuyerTurn
                  ? `${activeBuyer?.name} — Buy decision`
                  : `${activeBuyer?.name ?? '...'} deciding...`
              ) : (
                <>
                  {currentPlayer.name}'s turn
                  {currentPlayer.isAI && <span className="ml-1 text-xs font-normal text-[#6aad7a]">(AI)</span>}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#a8d0a8] bg-[#1e4a2e] px-2 py-1 rounded-full">
              {currentPlayer.buysRemaining}/{MAX_BUYS} buys
            </span>
            <button
              onClick={() => setShowPauseModal(true)}
              aria-label="Pause game"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1e4a2e] text-[#a8d0a8] active:bg-[#2d5a3c]"
            >
              <Pause size={18} />
            </button>
          </div>
        </div>

        {/* Player cards mini-bar */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 px-4">
          {gameState.players.map(p => {
            const total = p.roundScores.reduce((s, n) => s + n, 0)
            const isCurrent = p.id === currentPlayer.id
            const isBuyer = uiPhase === 'buying' && activeBuyer?.id === p.id
            const isLow = p.hand.length <= 3 && p.hand.length > 0
            return (
              <div
                key={p.id}
                className={`flex-shrink-0 rounded-lg px-2 py-1.5 text-center min-w-[52px] ${
                  isBuyer ? 'bg-[#e2b858]' :
                  isCurrent ? 'bg-[#2d5a3c]' : 'bg-[#1e4a2e]'
                }`}
              >
                <p className={`text-[10px] font-medium truncate max-w-[48px] ${
                  isBuyer || isCurrent ? 'text-[#2c1810]' : 'text-[#a8d0a8]'
                }`}>
                  {p.name.split(' ')[0]}
                  {p.isAI && ' 🤖'}
                </p>
                <p className={`font-mono text-xs font-bold ${
                  isBuyer || isCurrent ? 'text-[#2c1810]' : 'text-[#6aad7a]'
                }`}>
                  {total}
                </p>
                <p className={`text-[9px] font-semibold ${
                  isLow ? 'text-[#f87171]' :
                  isBuyer || isCurrent ? 'text-[#2c1810]' : 'text-[#6aad7a]'
                }`}>
                  {p.hand.length}🃏
                </p>
                <p className={`text-[9px] ${
                  p.buysRemaining === 0 ? 'text-[#f87171]' :
                  isBuyer || isCurrent ? 'text-[#2c1810]' : 'text-[#6aad7a]'
                }`}>
                  {p.buysRemaining}🛒
                </p>
              </div>
            )
          })}
        </div>

        {/* Toast messages — live in Zone 1 so Zone 2 is unaffected */}
        {reshuffleMsg && (
          <div className="bg-[#e2b858] px-4 py-2 text-center text-sm font-medium text-[#2c1810]">
            Draw pile reshuffled from discards
          </div>
        )}
        {aiMessage && (
          <div className="bg-[#1e4a2e] px-4 py-2 text-center text-sm text-[#a8d0a8] animate-pulse">
            {aiMessage}
          </div>
        )}
      </div>

      {/* ── ZONE 2: Scrollable Middle — table content only ──────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">

        {/* Table melds */}
        <TableMelds melds={rs.tablesMelds} />

        {/* Draw / discard area */}
        {(uiPhase === 'draw' || uiPhase === 'action' || (uiPhase === 'buying' && !isHumanBuyerTurn)) && (
          <div>
            <p className="text-xs font-semibold text-[#6aad7a] uppercase tracking-wider mb-2">
              {uiPhase === 'draw' && !currentPlayer.isAI ? 'Draw a card' : 'Discard pile'}
            </p>
            <div className="flex gap-4 items-end">
              {uiPhase === 'draw' && !currentPlayer.isAI && (
                <div className="flex flex-col items-center gap-1">
                  <div
                    onClick={handleDrawFromPile}
                    className="w-12 h-[4.5rem] rounded-lg bg-[#2d5a3c] border-2 border-[#e2b858] flex items-center justify-center cursor-pointer active:opacity-70 select-none"
                  >
                    <span className="text-xl">🂠</span>
                  </div>
                  <p className="text-[10px] text-[#8bc48b]">Draw pile</p>
                  <p className="text-[10px] text-[#6aad7a]">{rs.drawPile.length} cards</p>
                </div>
              )}

              {topDiscard && (
                <div className="flex flex-col items-center gap-1">
                  <CardComponent
                    card={topDiscard}
                    onClick={uiPhase === 'draw' && !currentPlayer.isAI ? handleTakeDiscard : undefined}
                  />
                  <p className="text-[10px] text-[#8bc48b]">
                    {uiPhase === 'draw' && !currentPlayer.isAI ? 'Take discard' : 'Last discard'}
                  </p>
                  {pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI && (
                    <p className="text-[9px] text-[#e2b858] font-semibold">← buyable</p>
                  )}
                </div>
              )}

              {uiPhase !== 'draw' && (
                <p className="text-xs text-[#6aad7a] self-center">
                  Draw pile: {rs.drawPile.length} cards
                </p>
              )}

              {uiPhase === 'draw' && currentPlayer.isAI && (
                <p className="text-xs text-[#6aad7a] self-center animate-pulse">
                  {currentPlayer.name} is thinking…
                </p>
              )}
            </div>
          </div>
        )}

        {/* Show buying discard during human buy decision */}
        {isHumanBuyerTurn && topDiscard && (
          <div>
            <p className="text-xs font-semibold text-[#6aad7a] uppercase tracking-wider mb-2">Discard pile</p>
            <div className="flex gap-4 items-end">
              <div className="flex flex-col items-center gap-1">
                <CardComponent card={buyingDiscard ?? topDiscard} />
                <p className="text-[10px] text-[#8bc48b]">Card up for sale</p>
              </div>
              <p className="text-xs text-[#6aad7a] self-center">
                Draw pile: {rs.drawPile.length} cards
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── ZONE 3: Fixed Hand + Actions — never moves ──────────────────── */}
      <div
        className="flex-shrink-0 bg-[#0f2218] border-t border-[#2d5a3c] px-4 pt-3"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Human buy banner — pinned above hand when it's human's buy turn */}
        {isHumanBuyerTurn && buyingDiscard && (
          <div className="bg-[#fffbee] border border-[#e2b858] rounded-xl px-3 py-2 mb-3">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 scale-90 origin-left">
                <CardComponent card={buyingDiscard} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#2c1810]">{activeBuyer?.name} — Buy this card?</p>
                <p className="text-[10px] text-[#8b7355]">+ 1 penalty card · {activeBuyer?.buysRemaining}/{MAX_BUYS} buys left</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => handleBuyDecision(false)}
                  className="bg-[#efe9dd] text-[#8b7355] font-semibold rounded-lg px-3 py-2 text-sm active:opacity-80"
                >
                  Pass
                </button>
                <button
                  onClick={() => handleBuyDecision(true)}
                  disabled={!activeBuyer || activeBuyer.buysRemaining <= 0}
                  className="bg-[#e2b858] text-[#2c1810] font-semibold rounded-lg px-3 py-2 text-sm active:opacity-80 disabled:opacity-40"
                >
                  Buy
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Player hand */}
        {!displayPlayer.isAI ? (
          <HandDisplay
            cards={displayPlayer.hand}
            selectedIds={selectedCardIds}
            onToggle={toggleCard}
            label={`${isHumanBuyerTurn ? displayPlayer.name + "'s " : 'Your '}hand (${displayPlayer.hand.length} cards)`}
            disabled={
              (uiPhase !== 'action' && !isHumanBuyerTurn) ||
              pendingUndo !== null
            }
            sort={handSort}
            onSortChange={setHandSort}
            newCardIds={newCardIds}
          />
        ) : aiTurnHumanViewer ? (
          <HandDisplay
            cards={aiTurnHumanViewer.hand}
            selectedIds={new Set()}
            onToggle={() => {}}
            label={`${aiTurnHumanViewer.name}'s hand (${aiTurnHumanViewer.hand.length} cards) — planning`}
            disabled={true}
            sort={handSort}
            onSortChange={setHandSort}
            newCardIds={new Set()}
          />
        ) : null}

        {/* Draw phase instructions */}
        {uiPhase === 'draw' && !currentPlayer.isAI && (
          <p className="text-center text-sm text-[#6aad7a] py-1">
            Tap the draw pile or discard card above
          </p>
        )}

        {/* Undo toast */}
        {pendingUndo && (
          <div className="flex items-center justify-between bg-[#2c1810] text-white rounded-xl px-4 py-3 mt-2">
            <span className="text-sm">Discarded {pendingUndo.card.rank === 0 ? 'Joker' : rankLabel(pendingUndo.card)}</span>
            <button
              onClick={handleUndoDiscard}
              className="text-[#e2b858] text-sm font-bold active:opacity-70"
            >
              Undo
            </button>
          </div>
        )}

        {uiPhase === 'action' && !currentPlayer.isAI && !pendingUndo && (
          <div className="space-y-2 mt-2">
            <div className="flex gap-2">
              {!currentPlayer.hasLaidDown && (
                <button
                  onClick={() => setShowMeldModal(true)}
                  className="bg-[#e2b858] text-[#2c1810] font-bold rounded-xl flex-1 text-sm py-2.5 active:opacity-80"
                >
                  Lay Down Hand
                </button>
              )}
              {currentPlayer.hasLaidDown ? (
                <button
                  onClick={() => { setNewCardIds(new Set()); setShowLayOffModal(true) }}
                  className={`font-semibold border rounded-xl flex-1 text-sm py-2.5 active:opacity-80 ${
                    selectedCardIds.size > 0
                      ? 'bg-[#3d7a4c] text-white border-[#4d9a5c]'
                      : 'bg-[#2d5a3c] text-[#a8d0a8] border-[#3d7a4c]'
                  }`}
                >
                  Lay Off / Swap
                </button>
              ) : hasSwappableJokersBeforeLayDown ? (
                <button
                  onClick={() => { setNewCardIds(new Set()); setShowPreLayDownSwapModal(true) }}
                  className="bg-[#2d5a3c] text-[#a8d0a8] font-semibold border border-[#3d7a4c] rounded-xl flex-1 text-sm py-2.5 active:opacity-80"
                >
                  Swap Joker
                </button>
              ) : (
                <button
                  disabled
                  title="Lay down your hand first"
                  className="bg-[#1e4a2e] text-[#4a7a5a] font-semibold border border-[#2d5a3c] rounded-xl flex-1 text-sm py-2.5 opacity-50 cursor-not-allowed"
                >
                  Lay Off / Swap
                </button>
              )}
            </div>
            {discardError && (
              <p className="text-center text-xs text-[#e87070] bg-[#2c1810]/60 rounded-lg px-3 py-2 border border-[#e87070]/30">
                {discardError}
              </p>
            )}
            <button
              onClick={() => { setNewCardIds(new Set()); handleDiscard() }}
              disabled={selectedCardIds.size !== 1}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all ${
                selectedCardIds.size === 1
                  ? 'bg-white text-[#2c1810] active:opacity-80'
                  : 'bg-[#1e4a2e] text-[#4a7a5a]'
              }`}
            >
              {selectedCardIds.size === 1
                ? (currentPlayer.hand.length === 1 ? 'Discard — lay off to go out instead' : 'Discard Selected Card')
                : 'Tap a card to select, then discard'}
            </button>
          </div>
        )}

        {/* AI turn indicator */}
        {(uiPhase === 'draw' || uiPhase === 'action') && currentPlayer.isAI && !aiMessage && (
          <p className="text-center text-sm text-[#6aad7a] py-1 animate-pulse">
            {currentPlayer.name} is playing...
          </p>
        )}

        {/* Buying phase — AI deciding */}
        {uiPhase === 'buying' && !isHumanBuyerTurn && activeBuyer?.isAI && !aiMessage && (
          <p className="text-center text-sm text-[#6aad7a] py-1 animate-pulse">
            {activeBuyer.name} deciding on buy...
          </p>
        )}
      </div>

      {/* Modals */}
      {showMeldModal && (
        <MeldModal
          hand={sortedCurrentHand}
          requirement={rs.requirement}
          onConfirm={handleMeldConfirm}
          onClose={() => { if (!preLayDownSwap) setShowMeldModal(false) }}
          mustLayDown={preLayDownSwap}
        />
      )}

      {showPreLayDownSwapModal && (
        <LayOffModal
          hand={currentPlayer.hand}
          tablesMelds={rs.tablesMelds}
          onLayOff={handleLayOff}
          onSwapJoker={handleJokerSwap}
          onClose={() => {
            // If player closes without completing a required lay-down, undo any accumulated swaps
            if (preLayDownSwapBaseStateRef.current) {
              setGameState(preLayDownSwapBaseStateRef.current)
              preLayDownSwapBaseStateRef.current = null
            }
            setShowPreLayDownSwapModal(false)
          }}
          preLayDown
          requirement={rs.requirement}
          onPreLayDownSwap={(card, meld) => {
            // Save the original state (before any pre-lay-down swaps) for potential undo
            if (!preLayDownSwapBaseStateRef.current) {
              preLayDownSwapBaseStateRef.current = gameState
            }

            // Compute the swap result synchronously to check if lay-down is now possible
            const afterSwap = computeJokerSwap(gameState, card, meld)
            if (!afterSwap) return // joker not found — should not happen

            const playerIdx = afterSwap.roundState.currentPlayerIndex
            const newHand = afterSwap.players[playerIdx].hand
            const canLayDown = aiFindBestMelds(newHand, rs.requirement) !== null

            if (canLayDown) {
              // Player can now lay down — apply the swap and open MeldModal
              setGameState(afterSwap)
              setSelectedCardIds(new Set())
              preLayDownSwapBaseStateRef.current = null
              setShowPreLayDownSwapModal(false)
              setPreLayDownSwap(true)
              setShowMeldModal(true)
            } else {
              // Check if another swap is still possible from the new hand
              const newTablesMelds = afterSwap.roundState.tablesMelds
              const moreSwapsPossible = newTablesMelds.some(m =>
                m.type === 'run' && m.jokerMappings.length > 0 &&
                newHand.some(c => c.suit !== 'joker' && findSwappableJoker(c, m) !== null)
              )

              if (moreSwapsPossible) {
                // Apply this swap and stay in the swap modal for the next swap
                setGameState(afterSwap)
                setSelectedCardIds(new Set())
                // Modal stays open (showPreLayDownSwapModal remains true)
              } else {
                // No more swaps possible and still can't lay down — undo ALL swaps in this sequence
                const baseState = preLayDownSwapBaseStateRef.current
                setGameState(baseState ?? gameState)
                preLayDownSwapBaseStateRef.current = null
                setSelectedCardIds(new Set())
                setShowPreLayDownSwapModal(false)
                // Show error briefly — use layOffError as a reusable error channel
                setLayOffError('You can only swap jokers if you can lay down afterwards.')
                setTimeout(() => setLayOffError(null), 4000)
              }
            }
          }}
          errorMsg={layOffError}
        />
      )}

      {showLayOffModal && (
        <LayOffModal
          hand={currentPlayer.hand}
          tablesMelds={rs.tablesMelds}
          onLayOff={handleLayOff}
          onSwapJoker={handleJokerSwap}
          onClose={() => { setShowLayOffModal(false); setLayOffError(null) }}
          errorMsg={layOffError}
        />
      )}

      {/* Pause modal */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="w-full bg-[#0f2218] border-t border-[#2d5a3c] rounded-t-2xl px-4 pt-5 pb-10">
            <h2 className="text-lg font-bold text-white text-center mb-1">Game Paused</h2>
            <p className="text-sm text-[#6aad7a] text-center mb-4">
              Round {gameState.currentRound} of {TOTAL_ROUNDS} · {currentPlayer.name}'s turn
            </p>
            {/* Game speed */}
            <p className="text-xs text-[#6aad7a] text-center mb-2">AI Speed</p>
            <div className="bg-[#1e4a2e] rounded-xl p-1 flex gap-1 mb-4">
              {(['fast', 'normal', 'slow'] as GameSpeed[]).map(s => (
                <button
                  key={s}
                  onClick={() => setGameSpeed(s)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                    gameSpeed === s ? 'bg-[#e2b858] text-[#2c1810] shadow-sm' : 'text-[#8bc48b]'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <button
                onClick={() => setShowPauseModal(false)}
                className="bg-[#e2b858] text-[#2c1810] font-bold rounded-xl w-full py-3 text-sm active:opacity-80"
              >
                Resume Game
              </button>
              <button
                onClick={() => {
                  setShowPauseModal(false)
                  if (pendingUndo) clearTimeout(pendingUndo.timerId)
                  onExit()
                }}
                className="w-full rounded-xl py-3 text-sm font-semibold text-[#f87171] bg-[#1e4a2e] active:opacity-80"
              >
                Abandon Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper for undo discard label
function rankLabel(card: CardType): string {
  const r = card.rank
  if (r === 1) return 'A'
  if (r === 11) return 'J'
  if (r === 12) return 'Q'
  if (r === 13) return 'K'
  return String(r)
}
