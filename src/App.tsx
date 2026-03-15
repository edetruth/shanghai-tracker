import { useState } from 'react'
import TutorialOverlay, { useTutorial } from './components/TutorialOverlay'
import HomePage from './components/HomePage'
import PlayerSetup from './components/PlayerSetup'
import ScoreEntry from './components/ScoreEntry'
import GameSummary from './components/GameSummary'
import ScoreTrackerPage from './components/ScoreTrackerPage'
import StatsLeaderboard from './components/StatsLeaderboard'
import JoinGame from './components/JoinGame'
import PlayerProfileModal from './components/PlayerProfileModal'
import PlayTab from './components/PlayTab'
import type { Game, Player } from './lib/types'

type Section = 'home' | 'play' | 'scoretracker' | 'stats'
type ScoreTrackerState = 'list' | 'setup' | 'playing' | 'summary' | 'joining'

export default function App() {
  const tutorial = useTutorial()
  const [section, setSection] = useState<Section>('home')
  const [scoreTrackerState, setScoreTrackerState] = useState<ScoreTrackerState>('list')
  const [activeGame, setActiveGame] = useState<Game | null>(null)
  const [activePlayers, setActivePlayers] = useState<Player[]>([])
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)

  const handlePlayerClick = (id: string) => setSelectedPlayerId(id)

  const navigateTo = (s: Section) => {
    setSection(s)
    if (s === 'scoretracker' && scoreTrackerState !== 'playing' && scoreTrackerState !== 'summary') {
      setScoreTrackerState('list')
    }
  }

  const handleGameCreated = (game: Game, players: Player[]) => {
    setActiveGame(game)
    setActivePlayers(players)
    setScoreTrackerState('playing')
  }

  const handleRoundsComplete = () => setScoreTrackerState('summary')

  const handleGameSaved = () => {
    setActiveGame(null)
    setActivePlayers([])
    setScoreTrackerState('list')
  }

  const handleBackToList = () => {
    setActiveGame(null)
    setActivePlayers([])
    setScoreTrackerState('list')
  }

  return (
    <div className="max-w-[480px] mx-auto w-full flex flex-col min-h-[100dvh] relative">
      <main className="flex-1 overflow-auto">

        {section === 'home' && (
          <HomePage
            onNavigate={navigateTo}
            onShowTutorial={tutorial.reopen}
          />
        )}

        {section === 'play' && (
          <PlayTab onBack={() => navigateTo('home')} />
        )}

        {section === 'scoretracker' && scoreTrackerState === 'list' && (
          <ScoreTrackerPage
            onNavigateHome={() => navigateTo('home')}
            onStartNewGame={() => setScoreTrackerState('setup')}
            onPlayerClick={handlePlayerClick}
          />
        )}

        {section === 'scoretracker' && scoreTrackerState === 'setup' && (
          <PlayerSetup
            onGameCreated={handleGameCreated}
            onJoinGame={() => setScoreTrackerState('joining')}
            onBack={handleBackToList}
          />
        )}

        {section === 'scoretracker' && scoreTrackerState === 'joining' && (
          <JoinGame onBack={handleBackToList} />
        )}

        {section === 'scoretracker' && scoreTrackerState === 'playing' && activeGame && (
          <ScoreEntry
            game={activeGame}
            players={activePlayers}
            onComplete={handleRoundsComplete}
            onBack={handleBackToList}
          />
        )}

        {section === 'scoretracker' && scoreTrackerState === 'summary' && activeGame && (
          <GameSummary
            game={activeGame}
            players={activePlayers}
            onDone={handleGameSaved}
            onPlayerClick={handlePlayerClick}
          />
        )}

        {section === 'stats' && (
          <StatsLeaderboard
            onPlayerClick={handlePlayerClick}
            onNavigateHome={() => navigateTo('home')}
          />
        )}

      </main>

      {selectedPlayerId && (
        <PlayerProfileModal
          playerId={selectedPlayerId}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}

      {tutorial.show && (
        <TutorialOverlay onDone={tutorial.dismiss} />
      )}
    </div>
  )
}
