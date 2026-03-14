import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { computeWinner } from '../lib/gameStore'
import type { GameWithScores } from '../lib/types'

interface Props {
  game: GameWithScores
  onDelete: (id: string) => void
}

export default function GameCard({ game, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const winner = computeWinner(game.game_scores)
  const sortedScores = [...game.game_scores].sort(
    (a, b) => a.total_score - b.total_score
  )

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    onDelete(game.id)
  }

  let dateLabel = game.date
  try {
    dateLabel = format(new Date(game.date + 'T12:00:00'), 'MMM d, yyyy')
  } catch {
    // keep raw
  }

  return (
    <div className="card overflow-hidden">
      {/* Summary row */}
      <button
        className="w-full p-4 flex items-start justify-between text-left"
        onClick={() => {
          setExpanded((e) => !e)
          setConfirming(false)
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-medium">{dateLabel}</span>
            <span className="text-[#5e7190] text-sm">·</span>
            <span className="text-[#5e7190] text-sm">{game.game_scores.length} players</span>
          </div>
          {winner && (
            <div className="flex items-center gap-1.5">
              <Trophy size={13} className="text-[#e2b858]" />
              <span className="text-[#e2b858] text-sm font-medium">
                {winner.player?.name}
              </span>
              <span className="font-mono text-[#5e7190] text-sm">
                {winner.total_score}
              </span>
            </div>
          )}
          {game.notes && (
            <p className="text-[#5e7190] text-xs mt-1 truncate">{game.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2">
          {expanded ? (
            <ChevronUp size={18} className="text-[#5e7190]" />
          ) : (
            <ChevronDown size={18} className="text-[#5e7190]" />
          )}
        </div>
      </button>

      {/* Expanded scorecard */}
      {expanded && (
        <div className="border-t border-[#1a2640]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a2640]">
                  <th className="text-left px-4 py-2 text-[#5e7190] text-xs font-medium">Player</th>
                  {ROUNDS.map((r) => (
                    <th key={r.number} className="px-2 py-2 text-[#5e7190] text-xs font-medium text-center">
                      R{r.number}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-[#5e7190] text-xs font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedScores.map((gs) => {
                  const color =
                    PLAYER_COLORS[
                      game.game_scores.findIndex((s) => s.player_id === gs.player_id) %
                        PLAYER_COLORS.length
                    ]
                  const isWinner = gs.player_id === winner?.player_id
                  return (
                    <tr key={gs.id} className="border-b border-[#1a2640]/50">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: color }}
                          />
                          <span className={`${isWinner ? 'text-[#e2b858]' : 'text-white'} truncate max-w-[80px]`}>
                            {gs.player?.name}
                          </span>
                        </div>
                      </td>
                      {ROUNDS.map((_r, i) => {
                        const score = gs.round_scores[i] ?? 0
                        return (
                          <td key={i} className="px-2 py-2 text-center">
                            <span
                              className={`font-mono text-sm ${
                                score === 0 ? 'text-[#4ade80] font-medium' : 'text-[#94a3b8]'
                              }`}
                            >
                              {score}
                            </span>
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-right">
                        <span className={`font-mono font-semibold ${isWinner ? 'text-[#e2b858]' : 'text-white'}`}>
                          {gs.total_score}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {game.notes && (
            <div className="px-4 py-3 text-[#5e7190] text-sm border-t border-[#1a2640]/50">
              <span className="text-[#5e7190]/60 text-xs">Notes: </span>
              {game.notes}
            </div>
          )}

          {/* Delete */}
          <div className="px-4 py-3 border-t border-[#1a2640]/50">
            <button
              onClick={handleDelete}
              className={`flex items-center gap-2 text-sm transition-colors
                ${confirming ? 'text-red-400' : 'text-[#5e7190] hover:text-red-400'}`}
            >
              <Trash2 size={14} />
              {confirming ? 'Tap again to confirm delete' : 'Delete game'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
