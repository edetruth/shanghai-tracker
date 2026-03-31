import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  getTournament, getTournamentMatches,
  type Tournament, type TournamentMatch,
} from '../lib/tournamentStore'

export function useTournamentChannel(code: string | null) {
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [matches, setMatches] = useState<TournamentMatch[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!code) return
    const t = await getTournament(code)
    const m = t ? await getTournamentMatches(t.id) : []
    setTournament(t)
    setMatches(m)
    setLoading(false)
  }, [code])

  // Initial fetch
  useEffect(() => {
    if (!code) { setLoading(false); return }
    refresh()
  }, [code, refresh])

  // Real-time subscription for tournament and match changes
  useEffect(() => {
    if (!code) return

    const channel = supabase
      .channel(`tournament-${code}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tournament_matches',
      }, () => refresh())
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tournaments',
        filter: `code=eq.${code}`,
      }, () => refresh())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [code, refresh])

  return { tournament, matches, loading, refresh }
}
