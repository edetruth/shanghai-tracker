interface Standing {
  name: string
  score: number
  isHuman: boolean
}

type AnnouncementStage =
  | 'standings'
  | 'final-round'
  | 'blackout'
  | 'requirement'
  | 'dealer'
  | 'countdown-3'
  | 'countdown-2'
  | 'countdown-1'
  | 'dealing'

interface Props {
  stage: AnnouncementStage
  roundNumber: number
  requirementDescription: string
  cardsDealt: number
  dealerName: string
  firstPlayerName: string
  isHumanFirst: boolean
  isFinalRound: boolean
  isLateRound: boolean
  standings: Standing[]
  previousLeader?: string | null
  onSkip: () => void
}

// Round type colors
function getRoundGlow(roundNumber: number): string {
  // Pure sets: rounds 1, 4 → gold
  // Pure runs: rounds 3, 7 → blue
  // Mixed: rounds 2, 5, 6 → gold-blue mix
  const pureSetRounds = [1, 4]
  const pureRunRounds = [3, 7]
  if (pureSetRounds.includes(roundNumber)) return '#e2b858'
  if (pureRunRounds.includes(roundNumber)) return '#5b9bd5'
  return '#b0a060' // mixed — warm blend
}

function getRoundGlowShadow(roundNumber: number): string {
  const color = getRoundGlow(roundNumber)
  return `0 0 30px ${color}80, 0 0 60px ${color}40`
}

// Late-round urgency background colors
function getUrgencyBg(roundNumber: number): string {
  if (roundNumber >= 7) return '#1a1010'
  if (roundNumber >= 6) return '#1a1510'
  if (roundNumber >= 5) return '#1a1a10'
  return '#000000'
}

export type { AnnouncementStage }

