import type { AIPersonality, Card, Meld, Player, RoundRequirement } from './types'
import { isValidRun, canLayOff, simulateLayOff, findSwappableJoker, canGoOutViaChainLayOff } from './meld-validator'
import { cardPoints, MIN_SET_SIZE, MIN_RUN_SIZE } from './rules'

function isJoker(c: Card): boolean { return c.suit === 'joker' }

function groupByRank(cards: Card[]): Map<number, Card[]> {
  const map = new Map<number, Card[]>()
  for (const c of cards.filter(c => !isJoker(c))) {
    if (!map.has(c.rank)) map.set(c.rank, [])
    map.get(c.rank)!.push(c)
  }
  return map
}

function groupBySuit(cards: Card[]): Map<string, Card[]> {
  const map = new Map<string, Card[]>()
  for (const c of cards.filter(c => !isJoker(c))) {
    if (!map.has(c.suit)) map.set(c.suit, [])
    map.get(c.suit)!.push(c)
  }
  return map
}

function tryFindSet(hand: Card[], allJokers: Card[], jokersUsed: number): Card[] | null {
  const byRank = groupByRank(hand)
  const available = allJokers.slice(jokersUsed)
  for (const [, cards] of byRank) {
    if (cards.length >= MIN_SET_SIZE) return cards.slice(0, MIN_SET_SIZE)
    const needed = MIN_SET_SIZE - cards.length
    if (needed <= available.length) {
      return [...cards, ...available.slice(0, needed)]
    }
  }
  return null
}

function tryFindRun(hand: Card[], allJokers: Card[], jokersUsed: number): Card[] | null {
  const bySuit = groupBySuit(hand)
  const available = allJokers.slice(jokersUsed)
  for (const [, suitCards] of bySuit) {
    const seen = new Set<number>()
    const unique: Card[] = []
    for (const card of [...suitCards].sort((a, b) => a.rank - b.rank)) {
      if (!seen.has(card.rank)) { seen.add(card.rank); unique.push(card) }
    }
    for (let jCount = 0; jCount <= available.length; jCount++) {
      for (let start = 0; start < unique.length; start++) {
        for (let end = start + Math.max(MIN_RUN_SIZE - jCount, 1); end <= unique.length; end++) {
          const sub = unique.slice(start, end)
          const testCards = [...sub, ...available.slice(0, jCount)]
          if (testCards.length >= MIN_RUN_SIZE && isValidRun(testCards)) return testCards
        }
      }
    }
  }
  return null
}

// ── Run-window helpers ────────────────────────────────────────────────────────

interface RunWindow {
  cards: Card[]    // actual Card refs from the hand, sorted ascending by rank
  gaps: number[]   // missing ranks within the span (e.g. [6] if you have 5 and 7)
  minRank: number
  maxRank: number
}

/**
 * Find the best contiguous run-building cluster in a set of same-suit cards.
 * "Contiguous" allows single-rank gaps (diff ≤ 2 between consecutive sorted cards).
 * Returns actual Card references so callers can use card IDs for protection logic.
 */
function findBestRunWindow(suitCards: Card[]): RunWindow {
  if (suitCards.length === 0) return { cards: [], gaps: [], minRank: 0, maxRank: 0 }
  const sorted = [...suitCards].sort((a, b) => a.rank - b.rank)
  if (sorted.length === 1) return { cards: sorted, gaps: [], minRank: sorted[0].rank, maxRank: sorted[0].rank }

  let bestCards: Card[] = [sorted[0]]
  let bestScore = 1

  for (let start = 0; start < sorted.length; start++) {
    const current: Card[] = [sorted[start]]
    for (let end = start + 1; end < sorted.length; end++) {
      if (sorted[end].rank - sorted[end - 1].rank <= 2) {
        current.push(sorted[end])
      } else {
        break
      }
    }
    const gapCount = (current[current.length - 1].rank - current[0].rank + 1) - current.length
    const score = current.length * 2 - gapCount
    if (score > bestScore || (score === bestScore && current.length > bestCards.length)) {
      bestCards = current
      bestScore = score
    }
  }

  const minRank = bestCards[0].rank
  const maxRank = bestCards[bestCards.length - 1].rank
  const rankSet = new Set(bestCards.map(c => c.rank))
  const gaps: number[] = []
  for (let r = minRank + 1; r < maxRank; r++) {
    if (!rankSet.has(r)) gaps.push(r)
  }
  return { cards: bestCards, gaps, minRank, maxRank }
}

