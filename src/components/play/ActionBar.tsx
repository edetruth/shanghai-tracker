import type { Card as CardType } from '../../game/types'

interface ActionBarProps {
  uiPhase: string
  currentPlayerIsAI: boolean
  hasLaidDown: boolean
  selectedCardCount: number
  requirementDescription: string
  // Undo states
  pendingUndoCard: CardType | null
  onUndoDiscard: () => void
  pendingLayOffUndoCard: CardType | null
  onUndoLayOff: () => void
  // Joker position prompt
  jokerPositionPrompt: boolean
  onJokerLow: () => void
  onJokerHigh: () => void
  // Swap mode
  swapMode: boolean
  swapSelectedMeldId: string | null
  layOffError: string | null
  onCancelSwap: () => void
  // Pre-lay-down buttons
  hasSwappableJokersBeforeLayDown: boolean
  onSwapJoker: () => void
  perfectDrawActive: boolean
  onLayDown: () => void
  onDiscard: () => void
  // Post-lay-down
  discardError: string | null
  lastCardStuck: boolean
  onEndTurnStuck: () => void
  // Meld modal visibility (hides action buttons)
  showMeldModal: boolean
}

function rankLabel(card: CardType): string {
  const r = card.rank
  if (r === 1) return 'A'
  if (r === 11) return 'J'
  if (r === 12) return 'Q'
  if (r === 13) return 'K'
  return String(r)
}

