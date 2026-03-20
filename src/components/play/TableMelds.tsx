import type { Card, Meld } from '../../game/types'
import { canLayOff } from '../../game/meld-validator'

// Props per UI/UX Spec Section 3
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

// ── Suit helpers ──────────────────────────────────────────────────────────────

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

function sortedSetCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const sd = (SUIT_SORT[a.suit] ?? 5) - (SUIT_SORT[b.suit] ?? 5)
    if (sd !== 0) return sd
    return a.rank - b.rank
  })
}

// ── Micro card (45×62px) ─────────────────────────────────────────────────────

function MicroCard({ card, meld }: { card: Card; meld: Meld }) {
  const isJoker = card.suit === 'joker'
  const layOffOwner = meld.cardOwners?.[card.id] ?? null

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
      <div
        style={{
          width: 38,
          height: 53,
          backgroundColor: suitBg(card.suit),
          border: layOffOwner ? '1px solid #e2b858' : '1px solid rgba(0,0,0,0.12)',
          borderRadius: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: suitColor(card.suit),
          lineHeight: 1,
          overflow: 'hidden',
          userSelect: 'none',
          position: 'relative',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px' }}>{rankPart}</span>
        {suitPart && <span style={{ fontSize: 12 }}>{suitPart}</span>}
      </div>
      {layOffOwner && (
        <span style={{
          fontSize: 7,
          color: '#e2b858',
          lineHeight: 1,
          marginTop: 1,
          maxWidth: 38,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}>
          {layOffOwner}
        </span>
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
  const isLayOffMode = selectedCard !== null

  // ── Empty state ──────────────────────────────────────────────────────────
  if (melds.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          backgroundColor: '#0f2218',
          borderRadius: 10,
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 49,
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
    <>
      <style>{`
        @keyframes tmPulse {
          0%, 100% { box-shadow: 0 0 4px rgba(106,173,122,0.4); }
          50%       { box-shadow: 0 0 12px rgba(106,173,122,0.85); }
        }
      `}</style>

      <div
        style={{
          width: '100%',
          backgroundColor: '#0f2218',
          borderRadius: 10,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {groups.map((group, gi) => {
          const isCurrentPlayer = group.ownerId === currentPlayerId

          return (
            <div key={group.ownerId}>
              {/* Player label */}
              <span
                style={{
                  color: isCurrentPlayer ? '#e2b858' : '#6aad7a',
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  lineHeight: 1,
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                {isCurrentPlayer ? 'You' : group.ownerName}
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
                        border: isValid ? '1px solid #6aad7a' : '1px solid #2d5a3a',
                        borderRadius: 6,
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'row',
                        gap: 4,
                        alignItems: 'center',
                        opacity: isDimmed ? 0.35 : 1,
                        cursor: isValid ? 'pointer' : 'default',
                        transition: 'opacity 0.15s',
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
