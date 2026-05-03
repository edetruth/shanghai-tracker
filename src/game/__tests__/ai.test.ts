import { describe, it, expect } from 'vitest'
import {
  aiFindBestMelds, aiFindAllMelds, canFormAnyValidMeld,
  aiChooseDiscard, aiChooseDiscardEasy,
  aiShouldTakeDiscard, aiShouldTakeDiscardHard, aiShouldBuy, aiShouldBuyHard,
  aiFindJokerSwap, aiFindPreLayDownJokerSwap,
  aiShouldGoDownHard,
  evaluateHand, getAIEvalConfig,
} from '../ai'
import type { Player, OpponentHistory } from '../types'
import { isValidSet, isValidRun } from '../meld-validator'
import { c, joker, makeMeld } from './helpers'
import { ROUND_REQUIREMENTS } from '../rules'

const req1 = ROUND_REQUIREMENTS[0] // 2 sets
const req2 = ROUND_REQUIREMENTS[1] // 1 set + 1 run
const req3 = ROUND_REQUIREMENTS[2] // 2 runs
const req4 = ROUND_REQUIREMENTS[3] // 3 sets

const sharkConfig = getAIEvalConfig('the-shark')
const rookieConfig = getAIEvalConfig('rookie-riley')

describe('aiFindBestMelds — sets', () => {
  it('finds 2 natural sets for Round 1', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),
      c('hearts', 9), c('diamonds', 9), c('clubs', 9),
      c('spades', 2), c('hearts', 3), c('clubs', 5), c('diamonds', 6),
    ]
    const result = aiFindBestMelds(hand, req1)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it('returns null when 2 sets cannot be formed', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), // only a pair
      c('hearts', 3), c('clubs', 4), c('spades', 8),
    ]
    expect(aiFindBestMelds(hand, req1)).toBeNull()
  })

  it('uses joker to complete a set', () => {
    const hand = [
      c('hearts', 5), c('diamonds', 5), joker(), // 2+joker = set
      c('hearts', 8), c('diamonds', 8), c('clubs', 8),
    ]
    const result = aiFindBestMelds(hand, req1)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it('finds 3 sets for Round 4', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),
      c('hearts', 9), c('diamonds', 9), c('clubs', 9),
      c('hearts', 11), c('diamonds', 11), c('clubs', 11),
      c('spades', 3),
    ]
    const result = aiFindBestMelds(hand, req4)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(3)
  })
})

describe('aiFindBestMelds — runs (bug reproduction)', () => {
  it('finds 2 natural runs in a large hand (18 cards, no jokers needed)', () => {
    const hand = [
      // Hearts: 2-3-4-5-6-7 is a run, 10-J are extras
      c('hearts', 2), c('hearts', 3), c('hearts', 4), c('hearts', 5),
      c('hearts', 6), c('hearts', 7), c('hearts', 10), c('hearts', 11),
      // Diamonds
      c('diamonds', 3), c('diamonds', 5), c('diamonds', 6),
      // Clubs
      c('clubs', 2), c('clubs', 6), c('clubs', 12),
      // Spades: 9-10-J-Q is a run
      c('spades', 9), c('spades', 10), c('spades', 11), c('spades', 12),
    ]
    const result = aiFindBestMelds(hand, req3)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it('tryFindRun finds 9-10-J-Q of spades as a valid run', () => {
    const hand = [
      c('spades', 9), c('spades', 10), c('spades', 11), c('spades', 12),
    ]
    const result = aiFindBestMelds(hand, { sets: 0, runs: 1, description: '1 Run' })
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0]).toHaveLength(4)
  })

  it('isValidRun accepts 9-10-J-Q of same suit', () => {
    const cards = [c('spades', 9), c('spades', 10), c('spades', 11), c('spades', 12)]
    expect(isValidRun(cards)).toBe(true)
  })

  it('finds run when suit has duplicate ranks (multi-deck)', () => {
    // From 2 decks: two 3♥ and two 5♥ — but 3-4-5-6 is still a valid run
    const hand = [
      c('hearts', 3, 'h3-0'), c('hearts', 3, 'h3-1'),
      c('hearts', 4, 'h4-0'),
      c('hearts', 5, 'h5-0'), c('hearts', 5, 'h5-1'),
      c('hearts', 6, 'h6-0'),
    ]
    const result = aiFindBestMelds(hand, { sets: 0, runs: 1, description: '1 Run' })
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0]).toHaveLength(4)
  })

  it('finds 2 runs when suit has many duplicate ranks (multi-deck)', () => {
    // Heavy duplicates: hearts has [3,3,4,4,5,5,6,7,10,J]
    // Should find e.g. 3-4-5-6 and then 9♠-10♠-J♠-Q♠
    const hand = [
      c('hearts', 3, 'h3-0'), c('hearts', 3, 'h3-1'),
      c('hearts', 4, 'h4-0'), c('hearts', 4, 'h4-1'),
      c('hearts', 5, 'h5-0'), c('hearts', 5, 'h5-1'),
      c('hearts', 6, 'h6-0'), c('hearts', 7, 'h7-0'),
      c('hearts', 10, 'h10-0'), c('hearts', 11, 'hJ-0'),
      c('spades', 9, 's9-0'), c('spades', 10, 's10-0'),
      c('spades', 11, 'sJ-0'), c('spades', 12, 'sQ-0'),
    ]
    const result = aiFindBestMelds(hand, { sets: 0, runs: 2, description: '2 Runs' })
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })
})

