import { useState, useEffect } from 'react'
import { X, ArrowLeft, Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { computeWinner } from '../lib/gameStore'
import type { DrilldownView, GameWithScores } from '../lib/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (d: string) => { try { return format(new Date(d + 'T12:00:00'), 'MMM d, yyyy') } catch { return d } }
const fmtShort = (d: string) => { try { return format(new Date(d + 'T12:00:00'), 'M/d') } catch { return d } }
const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][n - 1] ?? `${n}th`

// ─── Sub-view: Game List ──────────────────────────────────────────────────────
function GameListView({ games, focalPlayerId, onPush, onPlayerClick: _onPlayerClick }: {
  games: GameWithScores[]
  focalPlayerId?: string
  onPush: (v: DrilldownView) => void
  onPlayerClick?: (id: string) => void
}) {
  const sorted = [...games].sort((a, b) => b.date.localeCompare(a.date))
  if (sorted.length === 0) return <p className="text-[#8b7355] text-sm text-center py-8">No games found</p>
  return (
    <div className="flex flex-col">
      {sorted.map((g, i) => {
        const gs = focalPlayerId ? g.game_scores.find(s => s.player_id === focalPlayerId) : null
        const winner = computeWinner(g.game_scores)
        const isWin = focalPlayerId ? winner?.player_id === focalPlayerId : false
        const sortedForRank = [...g.game_scores].sort((a, b) => a.total_score - b.total_score)
        const rank = gs ? sortedForRank.findIndex(s => s.player_id === focalPlayerId) + 1 : null
        return (
          <button
            key={g.id}
            onClick={() => onPush({ type: 'game-scorecard', title: fmtDate(g.date), game: g, highlightPlayerId: focalPlayerId })}
            className={`flex items-center justify-between py-3 text-left w-full ${i > 0 ? 'border-t border-sand-light/60' : ''} ${i % 2 !== 0 ? '-mx-4 px-4 bg-[#efe9dd]/30' : ''}`}
          >
            <div>
              <div className={`font-medium text-sm ${isWin ? 'text-[#8b6914]' : 'text-warm-text'}`}>
                {fmtDate(g.date)}{isWin && ' 🏆'}
              </div>
              <div className="flex items-center gap-1.5 text-warm-muted text-xs mt-0.5 flex-wrap">
                <span>{g.game_scores.length} players</span>
                {g.game_type === 'ai' && <span className="bg-[#e2b858] text-warm-text px-1 py-0.5 rounded text-[9px] font-semibold">vs AI</span>}
                {g.game_type === 'pass-and-play' && <span className="bg-[#efe9dd] text-[#8b7355] px-1 py-0.5 rounded text-[9px]">Played</span>}
                {winner && focalPlayerId && !isWin && <span>· {winner.player?.name} won</span>}
                {!focalPlayerId && winner && <span>· {winner.player?.name} won</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-3">
              {gs && <div className="font-mono font-semibold text-sm text-warm-text">{gs.total_score} pts</div>}
              {rank !== null && rank > 0 && <div className="text-warm-muted text-xs">{ordinal(rank)}</div>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Sub-view: Game Scorecard ─────────────────────────────────────────────────
function GameScorecardView({ game, highlightPlayerId, onPush: _onPush, onPlayerClick }: {
  game: GameWithScores
  highlightPlayerId?: string
  onPush: (v: DrilldownView) => void
  onPlayerClick?: (id: string) => void
}) {
  const sortedScores = [...game.game_scores].sort((a, b) => a.total_score - b.total_score)
  const winner = computeWinner(game.game_scores)
  return (
    <div>
      <div className="text-center mb-4">
        <div className="text-[#8b7355] text-sm">{fmtDate(game.date)}</div>
        <div className="text-warm-muted text-xs mt-0.5">{game.game_scores.length} players{game.room_code && ` · ${game.room_code}`}</div>
        {game.notes && <div className="text-[#8b7355] text-sm mt-1 italic">"{game.notes}"</div>}
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm min-w-[340px]">
          <thead>
            <tr className="border-b border-sand-light">
              <th className="text-left py-2 text-warm-muted text-xs font-medium">Player</th>
              {ROUNDS.map(r => (
                <th key={r.number} className="py-2 text-warm-muted text-xs font-medium text-center px-1">R{r.number}</th>
              ))}
              <th className="text-right py-2 text-warm-muted text-xs font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedScores.map((gs, rank) => {
              const color = PLAYER_COLORS[game.game_scores.findIndex(s => s.player_id === gs.player_id) % PLAYER_COLORS.length]
              const isWinner = gs.player_id === winner?.player_id
              const isHighlighted = gs.player_id === highlightPlayerId
              return (
                <tr key={gs.id} className={`border-b border-sand-light/50 ${isHighlighted ? 'bg-[#e2b858]/08' : rank % 2 !== 0 ? 'bg-[#efe9dd]/30' : ''}`}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <button
                        onClick={() => onPlayerClick?.(gs.player_id)}
                        className={`text-left text-sm ${isWinner ? 'text-[#8b6914] font-semibold' : 'text-warm-text'} ${onPlayerClick ? 'hover:underline' : ''}`}
                      >
                        {gs.player?.name}
                      </button>
                      {isWinner && <Trophy size={11} className="text-[#8b6914]" />}
                    </div>
                  </td>
                  {ROUNDS.map((_, i) => {
                    const score = gs.round_scores[i] ?? 0
                    return (
                      <td key={i} className="py-2.5 text-center px-1">
                        <span className={`font-mono text-xs ${score === 0 ? 'text-[#2d7a3a] font-semibold' : 'text-[#8b7355]'}`}>
                          {score === 0 ? '✓' : score}
                        </span>
                      </td>
                    )
                  })}
                  <td className="py-2.5 text-right">
                    <span className={`font-mono font-semibold text-sm ${isWinner ? 'text-[#8b6914]' : 'text-warm-text'}`}>{gs.total_score}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sub-view: Score History ──────────────────────────────────────────────────
function ScoreHistoryView({ games, focalPlayerId, playerColor, onPush }: {
  games: GameWithScores[]
  focalPlayerId: string
  playerColor: string
  onPush: (v: DrilldownView) => void
}) {
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date))
  const scores = sorted.map(g => ({
    game: g,
    score: g.game_scores.find(gs => gs.player_id === focalPlayerId)?.total_score ?? 0,
  }))
  const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length) : 0
  const maxScore = Math.max(...scores.map(s => s.score), avg, 1)
  const avgPct = Math.round((avg / maxScore) * 100)

  return (
    <div>
      <div className="text-center mb-4">
        <div className="text-warm-muted text-xs uppercase tracking-wider">Average Score</div>
        <div className="font-mono text-2xl font-bold text-[#8b6914]">{avg}</div>
        <div className="text-warm-muted text-xs">{scores.length} game{scores.length !== 1 ? 's' : ''} · lower is better</div>
      </div>
      <div className="flex flex-col gap-1.5">
        {scores.map(({ game, score }, _i) => {
          const pct = Math.round((score / maxScore) * 100)
          const isBetter = score <= avg
          return (
            <button
              key={game.id}
              onClick={() => onPush({ type: 'game-scorecard', title: fmtDate(game.date), game, highlightPlayerId: focalPlayerId })}
              className="flex items-center gap-2 py-1 text-left w-full group"
            >
              <span className="w-12 text-warm-muted text-xs flex-shrink-0 text-right">{fmtShort(game.date)}</span>
              <div className="flex-1 relative h-5 flex items-center">
                <div
                  className="h-4 rounded-sm transition-all"
                  style={{ width: `${pct}%`, background: isBetter ? '#2d7a3a' : playerColor, opacity: 0.65 }}
                />
                <div className="absolute inset-y-0 w-px bg-[#b83232] opacity-50" style={{ left: `${avgPct}%` }} />
              </div>
              <span className={`w-9 text-right font-mono text-sm font-semibold flex-shrink-0 ${isBetter ? 'text-[#2d7a3a]' : 'text-[#8b6914]'}`}>{score}</span>
            </button>
          )
        })}
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-sand-light text-xs text-warm-muted">
          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: '#2d7a3a', opacity: 0.65 }} />
          <span>Below avg (good)</span>
          <div className="w-px h-3 bg-[#b83232] opacity-50 flex-shrink-0 ml-2" />
          <span>Avg ({avg})</span>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-view: Zero Rounds ────────────────────────────────────────────────────
function ZeroRoundsView({ games, focalPlayerId }: {
  games: GameWithScores[]
  focalPlayerId: string
}) {
  const groups = games
    .map(g => {
      const gs = g.game_scores.find(s => s.player_id === focalPlayerId)
      if (!gs) return null
      const zeroRounds = gs.round_scores.map((s, i) => s === 0 ? i + 1 : null).filter(Boolean) as number[]
      return zeroRounds.length > 0 ? { game: g, zeroRounds } : null
    })
    .filter(Boolean)
    .sort((a, b) => b!.game.date.localeCompare(a!.game.date)) as { game: GameWithScores; zeroRounds: number[] }[]

  const total = groups.reduce((sum, g) => sum + g.zeroRounds.length, 0)

  return (
    <div>
      <div className="text-center mb-4">
        <div className="font-mono text-2xl font-bold text-[#7c3aed]">{total}</div>
        <div className="text-warm-muted text-xs">total zero rounds (went out)</div>
      </div>
      {groups.length === 0 ? (
        <p className="text-[#8b7355] text-sm text-center py-8">No zeros recorded</p>
      ) : (
        <div className="flex flex-col">
          {groups.map(({ game, zeroRounds }, i) => (
            <div key={game.id} className={`flex items-center justify-between py-3 ${i > 0 ? 'border-t border-sand-light/60' : ''}`}>
              <div>
                <div className="text-warm-text text-sm font-medium">{fmtDate(game.date)}</div>
                <div className="text-warm-muted text-xs mt-0.5">{game.game_scores.length} players</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[#7c3aed] font-semibold text-sm">
                  {zeroRounds.length} zero{zeroRounds.length !== 1 ? 's' : ''}
                </div>
                <div className="text-warm-muted text-xs">
                  Round{zeroRounds.length !== 1 ? 's' : ''} {zeroRounds.join(', ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sub-view: Win Streak ─────────────────────────────────────────────────────
function WinStreakView({ games, focalPlayerId, onPush }: {
  games: GameWithScores[]
  focalPlayerId: string
  onPush: (v: DrilldownView) => void
}) {
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date))
  return (
    <div>
      <div className="text-center mb-4">
        <div className="font-mono text-2xl font-bold text-[#8b6914]">{sorted.length}</div>
        <div className="text-warm-muted text-xs">consecutive wins</div>
      </div>
      <div className="flex flex-col">
        {sorted.map((g, i) => {
          const winnerGs = g.game_scores.find(s => s.player_id === focalPlayerId)
          const runnerUp = [...g.game_scores].sort((a, b) => a.total_score - b.total_score)[1]
          return (
            <button
              key={g.id}
              onClick={() => onPush({ type: 'game-scorecard', title: fmtDate(g.date), game: g, highlightPlayerId: focalPlayerId })}
              className={`flex items-center justify-between py-3 text-left w-full ${i > 0 ? 'border-t border-sand-light/60' : ''}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-warm-muted text-xs w-5 flex-shrink-0">#{i + 1}</span>
                  <span className="text-warm-text text-sm font-medium">{fmtDate(g.date)}</span>
                </div>
                {runnerUp && (
                  <div className="text-warm-muted text-xs mt-0.5 pl-7">
                    beat {runnerUp.player?.name} ({runnerUp.total_score} pts)
                  </div>
                )}
              </div>
              <div className="font-mono font-bold text-[#8b6914] text-sm flex-shrink-0 ml-3">
                {winnerGs?.total_score} pts 🏆
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sub-view: Improvement ────────────────────────────────────────────────────
function ImprovementView({ firstGames, lastGames, focalPlayerId, playerColor: _playerColor, onPush }: {
  firstGames: GameWithScores[]
  lastGames: GameWithScores[]
  focalPlayerId: string
  playerColor: string
  onPush: (v: DrilldownView) => void
}) {
  const getScore = (g: GameWithScores) => g.game_scores.find(s => s.player_id === focalPlayerId)?.total_score ?? 0
  const first = [...firstGames].sort((a, b) => a.date.localeCompare(b.date))
  const last = [...lastGames].sort((a, b) => a.date.localeCompare(b.date))
  const firstAvg = first.length ? Math.round(first.reduce((s, g) => s + getScore(g), 0) / first.length) : 0
  const lastAvg = last.length ? Math.round(last.reduce((s, g) => s + getScore(g), 0) / last.length) : 0
  const improved = firstAvg > lastAvg

  return (
    <div>
      <div className="flex items-center justify-center gap-6 mb-5">
        <div className="text-center">
          <div className="font-mono text-xl font-bold text-[#8b7355]">{firstAvg}</div>
          <div className="text-warm-muted text-xs">First {first.length} avg</div>
        </div>
        <div className={`font-mono text-2xl font-bold ${improved ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
          {improved ? '↓' : '↑'} {Math.abs(firstAvg - lastAvg)}
        </div>
        <div className="text-center">
          <div className={`font-mono text-xl font-bold ${improved ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>{lastAvg}</div>
          <div className="text-warm-muted text-xs">Last {last.length} avg</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-warm-muted text-xs uppercase tracking-wider mb-2 text-center">First {first.length}</p>
          {first.map(g => (
            <button
              key={g.id}
              onClick={() => onPush({ type: 'game-scorecard', title: fmtDate(g.date), game: g, highlightPlayerId: focalPlayerId })}
              className="flex justify-between w-full py-1.5 border-b border-sand-light/40 text-left"
            >
              <span className="text-warm-muted text-xs">{fmtShort(g.date)}</span>
              <span className="font-mono text-sm text-[#8b7355]">{getScore(g)}</span>
            </button>
          ))}
        </div>
        <div>
          <p className={`text-xs uppercase tracking-wider mb-2 text-center ${improved ? 'text-[#2d7a3a]' : 'text-warm-muted'}`}>
            Last {last.length}
          </p>
          {last.map(g => (
            <button
              key={g.id}
              onClick={() => onPush({ type: 'game-scorecard', title: fmtDate(g.date), game: g, highlightPlayerId: focalPlayerId })}
              className="flex justify-between w-full py-1.5 border-b border-sand-light/40 text-left"
            >
              <span className="text-warm-muted text-xs">{fmtShort(g.date)}</span>
              <span className={`font-mono text-sm font-semibold ${improved ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>{getScore(g)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  stack: DrilldownView[]
  onPush: (v: DrilldownView) => void
  onPop: () => void
  onClose: () => void
  onPlayerClick?: (id: string) => void
}

export default function DrilldownModal({ stack, onPush, onPop, onClose, onPlayerClick }: Props) {
  const [visible, setVisible] = useState(false)
  const current = stack[stack.length - 1]

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 280)
  }

  if (!current) return null

  const renderContent = () => {
    switch (current.type) {
      case 'game-list':
        return <GameListView games={current.games} focalPlayerId={current.focalPlayerId} onPush={onPush} onPlayerClick={onPlayerClick} />
      case 'game-scorecard':
        return <GameScorecardView game={current.game} highlightPlayerId={current.highlightPlayerId} onPush={onPush} onPlayerClick={onPlayerClick} />
      case 'score-history':
        return <ScoreHistoryView games={current.games} focalPlayerId={current.focalPlayerId} playerColor={current.playerColor} onPush={onPush} />
      case 'zero-rounds':
        return <ZeroRoundsView games={current.games} focalPlayerId={current.focalPlayerId} />
      case 'win-streak':
        return <WinStreakView games={current.games} focalPlayerId={current.focalPlayerId} onPush={onPush} />
      case 'improvement':
        return <ImprovementView firstGames={current.firstGames} lastGames={current.lastGames} focalPlayerId={current.focalPlayerId} playerColor={current.playerColor} onPush={onPush} />
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${visible ? 'opacity-40' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Sheet — 75% height */}
      <div
        className={`relative max-w-[480px] w-full mx-auto bg-white rounded-t-2xl max-h-[75dvh] flex flex-col
                    transform transition-transform duration-300 ease-out ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ boxShadow: '0 -4px 24px rgba(0,0,0,0.12)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-[#e2ddd2] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0 border-b border-sand-light">
          {stack.length > 1 ? (
            <button onClick={onPop} className="text-warm-muted hover:text-warm-text p-1 flex-shrink-0 -ml-1">
              <ArrowLeft size={20} />
            </button>
          ) : (
            <div className="w-8 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0 text-center">
            <div className="font-semibold text-warm-text text-base truncate">{current.title}</div>
          </div>
          <button onClick={handleClose} className="text-warm-muted hover:text-warm-text p-1 flex-shrink-0 -mr-1">
            <X size={20} />
          </button>
        </div>

        {/* Breadcrumb — only when 2+ deep */}
        {stack.length > 1 && (
          <div className="px-4 py-1.5 flex items-center gap-1 border-b border-sand-light/40 flex-shrink-0 overflow-x-auto">
            {stack.slice(0, -1).map((v, i) => (
              <span key={i} className="text-warm-muted text-xs whitespace-nowrap flex-shrink-0">
                {v.title} <span className="mx-0.5">›</span>
              </span>
            ))}
            <span className="text-[#8b6914] text-xs font-medium whitespace-nowrap flex-shrink-0">{current.title}</span>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
