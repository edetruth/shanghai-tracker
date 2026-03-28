import type { AIPersonality, Card, Meld, OpponentHistory, Player, RoundRequirement } from './types'
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

  // Try both ace-low (rank 1) and ace-high (rank 14) configurations
  const configs: Card[][] = [sorted]
  if (sorted.some(c => c.rank === 1)) {
    // Create an ace-high variant: treat ace as rank 14
    const aceHighSorted = [...suitCards]
      .sort((a, b) => {
        const ra = a.rank === 1 ? 14 : a.rank
        const rb = b.rank === 1 ? 14 : b.rank
        return ra - rb
      })
    configs.push(aceHighSorted)
  }

  let bestCards: Card[] = [sorted[0]]
  let bestScore = 1

  for (const config of configs) {
    const isAceHigh = config !== sorted
    for (let start = 0; start < config.length; start++) {
      const current: Card[] = [config[start]]
      for (let end = start + 1; end < config.length; end++) {
        const prevRank = isAceHigh && config[end - 1].rank === 1 ? 14 : config[end - 1].rank
        const curRank = isAceHigh && config[end].rank === 1 ? 14 : config[end].rank
        if (curRank - prevRank <= 2 && curRank - prevRank > 0) {
          current.push(config[end])
        } else {
          break
        }
      }
      const firstRank = isAceHigh && current[0].rank === 1 ? 14 : current[0].rank
      const lastRank = isAceHigh && current[current.length - 1].rank === 1 ? 14 : current[current.length - 1].rank
      const gapCount = (lastRank - firstRank + 1) - current.length
      const score = current.length * 2 - gapCount
      if (score > bestScore || (score === bestScore && current.length > bestCards.length)) {
        bestCards = current
        bestScore = score
      }
    }
  }

  // Compute gaps using actual ranks (handle ace-high)
  const hasAce = bestCards.some(c => c.rank === 1)
  const highCards = bestCards.some(c => c.rank >= 10)
  const useAceHigh = hasAce && highCards
  const ranks = bestCards.map(c => useAceHigh && c.rank === 1 ? 14 : c.rank).sort((a, b) => a - b)
  const minRank = ranks[0]
  const maxRank = ranks[ranks.length - 1]
  const rankSet = new Set(ranks)
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
  opponentAware: boolean   // whether to factor opponent danger into discards
  denialTake: boolean      // whether to take cards purely to deny opponents
  dangerWeight: number     // 0-1: how much opponent danger influences discard choice (0 = ignore)
}

const AI_EVAL_CONFIGS: Record<AIPersonality, AIEvalConfig> = {
  'rookie-riley':    { takeThreshold: 8,  buyRiskTolerance: -15, discardNoise: 15, goDownStyle: 'immediate', opponentAware: false, denialTake: false, dangerWeight: 0 },
  'steady-sam':      { takeThreshold: 5,  buyRiskTolerance: -5,  discardNoise: 8,  goDownStyle: 'immediate', opponentAware: false, denialTake: false, dangerWeight: 0 },
  'lucky-lou':       { takeThreshold: 3,  buyRiskTolerance: 10,  discardNoise: 20, goDownStyle: 'immediate', opponentAware: false, denialTake: false, dangerWeight: 0 },
  'patient-pat':     { takeThreshold: 4,  buyRiskTolerance: 0,   discardNoise: 3,  goDownStyle: 'immediate', opponentAware: false, denialTake: false, dangerWeight: 0 },
  'the-shark':       { takeThreshold: 3,  buyRiskTolerance: 2,   discardNoise: 0,  goDownStyle: 'immediate', opponentAware: true,  denialTake: true,  dangerWeight: 0.5 },
  'the-mastermind':  { takeThreshold: 2,  buyRiskTolerance: 5,   discardNoise: 0,  goDownStyle: 'strategic', opponentAware: true,  denialTake: true,  dangerWeight: 0.6 },
}

export function getAIEvalConfig(personality: AIPersonality): AIEvalConfig {
  return AI_EVAL_CONFIGS[personality]
}

// Default config for medium difficulty (used when no personality specified)
const DEFAULT_EVAL_CONFIG: AIEvalConfig = {
  takeThreshold: 4, buyRiskTolerance: 0, discardNoise: 3, goDownStyle: 'immediate',
  opponentAware: false, denialTake: false, dangerWeight: 0,
}

