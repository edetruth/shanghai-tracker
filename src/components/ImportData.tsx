import { useState, useRef } from 'react'
import { ArrowLeft, Upload, FileSpreadsheet, Download, Check, AlertCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import { importGame } from '../lib/gameStore'
import { IMPORT_HEADERS } from '../lib/constants'
import { format, parse, isValid } from 'date-fns'

interface Props {
  onBack: () => void
}

interface ParsedGame {
  date: string
  notes: string
  players: Array<{ name: string; roundScores: number[] }>
}

interface PreviewGame extends ParsedGame {
  totals: number[]
}

function parseDate(raw: string | number | undefined): string | null {
  if (!raw && raw !== 0) return null
  // Excel serial number
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) {
      const dt = new Date(d.y, d.m - 1, d.d)
      return format(dt, 'yyyy-MM-dd')
    }
  }
  const s = String(raw).trim()
  if (!s) return null
  // Try various formats
  const formats = ['M/d/yyyy', 'MM/dd/yyyy', 'M/d/yy', 'yyyy-MM-dd', 'MM/dd/yy']
  for (const fmt of formats) {
    try {
      const d = parse(s, fmt, new Date())
      if (isValid(d)) return format(d, 'yyyy-MM-dd')
    } catch { /* try next */ }
  }
  // Last resort: JS Date
  const d = new Date(s)
  if (isValid(d)) return format(d, 'yyyy-MM-dd')
  return null
}

function parseRows(rows: Record<string, unknown>[]): ParsedGame[] {
  // Group rows by date + notes
  const gameMap = new Map<string, ParsedGame>()

  rows.forEach((row) => {
    const dateRaw = row['Date'] ?? row['date']
    const dateStr = parseDate(dateRaw as string | number | undefined)
    if (!dateStr) return

    const playerName = String(row['Player'] ?? row['player'] ?? '').trim()
    if (!playerName) return

    const notes = String(row['Notes'] ?? row['notes'] ?? '').trim()
    const key = `${dateStr}|||${notes}`

    if (!gameMap.has(key)) {
      gameMap.set(key, { date: dateStr, notes, players: [] })
    }

    const roundScores = [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const keys = Object.keys(row).filter((k) => k.includes(`Round ${n}`) || k === `Round ${n}`)
      const val = keys.length ? row[keys[0]] : undefined
      return parseInt(String(val ?? 0)) || 0
    })

    gameMap.get(key)!.players.push({ name: playerName, roundScores })
  })

  return Array.from(gameMap.values())
}

