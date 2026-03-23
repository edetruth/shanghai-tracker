import { useState, useEffect, useMemo } from 'react'
import type { Player, Card as CardType } from '../../game/types'
import { ROUNDS, PLAYER_COLORS } from '../../lib/constants'
import { TOTAL_ROUNDS } from '../../game/rules'

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

// ── AnimatedNumber (count-up effect) ────────────────────────────────────────

function AnimatedNumber({ from, to, duration = 500 }: { from: number; to: number; duration?: number }) {
  const [display, setDisplay] = useState(from)

  useEffect(() => {
    if (from === to) { setDisplay(to); return }
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      setDisplay(Math.round(from + (to - from) * progress))
      if (progress >= 1) clearInterval(interval)
    }, 16)
    return () => clearInterval(interval)
  }, [from, to, duration])

  return <>{display}</>
}

// ── Card label helpers ────────────────────────────────────────────────────────

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

function cardLabel(card: CardType): string {
  return card.suit === 'joker' ? 'JKR' : `${rankLabel(card.rank)}${suitSymbol(card.suit)}`
}

// ── Player color (deterministic from index, same as rest of app) ──────────────

function playerColor(idx: number): string {
  return PLAYER_COLORS[idx % PLAYER_COLORS.length]
}

// ── Avatar circle ─────────────────────────────────────────────────────────────