// ── Opponent Danger Scoring ───────────────────────────────────────────────────

/**
 * Score how "dangerous" a card is to discard — i.e. how much it helps opponents.
 * Higher = more dangerous to discard (keep it / find something safer).
 * Returns 0 when no opponent data is available.
 */
function cardDanger(
  card: Card,
  tablesMelds: Meld[],
  opponents?: Player[],
  opponentHistory?: Map<string, OpponentHistory>,
): number {
  if (isJoker(card)) return 0
  let d = 0

  // Check 1: card lays off onto an opponent's existing table meld
  if (opponents) {
    for (const opp of opponents) {
      if (!opp.hasLaidDown) continue
      const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
      if (oppMelds.some(m => canLayOff(card, m))) d += 100
    }
  }

  // Checks from opponent history
  if (opponentHistory) {
    for (const [, hist] of opponentHistory) {
      // Check 2: suit collecting — opponent picked up 2+ of this suit
      const suitPicked = hist.picked.filter(c => c.suit === card.suit).length
      if (suitPicked >= 2) d += 50
      else if (suitPicked === 1) d += 20

      // Check 3: rank collecting — opponent picked up this rank
      if (hist.picked.some(c => c.rank === card.rank)) d += 40

      // Check 4: opponent discarded same suit/rank → safer to discard
      if (hist.discarded.some(c => c.suit === card.suit)) d -= 15
      if (hist.discarded.some(c => c.rank === card.rank)) d -= 10
    }
  }

  return d
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
      score += 40  // complete natural set
    } else if (count === 2) {
      score += 15  // pair — one card or joker away from a set
    } else if (count === 1 && jokerCount >= 2) {
      score += 4   // single with 2 jokers could make a set (weak)
    }
  }

  // === RUN POTENTIAL ===
  // Runs are harder to form (need 4+ cards in sequence) so score them higher
  // to make the AI aggressively pursue run-building cards
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
      score += 45  // complete run (with or without joker fills)
      // Bonus for longer runs — each card beyond 4 is extra safety
      score += (effectiveLength - 4) * 5
      jokersBudgeted += fillableGaps
    } else if (effectiveLength >= 3) {
      score += 25  // nearly complete run (one more card or joker needed)
      jokersBudgeted += fillableGaps
    } else if (windowSize >= 2) {
      score += 10  // 2-card foundation
    } else if (cards.length >= 2) {
      score += 4   // scattered same-suit cards
    }
  }

  // === JOKER VALUE ===
  // Jokers are extremely flexible — they complete any meld type
  for (let j = 0; j < jokerCount; j++) {
    if (j === 0) score += 20
    else if (j === 1) score += 15
    else score += 8
  }

  // === ROUND TYPE WEIGHTING ===
  // Bonus for having progress that matches the round's requirements
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

  score += runReady * 15 * runWeight
  score += setReady * 15 * setWeight

  // === MULTI-RUN COVERAGE BONUS ===
  // For rounds needing 2+ runs, having progress across DISTINCT suits is critical.
  // 3 suits with 2-card windows beats 1 suit with 6 cards, because you need 3 separate runs.
  if (requirement.runs >= 2) {
    const suitsWithProgress = [...bySuit.values()].filter(cards => {
      const w = findBestRunWindow(cards)
      return w.cards.length >= 2
    }).length
    // Bonus scales with how many runs we need vs how many suits we're building
    const coverage = Math.min(suitsWithProgress, requirement.runs)
    score += coverage * 12  // each covered suit is worth 12 points
    // Penalty if we don't have enough suits started for the required runs
    const deficit = requirement.runs - suitsWithProgress
    if (deficit > 0) score -= deficit * 8
  }

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
    if (count >= 3) score += 40
    else if (count === 2) score += 15
    else if (count === 1 && jokerCount >= 2) score += 4
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
      score += 45 + (effectiveLength - 4) * 5; jokersBudgeted += fillableGaps
    } else if (effectiveLength >= 3) {
      score += 25; jokersBudgeted += fillableGaps
    } else if (windowSize >= 2) {
      score += 10
    } else if (cards.length >= 2) {
      score += 4
    }
  }

  for (let j = 0; j < jokerCount; j++) {
    if (j === 0) score += 20
    else if (j === 1) score += 15
    else score += 8
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

  score += runReady * 15 * runWeight
  score += setReady * 15 * setWeight

  // Multi-run coverage bonus (same as evaluateHand)
  if (requirement.runs >= 2) {
    const suitsWithProgress = [...bySuit.values()].filter(cards => {
      const w = findBestRunWindow(cards)
      return w.cards.length >= 2
    }).length
    const coverage = Math.min(suitsWithProgress, requirement.runs)
    score += coverage * 12
    const deficit = requirement.runs - suitsWithProgress
    if (deficit > 0) score -= deficit * 8
  }

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
  // Standard approach: greedy + backtracking
  const result = tryMeldOrder(hand, requirement, 'sets-first')
    ?? (requirement.sets > 0 && requirement.runs > 0
        ? tryMeldOrder(hand, requirement, 'runs-first')
        : null)
  if (result) return result

  // For run-heavy rounds (2+ runs), try suit-permutation greedy search.
  // The standard greedy iterates suits in arbitrary Map order — if the first suit
  // chosen blocks later runs, we miss valid partitions. Try all suit orderings.
  if (requirement.runs >= 2) {
    const suitResult = trySuitPermutationMelds(hand, requirement)
    if (suitResult) return suitResult
  }

  return null
}

