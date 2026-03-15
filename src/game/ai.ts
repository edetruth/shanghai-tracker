import type { Card, Meld, RoundRequirement } from './types'
import { isValidRun, canLayOff } from './meld-validator'
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

// Try to find meld groups satisfying the round requirement
export function aiFindBestMelds(hand: Card[], requirement: RoundRequirement): Card[][] | null {
  const jokers = hand.filter(isJoker)
  const naturals = hand.filter(c => !isJoker(c))

  const melds: Card[][] = []
  const usedIds = new Set<string>()
  let jokersUsed = 0

  for (let s = 0; s < requirement.sets; s++) {
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const meld = tryFindSet(remaining, jokers, jokersUsed)
    if (!meld) return null
    meld.forEach(c => usedIds.add(c.id))
    jokersUsed += meld.filter(isJoker).length
    melds.push(meld)
  }

  for (let r = 0; r < requirement.runs; r++) {
    const remaining = naturals.filter(c => !usedIds.has(c.id))
    const meld = tryFindRun(remaining, jokers, jokersUsed)
    if (!meld) return null
    meld.forEach(c => usedIds.add(c.id))
    jokersUsed += meld.filter(isJoker).length
    melds.push(meld)
  }

  return melds
}

// Should AI take the top discard card?
export function aiShouldTakeDiscard(
  hand: Card[],
  discardCard: Card,
  requirement: RoundRequirement,
  hasLaidDown: boolean,
): boolean {
  if (isJoker(discardCard)) return true
  if (hasLaidDown) return false // simplified: skip lay-off decisions here

  // Taking it enables melds we couldn't make before
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  if (withCard !== null && aiFindBestMelds(hand, requirement) === null) return true

  // Pairs with 2+ same-rank cards → makes a set
  const sameRank = hand.filter(c => !isJoker(c) && c.rank === discardCard.rank).length
  if (sameRank >= 2) return true

  // Extends an existing suit sequence
  const sameSuit = hand.filter(c => !isJoker(c) && c.suit === discardCard.suit)
  if (sameSuit.length >= 2) {
    const close = sameSuit.filter(c => Math.abs(c.rank - discardCard.rank) <= 2)
    if (close.length >= 2) return true
  }

  return false
}

// Pick the best card to discard (lowest meld utility, highest point cost)
export function aiChooseDiscard(hand: Card[], _requirement?: RoundRequirement): Card {
  if (hand.length === 0) throw new Error('Empty hand')

  function utility(card: Card): number {
    if (isJoker(card)) return 10000
    const sameRank = hand.filter(c => !isJoker(c) && c.rank === card.rank && c.id !== card.id).length
    const sameSuit = hand.filter(c => !isJoker(c) && c.suit === card.suit && c.id !== card.id)
    const adjacent = sameSuit.filter(c => Math.abs(c.rank - card.rank) <= 3).length
    return sameRank * 50 + adjacent * 30 - cardPoints(card.rank)
  }

  return hand.reduce((worst, card) => utility(card) < utility(worst) ? card : worst)
}

// Should AI buy an out-of-turn discard?
export function aiShouldBuy(hand: Card[], discardCard: Card, requirement: RoundRequirement): boolean {
  if (isJoker(discardCard)) return true
  const withCard = aiFindBestMelds([...hand, discardCard], requirement)
  const without = aiFindBestMelds(hand, requirement)
  return withCard !== null && without === null
}

// Find a card in hand that can be laid off on any of the given melds
export function aiFindLayOff(hand: Card[], tablesMelds: Meld[]): { card: Card; meld: Meld } | null {
  for (const card of hand) {
    for (const meld of tablesMelds) {
      if (canLayOff(card, meld)) return { card, meld }
    }
  }
  return null
}
