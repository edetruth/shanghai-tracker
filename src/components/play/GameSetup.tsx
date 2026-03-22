import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { PLAYER_COLORS } from '../../lib/constants'
import type { PlayerConfig, AIPersonality } from '../../game/types'
import { PERSONALITIES } from '../../game/types'

interface Props {
  onStart: (players: PlayerConfig[], personality: AIPersonality, buyLimit: number, tournamentMode: boolean) => void
  onBack: () => void
}

const BUY_OPTIONS: { label: string; value: number }[] = [
  { label: 'Off', value: 0 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '7', value: 7 },
  { label: '10', value: 10 },
  { label: '\u221e', value: -1 },
]

function deckCount(n: number) { return n <= 4 ? 2 : 3 }
function jokerCount(n: number) { return deckCount(n) * 2 }

// ── Progress pills ──────────────────────────────────────────────────────────
function ProgressPills({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 0 20px' }}>
      {[1, 2, 3].map(n => (
        <div
          key={n}
          style={{
            height: 6,
            borderRadius: 3,
            width: n === step ? 24 : 16,
            background: n === step ? '#e2b858' : n < step ? '#6aad7a' : '#2d5a3a',
            transition: 'width 200ms ease, background 200ms ease',
          }}
        />
      ))}
    </div>
  )
}

// ── Step 1 — Player count ───────────────────────────────────────────────────
function Step1({
  selected,
  onSelect,
}: {
  selected: number | null
  onSelect: (n: number) => void
}) {
  return (
    <div>
      <p style={{ color: '#6aad7a', fontSize: 12, marginBottom: 4 }}>Step 1 of 3</p>
      <h2 style={{ color: '#ffffff', fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        How many players?
      </h2>

      {/* 2x4 preset grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[2, 3, 4, 5, 6, 7, 8].map(count => {
          const isOn = selected === count
          const dc = deckCount(count)
          return (
            <button
              key={count}
              onClick={() => onSelect(count)}
              style={{
                border: `2px solid ${isOn ? '#e2b858' : '#2d5a3a'}`,
                background: isOn ? '#1e3010' : '#0f2218',
                borderRadius: 10,
                padding: '10px 6px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                transition: 'border-color 150ms, background 150ms',
                minHeight: 88,
              }}
            >
              {/* Large number */}
              <span style={{ fontSize: 26, fontWeight: 700, color: isOn ? '#e2b858' : '#a8d0a8', lineHeight: 1 }}>
                {count}
              </span>
              {/* Deck label */}
              <span style={{ fontSize: 10, color: '#6aad7a' }}>{dc} decks</span>
              {/* Player dots */}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 3, maxWidth: 40 }}>
                {Array.from({ length: count }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: isOn ? '#e2b858' : '#2d5a3a',
                    }}
                  />
                ))}
              </div>
            </button>
          )
        })}
      </div>

      {/* Deck info bar */}
      <div
        style={{
          marginTop: 14,
          padding: '10px 14px',
          background: '#0f2218',
          border: '1px solid #2d5a3a',
          borderRadius: 8,
          color: selected ? '#a8d0a8' : '#4a7a5a',
          fontSize: 13,
          textAlign: 'center',
          transition: 'color 200ms',
        }}
      >
        {selected
          ? `${selected} players \u00b7 ${deckCount(selected)} decks \u00b7 ${jokerCount(selected)} jokers`
          : 'Select a player count above'}
      </div>
    </div>
  )
}

