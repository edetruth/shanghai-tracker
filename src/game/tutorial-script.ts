export interface TutorialStep {
  id: string
  trigger: 'immediate' | 'draw-phase' | 'after-draw' | 'action-phase' | 'has-melds' | 'after-meld' | 'after-discard' | 'round-end' | 'round-start' | 'buy-opportunity' | 'game-end'
  title: string
  message: string
  highlightZone?: 'draw-pile' | 'discard-pile' | 'hand' | 'lay-down-button' | 'discard-button' | 'table-melds' | 'buy-button' | null
  requireAction?: boolean  // true = wait for player to do something before advancing
  autoAdvanceMs?: number   // auto-advance after N ms (for non-interactive steps)
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    trigger: 'immediate',
    title: 'Welcome to Shanghai!',
    message: '7 rounds. Collect card combos. Lowest score wins.',
    autoAdvanceMs: 3000,
  },
  {
    id: 'round-goal',
    trigger: 'immediate',
    title: 'Round 1: 2 Sets of 3',
    message: 'Collect 2 groups of 3 matching cards (e.g. three 7s).',
    autoAdvanceMs: 4000,
  },
  {
    id: 'draw-lesson',
    trigger: 'draw-phase',
    title: 'Draw a Card',
    message: 'Tap the draw pile or the discard pile.',
    highlightZone: 'draw-pile',
    requireAction: true,
  },
  {
    id: 'after-first-draw',
    trigger: 'after-draw',
    title: 'Discard a Card',
    message: 'Tap a card you don\'t need, then tap Discard.',
    highlightZone: 'hand',
    requireAction: true,
  },
  {
    id: 'take-discard-hint',
    trigger: 'draw-phase',
    title: 'Check the Discard',
    message: 'If it matches your hand, take it!',
    highlightZone: 'discard-pile',
    requireAction: true,
  },
  {
    id: 'keep-collecting',
    trigger: 'draw-phase',
    title: 'Keep Going',
    message: 'Draw, discard, repeat. Jokers are wild!',
    requireAction: true,
  },
  {
    id: 'ready-to-meld',
    trigger: 'has-melds',
    title: 'Lay Down!',
    message: 'You have your melds. Tap "Lay Down" now.',
    highlightZone: 'lay-down-button',
    requireAction: true,
  },
  {
    id: 'after-meld',
    trigger: 'after-meld',
    title: 'Clear Your Hand',
    message: 'Lay off cards on table melds, or just discard.',
    highlightZone: 'table-melds',
    requireAction: true,
  },
  {
    id: 'round-over',
    trigger: 'round-end',
    title: 'Round Complete!',
    message: 'Leftover cards = penalty points. 0 cards = best score!',
    autoAdvanceMs: 4000,
  },
  {
    id: 'round-2-intro',
    trigger: 'round-start',
    title: 'Round 2: 1 Set + 1 Run',
    message: 'A Run is 4+ cards in sequence, same suit (e.g. 5-6-7-8\u2663).',
    autoAdvanceMs: 4000,
  },
  {
    id: 'buy-lesson',
    trigger: 'buy-opportunity',
    title: 'Buy a Card?',
    message: 'Take the discard + a penalty card, or pass.',
    highlightZone: 'buy-button',
    requireAction: true,
  },
  {
    id: 'game-end',
    trigger: 'game-end',
    title: 'Tutorial Complete!',
    message: 'You\'ve got the basics. Try a real game!',
    autoAdvanceMs: 5000,
  },
]

/** Known seed that produces a reasonable tutorial hand for Round 1 (2 sets) */
export const TUTORIAL_SEED = 42424242
