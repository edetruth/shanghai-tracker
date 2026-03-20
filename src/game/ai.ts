import type { AIDifficulty, Card, Meld, OpponentHistory, Player, RoundRequirement } from './types'
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
    const sorted = [...suitCards].sort((a, b) => a.rank - b.rank)
    for (let jCount = 0; jCount <= available.length; jCount++) {
      for (let start = 0; start < sorted.length; start++) {
        for (let end = sorted.length; end > start + MIN_RUN_SIZE - 1 - jCount; end--) {
          const sub = sorted.slice(start, end)
          const testCards = [...sub, ...available.slice(0, jCount)]
          if (testCards.length >= MIN_RUN_SIZE && isValidRun(testCards)) return testCards
        }
      }
    }
  }
  return null
}

// Score a suit by its run-building potential (higher = better)
function scoreSuitForRun(suitCards: Card[]): number {
  if (suitCards.length < 2) return suitCards.length
  const ranks = suitCards.map(c => c.rank).sort((a, b) => a - b)
  // Longest consecutive sequence
  let maxSeq = 1, curSeq = 1
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1] + 1) curSeq++
    else curSeq = 1
    maxSeq = Math.max(maxSeq, curSeq)
  }
  // Density: how close ranks are
  const span = ranks[ranks.length - 1] - ranks[0] + 1
  const density = suitCards.length / span
  return maxSeq * 10 + suitCards.length * 4 + density * 15
}

// Get the top committed suits (best run-building opportunities).
// Progress bonus: 50 * window.cards.length adds mild stickiness so a suit with
// more cards already in a window is preferred over an equally-scored new suit,
// without locking AI in too hard when a competing suit becomes genuinely better.
function getCommittedSuits(hand: Card[], topN = 2): Set<string> {
  const bySuit = groupBySuit(hand)
  const scores: [string, number][] = []
  for (const [suit, cards] of bySuit) {
    const window = findBestRunWindow(cards)
    const progressBonus = window.cards.length * 50
    scores.push([suit, scoreSuitForRun(cards) + progressBonus])
  }
  scores.sort((a, b) => b[1] - a[1])
  return new Set(scores.slice(0, topN).map(s => s[0]))
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

  // Try every starting card; extend while consecutive rank-diff ≤ 2 (allows 1-rank gaps)
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

/**
 * Classify how a candidate rank contributes to an existing same-suit run window.
 * 'gap-fill'  — fills a missing rank inside the existing span (highest value)
 * 'extension' — directly adjacent to the low or high edge
 * 'near'      — within ±2 of the window edges (potential bridge)
 * null        — too far away to be useful
 */
function getRunContribution(sameSuitCards: Card[], rank: number): 'gap-fill' | 'extension' | 'near' | null {
  const window = findBestRunWindow(sameSuitCards)
  if (window.cards.length === 0) return null
  if (window.gaps.includes(rank)) return 'gap-fill'
  if (rank === window.minRank - 1 || rank === window.maxRank + 1) return 'extension'
  if (rank >= window.minRank - 2 && rank <= window.maxRank + 2) return 'near'
  // Fallback: card is outside the best window but still within ±2 of an isolated suit fragment.
  // Handles cases like [5♥, 9♥] where the window picks [5♥] but 10♥ is useful near 9♥.
  if (sameSuitCards.some(c => Math.abs(c.rank - rank) <= 2)) return 'near'
  return null
}

// Try to find meld groups satisfying the round requirement.
// For mixed rounds (sets + runs), tries sets-first then runs-first and returns whichever works.
// This matters when the only joker can satisfy either the set OR the run but not both —
// the greedy ordering determines which gets it.
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
  const melds: Card[][] = []
  const usedIds = new Set<string>()
  let jokersUsed = 0

  const steps: Array<'set' | 'run'> = order === 'sets-first'
    ? [...Array(requirement.sets).fill('set'), ...Array(requirement.runs).fill('run')]
    : [...Array(requirement.runs).fill('run'), ...Array(requirement.sets).fill('set')]

  for (const step of steps) {
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const meld = step === 'set'
      ? tryFindSet(remaining, jokers, jokersUsed)
      : tryFindRun(remaining, jokers, jokersUsed)
    if (!meld) return null
    meld.forEach(c => usedIds.add(c.id))
    jokersUsed += meld.filter(isJoker).length
    melds.push(meld)
  }

  return melds
}

