import { useState, useEffect, useRef } from 'react'
import { X, LogIn } from 'lucide-react'
import { getPlayers, upsertPlayer, createGame } from '../lib/gameStore'
import type { Player, Game } from '../lib/types'

interface Props {
  onGameCreated: (game: Game, players: Player[]) => void
  onJoinGame: () => void
}

export default function PlayerSetup({ onGameCreated, onJoinGame }: Props) {
  const [knownPlayers, setKnownPlayers] = useState<Player[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getPlayers().then(setKnownPlayers).catch(console.error)
  }, [])

  const suggestions = query.trim()
    ? knownPlayers.filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase()) &&
          !selectedPlayers.includes(p.id)
      )
    : []

  const selectPlayer = (player: Player) => {
    if (!selectedPlayers.includes(player.id)) {
      setSelectedPlayers((prev) => [...prev, player.id])
      setKnownPlayers((prev) =>
        prev.find((p) => p.id === player.id) ? prev : [...prev, player]
      )
    }
    setQuery('')
    setShowSuggestions(false)
  }

  const addPlayer = async () => {
    const name = query.trim()
    if (!name) return
    // Exact match — just select it
    const existing = knownPlayers.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
    if (existing) {
      selectPlayer(existing)
      return
    }
    try {
      const player = await upsertPlayer(name)
      selectPlayer(player)
    } catch (err) {
      console.error(err)
      setError('Failed to add player')
    }
  }

  const removePlayer = (id: string) => {
    setSelectedPlayers((prev) => prev.filter((p) => p !== id))
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
      console.error('createGame error:', err)
      setError('Failed to create game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="text-center pt-6 pb-1">
        <h1 className="font-display text-3xl font-bold text-[#8b6914]">Shanghai</h1>
        <p className="text-[#a08c6e] text-sm mt-1">Score Tracker</p>
      </div>

      {/* Join Existing Game — hidden for now, re-enable by removing the {false &&} wrapper */}
      {false && (
        <button
          onClick={onJoinGame}
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <LogIn size={18} />
          Join Existing Game
        </button>
      )}

      {/* Date picker */}
      <div className="card p-4">
        <label className="text-xs text-[#a08c6e] uppercase tracking-wider font-medium">
          Game Date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-2 w-full bg-white border border-[#e2ddd2] rounded-lg px-3 py-2 text-[#2c1810]
                     focus:outline-none focus:border-[#8b6914] focus:ring-1 focus:ring-[#8b6914]"
        />
      </div>

      {/* Player selection */}
      <div className="card p-4">
        <label className="text-xs text-[#a08c6e] uppercase tracking-wider font-medium">
          Players {selectedPlayers.length > 0 && `(${selectedPlayers.length})`}
        </label>

        {/* Selected player chips */}
        {selectedPlayers.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {selectedPlayers.map((id, i) => {
              const player = knownPlayers.find((p) => p.id === id)
              return (
                <span
                  key={id}
                  className="flex items-center gap-1.5 bg-[#e2b858] text-[#2c1810] text-sm font-medium px-2.5 py-1 rounded-full"
                >
                  <span className="text-[#2c1810]/50 text-xs">{i + 1}.</span>
                  {player?.name}
                  <button
                    onClick={() => removePlayer(id)}
                    className="ml-0.5 hover:opacity-60"
                  >
                    <X size={13} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Typeahead input */}
        <div className="relative mt-3">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a player name…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPlayer()
              if (e.key === 'Escape') setShowSuggestions(false)
            }}
            className="w-full bg-white border border-[#e2ddd2] rounded-lg px-3 py-2 text-[#2c1810]
                       placeholder-[#a08c6e] focus:outline-none focus:border-[#8b6914] focus:ring-1 focus:ring-[#8b6914]"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-[#e2ddd2] rounded-lg overflow-hidden"
              style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
              {suggestions.map((player) => (
                <button
                  key={player.id}
                  onMouseDown={() => selectPlayer(player)}
                  className="w-full text-left px-3 py-2 text-[#2c1810] hover:bg-[#efe9dd] transition-colors text-sm"
                >
                  {player.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[#a08c6e] text-xs mt-2">
          Select from suggestions or press Enter to add a new name
        </p>
      </div>

      {error && <p className="text-[#b83232] text-sm text-center">{error}</p>}

      <button
        onClick={startGame}
        disabled={loading || selectedPlayers.length < 2}
        className="btn-primary"
      >
        {loading ? 'Starting…' : 'Start Game'}
      </button>
    </div>
  )
}
