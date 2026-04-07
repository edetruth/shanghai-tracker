import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getPlayerRoundStats, getPlayerGameStats, getAIDecisions } from '../lib/gameStore'
import { ROUNDS } from '../lib/constants'
import type { PlayerRoundStats, PlayerGameStats, AIDecision } from '../game/types'

type Tab = 'overview' | 'ai-quality' | 'rounds' | 'decisions'

interface Props {
  onBack: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(num: number, den: number): string {
  if (den === 0) return '—'
  return `${Math.round((num / den) * 100)}%`
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function difficultyLabel(d: string | null, isHuman: boolean): string {
  if (isHuman) return 'Human'
  if (d === 'easy') return 'Easy'
  if (d === 'medium') return 'Medium'
  if (d === 'hard') return 'Hard'
  return 'Unknown'
}

const BAR_COLORS: Record<string, string> = {
  Easy: '#8b7355',
  Medium: '#e2b858',
  Hard: '#2d7a3a',
  Human: '#1d7ea8',
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-sand-light p-4 text-center">
      <div className="text-2xl font-bold text-warm-text">{value}</div>
      <div className="text-xs text-warm-muted uppercase tracking-wider mt-1">{label}</div>
    </div>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-warm-muted uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

// ── Chart wrapper ────────────────────────────────────────────────────────────

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-sand-light p-4">
      {children}
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-sand-light p-8 text-center">
      <BarChart3 size={32} className="text-[#e2ddd2] mx-auto mb-3" />
      <p className="text-[#8b7355] text-sm">{message}</p>
    </div>
  )
}

// ── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({
  roundStats, gameStats, decisions,
}: { roundStats: PlayerRoundStats[]; gameStats: PlayerGameStats[]; decisions: AIDecision[] }) {
  const uniqueGames = useMemo(() => new Set(gameStats.map(g => g.game_id)).size, [gameStats])

  // Win rates by category
  const winRates = useMemo(() => {
    const groups: Record<string, { total: number; wins: number }> = {}
    for (const g of gameStats) {
      const label = difficultyLabel(g.difficulty, g.is_human)
      if (!groups[label]) groups[label] = { total: 0, wins: 0 }
      groups[label].total++
      if (g.won) groups[label].wins++
    }
    return groups
  }, [gameStats])

  // Shanghai rate by difficulty
  const shanghaiRates = useMemo(() => {
    const groups: Record<string, { total: number; shanghaied: number }> = {}
    for (const r of roundStats) {
      const label = difficultyLabel(r.difficulty, r.is_human)
      if (!groups[label]) groups[label] = { total: 0, shanghaied: 0 }
      groups[label].total++
      if (r.shanghaied) groups[label].shanghaied++
    }
    return groups
  }, [roundStats])

  if (gameStats.length === 0 && roundStats.length === 0 && decisions.length === 0) {
    return <EmptyState message="Play some games to see analytics here. Data is collected automatically during gameplay." />
  }

  return (
    <>
      <Section title="Game Stats">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Games" value={uniqueGames} />
          <StatCard label="Rounds" value={roundStats.length} />
          <StatCard label="Decisions" value={decisions.length} />
        </div>
      </Section>

      {Object.keys(winRates).length > 0 && (
        <Section title="Win Rates">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(winRates).map(([label, { total, wins }]) => (
              <StatCard key={label} label={`${label} Wins`} value={pct(wins, total)} />
            ))}
          </div>
        </Section>
      )}

      {Object.keys(shanghaiRates).length > 0 && (
        <Section title="Shanghai Rate">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(shanghaiRates).map(([label, { total, shanghaied }]) => (
              <StatCard key={label} label={label} value={pct(shanghaied, total)} />
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// ── Tab: AI Quality ──────────────────────────────────────────────────────────

function AIQualityTab({ roundStats }: { roundStats: PlayerRoundStats[] }) {
  const diffGroups = useMemo(() => {
    const groups: Record<string, PlayerRoundStats[]> = {}
    for (const r of roundStats) {
      const label = difficultyLabel(r.difficulty, r.is_human)
      if (!groups[label]) groups[label] = []
      groups[label].push(r)
    }
    return groups
  }, [roundStats])

  const labels = Object.keys(diffGroups)

  const scoreData = useMemo(() =>
    labels.map(label => ({
      name: label,
      score: Math.round(avg(diffGroups[label].map(r => r.round_score))),
      fill: BAR_COLORS[label] ?? '#8b7355',
    })), [labels, diffGroups])

  const takeAccData = useMemo(() =>
    labels.map(label => {
      const g = diffGroups[label]
      const used = g.reduce((s, r) => s + r.cards_taken_used_in_meld, 0)
      const wasted = g.reduce((s, r) => s + r.cards_taken_wasted, 0)
      const total = used + wasted
      return { name: label, accuracy: total > 0 ? Math.round((used / total) * 100) : 0, fill: BAR_COLORS[label] ?? '#8b7355' }
    }), [labels, diffGroups])

  const shanghaiData = useMemo(() =>
    labels.map(label => {
      const g = diffGroups[label]
      const s = g.filter(r => r.shanghaied).length
      return { name: label, rate: g.length > 0 ? Math.round((s / g.length) * 100) : 0, fill: BAR_COLORS[label] ?? '#8b7355' }
    }), [labels, diffGroups])

  const goDownData = useMemo(() =>
    labels.map(label => {
      const turns = diffGroups[label].filter(r => r.turn_went_down !== null).map(r => r.turn_went_down!)
      return { name: label, turn: turns.length > 0 ? Math.round(avg(turns) * 10) / 10 : 0, fill: BAR_COLORS[label] ?? '#8b7355' }
    }), [labels, diffGroups])

  if (roundStats.length === 0) {
    return <EmptyState message="Need more data. Play a few more games for meaningful stats." />
  }

  return (
    <>
      <Section title="Avg Score by Difficulty">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={scoreData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} />
              <Tooltip />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {scoreData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Take Accuracy by Difficulty">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={takeAccData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} unit="%" />
              <Tooltip />
              <Bar dataKey="accuracy" radius={[4, 4, 0, 0]}>
                {takeAccData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Shanghai Rate by Difficulty">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={shanghaiData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} unit="%" />
              <Tooltip />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {shanghaiData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Avg Turn Going Down">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={goDownData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} />
              <Tooltip />
              <Bar dataKey="turn" radius={[4, 4, 0, 0]}>
                {goDownData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Decision Breakdown">
        <div className="bg-white rounded-xl shadow-sm border border-sand-light overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-light">
                <th className="text-left p-3 text-warm-muted font-medium text-xs">Metric</th>
                {labels.map(l => <th key={l} className="text-right p-3 text-warm-muted font-medium text-xs">{l}</th>)}
              </tr>
            </thead>
            <tbody className="text-warm-text">
              <tr className="border-b border-sand-light">
                <td className="p-3 text-[#8b7355]">Avg round score</td>
                {labels.map(l => <td key={l} className="text-right p-3 font-medium">{Math.round(avg(diffGroups[l].map(r => r.round_score)))}</td>)}
              </tr>
              <tr className="border-b border-sand-light">
                <td className="p-3 text-[#8b7355]">Shanghai rate</td>
                {labels.map(l => {
                  const g = diffGroups[l]
                  return <td key={l} className="text-right p-3 font-medium">{pct(g.filter(r => r.shanghaied).length, g.length)}</td>
                })}
              </tr>
              <tr className="border-b border-sand-light">
                <td className="p-3 text-[#8b7355]">Take accuracy</td>
                {labels.map(l => {
                  const g = diffGroups[l]
                  const used = g.reduce((s, r) => s + r.cards_taken_used_in_meld, 0)
                  const total = used + g.reduce((s, r) => s + r.cards_taken_wasted, 0)
                  return <td key={l} className="text-right p-3 font-medium">{pct(used, total)}</td>
                })}
              </tr>
              <tr className="border-b border-sand-light">
                <td className="p-3 text-[#8b7355]">Avg turn went down</td>
                {labels.map(l => {
                  const turns = diffGroups[l].filter(r => r.turn_went_down !== null).map(r => r.turn_went_down!)
                  return <td key={l} className="text-right p-3 font-medium">{turns.length > 0 ? (avg(turns)).toFixed(1) : '—'}</td>
                })}
              </tr>
              <tr className="border-b border-sand-light">
                <td className="p-3 text-[#8b7355]">Avg lay-offs/round</td>
                {labels.map(l => <td key={l} className="text-right p-3 font-medium">{avg(diffGroups[l].map(r => r.lay_offs_made)).toFixed(1)}</td>)}
              </tr>
              <tr>
                <td className="p-3 text-[#8b7355]">Avg buys/round</td>
                {labels.map(l => <td key={l} className="text-right p-3 font-medium">{avg(diffGroups[l].map(r => r.buys_made)).toFixed(1)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

// ── Tab: Rounds ──────────────────────────────────────────────────────────────

function RoundsTab({ roundStats }: { roundStats: PlayerRoundStats[] }) {
  const roundGroups = useMemo(() => {
    const groups: Record<number, PlayerRoundStats[]> = {}
    for (const r of roundStats) {
      if (!groups[r.round_number]) groups[r.round_number] = []
      groups[r.round_number].push(r)
    }
    return groups
  }, [roundStats])

  const scoreByRound = useMemo(() =>
    [1, 2, 3, 4, 5, 6, 7].map(n => ({
      name: `R${n}`,
      score: Math.round(avg((roundGroups[n] ?? []).map(r => r.round_score))),
      fill: (n === 3 || n === 7) ? '#b83232' : '#e2b858',
    })), [roundGroups])

  const shanghaiByRound = useMemo(() =>
    [1, 2, 3, 4, 5, 6, 7].map(n => {
      const g = roundGroups[n] ?? []
      return {
        name: `R${n}`,
        rate: g.length > 0 ? Math.round((g.filter(r => r.shanghaied).length / g.length) * 100) : 0,
        fill: (n === 3 || n === 7) ? '#b83232' : '#e2b858',
      }
    }), [roundGroups])

  const turnsByRound = useMemo(() =>
    [1, 2, 3, 4, 5, 6, 7].map(n => ({
      name: `R${n}`,
      turns: Math.round(avg((roundGroups[n] ?? []).map(r => r.total_turns))),
      fill: '#2d7a3a',
    })), [roundGroups])

  // Difficulty ranking
  const ranking = useMemo(() =>
    [1, 2, 3, 4, 5, 6, 7]
      .map(n => {
        const g = roundGroups[n] ?? []
        const roundName = ROUNDS[n - 1]?.name ?? `Round ${n}`
        return {
          round: n,
          name: roundName,
          avgScore: Math.round(avg(g.map(r => r.round_score))),
          shanghaiRate: g.length > 0 ? Math.round((g.filter(r => r.shanghaied).length / g.length) * 100) : 0,
          avgTurns: Math.round(avg(g.map(r => r.total_turns))),
          count: g.length,
        }
      })
      .sort((a, b) => b.avgScore - a.avgScore),
    [roundGroups])

  if (roundStats.length === 0) {
    return <EmptyState message="No round data yet. Play a complete game to see round analytics." />
  }

  return (
    <>
      <Section title="Avg Score by Round">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={scoreByRound}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} />
              <Tooltip />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {scoreByRound.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Shanghai Rate by Round">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={shanghaiByRound}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} unit="%" />
              <Tooltip />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {shanghaiByRound.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Avg Turns per Round">
        <ChartCard>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={turnsByRound}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd2" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8b7355' }} />
              <YAxis tick={{ fontSize: 12, fill: '#8b7355' }} />
              <Tooltip />
              <Bar dataKey="turns" fill="#2d7a3a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Round Difficulty Ranking">
        <div className="flex flex-col gap-2">
          {ranking.map((r, i) => (
            <div key={r.round} className="bg-white rounded-xl shadow-sm border border-sand-light p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#efe9dd] flex items-center justify-center text-sm font-bold text-[#8b6914]">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-warm-text font-medium text-sm">Round {r.round} — {r.name}</div>
                <div className="text-[#8b7355] text-xs mt-0.5">
                  Avg {r.avgScore} pts &middot; {r.shanghaiRate}% shanghaied &middot; {r.avgTurns} turns
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

// ── Tab: Decisions ───────────────────────────────────────────────────────────

function DecisionsTab({ decisions }: { decisions: AIDecision[] }) {
  const [diffFilter, setDiffFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const filtered = useMemo(() =>
    decisions.filter(d => {
      if (diffFilter !== 'all') {
        const label = difficultyLabel(d.difficulty, d.is_human).toLowerCase()
        if (label !== diffFilter) return false
      }
      if (typeFilter !== 'all' && d.decision_type !== typeFilter) return false
      return true
    }), [decisions, diffFilter, typeFilter])

  // Outcome summary
  const summary = useMemo(() => {
    const total = filtered.length
    const usedInMeld = filtered.filter(d => (d as unknown as Record<string, unknown>).card_used_in_meld === true).length
    const wasted = filtered.filter(d => (d as unknown as Record<string, unknown>).card_still_in_hand_at_round_end === true).length
    return { total, usedInMeld, wasted }
  }, [filtered])

  // By reason
  const reasonGroups = useMemo(() => {
    const groups: Record<string, { count: number; used: number; wasted: number }> = {}
    for (const d of filtered) {
      const reason = d.reason || '(none)'
      if (!groups[reason]) groups[reason] = { count: 0, used: 0, wasted: 0 }
      groups[reason].count++
      if ((d as unknown as Record<string, unknown>).card_used_in_meld === true) groups[reason].used++
      if ((d as unknown as Record<string, unknown>).card_still_in_hand_at_round_end === true) groups[reason].wasted++
    }
    return Object.entries(groups).sort((a, b) => b[1].count - a[1].count)
  }, [filtered])

  // Recent decisions
  const recent = filtered.slice(0, 20)

  if (decisions.length === 0) {
    return <EmptyState message="No decision data yet. Play a game to see decision analytics." />
  }

  return (
    <>
      <Section title="Filters">
        <div className="flex gap-3">
          <select
            value={diffFilter}
            onChange={e => setDiffFilter(e.target.value)}
            className="flex-1 bg-white border border-sand-light rounded-lg px-3 py-2 text-sm text-warm-text"
          >
            <option value="all">All Players</option>
            <option value="human">Human</option>
            <option value="easy">Easy AI</option>
            <option value="medium">Medium AI</option>
            <option value="hard">Hard AI</option>
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="flex-1 bg-white border border-sand-light rounded-lg px-3 py-2 text-sm text-warm-text"
          >
            <option value="all">All Types</option>
            <option value="draw">Draw</option>
            <option value="buy">Buy</option>
            <option value="free_take">Free Take</option>
            <option value="discard">Discard</option>
            <option value="go_down">Go Down</option>
            <option value="lay_off">Lay Off</option>
            <option value="joker_swap">Joker Swap</option>
          </select>
        </div>
      </Section>

      <Section title="Outcome Summary">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total" value={summary.total} />
          <StatCard label="Used in Meld" value={summary.usedInMeld} />
          <StatCard label="Wasted" value={summary.wasted} />
        </div>
      </Section>

      {reasonGroups.length > 0 && reasonGroups[0][0] !== '(none)' && (
        <Section title="Decision Reasons">
          <div className="bg-white rounded-xl shadow-sm border border-sand-light overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-light">
                  <th className="text-left p-3 text-warm-muted font-medium text-xs">Reason</th>
                  <th className="text-right p-3 text-warm-muted font-medium text-xs">Count</th>
                  <th className="text-right p-3 text-warm-muted font-medium text-xs">Used</th>
                  <th className="text-right p-3 text-warm-muted font-medium text-xs">Wasted</th>
                </tr>
              </thead>
              <tbody className="text-warm-text">
                {reasonGroups.map(([reason, data]) => (
                  <tr key={reason} className="border-b border-sand-light last:border-b-0">
                    <td className="p-3 text-[#8b7355]">{reason}</td>
                    <td className="text-right p-3 font-medium">{data.count}</td>
                    <td className="text-right p-3 font-medium text-[#2d7a3a]">
                      {data.used} {data.count > 0 && `(${Math.round((data.used / data.count) * 100)}%)`}
                    </td>
                    <td className="text-right p-3 font-medium text-[#b83232]">{data.wasted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Recent Decisions">
        <div className="flex flex-col gap-2">
          {recent.map((d, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-sand-light p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-warm-text font-medium text-sm">{d.player_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#efe9dd] text-[#8b7355] font-medium">
                    {difficultyLabel(d.difficulty, d.is_human)}
                  </span>
                </div>
                <span className="text-xs text-warm-muted">R{d.round_number} T{d.turn_number}</span>
              </div>
              <div className="text-sm text-[#8b7355]">
                <span className="font-medium text-warm-text">{d.decision_type}</span>
                {' → '}{d.decision_result}
                {d.card_suit && d.card_rank !== undefined && (
                  <span className="ml-1 text-warm-muted">
                    ({d.card_rank === 0 ? 'Joker' : `${d.card_rank} of ${d.card_suit}`})
                  </span>
                )}
              </div>
              {d.reason && <div className="text-xs text-warm-muted mt-1">{d.reason}</div>}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'ai-quality', label: 'AI Quality' },
  { key: 'rounds', label: 'Rounds' },
  { key: 'decisions', label: 'Decisions' },
]

export default function AnalyticsPage({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [roundStats, setRoundStats] = useState<PlayerRoundStats[]>([])
  const [gameStats, setGameStats] = useState<PlayerGameStats[]>([])
  const [decisions, setDecisions] = useState<AIDecision[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [rs, gs, ds] = await Promise.all([
        getPlayerRoundStats(),
        getPlayerGameStats(),
        getAIDecisions(),
      ])
      setRoundStats(rs)
      setGameStats(gs)
      setDecisions(ds)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <div className="p-4 safe-top">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="text-[#8b6914] p-1 -ml-1">
            <ArrowLeft size={22} />
          </button>
          <h2 className="font-heading text-2xl font-semibold text-warm-text">Analytics</h2>
        </div>
      </div>

      {/* Tab pills */}
      <div className="px-4 pb-3">
        <div className="bg-[#efe9dd] rounded-xl p-1 flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                tab === t.key
                  ? 'bg-white text-[#8b6914] shadow-sm'
                  : 'text-[#8b7355]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {loading ? (
          <div className="text-center py-12 text-[#8b7355]">Loading analytics...</div>
        ) : (
          <>
            {tab === 'overview' && <OverviewTab roundStats={roundStats} gameStats={gameStats} decisions={decisions} />}
            {tab === 'ai-quality' && <AIQualityTab roundStats={roundStats} />}
            {tab === 'rounds' && <RoundsTab roundStats={roundStats} />}
            {tab === 'decisions' && <DecisionsTab decisions={decisions} />}
          </>
        )}
      </div>
    </div>
  )
}