describe('aiFindBestMelds — runs', () => {
  it('finds a natural run for Round 3 (2 runs)', () => {
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8),
      c('spades', 2), c('spades', 3), c('spades', 4), c('spades', 5),
      c('clubs', 9), c('diamonds', 10),
    ]
    const result = aiFindBestMelds(hand, req3)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it('uses joker to fill a gap in a run', () => {
    const hand = [
      c('hearts', 5), c('hearts', 6), joker(), c('hearts', 8), // gap at 7
      c('spades', 3), c('spades', 4), c('spades', 5), c('spades', 6),
    ]
    const result = aiFindBestMelds(hand, req3)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it('returns null when 2 runs cannot be formed', () => {
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), // 1 run
      c('spades', 2), c('clubs', 4), c('diamonds', 9), // scattered
    ]
    expect(aiFindBestMelds(hand, req3)).toBeNull()
  })
})

describe('aiFindBestMelds — mixed (Round 2: 1 set + 1 run)', () => {
  it('finds 1 set + 1 run', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),
      c('spades', 3), c('spades', 4), c('spades', 5), c('spades', 6),
    ]
    const result = aiFindBestMelds(hand, req2)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })
})

const req6 = ROUND_REQUIREMENTS[5] // 1 set + 2 runs
const req7 = ROUND_REQUIREMENTS[6] // 3 runs

describe('aiFindBestMelds — ace-high run backtracking', () => {
  it('finds J-Q-K-A ace-high run when alternate set exists (Round 2)', () => {
    const hand = [
      c('hearts', 1),   c('hearts', 11),  c('hearts', 12), c('hearts', 13),
      c('diamonds', 1), c('clubs', 1),
      c('diamonds', 7), c('clubs', 7), c('spades', 7),
      c('spades', 4),
    ]
    const result = aiFindBestMelds(hand, req2)
    expect(result).not.toBeNull()
    const hasAceHighRun = result!.some(meld =>
      meld.some(c => c.rank === 1 && c.suit === 'hearts') && meld.some(c => c.rank === 13)
    )
    expect(hasAceHighRun).toBe(true)
  })

  it('finds both same-suit runs when low run and ace-high run coexist (Round 3)', () => {
    const hand = [
      c('hearts', 1),  c('hearts', 3),  c('hearts', 4),
      c('hearts', 5),  c('hearts', 6),  c('hearts', 11),
      c('hearts', 12), c('hearts', 13),
      c('spades', 9),  c('clubs', 2),
    ]
    const result = aiFindBestMelds(hand, req3)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    const hasAceHigh = result!.some(meld =>
      meld.some(c => c.rank === 1) && meld.some(c => c.rank === 13)
    )
    expect(hasAceHigh).toBe(true)
  })

  it('finds non-overlapping same-suit runs: 4-7 + J-Q-K-A (Round 3)', () => {
    const hand = [
      c('hearts', 1),  c('hearts', 4),  c('hearts', 5),
      c('hearts', 6),  c('hearts', 7),  c('hearts', 11),
      c('hearts', 12), c('hearts', 13),
      c('spades', 9),  c('clubs', 2),
    ]
    const result = aiFindBestMelds(hand, req3)
    expect(result).not.toBeNull()
    const hasAceHigh = result!.some(meld =>
      meld.some(c => c.rank === 1) && meld.some(c => c.rank === 13)
    )
    expect(hasAceHigh).toBe(true)
  })

  it('finds ace-high run in Round 6 (1 set + 2 runs)', () => {
    const hand = [
      c('hearts', 1),   c('hearts', 11), c('hearts', 12), c('hearts', 13),
      c('diamonds', 3), c('diamonds', 4), c('diamonds', 5), c('diamonds', 6),
      c('clubs', 7),    c('spades', 7),  c('diamonds', 7),
      c('spades', 2),
    ]
    const result = aiFindBestMelds(hand, req6)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(3)
  })

  it('finds ace-high run in Round 7 (3 runs)', () => {
    const hand = [
      c('hearts', 1),   c('hearts', 11), c('hearts', 12), c('hearts', 13),
      c('diamonds', 3), c('diamonds', 4), c('diamonds', 5), c('diamonds', 6),
      c('clubs', 7),    c('clubs', 8),   c('clubs', 9),   c('clubs', 10),
    ]
    const result = aiFindBestMelds(hand, req7)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(3)
  })

  it('conserves joker for 3-card natural run when J-Q-K-A requires no joker (Round 6)', () => {
    // Regression: old code found J-Q-K-JOKER first (burning the only joker), then
    // couldn't form 3♦-4♦-5♦ into a 4-card run. Fix: jCount outer loop + ace-high
    // variant ensures J-Q-K-A is found at jCount=0, leaving joker for diamonds.
    const hand = [
      c('diamonds', 1), c('clubs', 1),    c('clubs', 1),   c('spades', 1),
      c('diamonds', 3), c('diamonds', 4), c('diamonds', 5),
      c('clubs', 3),    c('clubs', 7),    c('clubs', 8),   c('clubs', 10), c('clubs', 11),
      c('spades', 5),   c('spades', 11),  c('spades', 12), c('spades', 13),
      joker(),
    ]
    const result = aiFindBestMelds(hand, req6)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(3)
    // Must include the ace-high spades run J-Q-K-A
    const hasAceHighSpades = result!.some(meld =>
      meld.some(c => c.rank === 11 && c.suit === 'spades') &&
      meld.some(c => c.rank === 1  && c.suit === 'spades') &&
      meld.every(c => c.suit === 'spades' || c.suit === 'joker')
    )
    expect(hasAceHighSpades).toBe(true)
    // Must not consume the joker in the ace-high run
    const aceHighRun = result!.find(meld =>
      meld.some(c => c.rank === 11 && c.suit === 'spades')
    )
    expect(aceHighRun?.some(c => c.suit === 'joker')).toBe(false)
  })

  it('returns null when ace is genuinely contested (no valid combo exists)', () => {
    // A♥ needed for both ace-low run and ace-high run, only 7 hearts total
    const hand = [
      c('hearts', 1),  c('hearts', 2),  c('hearts', 3),
      c('hearts', 4),  c('hearts', 11), c('hearts', 12),
      c('hearts', 13), c('spades', 9),  c('clubs', 2), c('diamonds', 7),
    ]
    const result = aiFindBestMelds(hand, req3)
    expect(result).toBeNull()
  })
})

