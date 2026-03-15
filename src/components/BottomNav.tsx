import { PlusCircle, Clock, BarChart2, Gamepad2 } from 'lucide-react'

type Tab = 'new' | 'history' | 'stats' | 'play'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
}

const tabs = [
  { id: 'new' as Tab, label: 'New Game', Icon: PlusCircle },
  { id: 'history' as Tab, label: 'History', Icon: Clock },
  { id: 'stats' as Tab, label: 'Stats', Icon: BarChart2 },
  { id: 'play' as Tab, label: 'Play', Icon: Gamepad2 },
]

export default function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e2ddd2] safe-bottom z-50"
      style={{ boxShadow: '0 -1px 4px rgba(0,0,0,0.06)' }}>
      <div className="max-w-[480px] mx-auto flex">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors
              ${active === id ? 'text-[#8b6914]' : 'text-[#a08c6e]'}`}
          >
            <Icon size={22} strokeWidth={active === id ? 2.5 : 1.5} />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
