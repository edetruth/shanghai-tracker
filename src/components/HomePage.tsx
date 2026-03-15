import { Gamepad2, ClipboardList, Trophy, HelpCircle } from 'lucide-react'

type Section = 'play' | 'scoretracker' | 'stats'

interface Props {
  onNavigate: (section: Section) => void
  onShowTutorial?: () => void
}

export default function HomePage({ onNavigate, onShowTutorial }: Props) {
  return (
    <div className="flex flex-col min-h-[100dvh] px-4 pt-10 pb-8">
      {/* Title */}
      <div className="text-center mb-10 relative">
        <div className="text-5xl mb-3">🃏</div>
        <h1 className="font-display text-4xl font-bold text-[#8b6914]">Shanghai</h1>
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
        <button
          onClick={() => onNavigate('play')}
          className="card p-5 text-left flex items-center gap-4 active:opacity-80 transition-opacity"
        >
          <div className="w-14 h-14 bg-[#efe9dd] rounded-2xl flex items-center justify-center flex-shrink-0">
            <Gamepad2 size={28} className="text-[#8b6914]" />
          </div>
          <div>
            <div className="text-[#2c1810] font-semibold text-lg">Play Game</div>
            <div className="text-[#8b7355] text-sm mt-0.5">Play against AI or friends</div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('scoretracker')}
          className="card p-5 text-left flex items-center gap-4 active:opacity-80 transition-opacity"
        >
          <div className="w-14 h-14 bg-[#efe9dd] rounded-2xl flex items-center justify-center flex-shrink-0">
            <ClipboardList size={28} className="text-[#8b6914]" />
          </div>
          <div>
            <div className="text-[#2c1810] font-semibold text-lg">Score Tracker</div>
            <div className="text-[#8b7355] text-sm mt-0.5">Enter scores & view history</div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('stats')}
          className="card p-5 text-left flex items-center gap-4 active:opacity-80 transition-opacity"
        >
          <div className="w-14 h-14 bg-[#efe9dd] rounded-2xl flex items-center justify-center flex-shrink-0">
            <Trophy size={28} className="text-[#8b6914]" />
          </div>
          <div>
            <div className="text-[#2c1810] font-semibold text-lg">Stats & Records</div>
            <div className="text-[#8b7355] text-sm mt-0.5">Leaderboards & player stats</div>
          </div>
        </button>
      </div>
    </div>
  )
}
