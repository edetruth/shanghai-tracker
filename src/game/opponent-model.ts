// Opponent model — tracks per-player patterns for The Nemesis AI

export interface OpponentModel {
  playerName: string
  gamesAnalyzed: number
  suitBias: Record<string, number>        // suit → frequency taken from discard (0-1)
  avgBuyRate: number                       // average buys per round
  avgGoDownRound: number                   // average round number they first go down
  discardPatterns: Record<number, number>  // rank → frequency discarded
  takePatterns: Record<number, number>     // rank → frequency taken from discard
  updatedAt: number
}

const LS_PREFIX = 'nemesis_model_'

export function loadOpponentModel(playerName: string): OpponentModel | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + playerName)
    if (!raw) return null
    return JSON.parse(raw) as OpponentModel
  } catch {
    return null
  }
}

export function saveOpponentModel(model: OpponentModel): void {
  try {
    localStorage.setItem(LS_PREFIX + model.playerName, JSON.stringify(model))
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

/**
 * Update the opponent model from a completed game's action log.
 * Merges new observations with existing model using running averages.
 */
export function updateOpponentModel(
  playerName: string,
  playerIndex: number,
  actionLog: Array<{ player_index: number; action_type: string; action_data: Record<string, unknown> }>,
  totalRounds: number,
): OpponentModel {
  const existing = loadOpponentModel(playerName) ?? createEmptyModel(playerName)

  // Count actions for this player
  const playerActions = actionLog.filter(a => a.player_index === playerIndex)
  let buyCount = 0
  let goDownRound = totalRounds // default: didn't go down
  const suitTakes: Record<string, number> = {}
  const rankDiscards: Record<number, number> = {}
  const rankTakes: Record<number, number> = {}
  let totalTakes = 0

  for (const action of playerActions) {
    switch (action.action_type) {
      case 'buy':
        if (action.action_data.wantsToBuy) buyCount++
        break
      case 'take_discard': {
        totalTakes++
        const suit = action.action_data.suit as string | undefined
        const rank = action.action_data.rank as number | undefined
        if (suit) suitTakes[suit] = (suitTakes[suit] ?? 0) + 1
        if (rank) rankTakes[rank] = (rankTakes[rank] ?? 0) + 1
        break
      }
      case 'discard': {
        const rank = action.action_data.rank as number | undefined
        if (rank) rankDiscards[rank] = (rankDiscards[rank] ?? 0) + 1
        break
      }
      case 'meld_confirm':
        // Approximate go-down round from action sequence
        goDownRound = findRoundForAction(action, actionLog)
        break
    }
  }

  // Merge with existing model using weighted average
  const n = existing.gamesAnalyzed
  const weight = 1 / (n + 1)

  // Suit bias: normalize take counts
  const newSuitBias: Record<string, number> = {}
  for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) {
    const freq = totalTakes > 0 ? (suitTakes[suit] ?? 0) / totalTakes : 0.25
    newSuitBias[suit] = existing.suitBias[suit] !== undefined
      ? existing.suitBias[suit] * (1 - weight) + freq * weight
      : freq
  }

  // Buy rate
  const gameBuyRate = totalRounds > 0 ? buyCount / totalRounds : 0
  const newBuyRate = existing.avgBuyRate * (1 - weight) + gameBuyRate * weight

  // Go-down timing
  const newGoDownRound = existing.avgGoDownRound * (1 - weight) + goDownRound * weight

  // Merge rank patterns
  const newDiscardPatterns = mergeRankPatterns(existing.discardPatterns, rankDiscards, weight)
  const newTakePatterns = mergeRankPatterns(existing.takePatterns, rankTakes, weight)

  const updated: OpponentModel = {
    playerName,
    gamesAnalyzed: n + 1,
    suitBias: newSuitBias,
    avgBuyRate: newBuyRate,
    avgGoDownRound: newGoDownRound,
    discardPatterns: newDiscardPatterns,
    takePatterns: newTakePatterns,
    updatedAt: Date.now(),
  }

  saveOpponentModel(updated)
  return updated
}

function createEmptyModel(playerName: string): OpponentModel {
  return {
    playerName,
    gamesAnalyzed: 0,
    suitBias: { hearts: 0.25, diamonds: 0.25, clubs: 0.25, spades: 0.25 },
    avgBuyRate: 0.5,
    avgGoDownRound: 3,
    discardPatterns: {},
    takePatterns: {},
    updatedAt: Date.now(),
  }
}

function mergeRankPatterns(
  existing: Record<number, number>,
  newCounts: Record<number, number>,
  weight: number,
): Record<number, number> {
  const merged: Record<number, number> = { ...existing }
  for (const [rank, count] of Object.entries(newCounts)) {
    const r = Number(rank)
    merged[r] = (merged[r] ?? 0) * (1 - weight) + count * weight
  }
  return merged
}

function findRoundForAction(
  targetAction: { player_index: number; action_type: string },
  allActions: Array<{ player_index: number; action_type: string; action_data: Record<string, unknown> }>,
): number {
  let lastRound = 1
  for (const a of allActions) {
    if (a.action_type === 'round_start') lastRound = (a.action_data.round as number) ?? lastRound
    if (a === targetAction) break
  }
  return lastRound
}

/**
 * Build AI eval config adjustments based on opponent model.
 * Returns overrides to apply on top of The Shark's base config.
 */
export function buildNemesisOverrides(model: OpponentModel | null): {
  suitDenial: Record<string, number>  // suits to hold longer (higher = more denial)
  buyAggression: number               // +/- adjustment to buy tolerance
  goDownTiming: 'rush' | 'hold' | 'normal'
  avoidDiscardingRanks: number[]      // ranks the opponent frequently takes
} {
  if (!model || model.gamesAnalyzed < 2) {
    return { suitDenial: {}, buyAggression: 0, goDownTiming: 'normal', avoidDiscardingRanks: [] }
  }

  // Suit denial: penalize discarding suits the opponent favors
  const suitDenial: Record<string, number> = {}
  for (const [suit, bias] of Object.entries(model.suitBias)) {
    if (bias > 0.3) suitDenial[suit] = (bias - 0.25) * 100 // 0-75 range
  }

  // Buy aggression: if opponent buys a lot, we should too
  const buyAggression = model.avgBuyRate > 1.5 ? 10 : model.avgBuyRate > 1 ? 5 : 0

  // Go-down timing: counter their timing
  const goDownTiming = model.avgGoDownRound > 4 ? 'rush' : model.avgGoDownRound < 2.5 ? 'hold' : 'normal'

  // Avoid discarding ranks they frequently take
  const avoidDiscardingRanks = Object.entries(model.takePatterns)
    .filter(([, freq]) => freq > 0.5)
    .map(([rank]) => Number(rank))
    .slice(0, 5)

  return { suitDenial, buyAggression, goDownTiming, avoidDiscardingRanks }
}
