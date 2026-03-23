import { useState, useEffect, useRef, useMemo } from 'react'
import { createPlayedGame, saveGameEvents, saveAIDecisions, backfillDecisionOutcomes, savePlayerRoundStats, savePlayerGameStats } from '../../lib/gameStore'
import type { AIDecision, PlayerRoundStats, PlayerGameStats } from '../../game/types'
import { Pause } from 'lucide-react'
import type { GameState, Player, Card as CardType, Meld, PlayerConfig, AIDifficulty, AIPersonality, PersonalityConfig, OpponentHistory } from '../../game/types'
import { PERSONALITIES, personalityToLegacyDifficulty } from '../../game/types'
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
// LayOffModal removed — lay-offs now happen inline via TableMelds
import RoundSummary from './RoundSummary'
import GameOver from './GameOver'
import HandDisplay from './HandDisplay'
import TableMelds from './TableMelds'
import CardComponent from './Card'
import BuyPrompt from './BuyPrompt'
import GameToast, { type QueuedToast } from './GameToast'
import RoundAnnouncement, { type AnnouncementStage } from './RoundAnnouncement'

interface Props {
  initialPlayers: PlayerConfig[]
  aiDifficulty?: AIDifficulty
  aiPersonality?: AIPersonality
  buyLimit?: number
  onExit: () => void
  onGameComplete?: (players: Player[]) => void
  tournamentGameNumber?: number
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

// (nextPhaseForPlayer is defined inside GameBoard to account for solo-human games)

function getAIDelay(speed: GameSpeed): number {
  if (speed === 'fast') return 200 + Math.random() * 200
  if (speed === 'slow') return 2000 + Math.random() * 1000
  return 700 + Math.random() * 500
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GameBoard({ initialPlayers, aiDifficulty: aiDifficultyProp = 'medium', aiPersonality, buyLimit = 5, onExit, onGameComplete, tournamentGameNumber }: Props) {
  // Resolve personality config — if personality is set, use it; otherwise fall back to legacy difficulty
  const personalityConfig: PersonalityConfig | null = aiPersonality
    ? (PERSONALITIES.find(p => p.id === aiPersonality) ?? PERSONALITIES[0])
    : null
  const aiDifficulty: AIDifficulty = personalityConfig
    ? personalityToLegacyDifficulty(personalityConfig.id)
    : aiDifficultyProp

  // Helper to get the active personality config (falls back to a config derived from legacy difficulty)
  function getPersonalityConfig(): PersonalityConfig {
    if (personalityConfig) return personalityConfig
    // Map legacy difficulty to the closest personality
    if (aiDifficultyProp === 'easy') return PERSONALITIES.find(p => p.id === 'rookie-riley')!
    if (aiDifficultyProp === 'hard') return PERSONALITIES.find(p => p.id === 'the-shark')!
    return PERSONALITIES.find(p => p.id === 'steady-sam')!
  }

  const [gameState, setGameState] = useState<GameState>(() => initGame(initialPlayers, buyLimit))
  const [uiPhase, setUiPhase] = useState<UIPhase>('round-start')
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const selectedCardOrderRef = useRef<string[]>([])
  const [handSort, setHandSort] = useState<'rank' | 'suit'>('rank')
  const [showMeldModal, setShowMeldModal] = useState(false)
  const [jokerPositionPrompt, setJokerPositionPrompt] = useState<{ card: CardType; meld: Meld } | null>(null)
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
  const [leavingCardId, setLeavingCardId] = useState<string | null>(null)
  const [dealFlipPhase, setDealFlipPhase] = useState<'facedown' | 'flipping' | null>(null)
  const [aiActionTick, setAiActionTick] = useState(0)
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>('normal')
  const [buyLog, setBuyLog] = useState<BuyLogEntry[]>([])
  const [gameId, setGameId] = useState<string | null>(null)
  // True after player taps "Pass" on the free discard offer — hides banner until next offer
  const [freeOfferDeclined, setFreeOfferDeclined] = useState(false)
  const [stripExpanded, setStripExpanded] = useState(false)
  const turnCountRef = useRef(0)
  const pendingSaveRef = useRef<number>(0)
  const [discardError, setDiscardError] = useState<string | null>(null)
  const [layOffError, setLayOffError] = useState<string | null>(null)
  const [lastDiscardedLabel, setLastDiscardedLabel] = useState<string | null>(null)
  // ── Game-feel toast queue ─────────────────────────────────────────────────
  const toastQueueRef = useRef<QueuedToast[]>([])
  const toastIdRef = useRef(0)
  const [activeToast, setActiveToast] = useState<QueuedToast | null>(null)
  const activeToastRef = useRef<QueuedToast | null>(null)
  const [shimmerCardId, setShimmerCardId] = useState<string | null>(null)
  const streaksRef = useRef<Map<string, number>>(new Map())
  const [preLayDownSwap, setPreLayDownSwap] = useState(false)
  // Selection state for the pre-lay-down swap flow
  const [preSwapMeldId, setPreSwapMeldId] = useState<string | null>(null)
  // Inline swap mode: replaces the old full-screen pre-lay-down swap modal
  const [swapMode, setSwapMode] = useState(false)
  const [swapSelectedMeldId, setSwapSelectedMeldId] = useState<string | null>(null)
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
  // Last action indicator — briefly shows what the previous player did
  const [lastAction, setLastAction] = useState<string | null>(null)
  const lastActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Telemetry tracking refs ─────────────────────────────────────────────────
  const pendingDecisionsRef = useRef<AIDecision[]>([])
  const playerTurnCountsRef = useRef<Map<string, number>>(new Map())
  const turnWentDownRef = useRef<Map<string, number>>(new Map())
  const turnsHeldRef = useRef<Map<string, number>>(new Map())
  // Per-player counters for round stats (reset each round)
  const telemetryCountersRef = useRef<Map<string, {
    freeTakes: number; freeDeclines: number; pileDraws: number
    buysMade: number; buysPassed: number; buyOpportunities: number
    discards: number; denialTakes: number; denialBuys: number
    meldsLaidDown: number; bonusMelds: number; layOffs: number; jokerSwaps: number
    handSizeWentDown: number | null; scenarioB: number; scenarioC: number
  }>>(new Map())

  // ── Flying card animation state ──────────────────────────────────────────
  const [flyingCard, setFlyingCard] = useState<{
    from: { x: number, y: number }
    to: { x: number, y: number }
    card?: CardType
    faceDown: boolean
  } | null>(null)
  const [reduceAnimations, setReduceAnimations] = useState(false)
  const drawPileRef = useRef<HTMLDivElement>(null)
  const handAreaRef = useRef<HTMLDivElement>(null)
  const discardPileRef = useRef<HTMLDivElement>(null)
  const [justLaidOffCardIds, setJustLaidOffCardIds] = useState<Set<string>>(new Set())
  // Fix C: discard unwanted dim (all buyers passed)
  const [discardUnwanted, setDiscardUnwanted] = useState(false)
  // Fix D: joker swap meld flash
  const [flashMeldId, setFlashMeldId] = useState<string | null>(null)
  const [flashIsHeist, setFlashIsHeist] = useState(false)
  const [raceMessage, setRaceMessage] = useState('')

  // ── Round-end transition states ───────────────────────────────────────────
  const [showDarkBeat, setShowDarkBeat] = useState(false)
  const [roundSummaryExiting, setRoundSummaryExiting] = useState(false)

  // ── Cinematic round announcement ──────────────────────────────────────────
  const [announcementStage, setAnnouncementStage] = useState<AnnouncementStage | null>(null)
  const [showDealAnimation, setShowDealAnimation] = useState(false)
  const previousLeaderRef = useRef<string | null>(null)
  const countdownActiveRef = useRef(false)

  // Finish announcement: save leader, start deal animation, transition to game
  function finishAnnouncement(gs: GameState) {
    const totals = gs.players.map(p => ({
      name: p.name,
      score: p.roundScores.reduce((a, b) => a + b, 0),
    }))
    const leader = totals.reduce((a, b) => a.score < b.score ? a : b)
    previousLeaderRef.current = leader.name

    setAnnouncementStage(null)
    if (reduceAnimations) {
      setShowDealAnimation(true)
      setTimeout(() => setShowDealAnimation(false), 1000)
    } else {
      setDealFlipPhase('facedown')
      setShowDealAnimation(true)
      setTimeout(() => setDealFlipPhase('flipping'), 700)
      setTimeout(() => { setShowDealAnimation(false); setDealFlipPhase(null) }, 1500)
    }
    const cp = getCurrentPlayer(gs)
    setUiPhase(cp.isAI ? 'draw' : (soloHuman ? 'draw' : 'privacy'))
  }

  // Drive announcement stage sequence with a single interval (immune to re-renders)
  useEffect(() => {
    if (uiPhase !== 'round-start') {
      setAnnouncementStage(null)
      countdownActiveRef.current = false
      return
    }

    const gs = gameState
    const isFirstRound = gs.currentRound === 1
    const isFinalRound = gs.currentRound === TOTAL_ROUNDS

    // Build timeline: [time_ms, stage, haptic?]
    const timeline: [number, AnnouncementStage | 'done', boolean][] = []
    let t = 0

    if (!isFirstRound) {
      timeline.push([t, 'standings', false])
      t += 2500
      if (isFinalRound) {
        timeline.push([t, 'final-round', false])
        t += 2000
      }
    }
    timeline.push([t, 'blackout', false])
    t += 2500
    timeline.push([t, 'requirement', false])
    t += 1500
    timeline.push([t, 'dealer', false])
    t += 1200
    timeline.push([t, 'countdown-3', true])
    t += 800
    timeline.push([t, 'countdown-2', true])
    t += 1000
    timeline.push([t, 'countdown-1', true])
    t += isFinalRound ? 1500 : 1200 // hold "1" longer; extra long on final round
    timeline.push([t, 'dealing', false])
    t += 800
    timeline.push([t, 'done', false])

    // Set initial stage
    setAnnouncementStage(timeline[0][1] as AnnouncementStage)
    countdownActiveRef.current = true
    let lastIdx = 0
    const startTime = Date.now()

    const intervalId = setInterval(() => {
      if (!countdownActiveRef.current) {
        clearInterval(intervalId)
        return
      }
      const elapsed = Date.now() - startTime
      // Advance to the correct stage based on elapsed time
      while (lastIdx < timeline.length - 1 && elapsed >= timeline[lastIdx + 1][0]) {
        lastIdx++
        const [, stage, doHaptic] = timeline[lastIdx]
        if (doHaptic) haptic('tap')
        if (stage === 'done') {
          clearInterval(intervalId)
          countdownActiveRef.current = false
          finishAnnouncement(gs)
          return
        }
        setAnnouncementStage(stage)
      }
    }, 50) // check every 50ms for smooth transitions

    return () => {
      clearInterval(intervalId)
      countdownActiveRef.current = false
    }
  }, [uiPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  function skipAnnouncement() {
    countdownActiveRef.current = false
    finishAnnouncement(gameState)
  }

  function getTelemetryCounters(playerId: string) {
    if (!telemetryCountersRef.current.has(playerId)) {
      telemetryCountersRef.current.set(playerId, {
        freeTakes: 0, freeDeclines: 0, pileDraws: 0,
        buysMade: 0, buysPassed: 0, buyOpportunities: 0,
        discards: 0, denialTakes: 0, denialBuys: 0,
        meldsLaidDown: 0, bonusMelds: 0, layOffs: 0, jokerSwaps: 0,
        handSizeWentDown: null, scenarioB: 0, scenarioC: 0,
      })
    }
    return telemetryCountersRef.current.get(playerId)!
  }

  function recordDecision(
    player: Player,
    decisionType: string,
    decisionResult: string,
    card?: CardType | null,
    reason?: string,
  ) {
    if (!gameId) return
    const state = gameStateRef.current
    const handPoints = player.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)
    const turnNum = playerTurnCountsRef.current.get(player.id) ?? 0

    pendingDecisionsRef.current.push({
      game_id: gameId,
      round_number: state.currentRound,
      turn_number: turnNum,
      player_name: player.name,
      difficulty: player.isAI ? (aiPersonality ?? aiDifficulty) : null,
      is_human: !player.isAI,
      decision_type: decisionType,
      decision_result: decisionResult,
      hand_size: player.hand.length,
      hand_points: handPoints,
      has_laid_down: player.hasLaidDown,
      buys_remaining: player.buysRemaining,
      card_suit: card?.suit,
      card_rank: card?.rank,
      reason,
    })
  }

  function flushDecisions() {
    if (pendingDecisionsRef.current.length === 0) return
    const batch = [...pendingDecisionsRef.current]
    pendingDecisionsRef.current = []
    void saveAIDecisions(batch)
  }

  function resetRoundTelemetry() {
    playerTurnCountsRef.current = new Map()
    turnWentDownRef.current = new Map()
    turnsHeldRef.current = new Map()
    telemetryCountersRef.current = new Map()
    pendingDecisionsRef.current = []
  }

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
  useEffect(() => { if (uiPhase !== 'action') setJokerPositionPrompt(null) }, [uiPhase])
  useEffect(() => {
    if (uiPhase !== 'action') {
      setSwapMode(false)
      setSwapSelectedMeldId(null)
    }
  }, [uiPhase])
  useEffect(() => { buyerOrderRef.current = buyerOrder }, [buyerOrder])
  useEffect(() => { buyerStepRef.current = buyerStep }, [buyerStep])
  useEffect(() => { pendingBuyDiscardRef.current = pendingBuyDiscard }, [pendingBuyDiscard])
  useEffect(() => { freeOfferDeclinedRef.current = freeOfferDeclined }, [freeOfferDeclined])

  // ── Flying card animation helpers ─────────────────────────────────────────
  function getRefCenter(ref: React.RefObject<HTMLDivElement | null>): { x: number, y: number } | null {
    if (!ref.current) return null
    const rect = ref.current.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  function animateDrawFromPile(isAI: boolean) {
    if (reduceAnimations) return
    const from = getRefCenter(drawPileRef)
    const to = getRefCenter(handAreaRef)
    if (!from || !to) return
    const duration = isAI ? 200 : 500
    setFlyingCard({ from, to, faceDown: true })
    setTimeout(() => setFlyingCard(null), duration)
  }

  function animateTakeDiscard(card: CardType, isAI: boolean) {
    if (reduceAnimations) return
    const from = getRefCenter(discardPileRef)
    const to = getRefCenter(handAreaRef)
    if (!from || !to) return
    const duration = isAI ? 200 : 500
    setFlyingCard({ from, to, card, faceDown: false })
    setTimeout(() => setFlyingCard(null), duration)
  }

  function animateDiscard(card: CardType) {
    if (reduceAnimations) return
    // Mark card as leaving so it shrinks out of the hand
    setLeavingCardId(card.id)
    // Try to find the card element by data-card-id for precise origin
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`)
    const from = cardEl
      ? { x: cardEl.getBoundingClientRect().left + cardEl.getBoundingClientRect().width / 2,
          y: cardEl.getBoundingClientRect().top + cardEl.getBoundingClientRect().height / 2 }
      : getRefCenter(handAreaRef)
    const to = getRefCenter(discardPileRef)
    if (!from || !to) return
    setFlyingCard({ from, to, card, faceDown: false })
    setTimeout(() => { setFlyingCard(null); setLeavingCardId(null) }, 300)
  }

  function animateBuy(discardCard: CardType, isAI: boolean) {
    if (reduceAnimations) return
    const discardPos = getRefCenter(discardPileRef)
    const handPos = getRefCenter(handAreaRef)
    const drawPos = getRefCenter(drawPileRef)
    if (!discardPos || !handPos) return
    const duration = isAI ? 200 : 500
    // First: discard card flies to hand
    setFlyingCard({ from: discardPos, to: handPos, card: discardCard, faceDown: false })
    setTimeout(() => {
      setFlyingCard(null)
      // Second: penalty card flies from draw pile to hand
      if (drawPos) {
        setFlyingCard({ from: drawPos, to: handPos, faceDown: true })
        setTimeout(() => setFlyingCard(null), duration)
      }
    }, duration)
  }

  // Solo human = only 1 human player (rest are AI). Skip privacy screen, show turn banner instead.
  const soloHuman = useMemo(() => initialPlayers.filter(p => !p.isAI).length <= 1, [initialPlayers])

  // Stable set of human player IDs for TableMelds ordering
  const humanPlayerIds = useMemo(() => new Set(gameState.players.filter(p => !p.isAI).map(p => p.id)), [gameState.players])
  const [turnBanner, setTurnBanner] = useState<string | null>(null)

  // Show "Your turn!" banner when solo human's draw phase starts
  useEffect(() => {
    const player = gameState.players[gameState.roundState.currentPlayerIndex]
    if (soloHuman && uiPhase === 'draw' && player && !player.isAI) {
      setTurnBanner(`Your turn, ${player.name}!`)
      const timer = setTimeout(() => setTurnBanner(null), 1500)
      return () => clearTimeout(timer)
    }
  }, [uiPhase, gameState.roundState.currentPlayerIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Override: skip privacy screen for solo-human games
  // eslint-disable-next-line no-inner-declarations
  function nextPhaseForPlayer(player: Player): UIPhase {
    if (player.isAI) return 'draw'
    return soloHuman ? 'draw' : 'privacy'
  }

  function addBuyLog(entry: BuyLogEntry) {
    setBuyLog(prev => [...prev, entry])
  }

  function recordOpponentEvent(playerId: string, type: 'picked' | 'discarded', card: CardType) {
    const map = opponentHistoryRef.current
    if (!map.has(playerId)) map.set(playerId, { picked: [], discarded: [] })
    map.get(playerId)![type].push(card)
  }

  function showLastAction(msg: string) {
    if (lastActionTimerRef.current) clearTimeout(lastActionTimerRef.current)
    setLastAction(msg)
    lastActionTimerRef.current = setTimeout(() => setLastAction(null), 2500)
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

  // Zone 2 scroll container — used to auto-scroll to matching melds when a card is selected
  const zone2ScrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll Zone 2 to the first matching meld when the player selects a card
  useEffect(() => {
    const player = getCurrentPlayer(gameState)
    if (uiPhase !== 'action' || player.isAI || !player.hasLaidDown) return
    if (selectedCardIds.size !== 1) return
    const cardId = [...selectedCardIds][0]
    const card = player.hand.find(c => c.id === cardId)
    if (!card || !zone2ScrollRef.current) return
    const container = zone2ScrollRef.current
    const melds = gameState.roundState.tablesMelds
    const timer = setTimeout(() => {
      const matching = melds.filter(m => canLayOff(card, m))
      if (matching.length === 0) return
      const el = container.querySelector<HTMLElement>(`[data-meld-id="${matching[0].id}"]`)
      if (!el) return
      const elRect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        container.scrollTo({
          top: container.scrollTop + elRect.top - containerRect.top - 16,
          behavior: 'smooth',
        })
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [selectedCardIds, uiPhase, gameState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear new card indicator after 3 seconds
  useEffect(() => {
    if (newCardIds.size === 0) return
    const timer = setTimeout(() => setNewCardIds(new Set()), 3000)
    return () => clearTimeout(timer)
  }, [newCardIds])

  // ── Toast queue helpers ───────────────────────────────────────────────────
  function showNextToast() {
    const next = toastQueueRef.current.shift()
    if (!next) { setActiveToast(null); activeToastRef.current = null; return }
    setActiveToast(next)
    activeToastRef.current = next
    setTimeout(() => {
      setActiveToast(null)
      activeToastRef.current = null
      setTimeout(() => showNextToast(), 200)
    }, next.duration)
  }

  function queueToast(toast: Omit<QueuedToast, 'id'>) {
    const t: QueuedToast = { ...toast, id: toastIdRef.current++ }
    toastQueueRef.current.push(t)
    if (!activeToastRef.current) showNextToast()
  }

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

  function clearSelection() {
    setSelectedCardIds(new Set())
    selectedCardOrderRef.current = []
  }

  // ── Toggle card selection ─────────────────────────────────────────────────
  function toggleCard(cardId: string) {
    // If in swap mode with a meld already selected, tapping a hand card executes the swap
    if (swapMode && swapSelectedMeldId && preSwapMeldId) {
      const card = gameStateRef.current.players[gameStateRef.current.roundState.currentPlayerIndex].hand.find(c => c.id === cardId)
      if (card && card.suit !== 'joker') {
        const meld = gameStateRef.current.roundState.tablesMelds.find(m => m.id === preSwapMeldId)
        if (meld && findSwappableJoker(card, meld) !== null) {
          confirmPreSwapWithCard(card)
          return
        }
      }
      return // in swap mode but card isn't a valid target — ignore tap
    }

    setNewCardIds(new Set()) // clear new badge on any action
    setSelectedCardIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) {
        next.delete(cardId)
        selectedCardOrderRef.current = selectedCardOrderRef.current.filter(id => id !== cardId)
      } else {
        next.add(cardId)
        selectedCardOrderRef.current = [...selectedCardOrderRef.current, cardId]

        // Post-lay-down: warn if the selected card has jokers on table but none are swappable with it
        const player = getCurrentPlayer(gameStateRef.current)
        if (
          uiPhaseRef.current === 'action' &&
          player.hasLaidDown &&
          !player.isAI
        ) {
          const card = player.hand.find(c => c.id === cardId)
          if (card && card.suit !== 'joker') {
            const tablesMelds = gameStateRef.current.roundState.tablesMelds
            const jokerRunsExist = tablesMelds.some(
              meld => meld.type === 'run' && meld.jokerMappings.length > 0
            )
            if (jokerRunsExist) {
              const hasSwapTarget = tablesMelds.some(
                meld => meld.type === 'run' && findSwappableJoker(card, meld) !== null
              )
              if (!hasSwapTarget) {
                setTimeout(() => {
                  queueToast({
                    message: 'No swappable jokers',
                    subtext: 'None of the jokers on the table can be replaced by this card.',
                    style: 'neutral',
                    duration: 2500,
                  })
                }, 0)
              }
            }
          }
        }
      }
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
      const decliner = getCurrentPlayer(gameStateRef.current)
      addBuyLog({
        turn: turnCountRef.current,
        round: gameStateRef.current.currentRound,
        event: 'free_declined',
        playerName: decliner.name,
        card: formatCard(pendingCard),
      })
      recordDecision(decliner, 'free_take', 'declined', pendingCard)
      getTelemetryCounters(decliner.id).freeDeclines++
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

    if (drawnCard) {
      const isAI = !!gameState.players[gameState.roundState.currentPlayerIndex]?.isAI
      // Flying card animation: draw pile → hand
      animateDrawFromPile(isAI)
      // Delay NEW badge until after the flying animation lands
      const animDuration = reduceAnimations ? 0 : (isAI ? 200 : 500)
      setTimeout(() => {
        setNewCardIds(new Set([drawnCard.id]))
        // Shimmer the drawn card briefly for the human drawing player
        if (!isAI) {
          setShimmerCardId(drawnCard.id)
          setTimeout(() => setShimmerCardId(null), 1500)
        }
      }, animDuration)
    }

    // Telemetry: record pile draw
    {
      const drawer = gameState.players[gameState.roundState.currentPlayerIndex]
      recordDecision(drawer, 'draw', 'drew_pile')
      getTelemetryCounters(drawer.id).pileDraws++
    }

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

    // Flying card animation: discard pile → hand
    const taker = gameState.players[gameState.roundState.currentPlayerIndex]
    animateTakeDiscard(card, !!taker.isAI)
    // Delay NEW badge until after the flying animation lands
    const animDuration = reduceAnimations ? 0 : (taker.isAI ? 200 : 500)
    setTimeout(() => setNewCardIds(new Set([card.id])), animDuration)

    // Record for opponent awareness (Hard AI)
    recordOpponentEvent(taker.id, 'picked', card)

    // Telemetry: record free take or draw decision
    if (pendingBuyDiscardRef.current !== null) {
      recordDecision(taker, 'free_take', 'took', card, 'free take')
      getTelemetryCounters(taker.id).freeTakes++
    } else {
      recordDecision(taker, 'draw', 'took_discard', card)
      getTelemetryCounters(taker.id).freeTakes++
    }

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

  // ── Start buying window AFTER current player drew from pile (Rule 9A) ─────
  // Buyers are players AFTER currentPlayerIdx; current player will act after buying resolves
  function startBuyingWindowPostDraw(state: GameState, drewPlayerIdx: number, discardCard: CardType) {
    // Don't open buying if someone went out — round is over
    if (state.roundState.goOutPlayerId) {
      endRound(state)
      return
    }
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
    // Streaks: track consecutive rounds going out
    const goOutPlayer = state.players.find(p => p.id === goOutId)
    if (goOutPlayer) {
      const prev = streaksRef.current.get(goOutId) ?? 0
      const newStreak = prev + 1
      streaksRef.current.set(goOutId, newStreak)
      if (newStreak >= 2) {
        setTimeout(() => {
          queueToast({ message: `On fire! ${newStreak} in a row`, style: 'celebration', icon: '🔥', duration: 2000 })
        }, 500)
      }
      state.players.forEach(p => {
        if (p.id !== goOutId) streaksRef.current.set(p.id, 0)
      })
    }
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setShowDarkBeat(true)
    setTimeout(() => {
      setShowDarkBeat(false)
      setUiPhase('round-end')
    }, 500)
    flushTelemetry(buyLog) // fire-and-forget — telemetry must never block game flow

    // Telemetry: flush remaining decisions, backfill outcomes, save round stats
    flushDecisions()
    if (gameId) {
      void backfillDecisionOutcomes(gameId, state.currentRound, players)
      for (const p of players) {
        const result = results.find(r => r.playerId === p.id)
        void savePlayerRoundStats(computeRoundStats(gameId, state.currentRound, p, result ?? null))
      }
    }
    resetRoundTelemetry()
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
    setShowDarkBeat(true)
    setTimeout(() => {
      setShowDarkBeat(false)
      setUiPhase('round-end')
    }, 500)
    setAiMessage('Round ended — no one went out (stalemate)')
    setTimeout(() => setAiMessage(null), 4000)
    flushTelemetry(buyLog) // fire-and-forget — telemetry must never block game flow

    // Telemetry: flush + save round stats for stalemate
    flushDecisions()
    if (gameId) {
      void backfillDecisionOutcomes(gameId, state.currentRound, players)
      for (const p of players) {
        const result = results.find(r => r.playerId === p.id)
        void savePlayerRoundStats(computeRoundStats(gameId, state.currentRound, p, result ?? null))
      }
    }
    resetRoundTelemetry()
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

    // Telemetry: record going down
    recordDecision(player, 'go_down', 'went_down', null, `${newMelds.length} melds`)
    const tc = getTelemetryCounters(player.id)
    const reqCount = rs.requirement.sets + rs.requirement.runs
    tc.meldsLaidDown += newMelds.length
    tc.bonusMelds += Math.max(0, newMelds.length - reqCount)
    tc.handSizeWentDown = player.hand.length
    turnWentDownRef.current.set(player.id, playerTurnCountsRef.current.get(player.id) ?? 0)

    addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_down', playerName: player.name, card: '', detail: `melds: ${newMelds.length}` })
    if (wentOut) addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_out', playerName: player.name, card: '', detail: 'hand was empty' })

    // Moment 1: first player to the table this round
    const isFirstDown = prev.players.every(p => !p.hasLaidDown)
    if (isFirstDown && !wentOut) {
      const msgs = ['First to the table!', 'Setting the pace!', 'Bold move.', `${player.name} leads the way!`]
      queueToast({ message: msgs[Math.floor(Math.random() * msgs.length)], style: 'celebration', icon: '💪', duration: 2000 })
    }
    // Moment 2: going out via meld
    if (wentOut) {
      queueToast({ message: `${player.name} goes out!`, subtext: `Round ${prev.currentRound} complete`, style: 'drama', icon: '🎯', duration: 2500 })
    }

    setGameState(updated)
    setShowMeldModal(false)
    setPreLayDownSwap(false)
    clearSelection() // always reset selection after meld
    haptic(wentOut ? 'success' : 'heavy')

    if (wentOut) {
      // Round ends immediately — no buying window, no further actions
      setPendingBuyDiscard(null)
      pendingBuyDiscardRef.current = null
      setBuyerOrder([])
      setBuyingDiscard(null)
      setFreeOfferDeclined(false)
      freeOfferDeclinedRef.current = false
      if (pendingUndo) {
        clearTimeout(pendingUndo.timerId)
        setPendingUndo(null)
      }
      endRound(updated)
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
          if (newMin < 1) {
            setLayOffError('Cannot extend run below Ace.')
            haptic('error')
            setTimeout(() => setLayOffError(null), 3000)
            return
          }
          updatedRunMin = newMin
          newJokerMappings.push({ cardId: card.id, representsRank: newMin, representsSuit: meld.runSuit! })
          newMeldCards = [card, ...meld.cards]
        } else {
          // Default: extend at high end
          const newMax = (meld.runMax ?? 0) + 1
          if (newMax > 14) {
            setLayOffError('Cannot extend run above Ace.')
            haptic('error')
            setTimeout(() => setLayOffError(null), 3000)
            return
          }
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

    // Telemetry: record lay-off
    recordDecision(player, 'lay_off', 'laid_off', card)
    getTelemetryCounters(player.id).layOffs++

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
      getTelemetryCounters(player.id).scenarioC++
      setGameState(afterReversal)
      clearSelection()
      setLayOffError(null)
      haptic('heavy')
      // Clear any joker prompt and return player to action phase — do NOT advance turns
      setJokerPositionPrompt(null)
      setUiPhase('action')
      setDiscardError('Lay-off reversed — discard the unplayable card and keep the playable one for next turn.')
      setTimeout(() => setDiscardError(null), 4000)
      return
    }

    const updated: GameState = { ...prev, players, roundState: { ...prev.roundState, tablesMelds, goOutPlayerId } }
    setGameState(updated)
    clearSelection()
    setLayOffError(null)

    // Trigger card-join animation for the laid-off card
    setJustLaidOffCardIds(new Set([card.id]))
    setTimeout(() => setJustLaidOffCardIds(new Set()), 500)

    // Moment 2: going out via lay-off
    if (wentOut) {
      queueToast({ message: `${player.name} goes out!`, subtext: `Round ${prev.currentRound} complete`, style: 'drama', icon: '🎯', duration: 2500 })
    }

    if (wentOut) {
      addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_out', playerName: player.name, card: '', detail: 'hand was empty' })
      setJokerPositionPrompt(null)
      // Round ends immediately — no buying window, no further actions
      setPendingBuyDiscard(null)
      pendingBuyDiscardRef.current = null
      setBuyerOrder([])
      setBuyingDiscard(null)
      setFreeOfferDeclined(false)
      freeOfferDeclinedRef.current = false
      if (pendingUndo) {
        clearTimeout(pendingUndo.timerId)
        setPendingUndo(null)
      }
      endRound(updated)
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
    recordDecision(swapPlayer, 'joker_swap', 'swapped', naturalCard)
    getTelemetryCounters(swapPlayer.id).jokerSwaps++
    // Moment 5: Joker Heist
    const isFromOtherMeld = meld.ownerId !== swapPlayer.id
    queueToast({
      message: isFromOtherMeld ? 'The heist!' : 'Joker reclaimed!',
      subtext: isFromOtherMeld ? `${swapPlayer.name} takes a joker` : undefined,
      style: 'taunt', icon: '🃏', duration: 1500,
    })
    haptic('heavy')
    setGameState(prev => computeJokerSwap(prev, naturalCard, meld) ?? prev)
    clearSelection()
    // Fix D: flash the meld that just had its joker swapped
    setFlashMeldId(meld.id)
    setFlashIsHeist(isFromOtherMeld)
    setTimeout(() => { setFlashMeldId(null); setFlashIsHeist(false) }, 600)
  }

  // ── Pre-lay-down joker swap: inline flow ─────────────────────────────────
  function confirmPreSwapWithCard(naturalCard: CardType) {
    const psMeld = gameState.roundState.tablesMelds.find(m => m.id === preSwapMeldId) ?? null
    if (!psMeld || findSwappableJoker(naturalCard, psMeld) === null) return

    if (!preLayDownSwapBaseStateRef.current) {
      preLayDownSwapBaseStateRef.current = gameState
    }
    const afterSwap = computeJokerSwap(gameState, naturalCard, psMeld)
    if (!afterSwap) return
    const playerIdx = afterSwap.roundState.currentPlayerIndex
    const newHand = afterSwap.players[playerIdx].hand
    const canLayDown = aiFindBestMelds(newHand, gameState.roundState.requirement) !== null
    if (canLayDown) {
      setGameState(afterSwap)
      clearSelection()
      preLayDownSwapBaseStateRef.current = null
      setPreSwapMeldId(null)
      setSwapMode(false)
      setSwapSelectedMeldId(null)
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
        clearSelection()
        setPreSwapMeldId(null)
        setSwapSelectedMeldId(null)
      } else {
        const baseState = preLayDownSwapBaseStateRef.current
        setGameState(baseState ?? gameState)
        preLayDownSwapBaseStateRef.current = null
        clearSelection()
        setPreSwapMeldId(null)
        setSwapMode(false)
        setSwapSelectedMeldId(null)
        setLayOffError('Swap reversed — you still can\'t lay down with this joker. Try a different strategy!')
        setTimeout(() => setLayOffError(null), 5000)
      }
    }
  }

  // ── Swap-mode joker tap handler (from TableMelds in pre-lay-down mode) ────
  function handleSwapModeJokerTap(_jokerCard: CardType, meld: Meld) {
    if (!swapMode) return
    const hand = gameState.players[gameState.roundState.currentPlayerIndex].hand
    const matches = hand.filter(c =>
      c.suit !== 'joker' && findSwappableJoker(c, meld) !== null
    )
    if (matches.length === 0) return

    setPreSwapMeldId(meld.id)
    setSwapSelectedMeldId(meld.id)
    // Highlight matching hand cards
    setSelectedCardIds(new Set(matches.map(c => c.id)))
  }

  // ── Inline lay-off (from TableMelds tap) ─────────────────────────────────
  function handleInlineLayOff(card: CardType, meld: Meld) {
    if (card.suit === 'joker' && meld.type === 'run') {
      const canLow = (meld.runMin ?? 1) > 1
      const canHigh = (meld.runMax ?? 13) < 14
      if (canLow && canHigh) {
        setJokerPositionPrompt({ card, meld })
        return
      }
      const pos: 'low' | 'high' = canLow ? 'low' : 'high'
      handleLayOff(card, meld, pos)
      return
    }
    handleLayOff(card, meld)
  }

  function handleJokerPositionChoice(position: 'low' | 'high') {
    if (!jokerPositionPrompt) return
    haptic('tap')
    handleLayOff(jokerPositionPrompt.card, jokerPositionPrompt.meld, position)
    setJokerPositionPrompt(null)
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
        getTelemetryCounters(player.id).scenarioB++
        setGameState(afterRollback)
        clearSelection()
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

    // Flying card animation: hand → discard pile
    animateDiscard(card)

    // Show discarded card label below discard pile for 2s
    {
      const r = card.rank
      const discLabel = r === 0
        ? 'Joker'
        : (() => {
            const rank = r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r)
            const suit = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'
            return `${rank}${suit}`
          })()
      setLastDiscardedLabel(discLabel)
      setTimeout(() => setLastDiscardedLabel(null), 2000)
    }

    setGameState(afterDiscard)
    clearSelection()
    haptic('heavy')

    turnCountRef.current += 1

    // Telemetry: record discard, bump per-player turn count, flush batch
    recordDecision(player, 'discard', 'discarded', card)
    getTelemetryCounters(player.id).discards++
    playerTurnCountsRef.current.set(player.id, (playerTurnCountsRef.current.get(player.id) ?? 0) + 1)
    flushDecisions()

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

      // Flying card animation: buy (discard → hand, then penalty from draw pile → hand)
      animateBuy(buyingDiscard, !!buyer.isAI)

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

      // Telemetry: record buy
      recordDecision(buyer, 'buy', 'bought', buyingDiscard)
      const btc = getTelemetryCounters(buyer.id)
      btc.buysMade++
      btc.buyOpportunities++

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
      const passerIdx = buyerOrder[buyerStep]
      const passer = passerIdx !== undefined ? gameState.players[passerIdx] : null
      const passerName = passer?.name ?? '?'

      // Telemetry: record buy pass
      if (passer) {
        recordDecision(passer, 'buy', 'passed', buyingDiscard)
        const ptc = getTelemetryCounters(passer.id)
        ptc.buysPassed++
        ptc.buyOpportunities++
      }

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
        // All buyers passed — Fix C: briefly dim the discard pile card
        setDiscardUnwanted(true)
        setTimeout(() => setDiscardUnwanted(false), 600)
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
    clearSelection()
    setPendingUndo(null)
    setPendingBuyDiscard(null)
    setBuyLog([])
    setGameId(null)
    pendingSaveRef.current = 0
    turnCountRef.current = 0
    noProgressTurnsRef.current = 0
    drawPileDepletionsRef.current = 0
    aiLayOffCountRef.current = 0
    opponentHistoryRef.current = new Map()
    aiTurnsCouldGoDownRef.current = new Map()
    aiTurnsElapsedRef.current = new Map()
    resetRoundTelemetry()
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

  // ── Telemetry: compute round stats ──────────────────────────────────────
  function computeRoundStats(
    gId: string, roundNum: number, p: Player,
    result: { playerId: string; score: number; shanghaied: boolean } | null,
  ): PlayerRoundStats {
    const tc = telemetryCountersRef.current.get(p.id)
    const totalTurns = playerTurnCountsRef.current.get(p.id) ?? 0
    const turnDown = turnWentDownRef.current.get(p.id) ?? null
    const held = turnsHeldRef.current.get(p.id) ?? 0
    const totalTakes = (tc?.freeTakes ?? 0) + (tc?.buysMade ?? 0)
    const takeOpportunities = totalTakes + (tc?.freeDeclines ?? 0)
    const buyOpp = tc?.buyOpportunities ?? 0
    const handPoints = p.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)

    return {
      game_id: gId,
      round_number: roundNum,
      player_name: p.name,
      is_human: !p.isAI,
      difficulty: p.isAI ? (aiPersonality ?? aiDifficulty) : null,
      round_score: result?.score ?? handPoints,
      went_out: result?.score === 0,
      went_down: p.hasLaidDown,
      shanghaied: result?.shanghaied ?? !p.hasLaidDown,
      total_turns: totalTurns,
      turn_went_down: turnDown,
      turns_held_before_going_down: held,
      free_takes: tc?.freeTakes ?? 0,
      free_declines: tc?.freeDeclines ?? 0,
      pile_draws: tc?.pileDraws ?? 0,
      discard_take_rate: takeOpportunities > 0 ? (tc?.freeTakes ?? 0) / takeOpportunities : null,
      cards_taken_used_in_meld: 0, // backfilled by backfillDecisionOutcomes
      cards_taken_wasted: 0,
      take_accuracy: null,
      buys_made: tc?.buysMade ?? 0,
      buys_passed: tc?.buysPassed ?? 0,
      buy_opportunities: buyOpp,
      cards_bought_used_in_meld: 0,
      cards_bought_wasted: 0,
      buy_accuracy: buyOpp > 0 ? (tc?.buysMade ?? 0) / buyOpp : null,
      discards_total: tc?.discards ?? 0,
      denial_takes: tc?.denialTakes ?? 0,
      denial_buys: tc?.denialBuys ?? 0,
      melds_laid_down: tc?.meldsLaidDown ?? 0,
      bonus_melds: tc?.bonusMelds ?? 0,
      lay_offs_made: tc?.layOffs ?? 0,
      joker_swaps: tc?.jokerSwaps ?? 0,
      hand_size_when_went_down: tc?.handSizeWentDown ?? null,
      final_hand_size: p.hand.length,
      final_hand_points: handPoints,
      scenario_b_triggers: tc?.scenarioB ?? 0,
      scenario_c_triggers: tc?.scenarioC ?? 0,
    }
  }

  function computeAndSaveGameStats(gId: string, players: Player[]) {
    const sorted = [...players].sort((a, b) => {
      const aTotal = a.roundScores.reduce((s, v) => s + v, 0)
      const bTotal = b.roundScores.reduce((s, v) => s + v, 0)
      return aTotal - bTotal
    })
    const winnerTotal = sorted[0]?.roundScores.reduce((s, v) => s + v, 0) ?? 0

    for (let rank = 0; rank < sorted.length; rank++) {
      const p = sorted[rank]
      const total = p.roundScores.reduce((s, v) => s + v, 0)
      const stats: PlayerGameStats = {
        game_id: gId,
        player_name: p.name,
        is_human: !p.isAI,
        difficulty: p.isAI ? (aiPersonality ?? aiDifficulty) : null,
        total_score: total,
        final_rank: rank + 1,
        won: total === winnerTotal && rank === 0,
        rounds_won: p.roundScores.filter(s => s === 0).length,
        rounds_shanghaied: 0, // not tracked at game level
        rounds_went_down: p.roundScores.length, // approximate
        avg_score_per_round: p.roundScores.length > 0 ? total / p.roundScores.length : 0,
        worst_round_score: Math.max(...p.roundScores, 0),
        best_round_score: Math.min(...p.roundScores, 999),
        overall_take_accuracy: null,
        overall_buy_accuracy: null,
        avg_turns_to_go_down: null,
        total_buys_made: 0,
        total_denial_actions: 0,
        total_lay_offs: 0,
        total_joker_swaps: 0,
        avg_turn_went_down: null,
        times_held_going_down: 0,
      }
      void savePlayerGameStats(stats)
    }
  }

  // ── Next round / game over ────────────────────────────────────────────────
  function handleNextRound() {
    setRoundSummaryExiting(true)
    setTimeout(() => {
      setRoundSummaryExiting(false)
      noProgressTurnsRef.current = 0
      drawPileDepletionsRef.current = 0
      opponentHistoryRef.current = new Map()
      aiTurnsCouldGoDownRef.current = new Map()
      aiTurnsElapsedRef.current = new Map()
      const nextRound = gameState.currentRound + 1
      if (nextRound > TOTAL_ROUNDS) {
        setGameState(prev => ({ ...prev, gameOver: true }))
        // Telemetry: save game-level stats
        if (gameId) computeAndSaveGameStats(gameId, gameState.players)
        // Tournament callback — let PlayTab handle the game-over flow
        if (onGameComplete) onGameComplete(gameState.players)
        setShowDarkBeat(true)
        setTimeout(() => {
          setShowDarkBeat(false)
          setUiPhase('game-over')
        }, 800)
      } else {
        const next = setupRound(gameState, nextRound)
        setGameState(next)
        setRoundResults(null)
        clearSelection()
        setPendingBuyDiscard(null)
        setUiPhase('round-start')
      }
    }, 300)
  }

  // ── AI: execute action phase turn ─────────────────────────────────────────
  function executeAIAction() {
    const state = gameStateRef.current
    const player = getCurrentPlayer(state)
    const { tablesMelds, requirement } = state.roundState
    const config = getPersonalityConfig()

    // Track turns elapsed for panic mode
    const turnsElapsed = (aiTurnsElapsedRef.current.get(player.id) ?? 0) + 1
    aiTurnsElapsedRef.current.set(player.id, turnsElapsed)

    // Build joker positions for AI runs: place extra jokers at the low end
    function aiJokerPositions(meldGroups: CardType[][]): Map<string, number> {
      const positions = new Map<string, number>()
      for (const cards of meldGroups) {
        if (isValidSet(cards)) continue
        let placed = new Map<string, number>()
        for (;;) {
          const placement = getNextJokerOptions(cards, placed)
          if (!placement) break
          const choice = placement.options[0]
          placed.set(placement.joker.id, choice.rank)
        }
        placed.forEach((rank, id) => positions.set(id, rank))
      }
      return positions
    }

    // ── Go-down decision helper (personality-aware) ──
    function shouldGoDownNow(melds: CardType[][]): boolean {
      const style = config.goDownStyle
      if (style === 'immediate') return true

      if (style === 'immediate-random-hold') {
        // Lucky Lou: 25% chance to hold one extra turn
        if (config.randomFactor > 0 && Math.random() < 0.25) {
          const turnsWaited = aiTurnsCouldGoDownRef.current.get(player.id) ?? 0
          if (turnsWaited === 0) {
            aiTurnsCouldGoDownRef.current.set(player.id, 1)
            turnsHeldRef.current.set(player.id, (turnsHeldRef.current.get(player.id) ?? 0) + 1)
            recordDecision(player, 'go_down', 'held', null, 'random hold')
            return false
          }
        }
        return true
      }

      if (style === 'hold-for-out') {
        // The Mastermind: only go down if going out OR panic
        const totalMeldCards = melds.reduce((sum, m) => sum + m.length, 0)
        const remainingCards = player.hand.length - totalMeldCards
        if (remainingCards === 0) return true // going out!
        // Check panic threshold
        if (turnsElapsed >= config.panicThreshold) return true
        // Check opponent pressure
        const someoneClose = state.players.some(p => p.id !== player.id && p.hand.length <= 3 && p.hasLaidDown)
        if (someoneClose) return true
        aiTurnsCouldGoDownRef.current.set(player.id, (aiTurnsCouldGoDownRef.current.get(player.id) ?? 0) + 1)
        turnsHeldRef.current.set(player.id, (turnsHeldRef.current.get(player.id) ?? 0) + 1)
        recordDecision(player, 'go_down', 'held', null, 'hold-for-out')
        return false
      }

      // 'strategic' — use existing hard AI logic
      const turnsWaited = aiTurnsCouldGoDownRef.current.get(player.id) ?? 0
      const shouldGoDown = aiShouldGoDownHard(
        player.hand, melds, requirement, tablesMelds,
        state.players, state.roundState.currentPlayerIndex, turnsWaited,
      )
      if (!shouldGoDown) {
        aiTurnsCouldGoDownRef.current.set(player.id, turnsWaited + 1)
        turnsHeldRef.current.set(player.id, (turnsHeldRef.current.get(player.id) ?? 0) + 1)
        recordDecision(player, 'go_down', 'held', null, 'strategic hold')
      }
      return shouldGoDown
    }

    // Lay-off style: never / capped-1 / unlimited
    const layOffCap = config.layOffStyle === 'never' ? 0
      : config.layOffStyle === 'capped-1' ? 1
      : Infinity

    // ── Basic/Easy personality: lay down required melds only, simple discard ──
    if (config.discardStyle === 'random' && config.layOffStyle === 'never') {
      if (!player.hasLaidDown) {
        const melds = aiFindBestMelds(player.hand, requirement)
        if (melds && melds.length > 0) {
          aiLayOffCountRef.current = 0
          setAiMessage(`${player.name} lays down`)
          setTimeout(() => setAiMessage(null), 1200)
          showLastAction(`${player.name} lays down!`)
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        }
      }
      aiLayOffCountRef.current = 0
      const card = aiChooseDiscardEasy(player.hand)
      setAiMessage(`${player.name} discards`)
      setTimeout(() => setAiMessage(null), 800)
      showLastAction(`${player.name} discards`)
      handleDiscard(card.id)
      return
    }

    // ── Pre-lay-down joker swap (medium+ personalities) ──
    if (config.jokerSwapStyle !== 'never' && !player.hasLaidDown && tablesMelds.length > 0) {
      const swap = aiFindPreLayDownJokerSwap(player.hand, tablesMelds, requirement)
      if (swap) {
        // Random personality: 50% chance to skip the swap
        if (config.jokerSwapStyle === 'random' && Math.random() < 0.5) {
          // skip
        } else {
          setAiMessage(`${player.name} swaps a joker to lay down`)
          setTimeout(() => setAiMessage(null), 1500)
          handleJokerSwap(swap.card, swap.meld)
          setAiActionTick(t => t + 1)
          return
        }
      }
    }

    // ── Try to lay down including bonus melds ──
    if (!player.hasLaidDown) {
      const melds = aiFindAllMelds(player.hand, requirement)
      if (melds && melds.length > 0) {
        if (shouldGoDownNow(melds)) {
          aiTurnsCouldGoDownRef.current.delete(player.id)
          aiLayOffCountRef.current = 0
          noProgressTurnsRef.current = 0
          setAiMessage(`${player.name} lays down!`)
          setTimeout(() => setAiMessage(null), 1500)
          showLastAction(`${player.name} lays down!`)
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        } else {
          setAiMessage(`${player.name} holds...`)
          setTimeout(() => setAiMessage(null), 1000)
          // Fall through to discard
        }
      }
    }

    // ── Joker swap after laying down (beneficial/optimal/random personalities) ──
    if (config.jokerSwapStyle !== 'never' && player.hasLaidDown && tablesMelds.length > 0) {
      const swap = aiFindJokerSwap(player.hand, tablesMelds)
      if (swap) {
        if (config.jokerSwapStyle === 'random' && Math.random() < 0.5) {
          // skip
        } else {
          setAiMessage(`${player.name} swaps a joker`)
          setTimeout(() => setAiMessage(null), 1200)
          handleJokerSwap(swap.card, swap.meld)
          setAiActionTick(t => t + 1)
          return
        }
      }
    }

    // ── Try to lay off ──
    const hasJokerInHand = player.hand.some(c => c.suit === 'joker')
    if (layOffCap > 0 && player.hasLaidDown && tablesMelds.length > 0 &&
        (aiLayOffCountRef.current < layOffCap || player.hand.length === 1 || hasJokerInHand)) {
      const layOff = aiFindLayOff(player.hand, tablesMelds)
      if (layOff) {
        if (layOff.card.suit !== 'joker') aiLayOffCountRef.current++
        setAiMessage(`${player.name} lays off`)
        setTimeout(() => setAiMessage(null), 1000)
        showLastAction(`${player.name} lays off`)
        handleLayOff(layOff.card, layOff.meld, layOff.jokerPosition)
        return
      }
    }

    // ── Discard ──
    if (player.hand.length > 0) {
      aiLayOffCountRef.current = 0

      // Panic mode: stuck too long without laying down
      let card: CardType
      if (!player.hasLaidDown && turnsElapsed >= config.panicThreshold) {
        const nonJokers = player.hand.filter(c => c.suit !== 'joker')
        const pool = nonJokers.length > 0 ? nonJokers : player.hand
        card = pool.reduce((worst, c) => cardPoints(c.rank) > cardPoints(worst.rank) ? c : worst)
        setAiMessage(`${player.name} dumps a card`)
      } else if (config.discardStyle === 'opponent-aware') {
        card = aiChooseDiscardHard(player.hand, tablesMelds, opponentHistoryRef.current,
            state.players.filter(p => p.id !== player.id), requirement)
        setAiMessage(`${player.name} discards`)
      } else if (config.discardStyle === 'run-aware' || config.discardStyle === 'highest-value') {
        card = aiChooseDiscard(player.hand, requirement, tablesMelds)
        // Lucky Lou: 15% chance to pick a random card instead
        if (config.randomFactor > 0 && Math.random() < 0.15 && player.hand.length > 1) {
          const randomIdx = Math.floor(Math.random() * player.hand.length)
          card = player.hand[randomIdx]
        }
        setAiMessage(`${player.name} discards`)
      } else {
        card = aiChooseDiscardEasy(player.hand)
        setAiMessage(`${player.name} discards`)
      }
      console.log(`[Buy] AI ${player.name} discarded [${card.rank === 0 ? 'Joker' : `${card.rank}${card.suit}`}]`)
      setTimeout(() => setAiMessage(null), 800)
      showLastAction(`${player.name} discards`)
      handleDiscard(card.id)
    }
  }

  // ── AI turn automation (draw + action) ───────────────────────────────────
  const handLen = currentPlayer.hand.length
  useEffect(() => {
    if (!currentPlayer.isAI) return
    if (uiPhase !== 'draw' && uiPhase !== 'action') return
    // BAIL if someone has gone out — round is over
    if (gameState.roundState.goOutPlayerId) return

    const delay = getAIDelay(gameSpeed)
    const timerId = setTimeout(() => {
      // Re-check goOutPlayerId inside the timeout (state may have changed)
      if (gameStateRef.current.roundState.goOutPlayerId) return
      if (uiPhaseRef.current === 'draw') {
        const state = gameStateRef.current
        const player = getCurrentPlayer(state)
        const top = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null

        const cfg = getPersonalityConfig()
        let shouldTake = false
        if (top !== null) {
          if (cfg.takeStyle === 'basic') {
            shouldTake = aiShouldTakeDiscardEasy(player.hand, top, state.roundState.requirement)
          } else if (cfg.takeStyle === 'aggressive-denial') {
            shouldTake = aiShouldTakeDiscardHard(player.hand, top, state.roundState.requirement, player.hasLaidDown,
                state.roundState.tablesMelds, state.players.filter(p => p.id !== player.id))
          } else if (cfg.takeStyle === 'selective') {
            // Selective: use medium logic but with stricter criteria
            shouldTake = aiShouldTakeDiscard(player.hand, top, state.roundState.requirement, player.hasLaidDown, 'hard', state.roundState.tablesMelds)
          } else {
            shouldTake = aiShouldTakeDiscard(player.hand, top, state.roundState.requirement, player.hasLaidDown, aiDifficulty, state.roundState.tablesMelds)
          }
          // Lucky Lou random factor: 20% chance to take any discard, 10% chance to decline a good one
          if (cfg.randomFactor > 0) {
            if (!shouldTake && Math.random() < 0.2) shouldTake = true
            else if (shouldTake && Math.random() < 0.1) shouldTake = false
          }
        }

        setAiMessage(shouldTake
          ? `${player.name} takes the discard`
          : `${player.name} draws from pile`)
        setTimeout(() => setAiMessage(null), 1000)
        showLastAction(shouldTake ? `${player.name} took the discard` : `${player.name} drew from pile`)

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
    // BAIL if someone has gone out — round is over
    if (gameState.roundState.goOutPlayerId) return
    const buyerIdx = buyerOrder[buyerStep]
    if (buyerIdx === undefined) return
    const buyer = gameState.players[buyerIdx]
    if (!buyer?.isAI) return

    const delay = getAIDelay(gameSpeed)
    const timerId = setTimeout(() => {
      // Re-check goOutPlayerId inside the timeout
      if (gameStateRef.current.roundState.goOutPlayerId) return
      const state = gameStateRef.current
      const currentBuyer = state.players[buyerOrderRef.current[buyerStepRef.current]]
      const disc = buyingDiscard
      const req = state.roundState.requirement
      if (!disc || !currentBuyer) {
        handleBuyDecision(false)
        return
      }
      const buyConfig = getPersonalityConfig()
      // Enforce personality buy self limit
      const personalityBuysUsed = (state.buyLimit >= 999 ? 999 : state.buyLimit) - currentBuyer.buysRemaining
      const atPersonalityLimit = buyConfig.buySelfLimit > 0 && personalityBuysUsed >= buyConfig.buySelfLimit

      let shouldBuy = false
      if (atPersonalityLimit || buyConfig.buyStyle === 'never') {
        shouldBuy = false
      } else if (buyConfig.buyStyle === 'denial' || buyConfig.buyStyle === 'heavy-denial') {
        shouldBuy = aiShouldBuyHard(currentBuyer.hand, disc, req, currentBuyer.buysRemaining,
            state.roundState.tablesMelds, state.players.filter(p => p.id !== currentBuyer.id))
      } else if (buyConfig.buyStyle === 'conservative') {
        shouldBuy = aiShouldBuy(currentBuyer.hand, disc, req, currentBuyer.buysRemaining, state.buyLimit)
      } else if (buyConfig.buyStyle === 'aggressive') {
        // Aggressive: use medium logic but always buy if it fits a meld
        shouldBuy = aiShouldBuy(currentBuyer.hand, disc, req, currentBuyer.buysRemaining, state.buyLimit)
        if (!shouldBuy) {
          shouldBuy = aiShouldBuyHard(currentBuyer.hand, disc, req, currentBuyer.buysRemaining,
              state.roundState.tablesMelds, state.players.filter(p => p.id !== currentBuyer.id))
        }
      } else {
        shouldBuy = aiShouldBuyEasy(currentBuyer.hand, disc, req, currentBuyer.buysRemaining)
      }

      if (shouldBuy) {
        setAiMessage(`${currentBuyer.name} buys!`)
        showLastAction(`${currentBuyer.name} buys!`)
      } else {
        setAiMessage(`${currentBuyer.name} passes`)
      }
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

  // ── Race intensity tension system (must be before early returns — hooks rule) ──
  const tensionLevel = useMemo(() => {
    const playersCloseToOut = gameState.players.filter(p => p.hasLaidDown && p.hand.length <= 5)
    if (playersCloseToOut.length === 0) return 0
    const minCards = Math.min(...playersCloseToOut.map(p => p.hand.length))
    const isRace = playersCloseToOut.length >= 2 && minCards <= 3
    if (isRace || minCards <= 1) return 3
    if (playersCloseToOut.length >= 1 && minCards <= 3) return 2
    if (playersCloseToOut.length >= 1 && minCards <= 5) return 1
    return 0
  }, [gameState.players])

  // Snap off tension when someone goes out
  const effectiveTension = gameState.roundState.goOutPlayerId ? 0 : tensionLevel

  // Rotating race commentary
  useEffect(() => {
    if (effectiveTension < 2) { setRaceMessage(''); return }

    function pickMessage(): string {
      const state = gameStateRef.current
      const players = state.players
      const me = players.find(p => !p.isAI)
      const closePlayers = players.filter(p => p.hasLaidDown && p.hand.length <= 5)
      if (closePlayers.length === 0) return '🔥 Race to finish'
      const closest = closePlayers.reduce((a, b) => a.hand.length < b.hand.length ? a : b)
      const myCards = me?.hand.length ?? 99
      const meInRace = me?.hasLaidDown && myCards <= 5

      const pool: string[] = ['🔥 Race to finish', '⚡ Every card counts', '🃏 One draw could end it']

      if (closePlayers.length >= 2) {
        pool.push('👀 Who blinks first?')
        pool.push('⚡ Neck and neck')
      }

      if (closest && closest.hand.length <= 2 && closest.isAI) {
        pool.push(`😬 ${closest.name} is about to go out`)
        pool.push(`🚨 Can anyone stop ${closest.name}?`)
      }

      if (meInRace && myCards <= 3) {
        pool.push('🔥 You\'re almost there')
        pool.push('💪 Finish strong')
        pool.push('⚡ One good draw away')
      }

      if (!meInRace && closest?.isAI && closest.hand.length <= 3) {
        pool.push('😰 Running out of time')
        pool.push('🚨 Last chance to lay off')
      }

      const filtered = pool.filter(m => m !== raceMessage)
      return filtered[Math.floor(Math.random() * filtered.length)] ?? pool[0]
    }

    setRaceMessage(pickMessage())
    const interval = setInterval(() => setRaceMessage(pickMessage()), 4500)
    return () => clearInterval(interval)
  }, [effectiveTension]) // eslint-disable-line react-hooks/exhaustive-deps

  if (uiPhase === 'round-start' && announcementStage) {
    return (
      <RoundAnnouncement
        stage={announcementStage}
        roundNumber={gameState.currentRound}
        requirementDescription={rs.requirement.description}
        cardsDealt={rs.cardsDealt}
        dealerName={gameState.players[rs.dealerIndex]?.name ?? ''}
        firstPlayerName={gameState.players[rs.currentPlayerIndex]?.name ?? ''}
        isHumanFirst={!gameState.players[rs.currentPlayerIndex]?.isAI}
        isFinalRound={gameState.currentRound === TOTAL_ROUNDS}
        isLateRound={gameState.currentRound >= 5}
        standings={gameState.players.map(p => ({
          name: p.name,
          score: p.roundScores.reduce((a: number, b: number) => a + b, 0),
          isHuman: !p.isAI,
        }))}
        previousLeader={previousLeaderRef.current}
        onSkip={skipAnnouncement}
      />
    )
  }

  if (uiPhase === 'privacy') {
    return (
      <PrivacyScreen
        playerName={currentPlayer.name}
        onReady={() => setUiPhase('draw')}
        roundNum={rs.roundNumber}
        requirement={rs.requirement.description}
        rank={(() => {
          const sorted = [...gameState.players].sort((a, b) =>
            a.roundScores.reduce((s, n) => s + n, 0) - b.roundScores.reduce((s, n) => s + n, 0)
          )
          return sorted.findIndex(p => p.id === currentPlayer.id) + 1
        })()}
        totalPlayers={gameState.players.length}
        scoreDiff={(() => {
          const totals = gameState.players.map(p => ({ id: p.id, total: p.roundScores.reduce((s, n) => s + n, 0) }))
          const sorted = [...totals].sort((a, b) => a.total - b.total)
          const myTotal = totals.find(t => t.id === currentPlayer.id)?.total ?? 0
          const leaderTotal = sorted[0]?.total ?? 0
          return myTotal - leaderTotal
        })()}
      />
    )
  }

  if (uiPhase === 'round-end' && roundResults) {
    return (
      <div style={roundSummaryExiting ? { animation: 'slide-down-screen 300ms ease-in both' } : undefined}>
        <RoundSummary
          players={gameState.players}
          roundResults={roundResults}
          roundNum={gameState.currentRound}
          onNext={handleNextRound}
          isLastRound={gameState.currentRound === TOTAL_ROUNDS}
        />
      </div>
    )
  }

  if (uiPhase === 'game-over') {
    // Tournament mode — PlayTab handles game-over rendering
    if (onGameComplete) {
      return (
        <div style={{ minHeight: '100dvh', background: '#1a3a2a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#6aad7a', fontSize: 14 }}>Loading results...</p>
        </div>
      )
    }
    return (
      <GameOver
        players={gameState.players}
        buyLimit={gameState.buyLimit}
        buyLog={buyLog}
        gameId={gameId}
        onPlayAgain={startNewGame}
        onBack={onExit}
        aiPersonality={aiPersonality}
      />
    )
  }

  // ── Main board: draw / action / buying ────────────────────────────────────
  // Display-only derivations (no state mutations)
  // Player has 1 card, has laid down, and can't lay it off anywhere — stuck
  const lastCardStuck = uiPhase === 'action' && !currentPlayer.isAI &&
    currentPlayer.hand.length === 1 && currentPlayer.hasLaidDown &&
    !rs.tablesMelds.some(m => canLayOff(currentPlayer.hand[0], m))
  // Card to pass to TableMelds for inline lay-off/swap highlighting
  const inlineSelectedCard: CardType | null = (() => {
    if (uiPhase !== 'action' || currentPlayer.isAI || !currentPlayer.hasLaidDown) return null
    if (selectedCardIds.size !== 1) return null
    const cardId = [...selectedCardIds][0]
    return currentPlayer.hand.find(c => c.id === cardId) ?? null
  })()

  const isHumanDraw = uiPhase === 'draw' && !currentPlayer.isAI

  const feltColor = effectiveTension === 0
    ? '#1a3a2a'
    : effectiveTension === 1
    ? '#1d3a29'
    : effectiveTension === 2
    ? '#213828'
    : '#243727'

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: feltColor,
        transition: 'background-color 3s ease',
      }}
    >
      <style>{`
        @keyframes gbPulseGold{0%,100%{box-shadow:0 0 0 0 rgba(226,184,88,0)}50%{box-shadow:0 0 22px 8px rgba(226,184,88,0.85)}}
        @keyframes gbPulseGreen{0%,100%{box-shadow:0 0 0 0 rgba(106,173,122,0);transform:scale(1)}50%{box-shadow:0 0 22px 8px rgba(106,173,122,0.85);transform:scale(1.08)}}
        @keyframes turnBannerIn{0%{opacity:0;transform:translateY(-20px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes turnBannerOut{0%{opacity:1}100%{opacity:0}}
      `}</style>

      {/* Dark beat overlay — briefly flashes black on round end */}
      {showDarkBeat && (
        <div
          className="fixed inset-0 z-40 bg-black"
          style={{ animation: 'fade-in-black 500ms ease both' }}
        />
      )}

      {/* Rotating race commentary — appears at tension level 2+ */}
      {effectiveTension >= 2 && raceMessage && (
        <div className="flex justify-center py-1.5" style={{ position: 'absolute', top: 'max(52px, calc(env(safe-area-inset-top) + 44px))', left: 0, right: 0, zIndex: 40, pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(42,53,34,0.85)',
            backdropFilter: 'blur(4px)',
            padding: '4px 16px',
            borderRadius: 20,
            border: '1px solid rgba(226,184,88,0.2)',
          }}>
            <span key={raceMessage} style={{ fontSize: 12, fontWeight: 700, color: '#e2b858', display: 'flex', alignItems: 'center', gap: 6, animation: 'race-message-fade 4.5s ease both' }}>
              {raceMessage}
            </span>
          </div>
        </div>
      )}

      {/* Turn banner — non-blocking overlay for solo-human games */}
      {turnBanner && (
        <div style={{
          position: 'absolute',
          top: 'max(52px, calc(env(safe-area-inset-top) + 44px))',
          left: 0, right: 0,
          zIndex: 40,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          animation: 'turnBannerIn 0.3s ease-out',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #e2b858, #d4a843)',
            color: '#2c1810',
            padding: '8px 24px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            {turnBanner}
          </div>
        </div>
      )}

      {/* Game-feel toast overlay */}
      <GameToast toast={activeToast} />

      {/* ── ZONE 1: Fixed top — top bar + collapsible opponent strip ─── */}
      <div
        className="bg-[#0f2218]"
        style={{ flexShrink: 0, paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        {/* Top bar: round badge | requirement badge | pause */}
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

          {/* Pause button */}
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

        {/* Compressed opponent strip — single-line ticker, tap to expand */}
        <div
          onClick={() => setStripExpanded(!stripExpanded)}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          {!stripExpanded ? (
            /* ── Collapsed: compact single-line view ── */
            <div
              className="flex items-center gap-1 px-3 py-1.5"
              style={{ overflowX: 'auto', scrollbarWidth: 'none', flexWrap: 'nowrap' }}
            >
              {gameState.players.map((p, i) => {
                const total = p.roundScores.reduce((s, n) => s + n, 0)
                const isMe = p.id === displayPlayer.id
                const isActiveTurn = p.id === currentPlayer.id
                const isBuyingNow = uiPhase === 'buying' && activeBuyer?.id === p.id
                return (
                  <span key={p.id} style={{
                    display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                    borderLeft: isActiveTurn ? '3px solid #e2b858' : '3px solid transparent',
                    paddingLeft: isActiveTurn ? 4 : 0,
                    transition: 'border-color 200ms ease, padding-left 200ms ease',
                  }}>
                    {i > 0 && <span style={{ color: '#2d5a3a', margin: '0 5px', fontSize: 10 }}>·</span>}
                    {/* Meld dot */}
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%', display: 'inline-block', marginRight: 3, flexShrink: 0,
                      background: p.hasLaidDown ? '#6aad7a' : '#2d5a3a',
                    }} />
                    <span style={{
                      color: isMe ? '#e2b858' : isActiveTurn ? '#ffffff' : '#a8d0a8',
                      fontSize: 11, fontWeight: isMe || isActiveTurn ? 700 : 500,
                      maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {isMe && !p.isAI ? 'You' : p.name.split(' ')[0]}{p.isAI ? '🤖' : ''}
                    </span>
                    <span style={{ color: '#6aad7a', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, marginLeft: 3 }}>
                      {total}
                    </span>
                    <span key={p.hand.length} style={{ color: '#a8d0a8', fontSize: 10, marginLeft: 2, animation: 'number-roll 300ms ease-out' }}>
                      🃏{p.hand.length}
                    </span>
                    {isBuyingNow && !isMe && (
                      <span style={{ color: '#e2b858', fontSize: 9, marginLeft: 2, fontWeight: 700 }}>BUY</span>
                    )}
                  </span>
                )
              })}
              {/* Expand chevron */}
              <span style={{ color: '#6aad7a', fontSize: 10, marginLeft: 'auto', paddingLeft: 6, flexShrink: 0 }}>▼</span>
            </div>
          ) : (
            /* ── Expanded: full detail cards ── */
            <>
              <div
                className="flex gap-2 px-3 py-2"
                style={{ overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', scrollbarWidth: 'none' }}
              >
                {gameState.players.map(p => {
                  const total = p.roundScores.reduce((s, n) => s + n, 0)
                  const isBuyingNow = uiPhase === 'buying' && activeBuyer?.id === p.id
                  const isMe = p.id === displayPlayer.id
                  const isActiveTurn = p.id === currentPlayer.id
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
                        background: isActiveTurn ? '#1e4a2e' : (isMe ? '#1e3010' : '#0f2218'),
                        border: `1px solid ${borderColor}`,
                        borderLeft: isActiveTurn ? '3px solid #e2b858' : `1px solid ${borderColor}`,
                        borderRadius: 10,
                        padding: '6px 8px',
                        minWidth: 68,
                        transition: 'all 200ms ease',
                      }}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <div style={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                          background: p.hasLaidDown ? '#6aad7a' : '#2d5a3a',
                        }} />
                        <p style={{
                          color: isMe ? '#e2b858' : '#a8d0a8', fontSize: 11, fontWeight: 500,
                          maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {isMe && !p.isAI ? 'You' : `${p.name.split(' ')[0]}${p.isAI ? ' 🤖' : ''}`}
                        </p>
                        {p.hasLaidDown && (
                          <span style={{ color: '#6aad7a', fontSize: 8, fontWeight: 700, marginLeft: 2 }}>DOWN</span>
                        )}
                      </div>
                      {isActiveTurn && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
                          <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#e2b858', flexShrink: 0 }} />
                          <p style={{ color: '#e2b858', fontSize: 9, fontWeight: 700, margin: 0 }}>
                            {p.isAI ? `${p.name.split(' ')[0]}'s turn` : 'your turn'}
                          </p>
                        </div>
                      )}
                      <p style={{ color: '#6aad7a', fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}>
                        {total} pts
                      </p>
                      <p key={p.hand.length} style={{ color: '#a8d0a8', fontSize: 10, animation: 'number-roll 300ms ease-out' }}>🃏 {p.hand.length}</p>
                      {(uiPhase === 'buying' || p.buysRemaining === 0) && (
                        <p style={{ color: p.buysRemaining === 0 ? '#f87171' : '#6aad7a', fontSize: 10, fontWeight: 600 }}>
                          {p.buysRemaining}🛒
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Collapse chevron */}
              <div style={{ textAlign: 'center', paddingBottom: 2 }}>
                <span style={{ color: '#6aad7a', fontSize: 10 }}>▲ tap to collapse</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Phase indicator */}
      <div style={{
        height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f2218', borderBottom: '1px solid #2d5a3a',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const,
          letterSpacing: '0.1em', color: '#6aad7a',
        }}>
          {(() => {
            if (uiPhase === 'draw' && !currentPlayer.isAI) return 'Draw a card'
            if (uiPhase === 'action' && !currentPlayer.isAI) return 'Play your hand'
            if ((uiPhase === 'draw' || uiPhase === 'action') && currentPlayer.isAI) return `${currentPlayer.name} is thinking`
            if (uiPhase === 'buying') return 'Buying window'
            return ''
          })()}
          {((uiPhase === 'draw' || uiPhase === 'action') && currentPlayer.isAI) && (
            <>
              <span style={{ display: 'inline-block', animation: 'thinking-dot 1s ease-in-out infinite' }}>.</span>
              <span style={{ display: 'inline-block', animation: 'thinking-dot 1s ease-in-out 200ms infinite' }}>.</span>
              <span style={{ display: 'inline-block', animation: 'thinking-dot 1s ease-in-out 400ms infinite' }}>.</span>
            </>
          )}
        </span>
      </div>

      {/* Last action indicator */}
      {lastAction && (
        <div style={{
          height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f2218',
        }}>
          <span
            key={lastAction}
            style={{
              fontSize: 10, color: '#8bc48b', fontStyle: 'italic',
              animation: 'fade-in-out 2.5s ease both',
            }}
          >
            {lastAction}
          </span>
        </div>
      )}

      {/* ── ZONE 2: Scrollable middle — table melds + overlay toast ──── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* Toast overlay — floats over melds, no layout shift */}
        {(reshuffleMsg || aiMessage) && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            display: 'flex', justifyContent: 'center', padding: '4px 16px',
            background: reshuffleMsg
              ? 'linear-gradient(180deg, #e2b858 0%, rgba(226,184,88,0) 100%)'
              : 'linear-gradient(180deg, rgba(30,74,46,0.95) 0%, rgba(30,74,46,0) 100%)',
            pointerEvents: 'none',
          }}>
            {reshuffleMsg ? (
              <span className="text-xs font-medium text-[#2c1810]">Draw pile reshuffled from discards</span>
            ) : (
              <span className="text-xs text-[#a8d0a8] animate-pulse">{aiMessage}</span>
            )}
          </div>
        )}
        {/* Close race indicator — replaced by tension system overlays above */}
        <div
          ref={zone2ScrollRef}
          className="px-3 py-3"
          style={{ height: '100%', overflowY: 'auto' }}
        >
        <TableMelds
          melds={rs.tablesMelds}
          currentPlayerId={currentPlayer.id}
          humanPlayerIds={humanPlayerIds}
          selectedCard={inlineSelectedCard}
          onLayOff={handleInlineLayOff}
          onJokerSwap={handleJokerSwap}
          justLaidOffCardIds={justLaidOffCardIds}
          roundNumber={rs.roundNumber}
          requirement={rs.requirement}
          cardsDealt={rs.cardsDealt}
          flashMeldId={flashMeldId}
          flashIsHeist={flashIsHeist}
          swapMode={swapMode && !currentPlayer.hasLaidDown}
          playerHand={swapMode && !currentPlayer.hasLaidDown ? currentPlayer.hand : undefined}
          swapSelectedMeldId={swapSelectedMeldId}
          onSwapModeJokerTap={handleSwapModeJokerTap}
        />
        </div>
      </div>

      {/* ── ZONE 3: Piles strip — hidden during AI turns in solo-human games ── */}
      {(uiPhase === 'draw' || uiPhase === 'buying') &&
       (!soloHuman || !currentPlayer.isAI || isHumanBuyerTurn) && (
        <div
          style={{
            flexShrink: 0,
            background: '#162e22',
            borderTop: '1px solid #2d5a3a',
            borderBottom: '1px solid #2d5a3a',
            padding: '6px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 32,
          }}
        >
          {/* Draw pile */}
          <div ref={drawPileRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <p style={{
              color: isHumanDraw ? '#ffffff' : '#6aad7a',
              fontSize: isHumanDraw ? 10 : 9,
              fontWeight: isHumanDraw ? 700 : 400,
              textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
            }}>
              {isHumanDraw ? 'TAP TO DRAW' : 'Draw'}
            </p>
            {isHumanDraw && (
              <div
                className="flex justify-center"
                style={{ marginBottom: 2, animation: 'draw-arrow-pulse 1.5s ease-in-out infinite' }}
              >
                <span style={{ color: '#6aad7a', fontSize: 10, opacity: 0.6 }}>▲</span>
              </div>
            )}
            {rs.drawPile.length > 0 ? (
              <div className="draw-pile-press" style={{
                borderRadius: 6,
                animation: isHumanDraw ? 'gbPulseGreen 1.2s ease-in-out 0.3s infinite' : 'none',
                transform: 'scale(0.85)', transformOrigin: 'top center',
              }}>
                <CardComponent
                  card={rs.drawPile[0]}
                  faceDown
                  onClick={isHumanDraw ? handleDrawFromPile : undefined}
                />
              </div>
            ) : (
              <div
                style={{
                  width: 35, height: 52, borderRadius: 6,
                  border: '2px dashed #2d5a3a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#2d5a3a', fontSize: 9, textAlign: 'center',
                }}
              >
                Empty
              </div>
            )}
            <p key={rs.drawPile.length} style={{ color: '#6aad7a', fontSize: 9, margin: 0, animation: 'number-roll 300ms ease-out' }}>{rs.drawPile.length} cards</p>
          </div>

          {/* Discard pile */}
          <div ref={discardPileRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <p style={{
              color: isHumanDraw ? '#e2b858' : isHumanBuyerTurn ? '#e2b858' : '#6aad7a',
              fontSize: isHumanDraw ? 10 : 9,
              fontWeight: isHumanDraw || isHumanBuyerTurn ? 700 : 400,
              textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
            }}>
              {isHumanDraw ? 'TAP TO TAKE' : isHumanBuyerTurn ? 'FOR SALE' : 'Discard'}
            </p>
            {(isHumanBuyerTurn ? buyingDiscard : topDiscard) ? (
              <div
                key={(isHumanBuyerTurn && buyingDiscard ? buyingDiscard.id : topDiscard?.id) ?? 'empty'}
                style={{
                  borderRadius: 6,
                  animation: discardUnwanted
                    ? 'unwanted-dim 600ms ease-out both'
                    : isHumanBuyerTurn
                      ? 'for-sale-pulse 1.5s ease-in-out infinite'
                      : isHumanDraw
                        ? 'gbPulseGold 1.2s ease-in-out infinite'
                        : 'card-land 250ms ease-out',
                  transform: isHumanDraw ? 'scale(0.85) translateY(-2px)' : 'scale(0.85)',
                  transformOrigin: 'top center',
                  transition: 'transform 200ms ease',
                }}>
                <CardComponent
                  card={(isHumanBuyerTurn && buyingDiscard ? buyingDiscard : topDiscard)!}
                  onClick={isHumanDraw ? handleTakeDiscard : undefined}
                  style={isHumanDraw ? { border: '2px solid #e2b858' } : undefined}
                />
              </div>
            ) : (
              <div
                style={{
                  width: 35, height: 52, borderRadius: 6,
                  border: '2px dashed #2d5a3a',
                }}
              />
            )}
            <p style={{
              color: pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI ? '#e2b858' : '#6aad7a',
              fontSize: 9, fontWeight: pendingBuyDiscard ? 600 : 400, margin: 0,
            }}>
              {pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI ? 'Buyable' : '\u00A0'}
            </p>
            {lastDiscardedLabel && (
              <p
                key={lastDiscardedLabel}
                style={{ animation: 'fade-in-out 2s ease both' }}
                className="text-[10px] text-[#a8d0a8] font-medium text-center mt-0.5"
              >
                {lastDiscardedLabel}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── ZONE 4: Fixed bottom — buy prompt + hand + actions ──────────── */}
      <div
        className="bg-[#0f2218] px-3 pt-2"
        style={{ flexShrink: 0, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        {/* Buy prompt area — reserved height, fade in/out, no layout shift */}
        <div style={{
          minHeight: (pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI && !freeOfferDeclined) ||
                     (isHumanBuyerTurn && buyingDiscard && activeBuyer) ? undefined : 0,
          transition: 'opacity 200ms ease',
          opacity: (pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI && !freeOfferDeclined) ||
                   (isHumanBuyerTurn && buyingDiscard && activeBuyer) ? 1 : 0,
          pointerEvents: (pendingBuyDiscard && uiPhase === 'draw' && !currentPlayer.isAI && !freeOfferDeclined) ||
                         (isHumanBuyerTurn && buyingDiscard && activeBuyer) ? 'auto' : 'none',
        }}>
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
        </div>

        {/* Player hand — sort toggle + fan layout */}
        <div ref={handAreaRef}>
        {!displayPlayer.isAI ? (
          <HandDisplay
            cards={displayPlayer.hand}
            selectedIds={selectedCardIds}
            selectionOrder={selectedCardOrderRef.current}
            onToggle={toggleCard}
            label={`${isHumanBuyerTurn ? displayPlayer.name + "'s " : 'Your '}hand (${displayPlayer.hand.length} cards)`}
            disabled={false}
            sortMode={handSort}
            onSortChange={setHandSort}
            newCardId={[...newCardIds][0]}
            shimmerCardId={shimmerCardId}
            dealAnimation={showDealAnimation}
            leavingCardId={leavingCardId}
            dealFlipPhase={dealFlipPhase}
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
        </div>

        {/* Status slot — stable height, content fades */}
        <div style={{ minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {uiPhase === 'draw' && !currentPlayer.isAI ? (
            <p className="text-center text-xs text-[#6aad7a]" style={{ margin: 0 }}>
              Tap the draw pile or discard card
            </p>
          ) : (uiPhase === 'draw' || uiPhase === 'action') && currentPlayer.isAI && !aiMessage ? (
            <p className="text-center text-xs text-[#6aad7a] animate-pulse" style={{ margin: 0 }}>
              {currentPlayer.name} is playing...
            </p>
          ) : uiPhase === 'buying' && !isHumanBuyerTurn && activeBuyer?.isAI && !aiMessage ? (
            <p className="text-center text-xs text-[#6aad7a] animate-pulse" style={{ margin: 0 }}>
              {activeBuyer.name} deciding on buy...
            </p>
          ) : (
            <span>{'\u00A0'}</span>
          )}
        </div>

        {/* Undo toast */}
        {pendingUndo && (
          <div className="flex items-center justify-between bg-[#2c1810] text-white rounded-xl px-4 py-2">
            <span className="text-sm">Discarded {pendingUndo.card.rank === 0 ? 'Joker' : rankLabel(pendingUndo.card)}</span>
            <button onClick={handleUndoDiscard} className="text-[#e2b858] text-sm font-bold active:opacity-70">
              Undo
            </button>
          </div>
        )}

        {/* Inline joker position prompt */}
        {jokerPositionPrompt && (
          <div style={{
            backgroundColor: '#2e1a0e',
            borderRadius: 10,
            border: '1px solid #e2b858',
            padding: '8px 12px',
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <p style={{ color: '#f0d480', fontSize: 11, fontWeight: 600, margin: 0, flex: 1 }}>
              Place Joker where?
            </p>
            <button
              onClick={() => handleJokerPositionChoice('low')}
              style={{
                background: '#6aad7a', color: '#0f2218', border: 'none', borderRadius: 8,
                padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 36,
              }}
            >
              Low
            </button>
            <button
              onClick={() => handleJokerPositionChoice('high')}
              style={{
                background: '#e2b858', color: '#2c1810', border: 'none', borderRadius: 8,
                padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 36,
              }}
            >
              High
            </button>
          </div>
        )}

        {/* Action buttons */}
        {uiPhase === 'action' && !currentPlayer.isAI && !pendingUndo && !jokerPositionPrompt && (
          <div className="space-y-2 mt-2">
            {!currentPlayer.hasLaidDown && (
              <p style={{
                fontSize: 10, color: '#6aad7a', textAlign: 'center',
                margin: '0 0 4px', padding: 0,
              }}>
                Need: {rs.requirement.description}
              </p>
            )}
            {!currentPlayer.hasLaidDown ? (
              /* Pre-lay-down: swap mode UI or [Swap Joker?] [Lay Down] [Discard] */
              <>
                {swapMode ? (
                  <div>
                    <p style={{ color: '#e2b858', fontSize: 11, textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
                      {swapSelectedMeldId
                        ? 'Now tap the matching card in your hand'
                        : 'Tap a glowing joker on the table to swap it'}
                    </p>
                    {layOffError && (
                      <p style={{ color: '#e87070', fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
                        {layOffError}
                      </p>
                    )}
                    <button
                      onClick={() => {
                        setSwapMode(false)
                        setSwapSelectedMeldId(null)
                        setPreSwapMeldId(null)
                        if (preLayDownSwapBaseStateRef.current) {
                          setGameState(preLayDownSwapBaseStateRef.current)
                          preLayDownSwapBaseStateRef.current = null
                        }
                        clearSelection()
                      }}
                      style={{
                        width: '100%', minHeight: 38, borderRadius: 10,
                        border: '1px solid #2d5a3a',
                        background: '#1e4a2e', color: '#6aad7a',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Cancel Swap
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {hasSwappableJokersBeforeLayDown && (
                      <button
                        onClick={() => {
                          const hand = currentPlayer.hand
                          const hasSwappable = gameState.roundState.tablesMelds.some(meld =>
                            meld.type === 'run' && meld.jokerMappings.length > 0 &&
                            hand.some(c => c.suit !== 'joker' && findSwappableJoker(c, meld) !== null)
                          )
                          if (!hasSwappable) {
                            setLayOffError('No swappable jokers — none of your cards match a joker position on the table.')
                            setTimeout(() => setLayOffError(null), 5000)
                            return
                          }
                          setNewCardIds(new Set())
                          setSwapMode(true)
                        }}
                        style={{
                          flex: 1, minHeight: 38, borderRadius: 10,
                          border: '1px solid #e2b858',
                          background: '#1e4a2e', color: '#e2b858',
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Swap Joker
                      </button>
                    )}
                    <button
                      onClick={() => setShowMeldModal(true)}
                      style={{
                        flex: 1, minHeight: 38, borderRadius: 10, border: 'none',
                        background: '#e2b858', color: '#2c1810',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      Lay Down
                    </button>
                    <button
                      onClick={selectedCardIds.size === 1 ? () => { setNewCardIds(new Set()); handleDiscard() } : undefined}
                      disabled={selectedCardIds.size !== 1}
                      style={{
                        flex: 1, minHeight: 38, borderRadius: 10, border: 'none',
                        background: selectedCardIds.size !== 1 ? '#1e4a2e' : 'white',
                        color: selectedCardIds.size !== 1 ? '#3a5a3a' : '#2c1810',
                        fontSize: 13, fontWeight: 600,
                        cursor: selectedCardIds.size !== 1 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Discard
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Post-lay-down: contextual hint + [Discard] or [End Turn] */
              <>
                {/* Contextual hint */}
                <p style={{ color: '#a8d0a8', fontSize: 11, textAlign: 'center', margin: 0 }}>
                  {selectedCardIds.size === 0
                    ? 'Select a card to lay off or discard'
                    : selectedCardIds.size === 1
                      ? 'Tap a glowing meld to lay off, or discard below'
                      : 'Select exactly 1 card'}
                </p>

                {/* Discard error */}
                {discardError && (
                  <p
                    className="text-center text-xs rounded-lg px-3 py-2 border"
                    style={{ color: '#e87070', background: 'rgba(44,24,16,0.6)', borderColor: 'rgba(232,112,112,0.3)' }}
                  >
                    {discardError}
                  </p>
                )}

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
                      background: selectedCardIds.size !== 1 ? '#1e4a2e' : '#e2b858',
                      color: selectedCardIds.size !== 1 ? '#3a5a3a' : '#2c1810',
                      fontSize: 13, fontWeight: 700,
                      cursor: selectedCardIds.size !== 1 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {selectedCardIds.size === 1 ? 'Discard Selected Card' : 'Select a card to discard'}
                  </button>
                )}
              </>
            )}

            {/* Discard error (pre-lay-down) */}
            {!currentPlayer.hasLaidDown && discardError && (
              <p
                className="text-center text-xs rounded-lg px-3 py-2 border"
                style={{ color: '#e87070', background: 'rgba(44,24,16,0.6)', borderColor: 'rgba(232,112,112,0.3)' }}
              >
                {discardError}
              </p>
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

      {/* Pause modal */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="w-full bg-[#0f2218] border-t border-[#2d5a3c] rounded-t-2xl px-4 pt-5 pb-10">
            <h2 className="text-lg font-bold text-white text-center mb-1">Game Paused</h2>
            <p className="text-sm text-[#6aad7a] text-center mb-4">
              {tournamentGameNumber ? `Game ${tournamentGameNumber} of 3 · ` : ''}Round {gameState.currentRound} of {TOTAL_ROUNDS} · {currentPlayer.name}'s turn
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
            {/* Reduce animations toggle */}
            <button
              onClick={() => setReduceAnimations(prev => !prev)}
              className="w-full flex items-center justify-between bg-[#1e4a2e] rounded-xl px-4 py-3 mb-4"
            >
              <span className="text-sm text-[#a8d0a8]">Reduce animations</span>
              <div
                className="w-10 h-6 rounded-full transition-colors flex items-center px-0.5"
                style={{ backgroundColor: reduceAnimations ? '#e2b858' : '#2d5a3a' }}
              >
                <div
                  className="w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: reduceAnimations ? 'translateX(16px)' : 'translateX(0)' }}
                />
              </div>
            </button>
            <div className="space-y-2">
              <button
                onClick={() => setShowPauseModal(false)}
                className="bg-[#e2b858] text-[#2c1810] font-bold rounded-xl w-full py-3 text-sm active:opacity-80"
              >
                Resume Game
              </button>
              {tournamentGameNumber ? (
                <button
                  onClick={() => {
                    setShowPauseModal(false)
                    if (pendingUndo) clearTimeout(pendingUndo.timerId)
                    onExit()
                  }}
                  className="w-full rounded-xl py-3 text-sm font-semibold text-[#f87171] bg-[#1e4a2e] active:opacity-80"
                >
                  Exit Tournament
                </button>
              ) : (
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* Flying card animation overlay */}
      {flyingCard && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            left: flyingCard.from.x - 24,
            top: flyingCard.from.y,
            width: 48,
            height: 68,
            willChange: 'transform',
            animation: `fly-card ${currentPlayer.isAI ? 200 : 500}ms ease-out forwards`,
            '--fly-to-x': `${flyingCard.to.x - flyingCard.from.x}px`,
            '--fly-to-y': `${flyingCard.to.y - flyingCard.from.y}px`,
          } as React.CSSProperties}
        >
          {flyingCard.faceDown ? (
            <div className="w-full h-full rounded-lg bg-[#2d5a3c] border-2 border-[#e2b858]" />
          ) : flyingCard.card ? (
            <div className="w-full h-full rounded-lg overflow-hidden" style={{ backgroundColor: '#fff', border: '1.5px solid #e2ddd2' }}>
              <div className="text-center pt-1 text-xs font-bold" style={{ color: flyingCard.card.suit === 'hearts' || flyingCard.card.suit === 'diamonds' ? '#c0393b' : '#2c1810' }}>
                {flyingCard.card.rank === 0 ? 'JKR' : flyingCard.card.rank === 1 ? 'A' : flyingCard.card.rank === 11 ? 'J' : flyingCard.card.rank === 12 ? 'Q' : flyingCard.card.rank === 13 ? 'K' : flyingCard.card.rank}
              </div>
            </div>
          ) : null}
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
