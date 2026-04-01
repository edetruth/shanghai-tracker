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
    message: 'This is a card game played over 7 rounds. Each round, you need to collect specific card combinations called "melds." The player with the lowest total score wins!',
    autoAdvanceMs: 5000,
  },
  {
    id: 'round-goal',
    trigger: 'immediate',
    title: 'Round 1: 2 Sets of 3',
    message: 'This round you need 2 Sets \u2014 groups of 3 or more cards with the same number. For example: three 7s, or three Kings.',
    autoAdvanceMs: 5000,
  },
  {
    id: 'draw-lesson',
    trigger: 'draw-phase',
    title: 'Your Turn \u2014 Draw a Card',
    message: 'Every turn starts with drawing. Tap the draw pile for a random card, or tap the discard pile to take a card you can see.',
    highlightZone: 'draw-pile',
    requireAction: true,
  },
  {
    id: 'after-first-draw',
    trigger: 'after-draw',
    title: 'Now Discard',
    message: 'Select a card from your hand that doesn\'t help your sets, then tap "Discard." Tip: keep cards that match in rank (same number).',
    highlightZone: 'hand',
    requireAction: true,
  },
  {
    id: 'take-discard-hint',
    trigger: 'draw-phase',
    title: 'Check the Discard!',
    message: 'See that card on the discard pile? If it matches something in your hand, take it! It\'s better than a random draw.',
    highlightZone: 'discard-pile',
    requireAction: true,
  },
  {
    id: 'keep-collecting',
    trigger: 'draw-phase',
    title: 'Keep Building Your Hand',
    message: 'Draw and discard each turn. Try to collect matching ranks for your sets. Jokers are wild \u2014 they count as any card!',
    requireAction: true,
  },
  {
    id: 'ready-to-meld',
    trigger: 'has-melds',
    title: 'You Can Lay Down!',
    message: 'You have enough matching cards to meet the round requirement! Tap "Lay Down" to place your melds on the table.',
    highlightZone: 'lay-down-button',
    requireAction: true,
  },
  {
    id: 'after-meld',
    trigger: 'after-meld',
    title: 'Great! Now Clear Your Hand',
    message: 'You\'ve laid down your melds. Now try to get rid of your remaining cards by laying them off on table melds, or just discard.',
    highlightZone: 'table-melds',
    requireAction: true,
  },
  {
    id: 'round-over',
    trigger: 'round-end',
    title: 'Round Complete!',
    message: 'Players who didn\'t lay down get "Shanghaied" \u2014 all their cards count as penalty points! Going out (0 cards) is the best score.',
    autoAdvanceMs: 5000,
  },
  {
    id: 'round-2-intro',
    trigger: 'round-start',
    title: 'Round 2: New Requirement',
    message: 'Each round has a different requirement. This time you need 1 Set + 1 Run. A Run is 4+ cards of the same suit in sequence (like 5-6-7-8 of hearts).',
    autoAdvanceMs: 5000,
  },
  {
    id: 'buy-lesson',
    trigger: 'buy-opportunity',
    title: 'Buying Cards',
    message: 'When another player discards, you can "Buy" that card \u2014 but you also get a penalty card from the draw pile. Use buys wisely!',
    highlightZone: 'buy-button',
    requireAction: true,
  },
  {
    id: 'game-end',
    trigger: 'game-end',
    title: 'Tutorial Complete!',
    message: 'You\'ve learned the basics of Shanghai! Lowest total score after 7 rounds wins. Try a real game against AI to practice.',
    autoAdvanceMs: 6000,
  },
]

/** Known seed that produces a reasonable tutorial hand for Round 1 (2 sets) */
export const TUTORIAL_SEED = 42424242
