import { useState } from 'react'
import GameSetup from './play/GameSetup'
import GameBoard from './play/GameBoard'
import type { PlayerConfig, AIDifficulty } from '../game/types'

type PlayView = 'landing' | 'setup' | 'game'

const ROUNDS = [
  { num: 1, req: '2 Sets of 3+',    cards: 10 },
  { num: 2, req: '1 Set + 1 Run',   cards: 10 },
  { num: 3, req: '2 Runs of 4+',    cards: 10 },
  { num: 4, req: '3 Sets of 3+',    cards: 10 },
  { num: 5, req: '2 Sets + 1 Run',  cards: 12 },
  { num: 6, req: '1 Set + 2 Runs',  cards: 12 },
  { num: 7, req: '3 Runs of 4+',    cards: 12 },
]

const CHIPS = [
  'Jokers wild',
  '5 buys/round',
  "Can't go out by discarding",
  'Ace high or low',
]

interface Props {
  onBack?: () => void
}

// ── Fan card helpers ──────────────────────────────────────────────────────────

const FAN_ROTATIONS = [-15, -8, -2, 4, 10]

function FanCard({ index }: { index: number }) {
  const rotation = FAN_ROTATIONS[index]
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    width: 38,
    height: 52,
    borderRadius: 5,
    transform: `translateX(calc(-50% + ${(index - 2) * 24}px)) rotate(${rotation}deg)`,
    transformOrigin: 'bottom center',
    zIndex: index + 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    userSelect: 'none',
  }

  // Face-down cards
  if (index === 0 || index === 1) {
    return (
      <div style={{
        ...baseStyle,
        background: '#7a1a2e',
        border: '1.5px solid #a83050',
      }} />
    )
  }

  // A♥
  if (index === 2) {
    return (
      <div style={{
        ...baseStyle,
        background: '#fff0f0',
        border: '1.5px solid rgba(0,0,0,0.14)',
        color: '#c0393b',
        lineHeight: 1.1,
      }}>
        <span style={{ fontSize: 11, fontWeight: 800 }}>A</span>
        <span style={{ fontSize: 14 }}>♥</span>
      </div>
    )
  }

  // Joker
  if (index === 3) {
    return (
      <div style={{
        ...baseStyle,
        background: '#fff8e0',
        border: '1.5px solid rgba(0,0,0,0.14)',
        color: '#8b6914',
        lineHeight: 1.1,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700 }}>J</span>
        <span style={{ fontSize: 11 }}>★</span>
      </div>
    )
  }

  // K♠
  return (
    <div style={{
      ...baseStyle,
      background: '#eeecff',
      border: '1.5px solid rgba(0,0,0,0.14)',
      color: '#3d2b8e',
      lineHeight: 1.1,
    }}>
      <span style={{ fontSize: 11, fontWeight: 800 }}>K</span>
      <span style={{ fontSize: 14 }}>♠</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PlayTab({ onBack }: Props) {
  const [view, setView] = useState<PlayView>('landing')
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>([])
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium')
  const [buyLimit, setBuyLimit] = useState(5)

  function handleStart(players: PlayerConfig[], difficulty: AIDifficulty, limit: number) {
    setPlayerConfigs(players)
    setAiDifficulty(difficulty)
    setBuyLimit(limit)
    setView('game')
  }

  if (view === 'setup') {
    return (
      <GameSetup
        onStart={handleStart}
        onBack={() => setView('landing')}
      />
    )
  }

  if (view === 'game') {
    return (
      <GameBoard
        initialPlayers={playerConfigs}
        aiDifficulty={aiDifficulty}
        buyLimit={buyLimit}
        onExit={() => setView('landing')}
      />
    )
  }

  // ── Landing page ──────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100dvh',
      background: '#1a3a2a',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden',
    }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{
        background: '#0f2218',
        paddingTop: 'env(safe-area-inset-top, 48px)',
        paddingLeft: 14,
        paddingRight: 14,
        paddingBottom: 10,
        flexShrink: 0,
      }}>
        {onBack ? (
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a8d0a8',
              fontSize: 11,
              cursor: 'pointer',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minHeight: 44,
            }}
          >
            <span style={{ fontSize: 14 }}>←</span>
            <span>Home</span>
          </button>
        ) : (
          <div style={{ height: 44 }} />
        )}
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Hero section ─────────────────────────────────────────────── */}
        <div style={{
          background: '#0f2218',
          paddingTop: 24,
          paddingBottom: 32,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}>
          {/* Suit symbols */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 22, color: '#c0393b' }}>♥</span>
            <span style={{ fontSize: 22, color: '#c0393b' }}>♦</span>
            <span style={{ fontSize: 22, color: '#a8d0a8', opacity: 0.7 }}>♠</span>
            <span style={{ fontSize: 22, color: '#a8d0a8', opacity: 0.7 }}>♣</span>
          </div>

          {/* Title */}
          <p style={{
            color: '#e2b858',
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '2px',
            margin: 0,
            lineHeight: 1,
          }}>
            SHANGHAI
          </p>

          {/* Subtitle */}
          <p style={{ color: '#6aad7a', fontSize: 11, margin: 0 }}>
            Lowest score after 7 rounds wins
          </p>

          {/* Card fan */}
          <div style={{ position: 'relative', width: '100%', maxWidth: 280, height: 85, marginTop: 10 }}>
            {[0, 1, 2, 3, 4].map(i => <FanCard key={i} index={i} />)}
          </div>
        </div>

        {/* ── Body content ─────────────────────────────────────────────── */}
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Round list card */}
          <div style={{ background: '#0f2218', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: '1px solid #2d5a3a',
            }}>
              <span style={{ color: '#a8d0a8', fontSize: 11, fontWeight: 500 }}>The 7 Rounds</span>
              <span style={{ color: '#6aad7a', fontSize: 9 }}>Lowest total wins</span>
            </div>

            {/* Round rows */}
            {ROUNDS.map((r, i) => (
              <div
                key={r.num}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 12px',
                  borderBottom: i < ROUNDS.length - 1 ? '1px solid #1a3a2a' : 'none',
                }}
              >
                {/* Number circle */}
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  background: '#1e4a2e',
                  color: '#e2b858',
                  fontSize: 9,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {r.num}
                </div>

                {/* Requirement */}
                <span style={{ color: '#a8d0a8', fontSize: 11, flex: 1 }}>{r.req}</span>

                {/* Card count */}
                <span style={{ color: '#3a5a3a', fontSize: 9 }}>{r.cards} cards</span>
              </div>
            ))}
          </div>

          {/* Quick rules chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CHIPS.map(chip => (
              <div
                key={chip}
                style={{
                  background: '#0f2218',
                  border: '1px solid #2d5a3a',
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 9,
                  color: '#6aad7a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <div style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: '#e2b858',
                  flexShrink: 0,
                }} />
                {chip}
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <div style={{
        padding: 14,
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        background: '#1a3a2a',
        flexShrink: 0,
      }}>
        <button
          onClick={() => setView('setup')}
          style={{
            width: '100%',
            background: '#e2b858',
            color: '#2c1810',
            border: 'none',
            borderRadius: 12,
            padding: 14,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Start a Game →
        </button>
      </div>

    </div>
  )
}
