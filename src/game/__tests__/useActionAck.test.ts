import { describe, it, expect } from 'vitest'
import { useActionAck } from '../../multiplayer/useActionAck'

describe('useActionAck', () => {
  it('useActionAck is a function', () => {
    expect(typeof useActionAck).toBe('function')
  })

  it('module does not throw on import', () => {
    // If we reached this point, the import succeeded without throwing
    expect(useActionAck).toBeDefined()
  })
})
