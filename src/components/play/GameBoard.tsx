import { useState } from 'react'
import { X } from 'lucide-react'
import type { GameState, Player, Card as CardType, Meld } from '../../game/types'
import { ROUND_REQUIREMENTS, CARDS_DEALT, TOTAL_ROUNDS, MAX_BUYS } from '../../game/rules'
import { createDecks, shuffle, dealHands } from '../../game/deck'
import { buildMeld, isValidSet, findSwappableJoker } from '../../game/meld-validator'
import { scoreRound } from '../../game/scoring'
import PrivacyScreen from './PrivacyScreen'
import MeldModal from './MeldModal'
import LayOffModal from './LayOffModal'
import BuyPrompt from './BuyPrompt'
import RoundSummary from './RoundSummary'
import GameOver from './GameOver'
import HandDisplay from './HandDisplay'
import TableMelds from './TableMelds'
import CardComponent from './Card'

interface Props {
  initialPlayerNames: string[]
  onExit: () => void
}

type UIPhase =
  | 'round-start'
  | 'privacy'
  | 'draw'
  | 'action'
  | 'discard'
  | 'buying'
  | 'round-end'
  | 'game-over'

// ── Pure helpers ──────────────────────────────────────────────────────────────

function initGame(names: string[]): GameState {
  const deckCount = 2
  const players: Player[] = names.map((name, i) => ({
    id: `p${i}`,
    name,
    hand: [],
    melds: [],
    hasLaidDown: false,
    buysRemaining: MAX_BUYS,
    roundScores: [],
  }))

  const deck = shuffle(createDecks(deckCount))
  const cardsDealt = CARDS_DEALT[0]
  const { hands, remaining } = dealHands(deck, players.length, cardsDealt)
  players.forEach((p, i) => { p.hand = hands[i] })

  const topDiscard = remaining.shift()!

  return {
    players,
    currentRound: 1,
    deckCount,
    gameOver: false,
    roundState: {
      roundNumber: 1,
      requirement: ROUND_REQUIREMENTS[0],
      cardsDealt,
      drawPile: remaining,
      discardPile: [topDiscard],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      tablesMelds: [],
      meldIdCounter: 0,
      goOutPlayerId: null,
    },
  }
}

function setupRound(state: GameState, roundNum: number): GameState {
  const roundIdx = roundNum - 1
  const requirement = ROUND_REQUIREMENTS[roundIdx]
  const cardsDealt = CARDS_DEALT[roundIdx]
  const deckCount = state.deckCount
  const deck = shuffle(createDecks(deckCount))
  const { hands, remaining } = dealHands(deck, state.players.length, cardsDealt)
  const topDiscard = remaining.shift()!

  const dealerIndex = state.roundState.dealerIndex
  const nextDealer = (dealerIndex + 1) % state.players.length
  const firstPlayer = (nextDealer + 1) % state.players.length

  const players = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    melds: [],
    hasLaidDown: false,
  }))

  return {
    ...state,
    players,
    currentRound: roundNum,
    gameOver: false,
    roundState: {
      roundNumber: roundNum,
      requirement,
      cardsDealt,
      drawPile: remaining,
      discardPile: [topDiscard],
      currentPlayerIndex: firstPlayer,
      dealerIndex: nextDealer,
      tablesMelds: [],
      meldIdCounter: 0,
      goOutPlayerId: null,
    },
  }
}

function getCurrentPlayer(state: GameState): Player {
  return state.players[state.roundState.currentPlayerIndex]
}

function advancePlayer(state: GameState): GameState {
  const next = (state.roundState.currentPlayerIndex + 1) % state.players.length
  return {
    ...state,
    roundState: { ...state.roundState, currentPlayerIndex: next },
  }
}

