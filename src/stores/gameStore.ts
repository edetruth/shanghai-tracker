import { create } from 'zustand'
import type { GameState, Card } from '../game/types'
import type { BuyingPhase } from '../components/play/BuyingCinematic'

export type UIPhase =
  | 'round-start'
  | 'privacy'
  | 'draw'
  | 'action'
  | 'buying'
  | 'round-end'
  | 'game-over'

export type GameSpeed = 'fast' | 'normal' | 'slow'

export interface RoundResult {
  playerId: string
  score: number
  shanghaied: boolean
}

// All action/setter keys, used to exclude them from `batch()`
type ActionKeys =
  | 'setGameState' | 'setUiPhase' | 'setGameSpeed'
  | 'setBuyingPhase' | 'setBuyerOrder' | 'setBuyerStep'
  | 'setBuyingPassedPlayers' | 'setBuyingSnatcherName'
  | 'setBuyingDiscard' | 'setPendingBuyDiscard' | 'setFreeOfferDeclined'
  | 'setRoundResults' | 'setGoingOutSequence' | 'setGoOutPlayerName'
  | 'startBuyingWindow' | 'advanceBuyerStep' | 'completeBuyingRound'
  | 'cancelBuyingOnGoOut' | 'advanceToNextPlayer'
  | 'batch' | 'reset'

interface GameStore {
  // ── Core game state ──────────────────────────────────────────────────────
  gameState: GameState
  uiPhase: UIPhase
  gameSpeed: GameSpeed

  // ── Buying state ─────────────────────────────────────────────────────────
  buyingPhase: BuyingPhase
  buyerOrder: number[]
  buyerStep: number
  buyingPassedPlayers: string[]
  buyingSnatcherName: string | undefined
  buyingDiscard: Card | null
  pendingBuyDiscard: Card | null
  freeOfferDeclined: boolean

  // ── Round flow ───────────────────────────────────────────────────────────
  roundResults: RoundResult[] | null
  goingOutSequence: 'idle' | 'flash' | 'announce'
  goOutPlayerName: string

  // ── Simple setters ───────────────────────────────────────────────────────
  setGameState: (updater: GameState | ((prev: GameState) => GameState)) => void
  setUiPhase: (phase: UIPhase) => void
  setGameSpeed: (speed: GameSpeed) => void
  setBuyingPhase: (updater: BuyingPhase | ((prev: BuyingPhase) => BuyingPhase)) => void
  setBuyerOrder: (order: number[]) => void
  setBuyerStep: (step: number) => void
  setBuyingPassedPlayers: (updater: string[] | ((prev: string[]) => string[])) => void
  setBuyingSnatcherName: (name: string | undefined) => void
  setBuyingDiscard: (card: Card | null) => void
  setPendingBuyDiscard: (card: Card | null) => void
  setFreeOfferDeclined: (declined: boolean) => void
  setRoundResults: (results: RoundResult[] | null) => void
  setGoingOutSequence: (seq: 'idle' | 'flash' | 'announce') => void
  setGoOutPlayerName: (name: string) => void

  // ── Buying state machine (atomic transitions) ────────────────────────────
  startBuyingWindow: (order: number[], discardCard: Card) => void
  advanceBuyerStep: () => void
  completeBuyingRound: () => void
  cancelBuyingOnGoOut: () => void

  // ── Round flow ───────────────────────────────────────────────────────────
  advanceToNextPlayer: () => GameState

  // ── Batch update (multiple fields atomically) ────────────────────────────
  batch: (updates: Partial<Omit<GameStore, ActionKeys>>) => void

  // ── Reset for new game ───────────────────────────────────────────────────
  reset: (gameState: GameState) => void
}

const initialGameState: GameState = {
  players: [],
  currentRound: 1,
  deckCount: 2,
  buyLimit: 5,
  gameOver: false,
  roundState: {
    drawPile: [],
    discardPile: [],
    tablesMelds: [],
    requirement: { sets: 2, runs: 0, description: '2 Sets of 3+' },
    currentPlayerIndex: 0,
    roundNumber: 1,
    cardsDealt: 10,
    dealerIndex: 0,
    meldIdCounter: 0,
    goOutPlayerId: null,
  },
}

