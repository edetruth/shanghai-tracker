import { useState, useEffect } from 'react'
import { Download, Upload, RefreshCw } from 'lucide-react'
import { getCompletedGames, deleteGame } from '../lib/gameStore'
import type { GameWithScores } from '../lib/types'
import GameCard from './GameCard'
import ExportData from './ExportData'
import ImportData from './ImportData'

interface Props {
  onPlayerClick?: (playerId: string) => void
}

export default function GameHistory({ onPlayerClick }: Props) {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'export' | 'import'>('list')

  const loadGames = async () => {
    setLoading(true)
    try {
      const data = await getCompletedGames()
      setGames(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGames()
  }, [])

  const handleDelete = async (id: string) => {
    await deleteGame(id)
    setGames((prev) => prev.filter((g) => g.id !== id))
  }

  if (view === 'export') {
    return <ExportData games={games} onBack={() => setView('list')} />
  }
  if (view === 'import') {
    return <ImportData onBack={() => { setView('list'); loadGames() }} />
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-2xl font-semibold text-[#2c1810]">Game History</h2>
          <button onClick={loadGames} className="text-[#a08c6e] p-1">
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="text-[#a08c6e] text-sm mt-1">{games.length} games played</p>

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setView('import')}
            className="flex-1 flex items-center justify-center gap-2 bg-[#efe9dd] text-[#8b6914]
                       rounded-xl py-2.5 text-sm font-medium"
          >
            <Upload size={16} />
            Import
          </button>
          <button
            onClick={() => setView('export')}
            className="flex-1 flex items-center justify-center gap-2 bg-[#efe9dd] text-[#a08c6e]
                       rounded-xl py-2.5 text-sm font-medium"
          >
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* Game list */}
      <div className="flex-1 px-4 pb-24 flex flex-col gap-3 overflow-auto">
        {loading ? (
          <div className="text-center text-[#a08c6e] py-12">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🃏</div>
            <div className="text-[#a08c6e]">No games yet</div>
            <div className="text-[#a08c6e] text-sm mt-1">Start a new game or import history</div>
          </div>
        ) : (
          games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onDelete={handleDelete}
              onEdit={loadGames}
              onPlayerClick={onPlayerClick}
            />
          ))
        )}
      </div>
    </div>
  )
}
