import { forwardRef } from 'react'
import type { Player } from '../../game/types'
import type { BuyingPhase } from './BuyingCinematic'
import { cardPoints } from '../../game/rules'
import HandDisplay from './HandDisplay'

interface HandAreaProps {
  displayPlayer: Player
  isHumanBuyerTurn: boolean
  aiTurnHumanViewer: Player | null
  currentPlayer: Player
  selectedCardIds: Set<string>
  selectionOrder: string[]
  onToggle: (cardId: string) => void
  handSort: 'rank' | 'suit'
  onSortChange: (mode: 'rank' | 'suit') => void
  newCardIds: Set<string>
  shimmerCardId: string | null
  showDealAnimation: boolean
  leavingCardId: string | null
  dealFlipPhase: 'facedown' | 'flipping' | null
  isOnTheEdge: boolean
  buyRelevanceMap?: Map<string, 'set-match' | 'run-neighbor' | 'dim'>
  buyMatchLabel: 'match' | null
  buyingPhase: BuyingPhase
  showMeldModal: boolean
  meldAssignedIds: Set<string>
  lastDrawnCardId: string | null
  yourTurnPulse: boolean
  perfectDrawActive: boolean
}

const HandArea = forwardRef<HTMLDivElement, HandAreaProps>(function HandArea({
  displayPlayer,
  isHumanBuyerTurn,
  aiTurnHumanViewer,
  currentPlayer,
  selectedCardIds,
  selectionOrder,
  onToggle,
  handSort,
  onSortChange,
  newCardIds,
  shimmerCardId,
  showDealAnimation,
  leavingCardId,
  dealFlipPhase,
  isOnTheEdge,
  buyRelevanceMap,
  buyMatchLabel,
  buyingPhase,
  showMeldModal,
  meldAssignedIds,
  lastDrawnCardId,
  yourTurnPulse,
  perfectDrawActive,
}, ref) {
  return (
    <>
      {/* Buy-window match label */}
      {buyRelevanceMap && buyingPhase !== 'hidden' && (
        <p className="text-center text-xs font-semibold mb-1" style={{
          color: buyMatchLabel === 'match' ? '#6aad7a' : '#8b7355',
          margin: 0, paddingBottom: 4,
        }}>
          {buyMatchLabel === 'match' ? 'Fits your hand' : 'No match in hand'}
        </p>
      )}

      {/* Perfect Draw: "Ready to lay down!" indicator */}
      {perfectDrawActive && (
        <p className="text-center text-xs font-semibold mb-1"
           style={{ color: '#e2b858', animation: 'fade-in-out 3s ease both' }}>
          Ready to lay down!
        </p>
      )}

      {/* Player hand — sort toggle + fan layout */}
      <div ref={ref} data-tutorial-zone="hand" style={{
        position: 'relative',
        border: yourTurnPulse ? '2px solid transparent' : '2px solid transparent',
        borderRadius: 8,
        animation: yourTurnPulse ? 'your-turn-pulse 1s ease-in-out 2' : 'none',
      }}>
      {isOnTheEdge && (
        <div className="absolute inset-0 pointer-events-none rounded-xl"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.15) 100%)',
            zIndex: 50,
          }}
        />
      )}
      {!displayPlayer.isAI ? (
        <HandDisplay
          cards={displayPlayer.hand}
          selectedIds={selectedCardIds}
          selectionOrder={selectionOrder}
          onToggle={onToggle}
          label={`${isHumanBuyerTurn ? displayPlayer.name + "'s " : 'Your '}hand (${displayPlayer.hand.length} cards) · ${displayPlayer.hand.reduce((sum, c) => sum + cardPoints(c.rank), 0)} pts`}
          disabled={false}
          sortMode={handSort}
          onSortChange={onSortChange}
          newCardId={[...newCardIds][0]}
          shimmerCardId={shimmerCardId}
          dealAnimation={showDealAnimation}
          leavingCardId={leavingCardId}
          dealFlipPhase={dealFlipPhase}
          edgeGlow={isOnTheEdge}
          buyRelevanceMap={buyRelevanceMap}
          compact={buyingPhase === 'human-turn' || buyingPhase === 'free-offer'}
          ghostedIds={showMeldModal ? meldAssignedIds : undefined}
          drawSlideCardId={lastDrawnCardId}
        />
      ) : aiTurnHumanViewer ? (
        <HandDisplay
          cards={aiTurnHumanViewer.hand}
          selectedIds={new Set()}
          onToggle={() => {}}
          label={`${aiTurnHumanViewer.name}'s hand (${aiTurnHumanViewer.hand.length} cards) — planning`}
          disabled={false}
          sortMode={handSort}
          onSortChange={onSortChange}
          dealAnimation={showDealAnimation}
          dealFlipPhase={dealFlipPhase}
        />
      ) : null}
      </div>
      {currentPlayer.hand.length === 1 && currentPlayer.hasLaidDown && !currentPlayer.isAI && (
        <p className="text-center text-[10px] text-[#e2b858] font-semibold mt-1">
          Final card — lay it off to go out
        </p>
      )}
    </>
  )
})

export default HandArea
