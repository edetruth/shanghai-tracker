import { useState, useEffect } from 'react'
import { CheckCircle, AlertCircle, Loader } from 'lucide-react'
import type { Player } from '../../game/types'
import { savePlayedGame } from '../../lib/gameStore'

interface Props {
  players: Player[]
  onPlayAgain: () => void
  onBack: () => void
}

const RANK_LABELS = ['🥇', '🥈', '🥉', '4th', '5th', '6th', '7th', '8th']

export default function GameOver({ players, onPlayAgain, onBack }: Props) {
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saving')

  useEffect(() => {
    const date = new Date().toISOString().split('T')[0]
    const playerData = players.map(p => ({ name: p.name, roundScores: p.roundScores }))
    const gameType = players.some(p => p.isAI) ? 'ai' : 'pass-and-play'
    savePlayedGame(playerData, date, gameType)
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = [...players].sort((a, b) => {
    const aTotal = a.roundScores.reduce((s, n) => s + n, 0)
    const bTotal = b.roundScores.reduce((s, n) => s + n, 0)
    return aTotal - bTotal
  })

  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-[#e2ddd2] px-4 pb-5 text-center safe-top">
        <h1 className="text-2xl font-bold text-[#2c1810]">Game Over! 🏆</h1>
        <p className="text-sm text-[#8b7355] mt-1">Lowest score wins</p>

        {/* Save status */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {saveStatus === 'saving' && (
            <>
              <Loader size={13} className="text-[#a08c6e] animate-spin" />
              <span className="text-xs text-[#a08c6e]">Saving to history…</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <CheckCircle size={13} className="text-[#2d7a3a]" />
              <span className="text-xs text-[#2d7a3a]">Saved to history</span>
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <AlertCircle size={13} className="text-[#a08c6e]" />
              <span className="text-xs text-[#a08c6e]">Not saved (offline?)</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-3 overflow-y-auto">
        {sorted.map((player, i) => {
          const total = player.roundScores.reduce((s, n) => s + n, 0)
          const isWinner = i === 0

          return (
            <div
              key={player.id}
              className={`card ${isWinner ? 'border-[#e2b858] border-2' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className={`text-2xl flex-shrink-0 ${isWinner ? 'mt-0' : 'mt-0.5 text-xl'}`}>
                  {RANK_LABELS[i] ?? `${i + 1}th`}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className={`font-bold truncate ${isWinner ? 'text-xl text-[#2c1810]' : 'text-base text-[#2c1810]'}`}>
                        {player.name}
                      </h3>
                      {player.isAI && (
                        <span className="text-[10px] bg-[#efe9dd] text-[#8b7355] px-1.5 py-0.5 rounded-full flex-shrink-0">
                          AI
                        </span>
                      )}
                    </div>
                    <span className={`font-bold flex-shrink-0 ${isWinner ? 'text-2xl text-[#8b6914]' : 'text-lg text-[#2c1810]'}`}>
                      {total}
                    </span>
                  </div>

                  <div className="flex gap-1 mt-2 flex-wrap">
                    {player.roundScores.map((score, rIdx) => (
                      <span
                        key={rIdx}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          score === 0
                            ? 'bg-[#e8f5ea] text-[#2d7a3a]'
                            : 'bg-[#efe9dd] text-[#8b7355]'
                        }`}
                      >
                        R{rIdx + 1}: {score === 0 ? '0✓' : score}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-4 pb-8 pt-3 border-t border-[#e2ddd2] bg-white space-y-2">
        <button onClick={onPlayAgain} className="btn-primary">Play Again</button>
        <button onClick={onBack} className="btn-secondary">Back to Rules</button>
      </div>
    </div>
  )
}
