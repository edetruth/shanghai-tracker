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
}

export default function GameSummary({ game, players, onDone }: Props) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [gameData, setGameData] = useState<GameWithScores | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getGame(game.id).then(setGameData)
  }, [game.id])

  const scores = gameData?.game_scores ?? []
  const winner = computeWinner(scores)
  const sortedScores = [...scores].sort((a, b) => a.total_score - b.total_score)

  // Round MVPs — lowest score each round (0 = auto MVP)
  const roundMVPs = ROUNDS.map((_, roundIdx) => {
    const roundEntries = scores.map((gs) => ({ playerId: gs.player_id, score: gs.round_scores[roundIdx] ?? 0 }))
    const minScore = Math.min(...roundEntries.map((r) => r.score))
    return roundEntries.filter((r) => r.score === minScore).map((r) => r.playerId)
  })

  const mvpCountByPlayer = players.reduce<Record<string, number>>((acc, p) => {
    acc[p.id] = roundMVPs.filter((ids) => ids.includes(p.id)).length
    return acc
  }, {})

  // Fun stats
  const totalPoints = sortedScores.reduce((sum, gs) => sum + gs.total_score, 0)
  const margin = sortedScores.length >= 2 ? sortedScores[1].total_score - sortedScores[0].total_score : 0
  const totalZeros = scores.reduce((sum, gs) => sum + gs.round_scores.filter((s) => s === 0).length, 0)

  // Notable events
  type Event = { round: number; player: string; type: 'perfect' | 'high' }
  const notableEvents: Event[] = []
  scores.forEach((gs) => {
    const pName = players.find((p) => p.id === gs.player_id)?.name ?? '?'
    gs.round_scores.forEach((score, i) => {
      if (score >= 100) notableEvents.push({ round: i + 1, player: pName, type: 'high' })
    })
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
    const standings = sortedScores
      .map((gs, i) => {
        const name = players.find((p) => p.id === gs.player_id)?.name ?? '?'
        return `${i === 0 ? '🏆' : `${i + 1}.`} ${name} (${gs.total_score} pts)`
      })
      .join('\n')
    const mvpLine = players
      .filter((p) => mvpCountByPlayer[p.id] > 0)
      .sort((a, b) => mvpCountByPlayer[b.id] - mvpCountByPlayer[a.id])
      .map((p) => `${p.name} (${mvpCountByPlayer[p.id]})`)
      .join(', ')
    return `🀄 Shanghai — ${dateStr}\n${standings}\nMVP Rounds: ${mvpLine}`
  }

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: do nothing silently
    }
  }

  if (!gameData) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <div className="text-[#5e7190]">Loading results...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 pt-8 text-center">
        <div className="text-[#5e7190] text-xs uppercase tracking-wider mb-1">Game Complete</div>
        <h1 className="font-display text-2xl font-bold text-[#e2b858]">Game Night Recap</h1>
      </div>

      <div className="px-4 flex flex-col gap-3 flex-1 overflow-auto pb-4">
        {/* Winner banner */}
        {winner && (
          <div className="card p-4 flex items-center gap-3 border-[#e2b858]/30 bg-[#e2b858]/5">
            <Trophy size={28} className="text-[#e2b858] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[#5e7190] text-xs">Winner</div>
              <div className="font-display text-xl font-semibold text-white truncate">{winner.player?.name}</div>
            </div>
            <div className="font-mono text-[#e2b858] text-xl font-bold">{winner.total_score} pts</div>
          </div>
        )}

        {/* Final standings */}
        <div className="card overflow-hidden">
          <div className="px-3 pt-3 pb-1">
            <p className="text-[#5e7190] text-xs uppercase tracking-wider">Final Standings</p>
          </div>
          {sortedScores.map((gs, rank) => {
            const player = players.find((p) => p.id === gs.player_id)
            const color = PLAYER_COLORS[players.findIndex((p) => p.id === gs.player_id) % PLAYER_COLORS.length]
            const isWinner = gs.player_id === winner?.player_id
            return (
              <div key={gs.id} className={`px-3 py-2.5 ${rank > 0 ? 'border-t border-[#1a2640]/50' : ''} ${rank % 2 !== 0 ? 'bg-[#0c1220]/60' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[#5e7190] text-xs w-4">{rank + 1}</span>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className="text-white font-medium text-sm">{player?.name}</span>
                    {isWinner && <Star size={12} className="text-[#e2b858]" fill="#e2b858" />}
                  </div>
                  <span className="font-mono text-[#e2b858] font-semibold text-sm">{gs.total_score}</span>
                </div>
                {/* Round breakdown */}
                <div className="grid grid-cols-7 gap-1 pl-6">
                  {ROUNDS.map((r, i) => {
                    const roundScore = gs.round_scores[i] ?? 0
                    const isMVP = roundMVPs[i]?.includes(gs.player_id)
                    return (
                      <div key={i} className="text-center">
                        <div className="text-[#5e7190] text-[9px]">R{r.number}</div>
                        <div className={`font-mono text-xs ${roundScore === 0 ? 'text-[#4ade80] font-semibold' : isMVP ? 'text-[#e2b858]' : 'text-white'}`}>
                          {roundScore === 0 ? '0' : roundScore}
                        </div>
                        {isMVP && roundScore > 0 && <div className="text-[8px] text-[#e2b858]">MVP</div>}
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
          <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-2">Game Stats</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-[#0c1220] rounded-lg p-2">
              <div className="font-mono text-white font-semibold text-sm">{totalPoints}</div>
              <div className="text-[#5e7190] text-xs">Total pts</div>
            </div>
            <div className="bg-[#0c1220] rounded-lg p-2">
              <div className="font-mono text-white font-semibold text-sm">{margin}</div>
              <div className="text-[#5e7190] text-xs">Margin</div>
            </div>
            <div className="bg-[#0c1220] rounded-lg p-2">
              <div className="font-mono text-[#4ade80] font-semibold text-sm">{totalZeros}</div>
              <div className="text-[#5e7190] text-xs">Zero rounds</div>
            </div>
          </div>
          {notableEvents.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {notableEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-orange-400">⚡</span>
                  <span className="text-[#94a3b8]">
                    {e.player} — R{e.round} high score (100+)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Round MVP summary */}
        <div className="card p-3">
          <p className="text-[#5e7190] text-xs uppercase tracking-wider mb-2">Round MVPs</p>
          <div className="flex flex-wrap gap-2">
            {players
              .filter((p) => mvpCountByPlayer[p.id] > 0)
              .sort((a, b) => mvpCountByPlayer[b.id] - mvpCountByPlayer[a.id])
              .map((p) => {
                const color = PLAYER_COLORS[players.findIndex((pl) => pl.id === p.id) % PLAYER_COLORS.length]
                return (
                  <div key={p.id} className="flex items-center gap-1.5 bg-[#0c1220] rounded-lg px-2.5 py-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    <span className="text-white text-sm">{p.name}</span>
                    <span className="font-mono text-[#e2b858] text-xs font-semibold">{mvpCountByPlayer[p.id]}</span>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Share */}
        <button onClick={copyShare}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#1a2640] text-[#5e7190] hover:text-white hover:border-[#243351] transition-colors text-sm">
          {copied ? <Check size={16} className="text-[#4ade80]" /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy results to clipboard'}
        </button>

        {/* Notes */}
        <div className="card p-4">
          <label className="text-xs text-[#5e7190] uppercase tracking-wider">Game Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any memorable moments? (optional)"
            rows={3}
            className="mt-2 w-full bg-[#0c1220] border border-[#1a2640] rounded-lg px-3 py-2 text-white
                       placeholder-[#5e7190] resize-none focus:outline-none focus:border-[#e2b858]
                       focus:ring-1 focus:ring-[#e2b858]"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="p-4 border-t border-[#1a2640]">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Game'}
        </button>
      </div>
    </div>
  )
}
