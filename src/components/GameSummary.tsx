import { useState, useEffect } from 'react'
import { Trophy, Star, Copy, Check } from 'lucide-react'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { completeGame, computeWinner, getGame } from '../lib/gameStore'
import type { Game, Player, GameWithScores } from '../lib/types'
import { format } from 'date-fns'

interface Props {
  game: Game
  players: Player[]
  onDone: () => void
  onPlayerClick?: (playerId: string) => void
}

export default function GameSummary({ game, players, onDone, onPlayerClick }: Props) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [gameData, setGameData] = useState<GameWithScores | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { getGame(game.id).then(setGameData) }, [game.id])

  const scores = gameData?.game_scores ?? []
  const winner = computeWinner(scores)
  const sortedScores = [...scores].sort((a, b) => a.total_score - b.total_score)

  // Round Winners — lowest score each round (0 = automatic winner)
  const roundWinners = ROUNDS.map((_, roundIdx) => {
    const entries = scores.map((gs) => ({ playerId: gs.player_id, score: gs.round_scores[roundIdx] ?? 0 }))
    const minScore = Math.min(...entries.map((r) => r.score))
    return entries.filter((r) => r.score === minScore).map((r) => r.playerId)
  })

  const winCountByPlayer = players.reduce<Record<string, number>>((acc, p) => {
    acc[p.id] = roundWinners.filter((ids) => ids.includes(p.id)).length
    return acc
  }, {})

  // Fun stats
  const totalPoints = sortedScores.reduce((sum, gs) => sum + gs.total_score, 0)
  const margin = sortedScores.length >= 2 ? sortedScores[1].total_score - sortedScores[0].total_score : 0
  const totalZeros = scores.reduce((sum, gs) => sum + gs.round_scores.filter((s) => s === 0).length, 0)
  const notableHighs = scores.flatMap((gs) => {
    const name = players.find((p) => p.id === gs.player_id)?.name ?? '?'
    return gs.round_scores.flatMap((score, i) => score >= 100 ? [{ round: i + 1, player: name }] : [])
  })

  const save = async () => {
    setSaving(true)
    try {
      await completeGame(game.id, notes)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const shareText = () => {
    const dateStr = (() => { try { return format(new Date(game.date + 'T12:00:00'), 'MMM d, yyyy') } catch { return game.date } })()
    const standings = sortedScores.map((gs, i) => {
      const name = players.find((p) => p.id === gs.player_id)?.name ?? '?'
      return `${i === 0 ? '🏆' : `${i + 1}.`} ${name} (${gs.total_score} pts)`
    }).join('\n')
    const winnerLine = players
      .filter((p) => winCountByPlayer[p.id] > 0)
      .sort((a, b) => winCountByPlayer[b.id] - winCountByPlayer[a.id])
      .map((p) => `${p.name} (${winCountByPlayer[p.id]})`)
      .join(', ')
    return `🀄 Shanghai — ${dateStr}\n${standings}\nRound Winners: ${winnerLine}`
  }

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* silent fallback */ }
  }

  if (!gameData) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <div className="text-[#8b7355]">Loading results…</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 text-center safe-top">
        <div className="text-[#a08c6e] text-xs uppercase tracking-wider mb-1">Game Complete</div>
        <h1 className="font-heading text-2xl font-bold text-[#8b6914]">Game Night Recap</h1>
      </div>

      <div className="px-4 flex flex-col gap-3 flex-1 overflow-auto pb-4">
        {/* Winner banner */}
        {winner && (
          <div className="card p-4 flex items-center gap-3" style={{ borderColor: '#e2b858', background: 'rgba(226,184,88,0.08)' }}>
            <Trophy size={28} className="text-[#8b6914] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[#a08c6e] text-xs">Winner</div>
              <button
                onClick={() => onPlayerClick?.(winner.player_id)}
                className={`font-heading text-xl font-semibold text-[#2c1810] truncate block text-left ${onPlayerClick ? 'hover:text-[#8b6914]' : ''}`}
              >
                {winner.player?.name}
              </button>
            </div>
            <div className="font-mono text-[#8b6914] text-xl font-bold">{winner.total_score} pts</div>
          </div>
        )}

        {/* Final standings */}
        <div className="card overflow-hidden">
          <div className="px-3 pt-3 pb-1">
            <p className="text-[#a08c6e] text-xs uppercase tracking-wider">Final Standings</p>
          </div>
          {sortedScores.map((gs, rank) => {
            const player = players.find((p) => p.id === gs.player_id)
            const color = PLAYER_COLORS[players.findIndex((p) => p.id === gs.player_id) % PLAYER_COLORS.length]
            const isWinner = gs.player_id === winner?.player_id
            return (
              <div key={gs.id} className={`px-3 py-2.5 ${rank > 0 ? 'border-t border-[#e2ddd2]/60' : ''} ${rank % 2 !== 0 ? 'bg-[#efe9dd]/40' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[#a08c6e] text-xs w-4">{rank + 1}</span>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                    <button
                      onClick={() => onPlayerClick?.(gs.player_id)}
                      className={`text-[#2c1810] font-medium text-sm text-left ${onPlayerClick ? 'hover:text-[#8b6914]' : ''}`}
                    >
                      {player?.name}
                    </button>
                    {isWinner && <Star size={12} className="text-[#8b6914]" fill="#8b6914" />}
                  </div>
                  <span className="font-mono text-[#8b6914] font-semibold text-sm">{gs.total_score}</span>
                </div>
                {/* Round breakdown with winner highlights */}
                <div className="grid grid-cols-7 gap-1 pl-6">
                  {ROUNDS.map((r, i) => {
                    const roundScore = gs.round_scores[i] ?? 0
                    const isRoundWinner = roundWinners[i]?.includes(gs.player_id)
                    return (
                      <div key={i} className="text-center">
                        <div className="text-[#a08c6e] text-[9px]">R{r.number}</div>
                        <div className={`font-mono text-xs ${roundScore === 0 ? 'text-[#2d7a3a] font-semibold' : isRoundWinner ? 'text-[#8b6914]' : 'text-[#2c1810]'}`}>
                          {roundScore}
                        </div>
                        {isRoundWinner && roundScore > 0 && <div className="text-[8px] text-[#8b6914]">★</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Fun stats */}
        <div className="card p-3">
          <p className="text-[#a08c6e] text-xs uppercase tracking-wider mb-2">Game Stats</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-[#efe9dd] rounded-lg p-2">
              <div className="font-mono text-[#2c1810] font-semibold text-sm">{totalPoints}</div>
              <div className="text-[#8b7355] text-xs">Total pts</div>
            </div>
            <div className="bg-[#efe9dd] rounded-lg p-2">
              <div className="font-mono text-[#2c1810] font-semibold text-sm">{margin}</div>
              <div className="text-[#8b7355] text-xs">Margin</div>
            </div>
            <div className="bg-[#efe9dd] rounded-lg p-2">
              <div className="font-mono text-[#2d7a3a] font-semibold text-sm">{totalZeros}</div>
              <div className="text-[#8b7355] text-xs">Zero rounds</div>
            </div>
          </div>
          {notableHighs.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {notableHighs.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-orange-500">⚡</span>
                  <span className="text-[#8b7355]">{e.player} — R{e.round} high score (100+)</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Round Winners summary */}
        <div className="card p-3">
          <p className="text-[#a08c6e] text-xs uppercase tracking-wider mb-2">Round Winners</p>
          <div className="flex flex-wrap gap-2">
            {players
              .filter((p) => winCountByPlayer[p.id] > 0)
              .sort((a, b) => winCountByPlayer[b.id] - winCountByPlayer[a.id])
              .map((p) => {
                const color = PLAYER_COLORS[players.findIndex((pl) => pl.id === p.id) % PLAYER_COLORS.length]
                return (
                  <button
                    key={p.id}
                    onClick={() => onPlayerClick?.(p.id)}
                    className="flex items-center gap-1.5 bg-[#efe9dd] rounded-lg px-2.5 py-1.5"
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    <span className="text-[#2c1810] text-sm">{p.name}</span>
                    <span className="font-mono text-[#8b6914] text-xs font-semibold">{winCountByPlayer[p.id]}</span>
                  </button>
                )
              })}
          </div>
        </div>

        {/* Share */}
        <button
          onClick={copyShare}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#e2ddd2]
                     text-[#8b7355] hover:text-[#2c1810] hover:border-[#a08c6e] transition-colors text-sm bg-white"
        >
          {copied ? <Check size={16} className="text-[#2d7a3a]" /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy results to clipboard'}
        </button>

        {/* Notes */}
        <div className="card p-4">
          <label className="text-xs text-[#a08c6e] uppercase tracking-wider">Game Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any memorable moments? (optional)"
            rows={3}
            className="mt-2 w-full bg-white border border-[#e2ddd2] rounded-lg px-3 py-2 text-[#2c1810]
                       placeholder-[#a08c6e] resize-none focus:outline-none focus:border-[#8b6914]
                       focus:ring-1 focus:ring-[#8b6914]"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="p-4 border-t border-[#e2ddd2]">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save Game'}
        </button>
      </div>
    </div>
  )
}
