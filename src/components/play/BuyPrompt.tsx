import type { Card as CardType } from '../../game/types'
import CardComponent from './Card'
import { MAX_BUYS } from '../../game/rules'

interface Props {
  buyerName: string
  discardCard: CardType
  buysRemaining: number
  onDecision: (wantsToBuy: boolean) => void
}

export default function BuyPrompt({ buyerName, discardCard, buysRemaining, onDecision }: Props) {
  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <div className="text-3xl mb-2">🃏</div>
        <h2 className="text-xl font-bold text-[#2c1810] mb-1">Buying Window</h2>
        <p className="text-base font-semibold text-[#8b6914] mb-6">{buyerName}</p>

        {/* Discard card */}
        <div className="flex flex-col items-center mb-6">
          <p className="text-xs text-[#8b7355] mb-2">Up for grabs:</p>
          <div className="transform scale-150 mb-4">
            <CardComponent card={discardCard} />
          </div>
        </div>

        {/* Buys remaining pill */}
        <div className="inline-flex items-center gap-1.5 bg-[#efe9dd] text-[#8b6914] text-sm font-semibold px-3 py-1.5 rounded-full mb-4">
          Buys remaining: {buysRemaining} / {MAX_BUYS}
        </div>

        <p className="text-xs text-[#a08c6e] mb-8">
          You'll receive this card + 1 penalty card from the draw pile
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => onDecision(false)}
            className="btn-secondary flex-1"
          >
            Pass
          </button>
          <button
            onClick={() => onDecision(true)}
            className="btn-primary flex-1"
            disabled={buysRemaining <= 0}
          >
            Buy it
          </button>
        </div>
      </div>
    </div>
  )
}
