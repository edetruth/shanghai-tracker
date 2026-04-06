import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Copy, Check, Wifi } from 'lucide-react'
import { ROUNDS, PLAYER_COLORS } from '../lib/constants'
import { saveAllRoundScores, getGame } from '../lib/gameStore'
import { haptic } from '../lib/haptics'
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
  // scores[playerIndex][roundIndex] — '' means not yet entered
  const [scores, setScores] = useState<string[][]>(
    players.map(() => Array(7).fill(''))
  )
  const [saving, setSaving] = useState(false)
  const [roundError, setRoundError] = useState('')
  const [codeCopied, setCodeCopied] = useState(false)

  const loadGame = async () => {
    const g = await getGame(game.id)
    if (g) {
      setScores(
        players.map((p) => {
          const gs = g.game_scores.find((s) => s.player_id === p.id)
          if (!gs) return Array(7).fill('')
          // Pad to 7 with '' — future rounds stay empty, not '0'
          return Array(7).fill('').map((_, idx) =>
            idx < gs.round_scores.length ? String(gs.round_scores[idx]) : ''
          )
        })
      )
    }
  }

  useEffect(() => { loadGame() }, [game.id])
  useRealtimeScores(game.id, loadGame)

  const round = ROUNDS[currentRound]

  const handleScoreChange = (playerIdx: number, value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) return
    setRoundError('')
    haptic('tap')
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

  const canProceed = players.every((_, i) => scores[i][currentRound] !== '')

  const saveCurrentRound = async () => {
    setSaving(true)
    try {
      await Promise.all(
        players.map((p, i) =>
          saveAllRoundScores(
            game.id,
            p.id,
            // Only save rounds 0..currentRound — don't write future rounds as 0
            scores[i].slice(0, currentRound + 1).map((v) => parseInt(v) || 0)
          )
        )
      )
    } finally {
      setSaving(false)
    }
  }

  const goNext = async () => {
    // Bug 1C: only one player can score 0 per round
    const zeroCount = players.filter((_, i) => scores[i][currentRound] === '0').length
    if (zeroCount > 1) {
      setRoundError('Only one player can go out (score 0) per round')
      return
    }
    await saveCurrentRound()
    if (currentRound < 6) {
      setCurrentRound((r) => r + 1)
      setRoundError('')
    } else {
      onComplete()
    }
  }

  const goPrev = () => {
    setRoundError('')
    setCurrentRound((r) => r - 1)
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 safe-top">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-warm-muted p-1" aria-label="Exit game">
            <ChevronLeft size={24} />
          </button>
          <div className="text-center">
            <div className="text-warm-muted text-xs uppercase tracking-wider">Round {round.number} of 7</div>
            <div className="font-heading text-lg font-semibold text-[#8b6914]">{round.name}</div>
            <div className="text-warm-muted text-xs">{round.cards} cards dealt</div>
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
                  ? 'bg-[#8b6914]'
                  : i === currentRound
                  ? 'bg-[#8b6914]/50'
                  : 'bg-[#e2ddd2]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Room code — tap to copy */}
      {game.room_code && (
        <div className="px-4 mb-2">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(game.room_code!)
                setCodeCopied(true)
                setTimeout(() => setCodeCopied(false), 2000)
              } catch { /* fallback: silent */ }
            }}
            className="w-full flex items-center justify-center gap-2 bg-[#efe9dd] rounded-xl py-2 px-3 active:opacity-70"
          >
            <Wifi size={13} className="text-[#8b6914]" />
            <span className="text-[#8b7355] text-xs">Room code: </span>
            <span className="font-mono text-[#8b6914] text-sm font-semibold tracking-wider">{game.room_code}</span>
            {codeCopied
              ? <Check size={13} className="text-[#2d7a3a]" />
              : <Copy size={13} className="text-warm-muted" />
            }
          </button>
          <p className="text-warm-muted text-[10px] text-center mt-1">Tap to copy · Others can join from Score Tracker → Join Game</p>
        </div>
      )}

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
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="min-w-0">
                    <div className="text-warm-text font-medium text-base truncate">{player.name}</div>
                    <div className="text-[#8b7355] text-xs font-mono">Running: {total}</div>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="—"
                    value={val}
                    onChange={(e) => handleScoreChange(pi, e.target.value)}
                    className="input-score"
                    min={0}
                  />
                  {val === '0' && (
                    <span className="text-[#2d7a3a] text-xs font-semibold">Out!</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-sand-light">
        {roundError && (
          <p className="text-[#b83232] text-sm text-center mb-3">{roundError}</p>
        )}
        {!canProceed && !roundError && (
          <p className="text-warm-muted text-xs text-center mb-2">Enter all scores to continue</p>
        )}
        <div className="flex gap-2">
          {/* Previous button — only visible from Round 2 onward */}
          {currentRound > 0 && (
            <button
              onClick={goPrev}
              className="flex items-center justify-center gap-1 bg-[#efe9dd] text-[#8b7355] font-semibold
                         rounded-xl py-3 px-4 active:opacity-80 transition-opacity flex-none"
            >
              <ChevronLeft size={18} />
              Prev
            </button>
          )}
          <button
            onClick={goNext}
            disabled={!canProceed || saving}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {saving ? 'Saving…' : currentRound < 6 ? (
              <>Next Round <ChevronRight size={18} /></>
            ) : (
              'Finish Game'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
