import { supabase } from './supabase'
import { createGameRoom } from './gameStore'
import type { GameRoomConfig } from '../game/multiplayer-types'

export interface Tournament {
  id: string
  code: string
  host_name: string
  player_count: number
  format: string
  status: 'waiting' | 'in_progress' | 'finished'
  created_at: string
}

export interface TournamentMatch {
  id: string
  tournament_id: string
  round_number: number
  match_index: number
  player_names: string[]
  winner_name: string | null
  room_code: string | null
  status: 'pending' | 'in_progress' | 'finished'
}

function generateTournamentCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let code = 'TRNY-'
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function createTournament(hostName: string, playerCount: number): Promise<{ code: string } | null> {
  const code = generateTournamentCode()
  try {
    const { error } = await supabase.from('tournaments').insert({
      code,
      host_name: hostName,
      player_count: playerCount,
      format: 'single-elimination',
      status: 'waiting',
    })
    if (error) return null
    return { code }
  } catch {
    return null
  }
}

export async function getTournament(code: string): Promise<Tournament | null> {
  try {
    const { data } = await supabase.from('tournaments').select('*').eq('code', code).single()
    return data as Tournament ?? null
  } catch {
    return null
  }
}

export async function getTournamentMatches(tournamentId: string): Promise<TournamentMatch[]> {
  try {
    const { data } = await supabase
      .from('tournament_matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('round_number')
      .order('match_index')
    return (data as TournamentMatch[]) ?? []
  } catch {
    return []
  }
}

export async function generateBracket(tournamentId: string, playerNames: string[]): Promise<TournamentMatch[]> {
  // Shuffle players randomly
  const shuffled = [...playerNames].sort(() => Math.random() - 0.5)
  const matches: Omit<TournamentMatch, 'id'>[] = []

  // Round 1: pair players
  const matchCount = shuffled.length / 2
  for (let i = 0; i < matchCount; i++) {
    matches.push({
      tournament_id: tournamentId,
      round_number: 1,
      match_index: i,
      player_names: [shuffled[i * 2], shuffled[i * 2 + 1]],
      winner_name: null,
      room_code: null,
      status: 'pending',
    })
  }

  // Generate empty slots for subsequent rounds
  const totalRounds = Math.log2(shuffled.length)
  let prevMatchCount = matchCount
  for (let round = 2; round <= totalRounds; round++) {
    const roundMatches = prevMatchCount / 2
    for (let i = 0; i < roundMatches; i++) {
      matches.push({
        tournament_id: tournamentId,
        round_number: round,
        match_index: i,
        player_names: [],
        winner_name: null,
        room_code: null,
        status: 'pending',
      })
    }
    prevMatchCount = roundMatches
  }

  try {
    const { data } = await supabase.from('tournament_matches').insert(matches).select()
    return (data as TournamentMatch[]) ?? []
  } catch {
    return []
  }
}

export async function updateTournamentStatus(code: string, status: string): Promise<void> {
  try {
    await supabase.from('tournaments').update({ status }).eq('code', code)
  } catch { /* fire-and-forget */ }
}

export async function reportMatchResult(matchId: string, winnerName: string): Promise<void> {
  try {
    await supabase.from('tournament_matches')
      .update({ winner_name: winnerName, status: 'finished' })
      .eq('id', matchId)
  } catch { /* fire-and-forget */ }
}

export async function advanceWinner(
  tournamentId: string,
  fromRound: number,
  fromMatchIndex: number,
  winnerName: string,
): Promise<void> {
  // Winner goes to next round, match_index = floor(fromMatchIndex / 2)
  const nextRound = fromRound + 1
  const nextMatchIndex = Math.floor(fromMatchIndex / 2)
  try {
    const { data } = await supabase.from('tournament_matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('round_number', nextRound)
      .eq('match_index', nextMatchIndex)
      .single()

    if (data) {
      const existing = data as TournamentMatch
      const updatedPlayers = [...existing.player_names, winnerName]
      await supabase.from('tournament_matches')
        .update({ player_names: updatedPlayers })
        .eq('id', existing.id)
    }
  } catch { /* fire-and-forget */ }
}

export async function setMatchRoomCode(matchId: string, roomCode: string): Promise<void> {
  try {
    await supabase.from('tournament_matches')
      .update({ room_code: roomCode, status: 'in_progress' })
      .eq('id', matchId)
  } catch { /* fire-and-forget */ }
}

/**
 * Create a game room for a tournament match and store the room code on the match.
 * Returns the room code on success, null on failure.
 */
export async function createMatchRoom(
  matchId: string,
  hostName: string,
  playerCount: number,
): Promise<string | null> {
  try {
    const config: GameRoomConfig = {
      playerCount,
      buyLimit: 5,
      seats: [],
    }
    const room = await createGameRoom(hostName, config)
    if (!room) return null
    await setMatchRoomCode(matchId, room.room_code)
    return room.room_code
  } catch {
    return null
  }
}
