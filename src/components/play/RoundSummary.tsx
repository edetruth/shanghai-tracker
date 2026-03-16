import { useState, useEffect } from 'react'
import type { Player, Card as CardType, Meld } from '../../game/types'
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

function getJokerLabel(meld: Meld, cardId: string): string | undefined {
  const mapping = meld.jokerMappings.find(m => m.cardId === cardId)
  if (!mapping) return undefined
  const suitSymbols: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '' }
  const rankStr =
    mapping.representsRank === 1 ? 'A'
    : mapping.representsRank === 11 ? 'J'
    : mapping.representsRank === 12 ? 'Q'
    : mapping.representsRank === 13 ? 'K'
    : mapping.representsRank === 14 ? 'A'
    : String(mapping.representsRank)
  return `${rankStr}${suitSymbols[mapping.representsSuit] ?? ''}`
}

export default function RoundSummary({ players, roundResults, roundNum, onNext, isLastRound }: Props) {
  const [showShanghai, setShowShanghai] = useState(false)

  const winner = players.find(p => {
    const r = roundResults.find(rr => rr.playerId === p.id)
    return r?.score === 0 && !r?.shanghaied
  })

  const shanghaiedCount = roundResults.filter(r => r.shanghaied).length
  const showDramatic = shanghaiedCount >= 2

  useEffect(() => {
    if (showDramatic) {
      setShowShanghai(true)
      const timer = setTimeout(() => setShowShanghai(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [showDramatic])

  const sorted = [...players].sort((a, b) => {
    const ra = roundResults.find(r => r.playerId === a.id)
    const rb = roundResults.find(r => r.playerId === b.id)
    return (ra?.score ?? 999) - (rb?.score ?? 999)
  })

  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Dramatic Shanghai overlay */}
      {showShanghai && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 pointer-events-none">
          <div className="text-center animate-bounce">
            <p className="text-5xl font-black text-[#e2b858] drop-shadow-lg tracking-wider">SHANGHAI!</p>
            <p className="text-lg text-white mt-2">{shanghaiedCount} players caught!</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-[#e2ddd2] px-4 py-5 text-center">
        <div className="w-12 h-12 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-2">
          <span className="text-lg font-bold text-[#2c1810]">{roundNum}</span>
        </div>
        <h2 className="text-xl font-bold text-[#2c1810]">Round {roundNum} Complete</h2>
        <p className="text-sm text-[#8b7355] mt-0.5">Tap "{isLastRound ? 'See Final Results' : 'Next Round'}" when everyone is ready</p>
      </div>

      <div className="flex-1 px-4 py-5 space-y-4 overflow-y-auto">
        {/* Winner section */}
        {winner && (() => {
          const total = winner.roundScores.reduce((s, n) => s + n, 0)
          return (
            <div className="card border-2 border-[#2d7a3a]">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🏆</span>
                <div>
                  <p className="font-bold text-[#2c1810] text-base">{winner.name} went out!</p>
                  <p className="text-xs text-[#8b7355]">+0 pts this round · Total: {total}</p>
                </div>
                <span className="ml-auto inline-block text-[10px] font-bold bg-[#e6f4ea] text-[#2d7a3a] px-2 py-1 rounded-full">
                  Out! +0
                </span>
              </div>

              {winner.melds.length > 0 && (
                <div className="border-t border-[#e6f4ea] pt-3">
                  <p className="text-[10px] text-[#2d7a3a] font-semibold uppercase tracking-wider mb-2">Winning melds</p>
                  <div className="space-y-2">
                    {winner.melds.map((meld, idx) => (
                      <div key={meld.id} className="rounded-lg p-2 bg-[#e6f4ea] border border-[#2d7a3a]/30">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-[10px] font-bold bg-[#2d7a3a] text-white rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-[10px] text-[#2d7a3a] bg-[#c7eed0] px-1.5 py-0.5 rounded-full">{meld.type}</span>
                        </div>
                        <div className="flex gap-1 overflow-x-auto pb-1">
                          {meld.cards.map(card => (
                            <CardComponent
                              key={card.id}
                              card={card}
                              compact
                              jokerLabel={card.suit === 'joker' ? getJokerLabel(meld, card.id) : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* Other players */}
        {sorted.filter(p => p.id !== winner?.id).map(player => {
          const result = roundResults.find(r => r.playerId === player.id)
          if (!result) return null
          const total = player.roundScores.reduce((s, n) => s + n, 0)

          return (
            <div key={player.id} className={`card border-2 ${result.shanghaied ? 'border-[#b83232]' : 'border-[#e2ddd2]'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-[#2c1810] text-sm">{player.name}</p>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    {result.shanghaied && (
                      <span className="inline-block text-[10px] font-bold bg-[#fde8e8] text-[#b83232] px-1.5 py-0.5 rounded-full">
                        ☠ Shanghaied!
                      </span>
                    )}
                    {player.hasLaidDown && !result.shanghaied && (
                      <span className="inline-block text-[10px] font-bold bg-[#efe9dd] text-[#8b6914] px-1.5 py-0.5 rounded-full">
                        Laid down
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-[#b83232]">+{result.score}</p>
                  <p className="text-xs text-[#8b7355]">Total: {total}</p>
                </div>
              </div>

              {/* Player's laid-down melds (if any) */}
              {player.melds.length > 0 && (
                <div className="mb-2 pt-2 border-t border-[#f0ece4]">
                  <p className="text-[10px] text-[#a08c6e] mb-1.5">Laid down melds:</p>
                  <div className="space-y-1.5">
                    {player.melds.map((meld) => (
                      <div key={meld.id} className="rounded-lg p-1.5 bg-[#f8f6f1] border border-[#e2ddd2]">
                        <div className="flex gap-1 overflow-x-auto pb-0.5">
                          {meld.cards.map(card => (
                            <CardComponent
                              key={card.id}
                              card={card}
                              compact
                              jokerLabel={card.suit === 'joker' ? getJokerLabel(meld, card.id) : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Remaining cards */}
              {player.hand.length > 0 && (
                <div className={`${player.melds.length > 0 ? '' : 'mt-2'} pt-2 border-t border-[#f0ece4]`}>
                  <p className="text-[10px] text-[#a08c6e] mb-1.5">
                    Cards stuck with ({player.hand.length}):
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
