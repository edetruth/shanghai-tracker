import { useEffect, useRef, useState } from 'react'
import type {
  GameState, Player, Card as CardType, Meld, AIDifficulty, AIPersonality,
  PersonalityConfig, OpponentHistory, PlayerConfig,
} from '../game/types'
import { PERSONALITIES } from '../game/types'
import { cardPoints } from '../game/rules'
import { isValidSet, canLayOff, findSwappableJoker, getNextJokerOptions, canGoOutViaChainLayOff } from '../game/meld-validator'
import {
  aiFindBestMeldsForLayOff, aiShouldTakeDiscard, aiChooseDiscard, aiShouldBuy,
  aiFindLayOff, aiFindJokerSwap, aiFindPreLayDownJokerSwap,
  aiShouldGoDownHard, getAIEvalConfig,
  type AIEvalConfig,
} from '../game/ai'
import { loadOpponentModel, buildNemesisOverrides } from '../game/opponent-model'

// ── Types ────────────────────────────────────────────────────────────────────

type GameSpeed = 'fast' | 'normal' | 'slow'
type UIPhase = 'round-start' | 'privacy' | 'draw' | 'action' | 'buying' | 'round-end' | 'game-over'
type BuyingPhase = 'hidden' | 'reveal' | 'free-offer' | 'ai-deciding' | 'human-turn' | 'snatched' | 'unclaimed'

function getCurrentPlayer(state: GameState): Player {
  return state.players[state.roundState.currentPlayerIndex]
}

function getAIDelay(speed: GameSpeed): number {
  if (speed === 'fast') return 200 + Math.random() * 200
  if (speed === 'slow') return 2000 + Math.random() * 1000
  return 700 + Math.random() * 500
}

// ── Hook interface ───────────────────────────────────────────────────────────

interface UseAIAutomationParams {
  // Props from GameBoard
  initialPlayers: PlayerConfig[]
  aiDifficultyProp: AIDifficulty
  aiPersonality?: AIPersonality

  // Core game state
  gameState: GameState
  uiPhase: UIPhase
  gameSpeed: GameSpeed
  stalematePhase: 'none' | 'nudge' | 'prompt'

  // Buying window state
  buyingPhase: BuyingPhase
  buyerOrder: number[]
  buyerStep: number
  buyingDiscard: CardType | null

  // Refs for reading fresh state inside timeouts
  gameStateRef: React.MutableRefObject<GameState>
  uiPhaseRef: React.MutableRefObject<UIPhase>
  buyerOrderRef: React.MutableRefObject<number[]>
  buyerStepRef: React.MutableRefObject<number>

  // AI tracking refs (owned by GameBoard, shared with hook)
  opponentHistoryRef: React.MutableRefObject<Map<string, OpponentHistory>>
  aiTurnsCouldGoDownRef: React.MutableRefObject<Map<string, number>>
  aiTurnsElapsedRef: React.MutableRefObject<Map<string, number>>
  turnsHeldRef: React.MutableRefObject<Map<string, number>>
  noProgressTurnsRef: React.MutableRefObject<number>

  // Handler functions
  handleTakeDiscard: () => void
  handleDrawFromPile: () => void
  handleMeldConfirm: (meldGroups: CardType[][], jokerPositions?: Map<string, number>) => void
  handleLayOff: (card: CardType, meld: Meld, jokerPosition?: 'low' | 'high') => void
  handleJokerSwap: (naturalCard: CardType, meld: Meld) => void
  handleDiscard: (overrideCardId?: string) => void
  handleBuyDecision: (wantsToBuy: boolean) => void

  // Telemetry
  recordDecision: (
    player: Player,
    decisionType: string,
    decisionResult: string,
    card?: CardType | null,
    reason?: string,
  ) => void

  // Buying cinematic setters
  setBuyingSnatcherName: (name: string | undefined) => void
  setBuyingPhase: (phase: BuyingPhase) => void
  setBuyingPassedPlayers: (updater: string[] | ((prev: string[]) => string[])) => void
}

interface UseAIAutomationReturn {
  /** Counter bumped after AI joker swaps to re-trigger the action effect */
  aiActionTick: number
  /** Ref tracking lay-off count per AI turn (capped for medium AI) */
  aiLayOffCountRef: React.MutableRefObject<number>
  /** Get the active personality config */
  getPersonalityConfig: () => PersonalityConfig
  /** Get the AI evaluation config (with Nemesis overrides if applicable) */
  getEvalConfig: () => AIEvalConfig
}

// ── Hook implementation ──────────────────────────────────────────────────────

