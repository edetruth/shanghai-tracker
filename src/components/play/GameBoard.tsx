import { useState, useEffect, useRef, useMemo } from 'react'
import { Pause } from 'lucide-react'
import type { GameState, Player, Card as CardType, Meld, PlayerConfig, AIDifficulty } from '../../game/types'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS } from '../../game/rules'
import { createDecks, shuffle, dealHands } from '../../game/deck'
import { buildMeld, isValidSet, findSwappableJoker } from '../../game/meld-validator'
import { scoreRound } from '../../game/scoring'
import { aiFindAllMelds, aiShouldTakeDiscard, aiChooseDiscard, aiChooseDiscardHard, aiShouldBuy, aiShouldBuyHard, aiFindLayOff, aiFindJokerSwap } from '../../game/ai'
import { SUIT_ORDER } from './HandDisplay'
import { haptic } from '../../lib/haptics'
import PrivacyScreen from './PrivacyScreen'
import MeldModal from './MeldModal'
import LayOffModal from './LayOffModal'
import BuyPrompt from './BuyPrompt'
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

  const players = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    melds: [],
    hasLaidDown: false,
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
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [reshuffleMsg, setReshuffleMsg] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  // Bumped after joker swaps (handLen unchanged, need a separate re-trigger)
  const [aiActionTick, setAiActionTick] = useState(0)

  // Stable refs so AI callbacks always have current values
  const gameStateRef = useRef(gameState)
  const uiPhaseRef = useRef(uiPhase)
  const buyerOrderRef = useRef(buyerOrder)
  const buyerStepRef = useRef(buyerStep)
  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { uiPhaseRef.current = uiPhase }, [uiPhase])
  useEffect(() => { buyerOrderRef.current = buyerOrder }, [buyerOrder])
  useEffect(() => { buyerStepRef.current = buyerStep }, [buyerStep])

  // Tracks whether AI has already laid off once this turn (Medium: max 1 lay-off per turn)
  const aiLayOffDoneRef = useRef(false)

  const rs = gameState.roundState
  const currentPlayer = getCurrentPlayer(gameState)
  const topDiscard = rs.discardPile[rs.discardPile.length - 1] ?? null

  // Hand sorted to match player's chosen sort order — passed to MeldModal too
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
    setSelectedCardIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  // ── Draw from pile (with reshuffle if empty) ──────────────────────────────
  function handleDrawFromPile() {
    const needsReshuffle = gameState.roundState.drawPile.length === 0
    setGameState(prev => {
      let drawPile = [...prev.roundState.drawPile]
      let discardPile = [...prev.roundState.discardPile]

      if (drawPile.length === 0) {
        const top = discardPile.pop()
        drawPile = shuffle([...discardPile])
        discardPile = top ? [top] : []
      }

      const card = drawPile.shift()
      if (!card) return prev

      const players = prev.players.map((p, i) =>
        i === prev.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, card] }
          : p
      )
      return { ...prev, players, roundState: { ...prev.roundState, drawPile, discardPile } }
    })

    if (needsReshuffle) {
      setReshuffleMsg(true)
      setTimeout(() => setReshuffleMsg(false), 2500)
    }
    setUiPhase('action')
  }

  // ── Take top discard ──────────────────────────────────────────────────────
  function handleTakeDiscard() {
    setGameState(prev => {
      const discardPile = [...prev.roundState.discardPile]
      const card = discardPile.pop()
      if (!card) return prev
      const players = prev.players.map((p, i) =>
        i === prev.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, card] }
          : p
      )
      return { ...prev, players, roundState: { ...prev.roundState, discardPile } }
    })
    setUiPhase('action')
  }

  // ── Start buying window ───────────────────────────────────────────────────
  function startBuyingWindow(state: GameState, discarder: number, discardCard: CardType | null) {
    const order = buildBuyerOrder(state, discarder)
    setBuyingDiscard(discardCard)
    setBuyerOrder(order)
    setBuyerStep(0)

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

  // ── Score and end round ───────────────────────────────────────────────────
  function endRound(state: GameState) {
    const goOutId = state.roundState.goOutPlayerId
    if (!goOutId) return
    const results = scoreRound(state.players, goOutId)
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setUiPhase('round-end')
  }

  // ── Meld confirmation ─────────────────────────────────────────────────────
  function handleMeldConfirm(meldGroups: CardType[][]) {
    const prev = gameState
    let counter = prev.roundState.meldIdCounter
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]

    const meldedIds = new Set(meldGroups.flatMap(g => g.map(c => c.id)))
    const newMelds: Meld[] = meldGroups.map(cards => {
      const type = isValidSet(cards) ? 'set' : 'run'
      const meldId = `meld-${counter++}`
      return buildMeld(cards, type, player.id, player.name, meldId)
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

    setGameState(updated)
    setShowMeldModal(false)
    haptic(wentOut ? 'success' : 'heavy')

    if (wentOut) {
      const top = updated.roundState.discardPile[updated.roundState.discardPile.length - 1] ?? null
      startBuyingWindow(updated, playerIdx, top)
    }
  }

  // ── Lay off ───────────────────────────────────────────────────────────────
  function handleLayOff(card: CardType, meld: Meld) {
    const prev = gameState
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]
    const newHand = player.hand.filter(c => c.id !== card.id)

    let updatedRunMin = meld.runMin
    let updatedRunMax = meld.runMax
    if (meld.type === 'run') {
      if (card.suit === 'joker') {
        updatedRunMax = (meld.runMax ?? 0) + 1
      } else {
        let r = card.rank
        if (meld.runAceHigh && card.rank === 1) r = 14
        if (r < (meld.runMin ?? 999)) updatedRunMin = r
        if (r > (meld.runMax ?? 0)) updatedRunMax = r
      }
    }

    const updatedMeld: Meld = { ...meld, cards: [...meld.cards, card], runMin: updatedRunMin, runMax: updatedRunMax }
    const tablesMelds = prev.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : prev.roundState.goOutPlayerId
    const players = prev.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)

    const updated: GameState = { ...prev, players, roundState: { ...prev.roundState, tablesMelds, goOutPlayerId } }
    setGameState(updated)
    setShowLayOffModal(false)
    setSelectedCardIds(new Set())

    if (wentOut) {
      const top = updated.roundState.discardPile[updated.roundState.discardPile.length - 1] ?? null
      startBuyingWindow(updated, playerIdx, top)
    }
  }

  // ── Joker swap ────────────────────────────────────────────────────────────
  function handleJokerSwap(naturalCard: CardType, meld: Meld) {
    setGameState(prev => {
      const playerIdx = prev.roundState.currentPlayerIndex
      const player = prev.players[playerIdx]
      const joker = findSwappableJoker(naturalCard, meld)
      if (!joker) return prev

      const newMeldCards = meld.cards.map(c => c.id === joker.id ? naturalCard : c)
      const newJokerMappings = meld.jokerMappings.filter(m => m.cardId !== joker.id)
      const updatedMeld: Meld = { ...meld, cards: newMeldCards, jokerMappings: newJokerMappings }
      const tablesMelds = prev.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
      const newHand = player.hand.filter(c => c.id !== naturalCard.id).concat(joker)
      const players = prev.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)

      return { ...prev, players, roundState: { ...prev.roundState, tablesMelds } }
    })
    setShowLayOffModal(false)
  }

  // ── Discard (with undo support for human players) ─────────────────────────
  function handleDiscard(overrideCardId?: string) {
    const cardId = overrideCardId ?? [...selectedCardIds][0]
    if (!cardId) return

    const playerIdx = rs.currentPlayerIndex
    const player = gameState.players[playerIdx]
    const card = player.hand.find(c => c.id === cardId)
    if (!card) return

    const preDiscardState = gameState
    const newHand = player.hand.filter(c => c.id !== cardId)
    const discardPile = [...rs.discardPile, card]
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : rs.goOutPlayerId

    const players = gameState.players.map((p, i) =>
      i === playerIdx ? { ...p, hand: newHand } : p
    )
    const afterDiscard: GameState = {
      ...gameState,
      players,
      roundState: { ...rs, discardPile, goOutPlayerId },
    }

    setGameState(afterDiscard)
    setSelectedCardIds(new Set())
    haptic('heavy')

    if (!player.isAI) {
      // Show undo toast for 3 seconds before committing the buying window
      const timerId = setTimeout(() => {
        setPendingUndo(null)
        startBuyingWindow(afterDiscard, playerIdx, card)
      }, 3000)
      setPendingUndo({ card, preDiscardState, discarderIdx: playerIdx, timerId })
    } else {
      startBuyingWindow(afterDiscard, playerIdx, card)
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
      const advanced = advancePlayer(withBuy)

      if (withBuy.roundState.goOutPlayerId !== null) {
        endRound(advanced)
      } else {
        const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
        setGameState(advanced)
        setUiPhase(nextPhaseForPlayer(nextPlayer))
      }
    } else {
      const nextStep = buyerStep + 1
      if (nextStep < buyerOrder.length) {
        setBuyerStep(nextStep)
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
      setUiPhase('round-start')
    }
  }

  // ── AI: execute action phase turn ─────────────────────────────────────────
  function executeAIAction() {
    const state = gameStateRef.current
    const player = getCurrentPlayer(state)
    const { tablesMelds, requirement } = state.roundState
    const isHard = aiDifficulty === 'hard'

    // Try to lay down if not yet done — include any bonus melds beyond the requirement
    if (!player.hasLaidDown) {
      const melds = aiFindAllMelds(player.hand, requirement)
      if (melds && melds.length > 0) {
        aiLayOffDoneRef.current = false
        setAiMessage(`${player.name} lays down!`)
        setTimeout(() => setAiMessage(null), 1500)
        handleMeldConfirm(melds)
        return
      }
    }

    // Hard only: try joker swap to reclaim a joker for future use
    if (isHard && player.hasLaidDown && tablesMelds.length > 0) {
      const swap = aiFindJokerSwap(player.hand, tablesMelds)
      if (swap) {
        setAiMessage(`${player.name} swaps a joker`)
        setTimeout(() => setAiMessage(null), 1200)
        handleJokerSwap(swap.card, swap.meld)
        // handLen unchanged after swap — bump tick so the AI effect re-fires
        setAiActionTick(t => t + 1)
        return
      }
    }

    // Try to lay off
    // Medium: max 1 lay-off per turn to prevent dumping all cards onto one meld
    // Hard: unlimited lay-offs per turn
    if (player.hasLaidDown && tablesMelds.length > 0 && (isHard || !aiLayOffDoneRef.current)) {
      const layOff = aiFindLayOff(player.hand, tablesMelds)
      if (layOff) {
        aiLayOffDoneRef.current = true
        setAiMessage(`${player.name} lays off`)
        setTimeout(() => setAiMessage(null), 1200)
        handleLayOff(layOff.card, layOff.meld)
        return
      }
    }

    // Discard — reset lay-off tracker for next turn
    if (player.hand.length > 0) {
      aiLayOffDoneRef.current = false
      const card = isHard
        ? aiChooseDiscardHard(player.hand)
        : aiChooseDiscard(player.hand, requirement)
      setAiMessage(`${player.name} discards`)
      setTimeout(() => setAiMessage(null), 1000)
      handleDiscard(card.id)
    }
  }

  // ── AI turn automation (draw + action) ───────────────────────────────────
  const handLen = currentPlayer.hand.length
  useEffect(() => {
    if (!currentPlayer.isAI) return
    if (uiPhase !== 'draw' && uiPhase !== 'action') return

    const delay = 700 + Math.random() * 500
    const timerId = setTimeout(() => {
      if (uiPhaseRef.current === 'draw') {
        const state = gameStateRef.current
        const player = getCurrentPlayer(state)
        const top = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null
        const shouldTake = top !== null &&
          aiShouldTakeDiscard(player.hand, top, state.roundState.requirement, player.hasLaidDown)
        setAiMessage(shouldTake
          ? `${player.name} takes the discard`
          : `${player.name} draws from pile`)
        setTimeout(() => setAiMessage(null), 1200)
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

    const timerId = setTimeout(() => {
      const state = gameStateRef.current
      const currentBuyer = state.players[buyerOrderRef.current[buyerStepRef.current]]
      const disc = buyingDiscard
      const req = state.roundState.requirement
      const shouldBuy = disc && currentBuyer
        ? (aiDifficulty === 'hard'
            ? aiShouldBuyHard(currentBuyer.hand, disc, req)
            : aiShouldBuy(currentBuyer.hand, disc, req))
        : false
      handleBuyDecision(shouldBuy)
    }, 700)

    return () => clearTimeout(timerId)
  }, [uiPhase, buyerStep, buyerOrder]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (uiPhase === 'round-start') {
    return (
      <div className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          <div className="w-16 h-16 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-[#2c1810]">{gameState.currentRound}</span>
          </div>
          <h2 className="text-2xl font-bold text-[#2c1810] mb-2">Round {gameState.currentRound}</h2>
          <p className="text-base text-[#8b7355] mb-2">{rs.requirement.description}</p>
          <p className="text-sm text-[#a08c6e] mb-8">{rs.cardsDealt} cards dealt</p>
          <button
            onClick={() => setUiPhase(nextPhaseForPlayer(currentPlayer))}
            className="btn-primary"
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

  if (uiPhase === 'buying') {
    const buyerIdx = buyerOrder[buyerStep]
    const buyer = buyerIdx !== undefined ? gameState.players[buyerIdx] : null
    const discardForBuy = buyingDiscard ?? topDiscard

    if (!buyer || !discardForBuy) return null

    // AI buyers are handled by the useEffect above — show a waiting indicator
    if (buyer.isAI) {
      return (
        <div className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6">
          <div className="text-center">
            <p className="text-[#8b7355] text-sm animate-pulse">{buyer.name} is deciding…</p>
          </div>
        </div>
      )
    }

    return (
      <BuyPrompt
        buyerName={buyer.name}
        discardCard={discardForBuy}
        buysRemaining={buyer.buysRemaining}
        onDecision={handleBuyDecision}
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
        }}
        onBack={onExit}
      />
    )
  }

  // ── Main board: draw / action ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-[#e2ddd2] px-4 py-2 flex items-center justify-between">
        <div>
          <p className="text-xs text-[#a08c6e]">Round {gameState.currentRound} of {TOTAL_ROUNDS}</p>
          <p className="text-sm font-bold text-[#2c1810]">
            {currentPlayer.name}'s turn
            {currentPlayer.isAI && <span className="ml-1 text-xs font-normal text-[#a08c6e]">(AI)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8b7355] bg-[#efe9dd] px-2 py-1 rounded-full">
            {currentPlayer.buysRemaining} buys
          </span>
          <button
            onClick={() => setShowPauseModal(true)}
            aria-label="Pause game"
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-[#efe9dd] text-[#8b6914] active:bg-[#e2ddd2]"
          >
            <Pause size={20} />
          </button>
        </div>
      </div>

      {/* Reshuffle notice */}
      {reshuffleMsg && (
        <div className="bg-[#e2b858] px-4 py-2 text-center text-sm font-medium text-[#2c1810]">
          Draw pile reshuffled from discards
        </div>
      )}

      {/* AI action message */}
      {aiMessage && (
        <div className="bg-[#efe9dd] px-4 py-2 text-center text-sm text-[#8b6914] animate-pulse">
          {aiMessage}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 pb-36">
        {/* Round requirement */}
        <div className="bg-[#efe9dd] rounded-lg px-3 py-2 text-xs text-[#8b7355]">
          <span className="font-semibold text-[#8b6914]">Goal: </span>
          {rs.requirement.description}
        </div>

        {/* Scores mini-bar */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {gameState.players.map(p => {
            const total = p.roundScores.reduce((s, n) => s + n, 0)
            const isCurrent = p.id === currentPlayer.id
            return (
              <div
                key={p.id}
                className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-center min-w-[52px] ${
                  isCurrent ? 'bg-[#e2b858]' : 'bg-white border border-[#e2ddd2]'
                }`}
              >
                <p className={`text-[10px] font-medium truncate max-w-[48px] ${isCurrent ? 'text-[#2c1810]' : 'text-[#8b7355]'}`}>
                  {p.name.split(' ')[0]}
                  {p.isAI && ' 🤖'}
                </p>
                <p className={`font-mono text-xs font-bold ${isCurrent ? 'text-[#2c1810]' : 'text-[#a08c6e]'}`}>
                  {total}
                </p>
              </div>
            )
          })}
        </div>

        {/* Table melds */}
        <TableMelds melds={rs.tablesMelds} />

        {/* Draw / discard area */}
        <div>
          <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">
            {uiPhase === 'draw' ? 'Draw a card' : 'Discard pile'}
          </p>
          <div className="flex gap-4 items-end">
            {uiPhase === 'draw' && !currentPlayer.isAI && (
              <div className="flex flex-col items-center gap-1">
                <div
                  onClick={handleDrawFromPile}
                  className="w-12 h-[4.5rem] rounded-lg bg-[#e2b858] border-2 border-[#8b6914] flex items-center justify-center cursor-pointer active:opacity-70 select-none"
                >
                  <span className="text-xl">🂠</span>
                </div>
                <p className="text-[10px] text-[#8b7355]">Draw pile</p>
                <p className="text-[10px] text-[#a08c6e]">{rs.drawPile.length} cards</p>
              </div>
            )}

            {topDiscard && (
              <div className="flex flex-col items-center gap-1">
                <CardComponent
                  card={topDiscard}
                  onClick={uiPhase === 'draw' && !currentPlayer.isAI ? handleTakeDiscard : undefined}
                />
                <p className="text-[10px] text-[#8b7355]">
                  {uiPhase === 'draw' && !currentPlayer.isAI ? 'Take discard' : 'Last discard'}
                </p>
              </div>
            )}

            {uiPhase !== 'draw' && (
              <p className="text-xs text-[#a08c6e] self-center">
                Draw pile: {rs.drawPile.length} cards
              </p>
            )}

            {uiPhase === 'draw' && currentPlayer.isAI && (
              <p className="text-xs text-[#a08c6e] self-center animate-pulse">
                {currentPlayer.name} is thinking…
              </p>
            )}
          </div>
        </div>

        {/* Player hand — hidden for AI turn */}
        {!currentPlayer.isAI && (
          <HandDisplay
            cards={currentPlayer.hand}
            selectedIds={selectedCardIds}
            onToggle={toggleCard}
            label={`Your hand (${currentPlayer.hand.length} cards)`}
            disabled={uiPhase !== 'action' || pendingUndo !== null}
            sort={handSort}
            onSortChange={setHandSort}
          />
        )}
      </div>

      {/* Fixed action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e2ddd2] px-4 pt-3 pb-8 safe-bottom">
        {uiPhase === 'draw' && !currentPlayer.isAI && (
          <p className="text-center text-sm text-[#8b7355] py-1">
            Tap the draw pile or discard card above
          </p>
        )}

        {/* Undo toast */}
        {pendingUndo && (
          <div className="flex items-center justify-between bg-[#2c1810] text-white rounded-xl px-4 py-3">
            <span className="text-sm">Discarded {pendingUndo.card.rank === 0 ? 'Joker' : `${pendingUndo.card.rank}`}</span>
            <button
              onClick={handleUndoDiscard}
              className="text-[#e2b858] text-sm font-bold active:opacity-70"
            >
              Undo
            </button>
          </div>
        )}

        {uiPhase === 'action' && !currentPlayer.isAI && !pendingUndo && (
          <div className="space-y-2">
            <div className="flex gap-2">
              {!currentPlayer.hasLaidDown && (
                <button
                  onClick={() => setShowMeldModal(true)}
                  className="btn-primary flex-1 text-sm py-2.5"
                >
                  Lay Down Hand
                </button>
              )}
              {currentPlayer.hasLaidDown && rs.tablesMelds.length > 0 && (
                <button
                  onClick={() => setShowLayOffModal(true)}
                  className="btn-secondary flex-1 text-sm py-2.5"
                >
                  Lay Off / Swap
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (currentPlayer.hand.length === 1) {
                  handleDiscard(currentPlayer.hand[0].id)
                } else {
                  handleDiscard()
                }
              }}
              disabled={currentPlayer.hand.length !== 1 && selectedCardIds.size !== 1}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all ${
                currentPlayer.hand.length === 1 || selectedCardIds.size === 1
                  ? 'bg-[#2c1810] text-white active:opacity-80'
                  : 'bg-[#efe9dd] text-[#a08c6e]'
              }`}
            >
              {currentPlayer.hand.length === 1
                ? 'Discard Last Card'
                : selectedCardIds.size === 1 ? 'Discard Selected Card' : 'Tap a card to discard'}
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showMeldModal && (
        <MeldModal
          hand={sortedCurrentHand}
          requirement={rs.requirement}
          onConfirm={handleMeldConfirm}
          onClose={() => setShowMeldModal(false)}
        />
      )}

      {showLayOffModal && (
        <LayOffModal
          hand={currentPlayer.hand}
          tablesMelds={rs.tablesMelds}
          onLayOff={handleLayOff}
          onSwapJoker={handleJokerSwap}
          onClose={() => setShowLayOffModal(false)}
        />
      )}

      {/* Pause modal */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="w-full bg-white rounded-t-2xl px-4 pt-5 pb-10">
            <h2 className="text-lg font-bold text-[#2c1810] text-center mb-1">Game Paused</h2>
            <p className="text-sm text-[#8b7355] text-center mb-6">
              Round {gameState.currentRound} of {TOTAL_ROUNDS} · {currentPlayer.name}'s turn
            </p>
            <div className="space-y-2">
              <button
                onClick={() => setShowPauseModal(false)}
                className="btn-primary"
              >
                Resume Game
              </button>
              <button
                onClick={() => {
                  setShowPauseModal(false)
                  if (pendingUndo) clearTimeout(pendingUndo.timerId)
                  onExit()
                }}
                className="w-full rounded-xl py-3 text-sm font-semibold text-[#b83232] bg-[#fff3f3] active:opacity-80"
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
