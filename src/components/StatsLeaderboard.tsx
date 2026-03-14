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
type DateFilter = 'all' | 'month' | '30d' | '3m' | 'custom'

interface Props {
  onPlayerClick?: (playerId: string) => void
}

export default function StatsLeaderboard({ onPlayerClick }: Props) {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'leaderboard' | 'trends' | 'records'>('leaderboard')
  // Leaderboard
  const [minGames, setMinGames] = useState<MinGames>(3)
  const [alsoPlayedOpen, setAlsoPlayedOpen] = useState(false)
  // Date filter
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  // Trends
  const [trendsView, setTrendsView] = useState<TrendsView>('averages')
  const [overtimeMode, setOvertimeMode] = useState<'raw' | 'rolling'>('rolling')
  const [visiblePlayerIds, setVisiblePlayerIds] = useState<Set<string>>(new Set())
  const [maxLinesWarning, setMaxLinesWarning] = useState(false)
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)

  useEffect(() => {
    getCompletedGames().then((g) => { setGames(g); setLoading(false) })
  }, [])

  // Date filter helpers
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const now = new Date()
  const filterStart = dateFilter === 'month' ? fmt(new Date(now.getFullYear(), now.getMonth(), 1))
    : dateFilter === '30d' ? fmt(new Date(now.getTime() - 30 * 86400000))
    : dateFilter === '3m' ? fmt(new Date(now.getTime() - 91 * 86400000))
    : dateFilter === 'custom' ? (customStart || null)
    : null
  const filterEnd = dateFilter === 'custom' ? (customEnd || null) : null
  const filteredGames = games.filter((g) =>
    (!filterStart || g.date >= filterStart) && (!filterEnd || g.date <= filterEnd)
  )

  // Player map from filtered games
  const playerMap = new Map<string, Player>()
  filteredGames.forEach((g) => g.game_scores.forEach((gs) => { if (gs.player) playerMap.set(gs.player_id, gs.player) }))
  const players = Array.from(playerMap.values())

  const playerColor = (id: string) => PLAYER_COLORS[players.findIndex((p) => p.id === id) % PLAYER_COLORS.length]

  // Stats
  const stats = players.map((player) => {
    const ps = filteredGames.flatMap((g) => g.game_scores.filter((gs) => gs.player_id === player.id))
    const gamesPlayed = ps.length
    const wins = filteredGames.filter((g) => computeWinner(g.game_scores)?.player_id === player.id).length
    const avgScore = gamesPlayed ? Math.round(ps.reduce((s, gs) => s + gs.total_score, 0) / gamesPlayed) : 0
    const totals = ps.map((gs) => gs.total_score)
    const bestGame = gamesPlayed ? Math.min(...totals) : 0
    const worstGame = gamesPlayed ? Math.max(...totals) : 0
    const zeroRounds = ps.reduce((sum, gs) => sum + gs.round_scores.filter((s) => s === 0).length, 0)
    return { player, games_played: gamesPlayed, wins, avg_score: avgScore, best_game: bestGame, worst_game: worstGame, zero_rounds: zeroRounds }
  })

  const ranked = [...stats].sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : a.avg_score - b.avg_score)

  // Init visible players for overtime
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
    .map((s) => ({ name: s.player.name, avg: s.avg_score, color: playerColor(s.player.id), playerId: s.player.id }))

  // Overtime charts
  const chronoGames = [...filteredGames].sort((a, b) => a.date.localeCompare(b.date))
  const fmtLabel = (d: string) => { try { return format(new Date(d + 'T12:00:00'), 'M/d') } catch { return d } }

  const rawData = chronoGames.map((g) => {
    const point: Record<string, string | number> = { label: fmtLabel(g.date) }
    g.game_scores.forEach((gs) => { if (gs.player?.name) point[gs.player.name] = gs.total_score })
    return point
  })

  const rollingData = chronoGames.map((g, idx) => {
    const point: Record<string, string | number> = { label: fmtLabel(g.date) }
    players.forEach((p) => {
      const playerGamesSoFar = chronoGames.slice(0, idx + 1).filter((pg) => pg.game_scores.some((gs) => gs.player_id === p.id))
      const window = playerGamesSoFar.slice(-5)
      if (window.length > 0) {
        const avg = window.reduce((sum, pg) => sum + (pg.game_scores.find((s) => s.player_id === p.id)?.total_score ?? 0), 0) / window.length
        point[p.name] = Math.round(avg)
      }
    })
    return point
  })

  const chartData = overtimeMode === 'rolling' ? rollingData : rawData
  const visiblePlayers = players.filter((p) => visiblePlayerIds.has(p.id))

  const toggleOvertimePlayer = (id: string) => {
    setVisiblePlayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else if (next.size >= 5) { setMaxLinesWarning(true); setTimeout(() => setMaxLinesWarning(false), 2500); return prev }
      else { next.add(id) }
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
    ? chronoGames.filter((g) => g.game_scores.some((gs) => gs.player_id === compareA) && g.game_scores.some((gs) => gs.player_id === compareB))
    : []
  const compareChartData = compareGames.map((g) => ({
    label: fmtLabel(g.date),
    [comparePlayerA?.name ?? 'A']: g.game_scores.find((gs) => gs.player_id === compareA)?.total_score,
    [comparePlayerB?.name ?? 'B']: g.game_scores.find((gs) => gs.player_id === compareB)?.total_score,
  }))
  const h2hWinsA = compareGames.filter((g) => computeWinner(g.game_scores)?.player_id === compareA).length
  const h2hWinsB = compareGames.filter((g) => computeWinner(g.game_scores)?.player_id === compareB).length
  const statsA = stats.find((s) => s.player.id === compareA)
  const statsB = stats.find((s) => s.player.id === compareB)

  // Improvement tracker — players with 5+ games, first 5 vs last 5
  const improvementData = stats
    .filter((s) => s.games_played >= 5)
    .map((s) => {
      const pg = chronoGames.filter((g) => g.game_scores.some((gs) => gs.player_id === s.player.id))
      const getAvg = (gs: GameWithScores[]) => {
        const scores = gs.map((g) => g.game_scores.find((x) => x.player_id === s.player.id)?.total_score ?? 0)
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      }
      const first5avg = getAvg(pg.slice(0, 5))
      const last5avg = getAvg(pg.slice(-5))
      return { player: s.player, first5avg, last5avg, diff: first5avg - last5avg }
    })
    .filter((x) => x.diff !== 0)
    .sort((a, b) => b.diff - a.diff)

  // Best nights — top 5 individual scores
  const bestNights = filteredGames
    .flatMap((g) => g.game_scores.map((gs) => ({
      date: g.date, playerName: gs.player?.name ?? '?', playerId: gs.player_id,
      score: gs.total_score, playerCount: g.game_scores.length,
    })))
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)

  // Records helpers
  const getWinStreak = (playerId: string) => {
    let max = 0, cur = 0
    for (const g of chronoGames) {
      if (!g.game_scores.some((gs) => gs.player_id === playerId)) continue
      if (computeWinner(g.game_scores)?.player_id === playerId) { cur++; max = Math.max(max, cur) } else cur = 0
    }
    return max
  }
  const getImprovement = (playerId: string) => {
    const pg = chronoGames.filter((g) => g.game_scores.some((gs) => gs.player_id === playerId))
    if (pg.length < 6) return null
    const avg = (gs: GameWithScores[]) => {
      const scores = gs.map((g) => g.game_scores.find((s) => s.player_id === playerId)!.total_score)
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    }
    const first3avg = avg(pg.slice(0, 3)), last3avg = avg(pg.slice(-3))
    return { first3avg, last3avg, diff: first3avg - last3avg }
  }

  // Records
  const mostWins = ranked[0]
  const lowestAvg = stats.filter((s) => s.games_played >= 2).sort((a, b) => a.avg_score - b.avg_score)[0]
  const bestSingle = stats.filter((s) => s.games_played > 0).sort((a, b) => a.best_game - b.best_game)[0]
  const mostZeros = [...stats].sort((a, b) => b.zero_rounds - a.zero_rounds)[0]
  const mostGamesPlayed = [...stats].sort((a, b) => b.games_played - a.games_played)[0]
  const worstSingle = stats.filter((s) => s.games_played > 0).sort((a, b) => b.worst_game - a.worst_game)[0]
  const improvs = stats.map((s) => ({ s, imp: getImprovement(s.player.id) })).filter((x) => x.imp && x.imp.diff > 0)
  const mostImproved = improvs.sort((a, b) => b.imp!.diff - a.imp!.diff)[0]
  const longestStreak = [...stats].map((s) => ({ s, streak: getWinStreak(s.player.id) })).sort((a, b) => b.streak - a.streak)[0]
  const shanghaiSurvivor = stats.filter((s) => s.games_played >= 5 && s.wins === 0).sort((a, b) => b.games_played - a.games_played)[0]

  const podiumColors = ['#8b6914', '#8b7355', '#b45309']
  const podiumPlatformH = ['h-20', 'h-12', 'h-8']
  const podiumOrder = [1, 0, 2]

  const filterLabel = dateFilter === 'all' ? null
    : dateFilter === 'month' ? 'This Month'
    : dateFilter === '30d' ? 'Last 30 Days'
    : dateFilter === '3m' ? 'Last 3 Months'
    : 'Custom Range'

  // Shared chart tooltip style
  const tooltipStyle = { background: '#ffffff', border: '1px solid #e2ddd2', borderRadius: 8, color: '#2c1810', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }

  const PlayerName = ({ id, name, className = '' }: { id: string; name: string; className?: string }) => (
    <button
      onClick={() => onPlayerClick?.(id)}
      className={`text-left ${onPlayerClick ? 'hover:text-[#8b6914] transition-colors' : ''} ${className}`}
    >
      {name}
    </button>
  )

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <div className="p-4 pt-6">
        <h2 className="font-display text-2xl font-semibold text-[#2c1810]">Stats</h2>

        {/* Date filter */}
        <div className="mt-3 flex flex-wrap gap-1.5 items-center">
          {(['all', 'month', '30d', '3m', 'custom'] as DateFilter[]).map((f) => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                ${dateFilter === f ? 'bg-[#efe9dd] text-[#8b6914] font-semibold' : 'text-[#a08c6e] hover:text-[#2c1810]'}`}>
              {f === 'all' ? 'All Time' : f === 'month' ? 'This Month' : f === '30d' ? '30 Days' : f === '3m' ? '3 Months' : 'Custom'}
            </button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="flex gap-2 mt-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="flex-1 bg-white border border-[#e2ddd2] rounded-lg px-2 py-1.5 text-[#2c1810] text-xs focus:outline-none focus:border-[#8b6914]" />
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="flex-1 bg-white border border-[#e2ddd2] rounded-lg px-2 py-1.5 text-[#2c1810] text-xs focus:outline-none focus:border-[#8b6914]" />
          </div>
        )}
        {filterLabel && (
          <p className="text-[#8b7355] text-xs mt-1">
            Showing: {filterLabel} ({filteredGames.length} game{filteredGames.length !== 1 ? 's' : ''})
          </p>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-3 bg-[#efe9dd] rounded-xl p-1">
          {(['leaderboard', 'trends', 'records'] as const).map((tab) => (
            <button key={tab} onClick={() => setView(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors
                ${view === tab ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pb-24 overflow-auto">
        {loading ? (
          <div className="text-center text-[#8b7355] py-12">Loading…</div>
        ) : filteredGames.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">📊</div>
            <div className="text-[#8b7355]">{games.length === 0 ? 'No data yet' : 'No games in this date range'}</div>
          </div>

        ) : view === 'leaderboard' ? (
          <div className="flex flex-col gap-4">
            {/* Min games filter */}
            <div className="flex items-center gap-2">
              <span className="text-[#8b7355] text-xs">Min games:</span>
              <div className="flex gap-1">
                {([2, 3, 5, 0] as MinGames[]).map((n) => (
                  <button key={n} onClick={() => setMinGames(n)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                      ${minGames === n ? 'bg-[#efe9dd] text-[#8b6914] font-semibold' : 'text-[#a08c6e] hover:text-[#2c1810]'}`}>
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
                      <div className="card p-3 text-center rounded-b-none"
                        style={{ borderColor: `${color}50`, background: isFirst ? `rgba(139,105,20,0.06)` : undefined }}>
                        {isFirst && <div className="text-lg mb-1">👑</div>}
                        <PlayerName id={s.player.id} name={s.player.name}
                          className="text-[#2c1810] font-medium text-sm leading-tight truncate block w-full" />
                        <div className="font-mono font-bold mt-1" style={{ color }}>{s.wins}W</div>
                        <div className="text-[#8b7355] text-xs">avg {s.avg_score}</div>
                        <div className="text-[#a08c6e] text-xs">{s.games_played}g</div>
                      </div>
                      <div className={`w-full ${podiumPlatformH[rankIdx]} rounded-b-lg flex items-center justify-center`}
                        style={{ background: `${color}18` }}>
                        <span className="font-display font-bold text-lg" style={{ color }}>#{rankIdx + 1}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Table rank 4+ */}
            {tableRows.length > 0 && (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e2ddd2]">
                      {['#', 'Player', 'G', 'W', 'Avg', 'Best', '0s'].map((h) => (
                        <th key={h} className="px-2 py-2 text-[#a08c6e] text-xs font-medium text-center first:text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((s, i) => (
                      <tr key={s.player.id} className={`border-b border-[#e2ddd2]/50 ${i % 2 !== 0 ? 'bg-[#efe9dd]/40' : ''}`}>
                        <td className="px-2 py-2 text-[#a08c6e] text-xs">{i + 4}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: playerColor(s.player.id) }} />
                            <PlayerName id={s.player.id} name={s.player.name} className="text-[#2c1810] truncate max-w-[80px] text-sm" />
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[#8b7355] text-xs">{s.games_played}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#8b6914] text-xs font-semibold">{s.wins}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#2c1810] text-xs">{s.avg_score}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#2d7a3a] text-xs">{s.best_game}</td>
                        <td className="px-2 py-2 text-center font-mono text-[#7c3aed] text-xs">{s.zero_rounds}</td>
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
                  <span className="text-[#8b7355] text-sm">
                    Guests & newcomers ({alsoPlayed.length} player{alsoPlayed.length !== 1 ? 's' : ''})
                  </span>
                  {alsoPlayedOpen ? <ChevronUp size={16} className="text-[#a08c6e]" /> : <ChevronDown size={16} className="text-[#a08c6e]" />}
                </button>
                {alsoPlayedOpen && (
                  <div className="border-t border-[#e2ddd2]">
                    {alsoPlayed.map((s, i) => (
                      <div key={s.player.id} className={`flex items-center justify-between px-3 py-2 ${i % 2 !== 0 ? 'bg-[#efe9dd]/40' : ''}`}>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: playerColor(s.player.id) }} />
                          <PlayerName id={s.player.id} name={s.player.name} className="text-[#2c1810] text-sm" />
                        </div>
                        <span className="text-[#8b7355] text-xs font-mono">{s.games_played}g · avg {s.avg_score}</span>
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
            <div className="flex gap-1 bg-[#efe9dd] rounded-xl p-1">
              {(['averages', 'overtime', 'compare'] as TrendsView[]).map((t) => (
                <button key={t} onClick={() => setTrendsView(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${trendsView === t ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'}`}>
                  {t === 'overtime' ? 'Over Time' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* AVERAGES view */}
            {trendsView === 'averages' && (
              <div className="flex flex-col gap-3">
                <div className="card p-4">
                  <p className="text-[#8b7355] text-xs uppercase tracking-wider">Average Score</p>
                  <p className="text-[#a08c6e] text-xs mb-4">Lower is better · min {threshold || 1} games</p>
                  {barData.length === 0 ? (
                    <p className="text-[#8b7355] text-sm text-center py-8">No qualifying players</p>
                  ) : (
                    <div style={{ height: Math.max(160, barData.length * 44) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={barData} margin={{ top: 0, right: 44, left: 0, bottom: 0 }}>
                          <XAxis type="number" tick={{ fill: '#8b7355', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" width={72} tick={{ fill: '#2c1810', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: '#efe9dd' }} contentStyle={tooltipStyle}
                            formatter={(v) => [`${v} pts`, 'Avg']} />
                          <Bar dataKey="avg" radius={[0, 4, 4, 0]} maxBarSize={28}>
                            <LabelList dataKey="avg" position="right" style={{ fill: '#8b7355', fontSize: 11 }} />
                            {barData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Best Nights */}
                {bestNights.length > 0 && (
                  <div className="card p-3">
                    <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-3">Best Nights</p>
                    {bestNights.map((bn, i) => {
                      const dateStr = (() => { try { return format(new Date(bn.date + 'T12:00:00'), 'MMM d, yy') } catch { return bn.date } })()
                      return (
                        <div key={i} className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t border-[#e2ddd2]/50' : ''}`}>
                          <span className="font-display font-bold text-sm w-5" style={{ color: i === 0 ? '#8b6914' : '#a08c6e' }}>#{i + 1}</span>
                          <div className="flex-1">
                            <button onClick={() => onPlayerClick?.(bn.playerId)} className={`text-[#2c1810] font-medium text-sm ${onPlayerClick ? 'hover:text-[#8b6914]' : ''}`}>
                              {bn.playerName}
                            </button>
                            <div className="text-[#a08c6e] text-xs">{dateStr} · {bn.playerCount} players</div>
                          </div>
                          <span className="font-mono font-bold" style={{ color: i === 0 ? '#8b6914' : '#2c1810' }}>{bn.score} pts</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* OVER TIME view */}
            {trendsView === 'overtime' && (
              <>
                {/* Mode toggle */}
                <div className="flex gap-1 bg-[#efe9dd] rounded-xl p-1">
                  {(['rolling', 'raw'] as const).map((m) => (
                    <button key={m} onClick={() => setOvertimeMode(m)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors
                        ${overtimeMode === m ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'}`}>
                      {m === 'rolling' ? '5-Game Rolling Avg' : 'Raw Scores'}
                    </button>
                  ))}
                </div>

                {/* Player toggles */}
                <div className="card p-3">
                  <p className="text-xs text-[#8b7355] uppercase tracking-wider mb-2">Players (max 5)</p>
                  {maxLinesWarning && <p className="text-amber-600 text-xs mb-2">Tap a player to deselect first</p>}
                  <div className="flex flex-wrap gap-2">
                    {stats.sort((a, b) => b.games_played - a.games_played).map((s) => {
                      const color = playerColor(s.player.id)
                      const active = visiblePlayerIds.has(s.player.id)
                      return (
                        <button key={s.player.id} onClick={() => toggleOvertimePlayer(s.player.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                            ${active ? 'border-transparent text-white' : 'border-[#e2ddd2] text-[#8b7355]'}`}
                          style={active ? { background: color } : {}}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? 'rgba(255,255,255,0.8)' : color }} />
                          {s.player.name}
                          <span className="opacity-60">{s.games_played}g</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="card p-4">
                  <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-4">
                    {overtimeMode === 'rolling' ? '5-Game Rolling Average (lower is better)' : 'Score Over Time (lower is better)'}
                  </p>
                  {chartData.length < 2 ? (
                    <p className="text-[#8b7355] text-sm text-center py-8">Need at least 2 games</p>
                  ) : visiblePlayers.length === 0 ? (
                    <p className="text-[#8b7355] text-sm text-center py-8">Select players above</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <XAxis dataKey="label" tick={{ fill: '#8b7355', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#8b7355', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(v) => <span style={{ color: '#8b7355' }}>{v}</span>} />
                        {visiblePlayers.map((p) => (
                          <Line key={p.id} type="monotone" dataKey={p.name}
                            stroke={playerColor(p.id)} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Improvement tracker */}
                {improvementData.length > 0 && (
                  <div className="card p-3">
                    <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-3">Improvement Tracker</p>
                    <p className="text-[#a08c6e] text-xs mb-3">First 5 vs last 5 games · players with 5+ games</p>
                    {improvementData.map((d) => (
                      <div key={d.player.id} className="flex items-center gap-2 py-2 border-t border-[#e2ddd2]/50 first:border-0">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: playerColor(d.player.id) }} />
                        <button onClick={() => onPlayerClick?.(d.player.id)} className={`text-[#2c1810] text-sm font-medium w-24 text-left truncate ${onPlayerClick ? 'hover:text-[#8b6914]' : ''}`}>
                          {d.player.name}
                        </button>
                        <div className="flex-1 text-xs text-[#8b7355] font-mono">
                          {d.first5avg} → {d.last5avg}
                        </div>
                        <div className={`text-xs font-semibold font-mono flex-shrink-0 ${d.diff > 0 ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
                          {d.diff > 0 ? '↓' : '↑'} {Math.abs(d.diff)} pts
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* COMPARE view */}
            {trendsView === 'compare' && (
              <div className="flex flex-col gap-3">
                <div className="card p-3">
                  <p className="text-xs text-[#8b7355] uppercase tracking-wider mb-2">Select 2 players</p>
                  <div className="flex flex-wrap gap-2">
                    {stats.sort((a, b) => b.games_played - a.games_played).map((s) => {
                      const isA = compareA === s.player.id, isB = compareB === s.player.id
                      const color = isA ? '#e2b858' : isB ? '#1d7ea8' : undefined
                      return (
                        <button key={s.player.id} onClick={() => selectCompare(s.player.id)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                            ${isA || isB ? 'border-transparent text-white' : 'border-[#e2ddd2] text-[#8b7355]'}`}
                          style={color ? { background: color } : {}}>
                          {s.player.name}{isA && ' (A)'}{isB && ' (B)'}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {comparePlayerA && comparePlayerB && statsA && statsB ? (
                  <>
                    <div className="card p-4">
                      <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-3">
                        Head to Head · {compareGames.length} shared game{compareGames.length !== 1 ? 's' : ''}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <PlayerName id={comparePlayerA.id} name={comparePlayerA.name} className="text-[#2c1810] font-medium text-sm" />
                        <div />
                        <PlayerName id={comparePlayerB.id} name={comparePlayerB.name} className="text-[#2c1810] font-medium text-sm" />
                      </div>
                      {[
                        { label: 'H2H Wins', a: h2hWinsA, b: h2hWinsB },
                        { label: 'Total Wins', a: statsA.wins, b: statsB.wins },
                        { label: 'Avg Score', a: statsA.avg_score, b: statsB.avg_score, lowerBetter: true },
                        { label: 'Best Game', a: statsA.best_game, b: statsB.best_game, lowerBetter: true },
                      ].map(({ label, a, b, lowerBetter }) => {
                        const aBetter = lowerBetter ? a < b : a > b, bBetter = lowerBetter ? b < a : b > a
                        return (
                          <div key={label} className="grid grid-cols-3 gap-2 text-center py-1.5 border-t border-[#e2ddd2]/50">
                            <div className={`font-mono text-sm font-semibold ${aBetter ? 'text-[#8b6914]' : 'text-[#2c1810]'}`}>{a}</div>
                            <div className="text-[#8b7355] text-xs self-center">{label}</div>
                            <div className={`font-mono text-sm font-semibold ${bBetter ? 'text-[#1d7ea8]' : 'text-[#2c1810]'}`}>{b}</div>
                          </div>
                        )
                      })}
                    </div>
                    {compareChartData.length >= 2 && (
                      <div className="card p-4">
                        <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-4">Score When Both Played</p>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={compareChartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                            <XAxis dataKey="label" tick={{ fill: '#8b7355', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#8b7355', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(v) => <span style={{ color: '#8b7355' }}>{v}</span>} />
                            <Line type="monotone" dataKey={comparePlayerA.name} stroke="#e2b858" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                            <Line type="monotone" dataKey={comparePlayerB.name} stroke="#1d7ea8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center text-[#8b7355] text-sm py-8">
                    {compareA ? 'Select one more player' : 'Select two players above'}
                  </div>
                )}
              </div>
            )}
          </div>

        ) : (
          /* Records */
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[#a08c6e] text-xs uppercase tracking-wider mb-2">Champions</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: <Trophy size={18} className="text-[#8b6914]" />, label: 'Most Wins', id: mostWins?.player.id, name: mostWins?.player.name, value: `${mostWins?.wins} wins`, accent: '#8b6914' },
                  { icon: <TrendingDown size={18} className="text-[#1d7ea8]" />, label: 'Lowest Average', id: lowestAvg?.player.id, name: lowestAvg?.player.name, value: lowestAvg ? `${lowestAvg.avg_score} avg` : 'Need 2+ games', accent: '#1d7ea8' },
                  { icon: <Star size={18} className="text-[#2d7a3a]" />, label: 'Best Single Game', id: bestSingle?.player.id, name: bestSingle?.player.name, value: bestSingle ? `${bestSingle.best_game} pts` : '—', accent: '#2d7a3a', glow: bestSingle?.best_game === 0 },
                  { icon: <Zap size={18} className="text-[#7c3aed]" />, label: 'Most Zeros', id: mostZeros?.player.id, name: mostZeros?.player.name, value: `${mostZeros?.zero_rounds ?? 0} rounds`, accent: '#7c3aed' },
                  { icon: <Calendar size={18} className="text-[#2d7a3a]" />, label: 'Most Games Played', id: mostGamesPlayed?.player.id, name: mostGamesPlayed?.player.name, value: `${mostGamesPlayed?.games_played ?? 0} games`, accent: '#2d7a3a' },
                  { icon: <Award size={18} className="text-[#8b6914]" />, label: 'Longest Win Streak', id: longestStreak?.s.player.id, name: longestStreak?.s.player.name, value: longestStreak ? `${longestStreak.streak} in a row` : '—', accent: '#8b6914' },
                  mostImproved ? { icon: <TrendingUp size={18} className="text-[#2d7a3a]" />, label: 'Most Improved', id: mostImproved.s.player.id, name: mostImproved.s.player.name, value: `${mostImproved.imp!.first3avg} → ${mostImproved.imp!.last3avg}`, accent: '#2d7a3a' } : null,
                ].filter(Boolean).map((rec) => {
                  const r = rec!
                  return (
                    <div key={r.label}
                      className={`card p-3 flex items-center gap-3 ${r.glow ? 'ring-1 ring-[#2d7a3a]/30' : ''}`}>
                      <div className="w-9 h-9 bg-[#efe9dd] rounded-lg flex items-center justify-center flex-shrink-0">{r.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[#a08c6e] text-xs uppercase tracking-wider">{r.label}</div>
                        {r.id
                          ? <PlayerName id={r.id} name={r.name ?? '—'} className="text-[#2c1810] font-medium text-sm truncate block" />
                          : <div className="text-[#2c1810] font-medium text-sm">—</div>}
                      </div>
                      <div className="font-mono text-xs font-semibold flex-shrink-0" style={{ color: r.accent }}>{r.value}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-[#a08c6e] text-xs uppercase tracking-wider mb-2">Hall of Shame</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: <Flame size={18} className="text-orange-500" />, label: 'Worst Single Game', id: worstSingle?.player.id, name: worstSingle?.player.name, value: worstSingle ? `${worstSingle.worst_game} pts` : '—', accent: '#b83232' },
                  shanghaiSurvivor ? { icon: <Shield size={18} className="text-[#8b7355]" />, label: 'Shanghai Survivor', id: shanghaiSurvivor.player.id, name: shanghaiSurvivor.player.name, value: `${shanghaiSurvivor.games_played}g, 0 wins`, accent: '#8b7355' } : null,
                ].filter(Boolean).map((rec) => {
                  const r = rec!
                  return (
                    <div key={r.label} className="card p-3 flex items-center gap-3 border-orange-200/50">
                      <div className="w-9 h-9 bg-[#efe9dd] rounded-lg flex items-center justify-center flex-shrink-0">{r.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[#a08c6e] text-xs uppercase tracking-wider">{r.label}</div>
                        {r.id
                          ? <PlayerName id={r.id} name={r.name ?? '—'} className="text-[#2c1810] font-medium text-sm truncate block" />
                          : <div className="text-[#2c1810] font-medium text-sm">—</div>}
                      </div>
                      <div className="font-mono text-xs font-semibold flex-shrink-0" style={{ color: r.accent }}>{r.value}</div>
                    </div>
                  )
                })}
                {!shanghaiSurvivor && (
                  <p className="text-[#a08c6e] text-xs text-center pb-2">Shanghai Survivor needs a player with 5+ games and 0 wins</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
