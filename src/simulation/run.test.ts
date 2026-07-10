/**
 * Shanghai Rummy — simulation runner (executed via: npm run test src/simulation/run.test.ts)
 *
 * Runs all configured simulation tests, prints analysis, and saves results to
 * src/simulation/results/
 *
 * NOTE: This test always "passes" — it's a data-collection harness, not a correctness test.
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runSimulation, type SimConfig } from './simulate'
import type { AIPersonality } from '../game/types'
import { analyze } from './analyze'
import { ensureOracleModel } from '../game/oracle-loader'

const RESULTS_DIR = join(process.cwd(), 'src', 'simulation', 'results')
mkdirSync(RESULTS_DIR, { recursive: true })

function saveResults(filename: string, data: unknown) {
  const path = join(RESULTS_DIR, filename)
  writeFileSync(path, JSON.stringify(data, null, 2))
  console.log(`  → Saved: ${path}`)
}

function saveText(filename: string, text: string) {
  const path = join(RESULTS_DIR, filename)
  writeFileSync(path, text)
  console.log(`  → Saved: ${path}`)
}

function runAndAnalyze(label: string, config: SimConfig, outBase: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Running: ${label}`)
  const personalityInfo = config.personalities
    ? `personalities=[${config.personalities.join(', ')}]`
    : `difficulty=${config.difficulty}`
  console.log(`  ${config.numGames} games × ${config.numPlayers} players × ${personalityInfo}`)
  const t0 = Date.now()
  const results = runSimulation(config)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
  console.log(`  Completed in ${elapsed}s`)

  const report = analyze(results, {
    numPlayers: config.numPlayers,
    difficulty: config.difficulty,
    numGames: config.numGames,
  })

  console.log('\n' + report.text)

  saveResults(`${outBase}.json`, results)
  saveText(`${outBase}-report.txt`, report.text)

  return { results, report }
}

describe('Shanghai AI Simulations', () => {

  it('Test 1: Baseline — 4 players, medium, 50 games', { timeout: 120_000 }, () => {
    runAndAnalyze('Baseline', {
      numGames: 50,
      numPlayers: 4,
      difficulty: 'medium',
      logLevel: 'summary',
    }, 'baseline')
  })

  it('Test 2: Large group — 8 players, medium, 30 games', { timeout: 120_000 }, () => {
    runAndAnalyze('Large Group', {
      numGames: 30,
      numPlayers: 8,
      difficulty: 'medium',
      logLevel: 'summary',
    }, 'large-group')
  })

  it('Test 3: Easy difficulty — 4 players, 30 games', { timeout: 120_000 }, () => {
    runAndAnalyze('Easy Difficulty', {
      numGames: 30,
      numPlayers: 4,
      difficulty: 'easy',
      logLevel: 'summary',
    }, 'easy')
  })

  it('Test 4: Hard difficulty — 4 players, 30 games', { timeout: 120_000 }, () => {
    runAndAnalyze('Hard Difficulty', {
      numGames: 30,
      numPlayers: 4,
      difficulty: 'hard',
      logLevel: 'summary',
    }, 'hard')
  })

  it('Test 5: Run rounds specifically — rounds 3 and 7, 4 players, 50 games', { timeout: 120_000 }, () => {
    runAndAnalyze('Run Rounds Focus (3 & 7)', {
      numGames: 50,
      numPlayers: 4,
      difficulty: 'medium',
      logLevel: 'summary',
      onlyRounds: [3, 7],
    }, 'run-rounds')
  })

  it('Test 5b: Round 7 hard — 3 runs, 4 players, 30 games', { timeout: 120_000 }, () => {
    runAndAnalyze('Round 7 Hard Focus', {
      numGames: 30,
      numPlayers: 4,
      difficulty: 'hard',
      logLevel: 'summary',
      onlyRounds: [7],
    }, 'round7-hard')
  })

  it('Test 6: Mixed personalities — 4 hard players, 30 games', { timeout: 120_000 }, () => {
    const personalities: AIPersonality[] = ['the-shark', 'the-mastermind', 'patient-pat', 'lucky-lou']
    runAndAnalyze('Mixed Personalities (Hard)', {
      numGames: 30,
      numPlayers: 4,
      difficulty: 'hard',
      logLevel: 'summary',
      personalities,
    }, 'mixed-personalities')
  })

  it('Test 7: Nemesis showdown — 4 nemesis players, 30 games', { timeout: 120_000 }, () => {
    const personalities: AIPersonality[] = ['the-nemesis', 'the-nemesis', 'the-nemesis', 'the-nemesis']
    runAndAnalyze('Nemesis Showdown', {
      numGames: 30,
      numPlayers: 4,
      difficulty: 'hard',
      logLevel: 'summary',
      personalities,
    }, 'nemesis-showdown')
  })

  it('Test 8: Nemesis vs Best — nemesis vs shark vs mastermind vs patient-pat', { timeout: 120_000 }, () => {
    const personalities: AIPersonality[] = ['the-nemesis', 'the-shark', 'the-mastermind', 'patient-pat']
    runAndAnalyze('Nemesis vs Best', {
      numGames: 30,
      numPlayers: 4,
      difficulty: 'hard',
      logLevel: 'summary',
      personalities,
    }, 'nemesis-vs-best')
  })

  // Unlike the tests above, this one ASSERTS: the TS port of The Oracle must
  // reproduce the Python bridge evaluation (149 avg / 41.6% win vs 3 Masterminds
  // over 500 games). Bars are set loose enough for n=50 sampling noise; a
  // failure means the port diverged from the evaluated agent.
  it('Test 9: Oracle cross-check — oracle vs 3 masterminds, 50 games', { timeout: 600_000 }, async () => {
    await ensureOracleModel()
    const personalities: AIPersonality[] = ['the-oracle', 'the-mastermind', 'the-mastermind', 'the-mastermind']
    const { results } = runAndAnalyze('Oracle vs Masterminds', {
      numGames: 50,
      numPlayers: 4,
      difficulty: 'hard',
      logLevel: 'summary',
      personalities,
    }, 'oracle-vs-masterminds')

    const oracleName = results[0].players[0]
    const wins = results.filter(g => g.winner === oracleName).length
    const avg = results.reduce((s, g) => s + g.finalScores[0], 0) / results.length
    const oppAvg = results.reduce((s, g) => s + (g.finalScores[1] + g.finalScores[2] + g.finalScores[3]) / 3, 0) / results.length
    console.log(`\nOracle cross-check: avg=${avg.toFixed(1)} oppAvg=${oppAvg.toFixed(1)} wins=${wins}/${results.length} (${(wins / results.length * 100).toFixed(0)}%)`)

    // Bridge reference: 149.4 avg / 41.6% win. n=50 bars: win ≥ 25%, avg ≤ 200,
    // and clearly better than the table average.
    expect(wins / results.length).toBeGreaterThanOrEqual(0.25)
    expect(avg).toBeLessThanOrEqual(200)
    expect(avg).toBeLessThan(oppAvg)
  })

})
