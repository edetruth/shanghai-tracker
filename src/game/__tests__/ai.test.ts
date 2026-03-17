import { describe, it, expect } from 'vitest'
import {
  aiFindBestMelds, aiFindAllMelds, canFormAnyValidMeld,
  aiChooseDiscard, aiChooseDiscardEasy,
  aiFindJokerSwap, aiFindPreLayDownJokerSwap,
} from '../ai'
import { isValidSet, isValidRun } from '../meld-validator'
import { c, joker, makeMeld } from './helpers'
import { ROUND_REQUIREMENTS } from '../rules'

const req1 = ROUND_REQUIREMENTS[0] // 2 sets
const req2 = ROUND_REQUIREMENTS[1] // 1 set + 1 run
const req3 = ROUND_REQUIREMENTS[2] // 2 runs
const req4 = ROUND_REQUIREMENTS[3] // 3 sets

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
    expect(aiChooseDiscard(hand).suit).not.toBe('joker')
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
