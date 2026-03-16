import type { Player, Card as CardType } from '../../game/types'
import CardComponent from './Card'

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


function cardPointValue(rank: number): number {
  if (rank === 0) return 50
  if (rank === 1) return 20
  if (rank >= 11) return 10
  return rank
}

export default function RoundSummary({ players, roundResults, roundNum, onNext, isLastRound }: Props) {
  // Sort: winner (score=0) first, then by score ascending
  const sorted = [...players].sort((a, b) => {
    const ra = roundResults.find(r => r.playerId === a.id)
    const rb = roundResults.find(r => r.playerId === b.id)
    return (ra?.score ?? 999) - (rb?.score ?? 999)
  })

  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-[#e2ddd2] px-4 py-5 text-center">
        <div className="w-12 h-12 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-2">
          <span className="text-lg font-bold text-[#2c1810]">{roundNum}</span>
        </div>
        <h2 className="text-xl font-bold text-[#2c1810]">Round {roundNum} Complete</h2>
        <p className="text-sm text-[#8b7355] mt-0.5">Tap "Next Round" when everyone has seen their score</p>
      </div>

      <div className="flex-1 px-4 py-5 space-y-3 overflow-y-auto">
        {sorted.map(player => {
          const result = roundResults.find(r => r.playerId === player.id)
          if (!result) return null
          const wentOut = result.score === 0 && !result.shanghaied
          const total = player.roundScores.reduce((s, n) => s + n, 0)

          return (
            <div key={player.id} className={`card border-2 ${wentOut ? 'border-[#2d7a3a]' : result.shanghaied ? 'border-[#b83232]' : 'border-[#e2ddd2]'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-[#2c1810] text-sm">{player.name}</p>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    {wentOut && (
                      <span className="inline-block text-[10px] font-bold bg-[#e6f4ea] text-[#2d7a3a] px-1.5 py-0.5 rounded-full">
                        ✓ Went Out!
                      </span>
                    )}
                    {result.shanghaied && (
                      <span className="inline-block text-[10px] font-bold bg-[#fde8e8] text-[#b83232] px-1.5 py-0.5 rounded-full">
                        ☠ Shanghaied!
                      </span>
                    )}
                    {player.hasLaidDown && !wentOut && (
                      <span className="inline-block text-[10px] font-bold bg-[#efe9dd] text-[#8b6914] px-1.5 py-0.5 rounded-full">
                        Laid down
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <p className={`text-lg font-bold ${wentOut ? 'text-[#2d7a3a]' : 'text-[#b83232]'}`}>
                    {wentOut ? 'Out! +0' : `+${result.score}`}
                  </p>
                  <p className="text-xs text-[#8b7355]">Total: {total}</p>
                </div>
              </div>

              {/* Remaining cards */}
              {!wentOut && player.hand.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[#f0ece4]">
                  <p className="text-[10px] text-[#a08c6e] mb-1.5">
                    Cards remaining ({player.hand.length}):
                  </p>
                  <div className="flex gap-1 overflow-x-auto pb-1 flex-wrap">
                    {player.hand.map((card: CardType) => (
                      <div key={card.id} className="flex flex-col items-center">
                        <CardComponent card={card} compact />
                        <span className="text-[9px] text-[#a08c6e] mt-0.5">{cardPointValue(card.rank)}pt</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
