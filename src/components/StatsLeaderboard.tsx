import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Trophy, TrendingDown, Zap, Star } from 'lucide-react'
import { getCompletedGames, computeWinner } from '../lib/gameStore'
import { PLAYER_COLORS } from '../lib/constants'
import type { GameWithScores, PlayerStats, Player } from '../lib/types'
import { format } from 'date-fns'

export default function StatsLeaderboard() {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'leaderboard' | 'trends' | 'records'>('leaderboard')

  useEffect(() => {
    getCompletedGames().then((g) => {
      setGames(g)
      setLoading(false)
    })
  }, [])

  // Compute stats
  const playerMap = new Map<string, Player>()
  games.forEach((g) =>
    g.game_scores.forEach((gs) => {
      if (gs.player) playerMap.set(gs.player_id, gs.player)
    })
  )
  const players = Array.from(playerMap.values())

  const stats: PlayerStats[] = players.map((player) => {
    const playerScores = games.flatMap((g) =>
      g.game_scores.filter((gs) => gs.player_id === player.id)
    )
    const gamesPlayed = playerScores.length
    const wins = games.filter((g) => {
      const w = computeWinner(g.game_scores)
      return w?.player_id === player.id
    }).length
    const totalScore = playerScores.reduce((s, gs) => s + gs.total_score, 0)
    const avgScore = gamesPlayed ? Math.round(totalScore / gamesPlayed) : 0
    const bestGame = gamesPlayed
      ? Math.min(...playerScores.map((gs) => gs.total_score))
      : 0
    const zeroRounds = playerScores.reduce(
      (sum, gs) => sum + gs.round_scores.filter((s) => s === 0).length,
      0
    )
    return { player, games_played: gamesPlayed, wins, avg_score: avgScore, best_game: bestGame, zero_rounds: zeroRounds }
  })

  const ranked = [...stats].sort((a, b) =>
    b.wins !== a.wins ? b.wins - a.wins : a.avg_score - b.avg_score
  )

  // Trend chart data — one point per game per player
  const trendData = [...games]
    .reverse()
    .map((g, idx) => {
      const point: Record<string, string | number> = {
        label: (() => {
          try { return format(new Date(g.date + 'T12:00:00'), 'M/d') }
          catch { return g.date }
        })(),
        idx,
      }
      g.game_scores.forEach((gs) => {
        if (gs.player?.name) point[gs.player.name] = gs.total_score
      })
      return point
    })

  // Records
  const mostWins = ranked[0]
  const lowestAvg = stats.filter((s) => s.games_played >= 2).sort((a, b) => a.avg_score - b.avg_score)[0]
  const bestSingle = stats
    .filter((s) => s.games_played > 0)
    .sort((a, b) => a.best_game - b.best_game)[0]
  const mostZeros = [...stats].sort((a, b) => b.zero_rounds - a.zero_rounds)[0]

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <div className="p-4 pt-6">
        <h2 className="font-display text-2xl font-semibold text-white">Stats</h2>

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-4 bg-[#0f1929] rounded-xl p-1">
          {(['leaderboard', 'trends', 'records'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setView(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors
                ${view === tab ? 'bg-[#1a2640] text-[#e2b858]' : 'text-[#5e7190]'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pb-24 overflow-auto">
        {loading ? (
          <div className="text-center text-[#5e7190] py-12">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">📊</div>
            <div className="text-[#5e7190]">No data yet</div>
          </div>
        ) : view === 'leaderboard' ? (
          <div className="flex flex-col gap-3">
            {ranked.map((stat, i) => (
              <div key={stat.player.id} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-display text-xl font-bold ${
                        i === 0 ? 'text-[#e2b858]' : 'text-[#5e7190]'
                      }`}
                    >
                      #{i + 1}
                    </span>
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: PLAYER_COLORS[players.findIndex((p) => p.id === stat.player.id) % PLAYER_COLORS.length] }}
                    />
                    <span className="text-white font-medium">{stat.player.name}</span>
                    {i === 0 && <Trophy size={16} className="text-[#e2b858]" />}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[#e2b858] font-semibold">{stat.wins}W</div>
                    <div className="text-[#5e7190] text-xs">{stat.games_played} games</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-[#0c1220] rounded-lg p-2">
                    <div className="font-mono text-white font-medium">{stat.avg_score}</div>
                    <div className="text-[#5e7190] text-xs">Avg</div>
                  </div>
                  <div className="bg-[#0c1220] rounded-lg p-2">
                    <div className="font-mono text-white font-medium">{stat.best_game}</div>
                    <div className="text-[#5e7190] text-xs">Best</div>
                  </div>
                  <div className="bg-[#0c1220] rounded-lg p-2">
                    <div className="font-mono text-white font-medium">{stat.zero_rounds}</div>
                    <div className="text-[#5e7190] text-xs">Zeros</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : view === 'trends' ? (
          <div className="card p-4">
            <h3 className="text-[#5e7190] text-xs uppercase tracking-wider mb-4">Score Over Time (lower is better)</h3>
            {trendData.length < 2 ? (
              <p className="text-[#5e7190] text-sm text-center py-8">Need at least 2 games to show trends</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#5e7190', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#5e7190', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#131d30',
                      border: '1px solid #1a2640',
                      borderRadius: 8,
                      color: '#e2e8f0',
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                    formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>}
                  />
                  {players.map((p, i) => (
                    <Line
                      key={p.id}
                      type="monotone"
                      dataKey={p.name}
                      stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          /* Records */
          <div className="flex flex-col gap-3">
            {[
              { icon: <Trophy size={20} className="text-[#e2b858]" />, label: 'Most Wins', stat: mostWins, value: `${mostWins?.wins} wins` },
              { icon: <TrendingDown size={20} className="text-[#6ecfef]" />, label: 'Lowest Average', stat: lowestAvg, value: lowestAvg ? `${lowestAvg.avg_score} avg` : 'Need 2+ games' },
              { icon: <Star size={20} className="text-[#4ade80]" />, label: 'Best Single Game', stat: bestSingle, value: bestSingle ? `${bestSingle.best_game} pts` : '—' },
              { icon: <Zap size={20} className="text-[#a78bfa]" />, label: 'Most Zeros (went out)', stat: mostZeros, value: `${mostZeros?.zero_rounds} rounds` },
            ].map(({ icon, label, stat, value }) => (
              <div key={label} className="card p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-[#0c1220] rounded-lg flex items-center justify-center flex-shrink-0">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[#5e7190] text-xs uppercase tracking-wider">{label}</div>
                  <div className="text-white font-medium truncate">{stat?.player.name ?? '—'}</div>
                </div>
                <div className="font-mono text-[#e2b858] text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