/**
 * For run-heavy rounds: try assigning specific suits to each run slot.
 * Generates all permutations of available suits and attempts greedy run-finding
 * from each assigned suit. This catches cases where the default suit iteration
 * order picks a suboptimal first run.
 */
function trySuitPermutationMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  const jokers = hand.filter(isJoker)
  const naturals = hand.filter(c => !isJoker(c))
  const bySuit = groupBySuit(naturals)
  const suits = [...bySuit.keys()]

  // Generate suit orderings to try (permutations of length = runs needed)
  const perms = permutations(suits, requirement.runs)

  for (const suitOrder of perms) {
    const melds: Card[][] = []
    const usedIds = new Set<string>()
    let jokersUsed = 0
    let failed = false

    // First: find runs from assigned suits
    for (const suit of suitOrder) {
      const suitCards = (bySuit.get(suit) ?? []).filter(c => !usedIds.has(c.id))
      const available = jokers.slice(jokersUsed)
      const run = tryFindRunFromCards(suitCards, available)
      if (!run) { failed = true; break }
      run.forEach(c => usedIds.add(c.id))
      jokersUsed += run.filter(isJoker).length
      melds.push(run)
    }
    if (failed) continue

    // Then: find any required sets from remaining cards
    for (let s = 0; s < requirement.sets; s++) {
      const remaining = naturals.filter(c => !usedIds.has(c.id))
      const set = tryFindSet(remaining, jokers, jokersUsed)
      if (!set) { failed = true; break }
      set.forEach(c => usedIds.add(c.id))
      jokersUsed += set.filter(isJoker).length
      melds.push(set)
    }
    if (failed) continue

    return melds
  }
  return null
}

/** Find a valid run from specific same-suit cards + available jokers */
function tryFindRunFromCards(suitCards: Card[], availableJokers: Card[]): Card[] | null {
  if (suitCards.length === 0 && availableJokers.length < MIN_RUN_SIZE) return null
  const seen = new Set<number>()
  const unique: Card[] = []
  for (const card of [...suitCards].sort((a, b) => a.rank - b.rank)) {
    if (!seen.has(card.rank)) { seen.add(card.rank); unique.push(card) }
  }
  // Try with fewest jokers first to conserve them for other runs
  for (let jCount = 0; jCount <= availableJokers.length; jCount++) {
    for (let start = 0; start < unique.length; start++) {
      for (let end = start + Math.max(MIN_RUN_SIZE - jCount, 1); end <= unique.length; end++) {
        const sub = unique.slice(start, end)
        const testCards = [...sub, ...availableJokers.slice(0, jCount)]
        if (testCards.length >= MIN_RUN_SIZE && isValidRun(testCards)) return testCards
      }
    }
  }
  return null
}

