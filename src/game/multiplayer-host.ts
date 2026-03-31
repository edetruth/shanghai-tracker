import type { GameState, Card, Meld } from './types'
import type {
  RemoteGameView,
  RemoteOpponent,
  RemoteRoundResult,
  RemoteBuyingState,
  RemoteUIPhase,
  PlayerAction,
} from './multiplayer-types'
import type { BuyingPhase } from '../components/play/BuyingCinematic'
import type { AnnouncementStage } from '../components/play/RoundAnnouncement'

// ── State sanitization ──────────────────────────────────────────────────────

interface SanitizeParams {
  gameState: GameState
  uiPhase: string
  targetSeatIndex: number
  buyingState?: {
    buyingDiscard: Card | null
    buyerOrder: number[]
    buyerStep: number
    buyingPhase: BuyingPhase
    passedPlayers: string[]
    snatcherName?: string
  } | null
  pendingFreeOffer?: Card | null
  roundResults?: { playerId: string; score: number; shanghaied: boolean }[] | null
  goingOutPlayerName?: string
  goingOutSequence: 'idle' | 'flash' | 'announce'
  announcementStage: AnnouncementStage | null
  gameOver: boolean
  winner?: string
  toast?: { message: string; style: string; icon?: string } | null
  lastEvent?: string
  raceMessage?: string
  streakInfo?: { playerName: string; streak: number } | null
  // Cinematic sync
  feltColor?: string
  perfectDraw?: boolean
  shimmerCardId?: string | null
  // Announcement data
  standings?: Array<{ name: string; total: number; delta?: number }>
  dealerName?: string
  firstPlayerName?: string
  // Disconnection
  disconnectedPlayers?: number[]
  turnTimeRemaining?: number
}

export function sanitizeGameViewForPlayer(params: SanitizeParams): RemoteGameView {
  const {
    gameState, uiPhase, targetSeatIndex,
    buyingState, pendingFreeOffer, roundResults,
    goingOutPlayerName, goingOutSequence, announcementStage,
    gameOver, winner,
    toast, lastEvent, raceMessage, streakInfo,
  } = params

  const rs = gameState.roundState
  const targetPlayer = gameState.players[targetSeatIndex]

  // Build opponent list (everyone except target player)
  const opponents: RemoteOpponent[] = gameState.players
    .map((p, i) => ({ player: p, index: i }))
    .filter(({ index }) => index !== targetSeatIndex)
    .map(({ player, index }) => ({
      name: player.name,
      handSize: player.hand.length,
      hasLaidDown: player.hasLaidDown,
      buysRemaining: player.buysRemaining,
      isAI: !!player.isAI,
      seatIndex: index,
    }))

  // Scores for all players
  const scores = gameState.players.map(p => ({
    name: p.name,
    roundScores: [...p.roundScores],
  }))

  // Map UIPhase to RemoteUIPhase (skip 'privacy')
  let remotePhase: RemoteUIPhase
  if (uiPhase === 'privacy' || uiPhase === 'draw') {
    remotePhase = 'draw'
  } else if (uiPhase === 'round-start') {
    remotePhase = 'round-start'
  } else if (uiPhase === 'action') {
    remotePhase = 'action'
  } else if (uiPhase === 'buying') {
    remotePhase = 'buying'
  } else if (uiPhase === 'round-end') {
    remotePhase = 'round-end'
  } else if (uiPhase === 'game-over') {
    remotePhase = 'game-over'
  } else {
    remotePhase = 'draw'
  }

  // Build buying state if active
  let remoteBuyingState: RemoteBuyingState | undefined
  if (buyingState?.buyingDiscard && buyingState.buyingPhase !== 'hidden') {
    remoteBuyingState = {
      buyingDiscard: buyingState.buyingDiscard,
      buyerOrder: buyingState.buyerOrder,
      buyerStep: buyingState.buyerStep,
      buyingPhase: buyingState.buyingPhase,
      passedPlayers: buyingState.passedPlayers,
      snatcherName: buyingState.snatcherName,
    }
  }

  // Build round results if available
  let remoteRoundResults: RemoteRoundResult[] | undefined
  if (roundResults) {
    remoteRoundResults = roundResults.map(r => ({
      playerName: gameState.players.find(p => p.id === r.playerId)?.name ?? r.playerId,
      score: r.score,
      shanghaied: r.shanghaied,
      wentOut: r.score === 0,
    }))
  }

  // Check if this player has a pending free offer
  const isCurrentPlayer = rs.currentPlayerIndex === targetSeatIndex
  const remotePendingFreeOffer = isCurrentPlayer && pendingFreeOffer ? pendingFreeOffer : undefined

  return {
    myHand: targetPlayer ? [...targetPlayer.hand] : [],
    myPlayerIndex: targetSeatIndex,
    myHasLaidDown: targetPlayer?.hasLaidDown ?? false,
    myBuysRemaining: targetPlayer?.buysRemaining ?? 0,
    myMelds: targetPlayer?.melds ?? [],
    opponents,
    tableMelds: rs.tablesMelds,
    discardTop: rs.discardPile.length > 0 ? rs.discardPile[rs.discardPile.length - 1] : null,
    discardPileSize: rs.discardPile.length,
    drawPileSize: rs.drawPile.length,
    currentPlayerIndex: rs.currentPlayerIndex,
    uiPhase: remotePhase,
    currentRound: gameState.currentRound,
    roundRequirement: rs.requirement,
    scores,
    buyLimit: gameState.buyLimit,
    buyingState: remoteBuyingState,
    pendingFreeOffer: remotePendingFreeOffer,
    roundResults: remoteRoundResults,
    goingOutPlayerName,
    goingOutSequence,
    announcementStage,
    gameOver,
    winner,
    ...(toast ? { toast: toast as RemoteGameView['toast'] } : {}),
    ...(lastEvent ? { lastEvent } : {}),
    ...(raceMessage ? { raceMessage } : {}),
    ...(streakInfo ? { streakInfo } : {}),
    // Cinematic sync
    feltColor: params.feltColor,
    perfectDraw: params.perfectDraw,
    shimmerCardId: params.shimmerCardId,
    isOnTheEdge: targetPlayer ? (targetPlayer.hasLaidDown && targetPlayer.hand.length <= 2 && targetPlayer.hand.length > 0) : false,
    // Buying cinematic
    buyingCinematicPhase: buyingState?.buyingPhase ?? 'hidden',
    buyingSnatcherName: buyingState?.snatcherName ?? null,
    // Announcement data
    announcementData: announcementStage ? {
      stage: announcementStage,
      standings: params.standings,
      dealerName: params.dealerName,
      firstPlayerName: params.firstPlayerName,
    } : undefined,
    // Disconnection
    disconnectedPlayers: params.disconnectedPlayers,
    turnTimeRemaining: params.turnTimeRemaining,
  }
}

