interface Props {
  playerName: string
  onReady: () => void
  message?: string
  roundNum?: number
  requirement?: string
  rank?: number
  totalPlayers?: number
  scoreDiff?: number
}

export default function PrivacyScreen({ playerName, onReady, message, roundNum, requirement, rank, scoreDiff }: Props) {
  const initial = playerName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <p className="text-sm text-[#8b7355] mb-6">Pass to</p>

        {/* Gold circle with initial */}
        <div className="w-20 h-20 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-warm-text">{initial}</span>
        </div>

        <h2 className="text-2xl font-bold text-warm-text mb-2">{playerName}</h2>

        {roundNum && requirement && (
          <p className="text-sm text-[#8b7355] mb-1">Round {roundNum} &middot; {requirement}</p>
        )}
        {rank !== undefined && (
          <p className="text-sm text-warm-muted mb-6">
            {rank === 1 ? 'Leading!' : `${rank}${rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} place${scoreDiff ? ` · ${scoreDiff} pts behind` : ''}`}
          </p>
        )}

        {message && (
          <p className="text-sm text-[#8b7355] mb-8">{message}</p>
        )}

        <p className="text-xs text-warm-muted mb-8">
          Make sure only {playerName} can see the screen, then tap Ready.
        </p>

        <button onClick={onReady} className="btn-primary">
          Ready
        </button>
      </div>
    </div>
  )
}
