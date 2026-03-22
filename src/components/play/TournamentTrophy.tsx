import { useEffect } from 'react'
import { haptic } from '../../lib/haptics'

interface Standing {
  name: string
  gamesWon: number
  totalScore: number
  isChampion: boolean
}

interface Props {
  championName: string
  standings: Standing[]
  seriesLength: number  // 2 or 3 games played
  onPlayAgain: () => void
  onExit: () => void
}

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}']  // gold, silver, bronze

export default function TournamentTrophy({ championName, standings, seriesLength, onPlayAgain, onExit }: Props) {
  useEffect(() => {
    haptic('success')
  }, [])

  // Sort standings: most wins first, then lowest total score
  const sorted = [...standings].sort((a, b) => {
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon
    return a.totalScore - b.totalScore
  })

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#1a3a2a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Header area */}
        <div
          style={{
            paddingTop: 'max(40px, env(safe-area-inset-top))',
            paddingLeft: 16,
            paddingRight: 16,
            paddingBottom: 24,
            textAlign: 'center',
          }}
        >
          {/* Tournament champion header */}
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#e2b858',
              letterSpacing: 3,
              textTransform: 'uppercase',
              margin: '0 0 20px',
            }}
          >
            {'\u{1F3C6}'} TOURNAMENT CHAMPION {'\u{1F3C6}'}
          </p>

          {/* Gold decorative line */}
          <div
            style={{
              width: 120,
              height: 2,
              margin: '0 auto 20px',
              background: 'linear-gradient(90deg, transparent, #e2b858, transparent)',
            }}
          />

          {/* Champion name with slam-in animation */}
          <p
            className="animate-slam-in"
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: '#ffffff',
              margin: '0 0 8px',
              textShadow: '0 0 20px rgba(226, 184, 88, 0.5), 0 0 40px rgba(226, 184, 88, 0.2)',
            }}
          >
            {championName}
          </p>

          {/* Subtitle */}
          <p style={{ fontSize: 13, color: '#6aad7a', margin: '0 0 24px' }}>
            Won 2 of {seriesLength} games
          </p>

          {/* Another gold decorative line */}
          <div
            style={{
              width: 80,
              height: 1,
              margin: '0 auto 24px',
              background: 'linear-gradient(90deg, transparent, #e2b858, transparent)',
            }}
          />

          {/* Final standings header */}
          <p
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#6aad7a',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              margin: '0 0 14px',
            }}
          >
            Final Standings
          </p>

          {/* Standings list */}
          <div
            style={{
              maxWidth: 340,
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {sorted.map((player, idx) => {
              const medal = idx < 3 ? MEDALS[idx] : ''
              const isChamp = player.isChampion
              return (
                <div
                  key={player.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    background: isChamp ? '#0f2218' : '#0f2218',
                    border: isChamp ? '1.5px solid #e2b858' : '1px solid #2d5a3a',
                    borderRadius: 10,
                  }}
                >
                  {/* Medal / rank */}
                  <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>
                    {medal || (idx + 1)}
                  </span>

                  {/* Name */}
                  <span
                    style={{
                      flex: 1,
                      fontSize: 15,
                      fontWeight: isChamp ? 700 : 500,
                      color: isChamp ? '#e2b858' : '#a8d0a8',
                      textAlign: 'left',
                    }}
                  >
                    {player.name}
                  </span>

                  {/* Wins */}
                  <div style={{ textAlign: 'center', minWidth: 44 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: isChamp ? '#e2b858' : '#a8d0a8', margin: 0 }}>
                      {player.gamesWon}
                    </p>
                    <p style={{ fontSize: 8, color: '#6aad7a', margin: 0 }}>
                      wins
                    </p>
                  </div>

                  {/* Total score */}
                  <div style={{ textAlign: 'center', minWidth: 50 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#a8d0a8', margin: 0 }}>
                      {player.totalScore}
                    </p>
                    <p style={{ fontSize: 8, color: '#6aad7a', margin: 0 }}>
                      total
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 10,
          padding: '12px 16px',
          paddingBottom: 'max(20px, calc(env(safe-area-inset-bottom) + 12px))',
          borderTop: '1px solid #2d5a3a',
        }}
      >
        <button
          onClick={onExit}
          style={{
            flex: 1,
            background: 'transparent',
            border: '1.5px solid #6aad7a',
            color: '#6aad7a',
            borderRadius: 10,
            padding: '12px 0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Back to Home
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
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Play Again
        </button>
      </div>
    </div>
  )
}
