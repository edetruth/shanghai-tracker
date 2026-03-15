import type { RoundRequirement } from './types'

export const ROUND_REQUIREMENTS: RoundRequirement[] = [
  { sets: 2, runs: 0, description: '2 Sets' },
  { sets: 1, runs: 1, description: '1 Set + 1 Run' },
  { sets: 0, runs: 2, description: '2 Runs' },
  { sets: 3, runs: 0, description: '3 Sets' },
  { sets: 2, runs: 1, description: '2 Sets + 1 Run' },
  { sets: 1, runs: 2, description: '1 Set + 2 Runs' },
  { sets: 0, runs: 3, description: '3 Runs' },
]

export const CARDS_DEALT = [10, 10, 10, 10, 12, 12, 12]

export const TOTAL_ROUNDS = 7
export const MAX_BUYS = 5

export function cardPoints(rank: number): number {
  if (rank === 0) return 50        // Joker
  if (rank === 1) return 20        // Ace
  if (rank >= 11) return 10        // J, Q, K
  return rank                      // 2-10 face value
}

export const MIN_SET_SIZE = 3
export const MIN_RUN_SIZE = 4
