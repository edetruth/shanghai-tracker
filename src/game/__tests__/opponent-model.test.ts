import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadOpponentModel,
  saveOpponentModel,
  updateOpponentModel,
  buildNemesisOverrides,
} from '../opponent-model'
import type { OpponentModel } from '../opponent-model'

// Mock localStorage since jsdom is not installed
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
  get length() { return Object.keys(store).length },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

describe('Opponent Model', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('loadOpponentModel returns null for unknown player', () => {
    expect(loadOpponentModel('Unknown Player')).toBeNull()
  })

  it('saveOpponentModel + loadOpponentModel round-trips correctly', () => {
    const model: OpponentModel = {
      playerName: 'TestPlayer',
      gamesAnalyzed: 3,
      suitBias: { hearts: 0.4, diamonds: 0.2, clubs: 0.2, spades: 0.2 },
      avgBuyRate: 1.2,
      avgGoDownRound: 2.5,
      discardPatterns: { 10: 0.5 },
      takePatterns: { 7: 0.3 },
      updatedAt: 1000,
    }
    saveOpponentModel(model)
    const loaded = loadOpponentModel('TestPlayer')
    expect(loaded).toEqual(model)
  })

  it('updateOpponentModel increments gamesAnalyzed', () => {
    const actions = [
      { player_index: 0, action_type: 'draw_pile', action_data: {} },
      { player_index: 0, action_type: 'discard', action_data: { rank: 5 } },
    ]
    const model1 = updateOpponentModel('Alice', 0, actions, 7)
    expect(model1.gamesAnalyzed).toBe(1)

    const model2 = updateOpponentModel('Alice', 0, actions, 7)
    expect(model2.gamesAnalyzed).toBe(2)
  })

  it('updateOpponentModel with take_discard actions updates suitBias', () => {
    const actions = [
      { player_index: 0, action_type: 'take_discard', action_data: { suit: 'hearts', rank: 7 } },
      { player_index: 0, action_type: 'take_discard', action_data: { suit: 'hearts', rank: 10 } },
      { player_index: 0, action_type: 'take_discard', action_data: { suit: 'clubs', rank: 5 } },
    ]
    const model = updateOpponentModel('Bob', 0, actions, 7)
    // 2 out of 3 takes are hearts → hearts freq ~0.667, clubs ~0.333
    // Since this is first game (n=0), weight=1, so bias = freq directly
    expect(model.suitBias.hearts).toBeGreaterThan(model.suitBias.clubs)
    expect(model.suitBias.hearts).toBeCloseTo(2 / 3, 1)
  })

  it('buildNemesisOverrides returns defaults when model is null', () => {
    const result = buildNemesisOverrides(null)
    expect(result).toEqual({
      suitDenial: {},
      buyAggression: 0,
      goDownTiming: 'normal',
      avoidDiscardingRanks: [],
    })
  })

  it('buildNemesisOverrides returns defaults when gamesAnalyzed < 2', () => {
    const model: OpponentModel = {
      playerName: 'Newbie',
      gamesAnalyzed: 1,
      suitBias: { hearts: 0.5, diamonds: 0.2, clubs: 0.2, spades: 0.1 },
      avgBuyRate: 2.0,
      avgGoDownRound: 1.0,
      discardPatterns: {},
      takePatterns: {},
      updatedAt: Date.now(),
    }
    const result = buildNemesisOverrides(model)
    expect(result.suitDenial).toEqual({})
    expect(result.buyAggression).toBe(0)
    expect(result.goDownTiming).toBe('normal')
  })

  it('buildNemesisOverrides returns suit denial when bias > 0.3', () => {
    const model: OpponentModel = {
      playerName: 'HeartLover',
      gamesAnalyzed: 5,
      suitBias: { hearts: 0.5, diamonds: 0.2, clubs: 0.2, spades: 0.1 },
      avgBuyRate: 0.5,
      avgGoDownRound: 3.0,
      discardPatterns: {},
      takePatterns: {},
      updatedAt: Date.now(),
    }
    const result = buildNemesisOverrides(model)
    expect(result.suitDenial.hearts).toBeGreaterThan(0)
    // diamonds at 0.2 should NOT have denial
    expect(result.suitDenial.diamonds).toBeUndefined()
  })

  it('buildNemesisOverrides returns buy aggression when avgBuyRate > 1.5', () => {
    const model: OpponentModel = {
      playerName: 'HeavyBuyer',
      gamesAnalyzed: 5,
      suitBias: { hearts: 0.25, diamonds: 0.25, clubs: 0.25, spades: 0.25 },
      avgBuyRate: 2.0,
      avgGoDownRound: 3.0,
      discardPatterns: {},
      takePatterns: {},
      updatedAt: Date.now(),
    }
    const result = buildNemesisOverrides(model)
    expect(result.buyAggression).toBe(10)
  })
})
