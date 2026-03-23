import { useMemo, useState, useEffect, useRef } from 'react'
import type { Card, Meld } from '../../game/types'
import { canLayOff, findSwappableJoker } from '../../game/meld-validator'

interface Props {
  melds: Meld[]
  currentPlayerId?: string
  humanPlayerIds?: Set<string>
  selectedCard?: Card | null
  onLayOff?: (card: Card, meld: Meld) => void
  onJokerSwap?: (naturalCard: Card, meld: Meld) => void
  justLaidOffCardIds?: Set<string>
}

// ── Card overlap helper ───────────────────────────────────────────────────────

function getMeldCardOverlap(cardCount: number): number {
  if (cardCount <= 5) return 0
  if (cardCount <= 7) return 10
  if (cardCount <= 9) return 16
  if (cardCount <= 11) return 22
  return 26
}

// ── Suit helpers ──────────────────────────────────────────────────────────────

const SUIT_SORT: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }

// Match the hand Card.tsx suit colors exactly for visual consistency
function suitBg(suit: string): string {
  if (suit === 'joker') return '#fff8e0'
  if (suit === 'hearts') return '#fff0f0'
  if (suit === 'diamonds') return '#f0f5ff'
  if (suit === 'clubs') return '#e0f7e8'
  return '#eeecff' // spades
}

function suitColor(suit: string): string {
  if (suit === 'joker') return '#8b6914'
  if (suit === 'hearts') return '#c0393b'
  if (suit === 'diamonds') return '#2158b8'
  if (suit === 'clubs') return '#1a6b3a'
  return '#3d2b8e' // spades
}

function rankLabel(rank: number): string {
  if (rank === 0) return 'JKR'
  if (rank === 1) return 'A'
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

function sortedSetCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const sd = (SUIT_SORT[a.suit] ?? 5) - (SUIT_SORT[b.suit] ?? 5)
    if (sd !== 0) return sd
    return a.rank - b.rank
  })
}

// ── Micro card (34×48px) ─────────────────────────────────────────────────────

