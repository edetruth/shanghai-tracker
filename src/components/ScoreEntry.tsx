import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { saveAllRoundScores, getGame } from '../lib/gameStore'
import { useRealtimeScores } from '../hooks/useRealtimeScores'
import type { Game, Player } from '../lib/types'

interface Props {
  game: Game
  players: Player[]
  onComplete: () => void
  onBack: () => void
}

export default function ScoreEntry({ game, players, onComplete, onBack }: Props) {
  const [currentRound, setCurrentRound] = useState(0)
  // scores[playerIndex][roundIndex]
  const [scores, setScores] = useState<string[][]>(
    players.map(() => Array(7).fill(''))
  )
  const [saving, setSaving] = useState(false)

  const loadGame = async () => {
    const g = await getGame(game.id)
    if (g) {
      setScores((prev) =>
        players.map((p, pi) => {
          const gs = g.game_scores.find((s) => s.player_id === p.id)
          if (!gs) return prev[pi]
          return gs.round_scores.map((v) => String(v))
        })
      )
    }
  }

  useEffect(() => {
    loadGame()
  }, [game.id])

  useRealtimeScores(game.id, loadGame)

  const round = ROUNDS[currentRound]

  const handleScoreChange = (playerIdx: number, value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) return
    setScores((prev) => {
      const next = prev.map((row) => [...row])
      next[playerIdx][currentRound] = value
      return next
    })
  }

  const runningTotal = (playerIdx: number) =>
    scores[playerIdx].reduce((sum, v, i) => {
      if (i > currentRound) return sum
      return sum + (parseInt(v) || 0)
    }, 0)

  const canProceed = players.every(
    (_, i) => scores[i][currentRound] !== ''
  )

  const saveCurrentRound = async () => {
    setSaving(true)
    try {
      await Promise.all(
        players.map((p, i) =>
          saveAllRoundScores(
            game.id,
            p.id,
            scores[i].map((v) => parseInt(v) || 0)
          )
        )
      )
    } finally {
      setSaving(false)
    }
  }

  const goNext = async () => {
    await saveCurrentRound()
    if (currentRound < 6) {
      setCurrentRound((r) => r + 1)
    } else {
      onComplete()
    }
  }

  const goPrev = () => {
    if (currentRound > 0) setCurrentRound((r) => r - 1)
    else onBack()
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 pt-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={goPrev} className="text-[#5e7190] p-1">
            <ChevronLeft size={24} />
          </button>
          <div className="text-center">
            <div className="text-[#5e7190] text-xs uppercase tracking-wider">Round {round.number} of 7</div>
            <div className="font-display text-lg font-semibold text-[#e2b858]">{round.name}</div>
            <div className="text-[#5e7190] text-xs">{round.cards} cards dealt</div>
          </div>
          <div className="w-8" />
        </div>

        {/* Progress bar */}
        <div className="flex gap-1">
          {ROUNDS.map((_r, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < currentRound
                  ? 'bg-[#e2b858]'
                  : i === currentRound
                  ? 'bg-[#e2b858]/60'
                  : 'bg-[#1a2640]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Room code */}
      <div className="px-4 mb-2">
        <p className="text-[#5e7190] text-xs text-center">
          Room: <span className="font-mono text-[#e2b858]">{game.room_code}</span>
        </p>
      </div>

      {/* Score entry */}
      <div className="flex-1 px-4 pb-4 overflow-auto">
        <div className="flex flex-col gap-3">
          {players.map((player, pi) => {
            const color = PLAYER_COLORS[pi % PLAYER_COLORS.length]
            const val = scores[pi][currentRound]
            const total = runningTotal(pi)
            return (
              <div key={player.id} className="card p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: color }}
                  />
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{player.name}</div>
                    <div className="text-[#5e7190] text-xs font-mono">
                      Running: {total}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="0"
                    value={val}
                    onChange={(e) => handleScoreChange(pi, e.target.value)}
                    className="input-score"
                    min={0}
                  />
                  {val === '0' && (
                    <span className="text-[#4ade80] text-xs font-medium">Out!</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[#1a2640]">
        <button
          onClick={goNext}
          disabled={!canProceed || saving}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {saving ? 'Saving...' : currentRound < 6 ? (
            <>Next Round <ChevronRight size={18} /></>
          ) : (
            'Finish Game'
          )}
        </button>
        {!canProceed && (
          <p className="text-[#5e7190] text-xs text-center mt-2">Enter all scores to continue</p>
        )}
      </div>
    </div>
  )
}
