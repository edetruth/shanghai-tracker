import type { Card as CardType } from '../../game/types'
import CardComponent from './Card'

interface PileAreaProps {
  drawPileRef: React.Ref<HTMLDivElement>
  discardPileRef: React.Ref<HTMLDivElement>
  drawPileCards: CardType[]
  discardTop: CardType | null
  isHumanDraw: boolean
  isHumanBuyerTurn: boolean
  buyingDiscard: CardType | null
  discardAnimating: boolean
  discardUnwanted: boolean
  lastDiscardedLabel: string | null
  pendingBuyDiscard: CardType | null
  uiPhase: string
  currentPlayerIsAI: boolean
  onDrawFromPile: () => void
  onTakeDiscard: () => void
}

export default function PileArea({
  drawPileRef,
  discardPileRef,
  drawPileCards,
  discardTop,
  isHumanDraw,
  isHumanBuyerTurn,
  buyingDiscard,
  discardAnimating,
  discardUnwanted,
  lastDiscardedLabel,
  pendingBuyDiscard,
  uiPhase,
  currentPlayerIsAI,
  onDrawFromPile,
  onTakeDiscard,
}: PileAreaProps) {
  const displayDiscard = isHumanBuyerTurn && buyingDiscard ? buyingDiscard : discardTop

  return (
    <div
      style={{
        flexShrink: 0,
        background: '#162e22',
        borderTop: '1px solid #2d5a3a',
        borderBottom: '1px solid #2d5a3a',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
      }}
    >
      {/* Draw pile */}
      <div ref={drawPileRef} data-tutorial-zone="draw-pile" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <p style={{
          color: isHumanDraw ? '#ffffff' : '#6aad7a',
          fontSize: isHumanDraw ? 10 : 9,
          fontWeight: isHumanDraw ? 700 : 400,
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>
          {isHumanDraw ? 'TAP TO DRAW' : 'Draw'}
        </p>
        {isHumanDraw && (
          <div
            className="flex justify-center"
            style={{ marginBottom: 2, animation: 'draw-arrow-pulse 1.5s ease-in-out infinite' }}
          >
            <span style={{ color: '#6aad7a', fontSize: 10, opacity: 0.6 }}>▲</span>
          </div>
        )}
        {drawPileCards.length > 0 ? (
          <div className="draw-pile-press" style={{
            borderRadius: 6,
            animation: isHumanDraw ? 'gbPulseGreen 1.2s ease-in-out 0.3s infinite' : 'none',
            transform: 'scale(0.85)', transformOrigin: 'top center',
            position: 'relative',
          }}>
            {/* Stacked pile depth — bottom card */}
            <div style={{
              position: 'absolute', top: -3, left: 3, width: '100%', height: '100%',
              borderRadius: 6, background: '#5a1220', border: '1px solid #3a0e18',
            }} />
            {/* Stacked pile depth — middle card */}
            <div style={{
              position: 'absolute', top: -1.5, left: 1.5, width: '100%', height: '100%',
              borderRadius: 6, background: '#6a1828', border: '1px solid #4a1420',
            }} />
            {/* Top card (interactive) */}
            <div style={{ position: 'relative' }}>
              <CardComponent
                card={drawPileCards[0]}
                faceDown
                onClick={isHumanDraw ? onDrawFromPile : undefined}
              />
            </div>
          </div>
        ) : (
          <div
            onClick={isHumanDraw ? onDrawFromPile : undefined}
            style={{
              width: 35, height: 52, borderRadius: 6,
              border: `2px dashed ${isHumanDraw ? '#e2b858' : '#2d5a3a'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isHumanDraw ? '#e2b858' : '#2d5a3a', fontSize: 9, textAlign: 'center',
              cursor: isHumanDraw ? 'pointer' : 'default',
              animation: isHumanDraw ? 'gbPulseGreen 1.2s ease-in-out 0.3s infinite' : 'none',
            }}
          >
            {isHumanDraw ? 'Tap to\nReshuffle' : 'Empty'}
          </div>
        )}
        {drawPileCards.length < 15 && (
          <p key={drawPileCards.length} style={{ color: '#e2b858', fontSize: 9, fontWeight: 600, margin: 0, animation: 'number-roll 300ms ease-out' }}>{drawPileCards.length} left</p>
        )}
      </div>

      {/* Discard pile */}
      <div ref={discardPileRef} data-tutorial-zone="discard-pile" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <p style={{
          color: isHumanDraw ? '#e2b858' : isHumanBuyerTurn ? '#e2b858' : '#6aad7a',
          fontSize: isHumanDraw ? 10 : 9,
          fontWeight: isHumanDraw || isHumanBuyerTurn ? 700 : 400,
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>
          {isHumanDraw ? 'TAP TO TAKE' : isHumanBuyerTurn ? 'FOR SALE' : 'Discard'}
        </p>
        {displayDiscard ? (
          <div
            key={(isHumanBuyerTurn && buyingDiscard ? buyingDiscard.id : discardTop?.id) ?? 'empty'}
            style={{
              borderRadius: 6,
              animation: discardAnimating
                ? 'discard-toss 400ms ease-out'
                : discardUnwanted
                  ? 'unwanted-dim 600ms ease-out both'
                  : isHumanBuyerTurn
                    ? 'for-sale-pulse 1.5s ease-in-out infinite'
                    : isHumanDraw
                      ? 'gbPulseGold 1.2s ease-in-out infinite'
                      : 'card-land 250ms ease-out',
              transform: isHumanDraw ? 'scale(0.85) translateY(-2px)' : 'scale(0.85)',
              transformOrigin: 'top center',
              transition: 'transform 200ms ease',
            }}>
            <CardComponent
              card={displayDiscard}
              onClick={isHumanDraw ? onTakeDiscard : undefined}
              style={isHumanDraw ? { border: '2px solid #e2b858' } : undefined}
            />
          </div>
        ) : (
          <div
            style={{
              width: 35, height: 52, borderRadius: 6,
              border: '2px dashed #2d5a3a',
            }}
          />
        )}
        <p style={{
          color: pendingBuyDiscard && uiPhase === 'draw' && !currentPlayerIsAI ? '#e2b858' : '#6aad7a',
          fontSize: 9, fontWeight: pendingBuyDiscard ? 600 : 400, margin: 0,
        }}>
          {pendingBuyDiscard && uiPhase === 'draw' && !currentPlayerIsAI ? 'Buyable' : '\u00A0'}
        </p>
        {lastDiscardedLabel && (
          <p
            key={lastDiscardedLabel}
            style={{ animation: 'fade-in-out 2s ease both' }}
            className="text-[10px] text-[#a8d0a8] font-medium text-center mt-0.5"
          >
            {lastDiscardedLabel}
          </p>
        )}
      </div>
    </div>
  )
}