export const useGameStore = create<GameStore>((set) => ({
  // ── Initial state ────────────────────────────────────────────────────────
  gameState: initialGameState,
  uiPhase: 'round-start',
  gameSpeed: 'normal',

  buyingPhase: 'hidden',
  buyerOrder: [],
  buyerStep: 0,
  buyingPassedPlayers: [],
  buyingSnatcherName: undefined,
  buyingDiscard: null,
  pendingBuyDiscard: null,
  freeOfferDeclined: false,

  roundResults: null,
  goingOutSequence: 'idle',
  goOutPlayerName: '',

  // ── Setters ──────────────────────────────────────────────────────────────
  setGameState: (updater) =>
    set((state) => ({
      gameState: typeof updater === 'function' ? updater(state.gameState) : updater,
    })),
  setUiPhase: (phase) => set({ uiPhase: phase }),
  setGameSpeed: (speed) => set({ gameSpeed: speed }),
  setBuyingPhase: (updater) =>
    set((state) => ({
      buyingPhase: typeof updater === 'function' ? updater(state.buyingPhase) : updater,
    })),
  setBuyerOrder: (order) => set({ buyerOrder: order }),
  setBuyerStep: (step) => set({ buyerStep: step }),
  setBuyingPassedPlayers: (updater) =>
    set((state) => ({
      buyingPassedPlayers: typeof updater === 'function' ? updater(state.buyingPassedPlayers) : updater,
    })),
  setBuyingSnatcherName: (name) => set({ buyingSnatcherName: name }),
  setBuyingDiscard: (card) => set({ buyingDiscard: card }),
  setPendingBuyDiscard: (card) => set({ pendingBuyDiscard: card }),
  setFreeOfferDeclined: (declined) => set({ freeOfferDeclined: declined }),
  setRoundResults: (results) => set({ roundResults: results }),
  setGoingOutSequence: (seq) => set({ goingOutSequence: seq }),
  setGoOutPlayerName: (name) => set({ goOutPlayerName: name }),

  // ── Buying state machine (atomic transitions) ────────────────────────────
  startBuyingWindow: (order, discardCard) =>
    set({
      buyerOrder: order,
      buyerStep: 0,
      buyingDiscard: discardCard,
      buyingPassedPlayers: [],
      buyingSnatcherName: undefined,
      buyingPhase: 'reveal',
    }),

  advanceBuyerStep: () =>
    set((state) => ({ buyerStep: state.buyerStep + 1 })),

  completeBuyingRound: () =>
    set({
      buyingPhase: 'hidden',
      buyerOrder: [],
      buyerStep: 0,
      buyingDiscard: null,
      buyingPassedPlayers: [],
      buyingSnatcherName: undefined,
    }),

  cancelBuyingOnGoOut: () =>
    set({
      pendingBuyDiscard: null,
      buyerOrder: [],
      buyingDiscard: null,
      freeOfferDeclined: false,
      buyingPhase: 'hidden',
    }),

  // ── Round flow ───────────────────────────────────────────────────────────
  advanceToNextPlayer: () => {
    let result: GameState = undefined as unknown as GameState
    set((state) => {
      const count = state.gameState.players.length
      const next = (state.gameState.roundState.currentPlayerIndex + 1) % count
      result = {
        ...state.gameState,
        roundState: { ...state.gameState.roundState, currentPlayerIndex: next },
      }
      return { gameState: result }
    })
    return result
  },

  // ── Batch ────────────────────────────────────────────────────────────────
  batch: (updates) => set(updates),

  // ── Reset ────────────────────────────────────────────────────────────────
  reset: (gameState) =>
    set({
      gameState,
      uiPhase: 'round-start',
      gameSpeed: 'normal',
      buyingPhase: 'hidden',
      buyerOrder: [],
      buyerStep: 0,
      buyingPassedPlayers: [],
      buyingSnatcherName: undefined,
      buyingDiscard: null,
      pendingBuyDiscard: null,
      freeOfferDeclined: false,
      roundResults: null,
      goingOutSequence: 'idle',
      goOutPlayerName: '',
    }),
}))
