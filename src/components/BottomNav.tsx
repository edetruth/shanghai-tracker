import { PlusCircle, Clock, BarChart2 } from 'lucide-react'

type Tab = 'new' | 'history' | 'stats'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
}

const tabs = [
  { id: 'new' as Tab, label: 'New Game', Icon: PlusCircle },
  { id: 'history' as Tab, label: 'History', Icon: Clock },
  { id: 'stats' as Tab, label: 'Stats', Icon: BarChart2 },
]

export default function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#0f1929] border-t border-[#1a2640] safe-bottom z-50">
      <div className="max-w-[480px] mx-auto flex">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors
              ${active === id ? 'text-[#e2b858]' : 'text-[#5e7190]'}`}
          >
            <Icon size={22} strokeWidth={active === id ? 2.5 : 1.5} />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
