import { useRegisterSW } from 'virtual:pwa-register/react'

export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      // Check for updates every 5 minutes
      if (registration) {
        setInterval(() => { registration.update() }, 5 * 60 * 1000)
      }
    },
  })

  if (!needRefresh) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 'max(16px, env(safe-area-inset-bottom))',
      left: 16, right: 16,
      zIndex: 100,
      display: 'flex',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        background: '#2c1810',
        border: '1px solid #e2b858',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        pointerEvents: 'auto',
        maxWidth: 360,
        width: '100%',
      }}>
        <span style={{ color: '#f8f6f1', fontSize: 13, flex: 1 }}>
          Update available
        </span>
        <button
          onClick={() => setNeedRefresh(false)}
          style={{
            background: 'none', border: 'none', color: '#8b7355',
            fontSize: 13, cursor: 'pointer', padding: '4px 8px',
          }}
        >
          Later
        </button>
        <button
          onClick={() => updateServiceWorker(true)}
          style={{
            background: '#e2b858', border: 'none', color: '#2c1810',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            padding: '6px 14px', borderRadius: 8,
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
