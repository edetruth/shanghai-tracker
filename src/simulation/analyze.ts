/**
 * Shanghai Rummy — simulation analysis and reporting.
 *
 * Consumes GameResult[] from simulate.ts and produces:
 * - Console output report
 * - Diagnosis list of flagged issues
 */

import type { GameResult, PlayerRoundStats } from './simulate'

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0%'
  return (num / denom * 100).toFixed(1) + '%'
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface AnalysisReport {
  text: string
  issues: string[]
  stats: Record<string, number>
}

export function analyze(results: GameResult[], config: { numPlayers: number; difficulty: string; numGames: number }): AnalysisReport {
  const lines: string[] = []
  const issues: string[] = []

  const sep = '═'.repeat(55)
  lines.push(sep)
  lines.push(`  SHANGHAI AI SIMULATION — ${config.numGames} Games, ${config.numPlayers} Players, ${config.difficulty}`)
  lines.push(sep)
  lines.push('')

  // ── Per-round aggregates ───────────────────────────────────────────────────
  const roundStats: Array<{
    roundNum: number; req: string;
    turns: number[]; shanghais: number; totalPlayerRounds: number;
    drawsFromDiscard: number; drawsFromPile: number;
    buysOffered: number; buysMade: number;
    meldsCount: number[]; laidDownTurns: number[];
    jokersDealt: number; jokersStuck: number;
    stalemateCt: number;
  }> = Array.from({ length: 7 }, (_, i) => ({
    roundNum: i + 1, req: '',
    turns: [], shanghais: 0, totalPlayerRounds: 0,
    drawsFromDiscard: 0, drawsFromPile: 0,
    buysOffered: 0, buysMade: 0,
    meldsCount: [], laidDownTurns: [],
    jokersDealt: 0, jokersStuck: 0,
    stalemateCt: 0,
  }))

  let totalTurns = 0
  let totalBuys = 0
  let totalDrawsDiscard = 0
  let totalDrawsPile = 0
  let totalBuysOffered = 0
  let totalBuysMade = 0
  let totalJokersDealt = 0
  let totalJokersStuck = 0

  const winCounts: Record<string, number> = {}

  for (const game of results) {
    winCounts[game.winner] = (winCounts[game.winner] ?? 0) + 1
    totalTurns += game.totalTurns
    totalBuys += game.totalBuys

    for (const round of game.rounds) {
      if (round.wentOut === '(skipped)') continue
      const rs = roundStats[round.roundNumber - 1]
      rs.req = round.requirement
      rs.turns.push(round.turnsInRound)
      rs.shanghais += round.shanghaiVictims.length
      rs.totalPlayerRounds += config.numPlayers
      rs.jokersDealt += round.jokersDealt
      rs.jokersStuck += round.jokersStuckInHand
      if (round.stalemate) rs.stalemateCt++

      totalJokersDealt += round.jokersDealt
      totalJokersStuck += round.jokersStuckInHand

      for (const [, stats] of Object.entries(round.playerStats) as [string, PlayerRoundStats][]) {
        rs.drawsFromDiscard += stats.drewFromDiscard
        rs.drawsFromPile += stats.drewFromPile
        rs.buysOffered += stats.buysOffered
        rs.buysMade += stats.buysMade
        if (stats.meldsLaidDown > 0) rs.meldsCount.push(stats.meldsLaidDown)
        if (stats.turnLaidDown > 0) rs.laidDownTurns.push(stats.turnLaidDown)

        totalDrawsDiscard += stats.drewFromDiscard
        totalDrawsPile += stats.drewFromPile
        totalBuysOffered += stats.buysOffered
        totalBuysMade += stats.buysMade
      }
    }
  }

  const totalDraws = totalDrawsDiscard + totalDrawsPile
  const avgTurnsPerRound = avg(results.flatMap(g => g.rounds.filter(r => r.wentOut !== '(skipped)').map(r => r.turnsInRound)))
  const avgTurnsPerGame = totalTurns / results.length
  const shanghaiRate = results.flatMap(g => g.rounds.filter(r => r.wentOut !== '(skipped)')).reduce((s, r) => s + r.shanghaiVictims.length, 0) /
    results.flatMap(g => g.rounds.filter(r => r.wentOut !== '(skipped)')).length / config.numPlayers

  // ── OVERALL ───────────────────────────────────────────────────────────────
  lines.push('OVERALL:')
  const winnerScores = results.map(g => Math.min(...g.finalScores))
  const allScores = results.flatMap(g => g.finalScores)
  lines.push(`  Average winner score:      ${avg(winnerScores).toFixed(1)} pts`)
  lines.push(`  Average player score:      ${avg(allScores).toFixed(1)} pts`)
  lines.push(`  Average turns per round:   ${avgTurnsPerRound.toFixed(1)}`)
  lines.push(`  Average turns per game:    ${avgTurnsPerGame.toFixed(1)}`)

  const allRounds = results.flatMap(g => g.rounds.filter(r => r.wentOut !== '(skipped)'))
  const longestRound = allRounds.reduce((max, r) => r.turnsInRound > max.turns ? { turns: r.turnsInRound, game: r.roundNumber } : max, { turns: 0, game: 0 })
  const shortestRound = allRounds.reduce((min, r) => r.turnsInRound < min.turns ? { turns: r.turnsInRound, game: r.roundNumber } : min, { turns: 999, game: 0 })
  lines.push(`  Longest round:             ${longestRound.turns} turns (Round ${longestRound.game})`)
  lines.push(`  Shortest round:            ${shortestRound.turns} turns (Round ${shortestRound.game})`)
  const totalShanghais = results.flatMap(g => g.rounds).reduce((s, r) => s + r.shanghaiVictims.length, 0)
  lines.push(`  Total Shanghai events:     ${totalShanghais} across ${results.length} games`)
  lines.push('')

  // ── WIN DISTRIBUTION ──────────────────────────────────────────────────────
  lines.push('WIN DISTRIBUTION:')
  const playerNames = results[0]?.players ?? []
  for (const name of playerNames) {
    const wins = winCounts[name] ?? 0
    lines.push(`  ${pad(name + ':', 12)} ${wins} wins (${pct(wins, results.length)})`)
  }
  const expectedWinPct = 100 / config.numPlayers
  const maxDeviation = Math.max(...playerNames.map(n => Math.abs((winCounts[n] ?? 0) / results.length * 100 - expectedWinPct)))
  if (maxDeviation < 10) lines.push(`  → Fairly balanced (expected ~${expectedWinPct.toFixed(0)}% each)`)
  else lines.push(`  ⚠️  Imbalanced! Max deviation from expected: ${maxDeviation.toFixed(1)}%`)
  lines.push('')

  // ── ROUND-BY-ROUND ────────────────────────────────────────────────────────
  lines.push('ROUND-BY-ROUND:')
  for (const rs of roundStats) {
    if (rs.turns.length === 0) continue
    const avgT = avg(rs.turns).toFixed(1)
    const shanghaiPct = rs.totalPlayerRounds > 0 ? (rs.shanghais / rs.totalPlayerRounds * 100).toFixed(0) : '0'
    const staleFlag = rs.stalemateCt > 0 ? ` (${rs.stalemateCt} stalemates)` : ''
    const slowFlag = avg(rs.turns) > 50 ? ' ⚠️' : ''
    lines.push(`  Round ${rs.roundNum} (${pad(rs.req + '):', 20)} avg ${pad(avgT, 5)} turns | ${pad(shanghaiPct + '%', 5)} Shanghai rate${slowFlag}${staleFlag}`)
  }
  lines.push('')

  // ── DRAW DECISIONS ────────────────────────────────────────────────────────
  lines.push('DRAW DECISIONS:')
  const discardPct = totalDraws > 0 ? (totalDrawsDiscard / totalDraws * 100).toFixed(1) : '0'
  const pilePct = totalDraws > 0 ? (totalDrawsPile / totalDraws * 100).toFixed(1) : '0'
  lines.push(`  Drew from discard: ${discardPct}% of the time`)
  lines.push(`  Drew from pile:    ${pilePct}% of the time`)
  if (totalDraws > 0) {
    const discardRate = totalDrawsDiscard / totalDraws
    if (discardRate > 0.50) lines.push(`  ⚠️  DISCARD HOARDING: Should be 30-40% discard takes`)
    else if (discardRate < 0.15) lines.push(`  ⚠️  NEVER TAKES DISCARD: Should be 30-40% discard takes`)
    else lines.push(`  ✓ In target range (30-40% discard takes)`)
  }
  lines.push('')

  // ── BUYING ────────────────────────────────────────────────────────────────
  lines.push('BUYING:')
  const activeRounds = results.flatMap(g => g.rounds.filter(r => r.wentOut !== '(skipped)')).length
  const avgBuysPerRoundPerPlayer = activeRounds > 0 ? totalBuysMade / (activeRounds * config.numPlayers) : 0
  lines.push(`  Total buys across all games:           ${totalBuysMade}`)
  lines.push(`  Total buy offers:                      ${totalBuysOffered}`)
  lines.push(`  Average buys per round per player:     ${avgBuysPerRoundPerPlayer.toFixed(2)}`)
  const buyAcceptRate = totalBuysOffered > 0 ? totalBuysMade / totalBuysOffered * 100 : 0
  lines.push(`  Buy accept rate (offered → taken):     ${buyAcceptRate.toFixed(1)}%`)
  if (avgBuysPerRoundPerPlayer < 0.3) lines.push(`  ⚠️  LOW BUY RATE: Expected ~0.5-2.0 per round`)
  else if (avgBuysPerRoundPerPlayer > 3.0) lines.push(`  ⚠️  HIGH BUY RATE: AI may be buying too aggressively`)
  else lines.push(`  ✓ Buy rate in reasonable range`)
  lines.push('')

  // ── MELD TIMING ───────────────────────────────────────────────────────────
  lines.push('MELD TIMING (avg turn to first lay-down):')
  for (const rs of roundStats) {
    if (rs.laidDownTurns.length === 0) continue
    lines.push(`  Round ${rs.roundNum} (${rs.req}): turn ${avg(rs.laidDownTurns).toFixed(1)}`)
  }
  lines.push('')

  // ── JOKER ANALYSIS ────────────────────────────────────────────────────────
  lines.push('JOKER ANALYSIS:')
  const jokerStuckPct = totalJokersDealt > 0 ? totalJokersStuck / totalJokersDealt * 100 : 0
  lines.push(`  Total jokers dealt:           ${totalJokersDealt}`)
  lines.push(`  Jokers stuck in hand at end:  ${totalJokersStuck} (${jokerStuckPct.toFixed(1)}%)`)
  if (jokerStuckPct > 10) lines.push(`  ⚠️  HIGH JOKER WASTE: AI is failing to use jokers`)
  else if (jokerStuckPct > 5) lines.push(`  ⚠️  MODERATE JOKER WASTE: Could be better`)
  else lines.push(`  ✓ Joker usage looks healthy`)
  lines.push('')

  // ── PERSONALITY BREAKDOWN ──────────────────────────────────────────────────
  const hasPersonalities = results.length > 0 && results[0].playerPersonalities && results[0].playerPersonalities.length > 0
  if (hasPersonalities) {
    // Build a map from player name → personality ID
    const nameToPersonality: Record<string, string> = {}
    for (const game of results) {
      game.players.forEach((name, i) => {
        if (game.playerPersonalities?.[i]) {
          nameToPersonality[name] = game.playerPersonalities[i]
        }
      })
    }

    // Collect unique personalities
    const personalityIds = [...new Set(Object.values(nameToPersonality))]

    // Aggregate stats per personality
    interface PersonalityAgg {
      wins: number
      totalScores: number[]
      roundScores: number[]
      shanghaiCount: number
      totalPlayerRounds: number
      wentOutCount: number
      laidDownTurns: number[]
      games: number
    }

    const perso: Record<string, PersonalityAgg> = {}
    for (const pid of personalityIds) {
      perso[pid] = {
        wins: 0, totalScores: [], roundScores: [], shanghaiCount: 0,
        totalPlayerRounds: 0, wentOutCount: 0, laidDownTurns: [], games: 0,
      }
    }

    for (const game of results) {
      // Count wins
      const winnerPersonality = nameToPersonality[game.winner]
      if (winnerPersonality && perso[winnerPersonality]) {
        perso[winnerPersonality].wins++
      }

      // Count total scores per personality
      game.players.forEach((name, i) => {
        const pid = nameToPersonality[name]
        if (pid && perso[pid]) {
          perso[pid].totalScores.push(game.finalScores[i])
          perso[pid].games++
        }
      })

      // Per-round stats
      for (const round of game.rounds) {
        if (round.wentOut === '(skipped)') continue
        for (const [name, stats] of Object.entries(round.playerStats) as [string, PlayerRoundStats][]) {
          const pid = nameToPersonality[name]
          if (!pid || !perso[pid]) continue
          perso[pid].totalPlayerRounds++
          perso[pid].roundScores.push(round.scores[name] ?? 0)
          if (stats.wasShanghaied) perso[pid].shanghaiCount++
          if (round.scores[name] === 0 && round.wentOut === name) perso[pid].wentOutCount++
          if (stats.turnLaidDown > 0) perso[pid].laidDownTurns.push(stats.turnLaidDown)
        }
      }
    }

    lines.push('PERSONALITY BREAKDOWN:')
    // Sort by win count descending
    const sortedPersonalities = personalityIds.slice().sort((a, b) => perso[b].wins - perso[a].wins)
    // Find the longest personality name for alignment
    const maxNameLen = Math.max(...sortedPersonalities.map(pid => pid.length))

    for (const pid of sortedPersonalities) {
      const s = perso[pid]
      const totalGames = results.length
      const winPctStr = pct(s.wins, totalGames)
      const avgScore = avg(s.totalScores).toFixed(1)
      const shanghaiPctStr = pct(s.shanghaiCount, s.totalPlayerRounds)
      const wentOutPctStr = pct(s.wentOutCount, s.totalPlayerRounds)
      const avgLayDown = s.laidDownTurns.length > 0 ? avg(s.laidDownTurns).toFixed(1) : 'N/A'
      const avgRound = avg(s.roundScores).toFixed(1)
      lines.push(`  ${pad(pid + ':', maxNameLen + 1)} ${pad(String(s.wins), 3)} wins (${pad(winPctStr, 6)}) | avg score ${pad(avgScore, 6)} | avg round ${pad(avgRound, 5)} | lay-down turn ${pad(avgLayDown, 4)} | shanghai ${pad(shanghaiPctStr, 6)} | went out ${wentOutPctStr}`)
    }
    lines.push('')

    // ── PER-ROUND PERSONALITY BREAKDOWN ─────────────────────────────────────
    lines.push('PER-ROUND PERSONALITY BREAKDOWN:')

    for (const rs of roundStats) {
      if (rs.turns.length === 0) continue

      // Collect per-personality round-level stats
      const roundPerso: Record<string, { wentOutCount: number; shanghaiCount: number; scores: number[]; laidDownTurns: number[]; totalAppearances: number }> = {}
      for (const pid of personalityIds) {
        roundPerso[pid] = { wentOutCount: 0, shanghaiCount: 0, scores: [], laidDownTurns: [], totalAppearances: 0 }
      }

      for (const game of results) {
        const round = game.rounds.find(r => r.roundNumber === rs.roundNum)
        if (!round || round.wentOut === '(skipped)') continue
        for (const [name, stats] of Object.entries(round.playerStats) as [string, PlayerRoundStats][]) {
          const pid = nameToPersonality[name]
          if (!pid || !roundPerso[pid]) continue
          roundPerso[pid].totalAppearances++
          roundPerso[pid].scores.push(round.scores[name] ?? 0)
          if (stats.wasShanghaied) roundPerso[pid].shanghaiCount++
          if (round.scores[name] === 0 && round.wentOut === name) roundPerso[pid].wentOutCount++
          if (stats.turnLaidDown > 0) roundPerso[pid].laidDownTurns.push(stats.turnLaidDown)
        }
      }

      lines.push(`  Round ${rs.roundNum} (${rs.req}):`)
      for (const pid of sortedPersonalities) {
        const rp = roundPerso[pid]
        if (rp.totalAppearances === 0) continue
        const avgScoreStr = avg(rp.scores).toFixed(1)
        const wentOutStr = pct(rp.wentOutCount, rp.totalAppearances)
        const shanghaiStr = pct(rp.shanghaiCount, rp.totalAppearances)
        const layDownStr = rp.laidDownTurns.length > 0 ? avg(rp.laidDownTurns).toFixed(1) : 'N/A'
        lines.push(`    ${pad(pid + ':', maxNameLen + 1)} avg ${pad(avgScoreStr, 6)} | went out ${pad(wentOutStr, 6)} | shanghai ${pad(shanghaiStr, 6)} | lay-down turn ${layDownStr}`)
      }
    }
    lines.push('')
  }

  // ── PROBLEM DETECTION ─────────────────────────────────────────────────────
  const longRounds = allRounds.filter(r => r.turnsInRound > 30)
  const neverLaidDown = results.flatMap(g => g.rounds.flatMap(r =>
    Object.values(r.playerStats).filter(s => s.turnLaidDown === 0 && !r.stalemate)
  )).length
  const zeroBuyGames = results.filter(g => g.totalBuys === 0).length

  lines.push('PROBLEM DETECTION:')
  if (longRounds.length > 0) {
    lines.push(`  ⚠️  Rounds exceeding 30 turns: ${longRounds.length}`)
  } else {
    lines.push(`  ✓ No rounds exceeded 30 turns`)
  }
  if (neverLaidDown > 0) {
    lines.push(`  ⚠️  Players never laying down in a round: ${neverLaidDown} occurrences`)
  } else {
    lines.push(`  ✓ All players laid down in their rounds`)
  }
  if (zeroBuyGames > 0) {
    lines.push(`  ⚠️  Games with zero total buys: ${zeroBuyGames} of ${results.length}`)
  } else {
    lines.push(`  ✓ At least one buy occurred in every game`)
  }
  lines.push('')

  // ── AUTO-DIAGNOSIS ────────────────────────────────────────────────────────
  lines.push(sep)
  lines.push('  AUTO-DIAGNOSIS')
  lines.push(sep)
  lines.push('')

  if (avgTurnsPerRound > 50) {
    issues.push(`SLOW GAMES: Avg turns/round = ${avgTurnsPerRound.toFixed(1)}. Target < 50. AI is not building melds efficiently.`)
  }
  if (shanghaiRate > 0.4) {
    issues.push(`HIGH SHANGHAI RATE: ${(shanghaiRate * 100).toFixed(1)}% of player-rounds result in Shanghai. Target < 35%. AI is not laying down fast enough.`)
  }
  if (avgBuysPerRoundPerPlayer < 0.3) {
    issues.push(`LOW BUY RATE: ${avgBuysPerRoundPerPlayer.toFixed(2)} buys per round per player. Expected ~0.5-2.0. Check AI draw decisions — AI may be taking all discards and never opening buy windows.`)
  }
  const discardRate = totalDraws > 0 ? totalDrawsDiscard / totalDraws : 0
  if (discardRate > 0.50) {
    issues.push(`DISCARD HOARDING: AI takes from discard ${(discardRate * 100).toFixed(1)}% of the time. Expected 30-40%. AI is grabbing cards that may not advance melds.`)
  }
  if (discardRate < 0.15 && totalDraws > 0) {
    issues.push(`NEVER TAKES DISCARD: AI takes discard only ${(discardRate * 100).toFixed(1)}% of the time. Expected 30-40%.`)
  }
  if (jokerStuckPct > 10) {
    issues.push(`JOKER WASTE: ${jokerStuckPct.toFixed(1)}% of jokers end up stuck in hand at round end. AI should lay off jokers after laying down.`)
  }
  for (const rs of roundStats) {
    if (rs.turns.length === 0) continue
    if (avg(rs.turns) > 50) {
      issues.push(`ROUND ${rs.roundNum} TOO SLOW: avg ${avg(rs.turns).toFixed(1)} turns (${rs.req}). Target < 50.`)
    }
  }

  if (issues.length === 0) {
    lines.push('  ✓ No major issues detected. All metrics within target ranges.')
  } else {
    issues.forEach((issue, i) => lines.push(`  ${i + 1}. ${issue}`))
  }
  lines.push('')

  // ── TARGET SUMMARY ───────────────────────────────────────────────────────
  const targets = [
    { name: 'Avg turns/round < 50',       pass: avgTurnsPerRound < 50,     actual: avgTurnsPerRound.toFixed(1) },
    { name: 'Shanghai rate < 35%',         pass: shanghaiRate < 0.35,       actual: (shanghaiRate * 100).toFixed(1) + '%' },
    { name: 'Buy rate > 0.5/round/player', pass: avgBuysPerRoundPerPlayer > 0.5, actual: avgBuysPerRoundPerPlayer.toFixed(2) },
    { name: 'Discard take 25-45%',         pass: discardRate >= 0.25 && discardRate <= 0.45, actual: (discardRate * 100).toFixed(1) + '%' },
    { name: 'Joker stuck rate < 5%',       pass: jokerStuckPct < 5,         actual: jokerStuckPct.toFixed(1) + '%' },
  ]
  lines.push('TARGET SCORECARD:')
  targets.forEach(t => {
    const icon = t.pass ? '  ✓' : '  ✗'
    lines.push(`${icon} ${pad(t.name, 30)} (${t.actual})`)
  })
  const passCount = targets.filter(t => t.pass).length
  lines.push('')
  lines.push(`  ${passCount}/${targets.length} targets met`)
  lines.push('')
  lines.push(sep)

  return {
    text: lines.join('\n'),
    issues,
    stats: {
      avgTurnsPerRound,
      shanghaiRate,
      avgBuysPerRoundPerPlayer,
      discardRate,
      jokerStuckPct,
    },
  }
}
