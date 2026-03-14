import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, Trophy, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { computeWinner, saveAllRoundScores, updateGame } from '../lib/gameStore'
import type { GameWithScores } from '../lib/types'

interface Props {
  game: GameWithScores
  onDelete: (id: string) => void
  onEdit?: () => void
  onPlayerClick?: (playerId: string) => void
}

export default function GameCard({ game, onDelete, onEdit, onPlayerClick }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editDate, setEditDate] = useState(game.date)
  const [editNotes, setEditNotes] = useState(game.notes ?? '')
  const [editScores, setEditScores] = useState<Record<string, string[]>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  const winner = computeWinner(game.game_scores)
  const sortedScores = [...game.game_scores].sort((a, b) => a.total_score - b.total_score)

  const handleDelete = () => {
    if (!confirming) { setConfirming(true); return }
    onDelete(game.id)
  }

  const initEdit = () => {
    const initial: Record<string, string[]> = {}
    game.game_scores.forEach((gs) => {
      initial[gs.player_id] = gs.round_scores.map(String)
    })
    setEditScores(initial)
    setEditDate(game.date)
    setEditNotes(game.notes ?? '')
    setEditing(true)
  }

  const handleEditScoreChange = (playerId: string, roundIdx: number, value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) return
    setEditScores((prev) => {
      const row = [...(prev[playerId] ?? game.game_scores.find((gs) => gs.player_id === playerId)!.round_scores.map(String))]
      row[roundIdx] = value
      return { ...prev, [playerId]: row }
    })
  }

  const saveEdit = async () => {
    setSavingEdit(true)
    try {
      await Promise.all(
        game.game_scores.map((gs) => {
          const roundScores = (editScores[gs.player_id] ?? gs.round_scores.map(String)).map((v) => parseInt(v) || 0)
          return saveAllRoundScores(game.id, gs.player_id, roundScores)
        })
      )
      await updateGame(game.id, { date: editDate, notes: editNotes || undefined })
      setEditing(false)
      onEdit?.()
    } catch (err) {
      console.error('saveEdit error:', err)
    } finally {
      setSavingEdit(false)
    }
  }

  let dateLabel = game.date
  try { dateLabel = format(new Date(game.date + 'T12:00:00'), 'MMM d, yyyy') } catch { /* keep raw */ }

  return (
    <div className="card overflow-hidden">
      {/* Summary row */}
      <button
        className="w-full p-4 flex items-start justify-between text-left"
        onClick={() => { setExpanded((e) => !e); setConfirming(false); setEditing(false) }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#2c1810] font-medium text-base">{dateLabel}</span>
            <span className="text-[#a08c6e] text-sm">·</span>
            <span className="text-[#a08c6e] text-sm">{game.game_scores.length} players</span>
          </div>
          {winner && (
            <div className="flex items-center gap-1.5">
              <Trophy size={13} className="text-[#8b6914]" />
              <span className="text-[#8b6914] text-sm font-medium">{winner.player?.name}</span>
              <span className="font-mono text-[#a08c6e] text-sm">{winner.total_score}</span>
            </div>
          )}
          {game.notes && <p className="text-[#a08c6e] text-xs mt-1 truncate">{game.notes}</p>}
        </div>
        <div className="ml-2">
          {expanded ? <ChevronUp size={18} className="text-[#a08c6e]" /> : <ChevronDown size={18} className="text-[#a08c6e]" />}
        </div>
      </button>

      {/* Expanded */}
      {expanded && !editing && (
        <div className="border-t border-[#e2ddd2]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2ddd2]">
                  <th className="text-left px-4 py-2 text-[#a08c6e] text-xs font-medium">Player</th>
                  {ROUNDS.map((r) => (
                    <th key={r.number} className="px-2 py-2 text-[#a08c6e] text-xs font-medium text-center">R{r.number}</th>
                  ))}
                  <th className="px-4 py-2 text-[#a08c6e] text-xs font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedScores.map((gs) => {
                  const color = PLAYER_COLORS[game.game_scores.findIndex((s) => s.player_id === gs.player_id) % PLAYER_COLORS.length]
                  const isWinner = gs.player_id === winner?.player_id
                  return (
                    <tr key={gs.id} className="border-b border-[#e2ddd2]/50">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                          <button
                            onClick={() => onPlayerClick?.(gs.player_id)}
                            className={`text-left truncate max-w-[80px] ${isWinner ? 'text-[#8b6914]' : 'text-[#2c1810]'} ${onPlayerClick ? 'hover:underline' : ''}`}
                          >
                            {gs.player?.name}
                          </button>
                        </div>
                      </td>
                      {ROUNDS.map((_r, i) => {
                        const score = gs.round_scores[i] ?? 0
                        return (
                          <td key={i} className="px-2 py-2 text-center">
                            <span className={`font-mono text-sm ${score === 0 ? 'text-[#2d7a3a] font-semibold' : 'text-[#8b7355]'}`}>
                              {score}
                            </span>
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-right">
                        <span className={`font-mono font-semibold ${isWinner ? 'text-[#8b6914]' : 'text-[#2c1810]'}`}>{gs.total_score}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {game.notes && (
            <div className="px-4 py-3 text-[#8b7355] text-sm border-t border-[#e2ddd2]/50">
              <span className="text-[#a08c6e] text-xs">Notes: </span>{game.notes}
            </div>
          )}

          <div className="px-4 py-3 border-t border-[#e2ddd2]/50 flex items-center gap-4">
            <button
              onClick={initEdit}
              className="flex items-center gap-2 text-sm text-[#a08c6e] hover:text-[#2c1810] transition-colors"
            >
              <Pencil size={14} />
              Edit game
            </button>
            <button
              onClick={handleDelete}
              className={`flex items-center gap-2 text-sm transition-colors
                ${confirming ? 'text-[#b83232]' : 'text-[#a08c6e] hover:text-[#b83232]'}`}
            >
              <Trash2 size={14} />
              {confirming ? 'Tap again to confirm' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Edit mode */}
      {expanded && editing && (
        <div className="border-t border-[#e2ddd2] p-4 flex flex-col gap-4">
          {/* Date */}
          <div>
            <label className="text-[#a08c6e] text-xs uppercase tracking-wider">Date</label>
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="mt-1 w-full bg-white border border-[#e2ddd2] rounded-lg px-3 py-2 text-[#2c1810]
                         focus:outline-none focus:border-[#8b6914]"
            />
          </div>

          {/* Score grid */}
          <div>
            <label className="text-[#a08c6e] text-xs uppercase tracking-wider mb-2 block">Scores</label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e2ddd2]">
                    <th className="text-left py-1.5 text-[#a08c6e] text-xs pr-3">Player</th>
                    {ROUNDS.map((r) => (
                      <th key={r.number} className="py-1.5 text-[#a08c6e] text-xs text-center px-1">R{r.number}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {game.game_scores.map((gs) => {
                    const rowScores = editScores[gs.player_id] ?? gs.round_scores.map(String)
                    return (
                      <tr key={gs.player_id} className="border-b border-[#e2ddd2]/30">
                        <td className="py-2 text-[#2c1810] text-sm pr-3 max-w-[72px] truncate">{gs.player?.name}</td>
                        {ROUNDS.map((_, i) => (
                          <td key={i} className="py-1 px-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              value={rowScores[i] ?? '0'}
                              onChange={(e) => handleEditScoreChange(gs.player_id, i, e.target.value)}
                              className="w-10 text-center font-mono text-sm bg-white border border-[#e2ddd2]
                                         rounded px-1 py-1 text-[#2c1810] focus:outline-none focus:border-[#8b6914]"
                              min={0}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[#a08c6e] text-xs uppercase tracking-wider">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full bg-white border border-[#e2ddd2] rounded-lg px-3 py-2 text-[#2c1810]
                         placeholder-[#a08c6e] resize-none focus:outline-none focus:border-[#8b6914]"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={savingEdit} className="btn-primary py-2.5 text-sm">
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex-none px-5 py-2.5 bg-[#efe9dd] text-[#8b7355] font-semibold rounded-xl text-sm active:opacity-80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
