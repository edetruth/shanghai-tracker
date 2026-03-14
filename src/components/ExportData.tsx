import { ArrowLeft, FileJson, FileText } from 'lucide-react'
import type { GameWithScores } from '../lib/types'
import { ROUNDS } from '../lib/constants'
import { format } from 'date-fns'

interface Props {
  games: GameWithScores[]
  onBack: () => void
}

export default function ExportData({ games, onBack }: Props) {
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(games, null, 2)], { type: 'application/json' })
    download(blob, 'shanghai-games.json')
  }

  const exportCSV = () => {
    const rows: string[][] = [
      ['Date', 'Player', ...ROUNDS.map((r) => `Round ${r.number} (${r.name})`), 'Total', 'Winner', 'Notes'],
    ]
    games.forEach((g) => {
      const sorted = [...g.game_scores].sort((a, b) => a.total_score - b.total_score)
      const winnerName = sorted[0]?.player?.name ?? ''
      let dateStr = g.date
      try { dateStr = format(new Date(g.date + 'T12:00:00'), 'M/d/yyyy') } catch { /* keep raw */ }

      g.game_scores.forEach((gs) => {
        rows.push([
          dateStr,
          gs.player?.name ?? '',
          ...ROUNDS.map((_, i) => String(gs.round_scores[i] ?? 0)),
          String(gs.total_score),
          winnerName,
          g.notes ?? '',
        ])
      })
    })

    const csv = rows
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    download(blob, 'shanghai-games.csv')
  }

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-3 pt-6">
        <button onClick={onBack} className="text-[#a08c6e]">
          <ArrowLeft size={24} />
        </button>
        <h2 className="font-display text-2xl font-semibold text-[#2c1810]">Export Data</h2>
      </div>

      <p className="text-[#8b7355] text-sm">{games.length} games available to export.</p>

      <div className="flex flex-col gap-3">
        <button
          onClick={exportJSON}
          className="card p-4 flex items-center gap-4 text-left active:opacity-80"
        >
          <div className="w-10 h-10 bg-[#efe9dd] rounded-lg flex items-center justify-center flex-shrink-0">
            <FileJson size={22} className="text-[#8b6914]" />
          </div>
          <div>
            <div className="text-[#2c1810] font-medium">Export as JSON</div>
            <div className="text-[#8b7355] text-sm">Full backup with all data</div>
          </div>
        </button>

        <button
          onClick={exportCSV}
          className="card p-4 flex items-center gap-4 text-left active:opacity-80"
        >
          <div className="w-10 h-10 bg-[#efe9dd] rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText size={22} className="text-[#1d7ea8]" />
          </div>
          <div>
            <div className="text-[#2c1810] font-medium">Export as CSV</div>
            <div className="text-[#8b7355] text-sm">Open in Excel or Google Sheets</div>
          </div>
        </button>
      </div>
    </div>
  )
}
