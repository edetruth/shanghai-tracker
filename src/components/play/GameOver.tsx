import { useState, useEffect, useRef } from 'react'
import { CheckCircle, AlertCircle, Loader } from 'lucide-react'
import type { Player } from '../../game/types'
import { completePlayedGame, saveGameEvents, type GameEvent } from '../../lib/gameStore'
import { PLAYER_COLORS } from '../../lib/constants'

interface Props {
  players: Player[]
  buyLimit: number
  buyLog: GameEvent[]
  gameId: string | null
  onPlayAgain: () => void
  onBack: () => void
}

// ── Confetti (spec §8.1) ─────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#e2b858', '#6aad7a', '#a080d0', '#c05050']

interface ConfettiPiece {
  x: number; y: number; vx: number; vy: number
  color: string; w: number; h: number
  rotation: number; rotV: number
}

function useConfetti(canvasRef: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Size canvas to CSS pixels
    canvas.width = canvas.offsetWidth || window.innerWidth
    canvas.height = canvas.offsetHeight || window.innerHeight

    const cw = canvas.width
    const ch = canvas.height

    const pieces: ConfettiPiece[] = Array.from({ length: 110 }, () => ({
      x: Math.random() * cw,
      y: Math.random() * -ch * 0.6,
      vx: (Math.random() - 0.5) * 3.5,
      vy: Math.random() * 3 + 1.5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      w: Math.random() * 9 + 4,
      h: Math.random() * 5 + 3,
      rotation: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.18,
    }))

    const startTime = Date.now()
    let rafId: number

    function draw() {
      if (!canvas || !ctx) return
      const elapsed = Date.now() - startTime

      // Fade out over last 500ms
      const opacity = elapsed > 2500 ? Math.max(0, 1 - (elapsed - 2500) / 500) : 1
      ctx.clearRect(0, 0, cw, ch)
      ctx.globalAlpha = opacity

      for (const p of pieces) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.06   // gravity
        p.rotation += p.rotV
        // Reset when off-bottom
        if (p.y > ch + 20) { p.y = -20; p.x = Math.random() * cw }
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      if (elapsed < 3000) {
        rafId = requestAnimationFrame(draw)
      } else {
        ctx.clearRect(0, 0, cw, ch)
      }
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function playerColor(idx: number): string {
  return PLAYER_COLORS[idx % PLAYER_COLORS.length]
}

function playerTotal(p: Player): number {
  return p.roundScores.reduce((s, n) => s + n, 0)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SaveBadge({ status }: { status: 'saving' | 'saved' | 'error' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
      {status === 'saving' && (
        <>
          <Loader size={11} className="animate-spin" style={{ color: '#6aad7a' }} />
          <span style={{ fontSize: 10, color: '#6aad7a' }}>Saving to history…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CheckCircle size={11} style={{ color: '#6aad7a' }} />
          <span style={{ fontSize: 10, color: '#6aad7a' }}>Saved to history</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle size={11} style={{ color: '#b83232' }} />
          <span style={{ fontSize: 10, color: '#b83232' }}>Not saved (offline?)</span>
        </>
      )}
    </div>
  )
}

function Avatar({
  player,
  playerIdx,
  size = 64,
  borderWidth = 3,
}: {
  player: Player
  playerIdx: number
  size?: number
  borderWidth?: number
}) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: playerColor(playerIdx),
        border: `${borderWidth}px solid #e2b858`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700, color: '#1a3a2a',
        userSelect: 'none',
      }}
    >
      {player.name.charAt(0).toUpperCase()}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GameOver({ players, buyLimit: _buyLimit, buyLog, gameId, onPlayAgain, onBack }: Props) {
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saving')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── Auto-save via pre-created game record ─────────────────────────────────
  useEffect(() => {
    if (!gameId) {
      setSaveStatus('error')
      return
    }
    const playerData = players.map(p => ({ name: p.name, roundScores: p.roundScores }))
    completePlayedGame(gameId, playerData)
      .then(async () => {
        await saveGameEvents(gameId, buyLog)
        setSaveStatus('saved')
      })
      .catch(() => setSaveStatus('error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Confetti animation ────────────────────────────────────────────────────
  useConfetti(canvasRef)

  // ── Standings ────────────────────────────────────────────────────────────
  const sorted = [...players].sort((a, b) => playerTotal(a) - playerTotal(b))
  const winnerScore = playerTotal(sorted[0])
  const winners = sorted.filter(p => playerTotal(p) === winnerScore)
  const isTie = winners.length > 1
  const soleWinner = isTie ? null : winners[0]

  return (
    <div
      style={{
        height: '100dvh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Confetti canvas — pointer-events none (spec §8.1) */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 10,
        }}
      />

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1 }}>

        {/* ── Winner announcement (spec §8.1) ─────────────────────────────── */}
        <div
          style={{
            paddingTop: 'max(24px, env(safe-area-inset-top))',
            paddingLeft: 16, paddingRight: 16, paddingBottom: 16,
            textAlign: 'center',
          }}
        >
          {/* "Game over" label */}
          <p style={{
            fontSize: 10, color: '#6aad7a',
            letterSpacing: 2, textTransform: 'uppercase', margin: 0,
          }}>
            Game over
          </p>

          {/* Trophy icon */}
          <div style={{ fontSize: 36, margin: '10px 0 8px', lineHeight: 1 }}>🏆</div>

          {/* Winner avatar(s) — side by side for ties (spec §8.2) */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
            {winners.map(w => (
              <Avatar key={w.id} player={w} playerIdx={players.indexOf(w)} size={64} />
            ))}
          </div>

          {/* Winner name (spec §8.2: tie detection) */}
          <p style={{ fontSize: 20, fontWeight: 700, color: '#e2b858', margin: 0 }}>
            {isTie
              ? `${winners.map(w => w.name).join(' and ')} tie!`
              : `${winners[0].name} wins!`}
          </p>
          <p style={{ fontSize: 11, color: '#6aad7a', margin: '4px 0 10px' }}>
            Lowest score after 7 rounds
          </p>

          {/* Save status badge */}
          <SaveBadge status={saveStatus} />

          {/* Winner stats bar — solo winner only (spec §8.1) */}
          {soleWinner && (() => {
            const timesOut = soleWinner.roundScores.filter(s => s === 0).length
            // Heuristic: rounds with score ≥ 80 indicate a full-hand (likely Shanghaied)
            const timesShanghaied = soleWinner.roundScores.filter(s => s >= 80).length
            const stats = [
              { label: 'Final score', value: String(playerTotal(soleWinner)) },
              { label: 'Went out', value: String(timesOut) },
              { label: 'Shanghaied', value: String(timesShanghaied) },
            ]
            return (
              <div
                style={{
                  background: '#0f2218',
                  border: '1px solid #e2b858',
                  borderRadius: 8,
                  display: 'flex',
                  marginTop: 12,
                }}
              >
                {stats.map((stat, si) => (
                  <div
                    key={si}
                    style={{
                      flex: 1, textAlign: 'center', padding: '10px 4px',
                      borderRight: si < stats.length - 1 ? '1px solid #2d5a3a' : 'none',
                    }}
                  >
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#e2b858', margin: 0 }}>
                      {stat.value}
                    </p>
                    <p style={{ fontSize: 9, color: '#6aad7a', margin: '2px 0 0' }}>
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        {/* ── Full scorecard table (spec §8.1) ─────────────────────────────── */}
        <div style={{ padding: '0 12px 16px' }}>
          <p style={{
            fontSize: 10, color: '#6aad7a',
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 0 8px',
          }}>
            Full scorecard — all 7 rounds
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table
              style={{ borderCollapse: 'collapse', width: '100%', minWidth: 360, fontSize: 11 }}
            >
              {/* Header */}
              <thead>
                <tr style={{ borderBottom: '1px solid #2d5a3a' }}>
                  {['#', 'Player', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'Total'].map((h, hi) => (
                    <th
                      key={h}
                      style={{
                        color: '#6aad7a', fontSize: 9, fontWeight: 600,
                        padding: '4px 5px',
                        textAlign: hi <= 1 ? 'left' : 'center',
                        whiteSpace: 'nowrap',
                        borderLeft: h === 'Total' ? '1px solid #2d5a3a' : 'none',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Data rows */}
              <tbody>
                {sorted.map((player, rowIdx) => {
                  const total = playerTotal(player)
                  const isWinnerRow = total === winnerScore
                  const rowBg = rowIdx % 2 === 0 ? '#0f2218' : '#1a3a2a'

                  return (
                    <tr key={player.id} style={{ background: rowBg }}>
                      {/* Rank */}
                      <td style={{
                        padding: '6px 5px', fontSize: 10,
                        color: isWinnerRow ? '#e2b858' : '#6aad7a',
                      }}>
                        {rowIdx + 1}
                      </td>

                      {/* Player name */}
                      <td style={{
                        padding: '6px 5px',
                        color: isWinnerRow ? '#e2b858' : '#a8d0a8',
                        fontWeight: isWinnerRow ? 600 : 400,
                        maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {player.name}
                      </td>

                      {/* R1–R7 */}
                      {Array.from({ length: 7 }).map((_, rIdx) => {
                        const s = player.roundScores[rIdx]
                        const isOut = s === 0
                        const isHigh = s !== undefined && s >= 80
                        const cellColor = isWinnerRow
                          ? '#e2b858'
                          : isOut
                            ? '#6aad7a'
                            : isHigh
                              ? '#b83232'
                              : '#a8d0a8'
                        return (
                          <td
                            key={rIdx}
                            style={{
                              padding: '6px 4px', textAlign: 'center',
                              color: cellColor,
                              fontWeight: isHigh ? 700 : 400,
                            }}
                          >
                            {s === undefined ? '—' : isOut ? 'Out' : isHigh ? `${s}!` : s}
                          </td>
                        )
                      })}

                      {/* Total */}
                      <td style={{
                        padding: '6px 5px', textAlign: 'center',
                        borderLeft: '1px solid #2d5a3a',
                        color: isWinnerRow ? '#e2b858' : '#a8d0a8',
                        fontWeight: 700,
                      }}>
                        {total}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Action buttons (spec §8.1) ────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex', gap: 10,
          padding: '12px 16px',
          paddingBottom: 'max(20px, calc(env(safe-area-inset-bottom) + 12px))',
          borderTop: '1px solid #2d5a3a',
        }}
      >
        <button
          onClick={onBack}
          style={{
            flex: 1,
            background: 'transparent',
            border: '1.5px solid #6aad7a',
            color: '#6aad7a',
            borderRadius: 10,
            padding: '12px 0',
            fontSize: 14, fontWeight: 600,
            cursor: 'pointer', minHeight: 44,
          }}
        >
          New game
        </button>
        <button
          onClick={onPlayAgain}
          style={{
            flex: 1,
            background: '#e2b858',
            color: '#2c1810',
            border: 'none',
            borderRadius: 10,
            padding: '12px 0',
            fontSize: 14, fontWeight: 700,
            cursor: 'pointer', minHeight: 44,
          }}
        >
          Play again
        </button>
      </div>
    </div>
  )
}
