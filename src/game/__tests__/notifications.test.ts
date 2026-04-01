import { describe, it, expect, vi } from 'vitest'

// Ensure 'Notification' is NOT on globalThis so the module treats it as unavailable
// (node env doesn't have it by default, but be explicit)
if ('Notification' in globalThis) {
  vi.stubGlobal('Notification', undefined)
}

// Ensure 'window' exists for the 'Notification' in window check
if (typeof globalThis.window === 'undefined') {
  vi.stubGlobal('window', globalThis)
}

import { hasNotificationPermission, notifyTurn, notifyGameOver } from '../../lib/notifications'

describe('notifications', () => {
  it('hasNotificationPermission returns false when Notification API is unavailable', () => {
    expect(hasNotificationPermission()).toBe(false)
  })

  it('notifyTurn does not throw when Notification API is unavailable', () => {
    expect(() => notifyTurn('SHNG-ABCD')).not.toThrow()
  })

  it('notifyGameOver does not throw when Notification API is unavailable', () => {
    expect(() => notifyGameOver('Alice', 'SHNG-ABCD')).not.toThrow()
  })
})
