import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'

interface Props {
  onStart: (playerNames: string[]) => void
  onBack: () => void
}

const PLAYER_COUNTS = [2, 3, 4]

export default function GameSetup({ onStart, onBack }: Props) {
  const [playerCount, setPlayerCount] = useState(2)
  const [names, setNames] = useState<string[]>(['', ''])

  function handleCountChange(count: number) {
    setPlayerCount(count)
    setNames(prev => {
      const updated = [...prev]
      while (updated.length < count) updated.push('')
      return updated.slice(0, count)
    })
  }

  function handleNameChange(index: number, value: string) {
    setNames(prev => {
      const updated = [...prev]
      updated[index] = value
      return updated
    })
  }

  const allFilled = names.every(n => n.trim().length > 0)

  function handleStart() {
    if (allFilled) {
      onStart(names.map(n => n.trim()))
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-[#e2ddd2] bg-white">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#8b7355] active:bg-[#efe9dd]"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold text-[#2c1810]">New Game</h1>
      </div>

      <div className="flex-1 px-4 pt-5 pb-24 space-y-5">
        {/* Player count */}
        <div>
          <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">
            Number of Players
          </p>
          <div className="bg-[#efe9dd] rounded-xl p-1 flex gap-1">
            {PLAYER_COUNTS.map(count => (
              <button
                key={count}
                onClick={() => handleCountChange(count)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  playerCount === count
                    ? 'bg-white text-[#8b6914] shadow-sm'
                    : 'text-[#8b7355]'
                }`}
              >
                {count}
              </button>
            ))}
          </div>
          <p className="text-xs text-[#a08c6e] mt-1.5">2 decks with jokers (108 cards)</p>
        </div>

        {/* Name inputs */}
        <div>
          <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">
            Player Names
          </p>
          <div className="space-y-2">
            {names.map((name, i) => (
              <div key={i}>
                <label className="block text-xs text-[#8b7355] mb-1">Player {i + 1}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => handleNameChange(i, e.target.value)}
                  placeholder="Enter name..."
                  maxLength={20}
                  className="w-full bg-white border border-[#e2ddd2] rounded-xl px-4 py-3 text-sm text-[#2c1810] placeholder-[#a08c6e] focus:outline-none focus:border-[#8b6914] focus:ring-1 focus:ring-[#8b6914]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom button */}
      <div className="px-4 pb-8 pt-3 border-t border-[#e2ddd2] bg-white">
        <button
          onClick={handleStart}
          disabled={!allFilled}
          className="btn-primary"
        >
          Start Game
        </button>
      </div>
    </div>
  )
}