// Should AI take the top discard card? (Medium/Hard)
//
// difficulty === 'medium' (default): conservative — only take if it directly enables melds,
//   makes a set, or is a gap-fill/extension to a committed run. ~70-80% draw from pile.
//
// difficulty === 'hard': all Medium checks PLUS opponent-denial logic — takes the card
//   even if it doesn't help own hand, if it visibly hurts an opponent:
//   • Card's rank appears in any opponent's set on the table (denies bonus-set material)
//   • Card can be laid off onto any existing run on the table (denies opponent an easy lay-off)
//
// tablesMelds is optional (defaults to []); pass state.roundState.tablesMelds for Hard denial.
// All existing call sites (no 5th/6th arg) continue to get Medium behavior unchanged.
export function aiShouldTakeDiscard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
  difficulty: AIDifficulty = 'medium',
  tablesMelds: Meld[] = [],
): boolean {
  if (isJoker(discardCard)) return true
  if (hasLaidDown) return false

  // Taking it enables required melds we couldn't form without it
  if (aiFindBestMelds([...hand, discardCard], requirement) !== null &&
      aiFindBestMelds(hand, requirement) === null) return true

  // Card makes a set: hand already holds 2+ of same rank → adding this gives 3+
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 2) return true

  // For rounds with run requirements, commit to enough suits to cover ALL runs needed.
  // Round 7 (3 runs) must consider 3+ suits, not just 2.
  const hasRunReq = requirement.runs >= 1
  const commitN = hasRunReq ? Math.min(requirement.runs + 1, 3) : 2
  const committedSuits = getCommittedSuits(hand, commitN)

  if (hasRunReq && committedSuits.has(discardCard.suit)) {
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
    // Take only if card directly advances the committed run window (gap-fill or extension).
    // 'near' (±2 of window edge) is speculative future-build, not "directly fits" — Medium
    // must stay conservative per GDD Section 11.
    if (sameSuit.length >= 1) {
      const contribution = getRunContribution(sameSuit, discardCard.rank)
      if (contribution === 'gap-fill' || contribution === 'extension') return true
    }
  }

  // Hard-only: opponent denial — take if card is clearly useful to someone else on the table
  if (difficulty === 'hard' && tablesMelds.length > 0) {
    // Denial 1: card rank already appears in a set on the table → opponent may want more
    //           of that rank for a bonus set or lay-off
    const rankInTableSet = tablesMelds.some(m =>
      m.type === 'set' && m.cards.some(c => !isJoker(c) && c.rank === discardCard.rank)
    )
    if (rankInTableSet) return true

    // Denial 2: card extends a long run already on the table (4+ cards) → taking it denies a
    //           meaningful lay-off to whoever owns that run. Threshold of 4+ filters out newly-
    //           formed minimum runs (3 cards) where denial has little strategic value and would
    //           otherwise fire too broadly mid-game.
    const extendsTableRun = tablesMelds.some(m =>
      m.type === 'run' && m.cards.length >= 4 && canLayOff(discardCard, m)
    )
    if (extendsTableRun) return true
  }

  return false
}

// Hard AI take-discard: highly selective — only takes when the card concretely advances
// a real plan. No speculative takes, no thin-evidence extensions. Target ~20-25% take rate.
// Separate from Medium because Medium uses gap-fill/extension with only 1+ same-suit card
// and accepts the 'near' condition — both too loose for a "great player" feel.
export function aiShouldTakeDiscardHard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
  tablesMelds: Meld[] = [],
  opponents: Player[] = [],
): boolean {
  // 1. Always take jokers
  if (isJoker(discardCard)) return true

  // 2. Never take after laying down — draw from pile, focus on lay-offs/going out
  if (hasLaidDown) return false

  // 3. Taking this card enables the round requirement when current hand can't meet it
  if (aiFindBestMelds([...hand, discardCard], requirement) !== null &&
      aiFindBestMelds(hand, requirement) === null) return true

  // 4. Card completes a set (hand has 2+ of same rank already → guaranteed 3-of-a-kind)
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 2) return true

  // 5 & 6. Gap-fill or extension in a STRONG committed run (3+ cards in the window)
  const hasRunReq = requirement.runs >= 1
  if (hasRunReq) {
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
    if (sameSuit.length >= 3) {
      const window = findBestRunWindow(sameSuit)
      if (window.cards.length >= 3) {
        if (window.gaps.includes(discardCard.rank)) return true  // gap-fill
        if (discardCard.rank === window.minRank - 1 || discardCard.rank === window.maxRank + 1) return true  // extension
      }
    }
  }

  // 7. Denial take — take card to deny an opponent who is close to going out
  if (opponents.length > 0 && tablesMelds.length > 0 && hand.length < 8 && cardPoints(discardCard.rank) <= 10) {
    for (const opp of opponents) {
      if (!opp.hasLaidDown || opp.hand.length > 3) continue
      const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
      if (oppMelds.some(m => canLayOff(discardCard, m))) return true
    }
  }

  // 8. Everything else → draw from pile (no 'near', no thin-evidence takes)
  return false
}

