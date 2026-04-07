import { useState, useEffect, useRef, useMemo } from 'react'
import { createPlayedGame, saveGameEvents, saveAIDecisions, backfillDecisionOutcomes, savePlayerRoundStats, savePlayerGameStats, saveRoundScores } from '../../lib/gameStore'
import type { AIDecision, PlayerRoundStats, PlayerGameStats } from '../../game/types'
import type { GameState, Player, Card as CardType, Meld, PlayerConfig, AIDifficulty, AIPersonality, OpponentHistory } from '../../game/types'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS, cardPoints } from '../../game/rules'
import { createDecks, shuffle, dealHands } from '../../game/deck'
import { buildMeld, isValidSet, canLayOff, findSwappableJoker, isLegalDiscard, evaluateLayOffReversal } from '../../game/meld-validator'
import { scoreRound } from '../../game/scoring'
import { aiFindBestMelds } from '../../game/ai'
import { SUIT_ORDER } from './HandDisplay'
import { haptic } from '../../lib/haptics'
import { playSound } from '../../lib/sounds'
import PrivacyScreen from './PrivacyScreen'
import MeldBuilder, { type MeldBuilderHandle } from './MeldBuilder'
// MeldModal replaced by inline MeldBuilder; LayOffModal removed — lay-offs happen inline via TableMelds
import RoundSummary from './RoundSummary'
import GameOver from './GameOver'
import TableMelds from './TableMelds'
// CardComponent moved to PileArea
import BuyingCinematic, { BuyBottomSheet, FreeTakeBottomSheet, type BuyingPhase } from './BuyingCinematic'
import GameToast, { type QueuedToast } from './GameToast'
import RoundAnnouncement, { type AnnouncementStage } from './RoundAnnouncement'
import { useMultiplayerSync } from '../../hooks/useMultiplayerSync'
// EmoteBubble moved to OpponentStrip
import TopBar from './TopBar'
import PauseMenu from './PauseMenu'
import PileArea from './PileArea'
import ActionBar from './ActionBar'
import OpponentStrip from './OpponentStrip'
import HandArea from './HandArea'
import CinematicOverlays from './CinematicOverlays'
import { loadOpponentModel, saveOpponentModel, updateOpponentModel } from '../../game/opponent-model'
import { useAIAutomation } from '../../hooks/useAIAutomation'
import { useGameAudio } from '../../hooks/useGameAudio'
import { useGameAchievements } from '../../hooks/useGameAchievements'
import { useActionLogger } from '../../hooks/useActionLogger'
import { reportMatchResult, advanceWinner } from '../../lib/tournamentStore'
import { useGameStore, type UIPhase } from '../../stores/gameStore'

interface Props {
  initialPlayers: PlayerConfig[]
  aiDifficulty?: AIDifficulty
  aiPersonality?: AIPersonality
  buyLimit?: number
  onExit: () => void
  onGameComplete?: (players: Player[]) => void
  tournamentGameNumber?: number
  /** When set, game-end auto-reports result to tournament bracket */
  tournamentMatchId?: string
  // Online multiplayer
  mode?: 'local' | 'host'
  roomCode?: string
  hostSeatIndex?: number
  remoteSeatIndices?: number[]
  onReplay?: (gameId: string, playerNames: string[]) => void
}

interface UndoState {
  card: CardType
  preDiscardState: GameState
  discarderIdx: number
  timerId: ReturnType<typeof setTimeout>
}

