import type { AIPersonality, Card, Meld, OpponentHistory, Player, RoundRequirement } from './types'
import { isValidRun, canLayOff, simulateLayOff, findSwappableJoker, canGoOutViaChainLayOff } from './meld-validator'
import { cardPoints, MIN_SET_SIZE, MIN_RUN_SIZE } from './rules'
import type { CardTracker } from './card-tracker'
import { sampleOpponentHands } from './hand-inference'

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
  'the-nemesis':     { takeThreshold: 3,  buyRiskTolerance: 5,   discardNoise: 0,  goDownStyle: 'strategic', opponentAware: true,  denialTake: true,  dangerWeight: 0.6 },
}

export function getAIEvalConfig(personality: AIPersonality): AIEvalConfig {
  return AI_EVAL_CONFIGS[personality]
}

// Default config for medium difficulty (used when no personality specified)
const DEFAULT_EVAL_CONFIG: AIEvalConfig = {
  takeThreshold: 4, buyRiskTolerance: 0, discardNoise: 3, goDownStyle: 'immediate',
  opponentAware: false, denialTake: false, dangerWeight: 0,
}

// ── Live Opponent Profiling ──────────────────────────────────────────────────

/** Live in-game opponent profiling — updates every turn based on observations */
interface LiveOpponentProfile {
  suitStrength: Record<string, number>  // 0-1 confidence that opponent is building in this suit
  rankInterest: Record<number, number>  // 0-1 confidence that opponent wants this rank
  aggressiveness: number                 // 0-1 how aggressively they're playing (pick rate)
  estimatedProgress: number              // 0-1 how close to laying down (based on hand size)
  turnsObserved: number
}

/**
 * Build a live opponent profile from their observable history this game.
 * Confidence increases with more observations — early-game signals carry less weight.
 */
function buildLiveProfile(
  history: OpponentHistory,
  handSize: number,
  hasLaidDown: boolean,
  expectedHandSize: number,
): LiveOpponentProfile {
  const profile: LiveOpponentProfile = {
    suitStrength: { hearts: 0, diamonds: 0, clubs: 0, spades: 0 },
    rankInterest: {},
    aggressiveness: 0,
    estimatedProgress: 0,
    turnsObserved: 0,
  }

  // Count suit picks and discards
  const suitPicks = new Map<string, number>()
  const suitDiscards = new Map<string, number>()
  const rankPicks = new Map<number, number>()
  let totalPicks = 0

  for (const c of history.picked) {
    if (c.suit !== 'joker') {
      suitPicks.set(c.suit, (suitPicks.get(c.suit) ?? 0) + 1)
      rankPicks.set(c.rank, (rankPicks.get(c.rank) ?? 0) + 1)
      totalPicks++
    }
  }
  for (const c of history.discarded) {
    if (c.suit !== 'joker') {
      suitDiscards.set(c.suit, (suitDiscards.get(c.suit) ?? 0) + 1)
    }
  }

  // Suit strength: picks minus discards (discounts), normalized
  if (totalPicks > 0) {
    for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) {
      const picks = suitPicks.get(suit) ?? 0
      const discards = suitDiscards.get(suit) ?? 0
      const net = picks - discards * 0.5
      profile.suitStrength[suit] = Math.min(1, Math.max(0, net / Math.max(totalPicks, 1)))
    }
  }

  // Rank interest: based on picked ranks, 3 picks = full confidence
  for (const [rank, count] of rankPicks) {
    profile.rankInterest[rank] = Math.min(1, count / 3)
  }

  // Turns observed: total observable actions (picks + discards)
  profile.turnsObserved = totalPicks + history.discarded.filter(c => c.suit !== 'joker').length

  // Aggressiveness: pick rate relative to total observations
  if (profile.turnsObserved > 0) {
    profile.aggressiveness = Math.min(1, totalPicks / Math.max(profile.turnsObserved, 1))
  }

  // Estimated progress: already laid down = 1, otherwise infer from hand size shrinkage
  if (hasLaidDown) {
    profile.estimatedProgress = 1
  } else {
    // Smaller hand relative to expected = closer to ready
    profile.estimatedProgress = Math.min(1, Math.max(0, (expectedHandSize - handSize + 4) / 8))
  }

  return profile
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
  // This is the most critical check — feeding an opponent who has laid down
  // directly helps them go out. Scale danger by how close they are to winning.
  if (opponents) {
    for (const opp of opponents) {
      if (!opp.hasLaidDown) continue
      const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
      if (oppMelds.some(m => canLayOff(card, m))) {
        if (opp.hand.length <= 1) d += 500       // one lay-off from going out
        else if (opp.hand.length <= 3) d += 300   // very close to going out
        else if (opp.hand.length <= 5) d += 200   // actively clearing hand
        else d += 150                              // laid down, any feed helps them
      }
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

      // Check 5: Run window detection — if opponent picked 2+ same-suit cards
      // with near-adjacent ranks, they're likely building a run. Discarding a card
      // that fills a gap in that sequence is extremely dangerous.
      const suitPicks = hist.picked.filter(c => c.suit === card.suit && !isJoker(c))
      if (suitPicks.length >= 2) {
        const pickedRanks = suitPicks.map(c => c.rank).sort((a, b) => a - b)
        for (let i = 0; i < pickedRanks.length - 1; i++) {
          const lo = pickedRanks[i]
          const hi = pickedRanks[i + 1]
          // Card fills an exact gap between two picked cards (e.g. picked 5,7 and discarding 6)
          if (hi - lo === 2 && card.rank === lo + 1) d += 60
          // Card is adjacent to a picked pair forming a tight sequence
          else if (hi - lo <= 2) {
            if (card.rank === lo - 1 || card.rank === hi + 1) d += 30
          }
        }
      }
    }
  }

  // Live profile-based danger: confidence-weighted scoring from accumulated observations.
  // Adds nuance beyond the raw pick/discard checks above — net suit strength (picks minus
  // discards), rank interest scaling, and progress-based danger amplification.
  if (opponents && opponentHistory) {
    for (const opp of opponents) {
      const hist = opponentHistory.get(opp.id)
      if (!hist) continue
      // Derive expected hand size from whether opponent is in a 10-card or 12-card round
      // (we don't have roundNumber here, but hand sizes > 11 imply 12-card rounds)
      const expectedSize = opp.hand.length > 11 || opp.melds.length > 0 ? 12 : 10
      const profile = buildLiveProfile(hist, opp.hand.length, opp.hasLaidDown, expectedSize)
      // Require minimum observations before trusting the profile
      const confidence = Math.min(1, profile.turnsObserved / 6)
      if (confidence < 0.15) continue

      // Suit danger: high confidence that opponent is building in this suit
      const suitDanger = profile.suitStrength[card.suit] ?? 0
      if (suitDanger > 0.3) {
        d += Math.round(suitDanger * 40 * confidence)
      }

      // Rank danger: opponent has shown repeated interest in this rank
      const rankDanger = profile.rankInterest[card.rank] ?? 0
      if (rankDanger > 0.3) {
        d += Math.round(rankDanger * 25 * confidence)
      }

      // Progress danger: opponent close to going down makes all discards riskier
      if (profile.estimatedProgress > 0.7 && !opp.hasLaidDown) {
        d += Math.round(profile.estimatedProgress * 15 * confidence)
      }
    }
  }

  return d
}

