import { describe, it, expect, vi } from 'vitest'

// Mock supabase module before importing tournamentStore
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ error: new Error('no supabase') }),
      select: () => ({
        eq: () => ({
          single: () => Promise.reject(new Error('no supabase')),
          order: () => ({
            order: () => Promise.reject(new Error('no supabase')),
          }),
        }),
      }),
    }),
  },
}))

// Mock gameStore to avoid its supabase dependency
vi.mock('../../lib/gameStore', () => ({
  createGameRoom: () => Promise.resolve(null),
}))

import { createTournament, getTournament, getTournamentMatches } from '../../lib/tournamentStore'

describe('tournamentStore', () => {
  it('createTournament returns null when supabase is unavailable', async () => {
    const result = await createTournament('Host', 4)
    expect(result).toBeNull()
  })

  it('getTournament returns null when supabase is unavailable', async () => {
    const result = await getTournament('TRNY-FAKE')
    expect(result).toBeNull()
  })

  it('getTournamentMatches returns empty array when supabase is unavailable', async () => {
    const result = await getTournamentMatches('fake-id')
    expect(result).toEqual([])
  })
})