// Easy AI: pure 50/50 coin flip — GDD Section 11 Easy behavior.
// CHANGED: Was checking if card completes a set or extends a run. Now pure random.
export function aiShouldTakeDiscardEasy(_hand: Card[], _discardCard: Card, _requirement: RoundRequirement): boolean {
  return Math.random() > 0.5
}

// Medium AI discard: highest GDD Section 10 point-value card — GDD Section 11 Medium behavior.
// GDD Section 10 scoring: 2-9 = 5pts, 10/J/Q/K = 10pts, Ace = 15pts, Joker = 25pts.
//
// Priority 1 contract: GameBoard always attempts aiFindLayOff before calling this when
// hand.length === 1 (see GameBoard action tick). If lay-off succeeds the AI goes out;
// if it fails the AI is stuck and discards the last card legally (draws next turn per
// the stuck-player rule). This function must never be called with an empty hand.
//
// CHANGED: Was run-protection strategy (committed-suit analysis, protected window IDs).
// Now simply returns the non-joker candidate with the highest cardPoints() value.
export function aiChooseDiscard(hand: Card[], _requirement?: RoundRequirement, tablesMelds: Meld[] = []): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  const runsOnTable = tablesMelds.filter(m => m.type === 'run')
  const nonJokers = hand.filter(c => !isJoker(c))
  // Never discard a joker if there are runs to lay it off on (or non-jokers available)
  const candidates = (runsOnTable.length > 0 || nonJokers.length > 0)
    ? (nonJokers.length > 0 ? nonJokers : hand)
    : hand

  // Connectivity-based utility: keep cards with rank partners (sets) or suit neighbours (runs);
  // discard isolated high-point-value cards first.
  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 2).length
    return sameRank * 50 + adjacent * 30 - cardPoints(card.rank)
  }

  return candidates.reduce((worst, card) => utility(card) < utility(worst) ? card : worst)
}

// Should AI buy an out-of-turn discard? (Medium)
// CHANGED: Added optional buysRemaining/buyLimit params with 0-guards.
// When buyLimit === 0 or buysRemaining === 0, always return false.
// Note: GameBoard currently calls this without buysRemaining/buyLimit; wire these up in
// GameBoard to fully enforce per-player buy limits for Medium AI.
export function aiShouldBuy(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining = 5,
  buyLimit = 5,
): boolean {
  if (buysRemaining <= 0 || buyLimit <= 0) return false
  if (isJoker(discardCard)) return true
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  const without = aiFindBestMelds(hand, requirement)
  if (withCard !== null && without === null) return true

  // For rounds with run requirements, buy based on how precisely the card advances the run
  if (requirement.runs >= 1) {
    const commitN = Math.min(requirement.runs + 1, 3)
    const committedSuits = getCommittedSuits(hand, commitN)
    if (committedSuits.has(discardCard.suit)) {
      const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
      if (sameSuit.length >= 1) {
        const contribution = getRunContribution(sameSuit, discardCard.rank)
        // Always buy gap-fills and direct extensions; buy 'near' only with 2+ existing cards
        if (contribution === 'gap-fill' || contribution === 'extension') return true
        if (contribution === 'near' && sameSuit.length >= 2) return true
      }
    }
  }

  return false
}