// ── Opponent Hand Reading ─────────────────────────────────────────────────────

/**
 * Infer what suits and ranks an opponent likely needs based on their pick/discard history.
 * Used by Shark/Mastermind to avoid feeding opponents.
 */
function inferOpponentNeeds(
  opponentHistory: Map<string, OpponentHistory>,
  _tableMelds: Meld[],
): Map<string, { likelySuits: Set<string>; likelyRanks: Set<number> }> {
  const needs = new Map<string, { likelySuits: Set<string>; likelyRanks: Set<number> }>()
  for (const [oppId, hist] of opponentHistory) {
    const likelySuits = new Set<string>()
    const likelyRanks = new Set<number>()
    // Cards they picked are strong signals of what they need
    for (const c of hist.picked) {
      if (!isJoker(c)) {
        likelySuits.add(c.suit)
        likelyRanks.add(c.rank)
      }
    }
    // Cards they discarded are negative signals — remove from likely needs
    const discardedSuits = new Set<string>()
    const discardedRanks = new Set<number>()
    for (const c of hist.discarded) {
      if (!isJoker(c)) {
        discardedSuits.add(c.suit)
        discardedRanks.add(c.rank)
      }
    }
    // A suit they discarded multiple times is unlikely to be needed
    const suitDiscardCounts = new Map<string, number>()
    for (const c of hist.discarded) {
      if (!isJoker(c)) suitDiscardCounts.set(c.suit, (suitDiscardCounts.get(c.suit) ?? 0) + 1)
    }
    for (const [suit, count] of suitDiscardCounts) {
      if (count >= 2) likelySuits.delete(suit)
    }
    // A rank they discarded is unlikely to be needed
    for (const r of discardedRanks) likelyRanks.delete(r)

    needs.set(oppId, { likelySuits, likelyRanks })
  }
  return needs
}

// ── Round-Aware Strategy ─────────────────────────────────────────────────────

/**
 * Returns strategy weights based on the round requirement type.
 * Used by Shark/Mastermind to adjust discard scoring.
 */
function getRoundStrategy(requirement: RoundRequirement): {
  suitWeight: number    // how much to value same-suit cards (0-1)
  rankWeight: number    // how much to value same-rank cards (0-1)
  holdJokersLonger: boolean
} {
  if (requirement.runs === 0) return { suitWeight: 0.2, rankWeight: 0.9, holdJokersLonger: false }
  if (requirement.sets === 0) return { suitWeight: 0.9, rankWeight: 0.2, holdJokersLonger: true }
  return { suitWeight: 0.5, rankWeight: 0.5, holdJokersLonger: requirement.runs > requirement.sets }
}

// ── Discard Lookahead (uses CardTracker + HandInference) ─────────────────────

/**
 * Estimate how much a discard would help opponents, using Monte Carlo hand inference.
 * Replaces heuristic cardDanger() when a CardTracker is available.
 *
 * For each opponent: sample 10 possible hands, simulate them receiving the card,
 * measure average hand improvement, weight by proximity to going down.
 */