// ── AI Evaluation Config ──────────────────────────────────────────────────────

export interface AIEvalConfig {
  takeThreshold: number    // minimum improvement to take discard
  buyRiskTolerance: number // added to improvement when comparing vs risk (positive = more willing)
  discardNoise: number     // random noise added to discard evaluation (0 = optimal)
  goDownStyle: 'immediate' | 'strategic'
}

const AI_EVAL_CONFIGS: Record<AIPersonality, AIEvalConfig> = {
  'rookie-riley':    { takeThreshold: 8,  buyRiskTolerance: -10, discardNoise: 15, goDownStyle: 'immediate' },
  'steady-sam':      { takeThreshold: 5,  buyRiskTolerance: -5,  discardNoise: 8,  goDownStyle: 'immediate' },
  'lucky-lou':       { takeThreshold: 3,  buyRiskTolerance: 5,   discardNoise: 20, goDownStyle: 'immediate' },
  'patient-pat':     { takeThreshold: 4,  buyRiskTolerance: 0,   discardNoise: 3,  goDownStyle: 'immediate' },
  'the-shark':       { takeThreshold: 3,  buyRiskTolerance: 0,   discardNoise: 0,  goDownStyle: 'immediate' },
  'the-mastermind':  { takeThreshold: 2,  buyRiskTolerance: 5,   discardNoise: 0,  goDownStyle: 'strategic' },
}

export function getAIEvalConfig(personality: AIPersonality): AIEvalConfig {
  return AI_EVAL_CONFIGS[personality]
}

// Default config for medium difficulty (used when no personality specified)
const DEFAULT_EVAL_CONFIG: AIEvalConfig = {
  takeThreshold: 4, buyRiskTolerance: 0, discardNoise: 3, goDownStyle: 'immediate',
}

// ── Hand Evaluation System ────────────────────────────────────────────────────

/**
 * Score the entire hand holistically from 0 (nothing useful) to 200+ (ready to go down).
 * This is the core of all AI decisions — every action is evaluated by whether it
 * increases or decreases the hand score.
 */
export function evaluateHand(hand: Card[], requirement: RoundRequirement): number {
  const nonJokers = hand.filter(c => !isJoker(c))
  const jokerCount = hand.filter(isJoker).length
  let score = 0

  // === CAN WE GO DOWN? ===
  const canMeld = aiFindBestMelds(hand, requirement)
  if (canMeld !== null) {
    const meldedIds = new Set(canMeld.flat().map(c => c.id))
    const remaining = hand.filter(c => !meldedIds.has(c.id))
    const remainingPts = remaining.reduce((s, c) => s + cardPoints(c.rank), 0)
    return 200 - remainingPts  // 200 base minus penalty for leftover points
  }

  // === SET POTENTIAL ===
  const byRank = groupByRank(nonJokers)
  for (const [, cards] of byRank) {
    const count = cards.length
    if (count >= 3) {
      score += 30  // complete natural set
    } else if (count === 2) {
      score += 12  // pair — one card or joker away from a set
    } else if (count === 1 && jokerCount >= 2) {
      score += 3   // single with 2 jokers could make a set (weak)
    }
  }

  // === RUN POTENTIAL ===
  const bySuit = groupBySuit(nonJokers)
  let jokersBudgeted = 0  // track jokers "used" across run evaluations to avoid double-counting

  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    const windowSize = window.cards.length
    const gapCount = window.gaps.length
    const availableJokers = Math.max(0, jokerCount - jokersBudgeted)
    const fillableGaps = Math.min(gapCount, availableJokers)
    const effectiveLength = windowSize + fillableGaps

    if (effectiveLength >= 4) {
      score += 35  // complete run (with or without joker fills)
      jokersBudgeted += fillableGaps
    } else if (effectiveLength >= 3) {
      score += 20  // nearly complete run (one more card or joker needed)
      jokersBudgeted += fillableGaps
    } else if (windowSize >= 2) {
      score += 8   // 2-card foundation
    } else if (cards.length >= 2) {
      score += 3   // scattered same-suit cards
    }
  }

  // === JOKER VALUE ===
  for (let j = 0; j < jokerCount; j++) {
    if (j === 0) score += 15
    else if (j === 1) score += 10
    else score += 5
  }

  // === ROUND TYPE WEIGHTING ===
  const totalRequired = requirement.sets + requirement.runs || 1
  const runWeight = requirement.runs / totalRequired
  const setWeight = requirement.sets / totalRequired

  // Count how many potential melds match the round type
  let runReady = 0
  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    if (window.cards.length + Math.min(window.gaps.length, jokerCount) >= 3) runReady++
  }
  let setReady = 0
  for (const [, cards] of byRank) {
    if (cards.length >= 2) setReady++
  }

  score += runReady * 10 * runWeight
  score += setReady * 10 * setWeight

  // === PENALTY: ISOLATED HIGH CARDS ===
  const usefulIds = new Set<string>()
  for (const [, cards] of byRank) {
    if (cards.length >= 2) cards.forEach(c => usefulIds.add(c.id))
  }
  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    // Only count as useful if the window has 2+ cards (single cards aren't run progress)
    if (window.cards.length >= 2) {
      window.cards.forEach(c => usefulIds.add(c.id))
    }
  }

  for (const card of nonJokers) {
    if (!usefulIds.has(card.id)) {
      score -= cardPoints(card.rank) * 0.5
    }
  }

  return score
}

