// Haptic feedback utility — uses navigator.vibrate where available (Android Chrome/Firefox)
// Silently no-ops on iOS Safari and desktop

export type HapticType = 'tap' | 'success' | 'error' | 'heavy'

export function haptic(type: HapticType = 'tap'): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return
  switch (type) {
    case 'tap':     navigator.vibrate(8); break
    case 'heavy':   navigator.vibrate(25); break
    case 'success': navigator.vibrate([15, 40, 15]); break
    case 'error':   navigator.vibrate([8, 30, 8, 30, 8]); break
  }
}
