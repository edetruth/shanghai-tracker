import chalk from 'chalk'
import type { Card, Meld, Player, RoundRequirement } from './types'

function rankToStr(rank: number): string {
  if (rank === 1) return 'A'
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  return String(rank)
}

function suitToStr(suit: string): string {
  switch (suit) {
    case 'hearts': return '\u2665'
    case 'diamonds': return '\u2666'
    case 'clubs': return '\u2663'
    case 'spades': return '\u2660'
    default: return '?'
  }
}

export function cardStr(card: Card): string {
  if (card.suit === 'joker') return chalk.yellow.bold('JKR')
  const rankStr = rankToStr(card.rank)
  const suitStr = suitToStr(card.suit)
  const full = `${rankStr}${suitStr}`
  if (card.suit === 'hearts' || card.suit === 'diamonds') return chalk.red(full)
  return chalk.white(full)
}

export function displayHand(cards: Card[]): void {
  console.log(chalk.bold('\nYour hand:'))
  const cols = 5
  for (let i = 0; i < cards.length; i += cols) {
    const row = cards.slice(i, i + cols)
    const line = row.map((c, j) => {
      const idx = chalk.gray(`[${i + j + 1}]`)
      return `${idx} ${cardStr(c).padEnd(6)}`
    }).join('  ')
    console.log('  ' + line)
  }
  console.log()
}

export function displayDiscard(top: Card | undefined): void {
  if (!top) {
    console.log(chalk.gray('Discard pile: (empty)'))
  } else {
    console.log(`Discard pile top: ${cardStr(top)}`)
  }
}

export function displayTableMelds(melds: Meld[]): void {
  if (melds.length === 0) {
    console.log(chalk.gray('Table: (no melds yet)'))
    return
  }
  console.log(chalk.bold('Table melds:'))
  for (const meld of melds) {
    const meldCards = meld.cards.map(c => {
      if (c.suit === 'joker') {
        const mapping = meld.jokerMappings.find(m => m.cardId === c.id)
        if (mapping) {
          const suit = suitToStr(mapping.representsSuit)
          const rank = rankToStr(mapping.representsRank)
          return chalk.yellow(`JKR(${rank}${suit})`)
        }
        return chalk.yellow('JKR')
      }
      return cardStr(c)
    }).join(' ')
    const typeLabel = meld.type === 'set' ? chalk.cyan('Set') : chalk.magenta('Run')
    console.log(`  #${meld.id} [${typeLabel}] ${chalk.dim(`${meld.ownerName}:`)} ${meldCards}`)
  }
  console.log()
}

export function displayRoundHeader(roundNum: number, req: RoundRequirement, cardsDealt: number): void {
  console.log('\n' + chalk.bgBlue.white.bold(` === ROUND ${roundNum} === `))
  console.log(chalk.cyan(`Requirement: ${req.description}  |  Cards dealt: ${cardsDealt}`))
  console.log()
}

export function displayTurnHeader(player: Player, roundState: { roundNumber: number; requirement: RoundRequirement; drawPile: Card[]; discardPile: Card[] }): void {
  console.log(chalk.green.bold(`\n> ${player.name}'s turn`))
  console.log(chalk.dim(`Round ${roundState.roundNumber} | Req: ${roundState.requirement.description} | Buys left: ${player.buysRemaining} | Draw pile: ${roundState.drawPile.length} cards`))
  if (!player.hasLaidDown) console.log(chalk.yellow('  ! Not yet laid down'))
  else console.log(chalk.green('  * Laid down'))
}

export function displayRoundScores(
  players: Player[],
  results: { playerId: string; score: number; shanghaied: boolean }[],
  roundNum: number
): void {
  console.log('\n' + chalk.bgGreen.black.bold(` --- Round ${roundNum} Results --- `))
  for (const r of results) {
    const p = players.find(pl => pl.id === r.playerId)!
    const name = p.name.padEnd(12)
    const scoreStr = r.score === 0 ? chalk.green.bold('  OUT! (+0)') : chalk.red(`  +${r.score}`)
    const shanghai = r.shanghaied ? chalk.red.bold(' SHANGHAIED!') : ''
    const total = p.roundScores.reduce((a, b) => a + b, 0)
    console.log(`  ${name} ${scoreStr}${shanghai}  (total: ${total})`)
  }
  console.log()
}

export function displayFinalResults(players: Player[]): void {
  console.log('\n' + chalk.bgYellow.black.bold(' ====== GAME OVER ====== '))
  const sorted = [...players].sort((a, b) => {
    const ta = a.roundScores.reduce((x, y) => x + y, 0)
    const tb = b.roundScores.reduce((x, y) => x + y, 0)
    return ta - tb
  })
  sorted.forEach((p, i) => {
    const total = p.roundScores.reduce((a, b) => a + b, 0)
    const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`
    const name = p.name.padEnd(12)
    const scores = p.roundScores.map(s => String(s).padStart(4)).join(' ')
    console.log(`  ${medal} ${name}  Rounds: [${scores} ]  Total: ${chalk.bold(total)}`)
  })
  console.log()
  console.log(chalk.yellow.bold(`WINNER: ${sorted[0].name}!`))
  console.log()
}

export function displayHandoff(playerName: string): void {
  console.clear()
  console.log('\n\n\n')
  console.log(chalk.bgBlue.white.bold(`   Pass the device to ${playerName}   `))
  console.log('\n\n\n')
}