// ── Action mapping ──────────────────────────────────────────────────────────

interface ActionHandlers {
  handleDrawFromPile: () => void
  handleTakeDiscard: () => void
  handleDeclineFreeOffer: () => void
  handleMeldConfirm: (groups: Card[][], jokerPositions?: Map<string, number>) => void
  handleLayOff: (card: Card, meld: Meld, jokerPosition?: 'low' | 'high') => void
  handleJokerSwap: (card: Card, meld: Meld) => void
  handleDiscard: (cardId?: string) => void
  handleBuyDecision: (wantsToBuy: boolean) => void
  handleUndoDiscard?: () => void
}

export function mapActionToHandler(
  action: PlayerAction,
  seatIndex: number,
  gameState: GameState,
  handlers: ActionHandlers,
): { ok: boolean; error?: string } {
  const rs = gameState.roundState
  const player = gameState.players[seatIndex]
  if (!player) return { ok: false, error: 'Invalid seat index' }

  switch (action.type) {
    case 'draw_pile': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      handlers.handleDrawFromPile()
      return { ok: true }
    }

    case 'take_discard': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      handlers.handleTakeDiscard()
      return { ok: true }
    }

    case 'decline_free_offer': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      handlers.handleDeclineFreeOffer()
      return { ok: true }
    }

    case 'meld_confirm': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      // Resolve card IDs from player's hand
      const handMap = new Map(player.hand.map(c => [c.id, c]))
      const groups: Card[][] = []
      for (const idGroup of action.meldCardIds) {
        const cards: Card[] = []
        for (const id of idGroup) {
          const card = handMap.get(id)
          if (!card) return { ok: false, error: `Card ${id} not in hand` }
          cards.push(card)
        }
        groups.push(cards)
      }
      // Convert joker positions
      let jokerPositions: Map<string, number> | undefined
      if (action.jokerPositions) {
        jokerPositions = new Map(Object.entries(action.jokerPositions).map(([k, v]) => [k, v]))
      }
      handlers.handleMeldConfirm(groups, jokerPositions)
      return { ok: true }
    }

    case 'lay_off': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      const card = player.hand.find(c => c.id === action.cardId)
      if (!card) return { ok: false, error: 'Card not in hand' }
      const meld = rs.tablesMelds.find(m => m.id === action.meldId)
      if (!meld) return { ok: false, error: 'Meld not found' }
      handlers.handleLayOff(card, meld, action.jokerPosition)
      return { ok: true }
    }

    case 'joker_swap': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      const card = player.hand.find(c => c.id === action.cardId)
      if (!card) return { ok: false, error: 'Card not in hand' }
      const meld = rs.tablesMelds.find(m => m.id === action.meldId)
      if (!meld) return { ok: false, error: 'Meld not found' }
      handlers.handleJokerSwap(card, meld)
      return { ok: true }
    }

    case 'discard': {
      if (rs.currentPlayerIndex !== seatIndex) return { ok: false, error: 'Not your turn' }
      const card = player.hand.find(c => c.id === action.cardId)
      if (!card) return { ok: false, error: 'Card not in hand' }
      handlers.handleDiscard(action.cardId)
      return { ok: true }
    }

    case 'buy': {
      // Buy decisions can come from non-current players
      handlers.handleBuyDecision(action.wantsToBuy)
      return { ok: true }
    }

    case 'undo_discard': {
      // Undo not supported for remote players
      return { ok: false, error: 'Undo not available for remote players' }
    }

    default:
      return { ok: false, error: 'Unknown action type' }
  }
}