// Easy AI buy: structured check — buys only when the discard card enables the required melds
// and the player has ≥ 3 buys remaining. Never buys if the hand can already form required melds.
export function aiShouldBuyEasy(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining: number,
  buyLimit = 5,
): boolean {
  if (buysRemaining < 3 || buyLimit <= 0) return false
  const canAlready = aiFindBestMelds(hand, requirement) !== null
  if (canAlready) return false
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  return withCard !== null
}

// Check whether any valid meld (set or run) can be formed from the given cards
// allowedTypes restricts which meld types count (default: both)
export function canFormAnyValidMeld(cards: Card[], allowedTypes: 'set' | 'run' | 'both' = 'both'): boolean {
  const jokers = cards.filter(isJoker)
  const naturals = cards.filter(c => !isJoker(c))
  if (allowedTypes !== 'run' && tryFindSet(naturals, jokers, 0) !== null) return true
  if (allowedTypes !== 'set' && tryFindRun(naturals, jokers, 0) !== null) return true
  return false
}

// Find required melds PLUS any additional valid melds from remaining cards (AI lay-down)
// Extra melds respect round type: e.g. runs-only round only adds extra runs
export function aiFindAllMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  const requiredMelds = aiFindBestMelds(hand, requirement)
  if (!requiredMelds) return null

  // Determine which extra meld types are allowed
  const allowsSets = requirement.sets > 0
  const allowsRuns = requirement.runs > 0

  const allMelds = [...requiredMelds]
  const usedIds = new Set(requiredMelds.flatMap(m => m.map(c => c.id)))

  // Greedily find additional melds from remaining cards (matching round type)
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
// meeting the round requirement. Tries single swaps first, then pairs.
// Returns the FIRST swap to execute (re-evaluation after each swap finds the next).
export function aiFindPreLayDownJokerSwap(
  hand: Card[],
  tablesMelds: Meld[],
  requirement: RoundRequirement
): { card: Card; meld: Meld } | null {
  // Collect all possible swap candidates
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

  // Try pairs of swaps — two swaps together might enable laying down
  for (let i = 0; i < candidates.length; i++) {
    const { card: c1, meld: m1, joker: j1 } = candidates[i]
    // Simulate hand and melds after first swap
    const hand1 = [...hand.filter(c => c.id !== c1.id), j1]
    const melds1 = tablesMelds.map(m => {
      if (m.id !== m1.id) return m
      const newCards = m.cards.map(c => c.id === j1.id ? c1 : c)
      const newMappings = m.jokerMappings.filter(jm => jm.cardId !== j1.id)
      return { ...m, cards: newCards, jokerMappings: newMappings }
    })
    for (let k = i + 1; k < candidates.length; k++) {
      const { card: c2, meld: m2 } = candidates[k]
      if (c2.id === c1.id) continue // can't use same card twice
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
// Prefers the end with more room (ranks available before hitting A-low or A-high).
export function aiChooseJokerLayOffPosition(meld: Meld): 'low' | 'high' {
  const roomBelow = (meld.runMin ?? 1) - 1       // ranks available below (runMin-1 down to 1)
  const roomAbove = 14 - (meld.runMax ?? 13)      // ranks available above (runMax+1 up to 14)
  return roomBelow >= roomAbove ? 'low' : 'high'
}

// Find a card in hand that can be laid off on any of the given melds.
// Jokers are prioritised first — AI should never hold a joker when it can lay one off.
// Skips lay-offs that would leave exactly 1 card that can't itself be laid off
// anywhere (which would strand the AI — can't discard last card, can't go out).
//
// Priority 1 contract: This function correctly handles the going-out case. When
// remaining.length === 0 after a lay-off the AI goes out. When remaining.length === 1,
// canGoOutViaChainLayOff validates whether that final card can also go out. If not,
// the lay-off is skipped and GameBoard falls through to discard (stuck case: legal,
// player draws next turn). Easy AI's lay-off cap is enforced by GameBoard, not here.
export function aiFindLayOff(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld; jokerPosition?: 'low' | 'high' } | null {
  // Prioritise jokers: always lay off jokers before other cards
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
          // Check against the SIMULATED post-lay-off meld bounds — a chain lay-off
          // (e.g. 4♥ onto 5-9 run) updates runMin/runMax, enabling the next card (3♥).
          // Use canGoOutViaChainLayOff so that any 1-card lay-off is properly validated.
          const updatedMelds = tablesMelds.map(m => m.id === meld.id ? simulateLayOff(card, meld, jokerPosition) : m)
          if (!canGoOutViaChainLayOff(remaining, updatedMelds)) {
            continue // would leave 1 unplayable card — skip
          }
        }
        return { card, meld, jokerPosition }
      }
    }
  }
  return null
}

