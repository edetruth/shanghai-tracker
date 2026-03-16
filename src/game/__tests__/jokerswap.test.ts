import { describe, it, expect } from 'vitest'
import { findSwappableJoker } from '../meld-validator'
import { c, joker, makeMeld } from './helpers'

describe('findSwappableJoker', () => {
  it('returns null for a set meld (swaps not allowed on sets)', () => {
    const jkr = joker('jkr-1')
    const meld = makeMeld([c('hearts', 7), c('diamonds', 7), jkr], 'set')
    expect(findSwappableJoker(c('clubs', 7), meld)).toBeNull()
  })

  it('returns null for a set meld even when the joker represents the right rank', () => {
    const jkr = joker('jkr-2')
    const meld = makeMeld([c('hearts', 5), c('diamonds', 5), jkr], 'set')
    // Joker in set represents rank 5, suit hearts (or whichever natural is first)
    // Swap should still be null — sets are off-limits
    expect(findSwappableJoker(c('clubs', 5), meld)).toBeNull()
  })

  it('returns the joker when natural matches what it represents in a run', () => {
    const jkr = joker('jkr-3')
    // Build run: 5♥-joker-7♥-8♥ where joker represents 6♥
    const meld = makeMeld([c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)], 'run')
    // Joker should represent rank 6, suit hearts
    const result = findSwappableJoker(c('hearts', 6), meld)
    expect(result).not.toBeNull()
    expect(result?.id).toBe(jkr.id)
  })

  it('returns null when natural suit does not match joker representation', () => {
    const jkr = joker('jkr-4')
    const meld = makeMeld([c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)], 'run')
    expect(findSwappableJoker(c('spades', 6), meld)).toBeNull()
  })

  it('returns null when natural rank does not match joker representation', () => {
    const jkr = joker('jkr-5')
    const meld = makeMeld([c('hearts', 5), jkr, c('hearts', 7), c('hearts', 8)], 'run')
    expect(findSwappableJoker(c('hearts', 5), meld)).toBeNull()
  })

  it('returns null for a run with no jokers', () => {
    const meld = makeMeld([c('hearts', 5), c('hearts', 6), c('hearts', 7), c('hearts', 8)], 'run')
    expect(findSwappableJoker(c('hearts', 5), meld)).toBeNull()
  })

  it('finds joker in run with multiple jokers', () => {
    const jkr1 = joker('jkr-6')
    const jkr2 = joker('jkr-7')
    // 5♥ joker joker 8♥ — jokers represent 6 and 7
    const meld = makeMeld([c('hearts', 5), jkr1, jkr2, c('hearts', 8)], 'run')
    // One of the jokers represents 6♥, the other 7♥
    const result6 = findSwappableJoker(c('hearts', 6), meld)
    const result7 = findSwappableJoker(c('hearts', 7), meld)
    expect(result6).not.toBeNull()
    expect(result7).not.toBeNull()
    // They should be different jokers
    expect(result6?.id).not.toBe(result7?.id)
  })

  it('handles ace-high run: ace natural swaps joker representing rank 14', () => {
    const jkr = joker('jkr-8')
    // J-Q-K-joker where joker represents ace-high (14)
    const meld = makeMeld(
      [c('spades', 11), c('spades', 12), c('spades', 13), jkr],
      'run'
    )
    // Joker extends at high end → represents rank 14 (ace-high), suit spades
    // Ace of spades should be swappable
    const result = findSwappableJoker(c('spades', 1), meld)
    expect(result).not.toBeNull()
  })
})