describe('aiFindAllMelds', () => {
  it('finds required melds plus an extra set on a sets-only round', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7), // set 1
      c('hearts', 9), c('diamonds', 9), c('clubs', 9), // set 2
      c('hearts', 11), c('diamonds', 11), c('clubs', 11), // extra set
      c('spades', 5),
    ]
    const result = aiFindAllMelds(hand, req1)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThanOrEqual(3)
  })

  it('does not add extra sets to a runs-only round', () => {
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8),
      c('spades', 2), c('spades', 3), c('spades', 4), c('spades', 5),
      c('clubs', 9), c('clubs', 9),
    ]
    const result = aiFindAllMelds(hand, req3)
    // All melds should be runs (not sets) on a runs-only round
    if (result) {
      result.forEach(meld => {
        expect(isValidRun(meld)).toBe(true)
        expect(isValidSet(meld)).toBe(false)
      })
    }
  })

  it('returns null when required melds cannot be formed', () => {
    const hand = [c('hearts', 5), c('diamonds', 6), c('clubs', 3)]
    expect(aiFindAllMelds(hand, req1)).toBeNull()
  })
})

describe('canFormAnyValidMeld', () => {
  it('detects a possible set', () => {
    const cards = [c('hearts', 7), c('diamonds', 7), c('clubs', 7), c('spades', 3)]
    expect(canFormAnyValidMeld(cards, 'both')).toBe(true)
  })

  it('detects a possible run', () => {
    const cards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    expect(canFormAnyValidMeld(cards, 'both')).toBe(true)
  })

  it('returns false when nothing can be formed', () => {
    const cards = [c('hearts', 2), c('spades', 7), c('clubs', 11)]
    expect(canFormAnyValidMeld(cards, 'both')).toBe(false)
  })

  it('respects allowedTypes=set (does not detect runs)', () => {
    const cards = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    expect(canFormAnyValidMeld(cards, 'set')).toBe(false)
  })

  it('respects allowedTypes=run (does not detect sets)', () => {
    const cards = [c('hearts', 7), c('diamonds', 7), c('clubs', 7)]
    expect(canFormAnyValidMeld(cards, 'run')).toBe(false)
  })
})

