import { useState, useEffect } from 'react'
import { ChevronLeft, Bot, User } from 'lucide-react'
import { getPlayers } from '../../lib/gameStore'
import type { Player as DBPlayer } from '../../lib/types'
import type { PlayerConfig, AIDifficulty } from '../../game/types'

interface Props {
  onStart: (players: PlayerConfig[], difficulty: AIDifficulty) => void
  onBack: () => void
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8]

export default function GameSetup({ onStart, onBack }: Props) {
  const [playerCount, setPlayerCount] = useState(2)
  const [players, setPlayers] = useState<PlayerConfig[]>([
    { name: '', isAI: false },
    { name: '', isAI: false },
  ])
  const [knownPlayers, setKnownPlayers] = useState<DBPlayer[]>([])
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium')

  useEffect(() => {
    getPlayers().then(setKnownPlayers).catch(console.error)
  }, [])

  function handleCountChange(count: number) {
    setPlayerCount(count)
    setPlayers(prev => {
      const updated = [...prev]
      while (updated.length < count) updated.push({ name: '', isAI: false })
      return updated.slice(0, count)
    })
  }

  function handleNameChange(index: number, value: string) {
    setPlayers(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], name: value }
      return updated
    })
  }

  function toggleAI(index: number) {
    setPlayers(prev => {
      const updated = [...prev]
      const becomingAI = !updated[index].isAI
      updated[index] = {
        ...updated[index],
        isAI: becomingAI,
        name: becomingAI
          ? (updated[index].name.trim() || `AI ${index + 1}`)
          : updated[index].name,
      }
      return updated
    })
  }

  const aiCount = players.filter(p => p.isAI).length
  const allFilled = players.every(p => p.name.trim().length > 0)
  const deckCount = playerCount <= 4 ? 2 : 3

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
        <h1 className="text-lg font-bold text-[#2c1810] flex-1">New Game</h1>
        <button
          onClick={() => allFilled && onStart(players.map(p => ({ name: p.name.trim(), isAI: p.isAI })), aiDifficulty)}
          disabled={!allFilled}
          className="bg-[#e2b858] text-[#2c1810] font-semibold rounded-xl px-4 py-2 text-sm active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start Game
        </button>
      </div>

      <div className="flex-1 px-4 pt-5 pb-10 space-y-5 overflow-y-auto">
        {/* Player count selector */}
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
          <p className="text-xs text-[#a08c6e] mt-1.5">
            {deckCount} decks · {deckCount * 54} cards with jokers
          </p>
        </div>

        {/* Player slots */}
        <div>
          <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">
            Players
          </p>
          <div className="space-y-2">
            {players.map((player, i) => {
              const canToggle = player.isAI || aiCount < players.length - 1
              return (
                <div key={i} className="flex items-center gap-2">
                  {/* Human/AI toggle button */}
                  <button
                    onClick={() => canToggle && toggleAI(i)}
                    title={player.isAI ? 'AI player — tap to switch to human' : 'Human player — tap to switch to AI'}
                    className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                      player.isAI
                        ? 'bg-[#e2b858] text-[#2c1810]'
                        : 'bg-[#efe9dd] text-[#8b7355]'
                    } ${!canToggle ? 'opacity-30' : ''}`}
                  >
                    {player.isAI ? <Bot size={16} /> : <User size={16} />}
                  </button>

                  {/* Name input with autocomplete */}
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={player.name}
                      onChange={e => handleNameChange(i, e.target.value)}
                      placeholder={player.isAI ? `AI ${i + 1}` : `Player ${i + 1} name…`}
                      maxLength={20}
                      disabled={player.isAI}
                      list={`suggestions-${i}`}
                      className="w-full bg-white border border-[#e2ddd2] rounded-xl px-3 py-2.5 text-sm text-[#2c1810] placeholder-[#a08c6e] focus:outline-none focus:border-[#8b6914] focus:ring-1 focus:ring-[#8b6914] disabled:bg-[#f0ece4] disabled:text-[#a08c6e]"
                    />
                    {!player.isAI && knownPlayers.length > 0 && (
                      <datalist id={`suggestions-${i}`}>
                        {knownPlayers.map(p => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {aiCount === 0 && (
            <p className="text-xs text-[#a08c6e] mt-2">
              Tap <Bot size={10} className="inline" /> to add an AI opponent
            </p>
          )}
          {aiCount > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-1">
                AI Difficulty
              </p>
              <p className="text-xs text-[#8b7355] mb-2">Applies to all AI players</p>
              <div className="bg-[#efe9dd] rounded-xl p-1 flex gap-1">
                {(['easy', 'medium', 'hard'] as AIDifficulty[]).map(level => (
                  <button
                    key={level}
                    onClick={() => setAiDifficulty(level)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                      aiDifficulty === level
                        ? 'bg-white text-[#8b6914] shadow-sm'
                        : 'text-[#8b7355]'
                    }`}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#a08c6e] mt-1.5">
                {aiDifficulty === 'easy'
                  ? 'Random plays, never buys — good for learning the game flow'
                  : aiDifficulty === 'medium'
                    ? 'Strategic drawing, commits to runs — good for casual games'
                    : 'Smarter discards, aggressive buying — a real challenge'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