// Hard mode: strategic discard — avoids cards useful to own hand AND cards that help
// opponents lay off onto their existing table melds. Opponent history adds danger
// scoring: cards that feed an opponent's known collection are avoided.
//
// Priority 1 contract: see aiChooseDiscard above — same stuck-player invariant applies.
export function aiChooseDiscardHard(
  hand: Card[],
  tablesMelds: Meld[] = [],
  opponentHistory?: Map<string, OpponentHistory>,
  opponents?: Player[],
): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  // Never discard a joker if there are any runs on the table to lay it off on.
  const runsOnTable = tablesMelds.filter(m => m.type === 'run')
  const nonJokerHand = hand.filter(c => !isJoker(c))
  const candidateHand = (runsOnTable.length > 0 || nonJokerHand.length > 0)
    ? (nonJokerHand.length > 0 ? nonJokerHand : hand)
    : hand

  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 3).length
    const layOffValue = tablesMelds.some(m => canLayOff(card, m)) ? 80 : 0
    return sameRank * 120 + adjacent * 60 + layOffValue - cardPoints(card.rank)
  }

  function danger(card: Card): number {
    if (isJoker(card)) return 0
    let d = 0
    // Check 1: card lays off onto an opponent's table meld
    if (opponents) {
      for (const opp of opponents) {
        if (!opp.hasLaidDown) continue
        const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
        if (oppMelds.some(m => canLayOff(card, m))) d += 100
      }
    }
    // Checks 2-4: opponent collection patterns from history
    if (opponentHistory) {
      for (const [, hist] of opponentHistory) {
        // Check 2: suit collecting
        const suitPicked = hist.picked.filter(c => c.suit === card.suit).length
        if (suitPicked >= 2) d += 50
        else if (suitPicked === 1) d += 20
        // Check 3: rank collecting
        if (hist.picked.some(c => c.rank === card.rank)) d += 40
        // Check 4: opponent discarded same suit/rank recently → safer
        if (hist.discarded.some(c => c.suit === card.suit)) d -= 15
        if (hist.discarded.some(c => c.rank === card.rank)) d -= 10
      }
    }
    return d
  }

  // Combine: discard the card with lowest utility AND lowest danger.
  // Higher combined = more valuable to keep; lower combined = best discard candidate.
  // Danger weight 0.5 — self-interest outweighs denial when in conflict.
  const DANGER_WEIGHT = 0.5
  return candidateHand.reduce((worst, card) => {
    const keepCard = utility(card) + danger(card) * DANGER_WEIGHT
    const keepWorst = utility(worst) + danger(worst) * DANGER_WEIGHT
    return keepCard < keepWorst ? card : worst
  })
}

// Hard mode: selective buying — same 3+ card threshold as Hard take-discard for runs,
// plus denial buying when an opponent is about to go out.
export function aiShouldBuyHard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  buysRemaining: number,
  tablesMelds: Meld[] = [],
  opponents: Player[] = [],
): boolean {
  if (buysRemaining <= 2) return false
  if (isJoker(discardCard)) return true

  // Enables the round requirement
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  const without = aiFindBestMelds(hand, requirement)
  if (withCard !== null && without === null) return true

  // Completes a set (2+ same rank in hand)
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 2) return true

  // Gap-fill or extension in a strong committed run (3+ cards in window)
  if (requirement.runs >= 1) {
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
    if (sameSuit.length >= 3) {
      const window = findBestRunWindow(sameSuit)
      if (window.cards.length >= 3) {
        if (window.gaps.includes(discardCard.rank)) return true
        if (discardCard.rank === window.minRank - 1 || discardCard.rank === window.maxRank + 1) return true
      }
    }
  }

  // Denial buy — opponent about to go out, card fits their meld, AI can afford it
  if (opponents.length > 0 && tablesMelds.length > 0
    && hand.length < 7 && cardPoints(discardCard.rank) <= 10 && buysRemaining >= 3) {
    for (const opp of opponents) {
      if (!opp.hasLaidDown || opp.hand.length > 2) continue
      const oppMelds = tablesMelds.filter(m => m.ownerId === opp.id)
      if (oppMelds.some(m => canLayOff(discardCard, m))) return true
    }
  }

  return false
}