describe('aiChooseDiscard', () => {
  it('never discards a joker when other cards exist', () => {
    const hand = [joker(), c('hearts', 5), c('spades', 2)]
    expect(aiChooseDiscard(hand, req1).suit).not.toBe('joker')
  })

  it('discards the least useful card', () => {
    // Single card not part of any potential meld
    const hand = [
      c('hearts', 7), c('diamonds', 7), // pair
      c('clubs', 2),                      // isolated low card
    ]
    expect(aiChooseDiscard(hand, req1).id).toBe(hand[2].id)
  })

  it('discards from non-committed suits on run-heavy rounds', () => {
    // 3 suits: hearts (4-card run, highest score) + spades (3-card run, second highest)
    // are the top-2 committed suits; clubs (single ace) is genuinely non-committed.
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8), // committed suit 1
      c('spades', 2), c('spades', 3), c('spades', 4),                  // committed suit 2
      c('clubs', 1),                                                     // non-committed → discarded
    ]
    const discard = aiChooseDiscard(hand, req3)
    expect(discard.suit).toBe('clubs')
  })
})

describe('aiChooseDiscardEasy', () => {
  it('discards a non-joker card (random from isolated cards)', () => {
    const hand = [c('hearts', 5), c('diamonds', 1), c('clubs', 3), joker()]
    const discard = aiChooseDiscardEasy(hand)
    expect(discard.suit).not.toBe('joker')
    expect([1, 3, 5]).toContain(discard.rank)
  })

  it('falls back to highest-value card when all cards are connected', () => {
    // hearts 5,6,7 are all adjacent same-suit → not isolated; clubs 3 has no partner
    // Actually: 5 is adjacent to 6, 6 adjacent to 5&7, 7 adjacent to 6 → all non-isolated
    // clubs 3 has no adjacent same-suit → isolated
    const hand = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('clubs', 3)]
    const discard = aiChooseDiscardEasy(hand)
    expect(discard.rank).toBe(3) // only isolated card
  })

  it('falls back to highest value when no isolated cards exist', () => {
    // Two pairs: hearts 5&6 adjacent, spades 9&10 adjacent → nothing isolated
    const hand = [c('hearts', 5), c('hearts', 6), c('spades', 9), c('spades', 10)]
    const discard = aiChooseDiscardEasy(hand)
    expect(discard.rank).toBe(10) // highest value fallback
  })
})

describe('aiFindJokerSwap', () => {
  it('finds a swap when natural card matches joker in run', () => {
    const jkr = joker('jkr-swap')
    const meld = makeMeld([c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 6), c('spades', 3)]
    const result = aiFindJokerSwap(hand, [meld])
    expect(result).not.toBeNull()
    expect(result?.card.rank).toBe(6)
  })

  it('returns null when no swappable joker exists', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('hearts', 4), c('spades', 3)]
    expect(aiFindJokerSwap(hand, [meld])).toBeNull()
  })

  it('returns null for set melds', () => {
    const jkr = joker('jkr-set')
    const meld = makeMeld([c('hearts', 7), c('diamonds', 7), jkr], 'set')
    const hand = [c('clubs', 7)]
    expect(aiFindJokerSwap(hand, [meld])).toBeNull()
  })
})

describe('aiFindPreLayDownJokerSwap', () => {
  it('returns swap that enables lay-down', () => {
    const jkr = joker('jkr-pre')
    const tableMeld = makeMeld([c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)], 'run')
    // Hand almost has a set but needs the joker
    const hand = [
      c('hearts', 6),    // will give this, get joker back
      c('clubs', 9), c('diamonds', 9), // + joker = set of 9s
      c('spades', 2), c('clubs', 3),
    ]
    // With joker: [clubs9, diamonds9, joker] = set → meets req1 (1 set so far)
    // Actually req1 needs 2 sets. Let's use req with 1 set:
    const req1set = { sets: 1, runs: 0, description: '1 Set' }
    const result = aiFindPreLayDownJokerSwap(hand, [tableMeld], req1set)
    expect(result).not.toBeNull()
  })

  it('returns null when no swap helps', () => {
    const jkr = joker('jkr-nope')
    const tableMeld = makeMeld([c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)], 'run')
    const hand = [c('clubs', 2), c('spades', 4)] // can't form melds regardless
    const result = aiFindPreLayDownJokerSwap(hand, [tableMeld], req1)
    expect(result).toBeNull()
  })
})

