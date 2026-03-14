import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, Cell, LabelList,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Trophy, TrendingDown, TrendingUp, Zap, Star,
  Calendar, Flame, Award, Shield, ChevronDown, ChevronUp,
} from 'lucide-react'
import { getCompletedGames, computeWinner } from '../lib/gameStore'
import { PLAYER_COLORS } from '../lib/constants'
import type { GameWithScores, Player } from '../lib/types'
import { format } from 'date-fns'

type MinGames = 0 | 2 | 3 | 5
type TrendsView = 'averages' | 'overtime' | 'compare'

export default function StatsLeaderboard() {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'leaderboard' | 'trends' | 'records'>('leaderboard')
  // Leaderboard
  const [minGames, setMinGames] = useState<MinGames>(3)
  const [alsoPlayedOpen, setAlsoPlayedOpen] = useState(false)
  // Trends
  const [trendsView, setTrendsView] = useState<TrendsView>('averages')
  const [visiblePlayerIds, setVisiblePlayerIds] = useState<Set<string>>(new Set())
  const [maxLinesWarning, setMaxLinesWarning] = useState(false)
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)

  useEffect(() => {
    getCompletedGames().then((g) => { setGames(g); setLoading(false) })
  }, [])

  // Player map
  const playerMap = new Map<string, Player>()
  games.forEach((g) => g.game_scores.forEach((gs) => { if (gs.player) playerMap.set(gs.player_id, gs.player) }))
  const players = Array.from(playerMap.values())

  const playerColor = (id: string) => PLAYER_COLORS[players.findIndex((p) => p.id === id) % PLAYER_COLORS.length]

  // Stats
  const stats = players.map((player) => {
    const ps = games.flatMap((g) => g.game_scores.filter((gs) => gs.player_id === player.id))
    const gamesPlayed = ps.length
    const wins = games.filter((g) => computeWinner(g.game_scores)?.player_id === player.id).length
    const avgScore = gamesPlayed ? Math.round(ps.reduce((s, gs) => s + gs.total_score, 0) / gamesPlayed) : 0
    const totals = ps.map((gs) => gs.total_score)
    const bestGame = gamesPlayed ? Math.min(...totals) : 0
    const worstGame = gamesPlayed ? Math.max(...totals) : 0
    const zeroRounds = ps.reduce((sum, gs) => sum + gs.round_scores.filter((s) => s === 0).length, 0)
    return { player, games_played: gamesPlayed, wins, avg_score: avgScore, best_game: bestGame, worst_game: worstGame, zero_rounds: zeroRounds }
  })

  const ranked = [...stats].sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : a.avg_score - b.avg_score)

  // Initialize overtime visible players
  useEffect(() => {
    if (stats.length > 0 && visiblePlayerIds.size === 0) {
      const top5 = new Set([...stats].sort((a, b) => b.games_played - a.games_played).slice(0, 5).map((s) => s.player.id))
      setVisiblePlayerIds(top5)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length])

  // Leaderboard groupings
  const threshold = minGames === 0 ? 0 : minGames
  const qualifying = ranked.filter((s) => s.games_played >= threshold)
  const podium = qualifying.slice(0, 3)
  const tableRows = qualifying.slice(3)
  const alsoPlayed = ranked.filter((s) => s.games_played < threshold)

  // Averages bar chart
  const barData = [...stats]
    .filter((s) => s.games_played >= (threshold || 1))
    .sort((a, b) => a.avg_score - b.avg_score)
    .map((s) => ({ name: s.player.name, avg: s.avg_score, color: playerColor(s.player.id) }))

  // Overtime line chart
  const trendData = [...games].reverse().map((g) => {
    const point: Record<string, string | number> = {
      label: (() => { try { return format(new Date(g.date + 'T12:00:00'), 'M/d') } catch { return g.date } })(),
    }
    g.game_scores.forEach((gs) => { if (gs.player?.name) point[gs.player.name] = gs.total_score })
    return point
  })
  const visiblePlayers = players.filter((p) => visiblePlayerIds.has(p.id))

  const toggleOvertimePlayer = (id: string) => {
    setVisiblePlayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else if (next.size >= 5) {
        setMaxLinesWarning(true)
        setTimeout(() => setMaxLinesWarning(false), 2500)
        return prev
      } else { next.add(id) }
      return next
    })
  }

  // Compare
  const selectCompare = (id: string) => {
    if (compareA === id) { setCompareA(null); return }
    if (compareB === id) { setCompareB(null); return }
    if (!compareA) { setCompareA(id); return }
    if (!compareB) { setCompareB(id); return }
    setCompareA(compareB); setCompareB(id)
  }
  const comparePlayerA = compareA ? players.find((p) => p.id === compareA) : null
  const comparePlayerB = compareB ? players.find((p) => p.id === compareB) : null
  const compareGames = compareA && compareB
    ? [...games]
        .filter((g) => g.game_scores.some((gs) => gs.player_id === compareA) && g.game_scores.some((gs) => gs.player_id === compareB))
        .sort((a, b) => a.date.localeCompare(b.date))
    : []
  const compareChartData = compareGames.map((g) => ({
    label: (() => { try { return format(new Date(g.date + 'T12:00:00'), 'M/d') } catch { return g.date } })(),
    [comparePlayerA?.name ?? 'A']: g.game_scores.find((gs) => gs.player_id === compareA)?.total_score,
    [comparePlayerB?.name ?? 'B']: g.game_scores.find((gs) => gs.player_id === compareB)?.total_score,
  }))
  const h2hWinsA = compareGames.filter((g) => computeWinner(g.game_scores)?.player_id === compareA).length
  const h2hWinsB = compareGames.filter((g) => computeWinner(g.game_scores)?.player_id === compareB).length
  const statsA = stats.find((s) => s.player.id === compareA)
  const statsB = stats.find((s) => s.player.id === compareB)

  // Records helpers
  const getWinStreak = (playerId: string) => {
    const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date))
    let max = 0, cur = 0
    for (const g of sorted) {
      if (!g.game_scores.some((gs) => gs.player_id === playerId)) continue
      if (computeWinner(g.game_scores)?.player_id === playerId) { cur++; max = Math.max(max, cur) } else cur = 0
    }
    return max
  }
  const getImprovement = (playerId: string) => {
    const pg = [...games].sort((a, b) => a.date.localeCompare(b.date)).filter((g) => g.game_scores.some((gs) => gs.player_id === playerId))
    if (pg.length < 6) return null
    const avg = (gs: GameWithScores[]) => {
      const scores = gs.map((g) => g.game_scores.find((s) => s.player_id === playerId)!.total_score)
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    }
    const first3avg = avg(pg.slice(0, 3)), last3avg = avg(pg.slice(-3))
    return { first3avg, last3avg, diff: first3avg - last3avg }
  }

  // Records data
  const mostWins = ranked[0]
  const lowestAvg = stats.filter((s) => s.games_played >= 2).sort((a, b) => a.avg_score - b.avg_score)[0]
  const bestSingle = stats.filter((s) => s.games_played > 0).sort((a, b) => a.best_game - b.best_game)[0]
  const mostZeros = [...stats].sort((a, b) => b.zero_rounds - a.zero_rounds)[0]
  const mostGamesPlayed = [...stats].sort((a, b) => b.games_played - a.games_played)[0]
  const worstSingle = stats.filter((s) => s.games_played > 0).sort((a, b) => b.worst_game - a.worst_game)[0]
  const improvements = stats.map((s) => ({ s, imp: getImprovement(s.player.id) })).filter((x) => x.imp && x.imp.diff > 0)
  const mostImproved = improvements.sort((a, b) => b.imp!.diff - a.imp!.diff)[0]
  const longestStreak = [...stats].map((s) => ({ s, streak: getWinStreak(s.player.id) })).sort((a, b) => b.streak - a.streak)[0]
  const shanghaiSurvivor = stats.filter((s) => s.games_played >= 5 && s.wins === 0).sort((a, b) => b.games_played - a.games_played)[0]

  const podiumColors = ['#e2b858', '#94a3b8', '#b45309']
  const podiumLabels = ['#1', '#2', '#3']
  const podiumPlatformH = ['h-20', 'h-12', 'h-8']
  const podiumOrder = [1, 0, 2] // visual order: 2nd left, 1st center, 3rd right

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <div className="p-4 pt-6">
        <h2 className="font-display text-2xl font-semibold text-white">Stats</h2>
        <div className="flex gap-1 mt-4 bg-[#0f1929] rounded-xl p-1">
          {(['leaderboard', 'trends', 'records'] as const).map((tab) => (
            <button key={tab} onClick={() => setView(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors
                ${view === tab ? 'bg-[#1a2640] text-[#e2b858]' : 'text-[#5e7190]'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pb-24 overflow-auto">
        {loading ? (
          <div className="text-center text-[#5e7190] py-12">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-16"><div className="text-4xl mb-4">📊</div><div className="text-[#5e7190]">No data yet</div></div>

        ) : view === 'leaderboard' ? (
          <div className="flex flex-col gap-4">
            {/* Min games filter */}
            <div className="flex items-center gap-2">
              <span className="text-[#5e7190] text-xs">Min games:</span>
              <div className="flex gap-1">
                {([2, 3, 5, 0] as MinGames[]).map((n) => (
                  <button key={n} onClick={() => setMinGames(n)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                      ${minGames === n ? 'bg-[#1a2640] text-[#e2b858]' : 'text-[#5e7190] hover:text-white'}`}>
                    {n === 0 ? 'All' : n}
                  </button>
                ))}
              </div>
            </div>

            {/* Podium */}
            {podium.length >= 2 && (
              <div className="flex items-end gap-2">
                {podiumOrder.map((rankIdx) => {
                  const s = podium[rankIdx]
                  if (!s) return <div key={rankIdx} className="flex-1" />
                  const color = podiumColors[rankIdx]
                  const isFirst = rankIdx === 0
                  return (
                    <div key={s.player.id} className="flex-1 flex flex-col">
                      <div className="card p-3 text-center mb-0 rounded-b-none"
                        style={{ borderColor: `${color}40`, background: isFirst ? `${color}08` : undefined }}>
                        {isFirst && <div className="text-lg mb-1">👑</div>}
                        <div className="text-white font-medium text-sm leading-tight truncate">{s.player.name}</div>
                        <div className="font-mono font-bold mt-1" style={{ color }}>{s.wins}W</div>
                        <div className="text-[#5e7190] text-xs mt-0.5">avg {s.avg_score}</div>
                        <div className="text-[#5e7190] text-xs">{s.games_played}g</div>
                      </div>
                      <div className={`w-full ${podiumPlatformH[rankIdx]} rounded-b-lg flex items-center justify-center`}
                        style={{ background: `${color}20` }}>
                        <span className="font-display font-bold text-lg" style={{ color }}>{podiumLabels[rankIdx]}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Table: rank 4+ */}
            {tableRows.length > 0 && (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1a2640]">
                      {['#', 'Player', 'G', 'W', 'Avg', 'Best', '0s'].map((h) => (
                        <th key={h} className="px-2 py-2 text-[#5e7190] text-xs font-medium text-center first:text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((s, i) => (
                      <tr key={s.player.id} className={`border-b border-[#1a2640]/50 ${i % 2 === 0 ? '' : 'bg-[#0c1220]/60'}`}>
                        <td className="px-2 py-2 text-[#5e7190] text-xs">{i + 4}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: playerColor(s.player.id) }} />
                            <span className="text-white truncate max-w-[80px]">{s.player.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[#5e7190] text-xs">{s.games_played}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#e2b858] text-xs font-semibold">{s.wins}</td>
                        <td className="px-2 py-2 text-center font-mono text-white text-xs">{s.avg_score}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#4ade80] text-xs">{s.best_game}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#a78bfa] text-xs">{s.zero_rounds}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Also Played */}
            {alsoPlayed.length > 0 && (
              <div className="card overflow-hidden">
                <button onClick={() => setAlsoPlayedOpen((o) => !o)}
                  className="w-full flex items-center justify-between p-3 text-left">
                  <span className="text-[#5e7190] text-sm">
                    Guests & newcomers ({alsoPlayed.length} player{alsoPlayed.length !== 1 ? 's' : ''})
                  </span>
                  {alsoPlayedOpen ? <ChevronUp size={16} className="text-[#5e7190]" /> : <ChevronDown size={16} className="text-[#5e7190]" />}
                </button>
                {alsoPlayedOpen && (
                  <div className="border-t border-[#1a2640]">
                    {alsoPlayed.map((s, i) => (
                      <div key={s.player.id} className={`flex items-center justify-between px-3 py-2 text-sm ${i % 2 !== 0 ? 'bg-[#0c1220]/60' : ''}`}>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: playerColor(s.player.id) }} />
                          <span className="text-white">{s.player.name}</span>
                        </div>
                        <span className="text-[#5e7190] text-xs font-mono">{s.games_played}g · avg {s.avg_score}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        ) : view === 'trends' ? (
          <div className="flex flex-col gap-3">
            {/* Trends sub-tabs */}
            <div className="flex gap-1 bg-[#0f1929] rounded-xl p-1">
              {(['averages', 'overtime', 'compare'] as TrendsView[]).map((t) => (
                <button key={t} onClick={() => setTrendsView(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors
                    ${trendsView === t ? 'bg-[#1a2640] text-[#e2b858]' : 'text-[#5e7190]'}`}>
                  {t === 'overtime' ? 'Over Time' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {trendsView === 'averages' && (
              <div className="card p-4">
                <p className="text-[#5e7190] text-xs uppercase tracking-wider">Average Score</p>
                <p className="text-[#5e7190] text-xs mb-4">Lower is better · min {threshold || 1} games</p>
                {barData.length === 0 ? (
                  <p className="text-[#5e7190] text-sm text-center py-8">No qualifying players</p>
                ) : (
                  <div style={{ height: Math.max(160, barData.length * 44) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={barData} margin={{ top: 0, right: 44, left: 0, bottom: 0 }}>
                        <XAxis type="number" tick={{ fill: '#5e7190', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={72} tick={{ fill: '#e2e8f0', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: '#1a2640' }}
                          contentStyle={{ background: '#131d30', border: '1px solid #1a2640', borderRadius: 8, color: '#e2e8f0' }}
                          formatter={(v) => [`${v} pts`, 'Avg']}
                        />
                        <Bar dataKey="avg" radius={[0, 4, 4, 0]} maxBarSize={28}>
                          <LabelList dataKey="avg" position="right" style={{ fill: '#94a3b8', fontSize: 11 }} />
                          {barData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {trendsView === 'overtime' && (
              <>
                {/* Player toggles */}
                <div className="card p-3">
                  <p className="text-xs text-[#5e7190] uppercase tracking-wider mb-2">Players (max 5)</p>
                  {maxLinesWarning && (
                    <p className="text-amber-400 text-xs mb-2">Tap a player to deselect first</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {stats.sort((a, b) => b.games_played - a.games_played).map((s) => {
                      const color = playerColor(s.player.id)
                      const active = visiblePlayerIds.has(s.player.id)
                      return (
                        <button key={s.player.id} onClick={() => toggleOvertimePlayer(s.player.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                            ${active ? 'border-transparent text-[#0c1220]' : 'border-[#1a2640] text-[#5e7190]'}`}
                          style={active ? { background: color } : {}}>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: active ? '#0c1220' : color }} />
                          {s.player.name}
                          <span className="opacity-60">{s.games_played}g</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="card p-4">
                  <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-4">Score Over Time (lower is better)</p>
                  {trendData.length < 2 ? (
                    <p className="text-[#5e7190] text-sm text-center py-8">Need at least 2 games</p>
                  ) : visiblePlayers.length === 0 ? (
                    <p className="text-[#5e7190] text-sm text-center py-8">Select players above</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <XAxis dataKey="label" tick={{ fill: '#5e7190', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#5e7190', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#131d30', border: '1px solid #1a2640', borderRadius: 8, color: '#e2e8f0' }} />
                        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
                        {visiblePlayers.map((p) => (
                          <Line key={p.id} type="monotone" dataKey={p.name}
                            stroke={playerColor(p.id)} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </>
            )}

            {trendsView === 'compare' && (
              <div className="flex flex-col gap-3">
                {/* Player picker */}
                <div className="card p-3">
                  <p className="text-xs text-[#5e7190] uppercase tracking-wider mb-2">Select 2 players to compare</p>
                  <div className="flex flex-wrap gap-2">
                    {stats.sort((a, b) => b.games_played - a.games_played).map((s) => {
                      const isA = compareA === s.player.id
                      const isB = compareB === s.player.id
                      const color = isA ? '#e2b858' : isB ? '#6ecfef' : undefined
                      return (
                        <button key={s.player.id} onClick={() => selectCompare(s.player.id)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                            ${isA || isB ? 'border-transparent text-[#0c1220]' : 'border-[#1a2640] text-[#5e7190]'}`}
                          style={color ? { background: color } : {}}>
                          {s.player.name}
                          {isA && ' (A)'}{isB && ' (B)'}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {comparePlayerA && comparePlayerB && statsA && statsB ? (
                  <>
                    {/* Head to head stats */}
                    <div className="card p-4">
                      <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-3">
                        Head to Head · {compareGames.length} shared game{compareGames.length !== 1 ? 's' : ''}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <div>
                          <div className="font-medium text-white truncate text-sm">{comparePlayerA.name}</div>
                          <div className="text-[#e2b858] text-xs">(A)</div>
                        </div>
                        <div />
                        <div>
                          <div className="font-medium text-white truncate text-sm">{comparePlayerB.name}</div>
                          <div className="text-[#6ecfef] text-xs">(B)</div>
                        </div>
                      </div>
                      {[
                        { label: 'H2H Wins', a: h2hWinsA, b: h2hWinsB },
                        { label: 'Total Wins', a: statsA.wins, b: statsB.wins },
                        { label: 'Avg Score', a: statsA.avg_score, b: statsB.avg_score, lowerBetter: true },
                        { label: 'Best Game', a: statsA.best_game, b: statsB.best_game, lowerBetter: true },
                      ].map(({ label, a, b, lowerBetter }) => {
                        const aBetter = lowerBetter ? a < b : a > b
                        const bBetter = lowerBetter ? b < a : b > a
                        return (
                          <div key={label} className="grid grid-cols-3 gap-2 text-center py-1.5 border-t border-[#1a2640]/50">
                            <div className={`font-mono text-sm font-semibold ${aBetter ? 'text-[#e2b858]' : 'text-white'}`}>{a}</div>
                            <div className="text-[#5e7190] text-xs self-center">{label}</div>
                            <div className={`font-mono text-sm font-semibold ${bBetter ? 'text-[#6ecfef]' : 'text-white'}`}>{b}</div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Compare chart */}
                    {compareChartData.length >= 2 && (
                      <div className="card p-4">
                        <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-4">Score When Both Played</p>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={compareChartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                            <XAxis dataKey="label" tick={{ fill: '#5e7190', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#5e7190', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: '#131d30', border: '1px solid #1a2640', borderRadius: 8, color: '#e2e8f0' }} />
                            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
                            <Line type="monotone" dataKey={comparePlayerA.name} stroke="#e2b858" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                            <Line type="monotone" dataKey={comparePlayerB.name} stroke="#6ecfef" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center text-[#5e7190] text-sm py-8">
                    {compareA ? 'Select one more player' : 'Select two players above'}
                  </div>
                )}
              </div>
            )}
          </div>

        ) : (
          /* Records */
          <div className="flex flex-col gap-4">
            {/* Champions */}
            <div>
              <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-2">Champions</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: <Trophy size={18} className="text-[#e2b858]" />, label: 'Most Wins', name: mostWins?.player.name, value: `${mostWins?.wins} wins`, accent: '#e2b858' },
                  { icon: <TrendingDown size={18} className="text-[#6ecfef]" />, label: 'Lowest Average', name: lowestAvg?.player.name, value: lowestAvg ? `${lowestAvg.avg_score} avg` : 'Need 2+ games', accent: '#6ecfef' },
                  {
                    icon: <Star size={18} className={bestSingle?.best_game === 0 ? 'text-[#4ade80]' : 'text-[#4ade80]'} />,
                    label: 'Best Single Game',
                    name: bestSingle?.player.name,
                    value: bestSingle ? `${bestSingle.best_game} pts` : '—',
                    accent: '#4ade80',
                    glow: bestSingle?.best_game === 0,
                  },
                  { icon: <Zap size={18} className="text-[#a78bfa]" />, label: 'Most Zeros', name: mostZeros?.player.name, value: `${mostZeros?.zero_rounds ?? 0} rounds`, accent: '#a78bfa' },
                  { icon: <Calendar size={18} className="text-[#34d399]" />, label: 'Most Games Played', name: mostGamesPlayed?.player.name, value: `${mostGamesPlayed?.games_played ?? 0} games`, accent: '#34d399' },
                  { icon: <Award size={18} className="text-[#fbbf24]" />, label: 'Longest Win Streak', name: longestStreak?.s.player.name, value: longestStreak ? `${longestStreak.streak} in a row` : '—', accent: '#fbbf24' },
                  mostImproved ? {
                    icon: <TrendingUp size={18} className="text-[#4ade80]" />,
                    label: 'Most Improved',
                    name: mostImproved.s.player.name,
                    value: `${mostImproved.imp!.first3avg} → ${mostImproved.imp!.last3avg}`,
                    accent: '#4ade80',
                  } : null,
                ].filter(Boolean).map((rec) => {
                  const r = rec!
                  return (
                    <div key={r.label}
                      className={`card p-3 flex items-center gap-3 ${r.glow ? 'ring-1 ring-[#4ade80]/40 shadow-[0_0_12px_#4ade8030]' : ''}`}>
                      <div className="w-9 h-9 bg-[#0c1220] rounded-lg flex items-center justify-center flex-shrink-0">
                        {r.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[#5e7190] text-xs uppercase tracking-wider">{r.label}</div>
                        <div className="text-white font-medium text-sm truncate">{r.name ?? '—'}</div>
                      </div>
                      <div className="font-mono text-xs font-semibold flex-shrink-0" style={{ color: r.accent }}>{r.value}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Hall of Shame */}
            <div>
              <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-2">Hall of Shame</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: <Flame size={18} className="text-orange-400" />, label: 'Worst Single Game', name: worstSingle?.player.name, value: worstSingle ? `${worstSingle.worst_game} pts` : '—', accent: '#fb923c' },
                  shanghaiSurvivor ? { icon: <Shield size={18} className="text-[#64748b]" />, label: 'Shanghai Survivor', name: shanghaiSurvivor.player.name, value: `${shanghaiSurvivor.games_played}g, 0 wins`, accent: '#64748b' } : null,
                ].filter(Boolean).map((rec) => {
                  const r = rec!
                  return (
                    <div key={r.label} className="card p-3 flex items-center gap-3 border-orange-900/30">
                      <div className="w-9 h-9 bg-[#0c1220] rounded-lg flex items-center justify-center flex-shrink-0">{r.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[#5e7190] text-xs uppercase tracking-wider">{r.label}</div>
                        <div className="text-white font-medium text-sm truncate">{r.name ?? '—'}</div>
                      </div>
                      <div className="font-mono text-xs font-semibold flex-shrink-0" style={{ color: r.accent }}>{r.value}</div>
                    </div>
                  )
                })}
                {!shanghaiSurvivor && (
                  <p className="text-[#5e7190] text-xs text-center pb-2">Shanghai Survivor needs a player with 5+ games and no wins</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
