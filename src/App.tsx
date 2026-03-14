import { useState } from 'react'
import BottomNav from './components/BottomNav'
import PlayerSetup from './components/PlayerSetup'
import ScoreEntry from './components/ScoreEntry'
import GameSummary from './components/GameSummary'
import GameHistory from './components/GameHistory'
import StatsLeaderboard from './components/StatsLeaderboard'
import JoinGame from './components/JoinGame'
import PlayerProfileModal from './components/PlayerProfileModal'
import type { Game, Player } from './lib/types'

type Tab = 'new' | 'history' | 'stats'
type NewGameState = 'setup' | 'playing' | 'summary' | 'joining'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('new')
  const [gameState, setGameState] = useState<NewGameState>('setup')
  const [activeGame, setActiveGame] = useState<Game | null>(null)
  const [activePlayers, setActivePlayers] = useState<Player[]>([])
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)

  const handlePlayerClick = (id: string) => setSelectedPlayerId(id)

  const handleGameCreated = (game: Game, players: Player[]) => {
    setActiveGame(game)
    setActivePlayers(players)
    setGameState('playing')
  }

  const handleRoundsComplete = () => setGameState('summary')

  const handleGameSaved = () => {
    setActiveGame(null)
    setActivePlayers([])
    setGameState('setup')
    setActiveTab('history')
  }

  const handleBackToSetup = () => {
    setGameState('setup')
    setActiveGame(null)
    setActivePlayers([])
  }

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    if (tab === 'new' && gameState !== 'playing' && gameState !== 'summary') {
      setGameState('setup')
    }
  }

  return (
    <div className="max-w-[480px] mx-auto w-full flex flex-col min-h-[100dvh] relative">
      <main className="flex-1 overflow-auto">
        {activeTab === 'new' && gameState === 'setup' && (
          <PlayerSetup
            onGameCreated={handleGameCreated}
            onJoinGame={() => setGameState('joining')}
          />
        )}
        {activeTab === 'new' && gameState === 'joining' && (
          <JoinGame onBack={handleBackToSetup} />
        )}
        {activeTab === 'new' && gameState === 'playing' && activeGame && (
          <ScoreEntry
            game={activeGame}
            players={activePlayers}
            onComplete={handleRoundsComplete}
            onBack={handleBackToSetup}
          />
        )}
        {activeTab === 'new' && gameState === 'summary' && activeGame && (
          <GameSummary
            game={activeGame}
            players={activePlayers}
            onDone={handleGameSaved}
            onPlayerClick={handlePlayerClick}
          />
        )}
        {activeTab === 'history' && (
          <GameHistory onPlayerClick={handlePlayerClick} />
        )}
        {activeTab === 'stats' && (
          <StatsLeaderboard onPlayerClick={handlePlayerClick} />
        )}
      </main>

      {/* Hide nav during active game */}
      {gameState !== 'playing' && gameState !== 'summary' && (
        <BottomNav active={activeTab} onChange={handleTabChange} />
      )}

      {/* Player profile modal */}
      {selectedPlayerId && (
        <PlayerProfileModal
          playerId={selectedPlayerId}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  )
}