describe('aiShouldTakeDiscardHard', () => {
  it('always takes a joker', () => {
    const hand = [c('hearts', 2), c('spades', 7), c('clubs', 11)]
    expect(aiShouldTakeDiscardHard(hand, joker(), req3, false)).toBe(true)
  })

  it('returns false after laying down', () => {
    const hand = [c('hearts', 5), c('hearts', 6)]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 7), req3, true)).toBe(false)
  })

  it('takes card that enables melds (couldn\'t meet requirement before, can with card)', () => {
    // Hand has one complete run + almost a second run (needs 8♠ for 4-card min)
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8),
      c('spades', 5), c('spades', 6), c('spades', 7), // need 8♠ to complete second run (min 4)
      c('clubs', 2), c('diamonds', 10), c('diamonds', 3),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('spades', 8), req3, false)).toBe(true)
  })

  it('takes card completing a set (2+ same rank in hand)', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), // pair of 7s
      c('spades', 3), c('clubs', 5), c('hearts', 9),
      c('spades', 10), c('clubs', 12), c('diamonds', 2), c('hearts', 4), c('clubs', 8),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('clubs', 7), req1, false)).toBe(true)
  })

  it('takes gap-fill when 3+ cards in run window', () => {
    // 3 hearts in a window: 5, 7, 8 (gap at 6)
    const hand = [
      c('hearts', 5), c('hearts', 7), c('hearts', 8),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 6),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 6), req3, false)).toBe(true)
  })

  it('takes gap-fill in committed suit even with 1-2 cards', () => {
    // 2 hearts: 5, 7 (gap at 6) — hearts is committed, gap-fill is valuable
    const hand = [
      c('hearts', 5), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 6), c('clubs', 8),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 6), req3, false)).toBe(true)
  })

  it('takes direct extension when 3+ cards in run window', () => {
    // 3 hearts in a window: 5, 6, 7 — extend with 8♥
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 11),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 8), req3, false)).toBe(true)
  })

  it('takes extension in committed suit even with 1-2 cards', () => {
    // 2 hearts: 6, 7 — hearts is committed, extension 8♥ builds toward run
    const hand = [
      c('hearts', 6), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 6), c('clubs', 8),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 8), req3, false)).toBe(true)
  })

  it('rejects distant cards that don\'t improve hand score', () => {
    // 3 hearts: 5, 6, 7 — window spans 5-7; 13♦ is isolated and doesn't help
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 11),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('diamonds', 13), req3, false)).toBe(false)
  })

  it('takes card in secondary committed suit when it extends a run', () => {
    // Hearts is primary committed suit; clubs/diamonds are secondary candidates
    // 5♣ extends from 4♣ — take it if clubs is committed
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('clubs', 5), req3, false)).toBe(true)
  })

  it('rejects cards that worsen hand on set-only rounds', () => {
    // Round 1 (2 sets) — already have strong pairs; adding an isolated high card hurts
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),  // complete set
      c('hearts', 9), c('diamonds', 9),                   // pair
      c('spades', 2), c('clubs', 10), c('diamonds', 3), c('spades', 6), c('hearts', 4),
    ]
    // 13♣ is isolated King — doesn't pair, doesn't improve evaluation enough
    expect(aiShouldTakeDiscardHard(hand, c('clubs', 13), req1, false)).toBe(false)
  })

  it('evaluates purely on self-interest (no denial)', () => {
    // Hand full of scattered cards — isolated K♦ doesn't improve evaluation
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    // Card doesn't form pairs or runs with existing hand → pass
    expect(aiShouldTakeDiscardHard(hand, c('diamonds', 13), req1, false)).toBe(false)
  })

  it('rejects card that adds dead weight on large hands', () => {
    // 12-card hand with existing potential — adding another isolated card is net negative
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),  // complete set
      c('hearts', 9), c('diamonds', 9), c('clubs', 9),  // complete set
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('hearts', 13),
    ]
    // Isolated 11♠ doesn't improve a hand that can already go down
    expect(aiShouldTakeDiscardHard(hand, c('spades', 11), req1, false)).toBe(false)
  })

  it('takes card that forms a pair on set rounds', () => {
    const hand = [
      c('hearts', 9), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 7),
    ]
    // 9♦ pairs with hearts 9 → improvement (pair = +12 vs isolated penalty)
    expect(aiShouldTakeDiscardHard(hand, c('diamonds', 9), req1, false)).toBe(true)
  })
})

describe('aiChooseDiscard — evaluation-based', () => {
  it('discards isolated card over pair member', () => {
    // pair of 7s (high utility) + 9♥ (isolated)
    const hand = [c('clubs', 7), c('diamonds', 7), c('hearts', 9)]
    const discard = aiChooseDiscard(hand, req1)
    expect(discard.rank).toBe(9) // isolated card, lowest evaluation impact
  })

  it('discards highest-point isolated card', () => {
    // All isolated — should discard highest point value
    const hand = [c('hearts', 7), c('diamonds', 2), c('clubs', 13)]
    const discard = aiChooseDiscard(hand, req1, sharkConfig) // zero noise for determinism
    expect(discard.rank).toBe(13) // King = 10pts, highest isolated penalty
  })

  it('protects run windows in run rounds', () => {
    // 3-card run window in hearts vs isolated spades card
    const hand = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('spades', 13)]
    const discard = aiChooseDiscard(hand, req3)
    expect(discard.suit).toBe('spades') // protect the run window
  })

  it('protects pairs on set rounds', () => {
    const hand = [c('hearts', 7), c('diamonds', 7), c('clubs', 2)]
    const discard = aiChooseDiscard(hand, req1)
    expect(discard.rank).toBe(2) // isolated, lowest evaluation
  })
})