/**
 * Fast variant of evaluateHand that skips the expensive aiFindBestMelds call.
 * Used in discard evaluation loops where we call this once per card in hand.
 * The canMeldFull flag tells us whether the full hand can meld (computed once outside).
 */
export function evaluateHandFast(hand: Card[], requirement: RoundRequirement, canMeldFull: boolean): number {
  // If the full hand could meld, check if this subset still can
  // (removing one card might break it, so we must check)
  if (canMeldFull) {
    const canMeld = aiFindBestMelds(hand, requirement)
    if (canMeld !== null) {
      const meldedIds = new Set(canMeld.flat().map(c => c.id))
      const remaining = hand.filter(c => !meldedIds.has(c.id))
      const remainingPts = remaining.reduce((s, c) => s + cardPoints(c.rank), 0)
      return 200 - remainingPts
    }
  }

  // Same scoring as evaluateHand but without the aiFindBestMelds call
  const nonJokers = hand.filter(c => !isJoker(c))
  const jokerCount = hand.filter(isJoker).length
  let score = 0

  const byRank = groupByRank(nonJokers)
  for (const [, cards] of byRank) {
    const count = cards.length
    if (count >= 3) score += 30
    else if (count === 2) score += 12
    else if (count === 1 && jokerCount >= 2) score += 3
  }

  const bySuit = groupBySuit(nonJokers)
  let jokersBudgeted = 0

  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    const windowSize = window.cards.length
    const gapCount = window.gaps.length
    const availableJokers = Math.max(0, jokerCount - jokersBudgeted)
    const fillableGaps = Math.min(gapCount, availableJokers)
    const effectiveLength = windowSize + fillableGaps

    if (effectiveLength >= 4) {
      score += 35; jokersBudgeted += fillableGaps
    } else if (effectiveLength >= 3) {
      score += 20; jokersBudgeted += fillableGaps
    } else if (windowSize >= 2) {
      score += 8
    } else if (cards.length >= 2) {
      score += 3
    }
  }

  for (let j = 0; j < jokerCount; j++) {
    if (j === 0) score += 15
    else if (j === 1) score += 10
    else score += 5
  }

  const totalRequired = requirement.sets + requirement.runs || 1
  const runWeight = requirement.runs / totalRequired
  const setWeight = requirement.sets / totalRequired

  let runReady = 0
  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    if (window.cards.length + Math.min(window.gaps.length, jokerCount) >= 3) runReady++
  }
  let setReady = 0
  for (const [, cards] of byRank) {
    if (cards.length >= 2) setReady++
  }

  score += runReady * 10 * runWeight
  score += setReady * 10 * setWeight

  const usefulIds = new Set<string>()
  for (const [, cards] of byRank) {
    if (cards.length >= 2) cards.forEach(c => usefulIds.add(c.id))
  }
  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    if (window.cards.length >= 2) {
      window.cards.forEach(c => usefulIds.add(c.id))
    }
  }

  for (const card of nonJokers) {
    if (!usefulIds.has(card.id)) {
      score -= cardPoints(card.rank) * 0.5
    }
  }

  return score
}

