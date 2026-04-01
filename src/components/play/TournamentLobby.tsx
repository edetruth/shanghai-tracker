import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, Trophy, Copy, Users } from 'lucide-react'
import {
  createTournament, getTournament,
  generateBracket, updateTournamentStatus,
  createMatchRoom, reportMatchResult, advanceWinner,
  type TournamentMatch,
} from '../../lib/tournamentStore'
import { useTournamentChannel } from '../../hooks/useTournamentChannel'
import { supabase } from '../../lib/supabase'
import BracketView from './BracketView'
import { haptic } from '../../lib/haptics'

interface Props {
  mode: 'create' | 'join'
  hostName?: string
  /** Called when a match room is ready. isHost=true for the player who created the room. */
  onMatchStart: (roomCode: string, isHost: boolean, matchId: string, matchPlayerNames: string[]) => void
  onBack: () => void
}

export default function TournamentLobby({ mode, hostName, onMatchStart, onBack }: Props) {
  const [code, setCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [players, setPlayers] = useState<string[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [startingMatch, setStartingMatch] = useState<string | null>(null)

  // Live tournament + match data via Realtime
  const { tournament, matches, refresh } = useTournamentChannel(code || null)

  // Broadcast channel for player list sync (no DB table needed)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const myName = mode === 'create' ? hostName : playerName

  // Persist player list to sessionStorage for recovery
  useEffect(() => {
    if (code && players.length > 0) {
      sessionStorage.setItem(`tournament_players_${code}`, JSON.stringify(players))
    }
  }, [code, players])

  // Recover player list on mount
  useEffect(() => {
    if (code) {
      const saved = sessionStorage.getItem(`tournament_players_${code}`)
      if (saved) {
        try { setPlayers(JSON.parse(saved)) } catch { /* ignore */ }
      }
    }
  }, [code])

  // Set up broadcast channel for player list when we have a code
  useEffect(() => {
    if (!code) return
    const ch = supabase.channel(`tournament-players-${code}`)

    ch.on('broadcast', { event: 'players' }, (payload) => {
      const list = payload.payload?.players as string[] | undefined
      if (list) setPlayers(list)
    })
      .subscribe()

    channelRef.current = ch
    return () => { supabase.removeChannel(ch) }
  }, [code])

  // Host broadcasts player list whenever it changes
  useEffect(() => {
    if (mode !== 'create' || !channelRef.current) return
    channelRef.current.send({
      type: 'broadcast',
      event: 'players',
      payload: { players },
    })
  }, [players, mode])

  // Auto-navigate when a match gets a room code and I'm a player in it
  useEffect(() => {
    if (!myName || !matches.length) return
    const myMatch = matches.find(
      m => m.status === 'in_progress' && m.room_code && m.player_names.includes(myName)
    )
    if (myMatch && myMatch.room_code && startingMatch !== myMatch.id) {
      // Another player (host) started this match — I'm the joiner
      const isHost = mode === 'create' && myMatch.player_names[0] === myName
      if (!isHost) {
        onMatchStart(myMatch.room_code, false, myMatch.id, myMatch.player_names)
      }
    }
  }, [matches, myName, mode, onMatchStart, startingMatch])

  // Create tournament
  async function handleCreate(playerCount: number) {
    if (!hostName) return
    setCreating(true)
    const result = await createTournament(hostName, playerCount)
    if (result) {
      setCode(result.code)
      setPlayers([hostName])
      // Trigger initial fetch
      await getTournament(result.code)
    } else {
      setError('Failed to create tournament')
    }
    setCreating(false)
  }

  // Join tournament
  async function handleJoin() {
    if (!playerName.trim() || !joinCode.trim()) return
    const t = await getTournament(joinCode.trim().toUpperCase())
    if (!t) { setError('Tournament not found'); return }
    if (t.status !== 'waiting') { setError('Tournament already started'); return }
    setCode(t.code)
    // Request to join via broadcast — host will add us
    setTimeout(() => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'join-request',
        payload: { name: playerName.trim() },
      })
    }, 500)
  }

  // Host: listen for join requests
  useEffect(() => {
    if (mode !== 'create' || !code) return
    const ch = channelRef.current
    if (!ch) return

    const handler = (payload: { payload?: { name?: string } }) => {
      const name = payload.payload?.name
      if (name && !players.includes(name)) {
        setPlayers(prev => {
          const maxPlayers = tournament?.player_count ?? 4
          if (prev.length >= maxPlayers) return prev
          if (prev.includes(name)) return prev
          return [...prev, name]
        })
      }
    }

    ch.on('broadcast', { event: 'join-request' }, handler)
    // Note: supabase channels accumulate listeners; cleanup on unmount via removeChannel
  }, [mode, code, players, tournament?.player_count])

  // Start tournament (host only)
  async function handleStart() {
    if (!tournament || players.length < 2) return
    const targetCount = players.length <= 4 ? 4 : 8
    const paddedPlayers = [...players]
    while (paddedPlayers.length < targetCount) {
      paddedPlayers.push(`BYE-${paddedPlayers.length}`)
    }
    await generateBracket(tournament.id, paddedPlayers)
    await updateTournamentStatus(code, 'in_progress')
    await refresh()
  }

  // Host starts a match: create game room, store room code, navigate
  async function handleStartMatch(match: TournamentMatch) {
    if (!myName || startingMatch) return
    setStartingMatch(match.id)
    haptic('tap')

    const roomCode = await createMatchRoom(match.id, myName, match.player_names.length)
    if (!roomCode) {
      setError('Failed to create match room')
      setStartingMatch(null)
      return
    }

    // Navigate host to the game
    onMatchStart(roomCode, true, match.id, match.player_names)
  }

  // Copy code
  function handleCopy() {
    navigator.clipboard?.writeText(code)
    haptic('tap')
  }

  // Report a match result (called externally via onMatchStart flow, but also useful for BYE handling)
  useEffect(() => {
    if (!tournament || tournament.status !== 'in_progress') return
    // Auto-resolve BYE matches
    for (const match of matches) {
      if (match.status !== 'pending') continue
      if (match.player_names.length < 2) continue
      const byePlayer = match.player_names.find(n => n.startsWith('BYE-'))
      const realPlayer = match.player_names.find(n => !n.startsWith('BYE-'))
      if (byePlayer && realPlayer && mode === 'create') {
        // Host auto-resolves BYE matches
        reportMatchResult(match.id, realPlayer)
        advanceWinner(tournament.id, match.round_number, match.match_index, realPlayer)
      }
    }
  }, [matches, tournament, mode])

  // Not yet created
  if (!tournament && mode === 'create') {
    return (
      <div style={{
        minHeight: '100dvh', background: '#f8f6f1',
        padding: 16, paddingTop: 'max(16px, env(safe-area-inset-top))',
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', color: '#8b7355',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16,
        }}>
          <ChevronLeft size={16} /> Back
        </button>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Trophy size={32} style={{ color: '#e2b858', marginBottom: 8 }} />
          <h2 style={{ color: '#2c1810', fontSize: 22, fontWeight: 800, margin: 0 }}>Create Tournament</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 300, margin: '0 auto' }}>
          <button
            onClick={() => handleCreate(4)}
            disabled={creating}
            style={{
              background: '#e2b858', border: 'none', borderRadius: 12, padding: '16px',
              color: '#2c1810', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}
          >
            4 Players (2 Rounds)
          </button>
          <button
            onClick={() => handleCreate(8)}
            disabled={creating}
            style={{
              background: '#1e4a2e', border: '1px solid #2d5a3a', borderRadius: 12, padding: '16px',
              color: '#a8d0a8', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}
          >
            8 Players (3 Rounds)
          </button>
        </div>
        {error && <p style={{ color: '#b83232', textAlign: 'center', marginTop: 12, fontSize: 12 }}>{error}</p>}
      </div>
    )
  }

  // Join form
  if (!tournament && mode === 'join') {
    return (
      <div style={{
        minHeight: '100dvh', background: '#f8f6f1',
        padding: 16, paddingTop: 'max(16px, env(safe-area-inset-top))',
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', color: '#8b7355',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16,
        }}>
          <ChevronLeft size={16} /> Back
        </button>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Trophy size={32} style={{ color: '#e2b858', marginBottom: 8 }} />
          <h2 style={{ color: '#2c1810', fontSize: 22, fontWeight: 800, margin: 0 }}>Join Tournament</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 300, margin: '0 auto' }}>
          <input
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            style={{
              background: '#fff', border: '1px solid #e2ddd2', borderRadius: 10,
              padding: '12px', fontSize: 14, color: '#2c1810',
            }}
          />
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="TRNY-XXXX"
            aria-label="Tournament code"
            maxLength={9}
            style={{
              background: '#fff', border: '1px solid #e2ddd2', borderRadius: 10,
              padding: '12px', fontSize: 14, color: '#2c1810', letterSpacing: 2, textAlign: 'center',
            }}
          />
          <button
            onClick={handleJoin}
            disabled={!playerName.trim() || joinCode.length < 9}
            style={{
              background: '#e2b858', border: 'none', borderRadius: 12, padding: '14px',
              color: '#2c1810', fontSize: 16, fontWeight: 700, cursor: 'pointer',
              opacity: !playerName.trim() || joinCode.length < 9 ? 0.5 : 1,
            }}
          >
            Join
          </button>
        </div>
        {error && <p style={{ color: '#b83232', textAlign: 'center', marginTop: 12, fontSize: 12 }}>{error}</p>}
      </div>
    )
  }

  // Tournament lobby / bracket view
  const isHost = mode === 'create'
  const isWaiting = tournament?.status === 'waiting'
  const isActive = tournament?.status === 'in_progress'

  return (
    <div style={{
      minHeight: '100dvh', background: '#f8f6f1',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'max(8px, env(safe-area-inset-top))',
    }}>
      {/* Header */}
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', color: '#8b7355', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <ChevronLeft size={16} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trophy size={14} style={{ color: '#e2b858' }} />
          <span style={{ color: '#2c1810', fontSize: 14, fontWeight: 700 }}>Tournament</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#8b6914', fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>{code}</span>
          <button onClick={handleCopy} style={{
            background: 'transparent', border: 'none', color: '#8b7355', cursor: 'pointer', padding: 2,
          }}>
            <Copy size={12} />
          </button>
        </div>
      </div>

      {/* Player list (waiting phase) */}
      {isWaiting && (
        <div style={{ padding: '8px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Users size={14} style={{ color: '#8b7355' }} />
            <span style={{ color: '#8b7355', fontSize: 12 }}>{players.length} / {tournament?.player_count} players</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {players.map(name => (
              <span key={name} style={{
                background: '#efe9dd', borderRadius: 20, padding: '4px 12px',
                color: '#2c1810', fontSize: 12, fontWeight: 600,
              }}>
                {name}
              </span>
            ))}
            {Array.from({ length: (tournament?.player_count ?? 4) - players.length }, (_, i) => (
              <span key={`empty-${i}`} style={{
                background: 'transparent', border: '1px dashed #e2ddd2', borderRadius: 20,
                padding: '4px 12px', color: '#a08c6e', fontSize: 12,
              }}>
                Waiting...
              </span>
            ))}
          </div>
          {isHost && (
            <button
              onClick={handleStart}
              disabled={players.length < 2}
              style={{
                width: '100%', background: '#e2b858', border: 'none', borderRadius: 12,
                padding: '14px', color: '#2c1810', fontSize: 16, fontWeight: 700,
                cursor: players.length >= 2 ? 'pointer' : 'default',
                opacity: players.length >= 2 ? 1 : 0.5,
              }}
            >
              Start Tournament ({players.length} players)
            </button>
          )}
        </div>
      )}

      {/* Bracket view (active phase) */}
      {isActive && matches.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <BracketView
            matches={matches}
            playerCount={tournament?.player_count ?? 4}
            currentPlayerName={myName}
          />

          {/* Find my current match */}
          {(() => {
            const myMatch = matches.find(m =>
              m.status !== 'finished' && m.player_names.includes(myName ?? '')
            )
            if (myMatch && myMatch.player_names.length >= 2) {
              const hasBye = myMatch.player_names.some(n => n.startsWith('BYE-'))
              if (hasBye) return null // BYE matches auto-resolve

              return (
                <div style={{ padding: '12px 16px', textAlign: 'center' }}>
                  <p style={{ color: '#2c1810', fontSize: 13, marginBottom: 8 }}>
                    Your match: <strong>{myMatch.player_names.join(' vs ')}</strong>
                  </p>
                  {myMatch.status === 'pending' && isHost && (
                    <button
                      onClick={() => handleStartMatch(myMatch)}
                      disabled={!!startingMatch}
                      style={{
                        background: '#e2b858', border: 'none', borderRadius: 12,
                        padding: '12px 32px', color: '#2c1810', fontSize: 14, fontWeight: 700,
                        cursor: 'pointer',
                        opacity: startingMatch ? 0.5 : 1,
                      }}
                    >
                      {startingMatch === myMatch.id ? 'Creating room...' : 'Start Match'}
                    </button>
                  )}
                  {myMatch.status === 'pending' && !isHost && (
                    <p style={{ color: '#8b7355', fontSize: 12 }}>
                      Waiting for host to start match...
                    </p>
                  )}
                  {myMatch.status === 'in_progress' && myMatch.room_code && (
                    <p style={{ color: '#2d7a3a', fontSize: 12, fontWeight: 600 }}>
                      Match in progress — Room {myMatch.room_code}
                    </p>
                  )}
                </div>
              )
            }
            return null
          })()}
        </div>
      )}

      {/* Finished */}
      {tournament?.status === 'finished' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Trophy size={48} style={{ color: '#e2b858' }} />
          <span style={{ color: '#2c1810', fontSize: 24, fontWeight: 800 }}>Tournament Complete!</span>
          <button onClick={onBack} style={{
            marginTop: 16, background: '#e2b858', border: 'none', borderRadius: 12,
            padding: '14px 40px', color: '#2c1810', fontSize: 16, fontWeight: 700, cursor: 'pointer',
          }}>Back to Menu</button>
        </div>
      )}
    </div>
  )
}
