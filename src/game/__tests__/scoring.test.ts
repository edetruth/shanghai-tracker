import { describe, it, expect } from 'vitest'
import { calculateHandScore } from '../scoring'
import { scoreRound } from '../scoring'
import { cardPoints } from '../rules'
import { c, joker } from './helpers'
import type { Player } from '../types'

describe('cardPoints', () => {
  // GDD Section 10 point values
  it('joker is worth 25', () => { expect(cardPoints(0)).toBe(25) })
  it('ace is worth 15', () => { expect(cardPoints(1)).toBe(15) })
  it('2 is worth 5', () => { expect(cardPoints(2)).toBe(5) })
  it('9 is worth 5', () => { expect(cardPoints(9)).toBe(5) })
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
    // GDD Section 10: 5 + 10 + 25 = 40
    expect(calculateHandScore(hand)).toBe(5 + 10 + 25)
  })

  it('counts ace as 15 (GDD Section 10)', () => {
    const hand = [c('hearts', 1), c('spades', 3)]
    // 15 (ace) + 5 (3) = 20
    expect(calculateHandScore(hand)).toBe(20)
  })

  // GDD Section 10 — specific hand totals
  it('Hand [A♥, Joker] scores 40 (15 + 25)', () => {
    expect(calculateHandScore([c('hearts', 1), joker()])).toBe(40)
  })

  it('Hand [2♥, 3♣, K♦] scores 20 (5 + 5 + 10)', () => {
    expect(calculateHandScore([c('hearts', 2), c('clubs', 3), c('diamonds', 13)])).toBe(20)
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

  it('joker in remaining hand adds 25 points (GDD Section 10)', () => {
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [joker()], false)
    const results = scoreRound([p1, p2], 'p1')
    expect(results.find(r => r.playerId === 'p2')?.score).toBe(25)
  })

  it('shanghaied player scores full hand value — no extra penalty (GDD Section 10)', () => {
    // Shanghai = has not laid down; penalty is just the hand score, no additional multiplier
    const p1 = makePlayer('p1', [], true)
    const p2 = makePlayer('p2', [c('hearts', 5), c('spades', 13)], false) // 5 + 10 = 15
    const results = scoreRound([p1, p2], 'p1')
    const r2 = results.find(r => r.playerId === 'p2')!
    expect(r2.shanghaied).toBe(true)
    expect(r2.score).toBe(15) // just the hand total, no extra
  })
})
