// Local browser notifications for multiplayer turn alerts
// Uses Notification API — works when tab is open but not focused

let permissionGranted = false

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') {
    permissionGranted = true
    return true
  }
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  permissionGranted = result === 'granted'
  return permissionGranted
}

export function hasNotificationPermission(): boolean {
  if (!('Notification' in window)) return false
  return Notification.permission === 'granted'
}

function showNotification(title: string, body: string): void {
  if (!permissionGranted && !hasNotificationPermission()) return
  if (!document.hidden) return // Only notify when tab is not focused
  try {
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag: 'shanghai-turn', // Replace previous notification
    })
  } catch {
    // Silent fail — notifications are nice-to-have
  }
}

export function notifyTurn(roomCode: string): void {
  showNotification('Your Turn', `It's your turn in ${roomCode}`)
}

export function notifyGameStarting(roomCode: string): void {
  showNotification('Game Starting', `Your game in ${roomCode} is starting!`)
}

export function notifyRoundOver(playerName: string, roomCode: string): void {
  showNotification('Round Over!', `${playerName} went out in ${roomCode}`)
}

export function notifyGameOver(winnerName: string, roomCode: string): void {
  showNotification('Game Over', `${winnerName} wins in ${roomCode}!`)
}
