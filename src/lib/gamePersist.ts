import type { PlayerConfig, AIPersonality } from '../game/types'

const CTX_KEY = 'shanghai_game_ctx_v1'

export interface SavedGameContext {
  gameId: string | null
  playerMap: Record<string, string>
  playerConfigs: PlayerConfig[]
  aiPersonality: AIPersonality
  buyLimit: number
  currentRound: number
  savedAt: number
}

export function saveGameContext(ctx: SavedGameContext): void {
  try { localStorage.setItem(CTX_KEY, JSON.stringify(ctx)) } catch {}
}

export function loadGameContext(): SavedGameContext | null {
  try {
    const raw = localStorage.getItem(CTX_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw) as SavedGameContext
    if (!Array.isArray(ctx.playerConfigs) || ctx.playerConfigs.length === 0) return null
    return ctx
  } catch { return null }
}

export function clearGameContext(): void {
  localStorage.removeItem(CTX_KEY)
}
