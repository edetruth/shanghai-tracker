import type { Card as CardType } from '../../game/types'

interface FlyingCardState {
  from: { x: number; y: number }
  to: { x: number; y: number }
  card?: CardType
  faceDown: boolean
}

interface SwapAnimState {
  natural: CardType
  joker: CardType
  isHeist: boolean
}

interface CinematicOverlaysProps {
  goingOutSequence: 'idle' | 'flash' | 'announce'
  goOutPlayerName: string
  showDarkBeat: boolean
  turnBanner: string | null
  // Swap animation
  swapAnim: SwapAnimState | null
  // Flying card
  flyingCard: FlyingCardState | null
  flyingCardDuration: number
}

export default function CinematicOverlays({
  goingOutSequence,
  goOutPlayerName,
  showDarkBeat,
  turnBanner,
  swapAnim,
  flyingCard,
  flyingCardDuration,
}: CinematicOverlaysProps) {
  return (
    <>
      {/* Dark beat overlay — briefly flashes black on round end */}
      {showDarkBeat && (
        <div
          className="fixed inset-0 z-40 bg-black"
          style={{ animation: 'fade-in-black 500ms ease both' }}
        />
      )}

      {/* Turn banner — non-blocking overlay for solo-human games */}
      {turnBanner && (
        <div style={{
          position: 'absolute',
          top: 'max(52px, calc(env(safe-area-inset-top) + 44px))',
          left: 0, right: 0,
          zIndex: 40,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          animation: 'turnBannerIn 0.3s ease-out',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #e2b858, #d4a843)',
            color: '#2c1810',
            padding: '8px 24px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            {turnBanner}
          </div>
        </div>
      )}

      {/* Going-out cinematic overlay */}
      {goingOutSequence !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          {goingOutSequence === 'flash' && (
            <div className="absolute inset-0 bg-white" style={{ animation: 'go-impact-flash 400ms ease-out forwards' }} />
          )}
          {goingOutSequence === 'announce' && (
            <>
              <div className="absolute inset-0 bg-black/40" style={{ animation: 'go-backdrop-fade 300ms ease-out forwards' }} />
              <div className="z-10 text-center" style={{ animation: 'slam-in 400ms ease-out' }}>
                <p className="text-4xl font-black text-[#e2b858] m-0" style={{ textShadow: '0 2px 16px rgba(226,184,88,0.5)' }}>{goOutPlayerName}</p>
                <p className="text-xl font-bold text-white mt-2 m-0">GOES OUT!</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Joker swap "The Exchange" cinematic overlay */}
      {swapAnim && (
        <div className="fixed inset-0 z-[150] pointer-events-none flex items-center justify-center">
          {/* Center burst glow */}
          <div style={{
            position: 'absolute', width: 96, height: 96, borderRadius: '50%',
            background: swapAnim.isHeist
              ? 'radial-gradient(circle, rgba(248,113,113,0.5) 0%, rgba(226,184,88,0.3) 50%, transparent 70%)'
              : 'radial-gradient(circle, rgba(226,184,88,0.6) 0%, rgba(226,184,88,0.2) 50%, transparent 70%)',
            animation: 'swap-burst 850ms ease-out forwards',
          }} />

          {/* Label */}
          <div style={{
            position: 'absolute', top: 'calc(50% + 56px)',
            color: swapAnim.isHeist ? '#f87171' : '#e2b858',
            fontSize: 13, fontWeight: 800, letterSpacing: '0.05em',
            textShadow: '0 1px 6px rgba(0,0,0,0.8)',
            animation: 'swap-label 850ms ease-out forwards',
          }}>
            {swapAnim.isHeist ? '⚡ THE HEIST' : '♻ JOKER FREE'}
          </div>

          {/* Natural card: enters bottom-right, exits top-left */}
          <div style={{ position: 'absolute', animation: 'swap-natural 850ms ease-in-out forwards' }}>
            <SwapCard card={swapAnim.natural} />
          </div>

          {/* Joker card: enters top-left, exits bottom-right */}
          <div style={{ position: 'absolute', animation: 'swap-joker 850ms ease-in-out forwards' }}>
            <SwapCard card={swapAnim.joker} />
          </div>
        </div>
      )}

      {/* Flying card animation overlay */}
      {flyingCard && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            left: flyingCard.from.x - 24,
            top: flyingCard.from.y,
            width: 48,
            height: 68,
            willChange: 'transform',
            animation: `fly-card ${flyingCardDuration}ms ease-out forwards`,
            '--fly-to-x': `${flyingCard.to.x - flyingCard.from.x}px`,
            '--fly-to-y': `${flyingCard.to.y - flyingCard.from.y}px`,
          } as React.CSSProperties}
        >
          {flyingCard.faceDown ? (
            <div className="w-full h-full rounded-lg bg-[#2d5a3c] border-2 border-[#e2b858]" />
          ) : flyingCard.card ? (
            <div className="w-full h-full rounded-lg overflow-hidden" style={{ backgroundColor: '#fff', border: '1.5px solid #e2ddd2' }}>
              <div className="text-center pt-1 text-xs font-bold" style={{ color: flyingCard.card.suit === 'hearts' || flyingCard.card.suit === 'diamonds' ? '#c0393b' : '#2c1810' }}>
                {flyingCard.card.rank === 0 ? 'JKR' : flyingCard.card.rank === 1 ? 'A' : flyingCard.card.rank === 11 ? 'J' : flyingCard.card.rank === 12 ? 'Q' : flyingCard.card.rank === 13 ? 'K' : flyingCard.card.rank}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}

// Large card face used in the joker swap cinematic overlay
function SwapCard({ card }: { card: CardType }) {
  const isJoker = card.suit === 'joker'
  const rank = card.rank === 0 ? 'JKR' : card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : String(card.rank)
  const symbol = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : card.suit === 'spades' ? '♠' : ''
  const bg = isJoker ? 'linear-gradient(135deg, #f5e6a3, #e2b858 50%, #c9952c)' :
    card.suit === 'hearts' ? '#fff0f0' : card.suit === 'diamonds' ? '#f0f5ff' :
    card.suit === 'clubs' ? '#e0f7e8' : '#eeecff'
  const color = isJoker ? '#6b4c1e' : card.suit === 'hearts' ? '#c0393b' : card.suit === 'diamonds' ? '#2158b8' : card.suit === 'clubs' ? '#1a6b3a' : '#3d2b8e'
  const border = isJoker ? '2px solid #c9952c' : '1.5px solid rgba(0,0,0,0.12)'

  return (
    <div style={{
      width: 68, height: 100, borderRadius: 10,
      background: bg, border,
      boxShadow: isJoker
        ? '0 4px 20px rgba(226,184,88,0.7), 0 2px 8px rgba(0,0,0,0.4)'
        : '0 4px 20px rgba(0,0,0,0.35)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 2,
    }}>
      {isJoker ? (
        <>
          <span style={{ fontSize: 28, lineHeight: 1 }}>👑</span>
          <span style={{ fontSize: 9, fontWeight: 900, color, letterSpacing: '0.08em' }}>JOKER</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1 }}>{rank}</span>
          <span style={{ fontSize: 22, color, lineHeight: 1 }}>{symbol}</span>
        </>
      )}
    </div>
  )
}
