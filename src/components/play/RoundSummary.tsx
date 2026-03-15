import type { Player } from '../../game/types'

interface RoundResult {
  playerId: string
  score: number
  shanghaied: boolean
}

interface Props {
  players: Player[]
  roundResults: RoundResult[]
  roundNum: number
  onNext: () => void
  isLastRound: boolean
}

export default function RoundSummary({ players, roundResults, roundNum, onNext, isLastRound }: Props) {
  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-[#e2ddd2] px-4 py-5 text-center">
        <div className="w-12 h-12 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-2">
          <span className="text-lg font-bold text-[#2c1810]">{roundNum}</span>
        </div>
        <h2 className="text-xl font-bold text-[#2c1810]">Round {roundNum} Complete</h2>
      </div>

      <div className="flex-1 px-4 py-5 space-y-3">
        {players.map(player => {
          const result = roundResults.find(r => r.playerId === player.id)
          if (!result) return null
          const wentOut = result.score === 0 && !result.shanghaied
          const total = player.roundScores.reduce((s, n) => s + n, 0)

          return (
            <div key={player.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#2c1810] text-sm">{player.name}</p>
                  {result.shanghaied && (
                    <span className="inline-block text-[10px] font-bold bg-[#fde8e8] text-[#b83232] px-1.5 py-0.5 rounded-full mt-1">
                      ☠ Shanghaied!
                    </span>
                  )}
                </div>

                <div className="text-right">
                  <p className={`text-lg font-bold ${wentOut ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
                    {wentOut ? 'Out! +0' : `+${result.score}`}
                  </p>
                  <p className="text-xs text-[#8b7355]">Total: {total}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-4 pb-8 pt-3 border-t border-[#e2ddd2] bg-white">
        <button onClick={onNext} className="btn-primary">
          {isLastRound ? 'See Final Results' : 'Next Round →'}
        </button>
      </div>
    </div>
  )
}