// Hard AI going-down timing: should the AI lay down its melds now, or wait for a
// better hand? Waiting can reduce stuck cards but risks opponents going out first.
// turnsWaited counts how many turns the AI could have gone down but chose to wait.
export function aiShouldGoDownHard(
  hand: Card[],
  melds: Card[][],
  requirement: RoundRequirement,
  tablesMelds: Meld[],
  players: Player[],
  currentPlayerIndex: number,
  turnsWaited: number,
): boolean {
  // Calculate remaining hand after melding
  const meldedIds = new Set(melds.flatMap(m => m.map(c => c.id)))
  const remaining = hand.filter(c => !meldedIds.has(c.id))

  // Always go down: going out immediately (0 remaining cards)
  if (remaining.length === 0) return true

  // Always go down: can go out via chain lay-offs on existing table melds
  if (remaining.length <= 3 && tablesMelds.length > 0) {
    if (canGoOutViaChainLayOff(remaining, tablesMelds)) return true
  }

  // Always go down: an opponent has already laid down
  if (players.some((p, i) => i !== currentPlayerIndex && p.hasLaidDown)) return true

  // Always go down: waited 3+ turns already — diminishing returns
  if (turnsWaited >= 3) return true

  // Always go down: any opponent has 4 or fewer cards (they're close to going out)
  if (players.some((p, i) => i !== currentPlayerIndex && p.hand.length <= 4)) return true

  // Consider waiting: all conditions must be met
  const stuckPoints = remaining.reduce((sum, c) => sum + cardPoints(c.rank), 0)
  const allOpponentsHaveMany = players.every((p, i) =>
    i === currentPlayerIndex || p.hand.length >= 7
  )

  // Check if remaining cards have lay-off potential on the melds being laid down
  const hasLayOffPotential = remaining.length <= 2 && remaining.some(c =>
    melds.some(meldCards => {
      // Simple adjacency check: card is same rank (for sets) or adjacent suit/rank (for runs)
      const nonJokers = meldCards.filter(mc => !isJoker(mc))
      if (nonJokers.length === 0) return false
      // Set: same rank → could grow the set later
      if (nonJokers.every(mc => mc.rank === nonJokers[0].rank) && c.rank === nonJokers[0].rank) return true
      // Run: same suit and adjacent rank
      const runSuit = nonJokers[0].suit
      if (nonJokers.every(mc => mc.suit === runSuit) && c.suit === runSuit) {
        const ranks = nonJokers.map(mc => mc.rank).sort((a, b) => a - b)
        if (c.rank === ranks[0] - 1 || c.rank === ranks[ranks.length - 1] + 1) return true
      }
      return false
    })
  )

  // Wait if: 4+ high-point stuck cards AND 1-2 remaining with lay-off potential AND all opponents have 7+ cards
  if (stuckPoints >= 40 && remaining.length <= 2 && hasLayOffPotential && allOpponentsHaveMany) {
    return false // wait
  }

  // Wait if: lots of stuck points and all opponents are far from going out
  if (stuckPoints >= 40 && remaining.length >= 4 && allOpponentsHaveMany) {
    return false // wait
  }

  // Default: go down
  return true
}

// Easy AI: discard a fully random non-joker card — GDD Section 11 Easy behavior.
// Discard logic for Easy AI:
//   1. Prefer isolated cards (no same-suit adjacent card in hand).
//   2. If no isolated cards, fall back to highest-value card.
// Never discards a joker unless the hand is all jokers.
export function aiChooseDiscardEasy(hand: Card[]): Card {
  if (hand.length === 0) throw new Error('Empty hand')
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

  // Within the pool, pick highest point value (random tiebreak)
  const maxPts = Math.max(...pool.map(c => cardPoints(c.rank)))
  const best = pool.filter(c => cardPoints(c.rank) === maxPts)
  return best[Math.floor(Math.random() * best.length)]
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
