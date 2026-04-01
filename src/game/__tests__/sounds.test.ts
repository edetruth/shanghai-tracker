import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() { return store.size },
  key: (_index: number) => null as string | null,
}

vi.stubGlobal('localStorage', mockLocalStorage)

import { getSfxVolume, setSfxVolume, getNotifVolume, setNotifVolume, playSound } from '../../lib/sounds'

describe('sounds', () => {
  beforeEach(() => {
    store.clear()
  })

  it('getSfxVolume returns 0.7 by default', () => {
    expect(getSfxVolume()).toBe(0.7)
  })

  it('setSfxVolume persists and getSfxVolume returns the new value', () => {
    setSfxVolume(0.5)
    expect(getSfxVolume()).toBe(0.5)
  })

  it('getNotifVolume returns 0.7 by default', () => {
    expect(getNotifVolume()).toBe(0.7)
  })

  it('setNotifVolume clamps to 0-1 range', () => {
    setNotifVolume(1.5)
    expect(getNotifVolume()).toBe(1)

    setNotifVolume(-0.3)
    expect(getNotifVolume()).toBe(0)
  })

  it('playSound rejects gracefully when AudioContext is unavailable', async () => {
    // AudioContext doesn't exist in node test env — playSound will reject
    // but it should not throw synchronously (it returns a Promise)
    const promise = playSound('card-draw')
    expect(promise).toBeInstanceOf(Promise)
    await expect(promise).rejects.toThrow('AudioContext is not defined')
  })
})