// ── Meld finding (unchanged) ─────────────────────────────────────────────────

// Try to find meld groups satisfying the round requirement.
// Uses backtracking: for each required meld slot, generates all candidates and tries each one.
// For mixed rounds, tries sets-first then runs-first ordering.
export function aiFindBestMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  return tryMeldOrder(hand, requirement, 'sets-first')
    ?? (requirement.sets > 0 && requirement.runs > 0
        ? tryMeldOrder(hand, requirement, 'runs-first')
        : null)
}

function tryMeldOrder(
  hand: Card[],
  requirement: RoundRequirement,
  order: 'sets-first' | 'runs-first',
): Card[][] | null {
  const jokers = hand.filter(isJoker)
  const naturals = hand.filter(c => !isJoker(c))

  const steps: Array<'set' | 'run'> = order === 'sets-first'
    ? [...Array(requirement.sets).fill('set'), ...Array(requirement.runs).fill('run')]
    : [...Array(requirement.runs).fill('run'), ...Array(requirement.sets).fill('set')]

  // Fast path: greedy (take first valid meld per step)
  const melds: Card[][] = []
  const usedIds = new Set<string>()
  let jokersUsed = 0
  let greedyFailed = false

  for (const step of steps) {
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const meld = step === 'set'
      ? tryFindSet(remaining, jokers, jokersUsed)
      : tryFindRun(remaining, jokers, jokersUsed)
    if (!meld) { greedyFailed = true; break }
    meld.forEach(c => usedIds.add(c.id))
    jokersUsed += meld.filter(isJoker).length
    melds.push(meld)
  }

  if (!greedyFailed) return melds

  // Fallback: bounded backtracking — try top 5 candidates per step
  return tryMeldOrderBacktrack(naturals, jokers, steps)
}

/** Bounded backtracking: generates limited candidates per step to avoid explosion */
function tryMeldOrderBacktrack(
  naturals: Card[],
  jokers: Card[],
  steps: Array<'set' | 'run'>,
): Card[][] | null {
  const MAX_CANDIDATES = 5

  function findCandidates(remaining: Card[], type: 'set' | 'run', jUsed: number): Card[][] {
    const bySuit = groupBySuit(remaining)
    const byRank = groupByRank(remaining)
    const available = jokers.slice(jUsed)
    const results: Card[][] = []
    const seenKeys = new Set<string>()

    if (type === 'set') {
      for (const [, cards] of byRank) {
        if (cards.length >= MIN_SET_SIZE) {
          results.push(cards.slice(0, MIN_SET_SIZE))
        } else {
          const needed = MIN_SET_SIZE - cards.length
          if (needed <= available.length) {
            results.push([...cards, ...available.slice(0, needed)])
          }
        }
        if (results.length >= MAX_CANDIDATES) break
      }
    } else {
      for (const [, suitCards] of bySuit) {
        const seen = new Set<number>()
        const unique: Card[] = []
        for (const card of [...suitCards].sort((a, b) => a.rank - b.rank)) {
          if (!seen.has(card.rank)) { seen.add(card.rank); unique.push(card) }
        }
        for (let jCount = 0; jCount <= available.length; jCount++) {
          for (let start = 0; start < unique.length; start++) {
            for (let end = start + Math.max(MIN_RUN_SIZE - jCount, 1); end <= unique.length; end++) {
              const sub = unique.slice(start, end)
              const testCards = [...sub, ...available.slice(0, jCount)]
              if (testCards.length >= MIN_RUN_SIZE && isValidRun(testCards)) {
                const key = testCards.map(c => c.id).sort().join(',')
                if (!seenKeys.has(key)) {
                  seenKeys.add(key)
                  results.push(testCards)
                  if (results.length >= MAX_CANDIDATES) return results
                }
              }
            }
          }
        }
      }
    }
    results.sort((a, b) => a.length - b.length)
    return results
  }

  function backtrack(stepIdx: number, usedIds: Set<string>, jUsed: number): Card[][] | null {
    if (stepIdx === steps.length) return []
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const candidates = findCandidates(remaining, steps[stepIdx], jUsed)

    for (const candidate of candidates) {
      const newUsed = new Set(usedIds)
      candidate.forEach(c => newUsed.add(c.id))
      const newJUsed = jUsed + candidate.filter(isJoker).length
      const rest = backtrack(stepIdx + 1, newUsed, newJUsed)
      if (rest !== null) return [candidate, ...rest]
    }
    return null
  }

  return backtrack(0, new Set(), 0)
}

