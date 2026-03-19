import { useRef, useState, useEffect, useCallback } from 'react'
import type { Card, Meld } from '../../game/types'
import { canLayOff } from '../../game/meld-validator'

// Props per UI/UX Spec Section 3
// currentPlayerId/selectedCard/onLayOff are optional for backward compat with existing callers
// Legacy props (onMeldClick, highlightMeldId, jokerMeldIds, validLayOffMeldIds, layOffCard)
// are accepted but unused — kept so existing callers compile without changes.
interface Props {
  melds: Meld[]
  currentPlayerId?: string
  selectedCard?: Card | null
  onLayOff?: (card: Card, meld: Meld) => void
  jokerPosition?: number
  // Legacy props — accepted but no-op in new design
  onMeldClick?: (meld: Meld) => void
  highlightMeldId?: string
  jokerMeldIds?: Set<string>
  validLayOffMeldIds?: Set<string>
  layOffCard?: Card | null
}

// ── Suit helpers (matching spec Section 1.2) ─────────────────────────────────

const SUIT_SORT: Record<string, number> = { hearts: 0, diamonds: 1, clubs: 2, spades: 3, joker: 4 }

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

function getJokerLabel(meld: Meld, cardId: string): string {
  if (meld.type !== 'run') return 'JKR'
  const mapping = meld.jokerMappings.find(m => m.cardId === cardId)
  if (!mapping) return 'JKR'
  return `${rankLabel(mapping.representsRank)}${suitSymbol(mapping.representsSuit)}`
}

// Sort set-meld cards by suit order (hearts → diamonds → clubs → spades → joker)
function sortedSetCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const sd = (SUIT_SORT[a.suit] ?? 5) - (SUIT_SORT[b.suit] ?? 5)
    if (sd !== 0) return sd
    return a.rank - b.rank
  })
}

// ── Micro card (22×30px) ─────────────────────────────────────────────────────