export default function RoundAnnouncement({
  stage,
  roundNumber,
  requirementDescription,
  cardsDealt,
  dealerName,
  firstPlayerName,
  isHumanFirst,
  isFinalRound,
  isLateRound,
  standings,
  previousLeader,
  onSkip,
}: Props) {
  const glowColor = getRoundGlow(roundNumber)

  // ── Standings flash ──────────────────────────────────────────────────────
  if (stage === 'standings') {
    const maxScore = Math.max(...standings.map(s => s.score), 1)
    const sorted = [...standings].sort((a, b) => a.score - b.score)
    const leader = sorted[0]
    const isNewLeader = previousLeader !== null && leader && leader.name !== previousLeader

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ backgroundColor: '#0f2218' }}
        onClick={onSkip}
      >
        <p
          className="text-xs font-bold uppercase tracking-[0.2em] mb-6"
          style={{ color: '#6aad7a' }}
        >
          STANDINGS
        </p>

        <div className="w-full max-w-xs space-y-3">
          {sorted.map((p, i) => {
            const barWidth = maxScore > 0 ? (p.score / maxScore) * 100 : 0
            const isLeader = i === 0
            return (
              <div key={p.name} className="flex items-center gap-3">
                <span
                  className="text-sm font-semibold w-20 text-right truncate"
                  style={{ color: isLeader ? '#e2b858' : '#a8d0a8' }}
                >
                  {p.name}
                </span>
                <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ backgroundColor: '#1e4a2e' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: isLeader ? '#e2b858' : '#3d7a4c',
                      width: `${barWidth}%`,
                      animation: 'bar-grow 800ms ease-out both',
                      ['--bar-width' as string]: `${barWidth}%`,
                    }}
                  />
                </div>
                <span
                  className="text-sm font-bold w-10 text-right tabular-nums"
                  style={{ color: isLeader ? '#e2b858' : '#a8d0a8' }}
                >
                  {p.score}
                </span>
              </div>
            )
          })}
        </div>

        {isNewLeader && (
          <p
            className="mt-4 text-sm font-bold"
            style={{ color: '#e2b858', animation: 'slide-up-bounce 500ms ease-out both' }}
          >
            👑 New leader!
          </p>
        )}

        <p className="absolute bottom-8 text-xs w-full text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Tap anywhere to skip
        </p>
      </div>
    )
  }

  // ── Final Round pre-announcement ─────────────────────────────────────────
  if (stage === 'final-round') {
    const letters = 'FINAL ROUND'.split('')
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ backgroundColor: '#000' }}
        onClick={onSkip}
      >
        <p className="text-xl uppercase font-bold" style={{ letterSpacing: '0.3em', color: '#e87070' }}>
          {letters.map((ch, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                animation: `letter-fade 200ms ease-out ${i * 30}ms both`,
                minWidth: ch === ' ' ? '0.3em' : undefined,
              }}
            >
              {ch}
            </span>
          ))}
        </p>
        <p className="absolute bottom-8 text-xs w-full text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Tap anywhere to skip
        </p>
      </div>
    )
  }

  // ── Blackout + Round Number ──────────────────────────────────────────────
  if (stage === 'blackout') {
    const bg = getUrgencyBg(roundNumber)
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ backgroundColor: bg }}
        onClick={onSkip}
      >
        <p
          className="text-xs font-bold uppercase tracking-[0.3em] mb-2"
          style={{
            color: 'rgba(255,255,255,0.6)',
            animation: 'round-number-in 600ms ease-out 200ms both',
          }}
        >
          ROUND
        </p>
        <span
          className="font-bold text-white"
          style={{
            fontSize: 120,
            lineHeight: 1,
            textShadow: isFinalRound
              ? undefined
              : getRoundGlowShadow(roundNumber),
            animation: isFinalRound
              ? 'round-number-in 800ms ease-out both, final-round-glow 2s ease-in-out infinite'
              : 'round-number-in 800ms ease-out both',
          }}
        >
          {roundNumber}
        </span>
        <p className="absolute bottom-8 text-xs w-full text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Tap anywhere to skip
        </p>
      </div>
    )
  }

  // ── Requirement Reveal ──────────────────────────────────────────────────
  if (stage === 'requirement') {
    const bg = getUrgencyBg(roundNumber)
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ backgroundColor: bg }}
        onClick={onSkip}
      >
        <p
          className="text-xs font-bold uppercase tracking-[0.3em] mb-2"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          ROUND
        </p>
        <span
          className="font-bold text-white mb-6"
          style={{
            fontSize: 72,
            lineHeight: 1,
            textShadow: getRoundGlowShadow(roundNumber),
            transition: 'font-size 500ms ease-out',
          }}
        >
          {roundNumber}
        </span>
        <p
          className="text-2xl font-bold mb-2"
          style={{
            color: glowColor,
            animation: 'slide-up-bounce 500ms ease-out both',
          }}
        >
          {requirementDescription}
        </p>
        <p
          className="text-sm"
          style={{
            color: '#a8d0a8',
            animation: 'slide-up-bounce 500ms ease-out 150ms both',
          }}
        >
          {cardsDealt} cards
        </p>
        <p className="absolute bottom-8 text-xs w-full text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Tap anywhere to skip
        </p>
      </div>
    )
  }

  // ── Dealer + First Player ───────────────────────────────────────────────
  if (stage === 'dealer') {
    const bg = getUrgencyBg(roundNumber)
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ backgroundColor: bg }}
        onClick={onSkip}
      >
        <p
          className="text-xs font-bold uppercase tracking-[0.3em] mb-2"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          ROUND
        </p>
        <span
          className="font-bold text-white mb-6"
          style={{
            fontSize: 72,
            lineHeight: 1,
            textShadow: getRoundGlowShadow(roundNumber),
          }}
        >
          {roundNumber}
        </span>
        <p className="text-2xl font-bold mb-2" style={{ color: glowColor }}>
          {requirementDescription}
        </p>
        <p className="text-sm mb-6" style={{ color: '#a8d0a8' }}>
          {cardsDealt} cards
        </p>

        <p
          className="text-sm mb-1"
          style={{ color: '#a8d0a8', animation: 'slide-up-bounce 400ms ease-out both' }}
        >
          🃏 {dealerName} deals
        </p>
        <p
          className="text-sm font-semibold"
          style={{
            color: isHumanFirst ? '#ffffff' : '#a8d0a8',
            animation: 'slide-up-bounce 400ms ease-out 300ms both',
          }}
        >
          → {isHumanFirst ? "You're up first!" : `${firstPlayerName} goes first`}
        </p>
        <p className="absolute bottom-8 text-xs w-full text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Tap anywhere to skip
        </p>
      </div>
    )
  }

  // ── Countdown (3, 2, 1) ─────────────────────────────────────────────────
  if (stage === 'countdown-3' || stage === 'countdown-2' || stage === 'countdown-1') {
    const num = stage === 'countdown-3' ? 3 : stage === 'countdown-2' ? 2 : 1
    const bg = getUrgencyBg(roundNumber)
    const isGoldenFlash = num === 1
    const pulseAnim = isLateRound ? 'heartbeat-pulse' : 'countdown-pulse'
    const duration = isFinalRound ? '800ms' : '700ms'

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 relative"
        style={{ backgroundColor: bg }}
        onClick={onSkip}
      >
        {/* Background info at reduced opacity */}
        <div style={{ position: 'absolute', top: '25%', textAlign: 'center', opacity: 0.3 }}>
          <p className="text-xs font-bold uppercase tracking-[0.3em] mb-1" style={{ color: '#fff' }}>
            ROUND {roundNumber}
          </p>
          <p className="text-lg font-bold" style={{ color: glowColor }}>
            {requirementDescription}
          </p>
        </div>

        {/* Countdown number */}
        <div className="relative">
          {/* Ripple ring */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ pointerEvents: 'none' }}
          >
            <div
              className="rounded-full"
              style={{
                width: 120,
                height: 120,
                border: `2px solid ${isGoldenFlash ? '#e2b858' : 'rgba(255,255,255,0.3)'}`,
                animation: `ripple ${duration} ease-out both`,
              }}
            />
          </div>

          <span
            className="font-bold"
            style={{
              fontSize: 80,
              lineHeight: 1,
              color: isGoldenFlash ? '#e2b858' : '#ffffff',
              animation: `${pulseAnim} ${duration} ease-out both`,
              textShadow: isGoldenFlash
                ? '0 0 30px rgba(226,184,88,0.8)'
                : '0 0 20px rgba(255,255,255,0.3)',
            }}
          >
            {num}
          </span>
        </div>

        <p className="absolute bottom-8 text-xs w-full text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Tap anywhere to skip
        </p>
      </div>
    )
  }

  // ── Dealing transition ──────────────────────────────────────────────────
  if (stage === 'dealing') {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundColor: '#1a3a2a',
          animation: 'round-number-in 200ms ease-out both',
        }}
        onClick={onSkip}
      />
    )
  }

  return null
}