// ── Decision Functions (evaluation-based) ─────────────────────────────────────

/**
 * Should AI take the top discard card?
 * Uses hand evaluation: takes if the card improves hand score above threshold.
 * Config threshold controls personality — high threshold = picky, low = opportunistic.
 */
export function aiShouldTakeDiscard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
  config: AIEvalConfig = DEFAULT_EVAL_CONFIG,
): boolean {
  // Always take jokers
  if (isJoker(discardCard)) return true

  // After laying down, only take via lay-off (handled by GameBoard)
  if (hasLaidDown) return false

  // Core: does taking this card improve hand score?
  const scoreBefore = evaluateHand(hand, requirement)
  const scoreAfter = evaluateHand([...hand, discardCard], requirement)
  const improvement = scoreAfter - scoreBefore

  // Special case: if this card enables going down (score jumps to 150+), always take
  if (scoreAfter >= 150 && scoreBefore < 150) return true

  // Threshold scales with hand size — larger hands are riskier to add to
  const sizeAdjust = hand.length >= 12 ? 3 : hand.length >= 10 ? 1 : 0
  return improvement >= config.takeThreshold + sizeAdjust
}

/**
 * Should AI buy an out-of-turn discard?
 * Buying has a hidden cost (penalty card from draw pile), so the threshold is higher.
 * Uses evaluation improvement vs risk assessment.
 */
export function aiShouldBuy(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining: number,
  config: AIEvalConfig = DEFAULT_EVAL_CONFIG,
  players?: { hand: { length: number }, hasLaidDown: boolean }[],
): boolean {
  if (buysRemaining <= 0) return false

  // Always buy jokers unless hand is already huge (14+ cards)
  if (isJoker(discardCard) && hand.length < 14) return true

  // === VALUE: how much does this card improve my hand? ===
  const scoreBefore = evaluateHand(hand, requirement)
  const scoreAfter = evaluateHand([...hand, discardCard], requirement)
  const improvement = scoreAfter - scoreBefore

  // Special case: if this card enables going down, that's almost always worth buying
  if (scoreAfter >= 150 && scoreBefore < 150) {
    const opponentAboutToWin = players?.some(p => p.hasLaidDown && p.hand.length <= 1)
    if (!opponentAboutToWin) return true
  }

  // === RISK: what's the downside of buying? ===
  let risk = 0

  // Hand size risk
  const effectiveHandSize = hand.length + 1  // +1 for penalty card
  if (effectiveHandSize >= 15) risk += 45
  else if (effectiveHandSize >= 13) risk += 35
  else if (effectiveHandSize >= 11) risk += 25
  else if (effectiveHandSize >= 9) risk += 15
  else risk += 8

  // Opponent pressure
  if (players) {
    const downPlayers = players.filter(p => p.hasLaidDown)
    const minCards = downPlayers.length > 0
      ? Math.min(...downPlayers.map(p => p.hand.length))
      : 99

    if (minCards <= 1) risk += 50
    else if (minCards <= 2) risk += 35
    else if (minCards <= 4) risk += 20
    else if (minCards <= 6) risk += 10

    if (downPlayers.length >= 3) risk += 10
    else if (downPlayers.length >= 2) risk += 5
  }

  // Penalty card cost (random card averages ~7.5 points of dead weight)
  risk += 5

  // === DECISION ===
  // buyRiskTolerance adjusts the threshold: positive = more willing to buy
  return improvement + config.buyRiskTolerance > risk
}

