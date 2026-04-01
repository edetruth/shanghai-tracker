import { useEffect, useRef, useCallback } from 'react'
import { checkAchievements, ACHIEVEMENTS } from '../lib/achievements'
import type { AchievementContext } from '../lib/achievements'
import { saveAchievement, getPlayerAchievements } from '../lib/gameStore'
import type { GameState } from '../game/types'
import type { QueuedToast } from '../components/play/GameToast'

type ToastFn = (toast: Omit<QueuedToast, 'id'>) => void

export function useGameAchievements(
  initialPlayers: { name: string; isAI?: boolean }[],
) {
  const unlockedRef = useRef<Set<string>>(new Set())
  const toastFnRef = useRef<ToastFn | null>(null)

  /** Must be called once after queueToast is defined to wire up toast display */
  function setToastFn(fn: ToastFn) { toastFnRef.current = fn }

  // Load already-unlocked achievements for the first human player on mount
  useEffect(() => {
    const humanPlayers = initialPlayers.filter(p => !p.isAI)
    if (humanPlayers.length > 0) {
      getPlayerAchievements(humanPlayers[0].name).then(ids => {
        unlockedRef.current = new Set(ids)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toastAchievement(id: string) {
    const achievement = ACHIEVEMENTS.find(a => a.id === id)
    if (achievement && toastFnRef.current) {
      toastFnRef.current({
        message: `${achievement.icon} ${achievement.name}`,
        subtext: achievement.description,
        style: 'celebration',
        duration: 4000,
      })
    }
  }

  const checkAndShow = useCallback((
    gameStateRef: React.RefObject<GameState>,
    roundResults: { playerId: string; score: number; shanghaied: boolean }[] | null,
    isGameEnd: boolean,
  ) => {
    const gs = gameStateRef.current
    if (!gs) return
    gs.players.forEach((player, idx) => {
      if (player.isAI) return
      const ctx: AchievementContext = {
        gameState: gs,
        playerName: player.name,
        playerIndex: idx,
        roundResults: roundResults ?? undefined,
        isGameEnd,
      }
      const newIds = checkAchievements(ctx, unlockedRef.current)
      newIds.forEach(id => {
        unlockedRef.current.add(id)
        saveAchievement(player.name, id)
        toastAchievement(id)
      })
    })
  }, [])

  // For inline checks (joker swap, buy) — checks if already unlocked, adds + saves + toasts if not
  const unlockInline = useCallback((playerName: string, achievementId: string) => {
    if (unlockedRef.current.has(achievementId)) return
    unlockedRef.current.add(achievementId)
    saveAchievement(playerName, achievementId)
    toastAchievement(achievementId)
  }, [])

  return { checkAndShow, unlockInline, unlockedRef, setToastFn }
}