function MicroCard({ card, meld, highlight }: { card: Card; meld: Meld; highlight?: boolean }) {
  const isJoker = card.suit === 'joker'

  let rankPart: string
  let suitPart: string

  if (isJoker) {
    if (meld.type !== 'run') {
      rankPart = 'JKR'
      suitPart = ''
    } else {
      const mapping = meld.jokerMappings.find(m => m.cardId === card.id)
      rankPart = mapping ? rankLabel(mapping.representsRank) : 'JKR'
      suitPart = mapping ? suitSymbol(mapping.representsSuit) : ''
    }
  } else {
    rankPart = rankLabel(card.rank)
    suitPart = suitSymbol(card.suit)
  }

  const color = suitColor(card.suit)

  return (
    <div
      style={{
        width: 36,
        height: 52,
        background: isJoker
          ? 'linear-gradient(135deg, #f5e6a3, #e2b858 50%, #c9952c)'
          : suitBg(card.suit),
        border: isJoker
          ? (highlight ? '2px solid #e2b858' : '2px solid #c9952c')
          : (highlight ? '2px solid #e2b858' : '1.5px solid rgba(255,255,255,0.25)'),
        borderRadius: 5,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexShrink: 0,
        color: isJoker ? '#6b4c1e' : color,
        lineHeight: 1,
        overflow: 'hidden',
        userSelect: 'none',
        boxShadow: highlight
          ? '0 0 6px rgba(226,184,88,0.6), 0 1px 3px rgba(0,0,0,0.3)'
          : isJoker
            ? '0 0 6px rgba(226,184,88,0.25), 0 1px 3px rgba(0,0,0,0.25)'
            : '0 1px 3px rgba(0,0,0,0.25)',
        padding: 2,
      }}
    >
      {isJoker ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 1 }}>
          <span style={{ fontSize: 12, lineHeight: 1 }}>👑</span>
          <span style={{ fontSize: 7, fontWeight: 900, letterSpacing: '0.5px' }}>{rankPart || 'JKR'}</span>
        </div>
      ) : (
        <>
          {/* Top-left rank + suit */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '-0.3px' }}>{rankPart}</span>
            <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, marginTop: -1 }}>{suitPart}</span>
          </div>

          {/* Center suit watermark */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              opacity: 0.15,
              pointerEvents: 'none',
              color,
            }}
          >
            {suitPart}
          </div>

          {/* Bottom-right rank + suit (rotated) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', alignSelf: 'flex-end', lineHeight: 1, transform: 'rotate(180deg)' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '-0.3px' }}>{rankPart}</span>
            <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, marginTop: -1 }}>{suitPart}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Player group helpers ──────────────────────────────────────────────────────

interface PlayerGroup {
  ownerId: string
  ownerName: string
  melds: Meld[]
}

function buildGroups(melds: Meld[], humanPlayerIds: Set<string>): PlayerGroup[] {
  // Build groups in first-seen order (order players laid down)
  const map = new Map<string, PlayerGroup>()
  for (const meld of melds) {
    if (!map.has(meld.ownerId)) {
      map.set(meld.ownerId, { ownerId: meld.ownerId, ownerName: meld.ownerName, melds: [] })
    }
    map.get(meld.ownerId)!.melds.push(meld)
  }

  // Partition: human players first (preserving first-laid-down order), then AI
  const humans: PlayerGroup[] = []
  const others: PlayerGroup[] = []
  for (const group of map.values()) {
    if (humanPlayerIds.has(group.ownerId)) {
      humans.push(group)
    } else {
      others.push(group)
    }
  }
  return [...humans, ...others]
}

// ── TableMelds ────────────────────────────────────────────────────────────────

export default function TableMelds({
  melds,
  currentPlayerId = '',
  humanPlayerIds = new Set(),
  selectedCard = null,
  onLayOff,
  onJokerSwap,
  justLaidOffCardIds,
}: Props) {
  // ── Staggered meld entrance animation ──────────────────────────────────
  const prevMeldIdsRef = useRef<Set<string>>(new Set())
  const [newMeldIds, setNewMeldIds] = useState<Set<string>>(new Set())
  const [visibleMeldIds, setVisibleMeldIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(melds.map(m => m.id))
    const fresh = [...currentIds].filter(id => !prevMeldIdsRef.current.has(id))

    if (fresh.length > 0) {
      setNewMeldIds(new Set(fresh))
      // Stagger: reveal each meld 300ms apart
      const timers = fresh.map((id, i) =>
        setTimeout(() => {
          setVisibleMeldIds(prev => new Set([...prev, id]))
        }, i * 300)
      )
      // Clear animation state after all are shown
      const clearTimer = setTimeout(() => {
        setNewMeldIds(new Set())
        setVisibleMeldIds(new Set())
      }, fresh.length * 300 + 500)

      prevMeldIdsRef.current = currentIds
      return () => {
        timers.forEach(clearTimeout)
        clearTimeout(clearTimer)
      }
    }
    prevMeldIdsRef.current = currentIds
  }, [melds])
  const isLayOffMode = selectedCard !== null

  // Compute valid lay-off targets and joker swap targets
  const validLayOffIds = useMemo<Set<string>>(() => {
    if (!selectedCard) return new Set()
    return new Set(melds.filter(m => canLayOff(selectedCard, m)).map(m => m.id))
  }, [selectedCard, melds])

  const swapMeldIds = useMemo<Set<string>>(() => {
    if (!selectedCard || selectedCard.suit === 'joker' || !onJokerSwap) return new Set()
    return new Set(
      melds.filter(m => m.type === 'run' && findSwappableJoker(selectedCard, m) !== null).map(m => m.id)
    )
  }, [selectedCard, melds, onJokerSwap])

  // ── Empty state ──────────────────────────────────────────────────────────
  if (melds.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          backgroundColor: '#0f2218',
          borderRadius: 10,
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 42,
        }}
      >
        <p style={{ color: '#3a5a3a', fontSize: 11, fontStyle: 'italic', margin: 0 }}>
          No melds on the table yet
        </p>
      </div>
    )
  }

  const groups = buildGroups(melds, humanPlayerIds)

  return (
    <>
      <style>{`
        @keyframes tmPulse {
          0%, 100% { box-shadow: 0 0 4px rgba(106,173,122,0.4); }
          50%       { box-shadow: 0 0 12px rgba(106,173,122,0.85); }
        }
        @keyframes tmSwapPulse {
          0%, 100% { box-shadow: 0 0 4px rgba(226,184,88,0.4); }
          50%       { box-shadow: 0 0 12px rgba(226,184,88,0.85); }
        }
      `}</style>

      <div
        style={{
          width: '100%',
          backgroundColor: '#0f2218',
          borderRadius: 10,
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {groups.map((group, gi) => {
          const isCurrentPlayer = group.ownerId === currentPlayerId
          const isHuman = humanPlayerIds.has(group.ownerId)

          return (
            <div key={group.ownerId}>
              {/* Player label */}
              <span
                style={{
                  color: isCurrentPlayer ? '#e2b858' : isHuman ? '#c8e0c8' : '#6aad7a',
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  lineHeight: 1,
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                {isCurrentPlayer && isHuman ? 'You' : group.ownerName}
              </span>

              {/* Melds row — wraps to next line as needed */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {group.melds.map(meld => {
                  const isLayOffValid = isLayOffMode && validLayOffIds.has(meld.id)
                  const isSwapValid = isLayOffMode && !isLayOffValid && swapMeldIds.has(meld.id)
                  const isDimmed = isLayOffMode && !isLayOffValid && !isSwapValid
                  const isInteractive = isLayOffValid || isSwapValid
                  const displayCards =
                    meld.type === 'set' ? sortedSetCards(meld.cards) : meld.cards

                  // Find the joker that would be swapped (for highlighting)
                  const swapJoker = isSwapValid && selectedCard
                    ? findSwappableJoker(selectedCard, meld)
                    : null

                  // Check if any card in this meld was just laid off
                  const hasNewLayOff = displayCards.some(c => justLaidOffCardIds?.has(c.id))

                  // Staggered entrance animation logic
                  const isNewMeld = newMeldIds.has(meld.id)
                  const isVisibleNew = visibleMeldIds.has(meld.id)

                  function handleTap() {
                    if (isLayOffValid && onLayOff && selectedCard) {
                      onLayOff(selectedCard, meld)
                    } else if (isSwapValid && onJokerSwap && selectedCard) {
                      onJokerSwap(selectedCard, meld)
                    }
                  }

                  return (
                    <div
                      key={meld.id}
                      data-meld-id={meld.id}
                      onClick={isInteractive ? handleTap : undefined}
                      style={{
                        backgroundColor: '#1e4a2e',
                        border: isLayOffValid
                          ? '1px solid #6aad7a'
                          : isSwapValid
                            ? '1px solid #e2b858'
                            : '1px solid #2d5a3a',
                        borderRadius: 6,
                        padding: '4px 6px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        opacity: isNewMeld && !isVisibleNew ? 0 : isDimmed ? 0.35 : 1,
                        cursor: isInteractive ? 'pointer' : 'default',
                        transition: 'opacity 0.15s',
                        animation: isLayOffValid
                          ? 'tmPulse 1.4s ease-in-out infinite'
                          : isSwapValid
                            ? 'tmSwapPulse 1.4s ease-in-out infinite'
                            : isNewMeld && isVisibleNew
                              ? 'meld-slam 400ms ease-out both'
                              : hasNewLayOff
                                ? 'meld-expand 400ms ease-out'
                                : 'none',
                      }}
                    >
                      {/* Tap hint label */}
                      {isLayOffValid && (
                        <span style={{ fontSize: 8, color: '#6aad7a', fontWeight: 600, lineHeight: 1 }}>
                          tap to lay off
                        </span>
                      )}
                      {isSwapValid && (
                        <span style={{ fontSize: 8, color: '#e2b858', fontWeight: 600, lineHeight: 1 }}>
                          tap to swap joker
                        </span>
                      )}

                      {/* Cards row — overlap for long melds */}
                      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
                        {displayCards.map((card, i) => (
                          <div
                            key={card.id}
                            className={justLaidOffCardIds?.has(card.id) ? 'animate-card-join' : ''}
                            style={{
                              marginLeft: i === 0 ? 0 : 3 - getMeldCardOverlap(displayCards.length),
                              zIndex: i,
                              flexShrink: 0,
                            }}
                          >
                            <MicroCard
                              card={card}
                              meld={meld}
                              highlight={swapJoker ? card.id === swapJoker.id : false}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Thin divider after each player section except the last */}
              {gi < groups.length - 1 && (
                <div style={{ height: 1, backgroundColor: '#2d5a3a', marginTop: 4 }} />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