interface UndoLayOffState {
  card: CardType
  meldId: string
  preLayOffState: GameState
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

/** Shift a hex color slightly warmer/lighter by tension level (0-3) */
function adjustFelt(hex: string, tension: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Each tension level adds a small warm shift: +red, -blue, slight green adjust
  const shift = tension * 2
  return '#' + [
    Math.min(255, r + shift + 1).toString(16).padStart(2, '0'),
    Math.min(255, g - shift + 1).toString(16).padStart(2, '0'),
    Math.max(0, b - shift).toString(16).padStart(2, '0'),
  ].join('')
}

function initGame(configs: PlayerConfig[], buyLimit = 5): GameState {
  const deckCount = configs.length <= 4 ? 2 : 3
  // -1 = unlimited; store as 999 so the game engine's numeric guards work correctly
  const effectiveBuyLimit = buyLimit === -1 ? 999 : buyLimit
  const gameSeed = Math.floor(Math.random() * 2147483647)
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

  const deck = shuffle(createDecks(deckCount), gameSeed)
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
    seed: gameSeed,
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
  const roundSeed = Math.floor(Math.random() * 2147483647)
  const deck = shuffle(createDecks(state.deckCount), roundSeed)
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
    seed: roundSeed,
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

// ─────────────────────────────────────────────────────────────────────────────

export default function GameBoard({ initialPlayers, aiDifficulty: aiDifficultyProp = 'medium', aiPersonality, buyLimit = 5, onExit, onGameComplete, tournamentGameNumber, tournamentMatchId, mode = 'local', roomCode, hostSeatIndex = 0, remoteSeatIndices = [], onReplay }: Props) {
  const aiDifficulty: AIDifficulty = aiDifficultyProp

  // ── Initialize Zustand store synchronously before first render ───────────
  const [_storeInit] = useState(() => {
    useGameStore.getState().reset(initGame(initialPlayers, buyLimit))
    return true
  })

  // ── Read core game state from Zustand store ─────────────────────────────
  const gameState = useGameStore(s => s.gameState)
  const setGameState = useGameStore(s => s.setGameState)
  const uiPhase = useGameStore(s => s.uiPhase)
  const setUiPhase = useGameStore(s => s.setUiPhase)
  const gameSpeed = useGameStore(s => s.gameSpeed)
  const setGameSpeed = useGameStore(s => s.setGameSpeed)
  const buyingPhase = useGameStore(s => s.buyingPhase)
  const setBuyingPhase = useGameStore(s => s.setBuyingPhase)
  const buyerOrder = useGameStore(s => s.buyerOrder)
  const buyerStep = useGameStore(s => s.buyerStep)
  const buyingPassedPlayers = useGameStore(s => s.buyingPassedPlayers)
  const setBuyingPassedPlayers = useGameStore(s => s.setBuyingPassedPlayers)
  const buyingSnatcherName = useGameStore(s => s.buyingSnatcherName)
  const setBuyingSnatcherName = useGameStore(s => s.setBuyingSnatcherName)
  const buyingDiscard = useGameStore(s => s.buyingDiscard)
  const pendingBuyDiscard = useGameStore(s => s.pendingBuyDiscard)
  const setPendingBuyDiscard = useGameStore(s => s.setPendingBuyDiscard)
  const freeOfferDeclined = useGameStore(s => s.freeOfferDeclined)
  const setFreeOfferDeclined = useGameStore(s => s.setFreeOfferDeclined)
  const roundResults = useGameStore(s => s.roundResults)
  const setRoundResults = useGameStore(s => s.setRoundResults)
  const goingOutSequence = useGameStore(s => s.goingOutSequence)
  const setGoingOutSequence = useGameStore(s => s.setGoingOutSequence)
  const goOutPlayerName = useGameStore(s => s.goOutPlayerName)
  const setGoOutPlayerName = useGameStore(s => s.setGoOutPlayerName)

  const { gameLogId, log: logActionHook, getLog: getActionLog } = useActionLogger(
    { round: 1, seed: gameState.seed, deckCount: gameState.deckCount, playerCount: gameState.players.length }
  )
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const selectedCardOrderRef = useRef<string[]>([])
  const [handSort, setHandSort] = useState<'rank' | 'suit'>('rank')
  const [showMeldModal, setShowMeldModal] = useState(false)
  const [meldAssignedIds, setMeldAssignedIds] = useState<Set<string>>(new Set())
  const meldBuilderRef = useRef<MeldBuilderHandle>(null)
  const [jokerPositionPrompt, setJokerPositionPrompt] = useState<{ card: CardType; meld: Meld } | null>(null)
  const [pendingUndo, setPendingUndo] = useState<UndoState | null>(null)
  const discardPendingRef = useRef(false) // synchronous guard — mirrors pendingUndo for instant blocking
  const [pendingLayOffUndo, setPendingLayOffUndo] = useState<UndoLayOffState | null>(null)
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [reshuffleMsg, setReshuffleMsg] = useState(false)
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set())
  const [leavingCardId, setLeavingCardId] = useState<string | null>(null)
  const [dealFlipPhase, setDealFlipPhase] = useState<'facedown' | 'flipping' | null>(null)
  const [buyLog, setBuyLog] = useState<BuyLogEntry[]>([])
  const [gameId, setGameId] = useState<string | null>(null)
  const [playerMap, setPlayerMap] = useState<Record<string, string>>({})
  // Ref for beforeunload: always holds latest save-worthy state
  const unloadSaveRef = useRef<{ gameId: string; players: { name: string; roundScores: number[] }[]; isFinal: boolean } | null>(null)
  const buyingPhaseRef = useRef<BuyingPhase>('hidden')
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
  const [lastDrawnCardId, setLastDrawnCardId] = useState<string | null>(null)
  const [discardAnimating, setDiscardAnimating] = useState(false)
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
  // Stalemate UX: two-phase detection
  const [stalematePhase, setStalematePhase] = useState<'none' | 'nudge' | 'prompt'>('none')
  const stalemateSnoozeRef = useRef(0)  // turns remaining before re-prompting after "Keep Playing"
  // Opponent history: tracks picked/discarded cards per player per round (Hard AI awareness)
  const opponentHistoryRef = useRef<Map<string, OpponentHistory>>(new Map())
  // Hard AI going-down timing: how many turns this AI could have gone down but chose to wait
  const aiTurnsCouldGoDownRef = useRef<Map<string, number>>(new Map())
  // Panic mode: total turns elapsed per AI player per round (resets each round)
  const aiTurnsElapsedRef = useRef<Map<string, number>>(new Map())
  const { checkAndShow: checkAndShowAchievementsHook, unlockInline: unlockAchievement, setToastFn: setAchievementToastFn } = useGameAchievements(initialPlayers)
  const [yourTurnPulse, setYourTurnPulse] = useState(false)
  const [perfectDrawActive, setPerfectDrawActive] = useState(false)
  const perfectDrawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const { sfxVol, notifVol, updateSfxVol, updateNotifVol } = useGameAudio()
  const drawPileRef = useRef<HTMLDivElement>(null)
  const handAreaRef = useRef<HTMLDivElement>(null)
  const discardPileRef = useRef<HTMLDivElement>(null)
  const [justLaidOffCardIds, setJustLaidOffCardIds] = useState<Set<string>>(new Set())
  // Fix C: discard unwanted dim (all buyers passed)
  const [discardUnwanted, setDiscardUnwanted] = useState(false)
  // Fix D: joker swap meld flash
  const [flashMeldId, setFlashMeldId] = useState<string | null>(null)
  const [flashIsHeist, setFlashIsHeist] = useState(false)
  // Joker swap "The Exchange" cinematic overlay
  const [swapAnim, setSwapAnim] = useState<{ natural: CardType; joker: CardType; isHeist: boolean } | null>(null)
  const [raceMessage, setRaceMessage] = useState('')

  // ── Remote event notifications (host → remote players) ────────────────────
  const [remoteEvent, setRemoteEvent] = useState<string | null>(null)
  const [remoteToast, setRemoteToast] = useState<{ message: string; style: string; icon?: string } | null>(null)

  // ── Round-end transition states ───────────────────────────────────────────
  const [showDarkBeat, setShowDarkBeat] = useState(false)
  const [roundSummaryExiting, setRoundSummaryExiting] = useState(false)
  const [showBreathingRoom, setShowBreathingRoom] = useState(false)
  const [showGameOverText, setShowGameOverText] = useState(false)

  // ── Cinematic round announcement ──────────────────────────────────────────
  const [announcementStage, setAnnouncementStage] = useState<AnnouncementStage | null>(null)
  const [showDealAnimation, setShowDealAnimation] = useState(false)
  const previousLeaderRef = useRef<string | null>(null)
  const countdownActiveRef = useRef(false)
  const previousStandingsPctRef = useRef<Map<string, number>>(new Map())

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
  const drawInProgressRef = useRef(false)
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
  useEffect(() => {
    uiPhaseRef.current = uiPhase
    if (uiPhase !== 'draw') drawInProgressRef.current = false
  }, [uiPhase])
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
  useEffect(() => { buyingPhaseRef.current = buyingPhase }, [buyingPhase])

  // ── Flush pending saves on tab close / refresh ────────────────────────────
  useEffect(() => {
    const handleUnload = () => {
      const pending = unloadSaveRef.current
      if (!pending) return
      // navigator.sendBeacon isn't available for Supabase, so use
      // a synchronous-ish fetch via keepalive to maximise delivery odds.
      // This is best-effort — the incremental save already ran, so this
      // only matters if it was still in-flight when the tab closed.
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/games?id=eq.${pending.gameId}`
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY
      try {
        fetch(url, {
          method: 'PATCH',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ is_complete: pending.isFinal }),
          keepalive: true,
        })
      } catch { /* best effort */ }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

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

  // Your Turn pulse on hand area border
  useEffect(() => {
    const player = gameState.players[gameState.roundState.currentPlayerIndex]
    if (uiPhase === 'draw' && player && !player.isAI) {
      setYourTurnPulse(true)
      const timer = setTimeout(() => setYourTurnPulse(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [uiPhase, gameState.roundState.currentPlayerIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive reshuffle: if draw phase starts with an empty draw pile, reshuffle
  // discards into a new draw pile BEFORE the player sees the board.
  useEffect(() => {
    if (uiPhase !== 'draw') return
    const rs = gameState.roundState
    if (rs.drawPile.length > 0) return

    setGameState(prev => {
      if (prev.roundState.drawPile.length > 0) return prev // already reshuffled
      const discardPile = [...prev.roundState.discardPile]
      const topDiscard = discardPile.pop()
      let newDrawPile = shuffle([...discardPile])
      // If both piles are nearly empty, add a fresh deck (GDD §9 fallback)
      if (newDrawPile.length === 0) {
        newDrawPile = shuffle(createDecks(1))
      }
      return {
        ...prev,
        roundState: {
          ...prev.roundState,
          drawPile: newDrawPile,
          discardPile: topDiscard ? [topDiscard] : [],
        },
      }
    })
    setReshuffleMsg(true)
    playSound('card-shuffle')
    setTimeout(() => setReshuffleMsg(false), 2500)
  }, [uiPhase, gameState.roundState.currentPlayerIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Override: skip privacy screen for solo-human games
  // eslint-disable-next-line no-inner-declarations
  function nextPhaseForPlayer(player: Player): UIPhase {
    if (player.isAI) return 'draw'
    // In host mode, remote human players don't need privacy screens
    if (mode === 'host') {
      const playerIdx = gameState.players.findIndex(p => p.id === player.id)
      if (playerIdx !== hostSeatIndex) return 'draw'
    }
    return soloHuman ? 'draw' : 'privacy'
  }

  // ── Online multiplayer: host broadcast, actions, heartbeat, emotes ────────
  const { mpChannel, activeEmotes, handleEmoteSend } = useMultiplayerSync({
    mode, roomCode, hostSeatIndex, remoteSeatIndices,
    gameStateRef, uiPhaseRef, buyingPhaseRef, buyerOrderRef, buyerStepRef, pendingBuyDiscardRef,
    gameState, uiPhase, buyingPhase, buyerStep, buyerOrder, buyingPassedPlayers, buyingSnatcherName,
    roundResults, goingOutSequence, goOutPlayerName, announcementStage,
    remoteEvent, remoteToast, raceMessage, shimmerCardId, perfectDrawActive,
    handlers: {
      handleDrawFromPile, handleTakeDiscard, handleDeclineFreeOffer,
      handleMeldConfirm, handleLayOff, handleJokerSwap, handleDiscard, handleBuyDecision,
    },
    setRemoteEvent, setRemoteToast,
    buyLimit, buyingDiscard, streaksRef,
  })

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
    const gameType = mode === 'host' ? 'online' : initialPlayers.some(p => p.isAI) ? 'ai' : 'pass-and-play'
    const effectiveBuyLimit = buyLimit === -1 ? 999 : buyLimit
    createPlayedGame(playerNames, date, gameType, effectiveBuyLimit)
      .then(({ gameId: id, playerMap: pm }) => { setGameId(id); setPlayerMap(pm) })
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

  // Reset declined flag whenever a new free offer arrives + show cinematic for human
  useEffect(() => {
    if (pendingBuyDiscard !== null) {
      setFreeOfferDeclined(false)
      const state = gameStateRef.current
      const nextPlayer = getCurrentPlayer(state)
      if (!nextPlayer.isAI) {
        setBuyingPassedPlayers([])
        setBuyingSnatcherName(undefined)
        setBuyingPhase('free-offer')
      }
    } else {
      // Clear cinematic if pendingBuyDiscard is cleared (undo, etc.)
      if (buyingPhaseRef.current === 'free-offer') setBuyingPhase('hidden')
    }
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

  // Wire achievement toasts to the queue
  setAchievementToastFn(queueToast)

  function checkAndShowAchievements(isGameEnd: boolean) {
    checkAndShowAchievementsHook(gameStateRef, roundResults, isGameEnd)
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
    // If in meld-building mode, route taps to MeldBuilder
    if (showMeldModal && meldBuilderRef.current) {
      const card = currentPlayer.hand.find(c => c.id === cardId)
      if (card && !meldAssignedIds.has(card.id)) {
        meldBuilderRef.current.handleCardTap(card)
      }
      return
    }
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

  // ── Cinematic buy/pass wrappers for human players ────────────────────────
  function handleCinematicFreeOfferAccept() {
    setBuyingPhase('hidden')
    handleTakeDiscard()
  }
  function handleCinematicFreeOfferDecline() {
    setBuyingPhase('hidden')
    handleDeclineFreeOffer()
  }
  function handleCinematicBuy() {
    const buyer = activeBuyerForCinematic()
    setBuyingSnatcherName(buyer?.name)
    setBuyingPhase('snatched')
    setTimeout(() => {
      setBuyingPhase('hidden')
      handleBuyDecision(true)
    }, 800)
  }
  function handleCinematicPass() {
    setBuyingPhase('ai-deciding') // may transition to next human or unclaimed
    handleBuyDecision(false)
  }
  function activeBuyerForCinematic() {
    const idx = buyerOrder[buyerStep]
    return idx !== undefined ? gameState.players[idx] : null
  }

  // ── Perfect Draw detection helper ────────────────────────────────────────
  function triggerPerfectDraw() {
    setPerfectDrawActive(true)
    haptic('success')
    if (perfectDrawTimerRef.current) clearTimeout(perfectDrawTimerRef.current)
    perfectDrawTimerRef.current = setTimeout(() => setPerfectDrawActive(false), 5000)
  }

  function checkPerfectDraw(handBefore: CardType[], drawnCard: CardType, isAI: boolean) {
    if (isAI) return
    const requirement = gameState.roundState.requirement
    const couldMeldBefore = aiFindBestMelds(handBefore, requirement) !== null
    if (couldMeldBefore) return
    const handAfter = [...handBefore, drawnCard]
    const couldMeldAfter = aiFindBestMelds(handAfter, requirement) !== null
    if (couldMeldAfter) triggerPerfectDraw()
  }

  // ── Draw from pile (with reshuffle if empty) ──────────────────────────────
  function handleDrawFromPile() {
    // Guard against rapid double-taps: only allow drawing during the draw phase
    if (uiPhaseRef.current !== 'draw') return
    if (drawInProgressRef.current) return
    drawInProgressRef.current = true
    uiPhaseRef.current = 'action' // synchronous — blocks any concurrent draw before React commits

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
      // If both piles are nearly empty, add a fresh deck (GDD §9 fallback)
      if (drawPileSnapshot.length === 0) {
        drawPileSnapshot = shuffle(createDecks(1))
      }
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
      playSound('card-draw')
      logActionHook(gameState.roundState.currentPlayerIndex, 'draw_pile')

      // Perfect Draw detection: did this card unlock the round requirement?
      const handBefore = gameState.players[gameState.roundState.currentPlayerIndex].hand
      checkPerfectDraw(handBefore, drawnCard, !!gameState.players[gameState.roundState.currentPlayerIndex]?.isAI)
    }

    if (drawnCard) {
      const isAI = !!gameState.players[gameState.roundState.currentPlayerIndex]?.isAI
      // Flying card animation: draw pile → hand
      animateDrawFromPile(isAI)
      // Delay NEW badge until after the flying animation lands
      const animDuration = reduceAnimations ? 0 : (isAI ? 200 : 500)
      setTimeout(() => {
        setNewCardIds(new Set([drawnCard.id]))
        // Draw-slide animation on the newly drawn card
        if (!isAI) {
          setLastDrawnCardId(drawnCard.id)
          setTimeout(() => setLastDrawnCardId(null), 500)
        }
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
      playSound('card-shuffle')
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
    // Guard against rapid double-taps: only allow taking during the draw phase
    if (uiPhaseRef.current !== 'draw') return
    if (drawInProgressRef.current) return
    drawInProgressRef.current = true
    uiPhaseRef.current = 'action' // synchronous — blocks any concurrent draw before React commits

    const card = gameState.roundState.discardPile[gameState.roundState.discardPile.length - 1]
    if (!card) { drawInProgressRef.current = false; uiPhaseRef.current = 'draw'; return }
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
    setLeavingCardId(null) // clear any in-progress exit animation — the taken card may be
                           // the same card that was just discarded (animateDiscard sets this
                           // with a 300ms timeout). Without clearing, HandDisplay applies
                           // animate-card-exit to the card in the new hand → invisible.

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

    // Perfect Draw detection: did taking this discard unlock the round requirement?
    checkPerfectDraw(taker.hand, card, !!taker.isAI)

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
    playSound('card-snap')
    logActionHook(gameState.roundState.currentPlayerIndex, 'take_discard', { cardId: card.id, suit: card.suit, rank: card.rank })
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
      // Atomic: sets buyerOrder, buyerStep, buyingDiscard, buyingPassedPlayers, buyingSnatcherName, buyingPhase
      useGameStore.getState().startBuyingWindow(order, discardCard)
      setTimeout(() => {
        setBuyingPhase(prev => prev === 'reveal' ? 'ai-deciding' : prev)
        setUiPhase('buying')
      }, 500)
    }
  }

  // ── Going-out cinematic ──────────────────────────────────────────────────
  function triggerGoingOut(playerName: string, stateToEnd: GameState) {
    playSound('going-out')
    logActionHook(stateToEnd.players.findIndex(p => p.name === playerName), 'going_out')
    setGoOutPlayerName(playerName)
    setGoingOutSequence('flash')
    haptic('success')
    setTimeout(() => setGoingOutSequence('announce'), 400)
    setTimeout(() => {
      setGoingOutSequence('idle')
      endRound(stateToEnd)
    }, 2500)
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
    logActionHook(-1, 'round_end', { round: state.currentRound })
    setShowDarkBeat(true)
    setTimeout(() => {
      setShowDarkBeat(false)
      setUiPhase('round-end')
    }, 500)
    flushTelemetry(buyLog) // fire-and-forget — telemetry must never block game flow

    // Incremental save: persist round scores to Supabase after every round.
    // On the final round, also mark the game as complete so the DB is
    // always up-to-date even if the user closes the app before GameOver.
    if (gameId) {
      const isFinal = state.currentRound >= TOTAL_ROUNDS
      const playerData = players.map(p => ({ name: p.name, roundScores: p.roundScores }))
      void saveRoundScores(gameId, playerData, isFinal, playerMap)
      // Keep unload ref current so beforeunload can flush if needed
      unloadSaveRef.current = { gameId, players: playerData, isFinal }
    }

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

    // Check achievements at round end
    setTimeout(() => checkAndShowAchievements(false), 600)
  }

  // ── Stalemate detection (phased UX) ──────────────────────────────────────
  // Called after every discard/stuck-turn. Updates stalemate phase based on no-progress turns.
  function checkStalemateProgress() {
    const totalPlayers = gameState.players.length
    const downCount = gameState.players.filter(p => p.hasLaidDown).length
    const allDown = downCount === totalPlayers
    const mostDown = downCount >= Math.ceil(totalPlayers * 0.75)
    const noProgress = noProgressTurnsRef.current
    const reshuffles = drawPileDepletionsRef.current

    // Decrement snooze counter
    if (stalemateSnoozeRef.current > 0) {
      stalemateSnoozeRef.current -= 1
      return  // snoozed — don't check
    }

    // Phase 1 → nudge: most players down, 1+ reshuffle, 2 full cycles no progress
    if (mostDown && reshuffles >= 1 && noProgress >= totalPlayers * 2 && stalematePhase === 'none') {
      setStalematePhase('nudge')
      return
    }

    // Phase 2 → prompt: nudge already shown, 1 more full cycle with no progress
    if (stalematePhase === 'nudge' && noProgress >= totalPlayers * 3) {
      setStalematePhase('prompt')
      return
    }

    // Auto-end for all-AI stalemate: all players are AI (or all non-AI have laid down and are cycling)
    // and prompt conditions are met — don't make human watch
    const allAI = gameState.players.every(p => p.isAI)
    if (allAI && allDown && reshuffles >= 1 && noProgress >= totalPlayers * 4) {
      forceEndRound(gameState)
    }
  }

  function handleKeepPlaying() {
    setStalematePhase('none')
    // Snooze for 2 full cycles before re-checking
    stalemateSnoozeRef.current = gameState.players.length * 2
  }

  function handleEndRoundStalemate() {
    setStalematePhase('none')
    forceEndRound(gameState)
  }

  // ── Force end round (stalemate) ───────────────────────────────────────────
  function forceEndRound(state: GameState) {
    noProgressTurnsRef.current = 0
    drawPileDepletionsRef.current = 0
    setStalematePhase('none')
    stalemateSnoozeRef.current = 0
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

    // Check achievements at round end (stalemate path)
    setTimeout(() => checkAndShowAchievements(false), 600)
  }

  // ── Meld confirmation ─────────────────────────────────────────────────────
  function handleMeldConfirm(meldGroups: CardType[][], jokerPositions?: Map<string, number>) {
    // Guard against rapid double-taps: only allow melding during the action phase
    if (uiPhaseRef.current !== 'action') return
    // Block melds during the discard undo window — turn is over once you discard
    if (discardPendingRef.current) return
    const prev = gameState
    let counter = prev.roundState.meldIdCounter
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]

    const meldedIds = new Set(meldGroups.flatMap(g => g.map(c => c.id)))
    const requirement = prev.roundState.requirement
    const newMelds: Meld[] = meldGroups.map(cards => {
      // Respect round type: on run-only rounds, never classify as set (and vice versa).
      // A meld like [5♥, Joker, Joker, Joker] passes both isValidSet and isValidRun —
      // without this guard it would become a set on a run-only round, allowing illegal lay-offs.
      let type: 'set' | 'run'
      if (requirement.sets === 0) type = 'run'        // runs-only round: must be a run
      else if (requirement.runs === 0) type = 'set'   // sets-only round: must be a set
      else type = isValidSet(cards) ? 'set' : 'run'   // mixed round: prefer set classification
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
    tc.meldsLaidDown += newMelds.length
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
    // Broadcast event to remote players
    setRemoteEvent(`${player.name} went down!`)
    if (isFirstDown && !wentOut) {
      setRemoteToast({ message: `${player.name} leads the way!`, style: 'celebration', icon: '💪' })
    }
    setGameState(updated)
    setShowMeldModal(false)
    setMeldAssignedIds(new Set())
    setPreLayDownSwap(false)
    clearSelection() // always reset selection after meld
    haptic(wentOut ? 'success' : 'heavy')
    playSound('meld-slam')
    logActionHook(gameState.roundState.currentPlayerIndex, 'meld_confirm')

    if (wentOut) {
      // Round ends immediately — no buying window, no further actions
      useGameStore.getState().cancelBuyingOnGoOut()
      pendingBuyDiscardRef.current = null
      freeOfferDeclinedRef.current = false
      if (pendingUndo) {
        clearTimeout(pendingUndo.timerId)
        setPendingUndo(null)
      }
      triggerGoingOut(player.name, updated)
    }
  }

  // ── Lay off ───────────────────────────────────────────────────────────────
  function handleLayOff(card: CardType, meld: Meld, jokerPosition?: 'low' | 'high') {
    // Bug fix: prevent lay-offs after discarding — turn is over once you discard
    // Use ref for synchronous blocking (React state pendingUndo may lag behind)
    if (discardPendingRef.current) return
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
            playSound('error-buzz')
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
            playSound('error-buzz')
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
    playSound('lay-off')
    logActionHook(gameState.roundState.currentPlayerIndex, 'lay_off', { cardId: card.id, meldId: meld.id })

    // Undo window for human lay-offs (not going out, not AI)
    if (!wentOut && !player.isAI) {
      // Clear any previous lay-off undo
      if (pendingLayOffUndo) clearTimeout(pendingLayOffUndo.timerId)
      const timerId = setTimeout(() => setPendingLayOffUndo(null), 3000)
      setPendingLayOffUndo({ card, meldId: meld.id, preLayOffState: prev, timerId })
    }

    // Trigger card-join animation for the laid-off card
    setJustLaidOffCardIds(new Set([card.id]))
    setTimeout(() => setJustLaidOffCardIds(new Set()), 500)

    // Moment 2: going out via lay-off
    if (wentOut) {
      addBuyLog({ round: prev.currentRound, turn: turnCountRef.current, event: 'went_out', playerName: player.name, card: '', detail: 'hand was empty' })
      setJokerPositionPrompt(null)
      // Round ends immediately — no buying window, no further actions
      useGameStore.getState().cancelBuyingOnGoOut()
      pendingBuyDiscardRef.current = null
      freeOfferDeclinedRef.current = false
      triggerGoingOut(player.name, updated)
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
    playSound('joker-swap')
    logActionHook(gameState.roundState.currentPlayerIndex, 'joker_swap', { cardId: naturalCard.id, meldId: meld.id })
    // Broadcast event to remote players
    setRemoteEvent(`${swapPlayer.name} swapped a joker!`)
    setRemoteToast({ message: isFromOtherMeld ? 'The heist!' : 'Joker reclaimed!', style: 'taunt', icon: '🃏' })
    // Capture the joker card before the state update removes it from the meld
    const jokerCard = findSwappableJoker(naturalCard, meld)
    if (jokerCard && !reduceAnimations) {
      setSwapAnim({ natural: naturalCard, joker: jokerCard, isHeist: isFromOtherMeld })
      setTimeout(() => setSwapAnim(null), 900)
    }
    setGameState(prev => computeJokerSwap(prev, naturalCard, meld) ?? prev)
    clearSelection()
    // Achievement: The Heist (joker swap by human)
    if (!swapPlayer.isAI) unlockAchievement(swapPlayer.name, 'the-heist')
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
    // Bug fix: prevent lay-offs after discarding — turn is over once you discard
    // Use ref for synchronous blocking (React state pendingUndo may lag behind)
    if (discardPendingRef.current) return
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
    // Guard against rapid double-taps: only allow discarding during the action phase
    if (uiPhaseRef.current !== 'action') return
    clearLayOffUndo()  // commit any pending lay-off
    const cardId = overrideCardId ?? [...selectedCardIds][0]
    if (!cardId) return

    const playerIdx = rs.currentPlayerIndex
    const player = gameState.players[playerIdx]
    const card = player.hand.find(c => c.id === cardId)
    if (!card) return

    // Track who discarded so they can't buy their own card back
    lastDiscarderIdxRef.current = playerIdx

    const newHand = player.hand.filter(c => c.id !== cardId)

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
    // Discard toss animation on the discard pile
    setDiscardAnimating(true)
    setTimeout(() => setDiscardAnimating(false), 500)

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
    playSound('card-snap')
    logActionHook(playerIdx, 'discard', { cardId: card.id, suit: card.suit, rank: card.rank, cardLabel: formatCard(card) })

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

    // Increment no-progress counter (any discard without a prior lay-off is "no progress")
    noProgressTurnsRef.current += 1
    checkStalemateProgress()

    function afterUndoExpires() {
      discardPendingRef.current = false
      setPendingUndo(null)
      // Rule 9A: advance to next player who gets first right to take the discard
      const advanced = advancePlayer(afterDiscard)
      const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
      setPendingBuyDiscard(card!)
      setGameState(advanced)
      setUiPhase(nextPhaseForPlayer(nextPlayer))
    }

    // Skip undo delay for AI and remote players (they have no undo UI)
    const isRemotePlayer = mode === 'host' && remoteSeatIndices.includes(playerIdx)
    if (!player.isAI && !isRemotePlayer) {
      discardPendingRef.current = true // synchronous — blocks lay-offs/melds immediately
      const timerId = setTimeout(afterUndoExpires, 3000)
      setPendingUndo({ card, preDiscardState, discarderIdx: playerIdx, timerId })
    } else {
      afterUndoExpires()
    }
  }

  function handleUndoDiscard() {
    if (!pendingUndo) return
    clearTimeout(pendingUndo.timerId)
    discardPendingRef.current = false
    setGameState(pendingUndo.preDiscardState)
    setPendingUndo(null)
    // Stay in 'action' phase
  }

  function handleUndoLayOff() {
    if (!pendingLayOffUndo) return
    clearTimeout(pendingLayOffUndo.timerId)
    setGameState(pendingLayOffUndo.preLayOffState)
    setPendingLayOffUndo(null)
    haptic('tap')
    // Stay in 'action' phase
  }

  function clearLayOffUndo() {
    if (pendingLayOffUndo) {
      clearTimeout(pendingLayOffUndo.timerId)
      setPendingLayOffUndo(null)
    }
  }

  // ── End turn without discarding (stuck with 1 unplayable card) ──────────
  function handleEndTurnStuck() {
    noProgressTurnsRef.current += 1
    haptic('tap')
    checkStalemateProgress()
    const advanced = advancePlayer(gameState)
    const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
    setGameState(advanced)
    setUiPhase(nextPhaseForPlayer(nextPlayer))
  }

  // ── Buy decision ──────────────────────────────────────────────────────────
  function handleBuyDecision(wantsToBuy: boolean) {
    // Guard against rapid double-taps: only allow buy decisions during the buying phase
    if (uiPhaseRef.current !== 'buying') return
    const isPostDraw = buyingIsPostDrawRef.current

    if (wantsToBuy) {
      const buyerIdx = buyerOrder[buyerStep]
      const buyer = gameState.players[buyerIdx]
      if (!buyingDiscard || buyer.buysRemaining <= 0) return
      playSound('buy-ding')
      logActionHook(buyerIdx, 'buy', { wantsToBuy: true })
      setLeavingCardId(null) // clear any in-progress exit animation for the discarded card

      let drawPile = [...gameState.roundState.drawPile]
      let discardPile = gameState.roundState.discardPile.slice(0, -1)

      // Reshuffle if draw pile is empty before taking penalty card
      if (drawPile.length === 0) {
        if (discardPile.length > 0) {
          drawPile = shuffle([...discardPile])
          discardPile = []
        }
        // If both piles are nearly empty, add a fresh deck (GDD §9 fallback)
        if (drawPile.length === 0) {
          drawPile = shuffle(createDecks(1))
        }
      }

      const penaltyCard = drawPile.shift()
      const newHand = [...buyer.hand, buyingDiscard, ...(penaltyCard ? [penaltyCard] : [])]

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

      // Achievement: Buyer's Market (first buy by human)
      if (!buyer.isAI) unlockAchievement(buyer.name, 'buyers-market')

      addBuyLog({
        turn: turnCountRef.current,
        round: gameState.currentRound,
        event: 'bought',
        playerName: buyer.name,
        card: buyingDiscard ? formatCard(buyingDiscard) : '?',
        detail: `buys after: ${buyer.buysRemaining - 1}/${gameState.buyLimit >= 999 ? '∞' : gameState.buyLimit}`,
      })

      // Broadcast event to remote players
      setRemoteEvent(`${buyer.name} bought ${buyingDiscard ? formatCard(buyingDiscard) : 'a card'}!`)

      if (isPostDraw) {
        // Post-draw buy: buyer stays as display player, so NEW badge works here.
        // Delay badge until after buy animation lands (same pattern as normal draw).
        const buyNewIds = new Set<string>()
        if (buyingDiscard) buyNewIds.add(buyingDiscard.id)
        if (penaltyCard) buyNewIds.add(penaltyCard.id)
        const animDuration = reduceAnimations ? 0 : (buyer.isAI ? 400 : 1000)
        if (buyNewIds.size > 0) setTimeout(() => setNewCardIds(buyNewIds), animDuration)

        buyingIsPostDrawRef.current = false
        useGameStore.getState().completeBuyingRound()
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

      logActionHook(passerIdx ?? -1, 'buy', { wantsToBuy: false })
      addBuyLog({
        turn: turnCountRef.current,
        round: gameState.currentRound,
        event: 'passed',
        playerName: passerName,
        card: buyingDiscard ? formatCard(buyingDiscard) : '?',
      })
      if (nextStep < buyerOrder.length) {
        useGameStore.getState().advanceBuyerStep()
      } else {
        // All buyers passed — show unclaimed cinematic, then resume
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

        // Show unclaimed cinematic for 900ms before resuming
        setBuyingPhase('unclaimed')
        setTimeout(() => {
          useGameStore.getState().completeBuyingRound()
          if (isPostDraw) {
            buyingIsPostDrawRef.current = false
            if (gameStateRef.current.roundState.goOutPlayerId !== null) {
              endRound(gameStateRef.current)
            } else {
              setUiPhase('action')
            }
          } else {
            const advanced = advancePlayer(gameStateRef.current)
            if (gameStateRef.current.roundState.goOutPlayerId !== null) {
              endRound(advanced)
            } else {
              const nextPlayer = advanced.players[advanced.roundState.currentPlayerIndex]
              setGameState(advanced)
              setUiPhase(nextPhaseForPlayer(nextPlayer))
            }
          }
        }, 900)
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
    setStalematePhase('none')
    stalemateSnoozeRef.current = 0
    aiLayOffCountRef.current = 0
    opponentHistoryRef.current = new Map()
    aiTurnsCouldGoDownRef.current = new Map()
    aiTurnsElapsedRef.current = new Map()
    resetRoundTelemetry()
    const date = new Date().toISOString().split('T')[0]
    const playerNames = initialPlayers.map(p => p.name)
    const gameType = mode === 'host' ? 'online' : initialPlayers.some(p => p.isAI) ? 'ai' : 'pass-and-play'
    const effectiveBuyLimit = buyLimit === -1 ? 999 : buyLimit
    try {
      const result = await createPlayedGame(playerNames, date, gameType, effectiveBuyLimit)
      setGameId(result.gameId)
      setPlayerMap(result.playerMap)
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
    // Guard against rapid double-taps
    if (uiPhaseRef.current !== 'round-end') return
    setRoundSummaryExiting(true)
    setTimeout(() => {
      setRoundSummaryExiting(false)
      noProgressTurnsRef.current = 0
      drawPileDepletionsRef.current = 0
      setStalematePhase('none')
      stalemateSnoozeRef.current = 0
      opponentHistoryRef.current = new Map()
      aiTurnsCouldGoDownRef.current = new Map()
      aiTurnsElapsedRef.current = new Map()
      const nextRound = gameState.currentRound + 1
      if (nextRound > TOTAL_ROUNDS) {
        setGameState(prev => ({ ...prev, gameOver: true }))
        // Telemetry: save game-level stats
        if (gameId) computeAndSaveGameStats(gameId, gameState.players)
        // Update opponent models for The Nemesis AI — load action log and learn patterns
        gameState.players.forEach((player, idx) => {
          if (player.isAI) return
          // Delay to let fire-and-forget log writes flush to Supabase
          setTimeout(() => {
          getActionLog().then(log => {
            try {
              updateOpponentModel(player.name, idx, log, gameState.currentRound)
            } catch { /* silent */ }
          }).catch(() => {
            // Fallback: basic increment if log load fails
            try {
              const model = loadOpponentModel(player.name)
              if (model) {
                model.gamesAnalyzed++
                model.updatedAt = Date.now()
                saveOpponentModel(model)
              } else {
                saveOpponentModel({
                  playerName: player.name, gamesAnalyzed: 1,
                  suitBias: { hearts: 0.25, diamonds: 0.25, clubs: 0.25, spades: 0.25 },
                  avgBuyRate: 0.5, avgGoDownRound: 3,
                  discardPatterns: {}, takePatterns: {},
                  updatedAt: Date.now(),
                })
              }
            } catch { /* silent */ }
          })
          }, 3000) // 3 second delay for writes to flush
        })
        // Check achievements at game end
        setTimeout(() => checkAndShowAchievements(true), 200)
        // Tournament bracket result reporting
        if (tournamentMatchId) {
          const sorted = [...gameState.players].sort((a, b) =>
            a.roundScores.reduce((s, n) => s + n, 0) - b.roundScores.reduce((s, n) => s + n, 0)
          )
          const winnerName = sorted[0].name
          ;(async () => {
            try {
              await reportMatchResult(tournamentMatchId, winnerName)
              // Fetch match details to advance winner to next round
              const { data: matchData } = await (await import('../../lib/supabase')).supabase
                .from('tournament_matches')
                .select('*')
                .eq('id', tournamentMatchId)
                .single()
              if (matchData) {
                await advanceWinner(
                  matchData.tournament_id,
                  matchData.round_number,
                  matchData.match_index,
                  winnerName,
                )
              }
            } catch { /* fire-and-forget */ }
          })()
        }
        // Tournament callback — let PlayTab handle the game-over flow
        if (onGameComplete) onGameComplete(gameState.players)
        setShowDarkBeat(true)
        setTimeout(() => {
          setShowDarkBeat(false)
          setShowGameOverText(true)
          setTimeout(() => {
            setShowGameOverText(false)
            setUiPhase('game-over')
          }, 1500)
        }, 800)
      } else {
        // Capture current standings percentages before the new round resets scores
        const currentTotals = gameState.players.map(p => ({
          name: p.name,
          total: p.roundScores.reduce((s, n) => s + n, 0),
        }))
        const maxTotal = Math.max(...currentTotals.map(t => t.total), 1)
        const newPctMap = new Map<string, number>()
        currentTotals.forEach(t => newPctMap.set(t.name, maxTotal > 0 ? (t.total / maxTotal) * 100 : 0))
        previousStandingsPctRef.current = newPctMap

        const next = setupRound(gameState, nextRound)
        setGameState(next)
        logActionHook(-1, 'round_start', { round: nextRound, seed: next.seed, deckCount: next.deckCount, playerCount: next.players.length })
        setRoundResults(null)
        clearSelection()
        setPendingBuyDiscard(null)
        setShowBreathingRoom(true)
        setTimeout(() => {
          setShowBreathingRoom(false)
          setUiPhase('round-start')
        }, 500)
      }
    }, 300)
  }

  // ── AI automation hook (draw/action/buying phases, personality & eval config) ──
  const { aiLayOffCountRef } = useAIAutomation({
    initialPlayers,
    aiDifficultyProp,
    aiPersonality,
    gameState,
    uiPhase,
    gameSpeed,
    stalematePhase,
    buyingPhase,
    buyerOrder,
    buyerStep,
    buyingDiscard,
    gameStateRef,
    uiPhaseRef,
    buyerOrderRef,
    buyerStepRef,
    opponentHistoryRef,
    aiTurnsCouldGoDownRef,
    aiTurnsElapsedRef,
    turnsHeldRef,
    noProgressTurnsRef,
    handleTakeDiscard,
    handleDrawFromPile,
    handleMeldConfirm,
    handleLayOff,
    handleJokerSwap,
    handleDiscard,
    handleBuyDecision,
    recordDecision,
    setBuyingSnatcherName,
    setBuyingPhase,
    setBuyingPassedPlayers,
  })

  // ── Determine display for buying phase ────────────────────────────────────
  const buyerIdx = buyerOrder[buyerStep]
  const activeBuyer = buyerIdx !== undefined ? gameState.players[buyerIdx] : null
  const isHumanBuyerTurn = uiPhase === 'buying' && activeBuyer !== null && !activeBuyer.isAI

  // Transition cinematic to human-turn when a human buyer is up
  useEffect(() => {
    if (isHumanBuyerTurn && buyingPhase === 'ai-deciding') {
      setBuyingPhase('human-turn')
    }
  }, [isHumanBuyerTurn, buyingPhase])

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

  // ── "The Edge" — final card drama for human players close to going out ──
  const isOnTheEdge = !currentPlayer.isAI && currentPlayer.hasLaidDown && currentPlayer.hand.length <= 2 && currentPlayer.hand.length > 0

  // ── Buy-window hand highlights — show which cards relate to the offered discard ──
  const buyRelevanceMap = useMemo(() => {
    if (buyingPhase === 'hidden' || (!buyingDiscard && !pendingBuyDiscard)) return undefined
    const disc = buyingPhase === 'free-offer' ? pendingBuyDiscard : buyingDiscard
    if (!disc) return undefined
    const hand = displayPlayer.hand
    if (hand.length === 0) return undefined
    const map = new Map<string, 'set-match' | 'run-neighbor' | 'dim'>()
    let hasAny = false
    for (const c of hand) {
      if (c.suit === 'joker') {
        map.set(c.id, 'set-match') // jokers are always relevant
        hasAny = true
      } else if (c.rank === disc.rank && disc.suit !== 'joker') {
        map.set(c.id, 'set-match')
        hasAny = true
      } else if (c.suit === disc.suit && Math.abs(c.rank - disc.rank) <= 2) {
        map.set(c.id, 'run-neighbor')
        hasAny = true
      } else {
        map.set(c.id, 'dim')
      }
    }
    // If nothing matches, don't dim everything — just return undefined (no highlights)
    if (!hasAny) return undefined
    return map
  }, [buyingPhase, buyingDiscard, pendingBuyDiscard, displayPlayer.hand])

  const buyMatchLabel = useMemo(() => {
    if (!buyRelevanceMap) return null
    const setMatches = [...buyRelevanceMap.values()].filter(v => v === 'set-match').length
    const runNeighbors = [...buyRelevanceMap.values()].filter(v => v === 'run-neighbor').length
    if (setMatches > 0 || runNeighbors > 0) return 'match'
    return null
  }, [buyRelevanceMap])

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

  if (showGameOverText) {
    return (
      <div style={{ height: '100dvh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{
          fontSize: 36, fontWeight: 900, color: '#e2b858',
          letterSpacing: 6, textTransform: 'uppercase',
          animation: 'game-over-text 800ms ease-out both',
        }}>
          GAME OVER
        </p>
      </div>
    )
  }

  if (showBreathingRoom) {
    return (
      <div style={{ height: '100dvh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
    )
  }

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
        previousStandingsPct={previousStandingsPctRef.current}
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
        gameLogId={gameLogId}
        playerMap={playerMap}
        onPlayAgain={startNewGame}
        onBack={onExit}
        aiPersonality={aiPersonality}
        onReplay={onReplay}
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

  // Round-based felt colors: each round has a distinct rich dark tone
  const ROUND_FELT: Record<number, string> = {
    1: '#1a3a2a', // classic emerald green
    2: '#1a2f3a', // deep teal
    3: '#2a1a3a', // dark plum
    4: '#1a3a30', // rich forest
    5: '#3a1a24', // deep burgundy
    6: '#1a2a3a', // dark navy
    7: '#2e2a1a', // warm charcoal-gold
  }
  const baseFelt = ROUND_FELT[gameState.currentRound] ?? '#1a3a2a'

  // Tension shifts: lighten/warm the base slightly at higher tension
  const feltColor = effectiveTension === 0
    ? baseFelt
    : effectiveTension === 1
    ? adjustFelt(baseFelt, 1)
    : effectiveTension === 2
    ? adjustFelt(baseFelt, 2)
    : adjustFelt(baseFelt, 3)

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

      <CinematicOverlays
        goingOutSequence={goingOutSequence}
        goOutPlayerName={goOutPlayerName}
        showDarkBeat={showDarkBeat}
        turnBanner={turnBanner}
        swapAnim={swapAnim}
        flyingCard={flyingCard}
        flyingCardDuration={currentPlayer.isAI ? 200 : 500}
      />

      {/* Game-feel toast overlay */}
      <GameToast toast={activeToast} />

      {/* ── ZONE 1: Fixed top — top bar + collapsible opponent strip ─── */}
      <div
        className="bg-[#0f2218]"
        style={{ flexShrink: 0, paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        <TopBar
          currentRound={gameState.currentRound}
          totalRounds={TOTAL_ROUNDS}
          requirementDescription={rs.requirement.description}
          onPause={() => setShowPauseModal(true)}
          mode={mode}
          remoteSeatCount={remoteSeatIndices.length}
          onEmoteSend={handleEmoteSend}
          isConnected={mpChannel.isConnected}
          connectedPlayerCount={mpChannel.connectedPlayerCount}
        />

        <OpponentStrip
          players={gameState.players}
          currentPlayerId={currentPlayer.id}
          displayPlayerId={displayPlayer.id}
          uiPhase={uiPhase}
          activeBuyerId={activeBuyer?.id}
          expanded={stripExpanded}
          onToggle={() => setStripExpanded(!stripExpanded)}
          activeEmotes={activeEmotes}
        />
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


      {/* ── ZONE 2: Scrollable middle — table melds + overlay toast ──── */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative',
        opacity: buyingPhase === 'human-turn' || buyingPhase === 'free-offer' || showMeldModal ? 0.5 : 1,
        transition: 'opacity 300ms ease',
      }}>
        {/* Toast overlay — floats over melds, no layout shift */}
        {reshuffleMsg && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            display: 'flex', justifyContent: 'center', padding: '4px 16px',
            background: 'linear-gradient(180deg, #e2b858 0%, rgba(226,184,88,0) 100%)',
            pointerEvents: 'none',
          }}>
            <span className="text-xs font-medium text-warm-text">Draw pile reshuffled from discards</span>
          </div>
        )}
        {/* Close race indicator — replaced by tension system overlays above */}
        <div
          ref={zone2ScrollRef}
          data-tutorial-zone="table-melds"
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

      {/* Rotating race commentary — inline between Zone 2 and Zone 3 */}
      {effectiveTension >= 2 && raceMessage && (
        <div className="flex justify-center" style={{
          flexShrink: 0,
          padding: '3px 16px',
          background: 'rgba(15,34,24,0.9)',
          borderTop: '1px solid rgba(226,184,88,0.15)',
        }}>
          <span key={raceMessage} style={{ fontSize: 11, fontWeight: 700, color: '#e2b858', display: 'flex', alignItems: 'center', gap: 6, animation: 'race-message-fade 4.5s ease both' }}>
            {raceMessage}
          </span>
        </div>
      )}

      {/* Stalemate nudge banner — Phase 1 */}
      {stalematePhase === 'nudge' && (
        <div className="flex justify-center" style={{
          flexShrink: 0,
          padding: '4px 16px',
          background: 'rgba(30,20,10,0.9)',
          borderTop: '1px solid rgba(184,50,50,0.2)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#d4a843', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⏳ Round winding down — cards aren't lining up
          </span>
        </div>
      )}

      {/* Stalemate prompt — Phase 2: bottom sheet overlay */}
      {stalematePhase === 'prompt' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 55,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          {/* Backdrop */}
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
            onClick={handleKeepPlaying}
          />
          {/* Sheet */}
          <div style={{
            position: 'relative', zIndex: 1, width: '100%', maxWidth: 400,
            background: '#1a2e1e', borderTop: '2px solid #e2b858',
            borderRadius: '16px 16px 0 0',
            padding: '20px 24px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
            animation: 'bc-sheet-up 300ms ease-out',
          }}>
            <p style={{ color: '#e2b858', fontSize: 16, fontWeight: 700, margin: '0 0 8px 0', textAlign: 'center' }}>
              End Round?
            </p>
            <p style={{ color: '#a8d0a8', fontSize: 13, margin: '0 0 16px 0', textAlign: 'center', lineHeight: 1.4 }}>
              No one can go out. Score remaining cards and move to the next round?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleKeepPlaying}
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 10,
                  background: '#162e22', border: '1px solid #2d5a3a',
                  color: '#a8d0a8', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Keep Playing
              </button>
              <button
                onClick={handleEndRoundStalemate}
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 10,
                  background: 'linear-gradient(135deg, #e2b858, #d4a843)',
                  border: 'none',
                  color: '#2c1810', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                End Round
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ZONE 3: Piles strip — hidden during AI turns, buy bottom sheet, meld-building ── */}
      {(uiPhase === 'draw' || uiPhase === 'buying') &&
       buyingPhase !== 'human-turn' &&
       buyingPhase !== 'free-offer' &&
       !showMeldModal &&
       (!soloHuman || !currentPlayer.isAI || isHumanBuyerTurn) && (
        <PileArea
          drawPileRef={drawPileRef}
          discardPileRef={discardPileRef}
          drawPileCards={rs.drawPile}
          discardTop={topDiscard}
          isHumanDraw={isHumanDraw}
          isHumanBuyerTurn={isHumanBuyerTurn}
          buyingDiscard={buyingDiscard}
          discardAnimating={discardAnimating}
          discardUnwanted={discardUnwanted}
          lastDiscardedLabel={lastDiscardedLabel}
          pendingBuyDiscard={pendingBuyDiscard}
          uiPhase={uiPhase}
          currentPlayerIsAI={!!currentPlayer.isAI}
          onDrawFromPile={handleDrawFromPile}
          onTakeDiscard={handleTakeDiscard}
        />
      )}

      {/* ── Inline meld-building staging area ──────────────────────── */}
      {showMeldModal && (
        <MeldBuilder
          ref={meldBuilderRef}
          hand={sortedCurrentHand}
          requirement={rs.requirement}
          onConfirm={handleMeldConfirm}
          onClose={() => { if (!preLayDownSwap) { setShowMeldModal(false); setMeldAssignedIds(new Set()) } }}
          mustLayDown={preLayDownSwap}
          sortMode={handSort}
          onSortChange={setHandSort}
          onAssignedIdsChange={setMeldAssignedIds}
        />
      )}

      {/* ── ZONE 4: Fixed bottom — hand + actions ──────────── */}
      <div
        className="bg-[#0f2218] px-3 pt-2"
        style={{
          flexShrink: 0,
          paddingBottom: (buyingPhase === 'human-turn' || buyingPhase === 'free-offer') ? '8px' : 'max(12px, env(safe-area-inset-bottom))',
          transition: 'padding-bottom 300ms ease',
        }}
      >
        {/* Buy prompt area removed — replaced by BuyingCinematic overlay */}

        <HandArea
          ref={handAreaRef}
          displayPlayer={displayPlayer}
          isHumanBuyerTurn={isHumanBuyerTurn}
          aiTurnHumanViewer={aiTurnHumanViewer}
          currentPlayer={currentPlayer}
          selectedCardIds={selectedCardIds}
          selectionOrder={selectedCardOrderRef.current}
          onToggle={toggleCard}
          handSort={handSort}
          onSortChange={setHandSort}
          newCardIds={newCardIds}
          shimmerCardId={shimmerCardId}
          showDealAnimation={showDealAnimation}
          leavingCardId={leavingCardId}
          dealFlipPhase={dealFlipPhase}
          isOnTheEdge={isOnTheEdge}
          buyRelevanceMap={buyRelevanceMap}
          buyMatchLabel={buyMatchLabel}
          buyingPhase={buyingPhase}
          showMeldModal={showMeldModal}
          meldAssignedIds={meldAssignedIds}
          lastDrawnCardId={lastDrawnCardId}
          yourTurnPulse={yourTurnPulse}
          perfectDrawActive={perfectDrawActive}
        />

        <ActionBar
          uiPhase={uiPhase}
          currentPlayerIsAI={!!currentPlayer.isAI}
          hasLaidDown={currentPlayer.hasLaidDown}
          selectedCardCount={selectedCardIds.size}
          requirementDescription={rs.requirement.description}
          pendingUndoCard={pendingUndo?.card ?? null}
          onUndoDiscard={handleUndoDiscard}
          pendingLayOffUndoCard={pendingLayOffUndo?.card ?? null}
          onUndoLayOff={handleUndoLayOff}
          jokerPositionPrompt={!!jokerPositionPrompt}
          onJokerLow={() => handleJokerPositionChoice('low')}
          onJokerHigh={() => handleJokerPositionChoice('high')}
          swapMode={swapMode}
          swapSelectedMeldId={swapSelectedMeldId}
          layOffError={layOffError}
          onCancelSwap={() => {
            setSwapMode(false)
            setSwapSelectedMeldId(null)
            setPreSwapMeldId(null)
            if (preLayDownSwapBaseStateRef.current) {
              setGameState(preLayDownSwapBaseStateRef.current)
              preLayDownSwapBaseStateRef.current = null
            }
            clearSelection()
          }}
          hasSwappableJokersBeforeLayDown={hasSwappableJokersBeforeLayDown}
          onSwapJoker={() => {
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
          perfectDrawActive={perfectDrawActive}
          onLayDown={() => { setPerfectDrawActive(false); setShowMeldModal(true) }}
          onDiscard={() => { setNewCardIds(new Set()); handleDiscard() }}
          discardError={discardError}
          lastCardStuck={lastCardStuck}
          onEndTurnStuck={handleEndTurnStuck}
          showMeldModal={showMeldModal}
        />

      </div>

      {/* ── Free take bottom sheet — inline, not overlay ──────────────── */}
      {buyingPhase === 'free-offer' && pendingBuyDiscard && (
        <FreeTakeBottomSheet
          card={pendingBuyDiscard}
          cardLabel={formatCard(pendingBuyDiscard)}
          onTake={handleCinematicFreeOfferAccept}
          onPass={handleCinematicFreeOfferDecline}
        />
      )}

      {/* ── Buy bottom sheet — inline, not overlay ──────────────────────── */}
      {buyingPhase === 'human-turn' && buyingDiscard && (
        <BuyBottomSheet
          card={buyingDiscard}
          buysRemaining={activeBuyer?.buysRemaining ?? 0}
          buyLimit={gameState.buyLimit}
          cardLabel={formatCard(buyingDiscard)}
          canBuy={activeBuyer ? activeBuyer.buysRemaining > 0 : false}
          onBuy={handleCinematicBuy}
          onPass={handleCinematicPass}
        />
      )}

      {/* Modals — logic unchanged */}
      {/* MeldBuilder overlay sub-flows (joker placement) render here */}
      {/* The inline staging area is rendered between ZONE 3 and ZONE 4 */}

      {/* Pause modal */}
      {showPauseModal && (
        <PauseMenu
          onClose={() => setShowPauseModal(false)}
          onExit={onExit}
          gameSpeed={gameSpeed}
          onSpeedChange={setGameSpeed}
          reduceAnimations={reduceAnimations}
          onToggleAnimations={() => setReduceAnimations(prev => !prev)}
          sfxVol={sfxVol}
          notifVol={notifVol}
          onSfxVolChange={updateSfxVol}
          onNotifVolChange={updateNotifVol}
          roundInfo={`Round ${gameState.currentRound} of ${TOTAL_ROUNDS} · ${currentPlayer.name}'s turn`}
          tournamentInfo={tournamentGameNumber ? `Game ${tournamentGameNumber} of 3` : undefined}
          onCleanup={() => { if (pendingUndo) clearTimeout(pendingUndo.timerId) }}
        />
      )}

      {/* Cinematic buying window overlay */}
      <BuyingCinematic
        phase={buyingPhase}
        card={buyingPhase === 'free-offer' ? pendingBuyDiscard : buyingDiscard}
        isFreeOffer={buyingPhase === 'free-offer'}
        buyerName={buyingSnatcherName}
        passedPlayers={buyingPassedPlayers}
        buysRemaining={
          buyingPhase === 'free-offer'
            ? currentPlayer.buysRemaining
            : (activeBuyer?.buysRemaining ?? 0)
        }
        buyLimit={gameState.buyLimit}
        cardLabel={
          (buyingPhase === 'free-offer' ? pendingBuyDiscard : buyingDiscard)
            ? formatCard((buyingPhase === 'free-offer' ? pendingBuyDiscard : buyingDiscard)!)
            : ''
        }
        onBuy={buyingPhase === 'free-offer' ? handleCinematicFreeOfferAccept : handleCinematicBuy}
        onPass={buyingPhase === 'free-offer' ? handleCinematicFreeOfferDecline : handleCinematicPass}
      />

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

// rankLabel moved to ActionBar component
