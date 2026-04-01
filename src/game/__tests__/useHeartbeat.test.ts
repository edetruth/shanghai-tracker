import { describe, it, expect } from 'vitest'
import { useHeartbeat } from '../../multiplayer/useHeartbeat'

describe('useHeartbeat', () => {
  it('useHeartbeat is a function', () => {
    expect(typeof useHeartbeat).toBe('function')
  })

  it('module does not throw on import', () => {
    // If we reached this point, the import succeeded without throwing
    expect(useHeartbeat).toBeDefined()
  })
})