/**
 * Choose best card to discard.
 * For each non-joker card: evaluate hand score without it.
 * Discard the card whose removal hurts least (or helps most).
 * Noise parameter makes weaker AIs occasionally discard good cards.
 */
export function aiChooseDiscard(
  hand: Card[],
  requirement: RoundRequirement,
  config: AIEvalConfig = DEFAULT_EVAL_CONFIG,
  _tablesMelds: Meld[] = [],
): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  // Never discard jokers (unless hand is ALL jokers)
  const nonJokers = hand.filter(c => !isJoker(c))
  if (nonJokers.length === 0) return hand[0]

  const canMeldFull = aiFindBestMelds(hand, requirement) !== null

  let bestDiscard = nonJokers[0]
  let bestScore = -Infinity

  for (const card of nonJokers) {
    const without = hand.filter(c => c.id !== card.id)
    let score = evaluateHandFast(without, requirement, canMeldFull)

    // Add random noise for weaker personalities
    if (config.discardNoise > 0) {
      score += (Math.random() - 0.5) * config.discardNoise * 2
    }

    if (score > bestScore) {
      bestScore = score
      bestDiscard = card
    }
  }

  return bestDiscard
}

// ── Legacy API wrappers (for backward compatibility with existing call sites) ──

/** @deprecated Use aiShouldTakeDiscard with config */
export function aiShouldTakeDiscardEasy(hand: Card[], discardCard: Card, requirement: RoundRequirement): boolean {
  return aiShouldTakeDiscard(hand, discardCard, requirement, false, AI_EVAL_CONFIGS['rookie-riley'])
}

/** @deprecated Use aiShouldTakeDiscard with config */
export function aiShouldTakeDiscardHard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
  _tablesMelds: Meld[] = [],
  _opponents: Player[] = [],
): boolean {
  return aiShouldTakeDiscard(hand, discardCard, requirement, hasLaidDown, AI_EVAL_CONFIGS['the-shark'])
}

/** @deprecated Use aiChooseDiscard with config */
export function aiChooseDiscardEasy(hand: Card[]): Card {
  if (hand.length === 0) throw new Error('Empty hand')
  // Easy AI uses a simple "isolated high card" heuristic as fallback
  // but through evaluation with high noise it achieves similar results
  const nonJokers = hand.filter(c => !isJoker(c))
  const candidates = nonJokers.length > 0 ? nonJokers : hand

  // Find cards with no same-suit neighbor at rank ± 1
  const isolated = candidates.filter(card =>
    !candidates.some(other =>
      other.id !== card.id &&
      other.suit === card.suit &&
      Math.abs(other.rank - card.rank) === 1
    )
  )
  const pool = isolated.length > 0 ? isolated : candidates

  const maxPts = Math.max(...pool.map(c => cardPoints(c.rank)))
  const best = pool.filter(c => cardPoints(c.rank) === maxPts)
  return best[Math.floor(Math.random() * best.length)]
}

/** @deprecated Use aiChooseDiscard with config */
export function aiChooseDiscardHard(
  hand: Card[],
  tablesMelds: Meld[] = [],
  _opponentHistory?: Map<string, unknown>,
  _opponents?: Player[],
  requirement?: RoundRequirement,
): Card {
  if (!requirement) {
    // Fallback: use default requirement (shouldn't happen in practice)
    return aiChooseDiscard(hand, { sets: 1, runs: 1, description: '1 Set + 1 Run' }, AI_EVAL_CONFIGS['the-shark'], tablesMelds)
  }
  return aiChooseDiscard(hand, requirement, AI_EVAL_CONFIGS['the-shark'], tablesMelds)
}

/** @deprecated Use aiShouldBuy with config */
export function aiShouldBuyEasy(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining: number,
  _buyLimit = 5,
): boolean {
  return aiShouldBuy(hand, discardCard, requirement, buysRemaining, AI_EVAL_CONFIGS['rookie-riley'])
}

