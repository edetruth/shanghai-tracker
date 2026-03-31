import { supabase } from './supabase'
import type { Game, GameScore, GameWithScores, Player } from './types'
import type { AIDecision, PlayerRoundStats, PlayerGameStats, Player as GamePlayer } from '../game/types'
import type { GameRoom, GameRoomConfig, GameRoomPlayer } from '../game/multiplayer-types'
import { cardPoints } from '../game/rules'

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
  date: string,
  gameType: string = 'manual',
  buyLimit: number = 5,
): Promise<Game> {
  const roomCode = generateRoomCode()
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      date,
      room_code: roomCode,
      is_complete: false,
      game_type: gameType,
      buy_limit: buyLimit,
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
    .insert({ date, room_code: roomCode, notes: notes || null, is_complete: true, game_type: 'manual' })
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

export async function savePlayedGame(
  players: Array<{ name: string; roundScores: number[] }>,
  date: string,
  gameType: string = 'pass-and-play',
  buyLimit: number = 5,
): Promise<string> {
  const playerRecords = await Promise.all(players.map(p => upsertPlayer(p.name)))
  const roomCode = generateRoomCode()
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({ date, room_code: roomCode, is_complete: true, game_type: gameType, buy_limit: buyLimit })
    .select()
    .single()
  if (gameError) throw gameError

  const scoreRows = playerRecords.map((player, i) => ({
    game_id: game.id,
    player_id: player.id,
    round_scores: players[i].roundScores,
  }))
  const { error: scoresError } = await supabase.from('game_scores').insert(scoreRows)
  if (scoresError) throw scoresError
  return game.id
}

export async function createPlayedGame(
  playerNames: string[],
  date: string,
  gameType: string,
  buyLimit: number = 5,
): Promise<string> {
  const playerIds = await Promise.all(
    playerNames.map(name => upsertPlayer(name).then(p => p.id))
  )
  const { data: game, error } = await supabase
    .from('games')
    .insert({
      date,
      game_type: gameType,
      buy_limit: buyLimit,
      is_complete: false,
      room_code: generateRoomCode(),
    })
    .select()
    .single()
  if (error || !game) throw error
  await supabase.from('game_scores').insert(
    playerIds.map(playerId => ({
      game_id: game.id,
      player_id: playerId,
      round_scores: [],
    }))
  )
  return game.id
}

export async function completePlayedGame(
  gameId: string,
  players: { name: string; roundScores: number[] }[]
): Promise<void> {
  for (const player of players) {
    const { data: p } = await supabase
      .from('players')
      .select('id')
      .eq('name', player.name)
      .single()
    if (!p) continue
    await supabase
      .from('game_scores')
      .update({ round_scores: player.roundScores })
      .eq('game_id', gameId)
      .eq('player_id', p.id)
  }
  await supabase
    .from('games')
    .update({ is_complete: true })
    .eq('id', gameId)
}

export async function updateGame(
  gameId: string,
  updates: { date?: string; notes?: string }
): Promise<void> {
  const { error } = await supabase.from('games').update(updates).eq('id', gameId)
  if (error) throw error
}

export async function updatePlayerInGame(
  gameId: string,
  oldPlayerId: string,
  newPlayerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('game_scores')
    .update({ player_id: newPlayerId })
    .eq('game_id', gameId)
    .eq('player_id', oldPlayerId)
  if (error) throw error
}

export async function saveShanghaiEvents(
  gameId: string,
  roundNumber: number,
  shanghaiPlayerIds: string[],
): Promise<void> {
  if (shanghaiPlayerIds.length === 0) return
  const rows = shanghaiPlayerIds.map(pid => ({
    game_id: gameId,
    player_id: pid,
    round_number: roundNumber,
  }))
  // Silently ignore errors (table may not exist yet)
  await supabase.from('shanghai_events').insert(rows).then(() => {})
}

// Game telemetry
export interface GameEvent {
  round: number
  turn: number
  event: string
  playerName: string
  card?: string
  detail?: string
}

export async function saveGameEvents(
  gameId: string,
  events: GameEvent[]
): Promise<void> {
  if (!events || events.length === 0) return
  const rows = events.map(e => ({
    game_id: gameId,
    round_number: e.round,
    turn_number: e.turn,
    event_type: e.event,
    player_name: e.playerName,
    card: e.card ?? null,
    detail: e.detail ? { detail: e.detail } : null,
  }))
  const { error } = await supabase.from('game_events').insert(rows)
  if (error) console.error('saveGameEvents failed:', error)
  // Silent fail — telemetry should never break the game
}

// ── Telemetry: AI decisions ──────────────────────────────────────────────────

export async function saveAIDecisions(decisions: AIDecision[]): Promise<void> {
  if (decisions.length === 0) return
  try {
    await supabase.from('ai_decisions').insert(decisions)
  } catch {
    // silent — telemetry never breaks gameplay
  }
}

export async function backfillDecisionOutcomes(
  gameId: string,
  roundNumber: number,
  players: GamePlayer[],
): Promise<void> {
  try {
    const { data: decisions } = await supabase
      .from('ai_decisions')
      .select('id, player_name, card_suit, card_rank')
      .eq('game_id', gameId)
      .eq('round_number', roundNumber)
      .in('decision_type', ['draw', 'buy', 'free_take'])
      .in('decision_result', ['took_discard', 'bought', 'took'])

    if (!decisions || decisions.length === 0) return

    for (const d of decisions) {
      const player = players.find(p => p.name === d.player_name)
      if (!player) continue

      const cardInMeld = player.melds.some(m =>
        m.cards.some(c => c.suit === d.card_suit && c.rank === d.card_rank)
      )
      const cardInHand = player.hand.some(c =>
        c.suit === d.card_suit && c.rank === d.card_rank
      )
      const points = cardInHand ? cardPoints(d.card_rank ?? 0) : 0

      await supabase
        .from('ai_decisions')
        .update({
          card_used_in_meld: cardInMeld,
          card_still_in_hand_at_round_end: cardInHand,
          points_contributed: points,
        })
        .eq('id', d.id)
    }
  } catch {
    // silent
  }
}

// ── Telemetry: round + game stats ───────────────────────────────────────────

export async function savePlayerRoundStats(stats: PlayerRoundStats): Promise<void> {
  try {
    const { error } = await supabase.from('player_round_stats').upsert(stats, {
      onConflict: 'game_id,round_number,player_name',
    })
    if (error) console.error('savePlayerRoundStats failed:', error.message, error.details)
  } catch {
    // silent
  }
}

export async function savePlayerGameStats(stats: PlayerGameStats): Promise<void> {
  try {
    const { error } = await supabase.from('player_game_stats').upsert(stats, {
      onConflict: 'game_id,player_name',
    })
    if (error) console.error('savePlayerGameStats failed:', error.message, error.details)
  } catch {
    // silent
  }
}

// ── Telemetry: read queries ──────────────────────────────────────────────────

export async function getPlayerRoundStats(limit = 500): Promise<PlayerRoundStats[]> {
  try {
    const { data } = await supabase.from('player_round_stats').select('*')
      .order('created_at', { ascending: false }).limit(limit)
    return data ?? []
  } catch { return [] }
}

export async function getPlayerGameStats(limit = 100): Promise<PlayerGameStats[]> {
  try {
    const { data } = await supabase.from('player_game_stats').select('*')
      .order('created_at', { ascending: false }).limit(limit)
    return data ?? []
  } catch { return [] }
}

export async function getAIDecisions(limit = 2000): Promise<AIDecision[]> {
  try {
    const { data } = await supabase.from('ai_decisions').select('*')
      .order('created_at', { ascending: false }).limit(limit)
    return data ?? []
  } catch { return [] }
}

// Stats helpers
export function computeWinner(scores: GameScore[]): GameScore | null {
  if (!scores.length) return null
  return scores.reduce((best, s) =>
    s.total_score < best.total_score ? s : best
  )
}

// ── Game Rooms (online multiplayer) ─────────────────────────────────────────

export async function createGameRoom(
  hostName: string,
  config: GameRoomConfig,
): Promise<GameRoom> {
  const roomCode = generateRoomCode()
  const { data, error } = await supabase
    .from('game_rooms')
    .insert({
      room_code: roomCode,
      host_player_name: hostName,
      game_config: config,
      status: 'waiting',
    })
    .select()
    .single()
  if (error) throw error

  // Add host as first player at seat 0
  await supabase.from('game_room_players').insert({
    room_code: roomCode,
    player_name: hostName,
    seat_index: 0,
    is_host: true,
    is_ai: false,
    is_connected: true,
  })

  return data as GameRoom
}

export async function joinGameRoom(
  roomCode: string,
  playerName: string,
): Promise<{ room: GameRoom; seatIndex: number }> {
  // Fetch the room
  const { data: room, error: roomErr } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('room_code', roomCode)
    .eq('status', 'waiting')
    .single()
  if (roomErr || !room) throw new Error('Room not found or game already started')

  // Find the next available seat
  const { data: players } = await supabase
    .from('game_room_players')
    .select('seat_index')
    .eq('room_code', roomCode)
    .order('seat_index')
  const takenSeats = new Set((players ?? []).map(p => p.seat_index))
  const maxSeats = (room as GameRoom).game_config.playerCount ?? 8
  let seatIndex = -1
  for (let i = 0; i < maxSeats; i++) {
    if (!takenSeats.has(i)) { seatIndex = i; break }
  }
  if (seatIndex === -1) throw new Error('Room is full')

  const { error: joinErr } = await supabase.from('game_room_players').insert({
    room_code: roomCode,
    player_name: playerName,
    seat_index: seatIndex,
    is_host: false,
    is_ai: false,
    is_connected: true,
  })
  if (joinErr) throw new Error(joinErr.message)

  return { room: room as GameRoom, seatIndex }
}

export async function getGameRoom(roomCode: string): Promise<GameRoom | null> {
  const { data } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('room_code', roomCode)
    .single()
  return (data as GameRoom) ?? null
}

export async function getGameRoomPlayers(roomCode: string): Promise<GameRoomPlayer[]> {
  const { data } = await supabase
    .from('game_room_players')
    .select('*')
    .eq('room_code', roomCode)
    .order('seat_index')
  return (data as GameRoomPlayer[]) ?? []
}

export async function updateRoomStatus(roomCode: string, status: string): Promise<void> {
  await supabase
    .from('game_rooms')
    .update({ status })
    .eq('room_code', roomCode)
}

export async function removePlayerFromRoom(roomCode: string, playerName: string): Promise<void> {
  await supabase
    .from('game_room_players')
    .delete()
    .eq('room_code', roomCode)
    .eq('player_name', playerName)
}

export async function addAIToRoom(
  roomCode: string,
  aiName: string,
  seatIndex: number,
): Promise<void> {
  await supabase.from('game_room_players').insert({
    room_code: roomCode,
    player_name: aiName,
    seat_index: seatIndex,
    is_host: false,
    is_ai: true,
    is_connected: true,
  })
}

export async function removeAIFromRoom(roomCode: string, seatIndex: number): Promise<void> {
  await supabase
    .from('game_room_players')
    .delete()
    .eq('room_code', roomCode)
    .eq('seat_index', seatIndex)
    .eq('is_ai', true)
}

export async function saveGameStateSnapshot(
  roomCode: string,
  snapshot: unknown,
): Promise<void> {
  try {
    await supabase
      .from('game_rooms')
      .update({ game_state_snapshot: snapshot })
      .eq('room_code', roomCode)
  } catch {
    // Silent fail — snapshot is for recovery, never break gameplay
  }
}

export async function loadGameStateSnapshot(
  roomCode: string,
): Promise<{ gameState: any; uiPhase: string; currentRound: number } | null> {
  try {
    const room = await getGameRoom(roomCode)
    if (!room?.game_state_snapshot) return null
    return room.game_state_snapshot as { gameState: any; uiPhase: string; currentRound: number }
  } catch {
    return null
  }
}

export async function saveAchievement(playerName: string, achievementId: string): Promise<void> {
  try {
    await supabase.from('player_achievements').upsert(
      { player_name: playerName, achievement_id: achievementId, unlocked_at: new Date().toISOString() },
      { onConflict: 'player_name,achievement_id' }
    )
  } catch {
    // Silent fail — achievements are nice-to-have, never break gameplay
  }
}

export async function getPlayerAchievements(playerName: string): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('player_achievements')
      .select('achievement_id')
      .eq('player_name', playerName)
    return (data ?? []).map(r => r.achievement_id)
  } catch {
    return []
  }
}

export async function updatePlayerConnection(
  roomCode: string,
  playerName: string,
  isConnected: boolean,
): Promise<void> {
  await supabase
    .from('game_room_players')
    .update({ is_connected: isConnected })
    .eq('room_code', roomCode)
    .eq('player_name', playerName)
}