describe('aiChooseDiscard — opponent awareness', () => {
  it('avoids discarding a card that lays off onto opponent table run', () => {
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('spades', 3)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Both 9♥ and 2♣ are isolated — similar evaluation. But 9♥ lays off on opponent's run.
    const hand = [c('hearts', 9), c('clubs', 2)]
    const discard = aiChooseDiscard(hand, req1, sharkConfig, [oppMeld], [opponent])
    expect(discard.suit).toBe('clubs') // safer discard
  })

  it('avoids discarding a suit opponents have been picking up', () => {
    const history = new Map<string, OpponentHistory>()
    history.set('opp1', {
      picked: [c('hearts', 5), c('hearts', 8)], // picked 2 hearts
      discarded: [],
    })
    const hand = [c('hearts', 3), c('clubs', 4)]
    const discard = aiChooseDiscard(hand, req1, sharkConfig, [], undefined, history)
    expect(discard.suit).toBe('clubs')
  })

  it('still discards a dangerous card if it is the only non-useful card', () => {
    const history = new Map<string, OpponentHistory>()
    history.set('opp1', {
      picked: [c('hearts', 5), c('hearts', 8), c('hearts', 3)],
      discarded: [],
    })
    // Pair of 7s (high utility) + 9♥ (dangerous but only discard option)
    const hand = [c('clubs', 7), c('diamonds', 7), c('hearts', 9)]
    const discard = aiChooseDiscard(hand, req1, sharkConfig, [], undefined, history)
    expect(discard.rank).toBe(9) // must discard the only non-pair card
  })

  it('non-aware personality ignores opponent data and discards normally', () => {
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('spades', 3)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Two equal-point cards (both 5pts). 4♥ extends opponent's run, 4♣ doesn't.
    // Shark would avoid discarding 4♥ (danger), but Rookie ignores danger.
    const hand = [c('hearts', 4), c('clubs', 4)]
    const rookieDiscard = aiChooseDiscard(hand, req1, rookieConfig, [oppMeld], [opponent])
    const sharkDiscard = aiChooseDiscard(hand, req1, sharkConfig, [oppMeld], [opponent])
    // Shark avoids hearts (dangerous) → discards clubs
    expect(sharkDiscard.suit).toBe('clubs')
    // Rookie ignores danger — may discard either (evaluation sees them as equal)
    expect(rookieDiscard).toBeDefined() // just verifies it doesn't crash
  })
})

describe('aiShouldTakeDiscard — denial', () => {
  it('denial-takes a card that extends an opponent run when opponent is close to going out', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11), c('spades', 3)], // 2 cards — close!
      melds: [oppMeld], hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // 9♥ extends opponent's run and opponent has only 2 cards. Shark should denial-take.
    expect(aiShouldTakeDiscard(hand, c('hearts', 9), req1, false, sharkConfig, [oppMeld], [opponent])).toBe(true)
  })

  it('does NOT denial-take high-point cards (aces)', () => {
    // Hand has NO spade cards to form runs with, so self-interest won't want the ace either
    const hand = [
      c('hearts', 2), c('hearts', 5), c('clubs', 10), c('diamonds', 3),
      c('hearts', 12), c('clubs', 4), c('diamonds', 9),
    ]
    const oppMeld = { ...makeMeld([c('spades', 2), c('spades', 3), c('spades', 4), c('spades', 5)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('clubs', 8)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Ace = 15 points > 10 threshold — don't denial-take even though it extends opponent's run
    expect(aiShouldTakeDiscard(hand, c('spades', 1), req1, false, sharkConfig, [oppMeld], [opponent])).toBe(false)
  })

  it('does NOT denial-take when opponent has many cards (7+)', () => {
    // Denial only fires when opponent has ≤ 6 cards and is close to going out
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
    ]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp',
      hand: [c('hearts', 11), c('spades', 3), c('clubs', 2), c('diamonds', 8), c('spades', 7), c('clubs', 9), c('diamonds', 6)], // 7 cards — not close
      melds: [oppMeld], hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // 9♥ extends run but opponent has 7 cards — denial guard won't fire
    expect(aiShouldTakeDiscard(hand, c('hearts', 9), req1, false, sharkConfig, [oppMeld], [opponent])).toBe(false)
  })

  it('non-denial personality does NOT denial-take', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
    ]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Rookie has denialTake: false
    expect(aiShouldTakeDiscard(hand, c('hearts', 9), req1, false, rookieConfig, [oppMeld], [opponent])).toBe(false)
  })
})

