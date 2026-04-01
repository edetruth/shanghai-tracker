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

  // Subscribe to game state changes to trigger tutorial steps
  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
      const prev = prevStateRef.current
      const uiPhase = state.uiPhase
      const player = state.gameState.players[0] // Human player is always index 0
      const hasLaidDown = player?.hasLaidDown ?? false
      const round = state.gameState.currentRound
      const gameOver = state.gameState.gameOver

      const currentIdx = stepIndexRef.current
      if (currentIdx >= TUTORIAL_STEPS.length) return
      const nextStep = TUTORIAL_STEPS[currentIdx]
      if (!nextStep) return

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
