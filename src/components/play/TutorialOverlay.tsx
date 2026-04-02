import { useState, useEffect } from 'react'
import type { TutorialStep } from '../../game/tutorial-script'

interface Props {
  step: TutorialStep | null
  onDismiss: () => void
  onSkip: () => void
}

// Interactive steps always show at top so they never cover the hand or action area.
// Auto-advance info steps (no player action needed) show at bottom.

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

  // Interactive steps → top (never cover hand/piles/buttons)
  // Auto-advance info → bottom (out of the way)
  const hintAtTop = !!step.requireAction

  const positionStyle: React.CSSProperties = hintAtTop
    ? { top: 'max(52px, env(safe-area-inset-top, 8px))', bottom: 'auto' }
    : { bottom: 'max(120px, calc(env(safe-area-inset-bottom, 12px) + 110px))', top: 'auto' }

  const slideDir = hintAtTop ? -20 : 20

  return (
    <>
      {/* Dim overlay -- tappable to dismiss non-required steps */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.45)',
          pointerEvents: step.requireAction ? 'none' : 'auto',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
        onClick={!step.requireAction ? () => { setVisible(false); setTimeout(onDismiss, 300) } : undefined}
      />

      {/* Hint card — compact, dynamically positioned */}
      <div style={{
        position: 'fixed',
        ...positionStyle,
        left: 16, right: 16,
        zIndex: 201,
        background: 'linear-gradient(135deg, #0f2218ee, #1a3a2aee)',
        border: '1.5px solid #e2b858',
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : `translateY(${slideDir}px)`,
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={{ color: '#e2b858', fontSize: 14, fontWeight: 800, margin: 0 }}>
            {step.title}
          </h3>
          <button
            onClick={onSkip}
            style={{
              background: 'transparent', border: 'none', color: '#3a5a3a',
              fontSize: 10, cursor: 'pointer', padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Skip Tutorial
          </button>
        </div>
        <p style={{ color: '#a8d0a8', fontSize: 12, lineHeight: 1.4, margin: '4px 0 0' }}>
          {step.message}
        </p>
        {!step.requireAction && !step.autoAdvanceMs && (
          <button
            onClick={() => { setVisible(false); setTimeout(onDismiss, 300) }}
            style={{
              marginTop: 8, background: '#e2b858', border: 'none', borderRadius: 8,
              padding: '8px 20px', color: '#2c1810', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Got it
          </button>
        )}
        {step.autoAdvanceMs && (
          <div style={{ marginTop: 6, height: 2, background: '#1e4a2e', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: '#e2b858', borderRadius: 2,
              animation: `tutorial-progress ${step.autoAdvanceMs}ms linear forwards`,
            }} />
          </div>
        )}
      </div>

      {/* Zone highlight pulse -- the zone pokes through the dim overlay */}
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
