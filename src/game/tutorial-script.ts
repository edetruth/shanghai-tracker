export interface TutorialStep {
  id: string
  title: string
  message: string
  highlightZone?: 'draw-pile' | 'discard-pile' | 'hand' | 'lay-down-button' | 'discard-button' | 'table-melds' | 'buy-button' | null
  requireAction?: boolean  // true = wait for player to do something before advancing
  autoAdvanceMs?: number   // auto-advance after N ms (for non-interactive steps)
}

// ── Static steps shown at the start and at milestone events ──────────────

export const WELCOME: TutorialStep = {
  id: 'welcome',
  title: 'Welcome to Shanghai!',
  message: '7 rounds. Collect card combos. Lowest score wins.',
  autoAdvanceMs: 3000,
}

export const ROUND_GOAL: TutorialStep = {
  id: 'round-goal',
  title: 'Round 1: 2 Sets of 3',
  message: 'Collect 2 groups of 3 matching cards (e.g. three 7s).',
  autoAdvanceMs: 4000,
}

export const ROUND_COMPLETE: TutorialStep = {
  id: 'round-over',
  title: 'Round Complete!',
  message: 'Leftover cards = penalty points. 0 cards = best score!',
  autoAdvanceMs: 4000,
}

export const ROUND_2_INTRO: TutorialStep = {
  id: 'round-2-intro',
  title: 'Round 2: 1 Set + 1 Run',
  message: 'A Run is 4+ cards in sequence, same suit (e.g. 5-6-7-8\u2663).',
  autoAdvanceMs: 4000,
}

export const TUTORIAL_COMPLETE: TutorialStep = {
  id: 'game-end',
  title: 'Tutorial Complete!',
  message: 'Draw, meld, discard — you\'ve got it. Try a real game!',
  autoAdvanceMs: 5000,
}

// ── Context-aware action hints ───────────────────────────────────────────

export const HINT_DRAW: TutorialStep = {
  id: 'hint-draw',
  title: 'Draw a Card',
  message: 'Tap the draw pile or the discard pile.',
  highlightZone: 'draw-pile',
  requireAction: true,
}

export const HINT_DRAW_TAKE_DISCARD: TutorialStep = {
  id: 'hint-draw-take',
  title: 'Draw a Card',
  message: 'The discard might help — check before drawing blind!',
  highlightZone: 'discard-pile',
  requireAction: true,
}

export const HINT_DISCARD: TutorialStep = {
  id: 'hint-discard',
  title: 'Discard a Card',
  message: 'Tap a card you don\'t need, then tap Discard.',
  highlightZone: 'hand',
  requireAction: true,
}

export const HINT_LAY_DOWN: TutorialStep = {
  id: 'hint-lay-down',
  title: 'You Can Lay Down!',
  message: 'You have your melds. Tap "Lay Down" now.',
  highlightZone: 'lay-down-button',
  requireAction: true,
}

export const HINT_CLEAR_HAND: TutorialStep = {
  id: 'hint-clear-hand',
  title: 'Clear Your Hand',
  message: 'Lay off cards on table melds, or discard.',
  highlightZone: 'hand',
  requireAction: true,
}

export const HINT_BUY: TutorialStep = {
  id: 'hint-buy',
  title: 'Buy a Card?',
  message: 'Take the discard + a penalty card, or pass.',
  highlightZone: 'buy-button',
  requireAction: true,
}

/** Known seed that produces a reasonable tutorial hand for Round 1 (2 sets) */
export const TUTORIAL_SEED = 42424242
