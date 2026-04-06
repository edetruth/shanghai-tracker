import { Gamepad2, ClipboardList, Trophy, HelpCircle, BarChart3 } from 'lucide-react'

type Section = 'play' | 'scoretracker' | 'stats' | 'analytics'

interface Props {
  onNavigate: (section: Section) => void
  onShowTutorial?: () => void
}

const CARDS = [
  {
    id: 'play' as Section,
    Icon: Gamepad2,
    title: 'Play Game',
    sub: 'Local, AI, or online',
  },
  {
    id: 'scoretracker' as Section,
    Icon: ClipboardList,
    title: 'Score Tracker',
    sub: 'Enter scores & view history',
  },
  {
    id: 'stats' as Section,
    Icon: Trophy,
    title: 'Stats & Records',
    sub: 'Leaderboards & player stats',
  },
  {
    id: 'analytics' as Section,
    Icon: BarChart3,
    title: 'Analytics',
    sub: 'AI performance & game insights',
  },
]

export default function HomePage({ onNavigate, onShowTutorial }: Props) {
  return (
    <div className="flex flex-col min-h-[100dvh] px-4 pt-10 pb-8">
      {/* Title */}
      <div
        className="text-center mb-10 relative"
        style={{ animation: 'slide-up-fade 400ms ease-out 0ms both' }}
      >
        <div className="text-5xl mb-3">🃏</div>
        <h1 className="font-heading text-4xl font-bold text-[#8b6914]">Shanghai</h1>
        <p className="text-[#8b7355] mt-2 text-sm">Shanghai Rummy Score Tracker</p>
        {onShowTutorial && (
          <button
            onClick={onShowTutorial}
            className="absolute top-0 right-0 text-[#a08c6e] p-1 active:opacity-60"
            title="Show tutorial"
          >
            <HelpCircle size={20} />
          </button>
        )}
      </div>

      {/* Navigation cards */}
      <div className="flex flex-col gap-4">
        {CARDS.map((card, i) => (
          <button
            key={card.id}
            onClick={() => onNavigate(card.id)}
            className="card p-5 text-left flex items-center gap-4 active:opacity-80 transition-opacity"
            style={{ animation: `slide-up-fade 400ms ease-out ${200 + i * 100}ms both` }}
          >
            <div className="w-14 h-14 bg-[#efe9dd] rounded-2xl flex items-center justify-center flex-shrink-0">
              <card.Icon size={28} className="text-[#8b6914]" />
            </div>
            <div>
              <div className="text-[#2c1810] font-semibold text-lg">{card.title}</div>
              <div className="text-[#8b7355] text-sm mt-0.5">{card.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
