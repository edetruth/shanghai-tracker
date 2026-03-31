import { useState, useEffect } from 'react'
import { Trophy } from 'lucide-react'
import GameSetup from './play/GameSetup'
import GameBoard from './play/GameBoard'
import GameOver from './play/GameOver'
import TournamentTrophy from './play/TournamentTrophy'
import Lobby from './play/Lobby'
import RemoteGameBoard from './play/RemoteGameBoard'
import SpectatorBoard from './play/SpectatorBoard'
import ReplayViewer from './play/ReplayViewer'
import TournamentLobby from './play/TournamentLobby'
import type { PlayerConfig, Player, AIPersonality, TournamentState, TournamentGameResult, TournamentPlayerStats } from '../game/types'
import type { GameRoomConfig, GameRoomPlayer } from '../game/multiplayer-types'
import { loadGameStateSnapshot, getGameRoomPlayers } from '../lib/gameStore'

type PlayView = 'landing' | 'setup' | 'game' | 'lobby-host' | 'lobby-join' | 'remote-game' | 'spectator' | 'replay' | 'tournament-gameover' | 'tournament-trophy' | 'tournament-lobby-create' | 'tournament-lobby-join'

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
  const [aiPersonality, setAiPersonality] = useState<AIPersonality>('steady-sam')
  const [buyLimit, setBuyLimit] = useState(5)
  const [tournamentState, setTournamentState] = useState<TournamentState | null>(null)
  const [lastGamePlayers, setLastGamePlayers] = useState<Player[]>([])
  const [gameKey, setGameKey] = useState(0) // force remount GameBoard for new tournament games
  const [startingGame, setStartingGame] = useState(false)

  // Online multiplayer state
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [mySeatIndex, setMySeatIndex] = useState(0)
  const [onlineHostName, setOnlineHostName] = useState('')
  const [onlineConfig, setOnlineConfig] = useState<GameRoomConfig | null>(null)
  const [remotePlayers, setRemotePlayers] = useState<GameRoomPlayer[]>([])

  // Online tournament bracket state
  const [tournamentHostName, setTournamentHostName] = useState('')
  const [tournamentMatchId, setTournamentMatchId] = useState<string | null>(null)
  const [tournamentCode, setTournamentCode] = useState<string | null>(null)
  void tournamentCode // reserved for future use (e.g. return-to-bracket after match)

  // Replay state
  const [replayGameId, setReplayGameId] = useState<string | null>(null)
  const [replayPlayerNames, setReplayPlayerNames] = useState<string[]>([])

  // Replay launcher (for future "Watch Replay" button integration)
  const handleStartReplay = (gameId: string, playerNames: string[]) => {
    setReplayGameId(gameId)
    setReplayPlayerNames(playerNames)
    setView('replay')
  }

  // ── Session recovery: resume online game after host refresh ─────────────
  useEffect(() => {
    const saved = sessionStorage.getItem('shanghai_active_game')
    if (!saved) return
    try {
      const session = JSON.parse(saved) as {
        roomCode: string
        role: 'host' | 'remote'
        seatIndex: number
      }
      // Try to recover the game
      ;(async () => {
        if (session.role === 'host') {
          const snapshot = await loadGameStateSnapshot(session.roomCode)
          const players = await getGameRoomPlayers(session.roomCode)
          if (snapshot && players.length > 0) {
            const configs: PlayerConfig[] = players.map(p => ({
              name: p.player_name,
              isAI: p.is_ai,
            }))
            setPlayerConfigs(configs)
            setRoomCode(session.roomCode)
            setMySeatIndex(session.seatIndex)
            setRemotePlayers(players)
            setGameKey(k => k + 1)
            setView('game')
          } else {
            // Snapshot gone or room empty — clear session
            sessionStorage.removeItem('shanghai_active_game')
          }
        } else {
          // Remote player refresh — rejoin
          setRoomCode(session.roomCode)
          setMySeatIndex(session.seatIndex)
          setView('remote-game')
        }
      })()
    } catch {
      sessionStorage.removeItem('shanghai_active_game')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleStart(players: PlayerConfig[], personality: AIPersonality, limit: number, tournamentMode: boolean) {
    setPlayerConfigs(players)
    setAiPersonality(personality)
    setBuyLimit(limit)
    if (tournamentMode) {
      const standings = new Map<string, TournamentPlayerStats>()
      players.forEach((_p, i) => {
        standings.set(`p${i}`, {
          gamesWon: 0,
          totalScore: 0,
          roundsWon: 0,
          avgScore: 0,
          shanghaiCount: 0,
        })
      })
      setTournamentState({
        enabled: true,
        totalGames: 3,
        currentGameNumber: 1,
        gameResults: [],
        standings,
      })
    } else {
      setTournamentState(null)
    }
    setGameKey(k => k + 1)
    setStartingGame(true)
    setTimeout(() => {
      setView('game')
      setStartingGame(false)
    }, 400)
  }

  // Helper: compute total score for a player
  function playerTotal(p: Player): number {
    return p.roundScores.reduce((s, n) => s + n, 0)
  }

  // Tournament: handle game completion
  function handleTournamentGameComplete(players: Player[]) {
    if (!tournamentState) return
    setLastGamePlayers(players)

    // Determine winner(s) of this game
    const sorted = [...players].sort((a, b) => playerTotal(a) - playerTotal(b))
    const winnerScore = playerTotal(sorted[0])
    const winners = sorted.filter(p => playerTotal(p) === winnerScore)

    // Build game result
    const result: TournamentGameResult = {
      gameNumber: tournamentState.currentGameNumber,
      winnerId: winners[0].id,
      winnerName: winners[0].name,
      playerScores: sorted.map((p, idx) => ({
        playerId: p.id,
        name: p.name,
        totalScore: playerTotal(p),
        rank: idx + 1,
      })),
    }

    // Update standings
    const newStandings = new Map(tournamentState.standings)
    for (const p of players) {
      const stats = newStandings.get(p.id) ?? {
        gamesWon: 0, totalScore: 0, roundsWon: 0, avgScore: 0, shanghaiCount: 0,
      }
      const total = playerTotal(p)
      const isWinner = winners.some(w => w.id === p.id)
      const roundsWon = p.roundScores.filter(s => s === 0).length
      const newTotalScore = stats.totalScore + total
      const gameCount = tournamentState.currentGameNumber
      newStandings.set(p.id, {
        gamesWon: stats.gamesWon + (isWinner ? 1 : 0),
        totalScore: newTotalScore,
        roundsWon: stats.roundsWon + roundsWon,
        avgScore: Math.round(newTotalScore / gameCount),
        shanghaiCount: stats.shanghaiCount + p.roundScores.filter(s => s >= 80).length,
      })
    }

    const newResults = [...tournamentState.gameResults, result]
    const updatedState: TournamentState = {
      ...tournamentState,
      gameResults: newResults,
      standings: newStandings,
    }
    setTournamentState(updatedState)

    // Check if someone has 2 wins (tournament clinched)
    const champion = Array.from(newStandings.entries()).find(([, s]) => s.gamesWon >= 2)
    if (champion) {
      setView('tournament-trophy')
    } else {
      setView('tournament-gameover')
    }
  }

  // Tournament: start next game
  function handleNextTournamentGame() {
    if (!tournamentState) return
    setTournamentState(prev => prev ? {
      ...prev,
      currentGameNumber: prev.currentGameNumber + 1 as 1 | 2 | 3,
    } : null)
    setGameKey(k => k + 1)
    setView('game')
  }

  // Tournament: exit back to landing
  function handleExitTournament() {
    setTournamentState(null)
    setView('landing')
  }

  // Tournament: play again (back to setup)
  function handleTournamentPlayAgain() {
    setTournamentState(null)
    setView('setup')
  }

  // Online multiplayer: host creates room and goes to lobby
  function handleCreateOnline(
    players: PlayerConfig[],
    personality: AIPersonality,
    limit: number,
    hostName: string,
  ) {
    setPlayerConfigs(players)
    setAiPersonality(personality)
    setBuyLimit(limit)
    setOnlineHostName(hostName)
    const config: GameRoomConfig = {
      playerCount: players.length,
      buyLimit: limit,
      aiPersonality: personality,
      seats: [],  // No pre-assigned seats — lobby handles player/AI assignment
    }
    setOnlineConfig(config)
    setView('lobby-host')
  }

  // Online multiplayer: host starts game from lobby
  function handleHostGameStart(code: string, lobbyPlayers: GameRoomPlayer[]) {
    setRoomCode(code)
    setRemotePlayers(lobbyPlayers)
    const configs: PlayerConfig[] = lobbyPlayers.map(p => ({
      name: p.player_name,
      isAI: p.is_ai,
    }))
    setPlayerConfigs(configs)
    setMySeatIndex(0)
    setGameKey(k => k + 1)
    setStartingGame(true)
    // Persist session for recovery on refresh
    sessionStorage.setItem('shanghai_active_game', JSON.stringify({
      roomCode: code, role: 'host', seatIndex: 0,
    }))
    setTimeout(() => {
      setView('game')
      setStartingGame(false)
    }, 400)
  }

  // Online multiplayer: joiner enters remote game
  function handleJoinGameStart(code: string, seatIdx: number, lobbyPlayers: GameRoomPlayer[]) {
    setRoomCode(code)
    setMySeatIndex(seatIdx)
    setRemotePlayers(lobbyPlayers)
    // Persist session for recovery on refresh
    sessionStorage.setItem('shanghai_active_game', JSON.stringify({
      roomCode: code, role: 'remote', seatIndex: seatIdx,
    }))
    setView('remote-game')
  }

  // Online multiplayer: join as spectator (read-only, all hands visible)
  // Exposed for future Lobby "Watch" button integration
  const handleSpectate = (code: string) => {
    setRoomCode(code)
    setView('spectator')
  }

  // Tournament match start: create/join game room and navigate to game
  function handleTournamentMatchStart(matchRoomCode: string, isHost: boolean, matchId: string, matchPlayerNames: string[]) {
    setTournamentMatchId(matchId)
    if (isHost) {
      // Host: set up configs and navigate to game board
      const configs: PlayerConfig[] = matchPlayerNames.map(name => ({
        name,
        isAI: false,
      }))
      setPlayerConfigs(configs)
      setRoomCode(matchRoomCode)
      setMySeatIndex(0)
      setRemotePlayers([]) // Will be populated from lobby
      setGameKey(k => k + 1)
      sessionStorage.setItem('shanghai_active_game', JSON.stringify({
        roomCode: matchRoomCode, role: 'host', seatIndex: 0,
      }))
      setView('game')
    } else {
      // Remote player: join the game room and navigate to remote game board
      setRoomCode(matchRoomCode)
      setMySeatIndex(-1) // Will be assigned by the room
      sessionStorage.setItem('shanghai_active_game', JSON.stringify({
        roomCode: matchRoomCode, role: 'remote', seatIndex: -1,
      }))
      setView('remote-game')
    }
  }

  if (view === 'tournament-lobby-create') {
    return (
      <TournamentLobby
        mode="create"
        hostName={tournamentHostName}
        onMatchStart={handleTournamentMatchStart}
        onBack={() => { setTournamentCode(null); setView('landing') }}
      />
    )
  }

  if (view === 'tournament-lobby-join') {
    return (
      <TournamentLobby
        mode="join"
        onMatchStart={handleTournamentMatchStart}
        onBack={() => { setTournamentCode(null); setView('landing') }}
      />
    )
  }

  if (view === 'spectator' && roomCode) {
    return (
      <SpectatorBoard
        roomCode={roomCode}
        onExit={() => {
          setRoomCode(null)
          sessionStorage.removeItem('shanghai_active_game')
          setView('landing')
        }}
      />
    )
  }

  if (view === 'replay' && replayGameId) {
    return (
      <ReplayViewer
        gameId={replayGameId}
        playerNames={replayPlayerNames}
        onExit={() => { setReplayGameId(null); setView('landing') }}
      />
    )
  }

  if (view === 'setup') {
    return (
      <>
        <GameSetup
          onStart={handleStart}
          onCreateOnline={handleCreateOnline}
          onBack={() => setView('landing')}
        />
        {startingGame && (
          <div
            className="fixed inset-0 z-50 bg-black"
            style={{ animation: 'fade-in-black 400ms ease both' }}
          />
        )}
      </>
    )
  }

  if (view === 'tournament-trophy' && tournamentState) {
    const champion = Array.from(tournamentState.standings.entries()).find(([, s]) => s.gamesWon >= 2)
    const championName = champion
      ? playerConfigs.find((_, i) => `p${i}` === champion[0])?.name ?? 'Champion'
      : 'Champion'
    const standings = playerConfigs.map((p, i) => {
      const stats = tournamentState.standings.get(`p${i}`)
      return {
        name: p.name,
        gamesWon: stats?.gamesWon ?? 0,
        totalScore: stats?.totalScore ?? 0,
        isChampion: champion ? `p${i}` === champion[0] : false,
      }
    })
    return (
      <TournamentTrophy
        championName={championName}
        standings={standings}
        seriesLength={tournamentState.currentGameNumber}
        onPlayAgain={handleTournamentPlayAgain}
        onExit={handleExitTournament}
      />
    )
  }

  if (view === 'tournament-gameover' && tournamentState && lastGamePlayers.length > 0) {
    return (
      <GameOver
        players={lastGamePlayers}
        buyLimit={buyLimit}
        buyLog={[]}
        gameId={null}
        onPlayAgain={handleNextTournamentGame}
        onBack={handleExitTournament}
        tournamentState={tournamentState}
        onNextGame={handleNextTournamentGame}
        onExitTournament={handleExitTournament}
      />
    )
  }

  if (view === 'lobby-host' && onlineConfig) {
    return (
      <Lobby
        mode="host"
        config={onlineConfig}
        hostName={onlineHostName}
        aiPersonality={aiPersonality}
        onGameStart={handleHostGameStart}
        onBack={() => setView('setup')}
      />
    )
  }

  if (view === 'lobby-join') {
    return (
      <Lobby
        mode="join"
        onGameStart={handleJoinGameStart}
        onSpectate={handleSpectate}
        onBack={() => setView('landing')}
      />
    )
  }

  if (view === 'remote-game' && roomCode) {
    return (
      <RemoteGameBoard
        roomCode={roomCode}
        mySeatIndex={mySeatIndex}
        onExit={() => {
          setRoomCode(null)
          sessionStorage.removeItem('shanghai_active_game')
          setView('landing')
        }}
      />
    )
  }

  if (view === 'game') {
    return (
      <GameBoard
        key={gameKey}
        initialPlayers={playerConfigs}
        aiPersonality={aiPersonality}
        buyLimit={buyLimit}
        mode={roomCode ? 'host' : 'local'}
        roomCode={roomCode ?? undefined}
        hostSeatIndex={mySeatIndex}
        remoteSeatIndices={roomCode ? remotePlayers.filter(p => !p.is_host && !p.is_ai).map(p => p.seat_index) : undefined}
        onExit={() => {
          setTournamentState(null)
          setRoomCode(null)
          sessionStorage.removeItem('shanghai_active_game')
          setView('landing')
        }}
        onGameComplete={tournamentState ? handleTournamentGameComplete : undefined}
        onReplay={handleStartReplay}
        tournamentGameNumber={tournamentState?.currentGameNumber}
        tournamentMatchId={tournamentMatchId ?? undefined}
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
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
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
        <button
          onClick={() => setView('lobby-join')}
          style={{
            width: '100%',
            background: 'transparent',
            color: '#a8d0a8',
            border: '1px solid #2d5a3a',
            borderRadius: 12,
            padding: 14,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Join Online Game
        </button>
        <button
          onClick={() => { setTournamentHostName('Host'); setTournamentCode(null); setView('tournament-lobby-create') }}
          style={{
            width: '100%',
            background: '#1e4a2e',
            color: '#a8d0a8',
            border: '1px solid #2d5a3a',
            borderRadius: 12,
            padding: 14,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Trophy size={14} /> Create Tournament
        </button>
        <button
          onClick={() => setView('tournament-lobby-join')}
          style={{
            width: '100%',
            background: 'transparent',
            color: '#6aad7a',
            border: '1px solid #2d5a3a',
            borderRadius: 12,
            padding: 14,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Trophy size={14} /> Join Tournament
        </button>
      </div>

    </div>
  )
}
