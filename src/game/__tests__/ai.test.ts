import { describe, it, expect } from 'vitest'
import {
  aiFindBestMelds, aiFindAllMelds, canFormAnyValidMeld,
  aiChooseDiscard, aiChooseDiscardEasy, aiChooseDiscardHard,
  aiShouldTakeDiscardHard, aiShouldBuyHard,
  aiFindJokerSwap, aiFindPreLayDownJokerSwap,
  aiShouldGoDownHard,
} from '../ai'
import type { Player, OpponentHistory } from '../types'
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

  it('rejects gap-fill when only 1-2 cards in run window', () => {
    // Only 2 hearts: 5, 7 (gap at 6) — not enough evidence for Hard
    const hand = [
      c('hearts', 5), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 6), c('clubs', 8),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 6), req3, false)).toBe(false)
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

  it('rejects extension when only 1-2 cards in run window', () => {
    // Only 2 hearts: 6, 7 — not enough for Hard to take 8♥
    const hand = [
      c('hearts', 6), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 6), c('clubs', 8),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 8), req3, false)).toBe(false)
  })

  it('rejects near cards entirely (no near condition for Hard)', () => {
    // 3 hearts: 5, 6, 7 — window spans 5-7; 10♥ is 'near' but not gap-fill/extension
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 11),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 10), req3, false)).toBe(false)
  })

  it('rejects card from non-committed suit even if rank matches something', () => {
    // Hearts is the committed suit, but discard is clubs — reject
    const hand = [
      c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8),
      c('spades', 2), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('clubs', 5), req3, false)).toBe(false)
  })

  it('rejects marginal cards on set-only rounds (no run requirement)', () => {
    // Round 1 (2 sets) — no run checks apply; card doesn't complete a set or enable melds
    const hand = [
      c('hearts', 5), c('diamonds', 8), c('clubs', 11),
      c('spades', 2), c('hearts', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('spades', 6),
    ]
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 6), req1, false)).toBe(false)
  })

  it('denial-takes a card that fits an opponent meld when opponent is close to going out', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    // Opponent has a hearts run 5-6-7-8; discard is hearts 9 (extends it)
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11), c('spades', 3)], // 2 cards left
      melds: [oppMeld], hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 9), req1, false, [oppMeld], [opponent])).toBe(true)
  })

  it('does NOT denial-take if opponent has many cards', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp',
      hand: [c('hearts', 11), c('spades', 3), c('clubs', 2), c('diamonds', 8), c('spades', 7)], // 5 cards
      melds: [oppMeld], hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 9), req1, false, [oppMeld], [opponent])).toBe(false)
  })

  it('does NOT denial-take if AI hand is already 8+ cards', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9), c('hearts', 13),
    ] // 8 cards
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 9), req1, false, [oppMeld], [opponent])).toBe(false)
  })

  it('does NOT denial-take a high-point card (ace)', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    // Opponent has spades run 2-3-4-5; ace of spades can lay off at low end (rank 1)
    const oppMeld = { ...makeMeld([c('spades', 2), c('spades', 3), c('spades', 4), c('spades', 5)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('clubs', 8)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Ace (rank 1) = 15 points > 10 threshold → don't denial-take even though it fits the meld
    expect(aiShouldTakeDiscardHard(hand, c('spades', 1), req1, false, [oppMeld], [opponent])).toBe(false)
  })

  it('with no opponent data, behaves like Phase 1', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3),
      c('spades', 12), c('clubs', 4), c('diamonds', 9),
    ]
    // No tablesMelds or opponents → denial check skipped → same as Phase 1 (false)
    expect(aiShouldTakeDiscardHard(hand, c('hearts', 9), req1, false)).toBe(false)
  })
})