// ── Step 2 — Name players ───────────────────────────────────────────────────
function Step2({
  players,
  onNameChange,
  onToggleAI,
}: {
  players: PlayerConfig[]
  onNameChange: (i: number, v: string) => void
  onToggleAI: (i: number) => void
}) {
  const aiCount = players.filter(p => p.isAI).length

  return (
    <div>
      <p style={{ color: '#6aad7a', fontSize: 12, marginBottom: 4 }}>Step 2 of 3</p>
      <h2 style={{ color: '#ffffff', fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        Name your {players.length} players
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {players.map((player, i) => {
          const avatarColor = PLAYER_COLORS[i % PLAYER_COLORS.length]
          const canBecomeAI = !player.isAI && aiCount < players.length - 1
          const canBecomeHuman = player.isAI

          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Colored avatar */}
              <div
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: avatarColor, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#1a3a2a',
                }}
              >
                {player.name.trim() ? player.name.trim()[0].toUpperCase() : i + 1}
              </div>

              {/* Name input */}
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  value={player.name}
                  onChange={e => onNameChange(i, e.target.value)}
                  placeholder={player.isAI ? `AI ${i + 1}` : `Player ${i + 1}`}
                  maxLength={20}
                  disabled={player.isAI}
                  autoComplete="off"
                  style={{
                    width: '100%',
                    background: player.isAI ? '#0a1810' : '#0f2218',
                    border: '1px solid #2d5a3a',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 14,
                    color: player.isAI ? '#6aad7a' : '#ffffff',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Human / AI toggle */}
              <div
                style={{
                  display: 'flex',
                  border: '1px solid #2d5a3a',
                  borderRadius: 6,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => canBecomeHuman && onToggleAI(i)}
                  style={{
                    padding: '8px 10px',
                    fontSize: 11, fontWeight: 600,
                    border: 'none',
                    background: !player.isAI ? '#1e4a2e' : 'transparent',
                    color: !player.isAI ? '#a8d0a8' : '#4a7a5a',
                    cursor: canBecomeHuman ? 'pointer' : 'default',
                    minWidth: 54, minHeight: 36,
                  }}
                >
                  Human
                </button>
                <button
                  onClick={() => canBecomeAI && onToggleAI(i)}
                  style={{
                    padding: '8px 10px',
                    fontSize: 11, fontWeight: 600,
                    border: 'none',
                    background: player.isAI ? '#2e1a0e' : 'transparent',
                    color: player.isAI ? '#e2b858' : (canBecomeAI ? '#6aad7a' : '#2d5a3a'),
                    cursor: canBecomeAI ? 'pointer' : 'default',
                    minWidth: 36, minHeight: 36,
                    opacity: !player.isAI && !canBecomeAI ? 0.4 : 1,
                  }}
                >
                  AI
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {aiCount >= players.length - 1 && (
        <p style={{ color: '#e2b858', fontSize: 11, marginTop: 12, textAlign: 'center' }}>
          At least 1 human player is required
        </p>
      )}
    </div>
  )
}

// ── Step 3 — Game settings ──────────────────────────────────────────────────
function Step3({
  players,
  aiCount,
  selectedPersonality,
  onPersonalityChange,
  buyLimit,
  onBuyLimitChange,
  decks,
  tournamentMode,
  onTournamentToggle,
}: {
  players: PlayerConfig[]
  aiCount: number
  selectedPersonality: AIPersonality
  onPersonalityChange: (p: AIPersonality) => void
  buyLimit: number
  onBuyLimitChange: (v: number) => void
  decks: number
  tournamentMode: boolean
  onTournamentToggle: () => void
}) {
  const buyLabel = buyLimit === 0 ? 'No buys' : buyLimit === -1 ? '\u221e buys/round' : `${buyLimit} buys/round`

  function starRating(difficulty: number): string {
    return '\u2605'.repeat(difficulty) + '\u2606'.repeat(5 - difficulty)
  }

  return (
    <div>
      <p style={{ color: '#6aad7a', fontSize: 12, marginBottom: 4 }}>Step 3 of 3</p>
      <h2 style={{ color: '#ffffff', fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        Game settings
      </h2>

      {/* AI personality picker — only when at least 1 AI player */}
      {aiCount > 0 && (
        <div
          style={{
            border: '1px solid #8b6914',
            background: '#1e3010',
            borderRadius: 10,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <p style={{ color: '#e2b858', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            AI Opponent
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {PERSONALITIES.map(p => {
              const isSelected = selectedPersonality === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => onPersonalityChange(p.id)}
                  style={{
                    border: `2px solid ${isSelected ? '#e2b858' : '#2d5a3a'}`,
                    background: isSelected ? 'rgba(226, 184, 88, 0.1)' : '#0f2218',
                    borderRadius: 10,
                    padding: '10px 10px 8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    transition: 'border-color 150ms, background 150ms',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{p.emoji}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: isSelected ? '#e2b858' : '#a8d0a8',
                    }}>
                      {p.name}
                    </span>
                  </div>
                  <p style={{
                    fontSize: 10, color: '#6aad7a', margin: '2px 0',
                    lineHeight: 1.3,
                  }}>
                    {p.description}
                  </p>
                  <span style={{
                    fontSize: 10,
                    color: isSelected ? '#e2b858' : '#8b9e8b',
                    letterSpacing: 1,
                  }}>
                    {starRating(p.difficulty)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Buy limit */}
      <div
        style={{
          border: '1px solid #2d5a3a',
          background: '#0f2218',
          borderRadius: 10,
          padding: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <p style={{ color: '#a8d0a8', fontSize: 13, fontWeight: 600 }}>Buys per round</p>
          <p style={{ color: '#6aad7a', fontSize: 11 }}>Resets each round</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {BUY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onBuyLimitChange(opt.value)}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: `1px solid ${buyLimit === opt.value ? '#e2b858' : '#2d5a3a'}`,
                background: buyLimit === opt.value ? '#1e3010' : 'transparent',
                color: buyLimit === opt.value ? '#e2b858' : '#6aad7a',
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
                minHeight: 36,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tournament mode toggle */}
      <div
        style={{
          border: `1px solid ${tournamentMode ? '#8b6914' : '#2d5a3a'}`,
          background: tournamentMode ? '#1e3010' : '#0f2218',
          borderRadius: 10,
          padding: 14,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          transition: 'border-color 150ms, background 150ms',
        }}
        onClick={onTournamentToggle}
      >
        <div>
          <p style={{ color: tournamentMode ? '#e2b858' : '#a8d0a8', fontSize: 13, fontWeight: 600, margin: 0 }}>
            Tournament Mode
          </p>
          <p style={{ color: '#6aad7a', fontSize: 11, margin: '3px 0 0' }}>
            Best of 3 games — crown a champion
          </p>
        </div>
        <div
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            background: tournamentMode ? '#e2b858' : '#2d5a3a',
            position: 'relative',
            flexShrink: 0,
            marginLeft: 12,
            transition: 'background 200ms ease',
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#ffffff',
              position: 'absolute',
              top: 3,
              left: tournamentMode ? 23 : 3,
              transition: 'left 200ms ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
          />
        </div>
      </div>

      {/* Game summary chips */}
      <div
        style={{
          border: '1px solid #2d5a3a',
          background: '#0f2218',
          borderRadius: 10,
          padding: 14,
        }}
      >
        <p style={{ color: '#6aad7a', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Game Summary
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {players.map((p, i) => (
            <span
              key={i}
              style={{
                padding: '4px 10px',
                borderRadius: 20,
                background: '#1e4a2e',
                color: PLAYER_COLORS[i % PLAYER_COLORS.length],
                fontSize: 12, fontWeight: 600,
              }}
            >
              {p.name.trim() || `Player ${i + 1}`}
              {p.isAI ? ' \ud83e\udd16' : ''}
            </span>
          ))}
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 20,
              background: '#0a1810',
              color: '#6aad7a',
              fontSize: 12,
            }}
          >
            {decks} decks
          </span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 20,
              background: '#0a1810',
              color: buyLimit === 0 ? '#ef8b6e' : '#6aad7a',
              fontSize: 12,
            }}
          >
            {buyLabel}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Root component ──────────────────────────────────────────────────────────
export default function GameSetup({ onStart, onBack }: Props) {
  const [step, setStep] = useState(1)
  const [playerCount, setPlayerCount] = useState<number | null>(null)
  const [players, setPlayers] = useState<PlayerConfig[]>([
    { name: '', isAI: false },
    { name: '', isAI: false },
  ])
  const [selectedPersonality, setSelectedPersonality] = useState<AIPersonality>('steady-sam')
  const [buyLimit, setBuyLimit] = useState(5)
  const [tournamentMode, setTournamentMode] = useState(false)

  function handleCountSelect(count: number) {
    setPlayerCount(count)
    setPlayers(prev => {
      const updated = [...prev]
      while (updated.length < count) updated.push({ name: '', isAI: false })
      return updated.slice(0, count)
    })
  }

  function handleNameChange(index: number, value: string) {
    setPlayers(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], name: value }
      return updated
    })
  }

  function handleToggleAI(index: number) {
    const aiCount = players.filter(p => p.isAI).length
    setPlayers(prev => {
      const updated = [...prev]
      const becomingAI = !updated[index].isAI
      if (becomingAI && aiCount >= players.length - 1) return prev
      updated[index] = {
        ...updated[index],
        isAI: becomingAI,
        name: becomingAI
          ? (updated[index].name.trim() || `AI ${index + 1}`)
          : updated[index].name,
      }
      return updated
    })
  }

  const aiCount = players.filter(p => p.isAI).length
  const allNamed = players.every(p => p.name.trim().length > 0)
  const decks = playerCount ? deckCount(playerCount) : 2

  function goBack() {
    if (step === 1) onBack()
    else setStep(s => s - 1)
  }

  function goNext() {
    if (step === 1 && playerCount) setStep(2)
    else if (step === 2 && allNamed) setStep(3)
  }

  function handleDeal() {
    if (!playerCount || !allNamed) return
    onStart(
      players.map(p => ({ name: p.name.trim(), isAI: p.isAI })),
      selectedPersonality,
      buyLimit,
      tournamentMode,
    )
  }

  const nextEnabled = step === 1 ? !!playerCount : step === 2 ? allNamed : true

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar — back button + step label */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 12px 0', paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button
          onClick={goBack}
          style={{
            width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, background: 'transparent', border: 'none',
            color: '#6aad7a', cursor: 'pointer',
          }}
        >
          <ChevronLeft size={22} />
        </button>
      </div>

      <ProgressPills step={step} />

      {/* Step content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {step === 1 && (
          <Step1 selected={playerCount} onSelect={handleCountSelect} />
        )}
        {step === 2 && playerCount && (
          <Step2
            players={players}
            onNameChange={handleNameChange}
            onToggleAI={handleToggleAI}
          />
        )}
        {step === 3 && playerCount && (
          <Step3
            players={players}
            aiCount={aiCount}
            selectedPersonality={selectedPersonality}
            onPersonalityChange={setSelectedPersonality}
            buyLimit={buyLimit}
            onBuyLimitChange={setBuyLimit}
            decks={decks}
            tournamentMode={tournamentMode}
            onTournamentToggle={() => setTournamentMode(t => !t)}
          />
        )}
      </div>

      {/* Bottom action */}
      <div
        style={{
          padding: '12px 16px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          borderTop: '1px solid #2d5a3a',
        }}
      >
        {step < 3 ? (
          <button
            onClick={goNext}
            disabled={!nextEnabled}
            style={{
              width: '100%',
              padding: '15px',
              borderRadius: 12,
              border: 'none',
              background: nextEnabled ? '#e2b858' : '#2d5a3a',
              color: nextEnabled ? '#2c1810' : '#6aad7a',
              fontSize: 16,
              fontWeight: 700,
              cursor: nextEnabled ? 'pointer' : 'not-allowed',
              opacity: nextEnabled ? 1 : 0.55,
              transition: 'background 150ms, color 150ms',
            }}
          >
            Next →
          </button>
        ) : (
          <button
            onClick={handleDeal}
            style={{
              width: '100%',
              padding: '15px',
              borderRadius: 12,
              border: 'none',
              background: '#e2b858',
              color: '#2c1810',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {tournamentMode ? 'Start Tournament \u2192' : 'Deal the cards \u2192'}
          </button>
        )}
      </div>
    </div>
  )
}
