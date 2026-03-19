import { useState, useRef, useEffect, useMemo } from 'react'
import type { Card as CardType, Meld, Player } from '../../game/types'
import { canLayOff, findSwappableJoker } from '../../game/meld-validator'
import { haptic } from '../../lib/haptics'

interface Props {
  melds: Meld[]
  currentPlayerId: string
  currentPlayerName: string
  hand: CardType[]
  onLayOff: (card: CardType, meld: Meld, jokerPosition?: 'low' | 'high') => void
  onGoOut: () => void
  onDone: () => void
  players: Player[]
  onJokerSwap?: (naturalCard: CardType, meld: Meld, jokerIndex: number) => void
}

// ── Suit colour helpers (spec §1.2) ──────────────────────────────────────────

function suitBg(suit: string): string {
  if (suit === 'joker') return '#fff8e0'
  if (suit === 'hearts') return '#fff0f0'
  if (suit === 'diamonds') return '#f0f5ff'
  if (suit === 'clubs') return '#e0f7e8'
  return '#eeecff'
}

function suitColor(suit: string): string {
  if (suit === 'joker') return '#8b6914'
  if (suit === 'hearts') return '#c0393b'
  if (suit === 'diamonds') return '#2158b8'
  if (suit === 'clubs') return '#1a6b3a'
  return '#3d2b8e'
}

function rankLabel(rank: number): string {
  if (rank === 0) return 'JKR'
  if (rank === 1 || rank === 14) return 'A'
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  return String(rank)
}

function suitSymbol(suit: string): string {
  if (suit === 'hearts') return '♥'
  if (suit === 'diamonds') return '♦'
  if (suit === 'clubs') return '♣'
  if (suit === 'spades') return '♠'
  return ''
}

function getJokerLabel(meld: Meld, cardId: string): string {
  if (meld.type !== 'run') return 'JKR'
  const m = meld.jokerMappings.find(j => j.cardId === cardId)
  if (!m) return 'JKR'
  return `${rankLabel(m.representsRank)}${suitSymbol(m.representsSuit)}`
}

// ── 36×50px card used throughout this modal ──────────────────────────────────

function ModalCard({
  card, meld, selected, selectionIndex, onClick,
}: {
  card: CardType
  meld?: Meld
  selected?: boolean
  selectionIndex?: number
  onClick?: () => void
}) {
  const isJoker = card.suit === 'joker'
  const label = isJoker && meld
    ? getJokerLabel(meld, card.id)
    : isJoker ? 'JKR' : `${rankLabel(card.rank)}${suitSymbol(card.suit)}`
  const interactive = !!onClick

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div
        onClick={onClick}
        style={{
          width: 36,
          height: 50,
          backgroundColor: suitBg(card.suit),
          border: selected ? '2px solid #e2b858' : '1.5px solid rgba(0,0,0,0.14)',
          borderRadius: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: suitColor(card.suit),
          lineHeight: 1.1,
          overflow: 'hidden',
          userSelect: 'none',
          cursor: interactive ? 'pointer' : 'default',
          transform: selected ? 'translateY(-8px)' : undefined,
          boxShadow: selected ? '0 4px 12px rgba(0,0,0,0.35)' : undefined,
          transition: 'transform 100ms, box-shadow 100ms',
          minWidth: interactive ? 44 : undefined,
          minHeight: interactive ? 44 : undefined,
        }}
      >
        {isJoker ? (
          <>
            <span style={{ fontSize: label.length > 3 ? 7 : 9, fontWeight: 700 }}>{label}</span>
            <span style={{ fontSize: 11 }}>🃏</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 11, fontWeight: 800 }}>{rankLabel(card.rank)}</span>
            <span style={{ fontSize: 14 }}>{suitSymbol(card.suit)}</span>
          </>
        )}
      </div>
      {selectionIndex !== undefined && (
        <div style={{
          position: 'absolute',
          top: -4,
          right: -4,
          width: 14,
          height: 14,
          borderRadius: 7,
          background: '#e2b858',
          color: '#2c1810',
          fontSize: 7,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 1,
        }}>
          {selectionIndex + 1}
        </div>
      )}
    </div>
  )
}

