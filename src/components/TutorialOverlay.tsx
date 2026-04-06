import { useState, useEffect } from 'react'
import { ChevronRight, X } from 'lucide-react'

const STORAGE_KEY = 'shng-tutorial-v1'

interface Slide {
  emoji: string
  title: string
  body: string
  tip?: string
}

const SLIDES: Slide[] = [
  {
    emoji: '🃏',
    title: 'Welcome to Shanghai',
    body: 'Track scores, play digital games, and see who rules your group. Here\'s a quick tour.',
  },
  {
    emoji: '🎮',
    title: 'Play Game',
    body: 'Play a full digital game of Shanghai Rummy — cards dealt, turn-by-turn on one device.',
    tip: 'Add AI opponents so you can play solo or with fewer people.',
  },
  {
    emoji: '📋',
    title: 'Score Tracker',
    body: 'Playing with physical cards? Enter scores round by round as you play.',
    tip: 'Share the room code so friends can follow the scores live on their own devices.',
  },
  {
    emoji: '🏆',
    title: 'Stats & Records',
    body: 'See win counts, averages, streaks, and records across every game you\'ve played.',
    tip: 'Tap any stat or player name to drill into the details.',
  },
]

interface Props {
  onDone: () => void
}

export default function TutorialOverlay({ onDone }: Props) {
  const [slide, setSlide] = useState(0)
  const isLast = slide === SLIDES.length - 1
  const current = SLIDES[slide]

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'done')
    onDone()
  }

  const next = () => {
    if (isLast) {
      dismiss()
    } else {
      setSlide(s => s + 1)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end">
      <div className="w-full max-w-[480px] mx-auto bg-white rounded-t-3xl px-6 pt-6 pb-10 flex flex-col">
        {/* Close button */}
        <div className="flex justify-end mb-2">
          <button onClick={dismiss} className="text-warm-muted p-1 -mr-1 active:opacity-60">
            <X size={20} />
          </button>
        </div>

        {/* Slide dots */}
        <div className="flex gap-1.5 justify-center mb-6">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === slide ? 'w-6 bg-[#8b6914]' : 'w-1.5 bg-[#e2ddd2]'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="text-center flex-1">
          <div className="text-5xl mb-4">{current.emoji}</div>
          <h2 className="text-xl font-bold text-warm-text mb-3">{current.title}</h2>
          <p className="text-[#8b7355] text-sm leading-relaxed">{current.body}</p>
          {current.tip && (
            <div className="mt-4 bg-[#efe9dd] rounded-xl px-4 py-3 text-left">
              <span className="text-[#8b6914] text-xs font-semibold">Tip: </span>
              <span className="text-[#8b7355] text-xs">{current.tip}</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {!isLast && (
            <button
              onClick={dismiss}
              className="flex-none px-5 py-3 text-sm text-warm-muted active:opacity-60"
            >
              Skip
            </button>
          )}
          <button
            onClick={next}
            className="flex-1 btn-primary flex items-center justify-center gap-2"
          >
            {isLast ? 'Get Started' : (
              <>Next <ChevronRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// Hook to control whether tutorial should show
export function useTutorial() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setShow(true)
  }, [])
  const dismiss = () => { localStorage.setItem(STORAGE_KEY, 'done'); setShow(false) }
  const reopen = () => { localStorage.removeItem(STORAGE_KEY); setShow(true) }
  return { show, dismiss, reopen }
}
