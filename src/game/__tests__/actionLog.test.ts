import { describe, it, expect, vi } from 'vitest'

// Mock supabase module before importing actionLog
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.reject(new Error('no supabase')),
      select: () => ({
        eq: () => ({
          order: () => Promise.reject(new Error('no supabase')),
        }),
      }),
    }),
  },
}))

import { logAction, loadActionLog, hasActionLog } from '../../lib/actionLog'

describe('actionLog', () => {
  it('logAction does not throw (fire-and-forget)', () => {
    expect(() => logAction('fake-game-id', 1, 0, 'draw', {})).not.toThrow()
  })

  it('loadActionLog returns empty array when supabase is unavailable', async () => {
    const result = await loadActionLog('fake-game-id')
    expect(result).toEqual([])
  })

  it('hasActionLog returns false when supabase is unavailable', async () => {
    const result = await hasActionLog('fake-game-id')
    expect(result).toBe(false)
  })
})
