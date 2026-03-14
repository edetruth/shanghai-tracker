import { useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { getGameByRoomCode } from '../lib/gameStore'
import type { GameWithScores } from '../lib/types'
import ScoreEntry from './ScoreEntry'

interface Props {
  onBack: () => void
}

export default function JoinGame({ onBack }: Props) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [game, setGame] = useState<GameWithScores | null>(null)

  const join = async () => {
    if (code.length < 4) {
      setError('Enter a valid room code')
      return
    }
    setLoading(true)
    setError('')
    try {
      const found = await getGameByRoomCode(code.replace(/\s/g, ''))
      if (!found) {
        setError('No active game found with that code')
        return
      }
      setGame(found)
    } catch {
      setError('Failed to find game')
    } finally {
      setLoading(false)
    }
  }

  if (game) {
    const players = game.game_scores.map((gs) => gs.player!).filter(Boolean)
    return (
      <ScoreEntry
        game={game}
        players={players}
        onComplete={onBack}
        onBack={() => setGame(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-3 pt-6">
        <button onClick={onBack} className="text-[#5e7190]">
          <ArrowLeft size={24} />
        </button>
        <h2 className="font-display text-2xl font-semibold text-white">Join Game</h2>
      </div>

      <div className="card p-4 flex flex-col gap-4">
        <p className="text-[#5e7190] text-sm">
          Enter the room code shown on the game host's device to join an active game session.
        </p>
        <input
          type="text"
          placeholder="e.g. SHNG-4829"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && join()}
          className="w-full bg-[#0c1220] border border-[#1a2640] rounded-lg px-4 py-3 text-white
                     text-center font-mono text-xl tracking-widest uppercase
                     placeholder-[#5e7190] focus:outline-none focus:border-[#e2b858]
                     focus:ring-1 focus:ring-[#e2b858]"
          maxLength={9}
        />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button onClick={join} disabled={loading} className="btn-primary flex items-center justify-center gap-2">
          <Search size={18} />
          {loading ? 'Searching...' : 'Find Game'}
        </button>
      </div>
    </div>
  )
}
