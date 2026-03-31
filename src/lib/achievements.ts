import type { GameState } from '../game/types'

export interface Achievement {
  id: string
  name: string
  description: string
  category: 'beginner' | 'skill' | 'mastery' | 'social'
  icon: string
}

export interface AchievementContext {
  gameState: GameState
  playerName: string
  playerIndex: number
  roundResults?: { playerId: string; score: number; shanghaied: boolean }[]
  isGameEnd: boolean
  // Cumulative stats (fetched from existing stats tables if available)
  totalGamesPlayed?: number
  totalOnlineGamesHosted?: number
  uniqueOpponents?: number
  totalShanghaisDone?: number
}

export const ACHIEVEMENTS: Achievement[] = [
  // Beginner
  { id: 'first-hand', name: 'First Hand', description: 'Complete your first game', category: 'beginner', icon: '🎴' },
  { id: 'going-down', name: 'Going Down', description: 'Lay down melds for the first time', category: 'beginner', icon: '📥' },
  { id: 'clean-sweep', name: 'Clean Sweep', description: 'Go out in a round (score 0)', category: 'beginner', icon: '✨' },
  { id: 'buyers-market', name: "Buyer's Market", description: 'Buy a card for the first time', category: 'beginner', icon: '🛒' },
  // Skill
  { id: 'hat-trick', name: 'Hat Trick', description: 'Go out 3 rounds in a row', category: 'skill', icon: '🎩' },
  { id: 'zero-buys', name: 'Zero Buys', description: 'Win a game without buying', category: 'skill', icon: '🚫' },
  { id: 'the-heist', name: 'The Heist', description: 'Swap a joker from a table meld', category: 'skill', icon: '🃏' },
  { id: 'comeback-kid', name: 'Comeback Kid', description: 'Win after being last at Round 5', category: 'skill', icon: '🔄' },
  // Mastery
  { id: 'shutout', name: 'Shutout', description: 'Go out in all 7 rounds of one game', category: 'mastery', icon: '💯' },
  { id: 'shark-slayer', name: 'Shark Slayer', description: 'Beat The Shark AI', category: 'mastery', icon: '🦈' },
  { id: 'mastermind-slayer', name: 'Mastermind Slayer', description: 'Beat The Mastermind AI', category: 'mastery', icon: '🧠' },
  { id: 'century-club', name: 'Century Club', description: 'Play 100 games', category: 'mastery', icon: '💎' },
  // Social
  { id: 'party-host', name: 'Party Host', description: 'Host 10 online games', category: 'social', icon: '🎉' },
  { id: 'full-house', name: 'Full House', description: 'Play a game with 8 players', category: 'social', icon: '🏠' },
  { id: 'globetrotter', name: 'Globetrotter', description: 'Play with 20 different players', category: 'social', icon: '🌍' },
  { id: 'shanghai-master', name: 'Shanghai!', description: 'Shanghai an opponent 5 times', category: 'social', icon: '🀄' },
]

const CATEGORY_ICONS: Record<string, string> = {
  beginner: '🌱',
  skill: '⭐',
  mastery: '💎',
  social: '🤝',
}

export function getCategoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? '🏆'
}

/**
 * Check which achievements are newly unlocked given the current context.
 * Returns achievement IDs that should be unlocked (caller checks against already-unlocked list).
 */
export function checkAchievements(ctx: AchievementContext, alreadyUnlocked: Set<string>): string[] {
  const newlyUnlocked: string[] = []
  const gs = ctx.gameState
  const player = gs.players[ctx.playerIndex]
  if (!player) return newlyUnlocked

  function check(id: string, condition: boolean) {
    if (!alreadyUnlocked.has(id) && condition) newlyUnlocked.push(id)
  }

  // ── Beginner ──
  if (ctx.isGameEnd) {
    check('first-hand', true) // Completed a game = always true at game end
  }

  check('going-down', player.hasLaidDown)

  if (ctx.roundResults) {
    const myResult = ctx.roundResults.find(r => r.playerId === player.id)
    check('clean-sweep', myResult?.score === 0 && !myResult?.shanghaied)
  }

  // Buyer's Market is handled inline in handleBuyDecision for immediate feedback

  // ── Skill ──
  // Hat Trick: 3 consecutive zero scores
  if (player.roundScores.length >= 3) {
    const last3 = player.roundScores.slice(-3)
    check('hat-trick', last3.every(s => s === 0))
  }

  // Zero Buys: win without buying (at game end)
  if (ctx.isGameEnd) {
    const myTotal = player.roundScores.reduce((a, b) => a + b, 0)
    const isWinner = gs.players.every(p =>
      p.id === player.id || p.roundScores.reduce((a, b) => a + b, 0) >= myTotal
    )
    // Approximate: check if buysRemaining equals buyLimit (last round only)
    if (isWinner && player.buysRemaining === gs.buyLimit) {
      check('zero-buys', true)
    }
  }

  // The Heist is handled inline in handleJokerSwap for immediate feedback

  // Comeback Kid: win after being last at round 5
  if (ctx.isGameEnd && player.roundScores.length >= 7) {
    const myTotal = player.roundScores.reduce((a, b) => a + b, 0)
    const isWinner = gs.players.every(p =>
      p.id === player.id || p.roundScores.reduce((a, b) => a + b, 0) >= myTotal
    )
    if (isWinner) {
      const round5Totals = gs.players.map(p => ({
        id: p.id,
        total: p.roundScores.slice(0, 5).reduce((a, b) => a + b, 0),
      }))
      const myR5 = round5Totals.find(t => t.id === player.id)?.total ?? 0
      const wasLast = round5Totals.every(t => t.id === player.id || t.total <= myR5)
      check('comeback-kid', wasLast)
    }
  }

  // ── Mastery ──
  // Shutout: all 7 rounds scored 0
  if (ctx.isGameEnd && player.roundScores.length === 7) {
    check('shutout', player.roundScores.every(s => s === 0))
  }

  // Shark/Mastermind Slayer: win a game where that AI was playing
  if (ctx.isGameEnd) {
    const myTotal = player.roundScores.reduce((a, b) => a + b, 0)
    const isWinner = gs.players.every(p =>
      p.id === player.id || p.roundScores.reduce((a, b) => a + b, 0) >= myTotal
    )
    if (isWinner) {
      const hasShark = gs.players.some(p => p.name === 'The Shark' && p.isAI)
      const hasMastermind = gs.players.some(p => p.name === 'The Mastermind' && p.isAI)
      check('shark-slayer', hasShark)
      check('mastermind-slayer', hasMastermind)
    }
  }

  // Century Club, Party Host, Globetrotter, Shanghai!, Full House
  if (ctx.totalGamesPlayed !== undefined) {
    check('century-club', ctx.totalGamesPlayed >= 100)
  }
  if (ctx.totalOnlineGamesHosted !== undefined) {
    check('party-host', ctx.totalOnlineGamesHosted >= 10)
  }
  if (ctx.uniqueOpponents !== undefined) {
    check('globetrotter', ctx.uniqueOpponents >= 20)
  }
  if (ctx.totalShanghaisDone !== undefined) {
    check('shanghai-master', ctx.totalShanghaisDone >= 5)
  }
  check('full-house', gs.players.length >= 8)

  return newlyUnlocked
}
