import { useState } from 'react'
import { Gamepad2, ArrowLeft } from 'lucide-react'
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

      {/* Rules summary */}
      <h2 className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-3">House Rules</h2>

      {/* The 7 Rounds */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-3">The 7 Rounds</h3>
        <div className="space-y-0">
          {ROUNDS.map((r, i) => (
            <div
              key={r.num}
              className={`flex items-center gap-3 py-2 ${i < ROUNDS.length - 1 ? 'border-b border-[#e2ddd2]' : ''}`}
            >
              <span className="w-6 h-6 rounded-full bg-[#e2b858] text-[#2c1810] text-xs font-bold flex items-center justify-center flex-shrink-0">
                {r.num}
              </span>
              <span className="flex-1 text-sm text-[#2c1810]">{r.req}</span>
              <span className="text-xs text-[#8b7355] bg-[#efe9dd] px-2 py-0.5 rounded-full">
                {r.cards} cards
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Melds */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-3">Melds</h3>
        <div className="space-y-2 text-sm text-[#2c1810]">
          <div className="flex gap-2">
            <span className="font-semibold text-[#8b6914] w-10 flex-shrink-0">Set</span>
            <span className="text-[#8b7355]">3+ cards of the same rank (any suits)</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-[#8b6914] w-10 flex-shrink-0">Run</span>
            <span className="text-[#8b7355]">4+ cards in sequence, same suit</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-[#8b6914] w-10 flex-shrink-0">Aces</span>
            <span className="text-[#8b7355]">High or low — A-2-3-4 or J-Q-K-A, no wrap</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-[#8b6914] w-10 flex-shrink-0">🃏</span>
            <span className="text-[#8b7355]">Jokers are wild — no limit per meld</span>
          </div>
        </div>
      </div>

      {/* Turn flow */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-3">Turn Flow</h3>
        <div className="space-y-2">
          {[
            'Draw from draw pile or discard pile',
            'Meld — lay down your required hand (optional)',
            'Lay off — add cards to any meld on the table (optional)',
            'Discard — place one card on the discard pile',
          ].map((step, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <span className="w-5 h-5 rounded-full border border-[#e2ddd2] text-[#8b7355] text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-[#8b7355]">{step}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[#a08c6e] border-t border-[#e2ddd2] pt-3">
          Going out: play ALL remaining cards (meld + lay off). No final discard needed. Round ends immediately.
        </p>
      </div>

      {/* Buying */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-2">Buying</h3>
        <p className="text-sm text-[#8b7355] mb-2">
          When a card is discarded, any out-of-turn player can buy it — they get the discard{' '}
          <span className="font-semibold">plus one penalty card</span> from the draw pile.
        </p>
        <div className="bg-[#efe9dd] rounded-lg px-3 py-2 text-sm">
          <span className="font-semibold text-[#8b6914]">5 buys per player</span>
          <span className="text-[#8b7355]">
            {' '}— across the whole game, not per round. Closest player in turn order wins priority.
          </span>
        </div>
      </div>

      {/* Joker swaps */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-2">Joker Swaps</h3>
        <p className="text-sm text-[#8b7355]">
          If a meld on the table has a joker, any player who has already laid down their hand can swap in the natural
          card the joker represents — and take the joker back into their hand to use elsewhere.
        </p>
      </div>

      {/* Scoring */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-3">Scoring</h3>
        <div className="space-y-0 mb-3">
          {CARD_VALUES.map((row, i) => (
            <div
              key={row.card}
              className={`flex justify-between items-center py-2 text-sm ${i < CARD_VALUES.length - 1 ? 'border-b border-[#e2ddd2]' : ''}`}
            >
              <span className="text-[#8b7355]">{row.card}</span>
              <span className="font-semibold text-[#2c1810]">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="bg-[#fff3f3] border border-[#f5c6c6] rounded-lg px-3 py-2 text-sm">
          <span className="font-semibold text-[#b83232]">Shanghai penalty: </span>
          <span className="text-[#8b7355]">
            If you haven't laid down when someone goes out, all cards in your hand count — typically 100–200+ points.
          </span>
        </div>
        <p className="mt-3 text-xs text-[#a08c6e]">
          Score of 0 = went out first. Lowest total across all 7 rounds wins.
        </p>
      </div>

      {/* Decks */}
      <div className="card mb-2">
        <h3 className="text-sm font-semibold text-[#2c1810] mb-2">Setup</h3>
        <div className="space-y-1 text-sm text-[#8b7355]">
          <p>2–4 players: 2 decks with jokers (108 cards)</p>
          <p>5–8 players: 3 decks with jokers (162 cards)</p>
          <p>Dealer rotates clockwise each round. Player left of dealer goes first.</p>
        </div>
      </div>
    </div>
  )
}