function Avatar({ color, name }: { color: string; name: string }) {
  return (
    <div
      style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#1a3a2a', userSelect: 'none',
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ── Rank badge (spec §6 score rows) ──────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const bg = rank === 1 ? '#e2b858' : rank === 2 ? '#2d5a3a' : '#1a3a2a'
  const color = rank === 1 ? '#2c1810' : rank === 2 ? '#a8d0a8' : '#2d5a3a'
  return (
    <div
      style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        background: bg, color, fontSize: 9, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {rank}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoundSummary({ players, roundResults, roundNum, onNext, isLastRound }: Props) {
  const [tab, setTab] = useState<'round' | 'standings'>('round')
  const [visible, setVisible] = useState(false)
  const [showShanghai, setShowShanghai] = useState(false)
  const [revealedCount, setRevealedCount] = useState(0)

  const roundInfo = ROUNDS[roundNum - 1]

  // Next round preview info
  const nextRoundInfo = !isLastRound ? ROUNDS[roundNum] : null // roundNum is current (1-indexed), so ROUNDS[roundNum] is next

  // Fade in on mount (spec §6.1)
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Dramatic Shanghai overlay — 1+ players caught
  const shanghaiedCount = roundResults.filter(r => r.shanghaied).length
  useEffect(() => {
    if (shanghaiedCount >= 1) {
      setShowShanghai(true)
      const t = setTimeout(() => setShowShanghai(false), 2500)
      return () => clearTimeout(t)
    }
  }, [shanghaiedCount])

  // Winner = player who went out (score 0, not shanghaied)
  const winnerResult = roundResults.find(r => r.score === 0 && !r.shanghaied)
  const winner = winnerResult ? players.find(p => p.id === winnerResult.playerId) ?? null : null

  // Sorted for "This round" tab: round score ascending (spec §6 score rows)
  const sortedByRound = useMemo(
    () =>
      [...players].sort((a, b) => {
        const ra = roundResults.find(r => r.playerId === a.id)?.score ?? 999
        const rb = roundResults.find(r => r.playerId === b.id)?.score ?? 999
        return ra - rb
      }),
    [players, roundResults]
  )

  // Staggered reveal for round tab — shanghaied players get +200ms extra
  useEffect(() => {
    let cumulativeDelay = 500
    const timers = sortedByRound.map((p, i) => {
      const isShanghaied = roundResults.find(r => r.playerId === p.id)?.shanghaied ?? false
      const delay = cumulativeDelay
      cumulativeDelay += 400 + (isShanghaied ? 200 : 0)
      return setTimeout(() => setRevealedCount(i + 1), delay)
    })
    return () => timers.forEach(clearTimeout)
  }, [sortedByRound.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sorted for "Standings" tab: cumulative total ascending
  const sortedByTotal = useMemo(
    () =>
      [...players].sort((a, b) => {
        const ta = a.roundScores.reduce((s, n) => s + n, 0)
        const tb = b.roundScores.reduce((s, n) => s + n, 0)
        return ta - tb
      }),
    [players]
  )

  const activeList = tab === 'round' ? sortedByRound : sortedByTotal
  const displayList = tab === 'round' ? activeList.slice(0, revealedCount) : activeList

  return (
    <div
      style={{
        height: '100dvh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Dramatic Shanghai overlay */}
      {showShanghai && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)', pointerEvents: 'none',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 52, fontWeight: 900, color: '#e2b858', letterSpacing: 4, margin: 0, animation: 'slam-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
              SHANGHAI!
            </p>
            <p style={{ fontSize: 16, color: '#fff', marginTop: 8 }}>
              {shanghaiedCount >= 2 ? `${shanghaiedCount} players caught!` : 'Caught without laying down!'}
            </p>
          </div>
        </div>
      )}

      {/* ── Header (spec §6.2) ───────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingLeft: 16, paddingRight: 16, paddingBottom: 14,
          textAlign: 'center',
        }}
      >
        {/* Small label */}
        <p style={{
          fontSize: 10, color: '#6aad7a', letterSpacing: 1,
          textTransform: 'uppercase', margin: 0,
        }}>
          Round {roundNum} complete
        </p>

        {/* Large requirement title */}
        <p style={{ fontSize: 22, fontWeight: 700, color: '#e2b858', margin: '4px 0 14px' }}>
          {roundInfo?.name ?? `Round ${roundNum}`}
        </p>

        {/* 7 progress pips */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
          {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => {
            const isDone = i + 1 < roundNum
            const isCurrent = i + 1 === roundNum
            return (
              <div
                key={i}
                style={{
                  height: 4,
                  width: isCurrent ? 24 : isDone ? 20 : 16,
                  borderRadius: 2,
                  background: isCurrent ? '#e2b858' : isDone ? '#6aad7a' : '#2d5a3a',
                }}
              />
            )
          })}
        </div>
      </div>

      {/* ── Scrollable content ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 8px' }}>

        {/* Who went out banner (spec §6.2) */}
        {winner && (
          <div
            style={{
              background: '#0f2218', border: '1px solid #6aad7a', borderRadius: 8,
              padding: '10px 12px', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <Avatar color={playerColor(players.indexOf(winner))} name={winner.name} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#a8d0a8', margin: 0 }}>
                {winner.name}
                <span style={{ fontWeight: 400, color: '#6aad7a' }}> went out!</span>
              </p>
              <p style={{ fontSize: 10, color: '#6aad7a', margin: '2px 0 0' }}>
                Scores 0 points this round
              </p>
            </div>
            <span style={{
              background: '#6aad7a', color: '#0f2218',
              fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 8px', flexShrink: 0,
            }}>
              Out!
            </span>
          </div>
        )}

        {/* Tab row (spec §6) */}
        <div
          style={{
            display: 'flex', background: '#0f2218', borderRadius: 8,
            border: '1px solid #2d5a3a', overflow: 'hidden', marginBottom: 10,
          }}
        >
          {(['round', 'standings'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '9px 0', fontSize: 12,
                fontWeight: tab === t ? 500 : 400,
                background: tab === t ? '#1e4a2e' : 'transparent',
                color: tab === t ? '#e2b858' : '#6aad7a',
                border: 'none', cursor: 'pointer', transition: 'background 0.15s',
              }}
            >
              {t === 'round' ? 'This round' : 'Standings'}
            </button>
          ))}
        </div>

        {/* Score rows (spec §6 score rows) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {displayList.map((player, rankIdx) => {
            const playerIdx = players.indexOf(player)
            const result = roundResults.find(r => r.playerId === player.id)
            if (!result) return null

            const total = player.roundScores.reduce((s, n) => s + n, 0)
            const isOut = player.id === winner?.id
            const isShanghaied = result.shanghaied
            const rank = rankIdx + 1

            // Border colour per spec
            const borderColor = isOut ? '#e2b858' : isShanghaied ? '#b83232' : '#2d5a3a'

            // Round score colour: green if 0 (out), red if shanghaied, cream otherwise
            const scoreColor = result.score === 0 ? '#6aad7a' : isShanghaied ? '#b83232' : '#e2ddd2'

            return (
              <div
                key={player.id}
                style={{
                  background: '#0f2218',
                  border: `1px solid ${borderColor}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  opacity: isShanghaied ? 0.9 : 1,
                  animation: tab === 'round'
                    ? (rank === 1 ? 'slide-up-fade 300ms ease-out both, winner-flash 600ms ease-out 300ms both' : 'slide-up-fade 300ms ease-out both')
                    : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Rank badge */}
                  <RankBadge rank={rank} />

                  {/* Avatar */}
                  <Avatar color={playerColor(playerIdx)} name={player.name} />

                  {/* Name + status badges */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#a8d0a8' }}>
                        {player.name}
                      </span>
                      {isOut && (
                        <span style={{
                          background: '#6aad7a', color: '#0f2218',
                          fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '1px 5px',
                        }}>
                          Out!
                        </span>
                      )}
                      {isShanghaied && (
                        <span className="animate-slam-in" style={{
                          background: '#b83232', color: '#fff',
                          fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '1px 5px',
                          display: 'inline-block',
                        }}>
                          Shanghaied!
                        </span>
                      )}
                    </div>

                    {/* Card detail pills — for non-out players with remaining cards (spec §6) */}
                    {!isOut && player.hand.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                        {player.hand.map((card: CardType, cardIdx: number) => (
                          <span
                            key={card.id}
                            style={{
                              background: '#1e4a2e', color: '#6aad7a',
                              fontSize: 8, fontWeight: 600, borderRadius: 3, padding: '1px 5px',
                              animationDelay: `${cardIdx * 50}ms`,
                              ...(isShanghaied ? { animation: 'slam-in 0.3s cubic-bezier(0.34,1.56,0.64,1) both' } : {}),
                            }}
                          >
                            {cardLabel(card)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Score column — right-aligned (spec §6) */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {tab === 'round' ? (
                      <>
                        <p style={{ fontSize: 18, fontWeight: 700, color: scoreColor, margin: 0, lineHeight: 1 }}>
                          {result.score === 0 ? '0' : `+${result.score}`}
                        </p>
                        <p style={{ fontSize: 10, color: '#6aad7a', margin: '2px 0 0' }}>
                          <AnimatedNumber from={total - result.score} to={total} /> total
                        </p>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: 18, fontWeight: 700, color: '#e2ddd2', margin: 0, lineHeight: 1 }}>
                          {total}
                        </p>
                        <p style={{ fontSize: 10, color: '#6aad7a', margin: '2px 0 0' }}>
                          +{result.score} this round
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Continue button (spec §6) ─────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 16px',
          paddingBottom: 'max(20px, calc(env(safe-area-inset-bottom) + 12px))',
          borderTop: '1px solid #2d5a3a',
        }}
      >
        <button
          onClick={onNext}
          style={{
            width: '100%',
            background: '#e2b858',
            color: '#2c1810',
            border: 'none',
            borderRadius: 10,
            padding: '12px 0',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>
            {isLastRound ? 'See Final Results \u2192' : `Start Round ${roundNum + 1} \u2192`}
          </span>
          {nextRoundInfo && (
            <span style={{ display: 'block', fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              {nextRoundInfo.name} \u00b7 {nextRoundInfo.cards} cards
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
