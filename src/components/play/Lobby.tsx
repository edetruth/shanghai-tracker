import { useState, useEffect } from 'react'
import { ChevronLeft, Copy, Check, Users, Wifi, Bot, X } from 'lucide-react'
import { useGameLobby } from '../../hooks/useGameLobby'
import { createGameRoom, joinGameRoom, addAIToRoom, removeAIFromRoom, updateRoomStatus } from '../../lib/gameStore'
import { haptic } from '../../lib/haptics'
import type { GameRoomConfig, GameRoomPlayer } from '../../game/multiplayer-types'
import type { AIPersonality } from '../../game/types'
import { PERSONALITIES } from '../../game/types'

interface HostProps {
  mode: 'host'
  config: GameRoomConfig
  hostName: string
  aiPersonality: AIPersonality
  onGameStart: (roomCode: string, players: GameRoomPlayer[]) => void
  onBack: () => void
}

interface JoinProps {
  mode: 'join'
  config?: never
  hostName?: never
  aiPersonality?: never
  onGameStart: (roomCode: string, seatIndex: number, players: GameRoomPlayer[]) => void
  onBack: () => void
}

type Props = HostProps | JoinProps

export default function Lobby(props: Props) {
  const { mode, onBack } = props

  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [joinInput, setJoinInput] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [mySeatIndex, setMySeatIndex] = useState<number>(0)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  const { players, room, loading } = useGameLobby(roomCode)

  // Host: create room on mount
  useEffect(() => {
    if (mode !== 'host' || roomCode) return
    const hostProps = props as HostProps
    setCreating(true)
    createGameRoom(hostProps.hostName, hostProps.config)
      .then(r => {
        setRoomCode(r.room_code)
        setMySeatIndex(0)
        setCreating(false)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to create room')
        setCreating(false)
      })
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for room status change to 'playing' (for joiners)
  useEffect(() => {
    if (mode === 'join' && room?.status === 'playing') {
      const joinProps = props as JoinProps
      joinProps.onGameStart(room.room_code, mySeatIndex, players)
    }
  }, [room?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopyCode() {
    if (!roomCode) return
    navigator.clipboard.writeText(roomCode).catch(() => {})
    setCopied(true)
    haptic('tap')
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleJoin() {
    const code = `SHNG-${joinInput.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
    const trimmedName = playerName.trim()
    if (joinInput.length < 4 || !trimmedName) return

    // Check for duplicate name before hitting the DB constraint
    if (players.some(p => p.player_name.toLowerCase() === trimmedName.toLowerCase())) {
      setError(`"${trimmedName}" is already taken in this room. Choose a different name.`)
      return
    }

    setJoining(true)
    setError(null)
    try {
      const { room: r, seatIndex } = await joinGameRoom(code, trimmedName)
      setRoomCode(r.room_code)
      setMySeatIndex(seatIndex)
      haptic('success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not join room'
      // Catch the DB unique constraint as a fallback
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('already exists')) {
        setError(`"${trimmedName}" is already taken in this room. Choose a different name.`)
      } else {
        setError(msg)
      }
    } finally {
      setJoining(false)
    }
  }

  async function handleAddAI(seatIndex: number) {
    if (!roomCode) return
    const hostProps = props as HostProps
    const personality = PERSONALITIES.find(p => p.id === hostProps.aiPersonality) ?? PERSONALITIES[1]
    await addAIToRoom(roomCode, personality.name, seatIndex)
  }

  async function handleRemoveAI(seatIndex: number) {
    if (!roomCode) return
    await removeAIFromRoom(roomCode, seatIndex)
  }

  async function handleStartGame() {
    if (!roomCode || mode !== 'host') return
    const hostProps = props as HostProps
    await updateRoomStatus(roomCode, 'playing')
    hostProps.onGameStart(roomCode, players)
  }

  const humanCount = players.filter(p => !p.is_ai).length
  const totalPlayers = players.length
  const hostConfig = mode === 'host' ? (props as HostProps).config : null
  const maxSeats = hostConfig?.playerCount ?? 8
  const canStart = totalPlayers >= 2 && humanCount >= 1

  // Filled seats
  const seatMap = new Map<number, GameRoomPlayer>()
  for (const p of players) seatMap.set(p.seat_index, p)

  // ── Join form (before connected) ──────────────────────────────────────────
  if (mode === 'join' && !roomCode) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Top bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 12px 0',
          paddingTop: 'max(12px, env(safe-area-inset-top))',
        }}>
          <button
            onClick={onBack}
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

        <div style={{ flex: 1, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <p style={{ color: '#6aad7a', fontSize: 12, marginBottom: 4 }}>Join Online Game</p>
            <h2 style={{ color: '#ffffff', fontSize: 22, fontWeight: 700 }}>Enter Room Code</h2>
          </div>

          {/* Name input */}
          <div>
            <label style={{ color: '#6aad7a', fontSize: 11, display: 'block', marginBottom: 6 }}>Your Name</label>
            <input
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              maxLength={20}
              style={{
                width: '100%',
                background: '#0f2218',
                border: '1px solid #2d5a3a',
                borderRadius: 10,
                padding: '12px 14px',
                color: '#ffffff',
                fontSize: 16,
                outline: 'none',
              }}
            />
          </div>

          {/* Room code input */}
          <div>
            <label style={{ color: '#6aad7a', fontSize: 11, display: 'block', marginBottom: 6 }}>Room Code</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#6aad7a', fontSize: 16, fontWeight: 600 }}>SHNG-</span>
              <input
                type="text"
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                placeholder="XXXX"
                maxLength={4}
                style={{
                  flex: 1,
                  background: '#0f2218',
                  border: '1px solid #2d5a3a',
                  borderRadius: 10,
                  padding: '12px 14px',
                  color: '#ffffff',
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: 4,
                  textAlign: 'center',
                  outline: 'none',
                }}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
              />
            </div>
          </div>

          {error && (
            <p style={{ color: '#e07a5f', fontSize: 12 }}>{error}</p>
          )}
        </div>

        {/* Bottom */}
        <div style={{
          padding: '12px 16px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        }}>
          <button
            onClick={handleJoin}
            disabled={joinInput.length < 4 || !playerName.trim() || joining}
            style={{
              width: '100%',
              padding: 15,
              borderRadius: 12,
              border: 'none',
              background: joinInput.length >= 4 && playerName.trim() ? '#e2b858' : '#2d5a3a',
              color: joinInput.length >= 4 && playerName.trim() ? '#2c1810' : '#6aad7a',
              fontSize: 16,
              fontWeight: 700,
              cursor: joinInput.length >= 4 && playerName.trim() ? 'pointer' : 'not-allowed',
              opacity: joinInput.length >= 4 && playerName.trim() ? 1 : 0.55,
            }}
          >
            {joining ? 'Joining...' : 'Join Game'}
          </button>
        </div>
      </div>
    )
  }

  // ── Lobby view (host or joined) ───────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100dvh',
      background: '#1a3a2a',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 12px 0',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
      }}>
        <button
          onClick={onBack}
          style={{
            width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, background: 'transparent', border: 'none',
            color: '#6aad7a', cursor: 'pointer',
          }}
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6aad7a', fontSize: 11 }}>
          <Wifi size={14} />
          <span>{loading ? 'Connecting...' : 'Online'}</span>
        </div>
      </div>

      {/* Room code banner */}
      <div style={{
        margin: '20px 16px 0',
        background: '#0f2218',
        borderRadius: 12,
        padding: '16px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <p style={{ color: '#6aad7a', fontSize: 10, marginBottom: 4 }}>
            {mode === 'host' ? 'Share this code' : 'Connected to room'}
          </p>
          <p style={{
            color: '#e2b858',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 3,
            margin: 0,
            fontFamily: 'monospace',
          }}>
            {creating ? '...' : roomCode ?? ''}
          </p>
        </div>
        {roomCode && (
          <button
            onClick={handleCopyCode}
            style={{
              background: '#1e4a2e',
              border: '1px solid #2d5a3a',
              borderRadius: 8,
              padding: '8px 12px',
              color: copied ? '#6aad7a' : '#a8d0a8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {/* Player list */}
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Users size={14} style={{ color: '#6aad7a' }} />
          <span style={{ color: '#a8d0a8', fontSize: 12 }}>
            Players ({totalPlayers}/{maxSeats})
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: maxSeats }, (_, i) => {
            const player = seatMap.get(i)
            if (player) {
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#0f2218',
                    borderRadius: 10,
                    padding: '10px 12px',
                    border: player.is_host
                      ? '1px solid #e2b858'
                      : '1px solid #2d5a3a',
                  }}
                >
                  {/* Seat number */}
                  <div style={{
                    width: 24, height: 24, borderRadius: 12,
                    background: '#1e4a2e',
                    color: '#e2b858',
                    fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>

                  {/* Player info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {player.is_ai && <Bot size={12} style={{ color: '#6aad7a' }} />}
                      <span style={{ color: '#ffffff', fontSize: 14, fontWeight: 500 }}>
                        {player.player_name}
                      </span>
                    </div>
                    <span style={{ color: '#3a5a3a', fontSize: 10 }}>
                      {player.is_host ? 'Host' : player.is_ai ? 'AI' : 'Player'}
                      {player.is_connected ? '' : ' (disconnected)'}
                    </span>
                  </div>

                  {/* Remove AI button (host only) */}
                  {mode === 'host' && player.is_ai && (
                    <button
                      onClick={() => handleRemoveAI(i)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#6aad7a',
                        cursor: 'pointer',
                        padding: 4,
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )
            }

            // Empty seat
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#0f2218',
                  borderRadius: 10,
                  padding: '10px 12px',
                  border: '1px dashed #2d5a3a',
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 12,
                  background: '#1e4a2e',
                  color: '#3a5a3a',
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                <span style={{ color: '#3a5a3a', fontSize: 13, flex: 1 }}>
                  Waiting for player...
                </span>
                {mode === 'host' && (
                  <button
                    onClick={() => handleAddAI(i)}
                    style={{
                      background: '#1e4a2e',
                      border: '1px solid #2d5a3a',
                      borderRadius: 6,
                      padding: '4px 10px',
                      color: '#6aad7a',
                      fontSize: 10,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Bot size={10} />
                    Add AI
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {error && (
          <p style={{ color: '#e07a5f', fontSize: 12, marginTop: 12 }}>{error}</p>
        )}

        {/* Joiner waiting message */}
        {mode === 'join' && roomCode && (
          <div style={{
            marginTop: 20,
            textAlign: 'center',
            color: '#6aad7a',
            fontSize: 12,
          }}>
            Waiting for host to start the game...
          </div>
        )}
      </div>

      {/* Bottom CTA (host only) */}
      {mode === 'host' && (
        <div style={{
          padding: '12px 16px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          borderTop: '1px solid #2d5a3a',
        }}>
          <button
            onClick={handleStartGame}
            disabled={!canStart}
            style={{
              width: '100%',
              padding: 15,
              borderRadius: 12,
              border: 'none',
              background: canStart ? '#e2b858' : '#2d5a3a',
              color: canStart ? '#2c1810' : '#6aad7a',
              fontSize: 16,
              fontWeight: 700,
              cursor: canStart ? 'pointer' : 'not-allowed',
              opacity: canStart ? 1 : 0.55,
            }}
          >
            Start Game ({totalPlayers} players)
          </button>
        </div>
      )}
    </div>
  )
}