export default function ActionBar({
  uiPhase,
  currentPlayerIsAI,
  hasLaidDown,
  selectedCardCount,
  requirementDescription,
  pendingUndoCard,
  onUndoDiscard,
  pendingLayOffUndoCard,
  onUndoLayOff,
  jokerPositionPrompt,
  onJokerLow,
  onJokerHigh,
  swapMode,
  swapSelectedMeldId,
  layOffError,
  onCancelSwap,
  hasSwappableJokersBeforeLayDown,
  onSwapJoker,
  perfectDrawActive,
  onLayDown,
  onDiscard,
  discardError,
  lastCardStuck,
  onEndTurnStuck,
  showMeldModal,
}: ActionBarProps) {
  return (
    <>
      {/* Status slot — stable height, content fades */}
      <div style={{ minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {uiPhase === 'draw' && !currentPlayerIsAI ? (
          <p className="text-center text-xs text-[#6aad7a]" style={{ margin: 0 }}>
            Tap the draw pile or discard card
          </p>
        ) : (
          <span>{'\u00A0'}</span>
        )}
      </div>

      {/* Undo discard toast */}
      {pendingUndoCard && (
        <div className="flex items-center justify-between bg-[#2c1810] text-white rounded-xl px-4 py-2">
          <span className="text-sm">Discarded {pendingUndoCard.rank === 0 ? 'Joker' : rankLabel(pendingUndoCard)}</span>
          <button onClick={onUndoDiscard} className="text-[#e2b858] text-sm font-bold active:opacity-70">
            Undo
          </button>
        </div>
      )}

      {/* Undo lay-off toast */}
      {pendingLayOffUndoCard && !pendingUndoCard && (
        <div className="flex items-center justify-between bg-[#2c1810] text-white rounded-xl px-4 py-2">
          <span className="text-sm">Laid off {pendingLayOffUndoCard.rank === 0 ? 'Joker' : rankLabel(pendingLayOffUndoCard)}</span>
          <button onClick={onUndoLayOff} className="text-[#e2b858] text-sm font-bold active:opacity-70">
            Undo
          </button>
        </div>
      )}

      {/* Inline joker position prompt */}
      {jokerPositionPrompt && (
        <div style={{
          backgroundColor: '#2e1a0e',
          borderRadius: 10,
          border: '1px solid #e2b858',
          padding: '8px 12px',
          marginTop: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <p style={{ color: '#f0d480', fontSize: 11, fontWeight: 600, margin: 0, flex: 1 }}>
            Place Joker where?
          </p>
          <button
            onClick={onJokerLow}
            style={{
              background: '#6aad7a', color: '#0f2218', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 36,
            }}
          >
            Low
          </button>
          <button
            onClick={onJokerHigh}
            style={{
              background: '#e2b858', color: '#2c1810', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 36,
            }}
          >
            High
          </button>
        </div>
      )}

      {/* Action buttons — hidden during meld-building mode */}
      {uiPhase === 'action' && !currentPlayerIsAI && !pendingUndoCard && !jokerPositionPrompt && !showMeldModal && (
        <div className="space-y-2 mt-2">
          {!hasLaidDown && (
            <p style={{
              fontSize: 10, color: '#6aad7a', textAlign: 'center',
              margin: '0 0 4px', padding: 0,
            }}>
              Need: {requirementDescription}
            </p>
          )}
          {!hasLaidDown ? (
            /* Pre-lay-down: swap mode UI or [Swap Joker?] [Lay Down] [Discard] */
            <>
              {swapMode ? (
                <div>
                  <p style={{ color: '#e2b858', fontSize: 11, textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
                    {swapSelectedMeldId
                      ? 'Now tap the matching card in your hand'
                      : 'Tap a glowing joker on the table to swap it'}
                  </p>
                  {layOffError && (
                    <p style={{ color: '#e87070', fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
                      {layOffError}
                    </p>
                  )}
                  <button
                    onClick={onCancelSwap}
                    style={{
                      width: '100%', minHeight: 38, borderRadius: 10,
                      border: '1px solid #2d5a3a',
                      background: '#1e4a2e', color: '#6aad7a',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Cancel Swap
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  {hasSwappableJokersBeforeLayDown && (
                    <button
                      onClick={onSwapJoker}
                      style={{
                        flex: 1, minHeight: 38, borderRadius: 10,
                        border: '1px solid #e2b858',
                        background: '#1e4a2e', color: '#e2b858',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Swap Joker
                    </button>
                  )}
                  <button
                    onClick={onLayDown}
                    style={{
                      flex: 1, minHeight: 38, borderRadius: 10, border: 'none',
                      background: '#e2b858', color: '#2c1810',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      animation: perfectDrawActive ? 'ready-pulse 1.5s ease-in-out infinite' : 'none',
                    }}
                  >
                    Lay Down
                  </button>
                  <button
                    onClick={selectedCardCount === 1 ? onDiscard : undefined}
                    disabled={selectedCardCount !== 1}
                    style={{
                      flex: 1, minHeight: 38, borderRadius: 10, border: 'none',
                      background: selectedCardCount !== 1 ? '#1e4a2e' : 'white',
                      color: selectedCardCount !== 1 ? '#3a5a3a' : '#2c1810',
                      fontSize: 13, fontWeight: 600,
                      cursor: selectedCardCount !== 1 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Discard
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Post-lay-down: contextual hint + [Discard] or [End Turn] */
            <>
              {/* Contextual hint */}
              <p style={{ color: '#a8d0a8', fontSize: 11, textAlign: 'center', margin: 0 }}>
                {selectedCardCount === 0
                  ? 'Select a card to lay off or discard'
                  : selectedCardCount === 1
                    ? 'Tap a glowing meld to lay off, or discard below'
                    : 'Select exactly 1 card'}
              </p>

              {/* Discard error */}
              {discardError && (
                <p
                  className="text-center text-xs rounded-lg px-3 py-2 border"
                  style={{ color: '#e87070', background: 'rgba(44,24,16,0.6)', borderColor: 'rgba(232,112,112,0.3)' }}
                >
                  {discardError}
                </p>
              )}

              {lastCardStuck ? (
                <button
                  onClick={onEndTurnStuck}
                  style={{
                    width: '100%', minHeight: 38, borderRadius: 10, border: 'none',
                    background: '#e2b858', color: '#2c1810',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  End Turn (draw next turn)
                </button>
              ) : (
                <button
                  onClick={selectedCardCount === 1 ? onDiscard : undefined}
                  disabled={selectedCardCount !== 1}
                  style={{
                    width: '100%', minHeight: 38, borderRadius: 10, border: 'none',
                    background: selectedCardCount !== 1 ? '#1e4a2e' : '#e2b858',
                    color: selectedCardCount !== 1 ? '#3a5a3a' : '#2c1810',
                    fontSize: 13, fontWeight: 700,
                    cursor: selectedCardCount !== 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {selectedCardCount === 1 ? 'Discard Selected Card' : 'Select a card to discard'}
                </button>
              )}
            </>
          )}

          {/* Discard error (pre-lay-down) */}
          {!hasLaidDown && discardError && (
            <p
              className="text-center text-xs rounded-lg px-3 py-2 border"
              style={{ color: '#e87070', background: 'rgba(44,24,16,0.6)', borderColor: 'rgba(232,112,112,0.3)' }}
            >
              {discardError}
            </p>
          )}
        </div>
      )}
    </>
  )
}
