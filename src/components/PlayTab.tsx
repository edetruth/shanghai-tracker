import { useState } from 'react'
import { Gamepad2, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import GameSetup from './play/GameSetup'
import GameBoard from './play/GameBoard'
import type { PlayerConfig, AIDifficulty } from '../game/types'

type PlayView = 'rules' | 'setup' | 'game'

const ROUNDS = [
  { num: 1, req: '2 Sets', cards: 10 },
  { num: 2, req: '1 Set + 1 Run', cards: 10 },
  { num: 3, req: '2 Runs', cards: 10 },
  { num: 4, req: '3 Sets', cards: 10 },
  { num: 5, req: '2 Sets + 1 Run', cards: 12 },
  { num: 6, req: '1 Set + 2 Runs', cards: 12 },
  { num: 7, req: '3 Runs', cards: 12 },
]

const CARD_VALUES = [
  { card: 'Number cards (2–10)', value: 'Face value' },
  { card: 'Face cards (J, Q, K)', value: '10 pts' },
  { card: 'Aces', value: '20 pts' },
  { card: 'Jokers', value: '50 pts' },
]

interface Props {
  onBack?: () => void
}

export default function PlayTab({ onBack }: Props) {
  const [view, setView] = useState<PlayView>('rules')
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>([])
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium')
  const [showFullRules, setShowFullRules] = useState(false)

  function handleStart(players: PlayerConfig[], difficulty: AIDifficulty) {
    setPlayerConfigs(players)
    setAiDifficulty(difficulty)
    setView('game')
  }

  if (view === 'setup') {
    return (
      <GameSetup
        onStart={handleStart}
        onBack={() => setView('rules')}
      />
    )
  }

  if (view === 'game') {
    return (
      <GameBoard
        initialPlayers={playerConfigs}
        aiDifficulty={aiDifficulty}
        onExit={() => setView('rules')}
      />
    )
  }

  // Rules view
  return (
    <div className="pb-24 px-4 pt-4">
      {/* Back button */}
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 text-[#8b6914] mb-4 -ml-1 p-1">
          <ArrowLeft size={20} />
          <span className="text-sm font-medium text-[#8b7355]">Home</span>
        </button>
      )}
      {/* Play banner */}
      <div className="card mb-5 text-center py-6">
        <div className="flex justify-center mb-3">
          <div className="w-14 h-14 rounded-full bg-[#efe9dd] flex items-center justify-center">
            <Gamepad2 size={28} strokeWidth={1.5} className="text-[#8b6914]" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[#2c1810] mb-1">Play Shanghai</h1>
        <p className="text-[#8b7355] text-sm">Pass-and-play on one device</p>
      </div>

      {/* Sticky Start button */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-[#f8f6f1] border-t border-[#e2ddd2] z-10 max-w-[480px] mx-auto">
        <button onClick={() => setView('setup')} className="btn-primary">
          Start a Game →
        </button>
      </div>

      {/* House Rules */}
      <div className="card mb-2">
        {/* 7 Rounds — always visible */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#2c1810]">The 7 Rounds</h2>
          <span className="text-xs text-[#a08c6e]">Lowest total wins</span>
        </div>
        <div className="space-y-0 mb-3">
          {ROUNDS.map((r, i) => (
            <div
              key={r.num}
              className={`flex items-center gap-3 py-1.5 ${i < ROUNDS.length - 1 ? 'border-b border-[#e2ddd2]' : ''}`}
            >
              <span className="w-5 h-5 rounded-full bg-[#e2b858] text-[#2c1810] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {r.num}
              </span>
              <span className="flex-1 text-sm text-[#2c1810]">{r.req}</span>
              <span className="text-xs text-[#8b7355]">{r.cards}c</span>
            </div>
          ))}
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setShowFullRules(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 pt-2 border-t border-[#e2ddd2] text-xs font-medium text-[#8b6914] active:opacity-70"
        >
          {showFullRules ? (
            <><ChevronUp size={14} /> Hide full rules</>
          ) : (
            <><ChevronDown size={14} /> Melds · Turn · Buying · Scoring</>
          )}
        </button>

        {/* Expandable detail */}
        {showFullRules && (
          <div className="mt-3 space-y-4 border-t border-[#e2ddd2] pt-3">

            {/* Melds */}
            <div>
              <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">Melds</p>
              <div className="space-y-1.5 text-sm">
                {[
                  ['Set', '3+ same rank (any suit)'],
                  ['Run', '4+ in sequence, same suit'],
                  ['Aces', 'High or low — A-2-3-4 or J-Q-K-A, no wrap'],
                  ['🃏', 'Jokers are wild — no limit per meld'],
                  ['Extra', 'May lay down additional melds matching the round type (sets-only round = sets only, etc.)'],
                ].map(([label, desc]) => (
                  <div key={label} className="flex gap-2">
                    <span className="font-semibold text-[#8b6914] w-8 flex-shrink-0 text-xs leading-5">{label}</span>
                    <span className="text-[#8b7355]">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Turn flow */}
            <div>
              <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">Turn Flow</p>
              <div className="space-y-1.5 text-sm text-[#8b7355]">
                {['Draw', 'Meld (optional)', 'Lay off (optional)', 'Discard'].map((step, i) => (
                  <div key={i} className="flex gap-2 items-baseline">
                    <span className="w-4 h-4 rounded-full border border-[#e2ddd2] text-[#a08c6e] text-[10px] flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
                <p className="text-xs text-[#a08c6e] pl-6">Going out: play ALL cards — no final discard needed.</p>
              </div>
            </div>

            {/* Buying */}
            <div>
              <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">Buying</p>
              <p className="text-sm text-[#8b7355]">
                Out-of-turn players can buy a discarded card — they get it{' '}
                <span className="font-semibold text-[#2c1810]">plus a penalty card</span> from the draw pile.{' '}
                <span className="font-semibold text-[#8b6914]">5 buys per player per round</span> (resets each round).
                Joker swaps: if a meld has a joker, swap in the natural card and take the joker back.
              </p>
            </div>

            {/* Scoring */}
            <div>
              <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">Scoring</p>
              <div className="flex gap-4 text-sm text-[#8b7355] flex-wrap">
                {CARD_VALUES.map(row => (
                  <span key={row.card}><span className="font-semibold text-[#2c1810]">{row.value}</span> {row.card}</span>
                ))}
              </div>
              <p className="text-xs text-[#a08c6e] mt-1.5">
                Not laid down when someone goes out = Shanghai (all cards count, typically 100–200+ pts).
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