// ── Player group helpers ──────────────────────────────────────────────────────

interface PlayerGroup {
  playerId: string
  playerName: string
  melds: Meld[]
}

function buildGroups(melds: Meld[], currentPlayerId: string, players: Player[]): PlayerGroup[] {
  const map = new Map<string, PlayerGroup>()

  // Current player first
  const me = players.find(p => p.id === currentPlayerId)
  if (me) map.set(currentPlayerId, { playerId: currentPlayerId, playerName: me.name, melds: [] })

  // Others in player order
  for (const player of players) {
    if (!map.has(player.id)) {
      map.set(player.id, { playerId: player.id, playerName: player.name, melds: [] })
    }
  }

  // Distribute melds to groups
  for (const meld of melds) {
    let group = map.get(meld.ownerId)
    if (!group) {
      group = { playerId: meld.ownerId, playerName: meld.ownerName, melds: [] }
      map.set(meld.ownerId, group)
    }
    group.melds.push(meld)
  }

  return [...map.values()].filter(g => g.melds.length > 0)
}

// ── LayOffModal ───────────────────────────────────────────────────────────────

export default function LayOffModal({
  melds, currentPlayerId, currentPlayerName, hand, onLayOff, onGoOut, onDone, players, onJokerSwap,
}: Props) {
  const [selectedCards, setSelectedCards] = useState<CardType[]>([])
  const [layOffCount, setLayOffCount] = useState(0)
  const [pendingQueue, setPendingQueue] = useState<{ cards: CardType[], meldId: string } | null>(null)
  const [postLayOffScrollMeldId, setPostLayOffScrollMeldId] = useState<string | null>(null)

  const meldRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Intersection-based validMeldIds: a meld glows only if ALL selected cards fit it
  const validMeldIds = useMemo<Set<string> | null>(() => {
    if (selectedCards.length === 0) return null
    let intersection: Set<string> | null = null
    for (const card of selectedCards) {
      const validForCard = new Set(melds.filter(m => canLayOff(card, m)).map(m => m.id))
      if (intersection === null) {
        intersection = validForCard
      } else {
        for (const id of [...intersection]) {
          if (!validForCard.has(id)) intersection.delete(id)
        }
      }
    }
    return intersection ?? new Set()
  }, [selectedCards, melds])

  const hasValidMelds = validMeldIds !== null && validMeldIds.size > 0

  // Joker-swap targets: only when exactly one non-joker card is selected
  const swappableMelds = useMemo<Meld[]>(() => {
    if (!onJokerSwap || selectedCards.length !== 1 || selectedCards[0].suit === 'joker') return []
    const card = selectedCards[0]
    return melds.filter(m => m.type === 'run' && findSwappableJoker(card, m) !== null)
  }, [selectedCards, melds, onJokerSwap])

  // Auto-scroll to first valid meld when selection changes
  useEffect(() => {
    if (!hasValidMelds || !validMeldIds) return
    for (const [id, el] of meldRefs.current) {
      if (validMeldIds.has(id)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        break
      }
    }
  }, [selectedCards]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to tapped meld after lay-off
  useEffect(() => {
    if (!postLayOffScrollMeldId) return
    const el = meldRefs.current.get(postLayOffScrollMeldId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setPostLayOffScrollMeldId(null)
  }, [postLayOffScrollMeldId])

  // pendingQueue effect: process one card per render cycle so each onLayOff
  // sees the updated meld state from the parent before the next card is placed
  useEffect(() => {
    if (!pendingQueue || pendingQueue.cards.length === 0) return
    const [firstCard, ...rest] = pendingQueue.cards
    const currentMeld = melds.find(m => m.id === pendingQueue.meldId)
    if (!currentMeld) { setPendingQueue(null); return }
    const willGoOut = rest.length === 0 && hand.length === 1
    onLayOff(firstCard, currentMeld)
    if (willGoOut) onGoOut()
    setPendingQueue(rest.length > 0 ? { cards: rest, meldId: pendingQueue.meldId } : null)
  }, [pendingQueue, melds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamic subtitle
  let subtitle = 'Tap cards to select, then tap a meld'
  let subtitleColor = '#a8d0a8'
  if (selectedCards.length > 0) {
    if (hasValidMelds && swappableMelds.length > 0) {
      subtitle = `${validMeldIds!.size} lay-off · ${swappableMelds.length} joker swap`
      subtitleColor = '#6aad7a'
    } else if (hasValidMelds) {
      subtitle = `${validMeldIds!.size} valid meld${validMeldIds!.size !== 1 ? 's' : ''} — tap to lay off all`
      subtitleColor = '#6aad7a'
    } else if (swappableMelds.length > 0) {
      subtitle = `${swappableMelds.length} joker swap${swappableMelds.length !== 1 ? 's' : ''} available — see below`
      subtitleColor = '#e2b858'
    } else {
      subtitle = selectedCards.length === 1
        ? "This card doesn't fit any meld"
        : 'No single meld accepts all selected cards — try a different combination'
      subtitleColor = '#c08040'
    }
  }

  function handleCardSelect(card: CardType) {
    haptic('tap')
    setSelectedCards(prev => {
      const idx = prev.findIndex(c => c.id === card.id)
      if (idx >= 0) return prev.filter(c => c.id !== card.id)
      return [...prev, card]
    })
  }

  function handleMeldTap(meld: Meld) {
    if (selectedCards.length === 0 || !validMeldIds?.has(meld.id)) return
    haptic('tap')
    setLayOffCount(c => c + selectedCards.length)
    setPendingQueue({ cards: selectedCards, meldId: meld.id })
    setSelectedCards([])
    setPostLayOffScrollMeldId(meld.id)
  }

  function handleSwapTap(meld: Meld) {
    if (selectedCards.length !== 1 || !onJokerSwap) return
    const card = selectedCards[0]
    const joker = findSwappableJoker(card, meld)
    if (!joker) return
    haptic('success')
    const jokerIndex = meld.cards.findIndex(c => c.id === joker.id)
    onJokerSwap(card, meld, jokerIndex)
    setSelectedCards([])
  }

  const groups = buildGroups(melds, currentPlayerId, players)

  // Selection bar status
  let selectionStatus = ''
  if (selectedCards.length > 0) {
    if (hasValidMelds && swappableMelds.length > 0) {
      selectionStatus = `${validMeldIds!.size} lay-off · ${swappableMelds.length} swap below`
    } else if (hasValidMelds) {
      selectionStatus = `${validMeldIds!.size} meld${validMeldIds!.size !== 1 ? 's' : ''} accept all selected`
    } else if (swappableMelds.length > 0) {
      selectionStatus = `${swappableMelds.length} joker swap${swappableMelds.length !== 1 ? 's' : ''} available ↓`
    } else {
      selectionStatus = selectedCards.length === 1 ? 'No valid melds for this card' : 'No single meld accepts all'
    }
  }

  // Hint text for hand strip
  let hint = 'Tap a card to select it'
  if (selectedCards.length > 0) {
    if (hasValidMelds && swappableMelds.length > 0) {
      hint = 'Tap a glowing meld to lay off · tap a swap target below to swap the joker'
    } else if (hasValidMelds) {
      hint = 'Tap a glowing meld above to lay off all selected'
    } else if (swappableMelds.length > 0) {
      hint = 'Tap a glowing meld in the Swap section below to swap the joker'
    } else {
      hint = 'No valid melds — tap another card or Done'
    }
  }

  return (
    <>
      {/* Pulsing glow keyframe for valid melds */}
      <style>{`
        @keyframes lomPulse {
          0%, 100% { box-shadow: 0 0 6px rgba(106,173,122,0.4); }
          50%       { box-shadow: 0 0 18px rgba(106,173,122,0.9); }
        }
        @keyframes swapPulse {
          0%, 100% { box-shadow: 0 0 6px rgba(226,184,88,0.4); }
          50%       { box-shadow: 0 0 18px rgba(226,184,88,0.9); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          backgroundColor: '#1e4a2e',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Header (fixed) ─────────────────────────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            backgroundColor: '#0f2218',
            padding: '12px 14px',
            paddingTop: 'max(12px, env(safe-area-inset-top))',
            borderBottom: '1px solid #2d5a3a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <p style={{ color: '#a8d0a8', fontSize: 13, fontWeight: 500, margin: 0 }}>
              Lay Off Cards
            </p>
            <p style={{ color: subtitleColor, fontSize: 11, margin: '2px 0 0', transition: 'color 0.2s' }}>
              {subtitle}
            </p>
          </div>

          <button
            onClick={onDone}
            style={{
              background: '#e2b858',
              color: '#2c1810',
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              minHeight: 44,
              minWidth: 44,
            }}
          >
            Done ✓
          </button>
        </div>

        {/* ── Meld body (scrollable) ──────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {melds.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 80 }}>
              <p style={{ color: '#3a5a3a', fontSize: 12, fontStyle: 'italic', margin: 0 }}>
                No melds on the table yet
              </p>
            </div>
          ) : (
            groups.map((group, gi) => {
              const isMe = group.playerId === currentPlayerId
              return (
                <div key={group.playerId}>
                  {/* Divider between player groups */}
                  {gi > 0 && (
                    <div style={{ height: 1, backgroundColor: '#2d5a3a', marginBottom: 10 }} />
                  )}

                  {/* Player section label */}
                  <p style={{
                    color: isMe ? '#e2b858' : '#6aad7a',
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    margin: '0 0 6px 0',
                    lineHeight: 1,
                  }}>
                    {isMe ? 'Your melds' : group.playerName}
                  </p>

                  {/* Melds row — wraps if many */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {group.melds.map(meld => {
                      const isValid = validMeldIds?.has(meld.id) ?? false
                      const isDimmed = selectedCards.length > 0 && !isValid

                      return (
                        <div
                          key={meld.id}
                          ref={el => {
                            if (el) meldRefs.current.set(meld.id, el)
                            else meldRefs.current.delete(meld.id)
                          }}
                          onClick={() => handleMeldTap(meld)}
                          style={{
                            backgroundColor: '#0f2218',
                            border: isValid
                              ? '1.5px solid #6aad7a'
                              : isMe
                                ? '1.5px solid #3b6d3a'
                                : '1.5px solid #2d5a3a',
                            borderRadius: 8,
                            padding: '6px 8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            opacity: isDimmed ? 0.35 : 1,
                            cursor: isValid ? 'pointer' : 'default',
                            flexShrink: 0,
                            transition: 'opacity 0.15s',
                            animation: isValid ? 'lomPulse 1.4s ease-in-out infinite' : 'none',
                          }}
                        >
                          {/* Owner label above cards */}
                          <p style={{
                            fontSize: 8,
                            color: isValid ? '#6aad7a' : '#3a5a3a',
                            margin: 0,
                            lineHeight: 1,
                          }}>
                            {meld.type === 'run' ? 'run' : 'set'} · {isMe ? currentPlayerName.split(' ')[0] : meld.ownerName.split(' ')[0]}
                          </p>

                          {/* Full-size 36×50 cards */}
                          <div style={{ display: 'flex', gap: 2 }}>
                            {meld.cards.map(card => (
                              <ModalCard key={card.id} card={card} meld={meld} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}

          {/* ── Swap a Joker section ──────────────────────────────────────── */}
          {swappableMelds.length > 0 && (
            <>
              <div style={{ height: 1, backgroundColor: '#2d5a3a', margin: '10px 0 8px' }} />

              <p style={{
                color: '#e2b858',
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                margin: '0 0 4px',
                lineHeight: 1,
              }}>
                🔄 Swap a Joker
              </p>
              <p style={{ color: '#a8d0a8', fontSize: 10, margin: '0 0 8px', lineHeight: 1.3 }}>
                This card can replace a joker in a run. Tap to swap.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {swappableMelds.map(meld => {
                  const joker = findSwappableJoker(selectedCards[0], meld)!
                  return (
                    <div
                      key={meld.id}
                      onClick={() => handleSwapTap(meld)}
                      style={{
                        backgroundColor: '#0f2218',
                        border: '1.5px solid #e2b858',
                        borderRadius: 8,
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        cursor: 'pointer',
                        flexShrink: 0,
                        animation: 'swapPulse 1.4s ease-in-out infinite',
                      }}
                    >
                      <p style={{ fontSize: 8, color: '#e2b858', margin: 0, lineHeight: 1 }}>
                        run · {meld.ownerName.split(' ')[0]} — tap to swap joker
                      </p>
                      <div style={{ display: 'flex', gap: 2 }}>
                        {meld.cards.map(card => (
                          <div key={card.id} style={{ position: 'relative' }}>
                            <ModalCard card={card} meld={meld} />
                            {card.id === joker.id && (
                              <div style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: 5,
                                border: '2.5px solid #e2b858',
                                pointerEvents: 'none',
                              }} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Hand strip (fixed bottom) ───────────────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            backgroundColor: '#0f2218',
            borderTop: '1px solid #2d5a3a',
            padding: '10px 12px',
            paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
          }}
        >
          {/* Label row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <p style={{ color: '#6aad7a', fontSize: 9, fontWeight: 600, margin: 0 }}>
                Your hand ({hand.length} card{hand.length !== 1 ? 's' : ''})
              </p>
              {selectedCards.length > 0 && (
                <div style={{
                  background: '#e2b858',
                  color: '#2c1810',
                  fontSize: 8,
                  fontWeight: 700,
                  borderRadius: 8,
                  padding: '1px 6px',
                }}>
                  {selectedCards.length} selected
                </div>
              )}
            </div>
            {layOffCount > 0 && (
              <p style={{ color: '#e2b858', fontSize: 9, fontWeight: 600, margin: 0 }}>
                {layOffCount} laid off this turn
              </p>
            )}
          </div>

          {/* Selection bar */}
          <div style={{
            border: selectedCards.length > 0 ? '1.5px solid #e2b858' : '1.5px solid #2d5a3a',
            borderRadius: 6,
            padding: '6px 10px',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: selectedCards.length > 0 ? 1 : 0.5,
            background: '#0f2218',
            minHeight: 32,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {selectedCards.length === 0 ? (
                <p style={{ color: '#6aad7a', fontSize: 9, margin: 0, fontStyle: 'italic' }}>
                  No cards selected
                </p>
              ) : (
                <>
                  <p style={{
                    color: '#e2b858', fontSize: 10, margin: '0 0 1px', fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {selectedCards.map(c =>
                      c.suit === 'joker' ? 'JKR' : `${rankLabel(c.rank)}${suitSymbol(c.suit)}`
                    ).join(', ')}
                  </p>
                  <p style={{ color: hasValidMelds ? '#6aad7a' : '#c08040', fontSize: 9, margin: 0 }}>
                    {selectionStatus}
                  </p>
                </>
              )}
            </div>
            {selectedCards.length > 0 && (
              <button
                onClick={() => setSelectedCards([])}
                style={{
                  background: 'transparent',
                  border: '1px solid #3a5a3a',
                  borderRadius: 4,
                  color: '#6aad7a',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  marginLeft: 8,
                  minHeight: 24,
                }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Hint */}
          <p style={{ color: '#e2b858', fontSize: 9, margin: '0 0 8px', lineHeight: 1.3 }}>
            {hint}
          </p>

          {/* Cards — horizontal scroll */}
          {hand.length === 0 ? (
            <p style={{ color: '#6aad7a', fontSize: 11, fontStyle: 'italic', margin: 0 }}>
              Hand is empty — going out!
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 4,
                overflowX: 'auto',
                paddingBottom: 4,
                scrollbarWidth: 'none',
              }}
              className="[&::-webkit-scrollbar]:hidden"
            >
              {hand.map(card => {
                const selIdx = selectedCards.findIndex(c => c.id === card.id)
                return (
                  <ModalCard
                    key={card.id}
                    card={card}
                    selected={selIdx >= 0}
                    selectionIndex={selIdx >= 0 ? selIdx : undefined}
                    onClick={() => handleCardSelect(card)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
