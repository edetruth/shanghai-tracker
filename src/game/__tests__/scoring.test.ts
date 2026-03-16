import { describe, it, expect } from 'vitest'
import { calculateHandScore } from '../scoring'
import { scoreRound } from '../scoring'
import { cardPoints } from '../rules'
import { c, joker } from './helpers'
import type { Player } from '../types'

describe('cardPoints', () => {
  it('joker is worth 50', () => { expect(cardPoints(0)).toBe(50) })
  it('ace is worth 20', () => { expect(cardPoints(1)).toBe(20) })
  it('2 is worth 2', () => { expect(cardPoints(2)).toBe(2) })
  it('10 is worth 10', () => { expect(cardPoints(10)).toBe(10) })
  it('J is worth 10', () => { expect(cardPoints(11)).toBe(10) })
  it('Q is worth 10', () => { expect(cardPoints(12)).toBe(10) })
  it('K is worth 10', () => { expect(cardPoints(13)).toBe(10) })
})

describe('calculateHandScore', () => {
  it('returns 0 for empty hand', () => {
    expect(calculateHandScore([])).toBe(0)
  })

  it('sums all card values correctly', () => {
    const hand = [c('hearts', 5), c('diamonds', 10), joker()]
    expect(calculateHandScore(hand)).toBe(5 + 10 + 50)
  })

  it('counts ace as 20', () => {
    const hand = [c('hearts', 1), c('spades', 3)]
    expect(calculateHandScore(hand)).toBe(23)
  })

  it('counts face cards as 10', () => {
    const hand = [c('hearts', 11), c('clubs', 12), c('diamonds', 13)]
    expect(calculateHandScore(hand)).toBe(30)
  })
})

describe('scoreRound', () => {
  function makePlayer(id: string, hand: ReturnType<typeof c>[], hasLaidDown: boolean): Player {
    return {
      id,
      name: id,
      hand,
      melds: [],
      hasLaidDown,
      buysRemaining: 5,
      roundScores: [],
    }
  }

  it('going-out player scores 0', () => {
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [c('hearts', 5), c('diamonds', 10)], true)
    const results = scoreRound([p1, p2], 'p1')
    expect(results.find(r => r.playerId === 'p1')?.score).toBe(0)
  })

  it('non-going-out player scores sum of remaining hand', () => {
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [c('hearts', 5), c('diamonds', 10)], true)
    const results = scoreRound([p1, p2], 'p1')
    expect(results.find(r => r.playerId === 'p2')?.score).toBe(15)
  })

  it('shanghaied = true when player has NOT laid down', () => {
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [c('hearts', 5)], false)
    const results = scoreRound([p1, p2], 'p1')
    expect(results.find(r => r.playerId === 'p2')?.shanghaied).toBe(true)
  })

  it('shanghaied = false when player has laid down', () => {
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [c('hearts', 5)], true)
    const results = scoreRound([p1, p2], 'p1')
    expect(results.find(r => r.playerId === 'p2')?.shanghaied).toBe(false)
  })

  it('joker in remaining hand adds 50 points', () => {
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [joker()], false)
    const results = scoreRound([p1, p2], 'p1')
    expect(results.find(r => r.playerId === 'p2')?.score).toBe(50)
  })
})