export function useAIAutomation({
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
}: UseAIAutomationParams): UseAIAutomationReturn {

  const [aiActionTick, setAiActionTick] = useState(0)
  const aiLayOffCountRef = useRef(0)

  // ── Personality & eval config ────────────────────────────────────────────

  const personalityConfig: PersonalityConfig | null = aiPersonality
    ? (PERSONALITIES.find(p => p.id === aiPersonality) ?? PERSONALITIES[0])
    : null

  function getPersonalityConfig(): PersonalityConfig {
    if (personalityConfig) return personalityConfig
    if (aiDifficultyProp === 'easy') return PERSONALITIES.find(p => p.id === 'rookie-riley')!
    if (aiDifficultyProp === 'hard') return PERSONALITIES.find(p => p.id === 'the-shark')!
    return PERSONALITIES.find(p => p.id === 'steady-sam')!
  }

  const nemesisOverridesRef = useRef<ReturnType<typeof buildNemesisOverrides> | null>(null)

  function getEvalConfig(): AIEvalConfig {
    const cfg = getPersonalityConfig()
    const base = getAIEvalConfig(cfg.id)
    if (cfg.id !== 'the-nemesis') return base
    if (!nemesisOverridesRef.current) {
      const humanPlayer = initialPlayers.find(p => !p.isAI)
      const model = humanPlayer ? loadOpponentModel(humanPlayer.name) : null
      nemesisOverridesRef.current = buildNemesisOverrides(model)
    }
    const ov = nemesisOverridesRef.current
    return {
      ...base,
      buyRiskTolerance: base.buyRiskTolerance + ov.buyAggression,
      dangerWeight: Math.min(1, base.dangerWeight + (Object.values(ov.suitDenial).reduce((s, v) => s + v, 0) / 400)),
      goDownStyle: ov.goDownTiming === 'rush' ? 'immediate' : ov.goDownTiming === 'hold' ? 'strategic' : base.goDownStyle,
    }
  }

  // ── AI action phase logic ────────────────────────────────────────────────

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
        // The Mastermind: go down if going out, can go out soon, or panic
        const meldedIds = new Set(melds.flatMap(m => m.map(c => c.id)))
        const remaining = player.hand.filter(c => !meldedIds.has(c.id))
        if (remaining.length === 0) return true // going out!

        // Can go out via chain lay-offs on existing table melds
        if (remaining.length <= 4 && tablesMelds.length > 0) {
          if (canGoOutViaChainLayOff(remaining, tablesMelds)) return true
        }

        // Near go-out: remaining <= 2 and at least one can lay off
        if (remaining.length <= 2 && tablesMelds.length > 0) {
          const canLayOffSome = remaining.some(c => tablesMelds.some(m => canLayOff(c, m)))
          if (canLayOffSome) return true
        }

        // Shanghai risk: held 3+ turns with high hand points — bail out
        const turnsHeldSoFar = aiTurnsCouldGoDownRef.current.get(player.id) ?? 0
        if (turnsHeldSoFar >= 3) {
          const handPoints = remaining.reduce((sum, c) => sum + cardPoints(c.rank), 0)
          if (handPoints > 60) return true
        }

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
        const melds = aiFindBestMeldsForLayOff(player.hand, requirement, tablesMelds)
        if (melds && melds.length > 0) {
          aiLayOffCountRef.current = 0
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        }
      }
      aiLayOffCountRef.current = 0
      const card = aiChooseDiscard(player.hand, requirement, getEvalConfig(), tablesMelds, undefined, undefined, player.hasLaidDown)
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
          handleJokerSwap(swap.card, swap.meld)
          setAiActionTick(t => t + 1)
          return
        }
      }
    }

    // ── Try to lay down (required melds only) ──
    if (!player.hasLaidDown) {
      const melds = aiFindBestMeldsForLayOff(player.hand, requirement, tablesMelds)
      if (melds && melds.length > 0) {
        if (shouldGoDownNow(melds)) {
          aiTurnsCouldGoDownRef.current.delete(player.id)
          aiLayOffCountRef.current = 0
          noProgressTurnsRef.current = 0
          handleMeldConfirm(melds, aiJokerPositions(melds))
          return
        } else {
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
      const layOff = aiFindLayOff(player.hand, tablesMelds, player.id, gameState.players)
      if (layOff) {
        if (layOff.card.suit !== 'joker') aiLayOffCountRef.current++
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
      } else {
        const evalCfg = getEvalConfig()
        card = aiChooseDiscard(player.hand, requirement, evalCfg, tablesMelds,
            state.players.filter(p => p.id !== player.id), opponentHistoryRef.current, player.hasLaidDown)
        // Lucky Lou: 15% chance to pick a random card instead
        if (config.randomFactor > 0 && Math.random() < 0.15 && player.hand.length > 1) {
          const randomIdx = Math.floor(Math.random() * player.hand.length)
          card = player.hand[randomIdx]
        }
      }
      console.log(`[Buy] AI ${player.name} discarded [${card.rank === 0 ? 'Joker' : `${card.rank}${card.suit}`}]`)
      handleDiscard(card.id)
    }
  }

  // ── AI turn automation (draw + action) ───────────────────────────────────
  const currentPlayer = getCurrentPlayer(gameState)
  const handLen = currentPlayer.hand.length
  const rs = gameState.roundState

  useEffect(() => {
    if (!currentPlayer.isAI) return
    if (uiPhase !== 'draw' && uiPhase !== 'action') return
    // BAIL if someone has gone out — round is over
    if (gameState.roundState.goOutPlayerId) return
    // BAIL if stalemate prompt is showing — wait for user decision
    if (stalematePhase === 'prompt') return

    const delay = getAIDelay(gameSpeed)
    const timerId = setTimeout(() => {
      // Re-check goOutPlayerId inside the timeout (state may have changed)
      if (gameStateRef.current.roundState.goOutPlayerId) return
      if (uiPhaseRef.current === 'draw') {
        const state = gameStateRef.current
        const player = getCurrentPlayer(state)
        const top = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null

        const cfg = getPersonalityConfig()
        const evalCfg = getEvalConfig()
        let shouldTake = false
        if (top !== null) {
          shouldTake = aiShouldTakeDiscard(player.hand, top, state.roundState.requirement, player.hasLaidDown, evalCfg,
              state.roundState.tablesMelds, state.players.filter(p => p.id !== player.id))
          // Lucky Lou random factor: 20% chance to take any discard, 10% chance to decline a good one
          if (cfg.randomFactor > 0) {
            if (!shouldTake && Math.random() < 0.2) shouldTake = true
            else if (shouldTake && Math.random() < 0.1) shouldTake = false
          }
        }

        // If AI has laid down and top discard can be laid off, take it
        if (!shouldTake && top !== null && player.hasLaidDown) {
          const melds = state.roundState.tablesMelds
          if (melds.some(m => canLayOff(top, m))) {
            shouldTake = true
          }
          // Post-down joker-swap take: if the discard replaces a joker in a
          // table run, taking it frees the joker which can then lay off anywhere
          if (!shouldTake && melds.some(m => findSwappableJoker(top, m) !== null)) {
            shouldTake = true
          }
        }

        if (shouldTake) handleTakeDiscard()
        else handleDrawFromPile()
      } else if (uiPhaseRef.current === 'action') {
        executeAIAction()
      }
    }, delay)

    return () => clearTimeout(timerId)
  }, [uiPhase, currentPlayer.isAI, handLen, rs.currentPlayerIndex, aiActionTick, stalematePhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI buying automation ──────────────────────────────────────────────────
  useEffect(() => {
    if (uiPhase !== 'buying') return
    // BAIL if someone has gone out — round is over
    if (gameState.roundState.goOutPlayerId) return
    // Only process AI decisions during the ai-deciding phase.
    // Bail during reveal (card rising), snatched (buy animation), unclaimed (sinking),
    // human-turn, free-offer — prevents re-entrant duplicate timers that cause
    // double handleBuyDecision calls and skip the drawing player's action phase.
    if (buyingPhase !== 'ai-deciding') return
    const buyerIdx = buyerOrder[buyerStep]
    if (buyerIdx === undefined) return
    const buyer = gameState.players[buyerIdx]
    if (!buyer?.isAI) return

    const delay = 300 // fast AI decisions during cinematic
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
      const buyEvalCfg = getEvalConfig()
      // Enforce personality buy self limit
      const personalityBuysUsed = (state.buyLimit >= 999 ? 999 : state.buyLimit) - currentBuyer.buysRemaining
      const atPersonalityLimit = buyConfig.buySelfLimit > 0 && personalityBuysUsed >= buyConfig.buySelfLimit

      let shouldBuy = false
      if (atPersonalityLimit || buyConfig.buyStyle === 'never') {
        shouldBuy = false
      } else {
        const opponents = state.players.filter(p => p.id !== currentBuyer.id)
          .map(p => ({ hand: { length: p.hand.length }, hasLaidDown: p.hasLaidDown }))
        shouldBuy = aiShouldBuy(currentBuyer.hand, disc, req, currentBuyer.buysRemaining, buyEvalCfg, opponents, state.roundState.tablesMelds, currentBuyer.hasLaidDown)
      }

      if (shouldBuy) {
        // AI buys — show snatched cinematic, then process
        setBuyingSnatcherName(currentBuyer.name)
        setBuyingPhase('snatched')
        setTimeout(() => {
          setBuyingPhase('hidden')
          handleBuyDecision(true)
        }, 800)
      } else {
        // AI passes silently — track for human display
        setBuyingPassedPlayers(prev => [...prev, currentBuyer.name])
        handleBuyDecision(false)
      }
    }, delay)

    return () => clearTimeout(timerId)
  }, [uiPhase, buyerStep, buyerOrder, buyingPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    aiActionTick,
    aiLayOffCountRef,
    getPersonalityConfig,
    getEvalConfig,
  }
}