// Buy order: other players after the current discarder, in turn order, skip 0 buys
function buildBuyerOrder(state: GameState, discarderIndex: number): number[] {
  const order: number[] = []
  const count = state.players.length
  for (let i = 1; i < count; i++) {
    const idx = (discarderIndex + i) % count
    if (state.players[idx].buysRemaining > 0) {
      order.push(idx)
    }
  }
  return order
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GameBoard({ initialPlayerNames, onExit }: Props) {
  const [gameState, setGameState] = useState<GameState>(() => initGame(initialPlayerNames))
  const [uiPhase, setUiPhase] = useState<UIPhase>('round-start')
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [showMeldModal, setShowMeldModal] = useState(false)
  const [showLayOffModal, setShowLayOffModal] = useState(false)
  const [buyerOrder, setBuyerOrder] = useState<number[]>([])
  const [buyerStep, setBuyerStep] = useState(0)
  const [roundResults, setRoundResults] = useState<{ playerId: string; score: number; shanghaied: boolean }[] | null>(null)
  const [buyingDiscard, setBuyingDiscard] = useState<CardType | null>(null)

  const rs = gameState.roundState
  const currentPlayer = getCurrentPlayer(gameState)
  const topDiscard = rs.discardPile[rs.discardPile.length - 1] ?? null

  // ── Toggle card selection in hand ────────────────────────────────────────
  function toggleCard(cardId: string) {
    setSelectedCardIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  // ── Draw from draw pile ───────────────────────────────────────────────────
  function handleDrawFromPile() {
    setGameState(prev => {
      const drawPile = [...prev.roundState.drawPile]
      const card = drawPile.shift()
      if (!card) return prev
      const players = prev.players.map((p, i) =>
        i === prev.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, card] }
          : p
      )
      return { ...prev, players, roundState: { ...prev.roundState, drawPile } }
    })
    setUiPhase('action')
  }

  // ── Take top discard ──────────────────────────────────────────────────────
  function handleTakeDiscard() {
    setGameState(prev => {
      const discardPile = [...prev.roundState.discardPile]
      const card = discardPile.pop()
      if (!card) return prev
      const players = prev.players.map((p, i) =>
        i === prev.roundState.currentPlayerIndex
          ? { ...p, hand: [...p.hand, card] }
          : p
      )
      return { ...prev, players, roundState: { ...prev.roundState, discardPile } }
    })
    setUiPhase('action')
  }

  // ── Start buying window given a state snapshot ────────────────────────────
  function startBuyingWindow(state: GameState, discarder: number, discardCard: CardType | null) {
    const order = buildBuyerOrder(state, discarder)
    setBuyingDiscard(discardCard)
    setBuyerOrder(order)
    setBuyerStep(0)

    if (order.length === 0) {
      // No eligible buyers
      if (state.roundState.goOutPlayerId !== null) {
        endRound(state)
      } else {
        const next = advancePlayer(state)
        setGameState(next)
        setUiPhase('privacy')
      }
    } else {
      setUiPhase('buying')
    }
  }

  // ── Score and end round ────────────────────────────────────────────────────
  function endRound(state: GameState) {
    const goOutId = state.roundState.goOutPlayerId
    if (!goOutId) return
    const results = scoreRound(state.players, goOutId)
    const players = state.players.map(p => {
      const result = results.find(r => r.playerId === p.id)
      return result ? { ...p, roundScores: [...p.roundScores, result.score] } : p
    })
    setGameState({ ...state, players })
    setRoundResults(results)
    setUiPhase('round-end')
  }

  // ── Meld confirmation ─────────────────────────────────────────────────────
  function handleMeldConfirm(meldGroups: CardType[][]) {
    const prev = gameState
    let counter = prev.roundState.meldIdCounter
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]

    const meldedIds = new Set(meldGroups.flatMap(g => g.map(c => c.id)))
    const newMelds: Meld[] = meldGroups.map(cards => {
      const type = isValidSet(cards) ? 'set' : 'run'
      const meldId = `meld-${counter++}`
      return buildMeld(cards, type, player.id, player.name, meldId)
    })

    const tablesMelds = [...prev.roundState.tablesMelds, ...newMelds]
    const newHand = player.hand.filter(c => !meldedIds.has(c.id))
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : prev.roundState.goOutPlayerId

    const players = prev.players.map((p, i) =>
      i === playerIdx
        ? { ...p, hand: newHand, hasLaidDown: true, melds: [...p.melds, ...newMelds] }
        : p
    )

    const updated: GameState = {
      ...prev,
      players,
      roundState: { ...prev.roundState, tablesMelds, meldIdCounter: counter, goOutPlayerId },
    }

    setGameState(updated)
    setShowMeldModal(false)

    if (wentOut) {
      const top = updated.roundState.discardPile[updated.roundState.discardPile.length - 1] ?? null
      startBuyingWindow(updated, playerIdx, top)
    }
  }

  // ── Lay off ───────────────────────────────────────────────────────────────
  function handleLayOff(card: CardType, meld: Meld) {
    const prev = gameState
    const playerIdx = prev.roundState.currentPlayerIndex
    const player = prev.players[playerIdx]
    const newHand = player.hand.filter(c => c.id !== card.id)

    let updatedRunMin = meld.runMin
    let updatedRunMax = meld.runMax
    if (meld.type === 'run') {
      if (card.suit === 'joker') {
        updatedRunMax = (meld.runMax ?? 0) + 1
      } else {
        let r = card.rank
        if (meld.runAceHigh && card.rank === 1) r = 14
        if (r < (meld.runMin ?? 999)) updatedRunMin = r
        if (r > (meld.runMax ?? 0)) updatedRunMax = r
      }
    }

    const updatedMeld: Meld = { ...meld, cards: [...meld.cards, card], runMin: updatedRunMin, runMax: updatedRunMax }
    const tablesMelds = prev.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : prev.roundState.goOutPlayerId
    const players = prev.players.map((p, i) => i === playerIdx ? { ...p, hand: newHand } : p)

    const updated: GameState = { ...prev, players, roundState: { ...prev.roundState, tablesMelds, goOutPlayerId } }
    setGameState(updated)
    setShowLayOffModal(false)

    if (wentOut) {
      const top = updated.roundState.discardPile[updated.roundState.discardPile.length - 1] ?? null
      startBuyingWindow(updated, playerIdx, top)
    }
  }

  // ── Joker swap ────────────────────────────────────────────────────────────
  function handleJokerSwap(naturalCard: CardType, meld: Meld) {
    setGameState(prev => {
      const playerIdx = prev.roundState.currentPlayerIndex
      const player = prev.players[playerIdx]
      const joker = findSwappableJoker(naturalCard, meld)
      if (!joker) return prev

      const newMeldCards = meld.cards.map(c => c.id === joker.id ? naturalCard : c)
      const newJokerMappings = meld.jokerMappings.filter(m => m.cardId !== joker.id)
      const updatedMeld: Meld = { ...meld, cards: newMeldCards, jokerMappings: newJokerMappings }

      const tablesMelds = prev.roundState.tablesMelds.map(m => m.id === meld.id ? updatedMeld : m)

      // Remove natural from hand, add joker back
      const newHand = player.hand.filter(c => c.id !== naturalCard.id).concat(joker)
      const players = prev.players.map((p, i) =>
        i === playerIdx ? { ...p, hand: newHand } : p
      )

      return { ...prev, players, roundState: { ...prev.roundState, tablesMelds } }
    })
    setShowLayOffModal(false)
  }

  // ── Discard ───────────────────────────────────────────────────────────────
  function handleDiscard() {
    if (selectedCardIds.size !== 1) return
    const cardId = [...selectedCardIds][0]

    // Build next state synchronously
    const playerIdx = rs.currentPlayerIndex
    const player = gameState.players[playerIdx]
    const card = player.hand.find(c => c.id === cardId)
    if (!card) return

    const newHand = player.hand.filter(c => c.id !== cardId)
    const discardPile = [...rs.discardPile, card]
    const wentOut = newHand.length === 0
    const goOutPlayerId = wentOut ? player.id : rs.goOutPlayerId

    const players = gameState.players.map((p, i) =>
      i === playerIdx ? { ...p, hand: newHand } : p
    )

    const afterDiscard: GameState = {
      ...gameState,
      players,
      roundState: { ...rs, discardPile, goOutPlayerId },
    }

    setGameState(afterDiscard)
    setSelectedCardIds(new Set())
    startBuyingWindow(afterDiscard, playerIdx, card)
  }

  // ── Buy decision ──────────────────────────────────────────────────────────
  function handleBuyDecision(wantsToBuy: boolean) {
    if (wantsToBuy) {
      const buyerIdx = buyerOrder[buyerStep]
      const buyer = gameState.players[buyerIdx]
      if (!buyingDiscard || buyer.buysRemaining <= 0) return

      const drawPile = [...gameState.roundState.drawPile]
      const penaltyCard = drawPile.shift()
      const newHand = [...buyer.hand, buyingDiscard, ...(penaltyCard ? [penaltyCard] : [])]
      const discardPile = gameState.roundState.discardPile.slice(0, -1)
      const players = gameState.players.map((p, i) =>
        i === buyerIdx ? { ...p, hand: newHand, buysRemaining: p.buysRemaining - 1 } : p
      )

      const withBuy: GameState = {
        ...gameState,
        players,
        roundState: { ...gameState.roundState, drawPile, discardPile },
      }
      const advanced = advancePlayer(withBuy)

      if (withBuy.roundState.goOutPlayerId !== null) {
        endRound(advanced)
      } else {
        setGameState(advanced)
        setUiPhase('privacy')
      }
    } else {
      // Pass — move to next buyer in queue
      const nextStep = buyerStep + 1
      if (nextStep < buyerOrder.length) {
        setBuyerStep(nextStep)
      } else {
        // All passed — advance turn
        const advanced = advancePlayer(gameState)
        if (gameState.roundState.goOutPlayerId !== null) {
          endRound(advanced)
        } else {
          setGameState(advanced)
          setUiPhase('privacy')
        }
      }
    }
  }

  // ── Next round / game over ────────────────────────────────────────────────
  function handleNextRound() {
    const nextRound = gameState.currentRound + 1
    if (nextRound > TOTAL_ROUNDS) {
      setGameState(prev => ({ ...prev, gameOver: true }))
      setUiPhase('game-over')
    } else {
      setGameState(prev => setupRound(prev, nextRound))
      setRoundResults(null)
      setUiPhase('round-start')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (uiPhase === 'round-start') {
    return (
      <div className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          <div className="w-16 h-16 rounded-full bg-[#e2b858] flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-[#2c1810]">{gameState.currentRound}</span>
          </div>
          <h2 className="text-2xl font-bold text-[#2c1810] mb-2">Round {gameState.currentRound}</h2>
          <p className="text-base text-[#8b7355] mb-2">{rs.requirement.description}</p>
          <p className="text-sm text-[#a08c6e] mb-8">{rs.cardsDealt} cards dealt</p>
          <button onClick={() => setUiPhase('privacy')} className="btn-primary">
            Begin Round
          </button>
        </div>
      </div>
    )
  }

  if (uiPhase === 'privacy') {
    return (
      <PrivacyScreen
        playerName={currentPlayer.name}
        onReady={() => setUiPhase('draw')}
      />
    )
  }

  if (uiPhase === 'buying') {
    const buyerIdx = buyerOrder[buyerStep]
    const buyer = buyerIdx !== undefined ? gameState.players[buyerIdx] : null
    const discardForBuy = buyingDiscard ?? topDiscard

    if (!buyer || !discardForBuy) {
      return null
    }

    return (
      <BuyPrompt
        buyerName={buyer.name}
        discardCard={discardForBuy}
        buysRemaining={buyer.buysRemaining}
        onDecision={handleBuyDecision}
      />
    )
  }

  if (uiPhase === 'round-end' && roundResults) {
    return (
      <RoundSummary
        players={gameState.players}
        roundResults={roundResults}
        roundNum={gameState.currentRound}
        onNext={handleNextRound}
        isLastRound={gameState.currentRound === TOTAL_ROUNDS}
      />
    )
  }

  if (uiPhase === 'game-over') {
    return (
      <GameOver
        players={gameState.players}
        onPlayAgain={() => {
          setGameState(initGame(initialPlayerNames))
          setUiPhase('round-start')
          setRoundResults(null)
          setSelectedCardIds(new Set())
        }}
        onBack={onExit}
      />
    )
  }

  // ── Main board: draw / action / discard phases ────────────────────────────
  return (
    <div className="min-h-screen bg-[#f8f6f1] flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-[#e2ddd2] px-4 py-2 flex items-center justify-between">
        <div>
          <p className="text-xs text-[#a08c6e]">Round {gameState.currentRound} of {TOTAL_ROUNDS}</p>
          <p className="text-sm font-bold text-[#2c1810]">{currentPlayer.name}'s turn</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8b7355] bg-[#efe9dd] px-2 py-1 rounded-full">
            {currentPlayer.buysRemaining} buys left
          </span>
          <button
            onClick={onExit}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#a08c6e] active:bg-[#efe9dd]"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 pb-36">
        {/* Round requirement pill */}
        <div className="bg-[#efe9dd] rounded-lg px-3 py-2 text-xs text-[#8b7355]">
          <span className="font-semibold text-[#8b6914]">Goal: </span>
          {rs.requirement.description}
        </div>

        {/* Table melds */}
        <TableMelds melds={rs.tablesMelds} />

        {/* Draw / discard pile area */}
        <div>
          <p className="text-xs font-semibold text-[#a08c6e] uppercase tracking-wider mb-2">
            {uiPhase === 'draw' ? 'Draw a card' : 'Discard Pile'}
          </p>
          <div className="flex gap-4 items-end">
            {/* Draw pile face-down card */}
            {uiPhase === 'draw' && (
              <div className="flex flex-col items-center gap-1">
                <div
                  onClick={handleDrawFromPile}
                  className="w-12 h-[4.5rem] rounded-lg bg-[#e2b858] border-2 border-[#8b6914] flex items-center justify-center cursor-pointer active:opacity-70 select-none"
                >
                  <span className="text-xl">🂠</span>
                </div>
                <p className="text-[10px] text-[#8b7355]">Draw pile</p>
                <p className="text-[10px] text-[#a08c6e]">{rs.drawPile.length} cards</p>
              </div>
            )}

            {/* Discard top */}
            {topDiscard && (
              <div className="flex flex-col items-center gap-1">
                <CardComponent
                  card={topDiscard}
                  onClick={uiPhase === 'draw' ? handleTakeDiscard : undefined}
                />
                <p className="text-[10px] text-[#8b7355]">
                  {uiPhase === 'draw' ? 'Take discard' : 'Last discard'}
                </p>
              </div>
            )}

            {uiPhase !== 'draw' && (
              <p className="text-xs text-[#a08c6e] self-center">
                Draw pile: {rs.drawPile.length} cards
              </p>
            )}
          </div>
        </div>

        {/* Player hand */}
        <HandDisplay
          cards={currentPlayer.hand}
          selectedIds={selectedCardIds}
          onToggle={toggleCard}
          label={`Your hand (${currentPlayer.hand.length} cards)`}
          disabled={uiPhase === 'draw'}
        />
      </div>

      {/* Fixed action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e2ddd2] px-4 pt-3 pb-8 safe-bottom">
        {uiPhase === 'draw' && (
          <p className="text-center text-sm text-[#8b7355] py-1">
            Tap the draw pile or discard card above to draw
          </p>
        )}

        {uiPhase === 'action' && (
          <div className="flex gap-2">
            {!currentPlayer.hasLaidDown && (
              <button
                onClick={() => setShowMeldModal(true)}
                className="btn-primary flex-1 text-sm py-2.5"
              >
                Lay Down Hand
              </button>
            )}
            {currentPlayer.hasLaidDown && rs.tablesMelds.length > 0 && (
              <button
                onClick={() => setShowLayOffModal(true)}
                className="btn-secondary flex-1 text-sm py-2.5"
              >
                Lay Off / Swap
              </button>
            )}
            <button
              onClick={() => { setUiPhase('discard'); setSelectedCardIds(new Set()) }}
              className="btn-secondary flex-1 text-sm py-2.5"
            >
              Discard
            </button>
          </div>
        )}

        {uiPhase === 'discard' && (
          <div className="space-y-2">
            <p className="text-xs text-[#8b7355] text-center">
              Select one card to discard
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setUiPhase('action'); setSelectedCardIds(new Set()) }}
                className="btn-secondary flex-1 text-sm py-2.5"
              >
                Back
              </button>
              <button
                onClick={handleDiscard}
                disabled={selectedCardIds.size !== 1}
                className="btn-primary flex-1 text-sm py-2.5"
              >
                Discard Card
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showMeldModal && (
        <MeldModal
          hand={currentPlayer.hand}
          requirement={rs.requirement}
          onConfirm={handleMeldConfirm}
          onClose={() => setShowMeldModal(false)}
        />
      )}

      {showLayOffModal && (
        <LayOffModal
          hand={currentPlayer.hand}
          tablesMelds={rs.tablesMelds}
          onLayOff={handleLayOff}
          onSwapJoker={handleJokerSwap}
          onClose={() => setShowLayOffModal(false)}
        />
      )}
    </div>
  )
}
