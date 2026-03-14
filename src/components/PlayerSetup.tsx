import { useState, useEffect } from 'react'
import { X, Plus, LogIn } from 'lucide-react'
import { getPlayers, upsertPlayer, createGame } from '../lib/gameStore'
import type { Player, Game } from '../lib/types'

interface Props {
  onGameCreated: (game: Game, players: Player[]) => void
  onJoinGame: () => void
}

export default function PlayerSetup({ onGameCreated, onJoinGame }: Props) {
  const [knownPlayers, setKnownPlayers] = useState<Player[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getPlayers().then(setKnownPlayers).catch(console.error)
  }, [])

  const addPlayer = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const player = await upsertPlayer(name)
      setKnownPlayers((prev) =>
        prev.find((p) => p.id === player.id) ? prev : [...prev, player]
      )
      if (!selectedPlayers.includes(player.id)) {
        setSelectedPlayers((prev) => [...prev, player.id])
      }
      setNewName('')
    } catch (err) {
      setError('Failed to add player')
    }
  }

  const togglePlayer = (id: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  const startGame = async () => {
    if (selectedPlayers.length < 2) {
      setError('Add at least 2 players')
      return
    }
    setLoading(true)
    setError('')
    try {
      const game = await createGame(selectedPlayers, date)
      const players = selectedPlayers.map(
        (id) => knownPlayers.find((p) => p.id === id)!
      )
      onGameCreated(game, players)
    } catch (err) {
      setError('Failed to create game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Header */}
      <div className="text-center pt-8 pb-2">
        <h1 className="font-display text-3xl font-bold text-[#e2b858]">Shanghai</h1>
        <p className="text-[#5e7190] text-sm mt-1">Score Tracker</p>
      </div>

      {/* Date picker */}
      <div className="card p-4">
        <label className="text-xs text-[#5e7190] uppercase tracking-wider font-medium">Game Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-2 w-full bg-[#0c1220] border border-[#1a2640] rounded-lg px-3 py-2 text-white
                     focus:outline-none focus:border-[#e2b858] focus:ring-1 focus:ring-[#e2b858]"
        />
      </div>

      {/* Player selection */}
      <div className="card p-4">
        <label className="text-xs text-[#5e7190] uppercase tracking-wider font-medium">
          Players ({selectedPlayers.length} selected)
        </label>

        {knownPlayers.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {knownPlayers.map((player) => {
              const selected = selectedPlayers.includes(player.id)
              return (
                <button
                  key={player.id}
                  onClick={() => togglePlayer(player.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all
                    ${selected
                      ? 'bg-[#e2b858] text-[#0c1220]'
                      : 'bg-[#1a2640] text-[#5e7190] border border-[#243351]'
                    }`}
                >
                  {player.name}
                </button>
              )
            })}
          </div>
        )}

        {/* Add new player */}
        <div className="flex gap-2 mt-4">
          <input
            type="text"
            placeholder="New player name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
            className="flex-1 bg-[#0c1220] border border-[#1a2640] rounded-lg px-3 py-2 text-white
                       placeholder-[#5e7190] focus:outline-none focus:border-[#e2b858] focus:ring-1 focus:ring-[#e2b858]"
          />
          <button
            onClick={addPlayer}
            className="bg-[#1a2640] border border-[#243351] rounded-lg px-3 py-2 text-[#e2b858]"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* Selected players list */}
      {selectedPlayers.length > 0 && (
        <div className="card p-4">
          <label className="text-xs text-[#5e7190] uppercase tracking-wider font-medium">Playing Order</label>
          <div className="mt-3 flex flex-col gap-2">
            {selectedPlayers.map((id, i) => {
              const player = knownPlayers.find((p) => p.id === id)!
              return (
                <div key={id} className="flex items-center justify-between bg-[#0c1220] rounded-lg px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[#5e7190] text-sm w-5">{i + 1}</span>
                    <span className="text-white">{player?.name}</span>
                  </div>
                  <button onClick={() => togglePlayer(id)} className="text-[#5e7190] hover:text-red-400">
                    <X size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      <button onClick={startGame} disabled={loading || selectedPlayers.length < 2} className="btn-primary">
        {loading ? 'Starting...' : 'Start Game'}
      </button>

      <button onClick={onJoinGame} className="btn-secondary flex items-center justify-center gap-2">
        <LogIn size={18} />
        Join Existing Game
      </button>
    </div>
  )
}
