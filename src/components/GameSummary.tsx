import { useState } from 'react'
import { Trophy, Star } from 'lucide-react'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { completeGame, computeWinner, getGame } from '../lib/gameStore'
import type { Game, Player, GameWithScores } from '../lib/types'
import { useEffect } from 'react'

interface Props {
  game: Game
  players: Player[]
  onDone: () => void
}

export default function GameSummary({ game, players, onDone }: Props) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [gameData, setGameData] = useState<GameWithScores | null>(null)

  useEffect(() => {
    getGame(game.id).then(setGameData)
  }, [game.id])

  const scores = gameData?.game_scores ?? []
  const winner = computeWinner(scores)

  const sortedScores = [...scores].sort((a, b) => a.total_score - b.total_score)

  const save = async () => {
    setSaving(true)
    try {
      await completeGame(game.id, notes)
      onDone()
    } finally {
      setSaving(false)
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
        <h1 className="font-display text-2xl font-bold text-[#e2b858]">Final Results</h1>
      </div>

      {/* Winner banner */}
      {winner && (
        <div className="mx-4 mb-4 card p-4 flex items-center gap-3 border-[#e2b858]/30 bg-[#e2b858]/5">
          <Trophy size={28} className="text-[#e2b858] flex-shrink-0" />
          <div>
            <div className="text-[#5e7190] text-xs">Winner</div>
            <div className="font-display text-xl font-semibold text-white">
              {winner.player?.name}
            </div>
            <div className="font-mono text-[#e2b858] text-sm">{winner.total_score} pts</div>
          </div>
        </div>
      )}

      {/* Ranked list */}
      <div className="px-4 flex flex-col gap-2 flex-1 overflow-auto">
        {sortedScores.map((gs, rank) => {
          const player = players.find((p) => p.id === gs.player_id)
          const color = PLAYER_COLORS[players.findIndex((p) => p.id === gs.player_id) % PLAYER_COLORS.length]
          const isWinner = gs.player_id === winner?.player_id
          return (
            <div key={gs.id} className="card p-3">
              {/* Player header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-[#5e7190] text-sm w-5">{rank + 1}</span>
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-white font-medium">{player?.name}</span>
                  {isWinner && <Star size={14} className="text-[#e2b858]" fill="#e2b858" />}
                </div>
                <span className="font-mono text-[#e2b858] font-semibold">{gs.total_score}</span>
              </div>
              {/* Round breakdown */}
              <div className="grid grid-cols-7 gap-1">
                {ROUNDS.map((r, i) => {
                  const roundScore = gs.round_scores[i] ?? 0
                  return (
                    <div key={i} className="text-center">
                      <div className="text-[#5e7190] text-[10px]">R{r.number}</div>
                      <div
                        className={`font-mono text-sm ${
                          roundScore === 0 ? 'text-[#4ade80]' : 'text-white'
                        }`}
                      >
                        {roundScore}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Notes */}
        <div className="card p-4 mt-2">
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
