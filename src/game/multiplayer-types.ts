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

  // Event notifications for remote players
  toast?: { message: string; style: 'celebration' | 'pressure' | 'neutral' | 'drama' | 'taunt'; icon?: string }
  lastEvent?: string  // e.g. "Sam bought 7♥", "Pat went down!", "Lou swapped a joker!"
  raceMessage?: string  // "Race to finish!" tension message
  streakInfo?: { playerName: string; streak: number }

  // Cinematic sync
  perfectDraw?: boolean
  shimmerCardId?: string | null
  isOnTheEdge?: boolean
  feltColor?: string

  // Buying cinematic sync
  buyingCinematicPhase?: 'hidden' | 'reveal' | 'free-offer' | 'ai-deciding' | 'human-turn' | 'snatched' | 'unclaimed'
  buyingSnatcherName?: string | null

  // Round announcement sync
  announcementData?: {
    stage: string
    standings?: Array<{ name: string; total: number; delta?: number }>
    dealerName?: string
    firstPlayerName?: string
  }

  // Disconnection info
  disconnectedPlayers?: number[]
  turnTimeRemaining?: number
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

// ── Connection Infrastructure ────────────────────────────────────────────────

export interface HeartbeatPayload {
  seatIndex: number
  timestamp: number
}

export interface ActionAck {
  actionId: string
  ok: boolean
  error?: string
}

export interface PendingAction {
  id: string
  action: PlayerAction
  sentAt: number
  retries: number
}

export interface PlayerConnectionState {
  seatIndex: number
  lastHeartbeat: number
  isConnected: boolean
  missedBeats: number
}

// ── Emote payload ──────────────────────────────────────────────────────────

export interface EmotePayload {
  seatIndex: number
  emoteId: string
  timestamp: number
}

// ── Channel messages ────────────────────────────────────────────────────────

export type ChannelMessage =
  | { event: 'game_state'; payload: { targetSeatIndex: number; view: RemoteGameView } }
  | { event: 'player_action'; payload: { seatIndex: number; action: PlayerAction } }
  | { event: 'game_start'; payload: { playerConfigs: PlayerConfig[] } }
  | { event: 'player_joined'; payload: { name: string; seatIndex: number } }
  | { event: 'player_left'; payload: { seatIndex: number } }
  | { event: 'action_rejected'; payload: { seatIndex: number; reason: string } }
  | { event: 'heartbeat'; payload: HeartbeatPayload }
  | { event: 'action_ack'; payload: ActionAck & { seatIndex: number } }
  | { event: 'player_disconnected'; payload: { seatIndex: number; playerName: string } }
  | { event: 'turn_skipped'; payload: { seatIndex: number; reason: 'timeout' | 'disconnected' } }
  | { event: 'player_reconnected'; payload: { seatIndex: number } }
  | { event: 'emote'; payload: EmotePayload }
  | { event: 'spectator_view'; payload: { view: SpectatorGameView } }

// ── Spectator view (host → spectators, full hand visibility) ────────────────

export interface SpectatorPlayerView {
  name: string
  hand: Card[]
  hasLaidDown: boolean
  buysRemaining: number
  isAI: boolean
  seatIndex: number
  melds: Meld[]
}

export interface SpectatorGameView {
  players: SpectatorPlayerView[]
  tableMelds: Meld[]
  discardTop: Card | null
  drawPileSize: number
  currentPlayerIndex: number
  uiPhase: string
  currentRound: number
  roundRequirement: RoundRequirement
  scores: { name: string; roundScores: number[] }[]
  buyLimit: number
  goingOutPlayerName?: string
  goingOutSequence: 'idle' | 'flash' | 'announce'
  announcementStage: string | null
  gameOver: boolean
  winner?: string
  feltColor?: string
  toast?: { message: string; style: string; icon?: string }
  roundResults?: Array<{ playerName: string; score: number; shanghaied: boolean; wentOut: boolean }>
}

// ── Multiplayer mode for GameBoard ──────────────────────────────────────────

export type MultiplayerMode = 'local' | 'host'

export interface HostConfig {
  roomCode: string
  hostSeatIndex: number
  remoteSeatIndices: number[]
}