function MicroCard({ card, meld }: { card: Card; meld: Meld }) {
  const isJoker = card.suit === 'joker'
  const label = isJoker
    ? getJokerLabel(meld, card.id)
    : `${rankLabel(card.rank)}${suitSymbol(card.suit)}`

  return (
    <div
      style={{
        width: 22,
        height: 30,
        backgroundColor: suitBg(card.suit),
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 7,
        fontWeight: 700,
        color: suitColor(card.suit),
        lineHeight: 1,
        letterSpacing: '-0.3px',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

// ── Player group grouping helpers ─────────────────────────────────────────────

interface PlayerGroup {
  ownerId: string
  ownerName: string
  melds: Meld[]
}

function buildGroups(melds: Meld[], currentPlayerId: string): PlayerGroup[] {
  const map = new Map<string, PlayerGroup>()

  // Current player's group first
  for (const meld of melds) {
    if (meld.ownerId === currentPlayerId && !map.has(meld.ownerId)) {
      map.set(meld.ownerId, { ownerId: meld.ownerId, ownerName: meld.ownerName, melds: [] })
    }
  }
  // Then others
  for (const meld of melds) {
    if (!map.has(meld.ownerId)) {
      map.set(meld.ownerId, { ownerId: meld.ownerId, ownerName: meld.ownerName, melds: [] })
    }
    map.get(meld.ownerId)!.melds.push(meld)
  }

  return [...map.values()]
}

// ── TableMelds ────────────────────────────────────────────────────────────────

export default function TableMelds({
  melds,
  currentPlayerId = '',
  selectedCard = null,
  onLayOff,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dots, setDots] = useState({ count: 1, active: 0 })

  const recalcDots = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const total = el.scrollWidth
    const visible = el.clientWidth
    if (total <= visible + 2) {
      setDots({ count: 1, active: 0 })
      return
    }
    const count = Math.max(2, Math.ceil(total / visible))
    const active = Math.round((el.scrollLeft / (total - visible)) * (count - 1))
    setDots({ count, active })
  }, [])

  // Recalculate dots when melds change (new content width)
  useEffect(() => {
    // rAF ensures DOM is painted before measuring
    const id = requestAnimationFrame(recalcDots)
    return () => cancelAnimationFrame(id)
  }, [melds, recalcDots])

  const isLayOffMode = selectedCard !== null

  // ── Empty state ──────────────────────────────────────────────────────────
  if (melds.length === 0) {
    return (
      <div
        style={{
          backgroundColor: '#0f2218',
          borderRadius: 10,
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 58,
        }}
      >
        <p style={{ color: '#3a5a3a', fontSize: 11, fontStyle: 'italic', margin: 0 }}>
          No melds on the table yet
        </p>
      </div>
    )
  }

  const groups = buildGroups(melds, currentPlayerId)

  return (
    <div style={{ backgroundColor: '#0f2218', borderRadius: 10, padding: 8 }}>
      {/* ── Horizontal scrollable strip ────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={recalcDots}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',           // Firefox
          msOverflowStyle: 'none',          // IE/Edge legacy
          WebkitOverflowScrolling: 'touch', // iOS momentum
        } as React.CSSProperties}
        // Hide webkit scrollbar via Tailwind arbitrary variant
        className="[&::-webkit-scrollbar]:hidden"
      >
        {groups.map((group, gi) => {
          const isCurrentPlayer = group.ownerId === currentPlayerId

          return (
            <div
              key={group.ownerId}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', flexShrink: 0 }}
            >
              {/* Thin vertical divider between player groups */}
              {gi > 0 && (
                <div
                  style={{
                    width: 1,
                    backgroundColor: '#2d5a3a',
                    alignSelf: 'stretch',
                    marginLeft: 6,
                    marginRight: 6,
                    flexShrink: 0,
                  }}
                />
              )}

              {/* Player group column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                {/* Player label */}
                <span
                  style={{
                    color: '#6aad7a',
                    fontSize: 8,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    lineHeight: 1,
                    paddingLeft: 2,
                  }}
                >
                  {isCurrentPlayer ? 'You' : group.ownerName}
                </span>

                {/* Melds row */}
                <div style={{ display: 'flex', flexDirection: 'row', gap: 4, alignItems: 'flex-start' }}>
                  {group.melds.map(meld => {
                    const isValid = isLayOffMode && canLayOff(selectedCard!, meld)
                    const isDimmed = isLayOffMode && !isValid
                    const displayCards =
                      meld.type === 'set' ? sortedSetCards(meld.cards) : meld.cards

                    return (
                      <div
                        key={meld.id}
                        onClick={isValid && onLayOff ? () => onLayOff(selectedCard!, meld) : undefined}
                        style={{
                          backgroundColor: '#1e4a2e',
                          border: isValid
                            ? '2px solid #6aad7a'
                            : isCurrentPlayer
                              ? '1px solid #3b6d3a'
                              : '1px solid #2d5a3a',
                          borderRadius: 6,
                          padding: '4px 5px',
                          display: 'flex',
                          flexDirection: 'row',
                          gap: 2,
                          alignItems: 'center',
                          opacity: isDimmed ? 0.4 : 1,
                          cursor: isValid ? 'pointer' : 'default',
                          flexShrink: 0,
                          transition: 'opacity 0.15s',
                          // Pulsing green glow on valid targets
                          animation: isValid ? 'tmPulse 1.4s ease-in-out infinite' : 'none',
                        }}
                      >
                        {displayCards.map(card => (
                          <MicroCard key={card.id} card={card} meld={meld} />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Scroll position dots ───────────────────────────────────────── */}
      {dots.count > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 4,
            marginTop: 6,
          }}
        >
          {Array.from({ length: dots.count }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === dots.active ? 12 : 4,
                height: 4,
                borderRadius: i === dots.active ? 2 : '50%',
                backgroundColor: i === dots.active ? '#6aad7a' : '#2d5a3a',
                transition: 'width 0.2s ease, border-radius 0.2s ease',
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* Keyframe for valid-target pulse */}
      <style>{`
        @keyframes tmPulse {
          0%, 100% { box-shadow: 0 0 4px rgba(106,173,122,0.4); }
          50%       { box-shadow: 0 0 12px rgba(106,173,122,0.85); }
        }
      `}</style>
    </div>
  )
}
