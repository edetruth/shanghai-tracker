import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Trash2, Trophy, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { computeWinner, saveAllRoundScores, updateGame, updatePlayerInGame, upsertPlayer, getPlayers } from '../lib/gameStore'
import type { GameWithScores, Player } from '../lib/types'

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
  const [editNames, setEditNames] = useState<Record<string, string>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [knownPlayers, setKnownPlayers] = useState<Player[]>([])
  const [mergeWarning, setMergeWarning] = useState<{ oldId: string; newPlayer: Player } | null>(null)

  const winner = computeWinner(game.game_scores)
  const sortedScores = [...game.game_scores].sort((a, b) => a.total_score - b.total_score)

  const handleDelete = () => {
    if (!confirming) { setConfirming(true); return }
    onDelete(game.id)
  }

  useEffect(() => {
    if (editing) {
      getPlayers().then(setKnownPlayers).catch(console.error)
    }
  }, [editing])

  const initEdit = () => {
    const initial: Record<string, string[]> = {}
    const names: Record<string, string> = {}
    game.game_scores.forEach((gs) => {
      initial[gs.player_id] = gs.round_scores.map(String)
      names[gs.player_id] = gs.player?.name ?? ''
    })
    setEditScores(initial)
    setEditNames(names)
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
      // Process name changes first
      for (const gs of game.game_scores) {
        const origName = gs.player?.name ?? ''
        const newName = (editNames[gs.player_id] ?? origName).trim()
        if (newName && newName !== origName) {
          const newPlayer = await upsertPlayer(newName)
          if (newPlayer.id !== gs.player_id) {
            // Check if new player is already in this game
            const conflict = game.game_scores.find((s) => s.player_id === newPlayer.id)
            if (conflict) {
              setMergeWarning({ oldId: gs.player_id, newPlayer })
              setSavingEdit(false)
              return
            }
            await updatePlayerInGame(game.id, gs.player_id, newPlayer.id)
          }
        }
      }
      // Save scores (use original player IDs — names may have changed above)
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

  const confirmMerge = async () => {
    if (!mergeWarning) return
    setSavingEdit(true)
    try {
      await updatePlayerInGame(game.id, mergeWarning.oldId, mergeWarning.newPlayer.id)
      setMergeWarning(null)
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
      console.error('confirmMerge error:', err)
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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-warm-text font-medium text-base">{dateLabel}</span>
            <span className="text-warm-muted text-sm">·</span>
            <span className="text-warm-muted text-sm">{game.game_scores.length} players</span>
            {game.game_type === 'ai' && (
              <span className="text-[10px] bg-[#e2b858] text-warm-text px-1.5 py-0.5 rounded-full font-semibold">vs AI</span>
            )}
            {game.game_type === 'pass-and-play' && (
              <span className="text-[10px] bg-[#efe9dd] text-[#8b7355] px-1.5 py-0.5 rounded-full font-medium">Played</span>
            )}
          </div>
          {winner && (
            <div className="flex items-center gap-1.5">
              <Trophy size={13} className="text-[#8b6914]" />
              <span className="text-[#8b6914] text-sm font-medium">{winner.player?.name}</span>
              <span className="font-mono text-warm-muted text-sm">{winner.total_score}</span>
            </div>
          )}
          {game.notes && <p className="text-warm-muted text-xs mt-1 truncate">{game.notes}</p>}
        </div>
        <div className="ml-2">
          {expanded ? <ChevronUp size={18} className="text-warm-muted" /> : <ChevronDown size={18} className="text-warm-muted" />}
        </div>
      </button>

      {/* Expanded */}
      {expanded && !editing && (
        <div className="border-t border-sand-light">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-light">
                  <th className="text-left px-4 py-2 text-warm-muted text-xs font-medium">Player</th>
                  {ROUNDS.map((r) => (
                    <th key={r.number} className="px-2 py-2 text-warm-muted text-xs font-medium text-center">R{r.number}</th>
                  ))}
                  <th className="px-4 py-2 text-warm-muted text-xs font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedScores.map((gs) => {
                  const color = PLAYER_COLORS[game.game_scores.findIndex((s) => s.player_id === gs.player_id) % PLAYER_COLORS.length]
                  const isWinner = gs.player_id === winner?.player_id
                  return (
                    <tr key={gs.id} className="border-b border-sand-light/50">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                          <button
                            onClick={() => onPlayerClick?.(gs.player_id)}
                            className={`text-left truncate max-w-[80px] ${isWinner ? 'text-[#8b6914]' : 'text-warm-text'} ${onPlayerClick ? 'hover:underline' : ''}`}
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
                        <span className={`font-mono font-semibold ${isWinner ? 'text-[#8b6914]' : 'text-warm-text'}`}>{gs.total_score}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {game.notes && (
            <div className="px-4 py-3 text-[#8b7355] text-sm border-t border-sand-light/50">
              <span className="text-warm-muted text-xs">Notes: </span>{game.notes}
            </div>
          )}

          <div className="px-4 py-3 border-t border-sand-light/50 flex items-center gap-4">
            <button
              onClick={initEdit}
              className="flex items-center gap-2 text-sm text-warm-muted hover:text-warm-text transition-colors"
            >
              <Pencil size={14} />
              Edit game
            </button>
            <button
              onClick={handleDelete}
              className={`flex items-center gap-2 text-sm transition-colors
                ${confirming ? 'text-[#b83232]' : 'text-warm-muted hover:text-[#b83232]'}`}
            >
              <Trash2 size={14} />
              {confirming ? 'Tap again to confirm' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Edit mode */}
      {expanded && editing && (
        <div className="border-t border-sand-light p-4 flex flex-col gap-4">
          {/* Date */}
          <div>
            <label className="text-warm-muted text-xs uppercase tracking-wider">Date</label>
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="mt-1 w-full bg-white border border-sand-light rounded-lg px-3 py-2 text-warm-text
                         focus:outline-none focus:border-[#8b6914]"
            />
          </div>

          {/* Merge warning */}
          {mergeWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-amber-800 text-sm font-medium mb-2">
                Merge with existing player "{mergeWarning.newPlayer.name}"?
              </p>
              <p className="text-amber-700 text-xs mb-3">
                This will reassign the score row to the existing player record.
              </p>
              <div className="flex gap-2">
                <button onClick={confirmMerge} disabled={savingEdit}
                  className="px-4 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg">
                  Merge
                </button>
                <button onClick={() => setMergeWarning(null)}
                  className="px-4 py-1.5 bg-[#efe9dd] text-[#8b7355] text-sm font-medium rounded-lg">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Player names */}
          <div>
            <label className="text-warm-muted text-xs uppercase tracking-wider mb-2 block">Player Names</label>
            <datalist id={`players-${game.id}`}>
              {knownPlayers.map((p) => <option key={p.id} value={p.name} />)}
            </datalist>
            <div className="flex flex-col gap-2">
              {game.game_scores.map((gs) => (
                <div key={gs.player_id} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: PLAYER_COLORS[game.game_scores.findIndex((s) => s.player_id === gs.player_id) % PLAYER_COLORS.length] }} />
                  <input
                    type="text"
                    list={`players-${game.id}`}
                    value={editNames[gs.player_id] ?? gs.player?.name ?? ''}
                    onChange={(e) => setEditNames((prev) => ({ ...prev, [gs.player_id]: e.target.value }))}
                    className="flex-1 bg-white border border-sand-light rounded-lg px-3 py-1.5 text-warm-text text-sm
                               focus:outline-none focus:border-[#8b6914]"
                    placeholder="Player name"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Score grid */}
          <div>
            <label className="text-warm-muted text-xs uppercase tracking-wider mb-2 block">Scores</label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-light">
                    <th className="text-left py-1.5 text-warm-muted text-xs pr-3">Player</th>
                    {ROUNDS.map((r) => (
                      <th key={r.number} className="py-1.5 text-warm-muted text-xs text-center px-1">R{r.number}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {game.game_scores.map((gs) => {
                    const rowScores = editScores[gs.player_id] ?? gs.round_scores.map(String)
                    const displayName = (editNames[gs.player_id] ?? gs.player?.name ?? '').split(' ')[0]
                    return (
                      <tr key={gs.player_id} className="border-b border-sand-light/30">
                        <td className="py-2 text-warm-text text-sm pr-3 max-w-[72px] truncate">{displayName}</td>
                        {ROUNDS.map((_, i) => (
                          <td key={i} className="py-1 px-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              value={rowScores[i] ?? '0'}
                              onChange={(e) => handleEditScoreChange(gs.player_id, i, e.target.value)}
                              className="w-10 text-center font-mono text-sm bg-white border border-sand-light
                                         rounded px-1 py-1 text-warm-text focus:outline-none focus:border-[#8b6914]"
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
            <label className="text-warm-muted text-xs uppercase tracking-wider">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full bg-white border border-sand-light rounded-lg px-3 py-2 text-warm-text
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
