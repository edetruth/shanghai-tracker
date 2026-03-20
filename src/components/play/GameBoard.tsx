import { useState, useEffect, useRef, useMemo } from 'react'
import { createPlayedGame, saveGameEvents } from '../../lib/gameStore'
import { Pause } from 'lucide-react'
import type { GameState, Player, Card as CardType, Meld, PlayerConfig, AIDifficulty, OpponentHistory } from '../../game/types'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS, cardPoints } from '../../game/rules'
import { createDecks, shuffle, dealHands } from '../../game/deck'
import { buildMeld, isValidSet, canLayOff, findSwappableJoker, getNextJokerOptions, isLegalDiscard, evaluateLayOffReversal } from '../../game/meld-validator'
import { scoreRound } from '../../game/scoring'
import {
  aiFindBestMelds, aiFindAllMelds, aiShouldTakeDiscard, aiShouldTakeDiscardHard, aiShouldTakeDiscardEasy,
  aiChooseDiscard, aiChooseDiscardHard, aiChooseDiscardEasy,
  aiShouldBuy, aiShouldBuyEasy, aiShouldBuyHard,
  aiFindLayOff, aiFindJokerSwap, aiFindPreLayDownJokerSwap,
  aiShouldGoDownHard
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
import BuyPrompt from './BuyPrompt'

interface Props {
  initialPlayers: PlayerConfig[]
  aiDifficulty?: AIDifficulty
  buyLimit?: number
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

interface BuyLogEntry {
  turn: number
  round: number
  event: 'discard' | 'free_offer' | 'free_taken' | 'free_declined' | 'buy_window_open' | 'buy_offered' | 'bought' | 'passed' | 'window_closed' | 'went_down' | 'went_out' | 'shanghaied' | 'joker_swap' | 'scenario_b' | 'scenario_c'
  playerName: string
  card: string
  detail?: string
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function initGame(configs: PlayerConfig[], buyLimit = 5): GameState {
  const deckCount = configs.length <= 4 ? 2 : 3
  // -1 = unlimited; store as 999 so the game engine's numeric guards work correctly
  const effectiveBuyLimit = buyLimit === -1 ? 999 : buyLimit
  const players: Player[] = configs.map((cfg, i) => ({
    id: `p${i}`,
    name: cfg.name,
    hand: [],
    melds: [],
    hasLaidDown: false,
    buysRemaining: effectiveBuyLimit,
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
    buyLimit: effectiveBuyLimit,
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

  // Reset buys to buyLimit (or MAX_BUYS as fallback) for each new round
  const perRoundBuys = state.buyLimit ?? MAX_BUYS
  const players = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    melds: [],
    hasLaidDown: false,
    buysRemaining: perRoundBuys,
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

export default function GameBoard({ initialPlayers, aiDifficulty = 'medium', buyLimit = 5, onExit }: Props) {
  const [gameState, setGameState] = useState<GameState>(() => initGame(initialPlayers, buyLimit))
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
  const [buyLog, setBuyLog] = useState<BuyLogEntry[]>([])
  const [gameId, setGameId] = useState<string | null>(null)
  // True after player taps "Pass" on the free discard offer — hides banner until next offer
  const [freeOfferDeclined, setFreeOfferDeclined] = useState(false)
  const turnCountRef = useRef(0)
  const pendingSaveRef = useRef<number>(0)
  const [discardError, setDiscardError] = useState<string | null>(null)
  const [layOffError, setLayOffError] = useState<string | null>(null)
  const [preLayDownSwap, setPreLayDownSwap] = useState(false)
  const [showPreLayDownSwapModal, setShowPreLayDownSwapModal] = useState(false)
  // Selection state for the inline pre-lay-down swap modal
  const [preSwapCardId, setPreSwapCardId] = useState<string | null>(null)
  const [preSwapMeldId, setPreSwapMeldId] = useState<string | null>(null)
  // Snapshot of game state BEFORE any pre-lay-down joker swaps — used to undo if player can't lay down after all swaps
  const preLayDownSwapBaseStateRef = useRef<GameState | null>(null)
  // Stalemate tracking (turns without any meld)
  const noProgressTurnsRef = useRef(0)
  const drawPileDepletionsRef = useRef(0)
  // Opponent history: tracks picked/discarded cards per player per round (Hard AI awareness)
  const opponentHistoryRef = useRef<Map<string, OpponentHistory>>(new Map())
  // Hard AI going-down timing: how many turns this AI could have gone down but chose to wait
  const aiTurnsCouldGoDownRef = useRef<Map<string, number>>(new Map())
  // Panic mode: total turns elapsed per AI player per round (resets each round)
  const aiTurnsElapsedRef = useRef<Map<string, number>>(new Map())

  // Post-draw buying: when true, after buying window resolves the CURRENT player acts (they already drew)
  const buyingIsPostDrawRef = useRef(false)
  // Track who discarded the current card — so they can't buy it back
  const lastDiscarderIdxRef = useRef<number>(-1)

  // Stable refs so AI callbacks always have current values
  const gameStateRef = useRef(gameState)
  const uiPhaseRef = useRef(uiPhase)
  const buyerOrderRef = useRef(buyerOrder)
  const buyerStepRef = useRef(buyerStep)
  const pendingBuyDiscardRef = useRef(pendingBuyDiscard)
  // Ref mirror of freeOfferDeclined — needed so handleDrawFromPile can read it
  // without relying on the state value (which may not have synced via useEffect yet)
  const freeOfferDeclinedRef = useRef(false)
  // Stores the pending card at decline time so handleDrawFromPile can open the
  // buying window even if pendingBuyDiscardRef.current has been cleared
  const declinedPendingCardRef = useRef<CardType | null>(null)
  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { uiPhaseRef.current = uiPhase }, [uiPhase])
  useEffect(() => { buyerOrderRef.current = buyerOrder }, [buyerOrder])
  useEffect(() => { buyerStepRef.current = buyerStep }, [buyerStep])
  useEffect(() => { pendingBuyDiscardRef.current = pendingBuyDiscard }, [pendingBuyDiscard])
  useEffect(() => { freeOfferDeclinedRef.current = freeOfferDeclined }, [freeOfferDeclined])

  function addBuyLog(entry: BuyLogEntry) {
    setBuyLog(prev => [...prev, entry])
  }

  function recordOpponentEvent(playerId: string, type: 'picked' | 'discarded', card: CardType) {
    const map = opponentHistoryRef.current
    if (!map.has(playerId)) map.set(playerId, { picked: [], discarded: [] })
    map.get(playerId)![type].push(card)
  }

  // ── Create game record on mount ───────────────────────────────────────────
  useEffect(() => {
    const date = new Date().toISOString().split('T')[0]
    const playerNames = initialPlayers.map(p => p.name)
    const gameType = initialPlayers.some(p => p.isAI) ? 'ai' : 'pass-and-play'
    const effectiveBuyLimit = buyLimit === -1 ? 999 : buyLimit
    createPlayedGame(playerNames, date, gameType, effectiveBuyLimit)
      .then(id => setGameId(id))
      .catch(() => {}) // silent fail — telemetry must never break the game
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flush telemetry events to Supabase ───────────────────────────────────
  async function flushTelemetry(events: BuyLogEntry[]) {
    if (!gameId || events.length === 0) return
    const toSave = events.slice(pendingSaveRef.current)
    if (toSave.length === 0) return
    await saveGameEvents(gameId, toSave)
    pendingSaveRef.current = events.length
  }

  // Reset declined flag whenever a new free offer arrives
  useEffect(() => {
    if (pendingBuyDiscard !== null) setFreeOfferDeclined(false)
  }, [pendingBuyDiscard])

  // Log free_offer whenever pendingBuyDiscard becomes non-null
  useEffect(() => {
    if (pendingBuyDiscard === null) return
    const state = gameStateRef.current
    const nextPlayer = getCurrentPlayer(state)
    setBuyLog(prev => [...prev, {
      turn: turnCountRef.current,
      round: state.currentRound,
      event: 'free_offer' as const,
      playerName: nextPlayer.name,
      card: formatCard(pendingBuyDiscard),
    }])
  }, [pendingBuyDiscard]) // eslint-disable-line react-hooks/exhaustive-deps

  // Log buy_offered whenever it's a new player's turn in the buying window
  useEffect(() => {
    if (uiPhase !== 'buying') return
    const buyerIdx = buyerOrder[buyerStep]
    if (buyerIdx === undefined) return
    const buyer = gameState.players[buyerIdx]
    if (!buyer || !buyingDiscard) return
    setBuyLog(prev => [...prev, {
      turn: turnCountRef.current,
      round: gameState.currentRound,
      event: 'buy_offered' as const,
      playerName: buyer.name,
      card: formatCard(buyingDiscard),
      detail: `buys: ${buyer.buysRemaining}/${gameState.buyLimit >= 999 ? '∞' : gameState.buyLimit}`,
    }])
  }, [uiPhase, buyerStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // Medium AI: max 2 lay-offs per turn
  const aiLayOffCountRef = useRef(0)

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

  // ── Decline free discard offer — clears banner without drawing ───────────
  function handleDeclineFreeOffer() {
    // Use pendingBuyDiscard (React state, always current in this closure) as the
    // authoritative source. The ref may not be synced yet if useEffect hasn't fired.
    const pendingCard = pendingBuyDiscard ?? pendingBuyDiscardRef.current
    declinedPendingCardRef.current = pendingCard   // save for handleDrawFromPile
    setFreeOfferDeclined(true)
    if (pendingCard) {
      addBuyLog({
        turn: turnCountRef.current,
        round: gameStateRef.current.currentRound,
        event: 'free_declined',
        playerName: getCurrentPlayer(gameStateRef.current).name,
        card: formatCard(pendingCard),
      })
    }
  }

  // ── Draw from pile (with reshuffle if empty) ──────────────────────────────
  function handleDrawFromPile() {
    // Use BOTH the ref and the React state value for wasExplicitlyDeclined.
    // freeOfferDeclinedRef.current covers the AI stale-closure case.
    // freeOfferDeclined (state) covers the human case where the ref may not yet be
    // synced via useEffect (React 18 async commit can cause a brief desync window).
    const wasExplicitlyDeclined = freeOfferDeclinedRef.current || freeOfferDeclined
    const savedDeclinedCard = declinedPendingCardRef.current  // saved by handleDeclineFreeOffer
    setFreeOfferDeclined(false)
    declinedPendingCardRef.current = null
    // pendingBuyDiscard (React state) is checked first — always current for human
    // clicks (fresh closure). pendingBuyDiscardRef.current covers the AI setTimeout
    // path where the closure may be from an older render.
    const hasPendingBuy = pendingBuyDiscard !== null || pendingBuyDiscardRef.current !== null || wasExplicitlyDeclined
    const pendingCard = pendingBuyDiscard ?? pendingBuyDiscardRef.current ?? (wasExplicitlyDeclined ? savedDeclinedCard : null)
    const currentIdx = rs.currentPlayerIndex
    const needsReshuffle = gameState.roundState.drawPile.length === 0

    // Compute draw pile snapshots synchronously — used to build updatedState below
    // and to identify the drawn card for setNewCardIds.
    let drawPileSnapshot = [...gameState.roundState.drawPile]
    let discardPileSnapshot = [...gameState.roundState.discardPile]
    if (drawPileSnapshot.length === 0) {
      const top = discardPileSnapshot.pop()
      drawPileSnapshot = shuffle([...discardPileSnapshot])
      discardPileSnapshot = top ? [top] : []
    }
    // Shift the drawn card from the snapshot (already includes any reshuffle applied above)
    const drawnCard = drawPileSnapshot.shift() ?? null

    // Track draw-pile depletions synchronously (needed for stalemate detection)
    if (needsReshuffle) drawPileDepletionsRef.current += 1

    // Build updatedState synchronously from the snapshots computed above.
    // IMPORTANT: We cannot use the setGameState(prev => ...) updater pattern here because
    // in React 18 concurrent mode (createRoot) the updater runs asynchronously during the
    // render phase — updatedState would still be null when startBuyingWindowPostDraw is
    // called below, causing the buying window to never open.
    let updatedState: GameState | null = null
    if (drawnCard) {
      const players = gameState.players.map((p, i) =>
        i === gameState.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, drawnCard] }
          : p
      )
      updatedState = {
        ...gameState,
        players,
        roundState: { ...gameState.roundState, drawPile: drawPileSnapshot, discardPile: discardPileSnapshot },
      }
      setGameState(updatedState)
    }

    if (drawnCard) setNewCardIds(new Set([drawnCard.id]))

    if (needsReshuffle) {
      setReshuffleMsg(true)
      setTimeout(() => setReshuffleMsg(false), 2500)
    }

    if (hasPendingBuy && pendingCard && updatedState) {
      setPendingBuyDiscard(null)
      // Only log free_declined here when the decline wasn't logged already by
      // handleDeclineFreeOffer (i.e. the AI or a silent path that skips the banner)
      if (!wasExplicitlyDeclined) {
        addBuyLog({
          turn: turnCountRef.current,
          round: gameStateRef.current.currentRound,
          event: 'free_declined',
          playerName: getCurrentPlayer(gameStateRef.current).name,
          card: formatCard(pendingCard),
        })
      }
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

    if (pendingBuyDiscardRef.current !== null) {
      const state = gameStateRef.current
      addBuyLog({
        turn: turnCountRef.current,
        round: state.currentRound,
        event: 'free_taken',
        playerName: getCurrentPlayer(state).name,
        card: formatCard(card),
      })
    }

    setPendingBuyDiscard(null) // clear pending buy — card is taken
    setNewCardIds(new Set([card.id]))

    // Record for opponent awareness (Hard AI)
    const taker = gameState.players[gameState.roundState.currentPlayerIndex]
    recordOpponentEvent(taker.id, 'picked', card)

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
      if (discardCard) {
        addBuyLog({
          turn: turnCountRef.current,
          round: state.currentRound,
          event: 'buy_window_open',
          playerName: state.players[discarder]?.name ?? '?',
          card: formatCard(discardCard),
          detail: `${order.length} buyer(s)`,
        })
      }
      setUiPhase('buying')
    }
  }

  // ── Start buying window AFTER current player drew from pile (Rule 9A) ─────
  // Buyers are players AFTER currentPlayerIdx; current player will act after buying resolves
  function startBuyingWindowPostDraw(state: GameState, drewPlayerIdx: number, discardCard: CardType) {
    const order: number[] = []
    const count = state.players.length
    const originalDiscarder = lastDiscarderIdxRef.current
    for (let i = 1; i < count; i++) {
      const idx = (drewPlayerIdx + i) % count
      // Exclude original discarder — can't buy back their own card
      if (idx === originalDiscarder) continue
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
      addBuyLog({
        turn: turnCountRef.current,
        round: state.currentRound,
        event: 'buy_window_open',
        playerName: drewPlayer.name,
        card: formatCard(discardCard),
        detail: `post-draw, ${order.length} buyer(s)`,
      })
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
    state.players.forEach(p => {
      if (!p.hasLaidDown) {
        const r = results.find(r => r.playerId === p.id)
        addBuyLog({ round: state.currentRound, turn: turnCountRef.current, event: 'shanghaied', playerName: p.name, card: '', detail: `score: ${r?.score ?? 0}` })
      }
    })
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setUiPhase('round-end')
    flushTelemetry(buyLog) // fire-and-forget — telemetry must never block game flow
  }

  // ── Force end round (stalemate) ───────────────────────────────────────────
  function forceEndRound(state: GameState) {
    noProgressTurnsRef.current = 0
    drawPileDepletionsRef.current = 0
    // If nobody has gone out, score all remaining hands (nobody gets 0)
    const results = state.players.map(p => ({
      playerId: p.id,
      score: p.hand.reduce((sum, c) => sum + (c.rank === 0 ? 50 : c.rank === 1 ? 20 : c.rank >= 11 ? 10 : c.rank), 0),
      shanghaied: !p.hasLaidDown,
    }))
    results.forEach(r => {
      if (r.shanghaied) {
        const p = state.players.find(p => p.id === r.playerId)
        if (p) addBuyLog({ round: state.currentRound, turn: turnCountRef.current, event: 'shanghaied', playerName: p.name, card: '', detail: `score: ${r.score}` })
      }
    })
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setUiPhase('round-end')
    setAiMessage('Round ended — no one went out (stalemate)')
    setTimeout(() => setAiMessage(null), 4000)
    flushTelemetry(buyLog) // fire-and-forget — telemetry must never block game flow
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
    addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_down', playerName: player.name, card: '', detail: `melds: ${newMelds.length}` })
    if (wentOut) addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_out', playerName: player.name, card: '', detail: 'hand was empty' })
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

    // GDD Section 6.3 Scenario C: if the lay-off would leave 1 unplayable card, reverse it
    const layOffEval = evaluateLayOffReversal(card, meld, player.hand, prev.roundState.tablesMelds, jokerPosition)
    if (layOffEval.outcome === 'reversed') {
      // GDD Section 6.3 Scenario C: restore BOTH cards to the hand and stay in action phase.
      // newHand = player.hand minus the tried lay-off card (contains the unplayable card).
      // Adding card back gives the player their full 2-card hand again.
      const finalHand = [...newHand, card]
      const playersC = prev.players.map((p, i) =>
        i === playerIdx ? { ...p, hand: finalHand } : p
      )
      const afterReversal: GameState = {
        ...prev,
        players: playersC,
        roundState: { ...prev.roundState },
      }
      addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'scenario_c', playerName: player.name, card: '', detail: 'lay-off reversed' })
      setGameState(afterReversal)
      setSelectedCardIds(new Set())
      setLayOffError(null)
      haptic('heavy')
      // Close the LayOffModal and return player to action phase — do NOT advance turns
      // or set pendingBuyDiscard (the unplayable card stays in hand, not offered as a buy).
      setShowLayOffModal(false)
      setUiPhase('action')
      setDiscardError('Lay-off reversed — discard the unplayable card and keep the playable one for next turn.')
      setTimeout(() => setDiscardError(null), 4000)
      return
    }

    const updated: GameState = { ...prev, players, roundState: { ...prev.roundState, tablesMelds, goOutPlayerId } }
    setGameState(updated)
    setSelectedCardIds(new Set())
    setLayOffError(null)

    if (wentOut) {
      addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_out', playerName: player.name, card: '', detail: 'hand was empty' })
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
    const swapPlayer = gameState.players[gameState.roundState.currentPlayerIndex]
    addBuyLog({ round: gameState.currentRound, turn: turnCountRef.current, event: 'joker_swap', playerName: swapPlayer.name, card: formatCard(naturalCard), detail: '' })
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

    // Track who discarded so they can't buy their own card back
    lastDiscarderIdxRef.current = playerIdx

    const newHand = player.hand.filter(c => c.id !== cardId)

    // Scenario B: player went down with bonus melds and their last card can't be laid off.
    // Roll back only the bonus melds (required melds stay on the table), then auto-discard
    // the least useful card from the reconstituted hand.
    if (!isLegalDiscard(player.hand, cardId) && player.hasLaidDown) {
      const req = rs.requirement
      let setCount = 0
      let runCount = 0
      const bonusMelds: Meld[] = []
      for (const meld of player.melds) {
        if (meld.type === 'set' && setCount < req.sets) { setCount++ }
        else if (meld.type === 'run' && runCount < req.runs) { runCount++ }
        else { bonusMelds.push(meld) }
      }
      if (bonusMelds.length > 0) {
        const bonusMeldIds = new Set(bonusMelds.map(m => m.id))
        const bonusCards = bonusMelds.flatMap(m => m.cards)
        const newTablesMelds = rs.tablesMelds.filter(m => !bonusMeldIds.has(m.id))
        const newPlayerMelds = player.melds.filter(m => !bonusMeldIds.has(m.id))
        const reconstitutedHand = [...player.hand, ...bonusCards]
        const discardCard = aiChooseDiscard(reconstitutedHand, rs.requirement, newTablesMelds)
        const finalHand = reconstitutedHand.filter(c => c.id !== discardCard.id)
        const newDiscardPile = [...rs.discardPile, discardCard]
        const playersB = gameState.players.map((p, i) =>
          i === playerIdx ? { ...p, hand: finalHand, melds: newPlayerMelds } : p
        )
        const afterRollback: GameState = {
          ...gameState,
          players: playersB,
          roundState: { ...rs, tablesMelds: newTablesMelds, discardPile: newDiscardPile },
        }
        addBuyLog({ round: gameState.currentRound, turn: turnCountRef.current, event: 'scenario_b', playerName: player.name, card: '', detail: 'bonus meld reversed' })
        setGameState(afterRollback)
        setSelectedCardIds(new Set())
        haptic('heavy')
        const advanced = advancePlayer(afterRollback)
        const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
        turnCountRef.current += 1
        addBuyLog({
          turn: turnCountRef.current,
          round: gameState.currentRound,
          event: 'discard',
          playerName: player.name,
          card: formatCard(discardCard),
          detail: 'auto (bonus meld rollback)',
        })
        setPendingBuyDiscard(discardCard)
        setGameState(advanced)
        setUiPhase(nextPhaseForPlayer(nextPlayer))
        return
      }
    }

    // Rule: cannot go out by discarding — universal (applies whether or not the player has laid down)
    if (!isLegalDiscard(player.hand, cardId) && !player.isAI) {
      setDiscardError('You cannot go out by discarding. You must lay off your last card to go out.')
      haptic('error')
      setTimeout(() => setDiscardError(null), 3500)
      return
    }
    // AI with 1 card that can't go out by discarding: skip discard, increment stalemate counter, advance turn
    if (!isLegalDiscard(player.hand, cardId) && player.isAI) {
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

    turnCountRef.current += 1
    addBuyLog({
      turn: turnCountRef.current,
      round: gameState.currentRound,
      event: 'discard',
      playerName: player.name,
      card: formatCard(card),
    })

    // Record discard for opponent awareness (Hard AI)
    recordOpponentEvent(player.id, 'discarded', card)

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

  // ── End turn without discarding (stuck with 1 unplayable card) ──────────
  function handleEndTurnStuck() {
    noProgressTurnsRef.current += 1
    haptic('tap')
    // Check stalemate before advancing
    const totalPlayers = gameState.players.length
    if (drawPileDepletionsRef.current >= 2 && noProgressTurnsRef.current > totalPlayers * 8) {
      forceEndRound(gameState)
      return
    }
    const advanced = advancePlayer(gameState)
    const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
    setGameState(advanced)
    setUiPhase(nextPhaseForPlayer(nextPlayer))
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

      // Record buy for opponent awareness (Hard AI)
      recordOpponentEvent(buyer.id, 'picked', buyingDiscard)

      // Highlight newly received buy cards
      const buyNewIds = new Set<string>()
      if (buyingDiscard) buyNewIds.add(buyingDiscard.id)
      if (penaltyCard) buyNewIds.add(penaltyCard.id)
      if (buyNewIds.size > 0) setNewCardIds(buyNewIds)

      addBuyLog({
        turn: turnCountRef.current,
        round: gameState.currentRound,
        event: 'bought',
        playerName: buyer.name,
        card: buyingDiscard ? formatCard(buyingDiscard) : '?',
        detail: `buys after: ${buyer.buysRemaining - 1}/${gameState.buyLimit >= 999 ? '∞' : gameState.buyLimit}`,
      })

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
      const passerName = buyerOrder[buyerStep] !== undefined ? gameState.players[buyerOrder[buyerStep]]?.name ?? '?' : '?'
      addBuyLog({
        turn: turnCountRef.current,
        round: gameState.currentRound,
        event: 'passed',
        playerName: passerName,
        card: buyingDiscard ? formatCard(buyingDiscard) : '?',
      })
      if (nextStep < buyerOrder.length) {
        setBuyerStep(nextStep)
      } else {
        // All buyers passed
        addBuyLog({
          turn: turnCountRef.current,
          round: gameState.currentRound,
          event: 'window_closed',
          playerName: '-',
          card: buyingDiscard ? formatCard(buyingDiscard) : '?',
          detail: 'no buyer',
        })
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

  // ── Reset for a brand-new game (play again) ──────────────────────────────
  async function startNewGame() {
    setGameState(initGame(initialPlayers, buyLimit))
    setUiPhase('round-start')
    setRoundResults(null)
    setSelectedCardIds(new Set())
    setPendingUndo(null)
    setPendingBuyDiscard(null)
    setBuyLog([])
    setGameId(null)
    pendingSaveRef.current = 0
    noProgressTurnsRef.current = 0
    drawPileDepletionsRef.current = 0
    const date = new Date().toISOString().split('T')[0]
    const playerNames = initialPlayers.map(p => p.name)
    const gameType = initialPlayers.some(p => p.isAI) ? 'ai' : 'pass-and-play'
    const effectiveBuyLimit = buyLimit === -1 ? 999 : buyLimit
    try {
      const id = await createPlayedGame(playerNames, date, gameType, effectiveBuyLimit)
      setGameId(id)
    } catch {
      // silent fail — telemetry must never break the game
    }
  }

  // ── Next round / game over ────────────────────────────────────────────────
  function handleNextRound() {
    noProgressTurnsRef.current = 0
    drawPileDepletionsRef.current = 0
    opponentHistoryRef.current = new Map()
    aiTurnsCouldGoDownRef.current = new Map()
    aiTurnsElapsedRef.current = new Map()
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

    // Track turns elapsed for panic mode
    const turnsElapsed = (aiTurnsElapsedRef.current.get(player.id) ?? 0) + 1
    aiTurnsElapsedRef.current.set(player.id, turnsElapsed)

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

    // Easy AI: lay down required melds, 1 lay-off per turn (jokers exempt), then discard
    if (isEasy) {
      if (!player.hasLaidDown) {
        const melds = aiFindBestMelds(player.hand, requirement)
        if (melds && melds.length > 0) {
          aiLayOffCountRef.current = 0
          setAiMessage(`${player.name} lays down`)
          setTimeout(() => setAiMessage(null), 1200)
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        }
      }
      // Easy: never lays off (GDD Section 11) — discard a random isolated card
      aiLayOffCountRef.current = 0
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
        // Hard AI: evaluate whether to go down now or wait for a better hand
        if (isHard) {
          const turnsWaited = aiTurnsCouldGoDownRef.current.get(player.id) ?? 0
          const shouldGoDown = aiShouldGoDownHard(
            player.hand, melds, requirement, tablesMelds,
            state.players, state.roundState.currentPlayerIndex, turnsWaited,
          )
          if (!shouldGoDown) {
            aiTurnsCouldGoDownRef.current.set(player.id, turnsWaited + 1)
            setAiMessage(`${player.name} holds...`)
            setTimeout(() => setAiMessage(null), 1000)
            // Fall through to discard instead of melding
          } else {
            aiTurnsCouldGoDownRef.current.delete(player.id)
            aiLayOffCountRef.current = 0
            noProgressTurnsRef.current = 0
            setAiMessage(`${player.name} lays down!`)
            setTimeout(() => setAiMessage(null), 1500)
            handleMeldConfirm(melds, aiJokerPositions(melds))
            return
          }
        } else {
          // Medium: always go down immediately
          aiLayOffCountRef.current = 0
          noProgressTurnsRef.current = 0
          setAiMessage(`${player.name} lays down!`)
          setTimeout(() => setAiMessage(null), 1500)
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        }
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

    // Try to lay off (Easy: max 1/turn; Medium: max 2/turn; Hard: unlimited; jokers always exempt)
    const layOffCap = isHard ? Infinity : isEasy ? 1 : 2
    const hasJokerInHand = player.hand.some(c => c.suit === 'joker')
    if (player.hasLaidDown && tablesMelds.length > 0 &&
        (aiLayOffCountRef.current < layOffCap || player.hand.length === 1 || hasJokerInHand)) {
      const layOff = aiFindLayOff(player.hand, tablesMelds)
      if (layOff) {
        if (layOff.card.suit !== 'joker') aiLayOffCountRef.current++  // jokers don't count toward cap
        setAiMessage(`${player.name} lays off`)
        setTimeout(() => setAiMessage(null), 1000)
        handleLayOff(layOff.card, layOff.meld, layOff.jokerPosition)
        return
      }
    }

    // Discard
    if (player.hand.length > 0) {
      aiLayOffCountRef.current = 0

      // Panic mode: stuck for 8+ turns without laying down — dump highest-point card to minimize damage
      let card: CardType
      if (!player.hasLaidDown && turnsElapsed >= 8) {
        const nonJokers = player.hand.filter(c => c.suit !== 'joker')
        const pool = nonJokers.length > 0 ? nonJokers : player.hand
        card = pool.reduce((worst, c) => cardPoints(c.rank) > cardPoints(worst.rank) ? c : worst)
        setAiMessage(`${player.name} dumps a card`)
      } else {
        card = isHard
          ? aiChooseDiscardHard(player.hand, tablesMelds, opponentHistoryRef.current,
              state.players.filter(p => p.id !== player.id), requirement)
          : aiChooseDiscard(player.hand, requirement, tablesMelds)
        setAiMessage(`${player.name} discards`)
      }
      console.log(`[Buy] AI ${player.name} discarded [${card.rank === 0 ? 'Joker' : `${card.rank}${card.suit}`}]`)
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
        const isHard = aiDifficulty === 'hard'
        const shouldTake = top !== null && (
          isEasy
            ? aiShouldTakeDiscardEasy(player.hand, top, state.roundState.requirement)
            : isHard
              ? aiShouldTakeDiscardHard(player.hand, top, state.roundState.requirement, player.hasLaidDown,
                  state.roundState.tablesMelds, state.players.filter(p => p.id !== player.id))
              : aiShouldTakeDiscard(player.hand, top, state.roundState.requirement, player.hasLaidDown, aiDifficulty, state.roundState.tablesMelds)
        )

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
        ? aiShouldBuyEasy(currentBuyer.hand, disc, req, currentBuyer.buysRemaining)
        : aiDifficulty === 'hard'
          ? aiShouldBuyHard(currentBuyer.hand, disc, req, currentBuyer.buysRemaining,
              state.roundState.tablesMelds, state.players.filter(p => p.id !== currentBuyer.id))
          : aiShouldBuy(currentBuyer.hand, disc, req, currentBuyer.buysRemaining, state.buyLimit)

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
        buyLimit={gameState.buyLimit}
        buyLog={buyLog}
        gameId={gameId}
        onPlayAgain={startNewGame}
        onBack={onExit}
      />
    )
  }

  // ── Main board: draw / action / buying ────────────────────────────────────
  // Display-only derivations (no state mutations)
  // Player has 1 card, has laid down, and can't lay it off anywhere — stuck
  const lastCardStuck = uiPhase === 'action' && !currentPlayer.isAI &&
    currentPlayer.hand.length === 1 && currentPlayer.hasLaidDown &&
    !rs.tablesMelds.some(m => canLayOff(currentPlayer.hand[0], m))
  const buyLimitStr = gameState.buyLimit >= 999 ? '∞' : String(gameState.buyLimit)
  const isHumanDraw = uiPhase === 'draw' && !currentPlayer.isAI

  return (
    <div
      className="bg-[#1a3a2a]"
      style={{ minHeight: '100dvh', overflowY: 'auto' }}
    >
      <style>{`
        @keyframes gbPulseGold{0%,100%{box-shadow:0 0 0 0 rgba(226,184,88,0)}50%{box-shadow:0 0 22px 8px rgba(226,184,88,0.85)}}
        @keyframes gbPulseGreen{0%,100%{box-shadow:0 0 0 0 rgba(106,173,122,0);transform:scale(1)}50%{box-shadow:0 0 22px 8px rgba(106,173,122,0.85);transform:scale(1.08)}}
      `}</style>
      {/* ── ZONE 1: Sticky top — top bar + opponent strip + toasts ─────── */}
      <div
        className="bg-[#0f2218]"
        style={{ position: 'sticky', top: 0, zIndex: 10, paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        {/* Top bar: round badge | requirement badge | pause (spec §2.1) */}
        <div
          className="flex items-center justify-between px-3 pb-2"
          style={{ borderBottom: '1px solid #2d5a3a', minHeight: 30 }}
        >
          {/* Round badge */}
          <div style={{
            background: '#0f2218', color: '#a8d0a8',
            border: '1px solid #2d5a3a', borderRadius: 20,
            padding: '4px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            Round {gameState.currentRound}/{TOTAL_ROUNDS}
          </div>

          {/* Requirement badge */}
          <div style={{
            background: '#0f2218', color: '#e2b858',
            border: '1px solid #8b6914', borderRadius: 20,
            padding: '4px 10px', fontSize: 11, fontWeight: 600,
            textAlign: 'center', flex: '0 1 auto', margin: '0 8px',
          }}>
            {rs.requirement.description}
          </div>

          {/* Pause button — 48px minimum touch target */}
          <button
            onClick={() => setShowPauseModal(true)}
            aria-label="Pause game"
            style={{
              background: '#0f2218', border: '1px solid #2d5a3a', borderRadius: 8,
              color: '#a8d0a8', minWidth: 40, minHeight: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Pause size={18} />
          </button>
        </div>

        {/* Opponent strip — horizontal scroll, no wrap, hidden scrollbar (spec §2.2) */}
        <div
          className="flex gap-2 px-3 py-2"
          style={{ overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', scrollbarWidth: 'none' }}
        >
          {gameState.players
            .map(p => {
              const total = p.roundScores.reduce((s, n) => s + n, 0)
              const isBuyingNow = uiPhase === 'buying' && activeBuyer?.id === p.id
              const isMe = p.id === displayPlayer.id
              const isActiveTurn = p.id === currentPlayer.id
              const buysColor = p.buysRemaining === 0
                ? '#b83232'
                : p.buysRemaining <= 2
                  ? '#c08040'
                  : '#6aad7a'
              const borderColor = isMe
                ? '#e2b858'
                : isBuyingNow
                  ? '#e2b858'
                  : isActiveTurn
                    ? '#4a7a5a'
                    : '#2d5a3a'
              return (
                <div
                  key={p.id}
                  className={isBuyingNow && !isMe ? 'animate-pulse' : ''}
                  style={{
                    flexShrink: 0,
                    background: isMe ? '#1e3010' : '#0f2218',
                    border: `1px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: '6px 8px',
                    minWidth: 68,
                  }}
                >
                  {/* Name row with meld dot */}
                  <div className="flex items-center gap-1 mb-0.5">
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: p.hasLaidDown ? '#6aad7a' : '#2d5a3a',
                    }} />
                    <p style={{
                      color: isMe ? '#e2b858' : '#a8d0a8', fontSize: 11, fontWeight: 500,
                      maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {isMe ? 'You' : `${p.name.split(' ')[0]}${p.isAI ? ' 🤖' : ''}`}
                    </p>
                  </div>
                  {/* Active turn dot */}
                  {isActiveTurn && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#e2b858', flexShrink: 0 }} />
                      <p style={{ color: '#e2b858', fontSize: 9, fontWeight: 700, margin: 0 }}>their turn</p>
                    </div>
                  )}
                  <p style={{ color: '#6aad7a', fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}>
                    {total} pts
                  </p>
                  <p style={{ color: '#a8d0a8', fontSize: 10 }}>🃏 {p.hand.length}</p>
                  <p style={{ color: buysColor, fontSize: 10, fontWeight: 600 }}>
                    {p.buysRemaining}/{buyLimitStr} buys
                  </p>
                </div>
              )
            })}
        </div>

        {/* Toast slot — always reserves space, content fades in/out */}
        <div
          style={{
            minHeight: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'opacity 150ms ease',
            opacity: reshuffleMsg || aiMessage ? 1 : 0,
            background: reshuffleMsg ? '#e2b858' : '#1e4a2e',
            padding: reshuffleMsg || aiMessage ? '4px 16px' : '4px 16px',
          }}
        >
          {reshuffleMsg ? (
            <span className="text-xs font-medium text-[#2c1810]">Draw pile reshuffled from discards</span>
          ) : aiMessage ? (
            <span className="text-xs text-[#a8d0a8] animate-pulse">{aiMessage}</span>
          ) : (
            <span className="text-xs">{'\u00A0'}</span>
          )}
        </div>
      </div>

      {/* ── ZONE 2: Auto-height middle — piles + table melds ────────────── */}
      <div className="px-3 py-3">

        {/* Draw pile + Discard pile: centered side by side (spec §2.3) */}
        {(uiPhase === 'draw' || uiPhase === 'action' || uiPhase === 'buying') && (
          <div className="flex justify-center items-end gap-6 mb-3">

            {/* Draw pile */}
            <div className="flex flex-col items-center gap-1">
              <p style={{ color: isHumanDraw ? '#ffffff' : '#6aad7a', fontSize: isHumanDraw ? 11 : 9, fontWeight: isHumanDraw ? 700 : 400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isHumanDraw ? 'TAP TO DRAW' : 'Draw'}
              </p>
              {rs.drawPile.length > 0 ? (
                <div style={{ borderRadius: 8, animation: isHumanDraw ? 'gbPulseGreen 1.2s ease-in-out 0.3s infinite' : 'none' }}>
                  <CardComponent
                    card={rs.drawPile[0]}
                    faceDown
                    onClick={isHumanDraw ? handleDrawFromPile : undefined}
                  />
                </div>
              ) : (
                <div
                  className="rounded-lg border-2 border-dashed border-[#2d5a3a] flex items-center justify-center"
                  style={{ width: 41, height: 61, color: '#2d5a3a', fontSize: 9, textAlign: 'center' }}
                >
                  Empty
                </div>
              )}
              <p style={{ color: '#6aad7a', fontSize: 9 }}>{rs.drawPile.length} cards</p>
            </div>

            {/* Discard pile */}
            <div className="flex flex-col items-center gap-1">
              <p style={{ color: isHumanDraw ? '#e2b858' : '#6aad7a', fontSize: isHumanDraw ? 11 : 9, fontWeight: isHumanDraw ? 700 : 400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isHumanDraw ? 'TAP TO TAKE' : 'Discard'}
              </p>
              {(isHumanBuyerTurn ? buyingDiscard : topDiscard) ? (
                <div style={{ borderRadius: 8, animation: isHumanDraw ? 'gbPulseGold 1.2s ease-in-out infinite' : 'none' }}>
                  <CardComponent
                    card={(isHumanBuyerTurn && buyingDiscard ? buyingDiscard : topDiscard)!}
                    onClick={isHumanDraw ? handleTakeDiscard : undefined}
                    style={isHumanDraw ? { border: '2px solid #e2b858' } : undefined}
                  />
                </div>
              ) : (
                <div
                  className="rounded-lg border-2 border-dashed border-[#2d5a3a]"
                  style={{ width: 41, height: 61 }}
                />
              )}
              {isHumanBuyerTurn && (
                <p style={{ color: '#e2b858', fontSize: 9, fontWeight: 600 }}>For sale</p>
              )}
              {pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI && (
                <p style={{ color: '#e2b858', fontSize: 9, fontWeight: 600 }}>Buyable</p>
              )}
            </div>
          </div>
        )}

        {/* Table melds */}
        <TableMelds
          melds={rs.tablesMelds}
          currentPlayerId={currentPlayer.id}
        />

      </div>

      {/* ── ZONE 3: Sticky bottom — hand + action buttons ───────────────── */}
      <div
        className="bg-[#0f2218] border-t border-[#2d5a3a] px-3 pt-3"
        style={{ position: 'sticky', bottom: 0, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Free-take banner — shown when next player can take discard for free (Rule 9A) */}
        {pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI && !freeOfferDeclined && (
          <BuyPrompt
            card={pendingBuyDiscard}
            isFree={true}
            playerName={currentPlayer.name}
            buysRemaining={currentPlayer.buysRemaining}
            buyLimit={gameState.buyLimit}
            onAccept={handleTakeDiscard}
            onDecline={handleDeclineFreeOffer}
          />
        )}

        {/* Paid buy banner — shown when it's a human player's turn in the buying window */}
        {isHumanBuyerTurn && buyingDiscard && activeBuyer && (
          <BuyPrompt
            card={buyingDiscard}
            isFree={false}
            playerName={activeBuyer.name}
            buysRemaining={activeBuyer.buysRemaining}
            buyLimit={gameState.buyLimit}
            onAccept={() => handleBuyDecision(true)}
            onDecline={() => handleBuyDecision(false)}
          />
        )}

        {/* Player hand — sort toggle + fan layout (spec §2.5) */}
        {!displayPlayer.isAI ? (
          <HandDisplay
            cards={displayPlayer.hand}
            selectedIds={selectedCardIds}
            onToggle={toggleCard}
            label={`${isHumanBuyerTurn ? displayPlayer.name + "'s " : 'Your '}hand (${displayPlayer.hand.length} cards)`}
            disabled={false}
            sortMode={handSort}
            onSortChange={setHandSort}
            newCardId={[...newCardIds][0]}
          />
        ) : aiTurnHumanViewer ? (
          <HandDisplay
            cards={aiTurnHumanViewer.hand}
            selectedIds={new Set()}
            onToggle={() => {}}
            label={`${aiTurnHumanViewer.name}'s hand (${aiTurnHumanViewer.hand.length} cards) — planning`}
            disabled={false}
            sortMode={handSort}
            onSortChange={setHandSort}
          />
        ) : null}

        {/* Status slot — stable height, content fades */}
        <div style={{ minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {uiPhase === 'draw' && !currentPlayer.isAI ? (
            <p className="text-center text-xs text-[#6aad7a] py-1">
              Tap the draw pile or discard card above
            </p>
          ) : (uiPhase === 'draw' || uiPhase === 'action') && currentPlayer.isAI && !aiMessage ? (
            <p className="text-center text-xs text-[#6aad7a] py-1 animate-pulse">
              {currentPlayer.name} is playing...
            </p>
          ) : uiPhase === 'buying' && !isHumanBuyerTurn && activeBuyer?.isAI && !aiMessage ? (
            <p className="text-center text-xs text-[#6aad7a] py-1 animate-pulse">
              {activeBuyer.name} deciding on buy...
            </p>
          ) : (
            <span>{'\u00A0'}</span>
          )}
        </div>

        {/* Undo toast */}
        {pendingUndo && (
          <div className="flex items-center justify-between bg-[#2c1810] text-white rounded-xl px-4 py-3 mt-2">
            <span className="text-sm">Discarded {pendingUndo.card.rank === 0 ? 'Joker' : rankLabel(pendingUndo.card)}</span>
            <button onClick={handleUndoDiscard} className="text-[#e2b858] text-sm font-bold active:opacity-70">
              Undo
            </button>
          </div>
        )}

        {/* Action buttons — Lay Down | Lay Off | Discard (spec §2.6) */}
        {uiPhase === 'action' && !currentPlayer.isAI && !pendingUndo && (
          <div className="space-y-2 mt-2">
            <div className="flex gap-2">

              {/* Lay Down button */}
              <button
                onClick={!currentPlayer.hasLaidDown ? () => setShowMeldModal(true) : undefined}
                disabled={currentPlayer.hasLaidDown}
                style={{
                  flex: 1, minHeight: 38, borderRadius: 10, border: 'none',
                  background: currentPlayer.hasLaidDown ? '#1e4a2e' : '#e2b858',
                  color: currentPlayer.hasLaidDown ? '#3a5a3a' : '#2c1810',
                  fontSize: 13, fontWeight: 700,
                  cursor: currentPlayer.hasLaidDown ? 'not-allowed' : 'pointer',
                }}
              >
                Lay Down
              </button>

              {/* Lay Off / Swap Joker button */}
              {currentPlayer.hasLaidDown ? (
                <button
                  onClick={() => { setNewCardIds(new Set()); setShowLayOffModal(true) }}
                  style={{
                    flex: 1, minHeight: 38, borderRadius: 10,
                    border: '1px solid #2d5a3a',
                    background: selectedCardIds.size > 0 ? '#3d7a4c' : '#1e4a2e',
                    color: '#a8d0a8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Lay Off
                </button>
              ) : hasSwappableJokersBeforeLayDown ? (
                <button
                  onClick={() => { setNewCardIds(new Set()); setShowPreLayDownSwapModal(true) }}
                  style={{
                    flex: 1, minHeight: 38, borderRadius: 10,
                    border: '1px solid #2d5a3a',
                    background: '#1e4a2e', color: '#a8d0a8',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Swap Joker
                </button>
              ) : (
                <button
                  disabled
                  title="Lay down your hand first"
                  style={{
                    flex: 1, minHeight: 38, borderRadius: 10,
                    border: '1px solid #2d5a3a',
                    background: '#1e4a2e', color: '#3a5a3a',
                    fontSize: 13, fontWeight: 600, cursor: 'not-allowed', opacity: 0.5,
                  }}
                >
                  Lay Off
                </button>
              )}
            </div>

            {/* Discard error */}
            {discardError && (
              <p
                className="text-center text-xs rounded-lg px-3 py-2 border"
                style={{ color: '#e87070', background: 'rgba(44,24,16,0.6)', borderColor: 'rgba(232,112,112,0.3)' }}
              >
                {discardError}
              </p>
            )}

            {/* End Turn button — shown when stuck with 1 unplayable card after laying down */}
            {lastCardStuck ? (
              <button
                onClick={handleEndTurnStuck}
                style={{
                  width: '100%', minHeight: 38, borderRadius: 10, border: 'none',
                  background: '#e2b858', color: '#2c1810',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                End Turn (draw next turn)
              </button>
            ) : (
              <button
                onClick={selectedCardIds.size === 1 ? () => { setNewCardIds(new Set()); handleDiscard() } : undefined}
                disabled={selectedCardIds.size !== 1}
                style={{
                  width: '100%', minHeight: 38, borderRadius: 10, border: 'none',
                  background: selectedCardIds.size !== 1 ? '#1e4a2e' : 'white',
                  color: selectedCardIds.size !== 1 ? '#3a5a3a' : '#2c1810',
                  fontSize: 13, fontWeight: 600,
                  cursor: selectedCardIds.size !== 1 ? 'not-allowed' : 'pointer',
                }}
              >
                {selectedCardIds.size === 1 ? 'Discard Selected Card' : 'Select a card to discard'}
              </button>
            )}
          </div>
        )}

      </div>

      {/* Modals — logic unchanged */}
      {showMeldModal && (
        <MeldModal
          hand={sortedCurrentHand}
          requirement={rs.requirement}
          onConfirm={handleMeldConfirm}
          onClose={() => { if (!preLayDownSwap) setShowMeldModal(false) }}
          mustLayDown={preLayDownSwap}
          sortMode={handSort}
          onSortChange={setHandSort}
        />
      )}

      {/* ── Pre-lay-down Swap Joker modal (inline) ──────────────────────── */}
      {showPreLayDownSwapModal && (() => {
        const naturalHand = currentPlayer.hand.filter(c => c.suit !== 'joker')
        const swapRuns = rs.tablesMelds.filter(m => m.type === 'run' && m.jokerMappings.length > 0)
        const psCard = naturalHand.find(c => c.id === preSwapCardId) ?? null
        const psMeld = swapRuns.find(m => m.id === preSwapMeldId) ?? null
        const psValid = psCard !== null && psMeld !== null && findSwappableJoker(psCard, psMeld) !== null

        function closeSwapModal() {
          if (preLayDownSwapBaseStateRef.current) {
            setGameState(preLayDownSwapBaseStateRef.current)
            preLayDownSwapBaseStateRef.current = null
          }
          setPreSwapCardId(null)
          setPreSwapMeldId(null)
          setShowPreLayDownSwapModal(false)
        }

        function confirmSwap() {
          if (!psCard || !psMeld) return
          if (!preLayDownSwapBaseStateRef.current) {
            preLayDownSwapBaseStateRef.current = gameState
          }
          const afterSwap = computeJokerSwap(gameState, psCard, psMeld)
          if (!afterSwap) return
          const playerIdx = afterSwap.roundState.currentPlayerIndex
          const newHand = afterSwap.players[playerIdx].hand
          const canLayDown = aiFindBestMelds(newHand, rs.requirement) !== null
          if (canLayDown) {
            setGameState(afterSwap)
            setSelectedCardIds(new Set())
            preLayDownSwapBaseStateRef.current = null
            setPreSwapCardId(null)
            setPreSwapMeldId(null)
            setShowPreLayDownSwapModal(false)
            setPreLayDownSwap(true)
            setShowMeldModal(true)
          } else {
            const newTablesMelds = afterSwap.roundState.tablesMelds
            const moreSwapsPossible = newTablesMelds.some(m =>
              m.type === 'run' && m.jokerMappings.length > 0 &&
              newHand.some(c => c.suit !== 'joker' && findSwappableJoker(c, m) !== null)
            )
            if (moreSwapsPossible) {
              setGameState(afterSwap)
              setSelectedCardIds(new Set())
              setPreSwapCardId(null)
              setPreSwapMeldId(null)
            } else {
              const baseState = preLayDownSwapBaseStateRef.current
              setGameState(baseState ?? gameState)
              preLayDownSwapBaseStateRef.current = null
              setSelectedCardIds(new Set())
              setPreSwapCardId(null)
              setPreSwapMeldId(null)
              setShowPreLayDownSwapModal(false)
              setLayOffError('You can only swap jokers if you can lay down afterwards.')
              setTimeout(() => setLayOffError(null), 4000)
            }
          }
        }

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, backgroundColor: '#1e4a2e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ flexShrink: 0, backgroundColor: '#0f2218', padding: '12px 14px', paddingTop: 'max(12px, env(safe-area-inset-top))', borderBottom: '1px solid #2d5a3a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ color: '#a8d0a8', fontSize: 13, fontWeight: 500, margin: 0 }}>Swap a Joker</p>
                <p style={{ color: '#e2b858', fontSize: 11, margin: '2px 0 0' }}>You must lay down after this swap</p>
              </div>
              <button onClick={closeSwapModal} style={{ background: 'transparent', border: '1px solid #2d5a3a', borderRadius: 8, color: '#6aad7a', padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', minHeight: 44, minWidth: 44 }}>
                Cancel
              </button>
            </div>

            {/* Error */}
            {layOffError && (
              <div style={{ padding: '8px 14px', backgroundColor: 'rgba(44,24,16,0.5)', borderBottom: '1px solid #3a1a0a' }}>
                <p style={{ color: '#e87070', fontSize: 11, margin: 0 }}>{layOffError}</p>
              </div>
            )}

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Step 1: pick natural card */}
              <div>
                <p style={{ color: '#a8d0a8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 8px' }}>
                  Step 1 — Pick a card from your hand
                </p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {naturalHand.length === 0
                    ? <p style={{ color: '#3a5a3a', fontSize: 11, fontStyle: 'italic' }}>No natural cards in hand</p>
                    : naturalHand.map(card => {
                      const sel = preSwapCardId === card.id
                      return (
                        <div
                          key={card.id}
                          onClick={() => { setPreSwapCardId(card.id); setPreSwapMeldId(null) }}
                          style={{ width: 36, height: 50, minWidth: 44, minHeight: 44, backgroundColor: sel ? '#fff8dc' : ['hearts','diamonds'].includes(card.suit) ? (card.suit === 'hearts' ? '#fff0f0' : '#f0f5ff') : card.suit === 'clubs' ? '#e0f7e8' : '#eeecff', border: sel ? '2px solid #e2b858' : '1.5px solid rgba(0,0,0,0.14)', borderRadius: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transform: sel ? 'translateY(-6px)' : undefined, transition: 'transform 100ms', userSelect: 'none', color: card.suit === 'hearts' ? '#c0393b' : card.suit === 'diamonds' ? '#2158b8' : card.suit === 'clubs' ? '#1a6b3a' : '#3d2b8e' }}>
                          <span style={{ fontSize: 11, fontWeight: 800 }}>{card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : String(card.rank)}</span>
                          <span style={{ fontSize: 14 }}>{card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}</span>
                        </div>
                      )
                    })
                  }
                </div>
              </div>

              {/* Step 2: pick run meld (only shown once a card is selected) */}
              {psCard && (
                <div>
                  <p style={{ color: '#a8d0a8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 8px' }}>
                    Step 2 — Pick a run with a joker
                  </p>
                  {swapRuns.length === 0
                    ? <p style={{ color: '#3a5a3a', fontSize: 11, fontStyle: 'italic' }}>No runs with jokers on the table</p>
                    : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {swapRuns.map(meld => {
                          const isTarget = findSwappableJoker(psCard, meld) !== null
                          const sel = preSwapMeldId === meld.id
                          return (
                            <div
                              key={meld.id}
                              onClick={() => isTarget && setPreSwapMeldId(meld.id)}
                              style={{ backgroundColor: '#0f2218', border: sel ? '1.5px solid #e2b858' : isTarget ? '1.5px solid #6aad7a' : '1.5px solid #2d5a3a', borderRadius: 8, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4, opacity: isTarget ? 1 : 0.35, cursor: isTarget ? 'pointer' : 'default', flexShrink: 0, animation: isTarget && !sel ? 'lomPulse 1.4s ease-in-out infinite' : 'none' }}>
                              <p style={{ fontSize: 8, color: isTarget ? '#6aad7a' : '#3a5a3a', margin: 0 }}>run · {meld.ownerName.split(' ')[0]}</p>
                              <div style={{ display: 'flex', gap: 2 }}>
                                {meld.cards.map(card => {
                                  const isJkr = card.suit === 'joker'
                                  const mapping = isJkr ? meld.jokerMappings.find(j => j.cardId === card.id) : null
                                  const lbl = isJkr ? (mapping ? `${mapping.representsRank === 1 || mapping.representsRank === 14 ? 'A' : mapping.representsRank === 11 ? 'J' : mapping.representsRank === 12 ? 'Q' : mapping.representsRank === 13 ? 'K' : String(mapping.representsRank)}${mapping.representsSuit === 'hearts' ? '♥' : mapping.representsSuit === 'diamonds' ? '♦' : mapping.representsSuit === 'clubs' ? '♣' : '♠'}` : 'JKR') : `${card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : card.rank}${card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}`
                                  return (
                                    <div key={card.id} style={{ width: 22, height: 30, backgroundColor: isJkr ? '#fff8e0' : card.suit === 'hearts' ? '#fff0f0' : card.suit === 'diamonds' ? '#f0f5ff' : card.suit === 'clubs' ? '#e0f7e8' : '#eeecff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, color: isJkr ? '#8b6914' : card.suit === 'hearts' ? '#c0393b' : card.suit === 'diamonds' ? '#2158b8' : card.suit === 'clubs' ? '#1a6b3a' : '#3d2b8e', flexShrink: 0 }}>
                                      {lbl}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  }
                </div>
              )}
            </div>

            {/* Confirm button */}
            <div style={{ flexShrink: 0, backgroundColor: '#0f2218', borderTop: '1px solid #2d5a3a', padding: '12px 14px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
              <button
                onClick={confirmSwap}
                disabled={!psValid}
                style={{ width: '100%', minHeight: 48, borderRadius: 12, border: 'none', background: psValid ? '#e2b858' : '#1e4a2e', color: psValid ? '#2c1810' : '#3a5a3a', fontSize: 14, fontWeight: 700, cursor: psValid ? 'pointer' : 'not-allowed' }}
              >
                Swap & Lay Down
              </button>
            </div>

            {/* Reuse pulse keyframe from LayOffModal */}
            <style>{`@keyframes lomPulse{0%,100%{box-shadow:0 0 6px rgba(106,173,122,0.4)}50%{box-shadow:0 0 18px rgba(106,173,122,0.9)}}`}</style>
          </div>
        )
      })()}

      {showLayOffModal && (
        <LayOffModal
          melds={rs.tablesMelds}
          currentPlayerId={currentPlayer.id}
          currentPlayerName={currentPlayer.name}
          hand={currentPlayer.hand}
          players={gameState.players}
          onLayOff={handleLayOff}
          onGoOut={() => setShowLayOffModal(false)}
          onDone={() => setShowLayOffModal(false)}
          onJokerSwap={handleJokerSwap}
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

// Helper for buy log card display
function formatCard(card: CardType): string {
  if (card.rank === 0) return 'Jkr'
  const r = card.rank
  const rank = r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r)
  const suit = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'
  return `${rank}${suit}`
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