/** @deprecated Use aiShouldBuy with config */
export function aiShouldBuyHard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining: number,
  _tablesMelds: Meld[] = [],
  opponents: Player[] = [],
): boolean {
  return aiShouldBuy(hand, discardCard, requirement, buysRemaining, AI_EVAL_CONFIGS['the-shark'],
    opponents.map(p => ({ hand: { length: p.hand.length }, hasLaidDown: p.hasLaidDown })))
}

// ── Remaining functions (unchanged) ───────────────────────────────────────────

// Check whether any valid meld (set or run) can be formed from the given cards
export function canFormAnyValidMeld(cards: Card[], allowedTypes: 'set' | 'run' | 'both' = 'both'): boolean {
  const jokers = cards.filter(isJoker)
  const naturals = cards.filter(c => !isJoker(c))
  if (allowedTypes !== 'run' && tryFindSet(naturals, jokers, 0) !== null) return true
  if (allowedTypes !== 'set' && tryFindRun(naturals, jokers, 0) !== null) return true
  return false
}

// Find required melds PLUS any additional valid melds from remaining cards (AI lay-down)
export function aiFindAllMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  const requiredMelds = aiFindBestMelds(hand, requirement)
  if (!requiredMelds) return null

  const allowsSets = requirement.sets > 0
  const allowsRuns = requirement.runs > 0

  const allMelds = [...requiredMelds]
  const usedIds = new Set(requiredMelds.flatMap(m => m.map(c => c.id)))

  let found = true
  while (found) {
    found = false
    const remaining = hand.filter(c => !usedIds.has(c.id))
    const jokers = remaining.filter(isJoker)
    const naturals = remaining.filter(c => !isJoker(c))

    if (allowsSets) {
      const set = tryFindSet(naturals, jokers, 0)
      if (set) {
        set.forEach(c => usedIds.add(c.id))
        allMelds.push(set)
        found = true
        continue
      }
    }

    if (allowsRuns) {
      const run = tryFindRun(naturals, jokers, 0)
      if (run) {
        run.forEach(c => usedIds.add(c.id))
        allMelds.push(run)
        found = true
      }
    }
  }

  return allMelds
}

// Before laying down: check if swapping jokers from table melds would enable
// meeting the round requirement.
export function aiFindPreLayDownJokerSwap(
  hand: Card[],
  tablesMelds: Meld[],
  requirement: RoundRequirement
): { card: Card; meld: Meld } | null {
  const candidates: { card: Card; meld: Meld; joker: Card }[] = []
  for (const card of hand) {
    if (isJoker(card)) continue
    for (const meld of tablesMelds) {
      const joker = findSwappableJoker(card, meld)
      if (!joker) continue
      candidates.push({ card, meld, joker })
    }
  }

  // Try single swaps first
  for (const { card, meld, joker } of candidates) {
    const simulatedHand = [...hand.filter(c => c.id !== card.id), joker]
    if (aiFindBestMelds(simulatedHand, requirement)) return { card, meld }
  }

  // Try pairs of swaps
  for (let i = 0; i < candidates.length; i++) {
    const { card: c1, meld: m1, joker: j1 } = candidates[i]
    const hand1 = [...hand.filter(c => c.id !== c1.id), j1]
    const melds1 = tablesMelds.map(m => {
      if (m.id !== m1.id) return m
      const newCards = m.cards.map(c => c.id === j1.id ? c1 : c)
      const newMappings = m.jokerMappings.filter(jm => jm.cardId !== j1.id)
      return { ...m, cards: newCards, jokerMappings: newMappings }
    })
    for (let k = i + 1; k < candidates.length; k++) {
      const { card: c2, meld: m2 } = candidates[k]
      if (c2.id === c1.id) continue
      const targetMeld2 = melds1.find(m => m.id === m2.id)
      if (!targetMeld2) continue
      const joker2 = findSwappableJoker(c2, targetMeld2)
      if (!joker2) continue
      const hand2 = [...hand1.filter(c => c.id !== c2.id), joker2]
      if (aiFindBestMelds(hand2, requirement)) return { card: c1, meld: m1 }
    }
  }

  return null
}