/** Generate all permutations of `items` of length `k` */
function permutations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  const result: T[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const perm of permutations(rest, k - 1)) {
      result.push([items[i], ...perm])
    }
  }
  return result
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
  // More candidates for run-heavy rounds — the combinatorial space is larger
  // and greedy choices fail more often when 3 runs must share 12 cards exactly
  const runCount = steps.filter(s => s === 'run').length
  const MAX_CANDIDATES = runCount >= 3 ? 15 : runCount >= 2 ? 10 : 5

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
    // Sort: shortest first (conserve cards), then fewest jokers (conserve jokers for later runs)
    results.sort((a, b) => {
      const lenDiff = a.length - b.length
      if (lenDiff !== 0) return lenDiff
      return a.filter(isJoker).length - b.filter(isJoker).length
    })
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
  tablesMelds: Meld[] = [],
  opponents: Player[] = [],
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
  if (improvement >= config.takeThreshold + sizeAdjust) return true

  // Denial take: take the card to prevent an opponent from getting it,
  // even if it doesn't help our hand. Only for opponent-aware personalities.
  if (config.denialTake && tablesMelds.length > 0 && hand.length < 12) {
    // Card extends a long run (4+) owned by an opponent with few cards left
    for (const opp of opponents) {
      if (!opp.hasLaidDown || opp.hand.length > 4) continue
      const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
      if (oppMelds.some(m => m.type === 'run' && m.cards.length >= 4 && canLayOff(discardCard, m))) {
        // Only denial-take low-point cards (don't bloat hand with Aces/Kings)
        if (cardPoints(discardCard.rank) <= 10) return true
      }
    }
  }

  return false
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

  // Hand size risk — scaled to not block useful buys on normal-sized hands
  const effectiveHandSize = hand.length + 1  // +1 for penalty card
  if (effectiveHandSize >= 16) risk += 40
  else if (effectiveHandSize >= 14) risk += 30
  else if (effectiveHandSize >= 12) risk += 20
  else if (effectiveHandSize >= 10) risk += 10
  else risk += 5

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
 *
 * Opponent-aware personalities also factor in "danger" — how much a discard
 * helps opponents (lays off on their melds, feeds their collection).
 * Self-interest (evaluation) is primary; danger is a secondary tiebreaker
 * weighted by config.dangerWeight.
 */
export function aiChooseDiscard(
  hand: Card[],
  requirement: RoundRequirement,
  config: AIEvalConfig = DEFAULT_EVAL_CONFIG,
  tablesMelds: Meld[] = [],
  opponents?: Player[],
  opponentHistory?: Map<string, OpponentHistory>,
): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  // Never discard jokers (unless hand is ALL jokers)
  const nonJokers = hand.filter(c => !isJoker(c))
  if (nonJokers.length === 0) return hand[0]

  const canMeldFull = aiFindBestMelds(hand, requirement) !== null
  const useOpponentAwareness = config.opponentAware && config.dangerWeight > 0

  let bestDiscard = nonJokers[0]
  let bestScore = -Infinity

  for (const card of nonJokers) {
    const without = hand.filter(c => c.id !== card.id)
    let score = evaluateHandFast(without, requirement, canMeldFull)

    // Opponent danger: penalize discarding cards that help opponents.
    // We SUBTRACT danger from the "keep score" — a dangerous card is less desirable
    // to keep, but we're scoring "hand quality without this card", so a dangerous
    // card to discard gets a BONUS (we want to NOT discard it → lower its without-score).
    // Actually: we want to discard the card with the HIGHEST without-score.
    // A dangerous card should have a LOWER without-score so we DON'T pick it.
    // → Add danger as a penalty to the without-score.
    if (useOpponentAwareness) {
      const danger = cardDanger(card, tablesMelds, opponents, opponentHistory)
      score -= danger * config.dangerWeight
    }

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
  tablesMelds: Meld[] = [],
  opponents: Player[] = [],
): boolean {
  return aiShouldTakeDiscard(hand, discardCard, requirement, hasLaidDown, AI_EVAL_CONFIGS['the-shark'], tablesMelds, opponents)
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
  opponentHistory?: Map<string, OpponentHistory>,
  opponents?: Player[],
  requirement?: RoundRequirement,
): Card {
  const req = requirement ?? { sets: 1, runs: 1, description: '1 Set + 1 Run' }
  return aiChooseDiscard(hand, req, AI_EVAL_CONFIGS['the-shark'], tablesMelds, opponents, opponentHistory)
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
