import { useState } from 'react'
import BottomNav from './components/BottomNav'
import PlayerSetup from './components/PlayerSetup'
import ScoreEntry from './components/ScoreEntry'
import GameSummary from './components/GameSummary'
import GameHistory from './components/GameHistory'
import StatsLeaderboard from './components/StatsLeaderboard'
import JoinGame from './components/JoinGame'
import type { Game, Player } from './lib/types'

type Tab = 'new' | 'history' | 'stats'
type NewGameState = 'setup' | 'playing' | 'summary' | 'joining'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('new')
  const [gameState, setGameState] = useState<NewGameState>('setup')
  const [activeGame, setActiveGame] = useState<Game | null>(null)
  const [activePlayers, setActivePlayers] = useState<Player[]>([])

  const handleGameCreated = (game: Game, players: Player[]) => {
    setActiveGame(game)
    setActivePlayers(players)
    setGameState('playing')
  }

  const handleRoundsComplete = () => {
    setGameState('summary')
  }

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
      {/* Main content area */}
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
          />
        )}
        {activeTab === 'history' && <GameHistory />}
        {activeTab === 'stats' && <StatsLeaderboard />}
      </main>

      {/* Hide nav during active game to maximize screen space */}
      {(gameState !== 'playing' && gameState !== 'summary') && (
        <BottomNav active={activeTab} onChange={handleTabChange} />
      )}
    </div>
  )
}
