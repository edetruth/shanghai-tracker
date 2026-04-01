import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS, checkAchievements } from '../../lib/achievements'
import type { AchievementContext } from '../../lib/achievements'
import type { GameState, Player } from '../types'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    hand: [],
    melds: [],
    hasLaidDown: false,
    buysRemaining: 5,
    roundScores: [],
    isAI: false,
    ...overrides,
  }
}

function makeGameState(players: Player[], overrides: Partial<GameState> = {}): GameState {
  return {
    players,
    currentRound: 1,
    roundState: {} as GameState['roundState'],
    deckCount: 2,
    gameOver: false,
    buyLimit: 5,
    ...overrides,
  }
}

function makeCtx(overrides: Partial<AchievementContext>): AchievementContext {
  const player = makePlayer()
  return {
    gameState: makeGameState([player]),
    playerName: 'Alice',
    playerIndex: 0,
    isGameEnd: false,
    ...overrides,
  }
}

describe('Achievements', () => {
  it('ACHIEVEMENTS has exactly 16 entries', () => {
    expect(ACHIEVEMENTS).toHaveLength(16)
  })

  it('first-hand unlocks at game end', () => {
    const player = makePlayer({ roundScores: [10, 20, 30, 40, 50, 60, 70] })
    const gs = makeGameState([player])
    const ctx = makeCtx({ gameState: gs, isGameEnd: true })
    const result = checkAchievements(ctx, new Set())
    expect(result).toContain('first-hand')
  })

  it('first-hand does NOT unlock when not game end', () => {
    const ctx = makeCtx({ isGameEnd: false })
    const result = checkAchievements(ctx, new Set())
    expect(result).not.toContain('first-hand')
  })

  it('clean-sweep unlocks when player scored 0 and was not shanghaied', () => {
    const player = makePlayer({ id: 'p1' })
    const gs = makeGameState([player])
    const ctx = makeCtx({
      gameState: gs,
      roundResults: [{ playerId: 'p1', score: 0, shanghaied: false }],
    })
    const result = checkAchievements(ctx, new Set())
    expect(result).toContain('clean-sweep')
  })

  it('clean-sweep does NOT unlock when player was shanghaied', () => {
    const player = makePlayer({ id: 'p1' })
    const gs = makeGameState([player])
    const ctx = makeCtx({
      gameState: gs,
      roundResults: [{ playerId: 'p1', score: 0, shanghaied: true }],
    })
    const result = checkAchievements(ctx, new Set())
    expect(result).not.toContain('clean-sweep')
  })

  it('hat-trick unlocks when last 3 roundScores are all 0', () => {
    const player = makePlayer({ roundScores: [50, 0, 0, 0] })
    const gs = makeGameState([player])
    const ctx = makeCtx({ gameState: gs })
    const result = checkAchievements(ctx, new Set())
    expect(result).toContain('hat-trick')
  })

  it('hat-trick does NOT unlock when only 2 rounds are 0', () => {
    const player = makePlayer({ roundScores: [50, 0, 0] })
    const gs = makeGameState([player])
    const ctx = makeCtx({ gameState: gs })
    const result = checkAchievements(ctx, new Set())
    // Only 3 scores with last 3 being [50, 0, 0] — not all zero
    expect(result).not.toContain('hat-trick')
  })

  it('the-heist is NOT auto-detected by checkAchievements', () => {
    const player = makePlayer({ hasLaidDown: true })
    const gs = makeGameState([player])
    const ctx = makeCtx({ gameState: gs, isGameEnd: true })
    const result = checkAchievements(ctx, new Set())
    expect(result).not.toContain('the-heist')
  })

  it('full-house unlocks when 8 players in game', () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      makePlayer({ id: `p${i}`, name: `Player ${i}` })
    )
    const gs = makeGameState(players)
    const ctx = makeCtx({ gameState: gs })
    const result = checkAchievements(ctx, new Set())
    expect(result).toContain('full-house')
  })

  it('shutout unlocks when all 7 roundScores are 0 at game end', () => {
    const player = makePlayer({ roundScores: [0, 0, 0, 0, 0, 0, 0] })
    const other = makePlayer({ id: 'p2', name: 'Bob', roundScores: [10, 20, 30, 40, 50, 60, 70] })
    const gs = makeGameState([player, other])
    const ctx = makeCtx({ gameState: gs, isGameEnd: true })
    const result = checkAchievements(ctx, new Set())
    expect(result).toContain('shutout')
  })

  it('comeback-kid unlocks when player wins after being last at round 5', () => {
    // Alice has highest (worst) score through round 5 but wins overall (lowest total)
    // Round 5 totals: Alice=250, Bob=50 → Alice was last
    // Final totals: Alice=250, Bob=50+100+150=300 → Alice wins
    const alice = makePlayer({
      id: 'p1',
      name: 'Alice',
      roundScores: [50, 50, 50, 50, 50, 0, 0],
      buysRemaining: 5,
    })
    const bob = makePlayer({
      id: 'p2',
      name: 'Bob',
      roundScores: [10, 10, 10, 10, 10, 100, 150],
      buysRemaining: 5,
    })
    // Alice R5 total=250, Bob R5 total=50 → Alice was last (highest score)
    // Alice final=250, Bob final=300 → Alice wins (lowest score)
    const gs = makeGameState([alice, bob])
    const ctx = makeCtx({ gameState: gs, isGameEnd: true })
    const result = checkAchievements(ctx, new Set())
    expect(result).toContain('comeback-kid')
  })

  it('already-unlocked achievements are not returned again', () => {
    const player = makePlayer({ roundScores: [0, 0, 0, 0, 0, 0, 0] })
    const other = makePlayer({ id: 'p2', name: 'Bob', roundScores: [10, 20, 30, 40, 50, 60, 70] })
    const gs = makeGameState([player, other])
    const ctx = makeCtx({ gameState: gs, isGameEnd: true })
    const alreadyUnlocked = new Set(['first-hand', 'shutout'])
    const result = checkAchievements(ctx, alreadyUnlocked)
    expect(result).not.toContain('first-hand')
    expect(result).not.toContain('shutout')
  })
})