describe('aiShouldBuyHard — Phase 2', () => {
  it('does NOT denial-buy (denial removed) — uses cost/benefit evaluation', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3), c('spades', 12),
    ]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11), c('spades', 3)], // 2 cards
      melds: [oppMeld], hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Card doesn't help the AI enough (low value) and opponent pressure is high (risk)
    expect(aiShouldBuyHard(hand, c('hearts', 9), req1, 4, [oppMeld], [opponent])).toBe(false)
  })

  it('does NOT denial-buy if buysRemaining < 3', () => {
    const hand = [c('hearts', 2), c('spades', 5), c('clubs', 10)]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // buysRemaining = 2 → aiShouldBuyHard returns false (≤ 2 guard)
    expect(aiShouldBuyHard(hand, c('hearts', 9), req1, 2, [oppMeld], [opponent])).toBe(false)
  })

  it('does NOT denial-buy if own hand >= 7 cards', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ] // 7 cards
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    expect(aiShouldBuyHard(hand, c('hearts', 9), req1, 4, [oppMeld], [opponent])).toBe(false)
  })

  it('self-interest buy: card completes a set', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), // pair of 7s
      c('spades', 3), c('clubs', 5), c('hearts', 9),
    ]
    expect(aiShouldBuyHard(hand, c('clubs', 7), req1, 4)).toBe(true)
  })

  it('buys pairs when hand is small and improvement is clear', () => {
    // Evaluation system: forming a pair from nothing significantly improves hand score
    // on set rounds with small hands (low risk)
    const hand = [
      c('hearts', 5), c('spades', 3), c('clubs', 10), c('diamonds', 2),
    ]
    expect(aiShouldBuyHard(hand, c('clubs', 5), req1, 4)).toBe(true)
  })
})

// ── Phase 3: aiShouldGoDownHard ─────────────────────────────────────────────
describe('aiShouldGoDownHard', () => {
  const makePlayer = (overrides: Partial<Player> & { id: string; name: string }): Player => ({
    hand: [], melds: [], hasLaidDown: false, buysRemaining: 5, roundScores: [],
    ...overrides,
  })

  // Melds that satisfy req1 (2 sets)
  const set1 = [c('hearts', 7), c('diamonds', 7), c('clubs', 7)]
  const set2 = [c('hearts', 9), c('diamonds', 9), c('clubs', 9)]
  const twoSets = [set1, set2]

  it('always goes down when going out (0 remaining cards)', () => {
    const hand = [...set1, ...set2] // all cards in melds → 0 remaining
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(10).fill(c('clubs', 2)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('always goes down when an opponent has laid down', () => {
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)] // 55 pts
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(8).fill(c('clubs', 2)), hasLaidDown: true }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('always goes down when turnsWaited >= 3', () => {
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)]
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(10).fill(c('clubs', 2)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 3)).toBe(true)
  })

  it('always goes down when any opponent has <= 4 cards', () => {
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)]
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: [c('clubs', 2), c('clubs', 3), c('clubs', 4), c('clubs', 5)] }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('goes down with 4+ remaining cards even with high stuck points and opponents having many cards', () => {
    // With bonus melds disabled, holding 4+ cards of deadweight is never worth it
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)] // 15+10+10+10 = 45
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(8).fill(c('clubs', 2)) }),
      makePlayer({ id: 'p2', name: 'Opp2', hand: Array(9).fill(c('clubs', 3)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('does NOT wait when stuck points < 40 even with many remaining cards', () => {
    // Low-value stuck cards: 4 * 5pts = 20 pts < 40 threshold
    const stuck = [c('hearts', 2), c('diamonds', 3), c('clubs', 4), c('spades', 5)]
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(10).fill(c('clubs', 2)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('does NOT wait when an opponent has few cards even with high stuck points', () => {
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)] // 45 pts
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: [c('clubs', 2), c('clubs', 3), c('clubs', 4)] }), // 3 cards!
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('goes down after waiting 3 turns even with high stuck points', () => {
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)]
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(10).fill(c('clubs', 2)) }),
    ]
    // turnsWaited=2, 4 remaining cards → goes down (no point holding 4+ cards of deadweight)
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 2)).toBe(true)
    // turnsWaited=3 → also forced to go down
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 3)).toBe(true)
  })

  it('goes down with 0 remaining (Shanghai) regardless of other conditions', () => {
    // Hand is exactly the melds — going out immediately
    const hand = [...set1, ...set2]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(10).fill(c('clubs', 2)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })

  it('goes down by default with moderate stuck points (< 40)', () => {
    // 3 * 5pts = 15 pts < 40 → default go down
    const stuck = [c('hearts', 2), c('diamonds', 3), c('clubs', 4)]
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(10).fill(c('clubs', 2)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(true)
  })
})

// ── Hand Evaluation System ──────────────────────────────────────────────────