describe('aiChooseDiscardHard — opponent awareness', () => {
  it('avoids discarding a card that lays off onto opponent table run', () => {
    // Hand has two equally useless cards: 9♥ (dangerous) and 2♣ (safe)
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('spades', 3)], melds: [oppMeld],
      hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    // Both 9♥ and 2♣ are isolated — similar utility. But 9♥ lays off on opponent's run.
    const hand = [c('hearts', 9), c('clubs', 2)]
    const discard = aiChooseDiscardHard(hand, [oppMeld], undefined, [opponent])
    expect(discard.suit).toBe('clubs') // safer discard
  })

  it('avoids discarding a suit opponents have been picking up', () => {
    const history = new Map<string, OpponentHistory>()
    history.set('opp1', {
      picked: [c('hearts', 5), c('hearts', 8)], // picked 2 hearts
      discarded: [],
    })
    // Both isolated; hearts 3 is dangerous because opponent collects hearts
    const hand = [c('hearts', 3), c('clubs', 4)]
    const discard = aiChooseDiscardHard(hand, [], history)
    expect(discard.suit).toBe('clubs')
  })

  it('between two useless cards, discards the safer one', () => {
    const history = new Map<string, OpponentHistory>()
    history.set('opp1', {
      picked: [c('diamonds', 7)], // picked 1 diamond (rank 7)
      discarded: [c('spades', 9)], // discarded a spade — probably not building spades
    })
    // Both cards isolated, same point value. diamonds 7 is rank-matched (danger +40, suit +20)
    // spades 5 has safety discount (opponent discarded a spade, -15)
    const hand = [c('diamonds', 7), c('spades', 5)]
    const discard = aiChooseDiscardHard(hand, [], history)
    expect(discard.suit).toBe('spades')
  })

  it('still discards a dangerous card if it is the only non-useful card', () => {
    const history = new Map<string, OpponentHistory>()
    history.set('opp1', {
      picked: [c('hearts', 5), c('hearts', 8), c('hearts', 3)], // clearly collecting hearts
      discarded: [],
    })
    // hand: pair of 7s (high utility) + 9♥ (dangerous via history but only discard option)
    // Self-interest (pair utility = 120) wins over danger (suit danger = 50 * 0.5 = 25)
    const hand = [c('clubs', 7), c('diamonds', 7), c('hearts', 9)]
    const discard = aiChooseDiscardHard(hand, [], history)
    expect(discard.rank).toBe(9) // must discard the only non-pair card
  })

  it('with no opponent data, behaves like base aiChooseDiscardHard', () => {
    // No history, no opponents — just utility-based
    const hand = [c('hearts', 7), c('diamonds', 7), c('clubs', 2)]
    const discard = aiChooseDiscardHard(hand)
    expect(discard.rank).toBe(2) // isolated, lowest utility
  })
})

describe('aiShouldBuyHard — Phase 2', () => {
  it('denial-buys when opponent at 2 cards, has gone down, card fits their meld', () => {
    const hand = [
      c('hearts', 2), c('spades', 5), c('clubs', 10), c('diamonds', 3), c('spades', 12),
    ]
    const oppMeld = { ...makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run'), ownerId: 'opp1' }
    const opponent: Player = {
      id: 'opp1', name: 'Opp', hand: [c('hearts', 11), c('spades', 3)], // 2 cards
      melds: [oppMeld], hasLaidDown: true, buysRemaining: 3, roundScores: [],
    }
    expect(aiShouldBuyHard(hand, c('hearts', 9), req1, 4, [oppMeld], [opponent])).toBe(true)
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

  it('no longer buys on single-card pairs', () => {
    // Only 1 card of rank 5 in hand — sameRank < 2 → no buy
    const hand = [
      c('hearts', 5), c('spades', 3), c('clubs', 10), c('diamonds', 2),
    ]
    expect(aiShouldBuyHard(hand, c('clubs', 5), req1, 4)).toBe(false)
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

  it('waits when 40+ stuck pts, 1-2 remaining with lay-off potential, all opponents have 7+ cards', () => {
    // Wait condition: stuckPoints >= 40 AND remaining.length >= 4 AND allOpponentsHaveMany
    const stuck = [c('hearts', 1), c('diamonds', 13), c('clubs', 12), c('spades', 11)] // 15+10+10+10 = 45
    const hand = [...set1, ...set2, ...stuck]
    const players = [
      makePlayer({ id: 'p0', name: 'AI', hand }),
      makePlayer({ id: 'p1', name: 'Opp', hand: Array(8).fill(c('clubs', 2)) }),
      makePlayer({ id: 'p2', name: 'Opp2', hand: Array(9).fill(c('clubs', 3)) }),
    ]
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 0)).toBe(false)
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
    // turnsWaited=2 → still waits (< 3, high stuck points, opponents have many cards)
    expect(aiShouldGoDownHard(hand, twoSets, req1, [], players, 0, 2)).toBe(false)
    // turnsWaited=3 → forced to go down
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