// For a joker being laid off on a run, choose the end that maximises future potential.
export function aiChooseJokerLayOffPosition(meld: Meld): 'low' | 'high' {
  const roomBelow = (meld.runMin ?? 1) - 1
  const roomAbove = 14 - (meld.runMax ?? 13)
  if (roomBelow <= 0) return 'high'
  if (roomAbove <= 0) return 'low'
  return roomBelow >= roomAbove ? 'low' : 'high'
}

// Find a card in hand that can be laid off on any of the given melds.
// Jokers are prioritised first. Skips lay-offs that would strand the AI.
export function aiFindLayOff(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null {
  const jokers = hand.filter(c => c.suit === 'joker')
  const nonJokers = hand.filter(c => c.suit !== 'joker')
  const prioritisedHand = [...jokers, ...nonJokers]

  for (const card of prioritisedHand) {
    for (const meld of tablesMelds) {
      if (canLayOff(card, meld)) {
        const jokerPosition = (card.suit === 'joker' && meld.type === 'run')
          ? aiChooseJokerLayOffPosition(meld)
          : undefined
        const remaining = hand.filter(c => c.id !== card.id)
        if (remaining.length === 1) {
          const updatedMelds = tablesMelds.map(m => m.id === meld.id ? simulateLayOff(card, meld, jokerPosition) : m)
          if (!canGoOutViaChainLayOff(remaining, updatedMelds)) {
            continue
          }
        }
        return { card, meld, jokerPosition }
      }
    }
  }
  return null
}

// Hard mode: strategic going-down timing
export function aiShouldGoDownHard(
  hand: Card[],
  melds: Card[][],
  _requirement: RoundRequirement,
  tablesMelds: Meld[],
  players: Player[],
  currentPlayerIndex: number,
  turnsWaited: number,
): boolean {
  const meldedIds = new Set(melds.flatMap(m => m.map(c => c.id)))
  const remaining = hand.filter(c => !meldedIds.has(c.id))

  // Always go down: going out immediately (0 remaining cards)
  if (remaining.length === 0) return true

  // Always go down: can go out via chain lay-offs
  if (remaining.length <= 3 && tablesMelds.length > 0) {
    if (canGoOutViaChainLayOff(remaining, tablesMelds)) return true
  }

  // Always go down: an opponent has already laid down
  if (players.some((p, i) => i !== currentPlayerIndex && p.hasLaidDown)) return true

  // Always go down: waited 3+ turns already
  if (turnsWaited >= 3) return true

  // Always go down: any opponent has 4 or fewer cards
  if (players.some((p, i) => i !== currentPlayerIndex && p.hand.length <= 4)) return true

  // Consider waiting
  const stuckPoints = remaining.reduce((sum, c) => sum + cardPoints(c.rank), 0)
  const allOpponentsHaveMany = players.every((p, i) =>
    i === currentPlayerIndex || p.hand.length >= 7
  )

  const hasLayOffPotential = remaining.length <= 2 && remaining.some(c =>
    melds.some(meldCards => {
      const nonJokers = meldCards.filter(mc => !isJoker(mc))
      if (nonJokers.length === 0) return false
      if (nonJokers.every(mc => mc.rank === nonJokers[0].rank) && c.rank === nonJokers[0].rank) return true
      const runSuit = nonJokers[0].suit
      if (nonJokers.every(mc => mc.suit === runSuit) && c.suit === runSuit) {
        const ranks = nonJokers.map(mc => mc.rank).sort((a, b) => a - b)
        if (c.rank === ranks[0] - 1 || c.rank === ranks[ranks.length - 1] + 1) return true
      }
      return false
    })
  )

  if (stuckPoints >= 40 && remaining.length <= 2 && hasLayOffPotential && allOpponentsHaveMany) {
    return false
  }

  if (stuckPoints >= 40 && remaining.length >= 4 && allOpponentsHaveMany) {
    return false
  }

  return true
}

// Find a natural card in hand that can be swapped with a joker on the table
export function aiFindJokerSwap(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld } | null {
  for (const card of hand.filter(c => c.suit !== 'joker')) {
    for (const meld of tablesMelds) {
      if (meld.jokerMappings.length > 0) {
        const joker = findSwappableJoker(card, meld)
        if (joker) return { card, meld }
      }
    }
  }
  return null
}