describe('evaluateHand', () => {
  it('scores a hand that can go down highest (200 - remaining pts)', () => {
    const hand = [
      c('hearts', 7), c('diamonds', 7), c('clubs', 7),  // complete set
      c('spades', 5), c('spades', 6), c('spades', 7), c('spades', 8),  // complete run
      c('hearts', 2), c('diamonds', 10),  // leftovers
    ]
    const score = evaluateHand(hand, req2)
    expect(score).toBeGreaterThan(150)  // can go down = 200 - remaining points
  })

  it('scores a hand with strong potential higher than a weak hand', () => {
    const strong = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7),  // 3-card run window
      c('spades', 9), c('spades', 10), c('spades', 11),  // another 3-card window
      c('diamonds', 3), c('clubs', 8),
    ]
    const weak = [
      c('hearts', 2), c('diamonds', 7), c('clubs', 10), c('spades', 4),
      c('hearts', 9), c('diamonds', 3), c('clubs', 13), c('spades', 11),
    ]
    expect(evaluateHand(strong, req3)).toBeGreaterThan(evaluateHand(weak, req3))
  })

  it('jokers significantly increase score', () => {
    const withoutJoker = [
      c('hearts', 5), c('hearts', 6),  // 2-card window
      c('spades', 9), c('spades', 10),  // 2-card window
    ]
    const withJoker = [...withoutJoker, joker()]
    expect(evaluateHand(withJoker, req3)).toBeGreaterThan(evaluateHand(withoutJoker, req3) + 10)
  })

  it('isolated high cards reduce score', () => {
    const withKing = [c('hearts', 2), c('hearts', 3), c('hearts', 4), c('spades', 13)]
    const withTwo = [c('hearts', 2), c('hearts', 3), c('hearts', 4), c('spades', 2)]
    expect(evaluateHand(withTwo, req3)).toBeGreaterThan(evaluateHand(withKing, req3))
  })

  it('complete sets score higher than pairs', () => {
    const tripleSet = [c('hearts', 7), c('diamonds', 7), c('clubs', 7), c('spades', 2)]
    const pair = [c('hearts', 7), c('diamonds', 7), c('clubs', 3), c('spades', 2)]
    expect(evaluateHand(tripleSet, req1)).toBeGreaterThan(evaluateHand(pair, req1))
  })

  it('run rounds weight run potential more heavily', () => {
    // Hand with strong run potential but no set potential
    const runHand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7),
      c('spades', 2), c('clubs', 10),
    ]
    // On run round vs set round
    const runScore = evaluateHand(runHand, req3) // 2 runs
    const setScore = evaluateHand(runHand, req1) // 2 sets
    expect(runScore).toBeGreaterThan(setScore)
  })
})

describe('AI decisions with hand evaluation', () => {
  it('takes discard that completes a run', () => {
    const hand = [c('hearts', 5), c('hearts', 6), c('hearts', 8), c('spades', 3)]
    const card = c('hearts', 7)  // fills the gap!
    expect(aiShouldTakeDiscard(hand, card, req3, false)).toBe(true)
  })

  it('does not take discard that adds nothing', () => {
    const hand = [c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)]
    const card = c('diamonds', 13)  // isolated King, different suit
    expect(aiShouldTakeDiscard(hand, card, req3, false)).toBe(false)
  })

  it('discards the card that hurts least', () => {
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7),  // run window — protect
      c('spades', 13),  // isolated King — discard this
    ]
    const discard = aiChooseDiscard(hand, req3)
    expect(discard.rank).toBe(13)
    expect(discard.suit).toBe('spades')
  })

  it('buys card that enables going down when risk is low', () => {
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8),  // complete run
      c('spades', 9), c('spades', 10), c('spades', 11),  // 3-card window, need 1 more
      c('diamonds', 3),
    ]
    const card = c('spades', 12)  // completes second run
    expect(aiShouldBuy(hand, card, req3, 5)).toBe(true)
  })

  it('does not buy when hand is huge and opponents are close', () => {
    const hand = Array.from({ length: 14 }, (_, i) => c('hearts', (i % 13) + 1))
    const card = c('spades', 5)
    const players = [{ hand: { length: 2 }, hasLaidDown: true }]
    expect(aiShouldBuy(hand, card, req3, 5, sharkConfig, players)).toBe(false)
  })
})

describe('AI does not get Shanghaied with 2 jokers', () => {
  it('evaluation sees high potential in 2-joker run-round hand', () => {
    const hand = [
      joker(), joker(),
      c('spades', 3), c('diamonds', 3),
      c('hearts', 9), c('hearts', 10),
      c('clubs', 5), c('clubs', 7),
      c('diamonds', 8), c('spades', 11),
    ]
    const score = evaluateHand(hand, req3)
    // With 2 jokers and multiple run fragments, this hand has significant potential
    expect(score).toBeGreaterThan(30)
  })

  it('protects jokers by never discarding them', () => {
    const hand = [joker(), joker(), c('hearts', 2), c('spades', 13)]
    const discard = aiChooseDiscard(hand, req3)
    expect(discard.suit).not.toBe('joker')
  })
})
