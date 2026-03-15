import type { Player, Card } from './types'
import { cardPoints } from './rules'

export function calculateHandScore(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + cardPoints(c.rank), 0)
}

export function scoreRound(players: Player[], goOutPlayerId: string): { playerId: string; score: number; shanghaied: boolean }[] {
  return players.map(p => {
    if (p.id === goOutPlayerId) {
      return { playerId: p.id, score: 0, shanghaied: false }
    }
    const shanghaied = !p.hasLaidDown
    const score = calculateHandScore(p.hand)
    return { playerId: p.id, score, shanghaied }
  })
}