function discardDangerWithLookahead(
  card: Card,
  tracker: CardTracker,
  opponents: Player[],
  opponentHistory: Map<string, OpponentHistory> | undefined,
  requirement: RoundRequirement,
  tablesMelds: Meld[],
): number {
  if (isJoker(card)) return 0
  let totalDanger = 0

  for (const opp of opponents) {
    // Get pick history for this opponent (for weighting hand samples)
    const hist = opponentHistory?.get(opp.id)
    const pickHistory = hist?.picked ?? []

    // Proximity weight: opponents closer to winning are more dangerous to feed
    let proximityWeight = 1.0
    if (opp.hasLaidDown) {
      if (opp.hand.length <= 1) proximityWeight = 5.0
      else if (opp.hand.length <= 3) proximityWeight = 3.0
      else proximityWeight = 2.0
    }

    // Check direct lay-off threat (table melds — no inference needed)
    const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
    for (const m of oppMelds) {
      if (canLayOff(card, m)) {
        totalDanger += 80 * proximityWeight
      }
    }

    // Skip hand inference for opponents who have already laid down
    // (their strategy is just lay-off/empty hand, inference adds little)
    if (opp.hasLaidDown) continue

    // Sample possible opponent hands and measure how much this card helps them
    const samples = sampleOpponentHands(tracker, opp.hand.length, pickHistory, 10)
    if (samples.length === 0) continue

    let totalImprovement = 0
    for (const sampleHand of samples) {
      const scoreBefore = evaluateHandFast(sampleHand, requirement, false)
      const scoreAfter = evaluateHandFast([...sampleHand, card], requirement, false)
      const improvement = scoreAfter - scoreBefore
      if (improvement > 0) totalImprovement += improvement
    }
    const avgImprovement = totalImprovement / samples.length

    // Scale: an average improvement of 20+ is very significant
    totalDanger += avgImprovement * proximityWeight
  }

  return totalDanger
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
      score += requirement.sets > 0 ? 15 : 0  // pair only useful if sets required
    } else if (count === 1 && jokerCount >= 2) {
      score += 4   // single with 2 jokers could make a set (weak)
    }
  }

  // === RUN POTENTIAL ===
  // Runs are harder to form (need 4+ cards in sequence) so score them higher
  // to make the AI aggressively pursue run-building cards
  const bySuit = groupBySuit(nonJokers)

  // Pass 1: collect all windows without assigning jokers
  const suitWindows: { windowSize: number; gapCount: number; cards: Card[] }[] = []
  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    suitWindows.push({ windowSize: window.cards.length, gapCount: window.gaps.length, cards: window.cards })
  }

  // Pass 2: assign jokers optimally — prioritize windows that cross the 4-card run threshold
  suitWindows.sort((a, b) => {
    const aCanComplete = (a.windowSize + Math.min(a.gapCount, jokerCount)) >= 4 ? 1 : 0
    const bCanComplete = (b.windowSize + Math.min(b.gapCount, jokerCount)) >= 4 ? 1 : 0
    if (aCanComplete !== bCanComplete) return bCanComplete - aCanComplete  // completable first
    return b.windowSize - a.windowSize  // then by natural card count
  })

  let jokersRemaining = jokerCount
  const jokerAssignments: number[] = suitWindows.map(w => {
    const assign = Math.min(w.gapCount, jokersRemaining)
    jokersRemaining -= assign
    return assign
  })

  // Pass 3: score each window with optimally-assigned jokers
  for (let i = 0; i < suitWindows.length; i++) {
    const { windowSize, cards } = suitWindows[i]
    const fillableGaps = jokerAssignments[i]
    const effectiveLength = windowSize + fillableGaps

    if (effectiveLength >= 4) {
      score += 45  // complete run (with or without joker fills)
      // Bonus for longer runs — each card beyond 4 is extra safety
      score += (effectiveLength - 4) * 5
    } else if (effectiveLength >= 3) {
      score += 25  // nearly complete run (one more card or joker needed)
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
    const coverageBonus = requirement.runs >= 3 ? 20 : 15  // R7 gets highest bonus
    score += coverage * coverageBonus
    // Penalty if we don't have enough suits started for the required runs
    const deficit = requirement.runs - suitsWithProgress
    if (deficit > 0) score -= deficit * (requirement.runs >= 3 ? 15 : 10)  // Harsh penalty for missing suits in R7
  }

  // === PENALTY: ISOLATED HIGH CARDS ===
  const usefulIds = new Set<string>()
  for (const [, cards] of byRank) {
    if (cards.length >= 3) {
      cards.forEach(c => usefulIds.add(c.id))  // complete sets always useful
    } else if (cards.length >= 2 && requirement.sets > 0) {
      cards.forEach(c => usefulIds.add(c.id))  // pairs only useful if sets required
    }
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
    else if (count === 2) score += (requirement.sets > 0 ? 15 : 0)
    else if (count === 1 && jokerCount >= 2) score += 4
  }

  const bySuit = groupBySuit(nonJokers)

  // Pass 1: collect all windows without assigning jokers
  const suitWindowsFast: { windowSize: number; gapCount: number; cards: Card[] }[] = []
  for (const [, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    suitWindowsFast.push({ windowSize: window.cards.length, gapCount: window.gaps.length, cards: window.cards })
  }

  // Pass 2: assign jokers optimally — prioritize windows that cross the 4-card run threshold
  suitWindowsFast.sort((a, b) => {
    const aCanComplete = (a.windowSize + Math.min(a.gapCount, jokerCount)) >= 4 ? 1 : 0
    const bCanComplete = (b.windowSize + Math.min(b.gapCount, jokerCount)) >= 4 ? 1 : 0
    if (aCanComplete !== bCanComplete) return bCanComplete - aCanComplete
    return b.windowSize - a.windowSize
  })

  let jokersRemainingFast = jokerCount
  const jokerAssignmentsFast: number[] = suitWindowsFast.map(w => {
    const assign = Math.min(w.gapCount, jokersRemainingFast)
    jokersRemainingFast -= assign
    return assign
  })

  // Pass 3: score each window with optimally-assigned jokers
  for (let i = 0; i < suitWindowsFast.length; i++) {
    const { windowSize, cards } = suitWindowsFast[i]
    const fillableGaps = jokerAssignmentsFast[i]
    const effectiveLength = windowSize + fillableGaps

    if (effectiveLength >= 4) {
      score += 45 + (effectiveLength - 4) * 5
    } else if (effectiveLength >= 3) {
      score += 25
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
    const coverageBonus = requirement.runs >= 3 ? 20 : 15
    score += coverage * coverageBonus
    const deficit = requirement.runs - suitsWithProgress
    if (deficit > 0) score -= deficit * (requirement.runs >= 3 ? 15 : 10)
  }

  const usefulIds = new Set<string>()
  for (const [, cards] of byRank) {
    if (cards.length >= 3) {
      cards.forEach(c => usefulIds.add(c.id))
    } else if (cards.length >= 2 && requirement.sets > 0) {
      cards.forEach(c => usefulIds.add(c.id))
    }
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
 * Smart meld selection: picks the combination that leaves remaining cards
 * with the best lay-off potential onto existing table melds.
 *
 * Falls back to standard aiFindBestMelds when there are no table melds
 * or only one candidate exists.
 */
export function aiFindBestMeldsForLayOff(
  hand: Card[],
  requirement: RoundRequirement,
  tablesMelds: Meld[],
): Card[][] | null {
  // If no table melds to lay off onto, fall back to standard
  if (tablesMelds.length === 0) return aiFindBestMelds(hand, requirement)

  // Get up to 2 candidate meld combinations cheaply (sets-first vs runs-first)
  const candidates: Card[][][] = []
  const seenKeys = new Set<string>()

  function addIfNew(melds: Card[][] | null) {
    if (!melds) return
    const key = melds.map(m => m.map(c => c.id).sort().join(',')).sort().join('|')
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    candidates.push(melds)
  }

  addIfNew(tryMeldOrder(hand, requirement, 'sets-first'))
  if (requirement.sets > 0 && requirement.runs > 0) {
    addIfNew(tryMeldOrder(hand, requirement, 'runs-first'))
  }

  // Generate alternative set-subset candidates when a rank has 4+ cards.
  // For R1 (2 sets) / R2 (1 set + 1 run), different choices of WHICH 3 cards
  // form a set can leave different leftover cards with better lay-off potential.
  if (requirement.sets > 0 && candidates.length > 0) {
    const baseCandidate = candidates[0]
    const naturals = hand.filter(c => !isJoker(c))
    const byRank = groupByRank(naturals)

    // Find sets in the base candidate that use a rank with 4+ available cards
    for (let mi = 0; mi < baseCandidate.length; mi++) {
      const meld = baseCandidate[mi]
      const meldNaturals = meld.filter(c => !isJoker(c))
      if (meldNaturals.length < MIN_SET_SIZE) continue  // mostly jokers, skip
      const meldRank = meldNaturals[0].rank
      // Check all cards of this rank share the same rank (it's a set)
      if (!meldNaturals.every(c => c.rank === meldRank)) continue
      const allOfRank = byRank.get(meldRank)
      if (!allOfRank || allOfRank.length <= MIN_SET_SIZE) continue  // no extra cards

      // Generate all C(n, MIN_SET_SIZE) subsets of this rank's cards
      const jokerCount = meld.filter(isJoker).length
      const combos = combinations(allOfRank, MIN_SET_SIZE - jokerCount)
      const meldJokers = meld.filter(isJoker)
      for (const combo of combos) {
        const altMeld = [...combo, ...meldJokers]
        const altCandidate = [...baseCandidate]
        altCandidate[mi] = altMeld
        addIfNew(altCandidate)
        if (candidates.length >= 8) break  // cap total candidates
      }
      if (candidates.length >= 8) break
    }
  }

  if (candidates.length === 0) return aiFindBestMelds(hand, requirement)
  if (candidates.length === 1) return candidates[0]

  // Also consider lay-off potential onto the melds the player is ABOUT to lay down
  // (other players' table melds + the candidate's own melds become available)
  function scoreMeldChoice(melds: Card[][]): number {
    const meldedIds = new Set(melds.flat().map(c => c.id))
    const remaining = hand.filter(c => !meldedIds.has(c.id))

    if (remaining.length === 0) return 10000  // perfect — no leftovers

    // Combined melds: existing table melds + the melds being laid down
    const allMelds = [...tablesMelds, ...melds.map(cards => ({ cards } as Meld))]

    let score = 0

    // Can go out via chain lay-offs?
    if (remaining.length <= 4 && canGoOutViaChainLayOff(remaining, allMelds)) {
      score += 1000
    }

    // Count lay-off-able remaining cards (against both table and own new melds)
    for (const c of remaining) {
      if (allMelds.some(m => canLayOff(c, m))) score += 50
    }

    // Penalize remaining points and count
    score -= remaining.reduce((s, c) => s + cardPoints(c.rank), 0)
    score -= remaining.length * 10

    return score
  }

  // Score each by lay-off potential of remaining cards
  let bestMelds = candidates[0]
  let bestScore = -Infinity

  for (const melds of candidates) {
    const score = scoreMeldChoice(melds)
    if (score >= 10000) return melds  // no leftovers — perfect
    if (score > bestScore) {
      bestScore = score
      bestMelds = melds
    }
  }

  return bestMelds
}

/** Generate all C(n,k) combinations from an array */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k <= 0 || k > arr.length) return k === 0 ? [[]] : []
  if (k === arr.length) return [arr.slice()]
  const results: T[][] = []
  function pick(start: number, chosen: T[]) {
    if (chosen.length === k) { results.push([...chosen]); return }
    const remaining = k - chosen.length
    for (let i = start; i <= arr.length - remaining; i++) {
      chosen.push(arr[i])
      pick(i + 1, chosen)
      chosen.pop()
    }
  }
  pick(0, [])
  return results
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
  tracker?: CardTracker,
): boolean {
  // After laying down, only take via lay-off (handled by GameBoard override).
  // Even jokers: don't blindly take if we can't use them.
  if (hasLaidDown) return false

  // Always take jokers pre-lay-down
  if (isJoker(discardCard)) return true

  // Core: does taking this card improve hand score?
  const scoreBefore = evaluateHand(hand, requirement)
  const scoreAfter = evaluateHand([...hand, discardCard], requirement)
  let improvement = scoreAfter - scoreBefore

  // Special case: if this card enables going down (score jumps to 150+), always take
  if (scoreAfter >= 150 && scoreBefore < 150) return true

  // Run-round bonus: give run-building cards preferential treatment in run-heavy rounds
  if (requirement.runs >= 2 && !isJoker(discardCard)) {
    const sameSuitCards = hand.filter(c => c.suit === discardCard.suit && !isJoker(c))
    const extendsRunWindow = sameSuitCards.some(c => Math.abs(c.rank - discardCard.rank) <= 2 && Math.abs(c.rank - discardCard.rank) > 0)
    if (extendsRunWindow) {
      improvement += requirement.runs >= 3 ? 6 : 4
    }

    // R7 boost: if the discard card extends a 3+ card run window to 4+, take it aggressively
    if (requirement.runs >= 3) {
      const withCard = [...sameSuitCards, discardCard]
      const windowBefore = findBestRunWindow(sameSuitCards)
      const windowAfter = findBestRunWindow(withCard)
      if (windowAfter.cards.length >= 4 && windowBefore.cards.length < 4) {
        // This card completes a run requirement! Strong take signal.
        improvement += 15
      }
    }
  }

  // Card scarcity: if this card is rare in the remaining deck, lower the bar to take it.
  // A card with 0 remaining copies elsewhere is irreplaceable.
  if (tracker && improvement > 0 && !isJoker(discardCard)) {
    const remaining = tracker.getRemainingCount(discardCard.rank, discardCard.suit)
    if (remaining === 0) improvement += 3       // last copy — now or never
    else if (remaining === 1) improvement += 1  // scarce
  }

  // Threshold scales with hand size — larger hands are riskier to add to
  const sizeAdjust = hand.length >= 12 ? 3 : hand.length >= 10 ? 1 : 0
  if (improvement >= config.takeThreshold + sizeAdjust) return true

  // Denial take: take the card to prevent an opponent from getting it,
  // even if it doesn't help our hand. Only for opponent-aware personalities.
  const handLimitForDenial = config.dangerWeight >= 0.6 ? 14 : 12
  if (config.denialTake && tablesMelds.length > 0 && hand.length < handLimitForDenial) {
    for (const opp of opponents) {
      if (!opp.hasLaidDown || opp.hand.length > 6) continue
      const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)

      // Check runs: card extends a run (4+) owned by the opponent
      const extendsRun = oppMelds.some(m => m.type === 'run' && m.cards.length >= 4 && canLayOff(discardCard, m))
      // Check sets: card matches rank of an opponent's set (3+), could lay off
      const extendsSet = oppMelds.some(m => m.type === 'set' && m.cards.length >= 3 && canLayOff(discardCard, m))

      if (extendsRun || extendsSet) {
        // Mastermind (dangerWeight >= 0.6) denies even high-point cards when opponent is close
        if (config.dangerWeight >= 0.6) return true
        // Others only denial-take low-point cards (don't bloat hand with Aces/Kings)
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
  tablesMelds: Meld[] = [],
  hasLaidDown = false,
  tracker?: CardTracker,
): boolean {
  if (buysRemaining <= 0) return false

  // After laying down, buying is almost always bad — you get the card + a penalty card,
  // netting +1 hand size when the goal is to empty your hand. Only exception: you have
  // exactly 1 card left and the discard can be laid off (buying = 2 cards, lay off the
  // bought one, then you still have 2 cards — marginal). Skip buying post-lay-down.
  if (hasLaidDown) return false

  // Always buy jokers unless hand is too large relative to round's base dealt count
  const jokerBaseDealt = (requirement.sets + requirement.runs >= 3 && requirement.runs >= 1) ? 12 : 10
  if (isJoker(discardCard) && hand.length < jokerBaseDealt + 4) return true

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

  // Hand size risk — relative to the round's base dealt count, not absolute.
  // A 14-card hand in R7 (12 dealt) is only +2 over base = modest risk,
  // but a 14-card hand in R1 (10 dealt) is +4 over base = more concerning.
  const totalMelds = requirement.sets + requirement.runs
  const baseDealt = (totalMelds >= 3 && requirement.runs >= 1) ? 12 : 10
  const cardsOverBase = Math.max(0, (hand.length + 1) - baseDealt)  // +1 for penalty card
  // Smooth curve: 3 risk per card over base, with a floor of 3
  // 0 over → 3, 2 over → 9, 4 over → 15, 6 over → 21, 8+ over → 27+
  risk += Math.min(3 + cardsOverBase * 3, 40)

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

  // === RUN-HEAVY ROUND BONUS ===
  // In run-heavy rounds (R3, R6, R7), the shanghai risk with 100+ points far outweighs
  // the cost of a slightly larger hand. Boost improvement for run-building cards.
  let runBuyBonus = 0
  if (requirement.runs >= 2 && !isJoker(discardCard)) {
    const sameSuitCards = hand.filter(c => c.suit === discardCard.suit && !isJoker(c))
    const isRunNeighbor = sameSuitCards.some(c => Math.abs(c.rank - discardCard.rank) <= 2)
    if (isRunNeighbor) {
      runBuyBonus = requirement.runs >= 3 ? 8 : 5
    }
  }

  // R7 dampening: in 3-run rounds, buying becomes risky as hands grow
  // Each card over 13 adds increasing risk
  if (requirement.runs >= 3 && hand.length >= 14) {
    risk += (hand.length - 13) * 5
  }

  // Card scarcity: buying a rare card is more valuable since the draw pile is unlikely to provide it
  let scarcityBonus = 0
  if (tracker && improvement > 0 && !isJoker(discardCard)) {
    const remaining = tracker.getRemainingCount(discardCard.rank, discardCard.suit)
    if (remaining === 0) scarcityBonus = 5       // last copy
    else if (remaining === 1) scarcityBonus = 2  // scarce
  }

  // === DECISION ===
  // buyRiskTolerance adjusts the threshold: positive = more willing to buy
  if (improvement + runBuyBonus + scarcityBonus + config.buyRiskTolerance > risk) return true

  // === DENIAL BUY ===
  // Shark/Mastermind: buy a card purely to deny an opponent close to going out,
  // but only if we have buys to spare (>= 2) and tablesMelds info is available.
  if (config.denialTake && buysRemaining >= 2 && tablesMelds.length > 0 && players) {
    for (const opp of players) {
      if (!opp.hasLaidDown || opp.hand.length > 4) continue
      // Check if the discard can lay off onto any opponent's meld on the table
      if (tablesMelds.some(m => canLayOff(discardCard, m))) return true
    }
  }

  return false
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
  hasLaidDown?: boolean,
  tracker?: CardTracker,
): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  // Never discard jokers (unless hand is ALL jokers)
  const nonJokers = hand.filter(c => !isJoker(c))
  if (nonJokers.length === 0) return hand[0]

  // ── Post-lay-down strategy ──────────────────────────────────────────────────
  // After going down, meld-building evaluation is meaningless. The only goal is
  // to empty the hand via lay-offs and discards. Discard dead-weight cards
  // (those that can't lay off) first, highest points first.
  if (hasLaidDown && tablesMelds.length > 0) {
    const cantLayOff = nonJokers.filter(card =>
      !tablesMelds.some(meld => canLayOff(card, meld))
    )

    if (cantLayOff.length > 0) {
      // ── Race mode: abandon cooperation when opponents are close to going out ──
      // If any opponent has laid down and has ≤3 cards, it's a race to shed points.
      // Skip cooperative scoring — just discard highest points as fast as possible.
      const inRaceMode = opponents?.some(o => o.hasLaidDown && o.hand.length <= 3)
      if (inRaceMode) {
        return cantLayOff.reduce((worst, c) =>
          cardPoints(c.rank) > cardPoints(worst.rank) ? c : worst
        )
      }

      // ── Cooperative post-down discarding ──────────────────────────────
      // Among dead-weight cards (can't lay off), prefer discarding cards
      // that downed opponents CAN use (extends their melds) — this keeps
      // the game moving and reduces stalemates. But avoid feeding cards to
      // opponents who haven't laid down yet (they could use them to go down).
      if (opponents && opponents.length > 0) {
        const scored = cantLayOff.map(card => {
          let coopScore = 0
          for (const opp of opponents) {
            if (!opp.hasLaidDown) continue
            const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
            if (oppMelds.some(m => canLayOff(card, m))) {
              // This card helps a downed opponent lay off — prefer discarding it
              coopScore += 10
            }
          }
          // Penalize cards that help NOT-downed opponents
          for (const opp of opponents) {
            if (opp.hasLaidDown) continue
            const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
            if (oppMelds.some(m => canLayOff(card, m))) {
              coopScore -= 20
            }
          }
          return { card, coopScore, points: cardPoints(card.rank) }
        })
        // Sort: highest coopScore first, then highest points as tiebreaker
        scored.sort((a, b) => b.coopScore - a.coopScore || b.points - a.points)
        return scored[0].card
      }
      // Fallback: discard the highest-point dead-weight card
      return cantLayOff.reduce((worst, c) =>
        cardPoints(c.rank) > cardPoints(worst.rank) ? c : worst
      )
    }

    // All cards can lay off — discard the highest-point card to minimize penalty
    // exposure. Use fewest meld matches as tiebreaker (shed the least-flexible card).
    return nonJokers.reduce((best, c) => {
      const cPts = cardPoints(c.rank)
      const bestPts = cardPoints(best.rank)
      if (cPts > bestPts) return c
      if (cPts === bestPts) {
        const cMatches = tablesMelds.filter(m => canLayOff(c, m)).length
        const bestMatches = tablesMelds.filter(m => canLayOff(best, m)).length
        if (cMatches < bestMatches) return c
      }
      return best
    })
  }

  const canMeldFull = aiFindBestMelds(hand, requirement) !== null
  const useOpponentAwareness = config.opponentAware && config.dangerWeight > 0

  // Pre-compute run windows per suit to penalize discarding run-building cards
  // in run-heavy rounds (2+ runs required)
  const isRunHeavy = requirement.runs >= 2
  const isPureRunHeavy = requirement.runs >= 3
  let runWindowsBySuit: Map<string, RunWindow> | undefined
  let runWindowCardIds: Set<string> | undefined
  if (isRunHeavy) {
    const bySuit = groupBySuit(hand)
    runWindowsBySuit = new Map()
    runWindowCardIds = new Set()
    for (const [suit, suitCards] of bySuit) {
      const window = findBestRunWindow(suitCards)
      runWindowsBySuit.set(suit, window)
      for (const c of window.cards) runWindowCardIds.add(c.id)
    }
  }

  let bestDiscard = nonJokers[0]
  let bestScore = -Infinity

  for (const card of nonJokers) {
    const without = hand.filter(c => c.id !== card.id)
    let score = evaluateHandFast(without, requirement, canMeldFull)

    // Run-window protection: penalize discarding cards that shrink run windows
    if (isRunHeavy && runWindowsBySuit && runWindowCardIds?.has(card.id)) {
      const currentWindow = runWindowsBySuit.get(card.suit)
      if (currentWindow && currentWindow.cards.length >= 2) {
        const remainingSuitCards = currentWindow.cards.filter(c => c.id !== card.id)
        const newWindow = findBestRunWindow(remainingSuitCards)
        const sizeDrop = currentWindow.cards.length - newWindow.cards.length
        if (sizeDrop > 0) {
          if (currentWindow.cards.length >= 3 && newWindow.cards.length <= 2) {
            // Window drops from 3+ → 2 or fewer
            score -= isPureRunHeavy ? 12 : 8
          } else if (currentWindow.cards.length >= 2 && newWindow.cards.length <= 1) {
            // Window drops from 2 → 1 or 0
            score -= isPureRunHeavy ? 8 : 5
          }
        }
      }
    }

    // R7 suit pivot: bonus for shedding cards from weak suits (poor run coverage)
    if (isPureRunHeavy && !isJoker(card)) {
      const suitCards = hand.filter(c => c.suit === card.suit && !isJoker(c) && c.id !== card.id)
      if (suitCards.length <= 1) {
        // Discarding from a suit where we have 0-1 other cards = shedding dead weight
        score += 5
      }
    }

    // Opponent danger: penalize discarding cards that help opponents.
    // We SUBTRACT danger from the "keep score" — a dangerous card is less desirable
    // to keep, but we're scoring "hand quality without this card", so a dangerous
    // card to discard gets a BONUS (we want to NOT discard it → lower its without-score).
    // Actually: we want to discard the card with the HIGHEST without-score.
    // A dangerous card should have a LOWER without-score so we DON'T pick it.
    // → Add danger as a penalty to the without-score.
    if (useOpponentAwareness) {
      // Use Monte Carlo lookahead when tracker available, else fall back to heuristic
      const danger = (tracker && opponents)
        ? discardDangerWithLookahead(card, tracker, opponents, opponentHistory, requirement, tablesMelds)
        : cardDanger(card, tablesMelds, opponents, opponentHistory)
      score -= danger * config.dangerWeight

      // Upgrade 2: Hand reading — penalize cards matching inferred opponent needs
      if (opponentHistory && opponentHistory.size > 0) {
        const oppNeeds = inferOpponentNeeds(opponentHistory, tablesMelds)
        for (const [, needs] of oppNeeds) {
          if (needs.likelySuits.has(card.suit) && needs.likelyRanks.has(card.rank)) {
            score -= 25 * config.dangerWeight  // strong match — both suit AND rank
          } else if (needs.likelySuits.has(card.suit)) {
            score -= 10 * config.dangerWeight  // suit match only
          } else if (needs.likelyRanks.has(card.rank)) {
            score -= 8 * config.dangerWeight   // rank match only
          }
        }
      }

      // Upgrade 5: Round-aware discard adjustment
      const strategy = getRoundStrategy(requirement)
      // In pure-set rounds, suited neighbors are less valuable — safe to discard
      if (strategy.rankWeight > strategy.suitWeight) {
        // Set-heavy: reduce penalty for discarding cards that only have suit connections
        const sameRankCount = hand.filter(c => c.id !== card.id && c.rank === card.rank && !isJoker(c)).length
        if (sameRankCount === 0) {
          // No rank match — this card is less useful in a set-heavy round
          score += 3
        }
      }
      // In pure-run rounds, same-rank duplicates are less valuable — safe to discard
      if (strategy.suitWeight > strategy.rankWeight) {
        const sameRankCount = hand.filter(c => c.id !== card.id && c.rank === card.rank && !isJoker(c)).length
        if (sameRankCount >= 1) {
          // Duplicate rank in a run-heavy round — one copy is expendable
          score += 4
        }
        // Off-suit isolated cards are cheaper to discard in run rounds
        const sameSuitCount = hand.filter(c => c.id !== card.id && c.suit === card.suit && !isJoker(c)).length
        if (sameSuitCount === 0) {
          score += 3  // isolated suit — no run potential
        }
      }
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
  hasLaidDown?: boolean,
): Card {
  const req = requirement ?? { sets: 1, runs: 1, description: '1 Set + 1 Run' }
  return aiChooseDiscard(hand, req, AI_EVAL_CONFIGS['the-shark'], tablesMelds, opponents, opponentHistory, hasLaidDown)
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
// For jokers with multiple valid targets, strategically picks the best meld:
//   - Runs over sets (runs extend further, creating more future lay-off positions)
//   - Runs matching remaining hand cards' suit (enables future lay-offs for those cards)
//   - Own melds over opponent melds (avoid helping opponents go out)
export function aiFindLayOff(hand: Card[], tablesMelds: Meld[], currentPlayerId?: string, opponents?: Player[]): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null {
  const jokers = hand.filter(c => c.suit === 'joker')
  const nonJokers = hand.filter(c => c.suit !== 'joker')

  // Upgrade 4: Race mode — when opponents are close to going out, prioritize laying off
  // highest-point cards first to minimize Shanghai exposure (instead of jokers-first).
  const inRaceMode = opponents?.some(o => o.hasLaidDown && o.hand.length <= 3)
  let prioritisedHand: Card[]
  if (inRaceMode) {
    // Sort non-jokers by points descending, then jokers at the end
    const sortedNonJokers = [...nonJokers].sort((a, b) => cardPoints(b.rank) - cardPoints(a.rank))
    prioritisedHand = [...sortedNonJokers, ...jokers]
  } else {
    prioritisedHand = [...jokers, ...nonJokers]
  }

  for (const card of prioritisedHand) {
    // Collect all valid lay-off targets for this card
    const validTargets: { meld: Meld; jokerPosition?: 'low' | 'high'; score: number }[] = []

    for (const meld of tablesMelds) {
      if (canLayOff(card, meld)) {
        const jokerPosition = (card.suit === 'joker' && meld.type === 'run')
          ? aiChooseJokerLayOffPosition(meld)
          : undefined

        // Check stranding safety — don't lay off if it leaves exactly 1 card that can't
        // chain-lay-off (since you can't discard your last card to go out).
        // At 2+ remaining cards, you still have draw/discard turns to work with.
        const remaining = hand.filter(c => c.id !== card.id)
        if (remaining.length === 1) {
          const updatedMelds = tablesMelds.map(m => m.id === meld.id ? simulateLayOff(card, meld, jokerPosition) : m)
          if (!canGoOutViaChainLayOff(remaining, updatedMelds)) {
            continue
          }
        }

        // Score this target strategically (higher = better)
        let score = 0

        if (isJoker(card)) {
          // Runs >> sets for joker lay-offs (runs extend further, more future positions)
          if (meld.type === 'run') score += 100

          // Prefer runs whose suit matches remaining hand cards
          if (meld.type === 'run' && meld.runSuit) {
            const remainingInSuit = hand.filter(c =>
              c.id !== card.id && c.suit === meld.runSuit && !isJoker(c)
            )
            // Each remaining card in this suit is a potential future lay-off
            score += remainingInSuit.length * 30

            // Extra bonus if a remaining card is adjacent to where the joker extends
            const newMin = jokerPosition === 'low' ? (meld.runMin ?? 1) - 1 : meld.runMin ?? 1
            const newMax = jokerPosition === 'high' ? (meld.runMax ?? 13) + 1 : meld.runMax ?? 13
            for (const rc of remainingInSuit) {
              if (rc.rank === newMin - 1 || rc.rank === newMax + 1) {
                score += 50  // this card can lay off right after the joker
              }
            }
          }
        } else {
          // Non-joker cards: prefer own melds over opponent melds
          // Meld IDs encode owner like "meld-p0-0" — check if it belongs to us
          if (currentPlayerId && meld.id?.includes(currentPlayerId)) {
            score += 50  // strongly prefer own melds
          }
        }

        validTargets.push({ meld, jokerPosition, score })
      }
    }

    if (validTargets.length > 0) {
      // Pick the highest-scoring target
      validTargets.sort((a, b) => b.score - a.score)
      const best = validTargets[0]
      return { card, meld: best.meld, jokerPosition: best.jokerPosition }
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
  if (remaining.length <= 4 && tablesMelds.length > 0) {
    if (canGoOutViaChainLayOff(remaining, tablesMelds)) return true
  }

  // Always go down: an opponent has already laid down
  if (players.some((p, i) => i !== currentPlayerIndex && p.hasLaidDown)) return true

  // Always go down: waited 3+ turns already
  if (turnsWaited >= 3) return true

  // Always go down: any opponent has 4 or fewer cards
  if (players.some((p, i) => i !== currentPlayerIndex && p.hand.length <= 4)) return true

  // Upgrade 3: Shanghai risk — if multiple opponents have laid down and are close
  // to going out, the risk of being Shanghaied is extreme. Go down NOW.
  const opponents = players.filter((_, i) => i !== currentPlayerIndex)
  const downOpponents = opponents.filter(o => o.hasLaidDown)
  const closeToOut = downOpponents.filter(o => o.hand.length <= 3)
  if (closeToOut.length >= 2) return true

  // Upgrade 3: Point exposure — if holding 80+ points worth of remaining cards
  // while any opponent has laid down, the Shanghai risk is too high. Go down immediately.
  const stuckPoints = remaining.reduce((sum, c) => sum + cardPoints(c.rank), 0)
  if (stuckPoints >= 80 && downOpponents.length > 0) return true

  // Consider waiting
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
    }) ||
    tablesMelds.some(meld => canLayOff(c, meld))
  )

  if (stuckPoints >= 40 && remaining.length <= 2 && hasLayOffPotential && allOpponentsHaveMany) {
    return false
  }

  if (stuckPoints >= 40 && remaining.length <= 2 && allOpponentsHaveMany) {
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
