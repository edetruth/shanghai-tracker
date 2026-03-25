import type { Card as CardType } from '../../game/types'
import CardComponent from './Card'

export type BuyingPhase =
  | 'hidden'
  | 'reveal'        // card rises to center
  | 'free-offer'    // next player's free take
  | 'ai-deciding'   // AI players deciding (passes silent)
  | 'human-turn'    // human's turn to buy/pass
  | 'snatched'      // someone bought it
  | 'unclaimed'     // nobody wanted it

interface Props {
  phase: BuyingPhase
  card: CardType | null
  isFreeOffer: boolean
  buyerName?: string
  passedPlayers: string[]
  buysRemaining: number
  buyLimit: number
  cardLabel: string           // e.g. "7♥" or "Joker"
  onBuy: () => void
  onPass: () => void
}

export default function BuyingCinematic({
  phase,
  card,
  isFreeOffer,
  buyerName,
  passedPlayers,
  buysRemaining,
  buyLimit,
  cardLabel,
  onBuy,
  onPass,
}: Props) {
  if (phase === 'hidden' || !card) return null

  const buyLimitStr = buyLimit >= 999 ? '\u221e' : String(buyLimit)
  const canBuy = isFreeOffer || buysRemaining > 0

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center"
      style={{ pointerEvents: phase === 'human-turn' || phase === 'free-offer' ? 'auto' : 'none' }}
    >
      {/* Dim background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.35)',
          animation: phase === 'unclaimed' ? 'bc-fade-out 800ms ease-in forwards' : 'bc-fade-in 300ms ease-out forwards',
        }}
      />

      {/* Card container */}
      <div
        className="relative z-50"
        style={{
          animation:
            phase === 'reveal' || phase === 'free-offer'
              ? 'bc-card-rise 450ms cubic-bezier(0.22, 1, 0.36, 1) forwards'
              : phase === 'snatched'
                ? 'bc-snatch-fly 500ms cubic-bezier(0.55, 0, 1, 0.45) forwards'
                : phase === 'unclaimed'
                  ? 'bc-card-sink 700ms ease-in forwards'
                  : 'bc-card-float 2.5s ease-in-out infinite',
          transform: 'scale(1.8)',
        }}
      >
        <CardComponent card={card} />
      </div>

      {/* Snatched burst */}
      {phase === 'snatched' && buyerName && (
        <div
          className="absolute z-50 flex flex-col items-center"
          style={{ animation: 'bc-snatch-burst 700ms ease-out forwards' }}
        >
          <p className="text-2xl font-black text-[#e2b858] m-0" style={{ textShadow: '0 2px 12px rgba(226,184,88,0.5)' }}>
            Snatched!
          </p>
          <p className="text-sm text-[#a8d0a8] mt-1 m-0">{buyerName} buys</p>
        </div>
      )}

      {/* Unclaimed label */}
      {phase === 'unclaimed' && (
        <div
          className="relative z-50 mt-4 text-center"
          style={{ animation: 'bc-fade-in 300ms ease-out forwards' }}
        >
          <p className="text-lg font-bold text-[#6a7a6a] m-0">Unclaimed</p>
        </div>
      )}

      {/* Reveal / AI-deciding label */}
      {(phase === 'reveal' || phase === 'ai-deciding') && (
        <div
          className="relative z-50 mt-5 text-center"
          style={{ animation: 'bc-fade-in 300ms ease-out 250ms both' }}
        >
          <p className="text-lg font-bold text-[#e2b858] m-0" style={{ textShadow: '0 1px 8px rgba(226,184,88,0.3)' }}>
            Up for grabs
          </p>
          <p className="text-xs text-[#a8d0a8] mt-1 m-0">
            {cardLabel}
          </p>
        </div>
      )}

      {/* Free offer UI */}
      {phase === 'free-offer' && (
        <div
          className="relative z-50 mt-5 text-center"
          style={{ animation: 'bc-fade-in 300ms ease-out 250ms both' }}
        >
          <p className="text-lg font-bold text-[#6aad7a] m-0" style={{ textShadow: '0 1px 8px rgba(106,173,122,0.3)' }}>
            Free take?
          </p>
          <p className="text-sm text-[#a8d0a8] mt-1 m-0">
            No buy cost — counts as your draw
          </p>

          <div className="flex gap-4 justify-center mt-5">
            <button
              onClick={onPass}
              className="px-8 py-3.5 rounded-xl font-bold text-lg transition-transform active:scale-95"
              style={{
                background: '#1e4a2e',
                color: '#a8d0a8',
                border: '1px solid #3d7a4c',
                minWidth: 100,
              }}
            >
              Pass
            </button>
            <button
              onClick={onBuy}
              className="px-8 py-3.5 rounded-xl font-bold text-lg transition-transform active:scale-95"
              style={{
                background: '#6aad7a',
                color: '#0f2218',
                border: 'none',
                minWidth: 100,
                boxShadow: '0 4px 20px rgba(106,173,122,0.3)',
              }}
            >
              Take it
            </button>
          </div>
        </div>
      )}

      {/* Human buying turn UI */}
      {phase === 'human-turn' && (
        <div
          className="relative z-50 mt-5 text-center"
          style={{ animation: 'bc-fade-in 250ms ease-out both' }}
        >
          {/* Who passed */}
          {passedPlayers.length > 0 && (
            <p className="text-xs text-[#6aad7a] mb-3 m-0">
              {passedPlayers.join(', ')} passed
            </p>
          )}

          <p className="text-xl font-bold text-white m-0">
            Buy {cardLabel}?
          </p>
          <p className="text-sm text-[#a8d0a8] mt-1 m-0">
            {canBuy
              ? `You get ${cardLabel} + 1 penalty card \u00b7 ${buysRemaining}/${buyLimitStr} buys left`
              : 'No buys remaining'}
          </p>

          <div className="flex gap-4 justify-center mt-5">
            <button
              onClick={onPass}
              className="px-8 py-3.5 rounded-xl font-bold text-lg transition-transform active:scale-95"
              style={{
                background: '#1e4a2e',
                color: '#a8d0a8',
                border: '1px solid #3d7a4c',
                minWidth: 100,
              }}
            >
              Pass
            </button>
            <button
              onClick={onBuy}
              disabled={!canBuy}
              className="px-8 py-3.5 rounded-xl font-bold text-lg transition-transform active:scale-95"
              style={{
                background: canBuy ? '#e2b858' : '#4a4a3a',
                color: canBuy ? '#2c1810' : '#888',
                border: 'none',
                minWidth: 100,
                opacity: canBuy ? 1 : 0.5,
                boxShadow: canBuy ? '0 4px 20px rgba(226,184,88,0.3)' : 'none',
              }}
            >
              Buy it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
