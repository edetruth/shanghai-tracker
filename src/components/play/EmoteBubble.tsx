import { useEffect, useState } from 'react'

interface Props {
  emoji: string
  onDone: () => void
}

export default function EmoteBubble({ emoji, onDone }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onDone, 300) // wait for fade out
    }, 2500)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <div style={{
      position: 'absolute',
      top: -32,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#0f2218',
      border: '1px solid #2d5a3a',
      borderRadius: 12,
      padding: '4px 8px',
      fontSize: 22,
      zIndex: 20,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.3s ease',
      pointerEvents: 'none' as const,
      animation: 'toast-enter 0.3s ease-out',
    }}>
      {emoji}
    </div>
  )
}
