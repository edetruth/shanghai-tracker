import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Download, Upload, RefreshCw, ChevronDown } from 'lucide-react'
import { getCompletedGames, deleteGame } from '../lib/gameStore'
import type { GameWithScores } from '../lib/types'
import GameCard from './GameCard'
import ExportData from './ExportData'
import ImportData from './ImportData'

type SortOption = 'newest' | 'oldest' | 'playercount'
type FilterOption = 'all' | 'thisyear' | 'month' | 'year'

interface Props {
  onNavigateHome: () => void
  onStartNewGame: () => void
  onPlayerClick?: (playerId: string) => void
}

export default function ScoreTrackerPage({ onNavigateHome, onStartNewGame, onPlayerClick }: Props) {
  const [games, setGames] = useState<GameWithScores[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'export' | 'import'>('list')
  const [sort, setSort] = useState<SortOption>('newest')
  const [filter, setFilter] = useState<FilterOption>('all')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedYear, setSelectedYear] = useState('')
  const [showFilterMenu, setShowFilterMenu] = useState(false)

  const loadGames = async () => {
    setLoading(true)
    try {
      const data = await getCompletedGames()
      setGames(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGames() }, [])

  const handleDelete = async (id: string) => {
    await deleteGame(id)
    setGames((prev) => prev.filter((g) => g.id !== id))
  }

  if (view === 'export') {
    return <ExportData games={games} onBack={() => setView('list')} />
  }
  if (view === 'import') {
    return <ImportData onBack={() => { setView('list'); loadGames() }} />
  }

  // Compute available months and years from games
  const gameDates = games.map((g) => g.date).sort().reverse()
  const availableMonths = Array.from(new Set(gameDates.map((d) => d.slice(0, 7)))).map((ym) => {
    const [y, m] = ym.split('-')
    const date = new Date(parseInt(y), parseInt(m) - 1, 1)
    return { value: ym, label: date.toLocaleString('default', { month: 'long', year: 'numeric' }) }
  })
  const availableYears = Array.from(new Set(gameDates.map((d) => d.slice(0, 4)))).sort().reverse()

  // Filter
  const now = new Date()
  const thisYear = now.getFullYear().toString()
  let filtered = games.filter((g) => {
    if (filter === 'thisyear') return g.date.startsWith(thisYear)
    if (filter === 'month') return selectedMonth ? g.date.startsWith(selectedMonth) : true
    if (filter === 'year') return selectedYear ? g.date.startsWith(selectedYear) : true
    return true
  })

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (sort === 'newest') return b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
    if (sort === 'oldest') return a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)
    if (sort === 'playercount') return b.game_scores.length - a.game_scores.length
    return 0
  })

  const filterLabel = filter === 'all' ? 'All Time'
    : filter === 'thisyear' ? thisYear
    : filter === 'month' ? (availableMonths.find((m) => m.value === selectedMonth)?.label ?? 'By Month')
    : filter === 'year' ? (selectedYear || 'By Year')
    : 'All Time'

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 safe-top">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onNavigateHome} className="text-[#8b6914] p-1 -ml-1">
            <ArrowLeft size={22} />
          </button>
          <h2 className="font-display text-2xl font-semibold text-[#2c1810]">Score Tracker</h2>
          <button onClick={loadGames} className="ml-auto text-[#a08c6e] p-1">
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="text-[#a08c6e] text-sm ml-8">{games.length} game{games.length !== 1 ? 's' : ''} recorded</p>

        {/* Enter New Scores button */}
        <button
          onClick={onStartNewGame}
          className="btn-primary mt-4 flex items-center justify-center gap-2"
        >
          <Plus size={18} />
          Enter New Scores
        </button>

        {/* Sort + Filter row */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {/* Sort */}
          <div className="flex gap-1 bg-[#efe9dd] rounded-xl p-1">
            {([['newest', 'Newest'], ['oldest', 'Oldest'], ['playercount', 'Players']] as [SortOption, string][]).map(([val, label]) => (
              <button key={val} onClick={() => setSort(val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                  ${sort === val ? 'bg-white text-[#8b6914] shadow-sm' : 'text-[#8b7355]'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Filter dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu((v) => !v)}
              className="flex items-center gap-1 px-3 py-1.5 bg-[#efe9dd] rounded-xl text-xs font-medium text-[#8b7355]"
            >
              {filterLabel}
              <ChevronDown size={14} />
            </button>
            {showFilterMenu && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[#e2ddd2] rounded-xl overflow-hidden min-w-[160px]"
                style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                <button onClick={() => { setFilter('all'); setShowFilterMenu(false) }}
                  className={`w-full text-left px-4 py-2 text-sm ${filter === 'all' ? 'text-[#8b6914] font-medium' : 'text-[#2c1810]'} hover:bg-[#efe9dd]`}>
                  All Time
                </button>
                <button onClick={() => { setFilter('thisyear'); setShowFilterMenu(false) }}
                  className={`w-full text-left px-4 py-2 text-sm ${filter === 'thisyear' ? 'text-[#8b6914] font-medium' : 'text-[#2c1810]'} hover:bg-[#efe9dd]`}>
                  This Year ({thisYear})
                </button>
                {availableMonths.length > 0 && (
                  <div className="border-t border-[#e2ddd2]">
                    <div className="px-4 py-1.5 text-[#a08c6e] text-xs uppercase tracking-wider">By Month</div>
                    {availableMonths.map((m) => (
                      <button key={m.value}
                        onClick={() => { setFilter('month'); setSelectedMonth(m.value); setShowFilterMenu(false) }}
                        className={`w-full text-left px-4 py-2 text-sm ${filter === 'month' && selectedMonth === m.value ? 'text-[#8b6914] font-medium' : 'text-[#2c1810]'} hover:bg-[#efe9dd]`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
                {availableYears.length > 1 && (
                  <div className="border-t border-[#e2ddd2]">
                    <div className="px-4 py-1.5 text-[#a08c6e] text-xs uppercase tracking-wider">By Year</div>
                    {availableYears.map((y) => (
                      <button key={y}
                        onClick={() => { setFilter('year'); setSelectedYear(y); setShowFilterMenu(false) }}
                        className={`w-full text-left px-4 py-2 text-sm ${filter === 'year' && selectedYear === y ? 'text-[#8b6914] font-medium' : 'text-[#2c1810]'} hover:bg-[#efe9dd]`}>
                        {y}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Import/Export */}
        <div className="flex gap-2 mt-3">
          <button onClick={() => setView('import')}
            className="flex-1 flex items-center justify-center gap-2 bg-[#efe9dd] text-[#8b6914]
                       rounded-xl py-2 text-xs font-medium">
            <Upload size={14} /> Import
          </button>
          <button onClick={() => setView('export')}
            className="flex-1 flex items-center justify-center gap-2 bg-[#efe9dd] text-[#a08c6e]
                       rounded-xl py-2 text-xs font-medium">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Game list */}
      <div className="flex-1 px-4 pb-8 flex flex-col gap-3 overflow-auto">
        {loading ? (
          <div className="text-center text-[#a08c6e] py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🃏</div>
            <div className="text-[#a08c6e]">{games.length === 0 ? 'No games yet' : 'No games in this period'}</div>
            <div className="text-[#a08c6e] text-sm mt-1">
              {games.length === 0 ? 'Tap "Enter New Scores" to record a game' : 'Try a different filter'}
            </div>
          </div>
        ) : (
          filtered.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onDelete={handleDelete}
              onEdit={loadGames}
              onPlayerClick={onPlayerClick}
            />
          ))
        )}
      </div>
    </div>
  )
}
