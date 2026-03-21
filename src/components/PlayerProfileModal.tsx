import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { getCompletedGames, computeWinner } from '../lib/gameStore'
import { PLAYER_COLORS } from '../lib/constants'
import type { GameWithScores, Player, DrilldownView } from '../lib/types'
import { format } from 'date-fns'
import DrilldownModal from './DrilldownModal'

interface Props {
  playerId: string
  onClose: () => void
}

export default function PlayerProfileModal({ playerId, onClose }: Props) {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(false)
  const [drilldownStack, setDrilldownStack] = useState<DrilldownView[]>([])
  const pushDrilldown = (v: DrilldownView) => setDrilldownStack((s) => [...s, v])
  const popDrilldown = () => setDrilldownStack((s) => s.slice(0, -1))
  const closeDrilldowns = () => setDrilldownStack([])

  useEffect(() => {
    getCompletedGames().then((g) => { setGames(g); setLoading(false) })
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 280)
  }

  // Player info
  const playerMap = new Map<string, Player>()
  games.forEach((g) => g.game_scores.forEach((gs) => { if (gs.player) playerMap.set(gs.player_id, gs.player) }))
  const players = Array.from(playerMap.values())
  const player = playerMap.get(playerId)
  const colorIdx = players.findIndex((p) => p.id === playerId)
  const playerColor = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length] ?? '#8b6914'

  // Games this player participated in, sorted newest first
  const playerGames = games.filter((g) => g.game_scores.some((gs) => gs.player_id === playerId))
  const playerGamesAsc = [...playerGames].sort((a, b) => a.date.localeCompare(b.date))

  const getScore = (g: GameWithScores) => g.game_scores.find((gs) => gs.player_id === playerId)?.total_score ?? 0
  const getRank = (g: GameWithScores) => {
    const sorted = [...g.game_scores].sort((a, b) => a.total_score - b.total_score)
    return sorted.findIndex((gs) => gs.player_id === playerId) + 1
  }
  const isWinner = (g: GameWithScores) => computeWinner(g.game_scores)?.player_id === playerId

  // Core stats
  const gamesPlayed = playerGames.length
  const wins = playerGames.filter((g) => isWinner(g)).length
  const allScores = playerGames.map((g) => getScore(g))
  const avgScore = gamesPlayed ? Math.round(allScores.reduce((a, b) => a + b, 0) / gamesPlayed) : 0
  const bestGame = gamesPlayed ? Math.min(...allScores) : 0
  const winRate = gamesPlayed ? Math.round((wins / gamesPlayed) * 100) : 0

  // Recent form — last 5 games
  const last5 = playerGamesAsc.slice(-5)
  const last5Scores = last5.map((g) => getScore(g))
  const last5Avg = last5.length ? Math.round(last5Scores.reduce((a, b) => a + b, 0) / last5.length) : 0
  const recentTrend = last5.map((g, i) => ({ i, score: getScore(g) }))
  const recentBetter = last5Avg < avgScore

  // Personal records
  const bestGameObj = playerGamesAsc.reduce<GameWithScores | null>((best, g) => (!best || getScore(g) < getScore(best) ? g : best), null)
  const worstGameObj = playerGamesAsc.reduce<GameWithScores | null>((worst, g) => (!worst || getScore(g) > getScore(worst) ? g : worst), null)
  const maxZerosInGame = Math.max(0, ...playerGames.map((g) => {
    const gs = g.game_scores.find((s) => s.player_id === playerId)
    return gs ? gs.round_scores.filter((s) => s === 0).length : 0
  }))
  const winStreakGames = (() => {
    let maxGames: GameWithScores[] = [], curGames: GameWithScores[] = []
    for (const g of playerGamesAsc) {
      if (isWinner(g)) { curGames.push(g); if (curGames.length > maxGames.length) maxGames = [...curGames] }
      else { curGames = [] }
    }
    return maxGames
  })()
  const winStreak = winStreakGames.length

  // H2H — top 3 opponents by games together
  const opMap: Record<string, { name: string; games: number; ourWins: number }> = {}
  playerGames.forEach((g) => {
    g.game_scores.forEach((gs) => {
      if (gs.player_id === playerId || !gs.player) return
      if (!opMap[gs.player_id]) opMap[gs.player_id] = { name: gs.player.name, games: 0, ourWins: 0 }
      opMap[gs.player_id].games++
      if (isWinner(g)) opMap[gs.player_id].ourWins++
    })
  })
  const top3Opponents = Object.values(opMap).sort((a, b) => b.games - a.games).slice(0, 3)

  const fmtDate = (d: string) => { try { return format(new Date(d + 'T12:00:00'), 'MMM d, yy') } catch { return d } }
  const fmtDateLong = (d: string) => { try { return format(new Date(d + 'T12:00:00'), 'MMM d, yyyy') } catch { return d } }
  const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][n - 1] ?? `${n}th`

  const DS = ({ onClick, children, className = '', style }: { onClick: () => void; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity ${className}`}
      style={style}
    >
      {children}
    </button>
  )

  const allPlayerGamesList = (): DrilldownView => ({
    type: 'game-list', title: `${player?.name ?? ''}'s Games`, games: playerGames, focalPlayerId: playerId,
  })
  const winsGamesList = (): DrilldownView => ({
    type: 'game-list', title: `${player?.name ?? ''}'s Wins`,
    games: playerGames.filter((g) => isWinner(g)), focalPlayerId: playerId,
  })
  const scoreHistoryDrill = (): DrilldownView => ({
    type: 'score-history', title: `${player?.name ?? ''} — Score History`,
    games: playerGamesAsc, focalPlayerId: playerId, playerColor,
  })
  const zerosDrill = (): DrilldownView => ({
    type: 'zero-rounds', title: `${player?.name ?? ''}'s Zero Rounds`,
    games: playerGames.filter((g) => g.game_scores.some((gs) => gs.player_id === playerId && gs.round_scores.some((s) => s === 0))),
    focalPlayerId: playerId,
  })

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${visible ? 'opacity-50' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        className={`relative max-w-[480px] w-full mx-auto bg-white rounded-t-2xl max-h-[88dvh] flex flex-col
                    transform transition-transform duration-300 ease-out ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ boxShadow: '0 -4px 24px rgba(0,0,0,0.12)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-[#e2ddd2] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0 border-b border-[#e2ddd2]">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: playerColor }} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-xl font-semibold text-[#2c1810] truncate">{player?.name ?? '…'}</div>
            <div className="text-[#8b7355] text-sm">{gamesPlayed} games played</div>
          </div>
          <button onClick={handleClose} className="text-[#a08c6e] hover:text-[#2c1810] p-1 flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {loading ? (
            <div className="text-center text-[#8b7355] py-12">Loading…</div>
          ) : gamesPlayed === 0 ? (
            <div className="text-center text-[#8b7355] py-12">No completed games found</div>
          ) : (
            <div className="flex flex-col gap-4 pt-4">
              {/* Key stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Wins', value: wins, color: '#8b6914', onDrill: () => pushDrilldown(winsGamesList()) },
                  { label: 'Avg', value: avgScore, color: '#2c1810', onDrill: () => pushDrilldown(scoreHistoryDrill()) },
                  { label: 'Best', value: bestGame, color: '#2d7a3a', onDrill: bestGameObj ? () => pushDrilldown({ type: 'game-scorecard', title: fmtDateLong(bestGameObj.date), game: bestGameObj, highlightPlayerId: playerId }) : undefined },
                  { label: 'Win %', value: `${winRate}%`, color: '#7c3aed', onDrill: () => pushDrilldown(allPlayerGamesList()) },
                ].map(({ label, value, color, onDrill }) => (
                  <div key={label} className="bg-[#efe9dd] rounded-xl p-3 text-center">
                    <div className="font-mono font-bold text-lg" style={{ color }}>
                      {onDrill ? <DS onClick={onDrill} style={{ color }} className="font-mono font-bold text-lg">{value}</DS> : value}
                    </div>
                    <div className="text-[#8b7355] text-xs mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {/* Recent form */}
              {last5.length > 0 && (
                <div className="card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[#8b7355] text-xs uppercase tracking-wider">Last {last5.length} Games</p>
                    <span className={`text-xs font-semibold font-mono ${recentBetter ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
                      avg {last5Avg} {recentBetter ? '↓ better' : '↑ worse'}
                    </span>
                  </div>
                  {last5.length >= 2 && (
                    <div style={{ height: 56 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={recentTrend}>
                          <Line type="monotone" dataKey="score" stroke={playerColor} strokeWidth={2} dot={{ r: 3, fill: playerColor }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    {last5Scores.map((s, i) => (
                      <div key={i} className="flex-1 text-center">
                        <div className="font-mono text-sm font-semibold" style={{ color: playerColor }}>{s}</div>
                        <div className="text-[#a08c6e] text-[10px]">{fmtDate(last5[i].date)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Personal records */}
              <div className="card p-3">
                <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-3">Personal Records</p>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#8b7355]">Best game</span>
                    <DS onClick={() => bestGameObj && pushDrilldown({ type: 'game-scorecard', title: fmtDateLong(bestGameObj.date), game: bestGameObj, highlightPlayerId: playerId })}
                      className="font-mono text-[#2d7a3a] font-semibold">
                      {bestGame} pts {bestGameObj ? `· ${fmtDate(bestGameObj.date)}` : ''}
                    </DS>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b7355]">Worst game</span>
                    {worstGameObj
                      ? <DS onClick={() => pushDrilldown({ type: 'game-scorecard', title: fmtDateLong(worstGameObj.date), game: worstGameObj, highlightPlayerId: playerId })}
                          className="font-mono text-[#b83232] font-semibold">
                          {getScore(worstGameObj)} pts · {fmtDate(worstGameObj.date)}
                        </DS>
                      : <span className="font-mono text-[#b83232] font-semibold">—</span>}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b7355]">Most zeros in a game</span>
                    {maxZerosInGame > 0
                      ? <DS onClick={() => pushDrilldown(zerosDrill())} className="font-mono text-[#7c3aed] font-semibold">{maxZerosInGame}</DS>
                      : <span className="font-mono text-[#7c3aed] font-semibold">{maxZerosInGame}</span>}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b7355]">Longest win streak</span>
                    {winStreak > 0
                      ? <DS onClick={() => pushDrilldown({ type: 'win-streak', title: `${player?.name ?? ''}'s Win Streak`, games: winStreakGames, focalPlayerId: playerId })}
                          className="font-mono text-[#8b6914] font-semibold">{winStreak} in a row</DS>
                      : <span className="font-mono text-[#8b6914] font-semibold">{winStreak} in a row</span>}
                  </div>
                </div>
              </div>

              {/* Head to head */}
              {top3Opponents.length > 0 && (
                <div className="card p-3">
                  <p className="text-[#8b7355] text-xs uppercase tracking-wider mb-3">Most Played With</p>
                  <div className="flex flex-col gap-2">
                    {top3Opponents.map((op) => (
                      <div key={op.name} className="flex items-center justify-between">
                        <span className="text-[#2c1810] text-sm">{op.name}</span>
                        <div className="flex items-center gap-3 text-xs font-mono text-right">
                          <span className="text-[#8b7355]">{op.games}g together</span>
                          <span className="text-[#8b6914] font-semibold">{op.ourWins}W</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Game log */}
              <div className="card overflow-hidden">
                <div className="px-3 py-2 border-b border-[#e2ddd2]">
                  <p className="text-[#8b7355] text-xs uppercase tracking-wider">Game Log</p>
                </div>
                {playerGames.map((g, i) => {
                  const score = getScore(g)
                  const rank = getRank(g)
                  const won = isWinner(g)
                  return (
                    <button
                      key={g.id}
                      onClick={() => pushDrilldown({ type: 'game-scorecard', title: fmtDateLong(g.date), game: g, highlightPlayerId: playerId })}
                      className={`flex items-center justify-between w-full px-3 py-2.5 text-sm text-left active:opacity-70 ${i > 0 ? 'border-t border-[#e2ddd2]/40' : ''} ${i % 2 !== 0 ? 'bg-[#efe9dd]/40' : ''}`}
                    >
                      <div>
                        <div className="text-[#2c1810] font-medium text-sm">{fmtDate(g.date)}</div>
                        <div className="text-[#a08c6e] text-xs">{g.game_scores.length} players</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-semibold ${won ? 'text-[#8b6914]' : 'text-[#2c1810]'}`}>{score} pts</div>
                        <div className="text-[#a08c6e] text-xs">{ordinal(rank)}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {drilldownStack.length > 0 && (
        <DrilldownModal
          stack={drilldownStack}
          onPush={pushDrilldown}
          onPop={popDrilldown}
          onClose={closeDrilldowns}
        />
      )}
    </div>
  )
}