export default function ImportData({ onBack }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewGame[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ games: number; entries: number } | null>(null)
  const [error, setError] = useState('')

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setPreview(null)
    setResult(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target!.result, { type: 'array', cellDates: false })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        const parsed = parseRows(rows)
        if (!parsed.length) {
          setError('No valid game rows found. Check that your file has Date and Player columns.')
          return
        }
        setPreview(
          parsed.map((g) => ({
            ...g,
            totals: g.players.map((p) => p.roundScores.reduce((a, b) => a + b, 0)),
          }))
        )
      } catch (err) {
        setError('Failed to parse file. Make sure it is a valid Excel or CSV file.')
      }
    }
    reader.readAsArrayBuffer(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const doImport = async () => {
    if (!preview) return
    setImporting(true)
    setError('')
    let totalEntries = 0
    try {
      for (const game of preview) {
        await importGame(game.date, game.notes || null, game.players)
        totalEntries += game.players.length
      }
      setResult({ games: preview.length, entries: totalEntries })
      setPreview(null)
    } catch (err) {
      setError('Import failed. Check console for details.')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = (withExample: boolean) => {
    const ws_data: (string | number)[][] = [IMPORT_HEADERS]
    if (withExample) {
      ws_data.push(
        ['6/13/2025', 'Cheryl', 10, 10, 5, 5, 0, 5, 10, 'Best Game Ever!'],
        ['6/13/2025', 'George', 5, 0, 10, 5, 5, 20, 0, 'Best Game Ever!'],
        ['6/13/2025', 'Lisa', 15, 10, 0, 10, 5, 5, 15, 'Best Game Ever!'],
        ['7/4/2025', 'Cheryl', 5, 15, 10, 0, 10, 5, 5, ''],
        ['7/4/2025', 'George', 10, 5, 5, 15, 0, 10, 10, ''],
      )
    } else {
      ws_data.push(['', '', '', '', '', '', '', '', '', ''])
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(ws_data)
    ws['!cols'] = [14, 12, 14, 18, 12, 12, 18, 18, 12, 20].map((w) => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Shanghai Games')
    XLSX.writeFile(wb, withExample ? 'shanghai-import-example.xlsx' : 'shanghai-import-template.xlsx')
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3 pt-6">
        <button onClick={onBack} className="text-[#a08c6e]">
          <ArrowLeft size={24} />
        </button>
        <h2 className="font-display text-2xl font-semibold text-[#2c1810]">Import Games</h2>
      </div>

      {result ? (
        <div className="card p-6 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 bg-[#2d7a3a]/10 rounded-full flex items-center justify-center">
            <Check size={24} className="text-[#2d7a3a]" />
          </div>
          <div>
            <div className="text-[#2c1810] font-semibold text-lg">Import Complete!</div>
            <div className="text-[#8b7355] text-sm mt-1">
              Imported {result.games} games with {result.entries} player entries
            </div>
          </div>
          <button onClick={onBack} className="btn-primary mt-2">Done</button>
        </div>
      ) : preview ? (
        <>
          <div className="card p-4">
            <h3 className="text-[#2c1810] font-medium mb-3">Preview ({preview.length} games)</h3>
            <div className="flex flex-col gap-3 max-h-80 overflow-auto">
              {preview.map((g, i) => (
                <div key={i} className="bg-[#efe9dd] rounded-lg p-3">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[#8b6914] font-mono text-sm">{g.date}</span>
                    {g.notes && (
                      <span className="text-[#a08c6e] text-xs truncate ml-2 max-w-[140px]">{g.notes}</span>
                    )}
                  </div>
                  {g.players.map((p, pi) => (
                    <div key={pi} className="flex justify-between text-sm py-0.5">
                      <span className="text-[#2c1810]">{p.name}</span>
                      <span className="font-mono text-[#8b7355]">{g.totals[pi]}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[#b83232] text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setPreview(null)} className="btn-secondary flex-1">
              Cancel
            </button>
            <button onClick={doImport} disabled={importing} className="btn-primary flex-1">
              {importing ? 'Importing...' : `Import ${preview.length} Games`}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Template downloads */}
          <div className="card p-4">
            <h3 className="text-[#a08c6e] text-xs uppercase tracking-wider mb-3">Download Template</h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => downloadTemplate(false)}
                className="flex items-center gap-3 bg-[#efe9dd] rounded-lg p-3 text-left"
              >
                <FileSpreadsheet size={18} className="text-[#1d7ea8]" />
                <div>
                  <div className="text-[#2c1810] text-sm">Blank Template</div>
                  <div className="text-[#8b7355] text-xs">Empty file with correct headers</div>
                </div>
                <Download size={16} className="text-[#a08c6e] ml-auto" />
              </button>
              <button
                onClick={() => downloadTemplate(true)}
                className="flex items-center gap-3 bg-[#efe9dd] rounded-lg p-3 text-left"
              >
                <FileSpreadsheet size={18} className="text-[#8b6914]" />
                <div>
                  <div className="text-[#2c1810] text-sm">Example with Sample Data</div>
                  <div className="text-[#8b7355] text-xs">2 sample games filled in</div>
                </div>
                <Download size={16} className="text-[#a08c6e] ml-auto" />
              </button>
            </div>
          </div>

          {/* File upload */}
          <div className="card p-4">
            <h3 className="text-[#a08c6e] text-xs uppercase tracking-wider mb-3">Upload File</h3>
            <p className="text-[#8b7355] text-xs mb-4">
              Accepts .xlsx, .xls, or .csv. Rows with the same Date + Notes are grouped into one game.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary flex items-center justify-center gap-2"
            >
              <Upload size={18} />
              Choose File
            </button>
            {error && (
              <div className="flex items-start gap-2 text-[#b83232] text-sm mt-3">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
