import { useState, useEffect } from 'react'
import type { TutorialStep } from '../../game/tutorial-script'

interface Props {
  step: TutorialStep | null
  onDismiss: () => void
  onSkip: () => void
}

export default function TutorialOverlay({ step, onDismiss, onSkip }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (step) {
      setVisible(true)
      if (step.autoAdvanceMs) {
        const timer = setTimeout(() => {
          setVisible(false)
          setTimeout(onDismiss, 300)
        }, step.autoAdvanceMs)
        return () => clearTimeout(timer)
      }
    } else {
      setVisible(false)
    }
  }, [step, onDismiss])

  if (!step) return null

  return (
    <>
      {/* Dim overlay -- tappable to dismiss non-required steps */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.5)',
          pointerEvents: step.requireAction ? 'none' : 'auto',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
        onClick={!step.requireAction ? () => { setVisible(false); setTimeout(onDismiss, 300) } : undefined}
      />

      {/* Hint card */}
      <div style={{
        position: 'fixed',
        bottom: 'max(120px, calc(env(safe-area-inset-bottom, 12px) + 110px))',
        left: 16, right: 16,
        zIndex: 201,
        background: 'linear-gradient(135deg, #0f2218, #1a3a2a)',
        border: '2px solid #e2b858',
        borderRadius: 16,
        padding: '16px 20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <h3 style={{ color: '#e2b858', fontSize: 15, fontWeight: 800, margin: 0 }}>
            {step.title}
          </h3>
          <button
            onClick={onSkip}
            style={{
              background: 'transparent', border: 'none', color: '#3a5a3a',
              fontSize: 11, cursor: 'pointer', padding: '2px 8px',
            }}
          >
            Skip Tutorial
          </button>
        </div>
        <p style={{ color: '#a8d0a8', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          {step.message}
        </p>
        {step.requireAction && (
          <p style={{ color: '#6aad7a', fontSize: 11, marginTop: 8, marginBottom: 0, fontWeight: 600 }}>
            {step.highlightZone === 'draw-pile' ? 'Tap the draw pile or discard to continue' :
             step.highlightZone === 'hand' ? 'Select a card and discard it' :
             step.highlightZone === 'lay-down-button' ? 'Tap "Lay Down" to continue' :
             step.highlightZone === 'discard-pile' ? 'Tap the discard or draw pile' :
             step.highlightZone === 'buy-button' ? 'Tap Buy or Pass' :
             'Take your action to continue'}
          </p>
        )}
        {!step.requireAction && !step.autoAdvanceMs && (
          <button
            onClick={() => { setVisible(false); setTimeout(onDismiss, 300) }}
            style={{
              marginTop: 12, background: '#e2b858', border: 'none', borderRadius: 10,
              padding: '10px 24px', color: '#2c1810', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Got it
          </button>
        )}
        {step.autoAdvanceMs && (
          <div style={{ marginTop: 8, height: 3, background: '#1e4a2e', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: '#e2b858', borderRadius: 2,
              animation: `tutorial-progress ${step.autoAdvanceMs}ms linear forwards`,
            }} />
          </div>
        )}
      </div>

      {/* Zone highlight pulse -- renders behind the overlay but the zone itself pokes through */}
      {step.highlightZone && (
        <style>{`
          [data-tutorial-zone="${step.highlightZone}"] {
            position: relative;
            z-index: 202 !important;
            animation: tutorial-pulse 1.5s ease-in-out infinite !important;
            box-shadow: 0 0 20px rgba(226,184,88,0.4) !important;
          }
          @keyframes tutorial-pulse {
            0%, 100% { box-shadow: 0 0 10px rgba(226,184,88,0.3); }
            50% { box-shadow: 0 0 25px rgba(226,184,88,0.6); }
          }
          @keyframes tutorial-progress {
            from { width: 100%; }
            to { width: 0%; }
          }
        `}</style>
      )}
    </>
  )
}

/** Check if the user has completed the interactive tutorial */
export function hasCompletedTutorial(): boolean {
  return localStorage.getItem('shanghai_tutorial_done') === 'true'
}

/** Mark the interactive tutorial as completed */
export function markTutorialComplete(): void {
  localStorage.setItem('shanghai_tutorial_done', 'true')
}
