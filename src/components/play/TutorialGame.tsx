import { useState, useCallback, useRef, useEffect } from 'react'
import GameBoard from './GameBoard'
import TutorialOverlay, { markTutorialComplete } from './TutorialOverlay'
import {
  type TutorialStep,
  WELCOME, ROUND_GOAL, TUTORIAL_COMPLETE,
  HINT_DRAW, HINT_DRAW_TAKE_DISCARD, HINT_DISCARD, HINT_LAY_DOWN, HINT_CLEAR_HAND, HINT_BUY,
} from '../../game/tutorial-script'
import { useGameStore } from '../../stores/gameStore'
import { aiFindBestMelds } from '../../game/ai'
import { ROUND_REQUIREMENTS } from '../../game/rules'
import type { PlayerConfig } from '../../game/types'

interface Props {
  onComplete: () => void
  onSkip: () => void
}

const TUTORIAL_PLAYERS: PlayerConfig[] = [
  { name: 'You', isAI: false },
  { name: 'Tutorial Bot', isAI: true },
]

/**
 * State-driven tutorial — evaluates the game state and shows the right
 * hint for what the player should do next. No fixed step index.
 *
 * Milestones (shown once): welcome, round goal, round complete, round 2, game end
 * Action hints (contextual): draw, discard, lay down, clear hand, buy
 */
export default function TutorialGame({ onComplete, onSkip }: Props) {
  const [activeStep, setActiveStep] = useState<TutorialStep | null>(WELCOME)

  // Track which one-time milestones have been shown
  const shownRef = useRef(new Set<string>(['welcome']))
  // Track previous state for edge detection
  const prevRef = useRef({ uiPhase: 'round-start', hasLaidDown: false, round: 1, gameOver: false, buyingPhase: 'hidden' })
  // Track how many draw phases the player has seen (for progressive hints)
  const drawCountRef = useRef(0)
  // Prevent re-entrancy during dismiss
  const dismissingRef = useRef(false)

  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
      if (dismissingRef.current) return

      const prev = prevRef.current
      const uiPhase = state.uiPhase
      const player = state.gameState.players[0]
      if (!player) return
      const hasLaidDown = player.hasLaidDown ?? false
      const round = state.gameState.currentRound
      const gameOver = state.gameState.gameOver
      const buyingPhase = state.buyingPhase as string

      // Helper: show a step if not already showing the same one
      const show = (step: TutorialStep) => {
        setActiveStep(current => current?.id === step.id ? current : step)
      }

      // Helper: show a milestone once
      const showOnce = (step: TutorialStep) => {
        if (!shownRef.current.has(step.id)) {
          shownRef.current.add(step.id)
          show(step)
        }
      }

      // ── Game end ──
      if (gameOver && !prev.gameOver) {
        showOnce(TUTORIAL_COMPLETE)
        prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
        return
      }

      // ── Round 1 complete = tutorial done ──
      // One round teaches the full loop: draw → discard → meld → clear → score.
      // No need to drag through 7 rounds.
      if (uiPhase === 'round-end' && prev.uiPhase !== 'round-end') {
        showOnce(TUTORIAL_COMPLETE)
        prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
        return
      }

      // ── Buy window ──
      if (buyingPhase !== 'hidden' && prev.buyingPhase === 'hidden') {
        showOnce(HINT_BUY)
        prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
        return
      }

      // ── Draw phase — player needs to draw ──
      if (uiPhase === 'draw' && prev.uiPhase !== 'draw') {
        drawCountRef.current++
        const count = drawCountRef.current

        if (count === 1) {
          // First draw: basic instruction
          show(HINT_DRAW)
        } else if (count === 2) {
          // Second draw: hint about the discard pile
          show(HINT_DRAW_TAKE_DISCARD)
        } else {
          // After that: no more draw hints, they know the loop
          setActiveStep(null)
        }
        prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
        return
      }

      // ── Action phase — player drew, now what? ──
      if (uiPhase === 'action' && prev.uiPhase === 'draw') {
        // Check if player can lay down melds
        const requirement = ROUND_REQUIREMENTS[round - 1]
        const canMeld = !hasLaidDown && requirement && !!aiFindBestMelds(player.hand, requirement)

        if (canMeld) {
          show(HINT_LAY_DOWN)
        } else if (hasLaidDown) {
          show(HINT_CLEAR_HAND)
        } else {
          // First couple of times: show discard hint. After that: silence.
          if (drawCountRef.current <= 2) {
            show(HINT_DISCARD)
          } else {
            setActiveStep(null)
          }
        }
        prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
        return
      }

      // ── Just laid down melds — guide to clear hand ──
      if (hasLaidDown && !prev.hasLaidDown) {
        show(HINT_CLEAR_HAND)
        prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
        return
      }

      prevRef.current = { uiPhase, hasLaidDown, round, gameOver, buyingPhase }
    })
    return unsub
  }, [])

  const handleDismiss = useCallback(() => {
    dismissingRef.current = true
    setActiveStep(null)
    // Allow subscription to fire again after a tick
    setTimeout(() => { dismissingRef.current = false }, 50)
  }, [])

  const handleAutoComplete = useCallback(() => {
    // Called when auto-advance steps finish.
    // Chain: welcome → round goal → wait for game state.
    // Game end → complete tutorial.
    setActiveStep(current => {
      if (current?.id === 'welcome') {
        shownRef.current.add('round-goal')
        return ROUND_GOAL
      }
      if (current?.id === 'game-end') {
        markTutorialComplete()
        setTimeout(() => onComplete(), 100)
      }
      return null
    })
  }, [onComplete])

  const handleSkip = useCallback(() => {
    markTutorialComplete()
    onSkip()
  }, [onSkip])

  return (
    <div style={{ position: 'relative' }}>
      <GameBoard
        initialPlayers={TUTORIAL_PLAYERS}
        aiPersonality="rookie-riley"
        buyLimit={5}
        onExit={handleSkip}
      />
      <TutorialOverlay
        step={activeStep}
        onDismiss={activeStep?.autoAdvanceMs ? handleAutoComplete : handleDismiss}
        onSkip={handleSkip}
      />
    </div>
  )
}
