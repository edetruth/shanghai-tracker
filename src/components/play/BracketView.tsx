import type { TournamentMatch } from '../../lib/tournamentStore'

interface Props {
  matches: TournamentMatch[]
  playerCount: number
  currentPlayerName?: string
}

export default function BracketView({ matches, playerCount, currentPlayerName }: Props) {
  const totalRounds = Math.log2(playerCount)
  const roundLabels = playerCount === 8
    ? ['Quarter Finals', 'Semi Finals', 'Finals']
    : ['Semi Finals', 'Finals']

  return (
    <div style={{ overflowX: 'auto', padding: '12px' }} role="list" aria-label="Tournament bracket">
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minWidth: totalRounds * 160 }}>
        {Array.from({ length: totalRounds }, (_, roundIdx) => {
          const round = roundIdx + 1
          const roundMatches = matches.filter(m => m.round_number === round)

          return (
            <div key={round} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 140 }}>
              <div style={{
                color: round === totalRounds ? '#e2b858' : '#8b7355',
                fontSize: 10, fontWeight: 600, textAlign: 'center',
                textTransform: 'uppercase', letterSpacing: 1,
              }}>
                {roundLabels[roundIdx] ?? `Round ${round}`}
              </div>

              {roundMatches.map(match => {
                const isActive = match.status === 'in_progress'
                const isFinished = match.status === 'finished'
                const isPending = match.status === 'pending'
                const isFinal = round === totalRounds

                return (
                  <div key={match.id ?? `${match.round_number}-${match.match_index}`} aria-label={`Match: ${match.player_names.length > 0 ? match.player_names.join(' vs ') : 'TBD'}${isActive ? ' (in progress)' : isFinished && match.winner_name ? ` — winner: ${match.winner_name}` : ''}`} style={{
                    background: '#0f2218',
                    border: isActive ? '2px solid #e2b858' : isFinal ? '2px solid #e2b858' : '1px solid #2d5a3a',
                    borderRadius: 8,
                    padding: '8px 10px',
                    opacity: isPending && match.player_names.length === 0 ? 0.3 : 1,
                  }}>
                    {match.player_names.length > 0 ? (
                      match.player_names.map((name, i) => (
                        <div key={name} style={{
                          color: match.winner_name === name ? '#6aad7a'
                            : isFinished && match.winner_name !== name ? '#3a5a3a'
                            : name === currentPlayerName ? '#e2b858'
                            : '#a8d0a8',
                          fontSize: 11,
                          fontWeight: match.winner_name === name ? 700 : 400,
                          padding: '2px 0',
                          borderTop: i > 0 ? '1px solid #1a3a2a' : 'none',
                          display: 'flex', justifyContent: 'space-between',
                        }}>
                          <span>{name}{match.winner_name === name ? ' \u2713' : ''}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: '#3a5a3a', fontSize: 10 }}>TBD</div>
                    )}
                    {isActive && (
                      <div style={{
                        color: '#e2b858', fontSize: 9, fontWeight: 700,
                        textAlign: 'center', marginTop: 4,
                      }}>
                        In Progress
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
