import { useState, useEffect } from 'react'
import {
  Trophy, TrendingDown, TrendingUp, Zap, Star,
  Calendar, Award, ChevronDown, ChevronUp, ArrowLeft,
} from 'lucide-react'
import { getCompletedGames, computeWinner } from '../lib/gameStore'
import { PLAYER_COLORS } from '../lib/constants'
import { ACHIEVEMENTS, getCategoryIcon } from '../lib/achievements'
import type { GameWithScores, Player, DrilldownView } from '../lib/types'
import { format } from 'date-fns'
import DrilldownModal from './DrilldownModal'
import { SkeletonStats } from './Skeleton'

type MinGames = 0 | 2 | 3 | 5
type DateFilter = 'all' | 'month' | '30d' | '3m' | 'custom'
type GameTypeFilter = 'all' | 'manual' | 'played'

interface Props {
  onPlayerClick?: (playerId: string) => void
  onNavigateHome?: () => void
}

export default function StatsLeaderboard({ onPlayerClick, onNavigateHome }: Props) {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'leaderboard' | 'records' | 'achievements'>('leaderboard')
  // Leaderboard
  const [minGames, setMinGames] = useState<MinGames>(3)
  const [alsoPlayedOpen, setAlsoPlayedOpen] = useState(false)
  // Date filter
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  // Game type filter
  const [gameTypeFilter, setGameTypeFilter] = useState<GameTypeFilter>('all')
  // Drilldown
  const [drilldownStack, setDrilldownStack] = useState<DrilldownView[]>([])
  const pushDrilldown = (v: DrilldownView) => setDrilldownStack((s) => [...s, v])
  const popDrilldown = () => setDrilldownStack((s) => s.slice(0, -1))
  const closeDrilldowns = () => setDrilldownStack([])

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
  const filteredGames = games.filter((g) => {
    if (filterStart && g.date < filterStart) return false
    if (filterEnd && g.date > filterEnd) return false
    if (gameTypeFilter === 'manual') return !g.game_type || g.game_type === 'manual'
    if (gameTypeFilter === 'played') return g.game_type === 'pass-and-play' || g.game_type === 'ai'
    return true
  })

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
    const zeroRounds = ps.reduce((sum, gs) => sum + gs.round_scores.filter((s) => s === 0).length, 0)
    return { player, games_played: gamesPlayed, wins, avg_score: avgScore, best_game: bestGame, zero_rounds: zeroRounds }
  })

  const ranked = [...stats].sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : a.avg_score - b.avg_score)

  // Leaderboard groupings
  const threshold = minGames === 0 ? 0 : minGames
  const qualifying = ranked.filter((s) => s.games_played >= threshold)
  const podium = qualifying.slice(0, 3)
  const tableRows = qualifying.slice(3)
  const alsoPlayed = ranked.filter((s) => s.games_played < threshold)

  // Chronological games — used in records
  const chronoGames = [...filteredGames].sort((a, b) => a.date.localeCompare(b.date))

  // Records helpers
  const getWinStreakGames = (playerId: string): GameWithScores[] => {
    let maxGames: GameWithScores[] = [], curGames: GameWithScores[] = []
    for (const g of chronoGames) {
      if (!g.game_scores.some((gs) => gs.player_id === playerId)) continue
      if (computeWinner(g.game_scores)?.player_id === playerId) {
        curGames.push(g)
        if (curGames.length > maxGames.length) maxGames = [...curGames]
      } else { curGames = [] }
    }
    return maxGames
  }
  const getWinStreak = (playerId: string) => getWinStreakGames(playerId).length
  const getImprovement = (playerId: string) => {
    const pg = chronoGames.filter((g) => g.game_scores.some((gs) => gs.player_id === playerId))
    if (pg.length < 6) return null
    const avg = (gs: GameWithScores[]) => {
      const scores = gs.map((g) => g.game_scores.find((s) => s.player_id === playerId)!.total_score)
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    }
    const firstGames = pg.slice(0, 3), lastGames = pg.slice(-3)
    const first3avg = avg(firstGames), last3avg = avg(lastGames)
    return { first3avg, last3avg, diff: first3avg - last3avg, firstGames, lastGames }
  }

  // Records
  const mostWins = ranked[0]
  const lowestAvg = stats.filter((s) => s.games_played >= 2).sort((a, b) => a.avg_score - b.avg_score)[0]
  const bestSingle = stats.filter((s) => s.games_played > 0).sort((a, b) => a.best_game - b.best_game)[0]
  const mostZeros = [...stats].sort((a, b) => b.zero_rounds - a.zero_rounds)[0]
  const mostGamesPlayed = [...stats].sort((a, b) => b.games_played - a.games_played)[0]
  const improvs = stats.map((s) => ({ s, imp: getImprovement(s.player.id) })).filter((x) => x.imp && x.imp.diff > 0)
  const mostImproved = improvs.sort((a, b) => b.imp!.diff - a.imp!.diff)[0]
  const longestStreak = [...stats].map((s) => ({ s, streak: getWinStreak(s.player.id) })).sort((a, b) => b.streak - a.streak)[0]

  const podiumColors = ['#8b6914', '#8b7355', '#b45309']
  const podiumPlatformH = ['h-20', 'h-12', 'h-8']
  const podiumOrder = [1, 0, 2]

  const filterLabel = dateFilter === 'all' ? null
    : dateFilter === 'month' ? 'This Month'
    : dateFilter === '30d' ? 'Last 30 Days'
    : dateFilter === '3m' ? 'Last 3 Months'
    : 'Custom Range'

  const PlayerName = ({ id, name, className = '' }: { id: string; name: string; className?: string }) => (
    <button
      onClick={() => onPlayerClick?.(id)}
      className={`text-left ${onPlayerClick ? 'hover:text-[#8b6914] transition-colors' : ''} ${className}`}
    >
      {name}
    </button>
  )

  // Drillable stat button — dotted underline affordance
  const DS = ({ onClick, children, className = '', style }: { onClick: () => void; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity ${className}`}
      style={style}
    >
      {children}
    </button>
  )

  // Drilldown view builder helpers
  const localFmtDate = (d: string) => { try { return format(new Date(d + 'T12:00:00'), 'MMM d, yyyy') } catch { return d } }
  const winsGamesList = (pid: string, name: string): DrilldownView => ({
    type: 'game-list', title: `${name}'s Wins`,
    games: filteredGames.filter((g) => computeWinner(g.game_scores)?.player_id === pid), focalPlayerId: pid,
  })
  const allGamesList = (pid: string, name: string): DrilldownView => ({
    type: 'game-list', title: `${name}'s Games`,
    games: filteredGames.filter((g) => g.game_scores.some((gs) => gs.player_id === pid)), focalPlayerId: pid,
  })
  const scoreHistoryDrill = (pid: string, name: string): DrilldownView => ({
    type: 'score-history', title: `${name} — Score History`,
    games: filteredGames.filter((g) => g.game_scores.some((gs) => gs.player_id === pid)),
    focalPlayerId: pid, playerColor: playerColor(pid),
  })
  const bestGameDrill = (pid: string, bestScore: number): DrilldownView | null => {
    const g = filteredGames.find((g) => g.game_scores.some((gs) => gs.player_id === pid && gs.total_score === bestScore))
    return g ? { type: 'game-scorecard', title: localFmtDate(g.date), game: g, highlightPlayerId: pid } : null
  }
  const zeroRoundsDrill = (pid: string, name: string): DrilldownView => ({
    type: 'zero-rounds', title: `${name}'s Zero Rounds`,
    games: filteredGames.filter((g) => g.game_scores.some((gs) => gs.player_id === pid && gs.round_scores.some((s) => s === 0))),
    focalPlayerId: pid,
  })
  const winStreakDrill = (pid: string, name: string): DrilldownView => ({
    type: 'win-streak', title: `${name}'s Win Streak`, games: getWinStreakGames(pid), focalPlayerId: pid,
  })

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <div className="p-4 safe-top">
        <div className="flex items-center gap-3 mb-1">
          {onNavigateHome && (
            <button onClick={onNavigateHome} className="text-[#8b6914] p-1 -ml-1">
              <ArrowLeft size={22} />
            </button>
          )}
          <h2 className="font-heading text-2xl font-semibold text-warm-text">Stats & Records</h2>
        </div>

        {/* Date filter */}
        <div className="mt-3 flex flex-wrap gap-1.5 items-center">
          {(['all', 'month', '30d', '3m', 'custom'] as DateFilter[]).map((f) => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                ${dateFilter === f ? 'bg-[#efe9dd] text-[#8b6914] font-semibold' : 'text-warm-muted hover:text-warm-text'}`}>
              {f === 'all' ? 'All Time' : f === 'month' ? 'This Month' : f === '30d' ? '30 Days' : f === '3m' ? '3 Months' : 'Custom'}
            </button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="flex gap-2 mt-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="flex-1 bg-white border border-sand-light rounded-lg px-2 py-1.5 text-warm-text text-xs focus:outline-none focus:border-[#8b6914]" />
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="flex-1 bg-white border border-sand-light rounded-lg px-2 py-1.5 text-warm-text text-xs focus:outline-none focus:border-[#8b6914]" />
          </div>
        )}
        {filterLabel && (
          <p className="text-[#8b7355] text-xs mt-1">
            Showing: {filterLabel} ({filteredGames.length} game{filteredGames.length !== 1 ? 's' : ''})
          </p>
        )}

        {/* Game type filter */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-warm-muted text-xs">Type:</span>
          {([['all', 'All'], ['manual', 'Tracker'], ['played', 'Played']] as [GameTypeFilter, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setGameTypeFilter(val)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                ${gameTypeFilter === val ? 'bg-[#efe9dd] text-[#8b6914] font-semibold' : 'text-warm-muted hover:text-warm-text'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-3 bg-[#efe9dd] rounded-xl p-1">
          {(['leaderboard', 'records', 'achievements'] as const).map((tab) => (
            <button key={tab} onClick={() => setView(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors
                ${view === tab ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'}`}>
              {tab === 'leaderboard' ? 'Leaderboard' : tab === 'records' ? 'Records' : 'Achievements'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pb-8 overflow-auto">
        {loading ? (
          <SkeletonStats />
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
                      ${minGames === n ? 'bg-[#efe9dd] text-[#8b6914] font-semibold' : 'text-warm-muted hover:text-warm-text'}`}>
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
                          className="text-warm-text font-medium text-sm leading-tight truncate block w-full" />
                        <div className="font-mono font-bold mt-1">
                          <DS onClick={() => pushDrilldown(winsGamesList(s.player.id, s.player.name))} className="font-mono font-bold" style={{ color }}>{s.wins}W</DS>
                        </div>
                        <div className="text-[#8b7355] text-xs">avg <DS onClick={() => pushDrilldown(scoreHistoryDrill(s.player.id, s.player.name))} className="text-[#8b7355] text-xs">{s.avg_score}</DS></div>
                        <div className="text-warm-muted text-xs"><DS onClick={() => pushDrilldown(allGamesList(s.player.id, s.player.name))} className="text-warm-muted text-xs">{s.games_played}g</DS></div>
                      </div>
                      <div className={`w-full ${podiumPlatformH[rankIdx]} rounded-b-lg flex items-center justify-center`}
                        style={{ background: `${color}18` }}>
                        <span className="font-heading font-bold text-lg" style={{ color }}>#{rankIdx + 1}</span>
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
                    <tr className="border-b border-sand-light">
                      {['#', 'Player', 'G', 'W', 'Avg', 'Best', '0s'].map((h) => (
                        <th key={h} className="px-2 py-2 text-warm-muted text-xs font-medium text-center first:text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((s, i) => (
                      <tr key={s.player.id} className={`border-b border-sand-light/50 ${i % 2 !== 0 ? 'bg-[#efe9dd]/40' : ''}`}>
                        <td className="px-2 py-2 text-warm-muted text-xs">{i + 4}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: playerColor(s.player.id) }} />
                            <PlayerName id={s.player.id} name={s.player.name} className="text-warm-text truncate max-w-[80px] text-sm" />
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[#8b7355] text-xs">
                          <DS onClick={() => pushDrilldown(allGamesList(s.player.id, s.player.name))} className="font-mono text-[#8b7355] text-xs">{s.games_played}</DS>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[#8b6914] text-xs font-semibold">
                          <DS onClick={() => pushDrilldown(winsGamesList(s.player.id, s.player.name))} className="font-mono text-[#8b6914] text-xs font-semibold">{s.wins}</DS>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-warm-text text-xs">
                          <DS onClick={() => pushDrilldown(scoreHistoryDrill(s.player.id, s.player.name))} className="font-mono text-warm-text text-xs">{s.avg_score}</DS>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[#2d7a3a] text-xs">
                          <DS onClick={() => { const v = bestGameDrill(s.player.id, s.best_game); if (v) pushDrilldown(v) }} className="font-mono text-[#2d7a3a] text-xs">{s.best_game}</DS>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[#7c3aed] text-xs">
                          {s.zero_rounds > 0
                            ? <DS onClick={() => pushDrilldown(zeroRoundsDrill(s.player.id, s.player.name))} className="font-mono text-[#7c3aed] text-xs">{s.zero_rounds}</DS>
                            : s.zero_rounds}
                        </td>
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
                  {alsoPlayedOpen ? <ChevronUp size={16} className="text-warm-muted" /> : <ChevronDown size={16} className="text-warm-muted" />}
                </button>
                {alsoPlayedOpen && (
                  <div className="border-t border-sand-light">
                    {alsoPlayed.map((s, i) => (
                      <div key={s.player.id} className={`flex items-center justify-between px-3 py-2 ${i % 2 !== 0 ? 'bg-[#efe9dd]/40' : ''}`}>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: playerColor(s.player.id) }} />
                          <PlayerName id={s.player.id} name={s.player.name} className="text-warm-text text-sm" />
                        </div>
                        <span className="text-[#8b7355] text-xs font-mono">{s.games_played}g · avg {s.avg_score}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        ) : view === 'records' ? (
          /* Records */
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-warm-muted text-xs uppercase tracking-wider mb-2">Champions</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: <Trophy size={18} className="text-[#8b6914]" />, label: 'Most Wins', id: mostWins?.player.id, name: mostWins?.player.name, value: `${mostWins?.wins} wins`, accent: '#8b6914',
                    onDrill: mostWins ? () => pushDrilldown(winsGamesList(mostWins.player.id, mostWins.player.name)) : undefined },
                  { icon: <TrendingDown size={18} className="text-[#1d7ea8]" />, label: 'Lowest Average', id: lowestAvg?.player.id, name: lowestAvg?.player.name, value: lowestAvg ? `${lowestAvg.avg_score} avg` : 'Need 2+ games', accent: '#1d7ea8',
                    onDrill: lowestAvg ? () => pushDrilldown(scoreHistoryDrill(lowestAvg.player.id, lowestAvg.player.name)) : undefined },
                  { icon: <Star size={18} className="text-[#2d7a3a]" />, label: 'Best Single Game', id: bestSingle?.player.id, name: bestSingle?.player.name, value: bestSingle ? `${bestSingle.best_game} pts` : '—', accent: '#2d7a3a', glow: bestSingle?.best_game === 0,
                    onDrill: bestSingle ? () => { const v = bestGameDrill(bestSingle.player.id, bestSingle.best_game); if (v) pushDrilldown(v) } : undefined },
                  { icon: <Zap size={18} className="text-[#7c3aed]" />, label: 'Most Zeros', id: mostZeros?.player.id, name: mostZeros?.player.name, value: `${mostZeros?.zero_rounds ?? 0} rounds`, accent: '#7c3aed',
                    onDrill: mostZeros?.zero_rounds ? () => pushDrilldown(zeroRoundsDrill(mostZeros.player.id, mostZeros.player.name)) : undefined },
                  { icon: <Calendar size={18} className="text-[#2d7a3a]" />, label: 'Most Games Played', id: mostGamesPlayed?.player.id, name: mostGamesPlayed?.player.name, value: `${mostGamesPlayed?.games_played ?? 0} games`, accent: '#2d7a3a',
                    onDrill: mostGamesPlayed ? () => pushDrilldown(allGamesList(mostGamesPlayed.player.id, mostGamesPlayed.player.name)) : undefined },
                  { icon: <Award size={18} className="text-[#8b6914]" />, label: 'Longest Win Streak', id: longestStreak?.s.player.id, name: longestStreak?.s.player.name, value: longestStreak ? `${longestStreak.streak} in a row` : '—', accent: '#8b6914',
                    onDrill: longestStreak?.streak ? () => pushDrilldown(winStreakDrill(longestStreak.s.player.id, longestStreak.s.player.name)) : undefined },
                  mostImproved ? { icon: <TrendingUp size={18} className="text-[#2d7a3a]" />, label: 'Most Improved', id: mostImproved.s.player.id, name: mostImproved.s.player.name, value: `${mostImproved.imp!.first3avg} → ${mostImproved.imp!.last3avg}`, accent: '#2d7a3a',
                    onDrill: () => pushDrilldown({ type: 'improvement', title: `${mostImproved.s.player.name} — Improvement`, focalPlayerId: mostImproved.s.player.id, playerColor: playerColor(mostImproved.s.player.id), firstGames: mostImproved.imp!.firstGames, lastGames: mostImproved.imp!.lastGames, firstAvg: mostImproved.imp!.first3avg, lastAvg: mostImproved.imp!.last3avg }) } : null,
                ].filter(Boolean).map((rec) => {
                  const r = rec!
                  return (
                    <div key={r.label}
                      className={`card p-3 flex items-center gap-3 ${r.glow ? 'ring-1 ring-[#2d7a3a]/30' : ''}`}>
                      <div className="w-9 h-9 bg-[#efe9dd] rounded-lg flex items-center justify-center flex-shrink-0">{r.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-warm-muted text-xs uppercase tracking-wider">{r.label}</div>
                        {r.id
                          ? <PlayerName id={r.id} name={r.name ?? '—'} className="text-warm-text font-medium text-sm truncate block" />
                          : <div className="text-warm-text font-medium text-sm">—</div>}
                      </div>
                      <div className="font-mono text-xs font-semibold flex-shrink-0" style={{ color: r.accent }}>
                        {r.onDrill
                          ? <DS onClick={r.onDrill} className="font-mono text-xs font-semibold" style={{ color: r.accent } as React.CSSProperties}>{r.value}</DS>
                          : r.value}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Achievements */
          <div style={{ padding: '12px 0' }}>
            {(['beginner', 'skill', 'mastery', 'social'] as const).map(category => (
              <div key={category} style={{ marginBottom: 16 }}>
                <h4 style={{ color: '#8b7355', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{getCategoryIcon(category)}</span> {category}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ACHIEVEMENTS.filter(a => a.category === category).map(a => (
                    <div key={a.id} style={{
                      background: '#ffffff',
                      border: '1px solid #e2ddd2',
                      borderRadius: 10,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <span style={{ fontSize: 24 }}>{a.icon}</span>
                      <div>
                        <div style={{ color: '#2c1810', fontSize: 13, fontWeight: 600 }}>{a.name}</div>
                        <div style={{ color: '#8b7355', fontSize: 11 }}>{a.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {drilldownStack.length > 0 && (
        <DrilldownModal
          stack={drilldownStack}
          onPush={pushDrilldown}
          onPop={popDrilldown}
          onClose={closeDrilldowns}
          onPlayerClick={onPlayerClick}
        />
      )}
    </div>
  )
}
