import type { Card, Meld, RoundRequirement, AIPersonality, PlayerConfig } from './types'
import type { BuyingPhase } from '../components/play/BuyingCinematic'
import type { AnnouncementStage } from '../components/play/RoundAnnouncement'

// ── Lobby types ──────────────────────────────────────────────────────────────

export type RoomStatus = 'waiting' | 'playing' | 'finished'

export interface GameRoom {
  id: string
  room_code: string
  host_player_name: string
  game_config: GameRoomConfig
  status: RoomStatus
  game_state_snapshot?: unknown
  created_at: string
}

export interface GameRoomConfig {
  playerCount: number
  buyLimit: number
  aiPersonality?: AIPersonality
  seats: GameRoomSeat[]
}

export interface GameRoomSeat {
  seatIndex: number
  isAI: boolean
  personality?: AIPersonality
}

export interface GameRoomPlayer {
  id: string
  room_code: string
  player_name: string
  seat_index: number
  is_host: boolean
  is_ai: boolean
  is_connected: boolean
  joined_at: string
}

// ── Remote game view (host → remote, per-player sanitized state) ─────────────

export interface RemoteOpponent {
  name: string
  handSize: number
  hasLaidDown: boolean
  buysRemaining: number
  isAI: boolean
  seatIndex: number
}

export interface RemoteBuyingState {
  buyingDiscard: Card
  buyerOrder: number[]
  buyerStep: number
  buyingPhase: BuyingPhase
  passedPlayers: string[]
  snatcherName?: string
}

export interface RemoteRoundResult {
  playerName: string
  score: number
  shanghaied: boolean
  wentOut: boolean
}

export interface RemoteGameView {
  // Player's own state
  myHand: Card[]
  myPlayerIndex: number
  myHasLaidDown: boolean
  myBuysRemaining: number
  myMelds: Meld[]

  // Other players (sanitized — no hand cards)
  opponents: RemoteOpponent[]

  // Shared table state
  tableMelds: Meld[]
  discardTop: Card | null
  discardPileSize: number
  drawPileSize: number

  // Turn / phase
  currentPlayerIndex: number
  uiPhase: RemoteUIPhase
  currentRound: number
  roundRequirement: RoundRequirement

  // Scores
  scores: { name: string; roundScores: number[] }[]
  buyLimit: number

  // Buying window (present only during buying phase)
  buyingState?: RemoteBuyingState

  // Pending free offer for current player
  pendingFreeOffer?: Card

  // Round results (present only during round-end phase)
  roundResults?: RemoteRoundResult[]

  // Cinematics
  goingOutPlayerName?: string
  goingOutSequence: 'idle' | 'flash' | 'announce'
  announcementStage: AnnouncementStage | null

  // Game over
  gameOver: boolean
  winner?: string
}

// Remote UI phases mirror host UIPhase, but no 'privacy' (remote players are on separate devices)
export type RemoteUIPhase =
  | 'round-start'
  | 'draw'
  | 'action'
  | 'buying'
  | 'round-end'
  | 'game-over'

// ── Player actions (remote → host) ──────────────────────────────────────────

export type PlayerAction =
  | { type: 'draw_pile' }
  | { type: 'take_discard' }
  | { type: 'decline_free_offer' }
  | { type: 'meld_confirm'; meldCardIds: string[][]; jokerPositions?: Record<string, number> }
  | { type: 'lay_off'; cardId: string; meldId: string; jokerPosition?: 'low' | 'high' }
  | { type: 'joker_swap'; cardId: string; meldId: string }
  | { type: 'discard'; cardId: string }
  | { type: 'buy'; wantsToBuy: boolean }
  | { type: 'undo_discard' }

// ── Channel messages ────────────────────────────────────────────────────────

export type ChannelMessage =
  | { event: 'game_state'; payload: { targetSeatIndex: number; view: RemoteGameView } }
  | { event: 'player_action'; payload: { seatIndex: number; action: PlayerAction } }
  | { event: 'game_start'; payload: { playerConfigs: PlayerConfig[] } }
  | { event: 'player_joined'; payload: { name: string; seatIndex: number } }
  | { event: 'player_left'; payload: { seatIndex: number } }
  | { event: 'action_rejected'; payload: { seatIndex: number; reason: string } }
  | { event: 'heartbeat'; payload: { timestamp: number } }

// ── Multiplayer mode for GameBoard ──────────────────────────────────────────

export type MultiplayerMode = 'local' | 'host'

export interface HostConfig {
  roomCode: string
  hostSeatIndex: number
  remoteSeatIndices: number[]
}
