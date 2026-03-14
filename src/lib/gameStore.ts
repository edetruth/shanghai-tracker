import { supabase } from './supabase'
import type { Game, GameScore, GameWithScores, Player } from './types'

// Players
export async function getPlayers(): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export async function upsertPlayer(name: string): Promise<Player> {
  const trimmed = name.trim()
  // Check for existing player (case-insensitive)
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .ilike('name', trimmed)
    .single()
  if (existing) return existing

  const { data, error } = await supabase
    .from('players')
    .insert({ name: trimmed })
    .select()
    .single()
  if (error) throw error
  return data
}

// Room code generator
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'SHNG-'
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// Games
export async function createGame(
  playerIds: string[],
  date: string
): Promise<Game> {
  const roomCode = generateRoomCode()
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      date,
      room_code: roomCode,
      is_complete: false,
    })
    .select()
    .single()
  if (gameError) throw gameError

  // Create score rows for each player
  const scoreRows = playerIds.map((pid) => ({
    game_id: game.id,
    player_id: pid,
    round_scores: [],
  }))
  const { error: scoresError } = await supabase
    .from('game_scores')
    .insert(scoreRows)
  if (scoresError) throw scoresError

  return game
}

export async function getGame(gameId: string): Promise<GameWithScores | null> {
  const { data, error } = await supabase
    .from('games')
    .select(`*, game_scores(*, player:players(*))`)
    .eq('id', gameId)
    .single()
  if (error) return null
  return data as GameWithScores
}

export async function getGameByRoomCode(
  roomCode: string
): Promise<GameWithScores | null> {
  const { data, error } = await supabase
    .from('games')
    .select(`*, game_scores(*, player:players(*))`)
    .eq('room_code', roomCode.toUpperCase())
    .eq('is_complete', false)
    .single()
  if (error) return null
  return data as GameWithScores
}

export async function getCompletedGames(): Promise<GameWithScores[]> {
  const { data, error } = await supabase
    .from('games')
    .select(`*, game_scores(*, player:players(*))`)
    .eq('is_complete', true)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as GameWithScores[]
}

export async function updateRoundScore(
  gameId: string,
  playerId: string,
  roundIndex: number,
  score: number
): Promise<void> {
  // Fetch current scores first
  const { data: existing, error: fetchError } = await supabase
    .from('game_scores')
    .select('round_scores')
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .single()
  if (fetchError) throw fetchError

  const scores = [...(existing.round_scores ?? [])]
  // Pad array if needed
  while (scores.length <= roundIndex) scores.push(0)
  scores[roundIndex] = score

  const { error } = await supabase
    .from('game_scores')
    .update({ round_scores: scores })
    .eq('game_id', gameId)
    .eq('player_id', playerId)
  if (error) throw error
}

export async function saveAllRoundScores(
  gameId: string,
  playerId: string,
  roundScores: number[]
): Promise<void> {
  const { error } = await supabase
    .from('game_scores')
    .update({ round_scores: roundScores })
    .eq('game_id', gameId)
    .eq('player_id', playerId)
  if (error) throw error
}

export async function completeGame(
  gameId: string,
  notes: string
): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ is_complete: true, notes: notes || null })
    .eq('id', gameId)
  if (error) throw error
}

export async function deleteGame(gameId: string): Promise<void> {
  const { error } = await supabase.from('games').delete().eq('id', gameId)
  if (error) throw error
}

// Bulk import
export async function importGame(
  date: string,
  notes: string | null,
  players: Array<{ name: string; roundScores: number[] }>
): Promise<void> {
  // Upsert all players
  const playerRecords = await Promise.all(
    players.map((p) => upsertPlayer(p.name))
  )

  // Create game
  const roomCode = generateRoomCode()
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({ date, room_code: roomCode, notes: notes || null, is_complete: true })
    .select()
    .single()
  if (gameError) throw gameError

  // Insert scores
  const scoreRows = playerRecords.map((player, i) => ({
    game_id: game.id,
    player_id: player.id,
    round_scores: players[i].roundScores,
  }))
  const { error: scoresError } = await supabase
    .from('game_scores')
    .insert(scoreRows)
  if (scoresError) throw scoresError
}

// Stats helpers
export function computeWinner(scores: GameScore[]): GameScore | null {
  if (!scores.length) return null
  return scores.reduce((best, s) =>
    s.total_score < best.total_score ? s : best
  )
}
