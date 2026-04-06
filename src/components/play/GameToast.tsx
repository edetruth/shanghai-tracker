export type ToastStyle = 'celebration' | 'pressure' | 'neutral' | 'drama' | 'taunt'

export interface QueuedToast {
  id: number
  message: string
  subtext?: string
  style: ToastStyle
  icon?: string
  duration: number
}

interface Props {
  toast: QueuedToast | null
}

const STYLE_CLASSES: Record<ToastStyle, string> = {
  celebration: 'bg-gradient-to-r from-[#e2b858] to-[#d4a843] text-warm-text',
  pressure: 'bg-[#b83232]/90 text-white',
  neutral: 'bg-[#1e4a2e] text-[#a8d0a8]',
  drama: 'bg-[#0f2218]/95 text-white border border-[#6aad7a]',
  taunt: 'bg-[#2d5a3c] text-[#e2b858]',
}

export default function GameToast({ toast }: Props) {
  if (!toast) return null
  return (
    <div
      className="fixed inset-x-0 z-50 flex justify-center pointer-events-none"
      style={{ top: '35%', animation: 'toast-enter 0.3s ease-out' }}
    >
      <div className={`px-6 py-3 rounded-2xl shadow-2xl ${STYLE_CLASSES[toast.style]} max-w-[80vw] text-center`}>
        {toast.icon && <span className="text-2xl block mb-1">{toast.icon}</span>}
        <p className="font-bold text-lg leading-tight">{toast.message}</p>
        {toast.subtext && <p className="text-sm opacity-80 mt-0.5">{toast.subtext}</p>}
      </div>
    </div>
  )
}
