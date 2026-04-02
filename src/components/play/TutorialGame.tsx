import { useState, useCallback, useRef, useEffect } from 'react'
import GameBoard from './GameBoard'
import TutorialOverlay, { markTutorialComplete } from './TutorialOverlay'
import { TUTORIAL_STEPS, type TutorialStep } from '../../game/tutorial-script'
import { useGameStore } from '../../stores/gameStore'
import type { PlayerConfig } from '../../game/types'

interface Props {
  onComplete: () => void
  onSkip: () => void
}

const TUTORIAL_PLAYERS: PlayerConfig[] = [
  { name: 'You', isAI: false },
  { name: 'Tutorial Bot', isAI: true },
]

export default function TutorialGame({ onComplete, onSkip }: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const [activeStep, setActiveStep] = useState<TutorialStep | null>(TUTORIAL_STEPS[0])
  const prevStateRef = useRef<{ uiPhase: string; hasLaidDown: boolean; round: number; gameOver: boolean }>({
    uiPhase: 'round-start', hasLaidDown: false, round: 1, gameOver: false,
  })
  const stepIndexRef = useRef(stepIndex)
  stepIndexRef.current = stepIndex

  // Ref to hold dismiss callback — assigned after handleDismiss is defined below
  const dismissRef = useRef<(() => void) | null>(null)

  // Subscribe to game state changes to trigger tutorial steps
  // Two jobs: (1) auto-dismiss the current requireAction step when the
  // player completes the action, (2) trigger the next step.
  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
      const prev = prevStateRef.current
      const uiPhase = state.uiPhase
      const player = state.gameState.players[0] // Human player is always index 0
      const hasLaidDown = player?.hasLaidDown ?? false
      const round = state.gameState.currentRound
      const gameOver = state.gameState.gameOver
      const phaseChanged = uiPhase !== prev.uiPhase

      const currentIdx = stepIndexRef.current
      if (currentIdx >= TUTORIAL_STEPS.length) {
        prevStateRef.current = { uiPhase, hasLaidDown, round, gameOver }
        return
      }

      const currentStep = TUTORIAL_STEPS[currentIdx]

      // ── Auto-dismiss requireAction steps when the action is done ──
      // If the current step is interactive and the phase just changed,
      // the player took their action — advance to the next step.
      if (currentStep?.requireAction && phaseChanged) {
        let actionDone = false
        switch (currentStep.trigger) {
          case 'draw-phase':
            // Player was in draw phase, now moved to action (drew a card)
            // or to buy-window or round-end
            actionDone = uiPhase !== 'draw'
            break
          case 'after-draw':
            // Player was in action phase, now moved to draw (discarded)
            // or round-end, or back to draw via opponent turn
            actionDone = uiPhase !== 'action' || prev.uiPhase === 'draw'
            break
          case 'has-melds':
            // Player laid down
            actionDone = hasLaidDown
            break
          case 'after-meld':
            // Player discarded after melding
            actionDone = uiPhase === 'draw' || uiPhase === 'round-end'
            break
          case 'buy-opportunity':
            // Buy window closed
            actionDone = state.buyingPhase === 'hidden'
            break
          default:
            // Generic: any phase change means the action was taken
            actionDone = true
        }

        if (actionDone) {
          prevStateRef.current = { uiPhase, hasLaidDown, round, gameOver }
          dismissRef.current?.()
          return
        }
      }

      // ── Trigger the next step ──
      const nextStep = TUTORIAL_STEPS[currentIdx]
      if (!nextStep) {
        prevStateRef.current = { uiPhase, hasLaidDown, round, gameOver }
        return
      }

      let shouldTrigger = false

      switch (nextStep.trigger) {
        case 'draw-phase':
          shouldTrigger = uiPhase === 'draw' && prev.uiPhase !== 'draw'
          break
        case 'after-draw':
          shouldTrigger = uiPhase === 'action' && prev.uiPhase === 'draw'
          break
        case 'action-phase':
          shouldTrigger = uiPhase === 'action'
          break
        case 'has-melds':
          shouldTrigger = uiPhase === 'action' && !hasLaidDown && player && player.hand.length >= 6
          break
        case 'after-meld':
          shouldTrigger = hasLaidDown && !prev.hasLaidDown
          break
        case 'after-discard':
          shouldTrigger = uiPhase === 'draw' && prev.uiPhase === 'action'
          break
        case 'round-end':
          shouldTrigger = uiPhase === 'round-end' && prev.uiPhase !== 'round-end'
          break
        case 'round-start':
          shouldTrigger = uiPhase === 'round-start' && round > prev.round
          break
        case 'buy-opportunity':
          shouldTrigger = state.buyingPhase !== 'hidden'
          break
        case 'game-end':
          shouldTrigger = gameOver && !prev.gameOver
          break
      }

      if (shouldTrigger) {
        setActiveStep(nextStep)
      }

      prevStateRef.current = { uiPhase, hasLaidDown, round, gameOver }
    })
    return unsub
  }, [])

  const handleDismiss = useCallback(() => {
    const nextIdx = stepIndexRef.current + 1
    setStepIndex(nextIdx)
    stepIndexRef.current = nextIdx
    if (nextIdx >= TUTORIAL_STEPS.length) {
      markTutorialComplete()
      onComplete()
    } else {
      const next = TUTORIAL_STEPS[nextIdx]
      // If next step triggers immediately, show it
      if (next.trigger === 'immediate') {
        setActiveStep(next)
      } else {
        setActiveStep(null) // Wait for trigger
      }
    }
  }, [onComplete])
  dismissRef.current = handleDismiss

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
        onDismiss={handleDismiss}
        onSkip={handleSkip}
      />
    </div>
  )
}
