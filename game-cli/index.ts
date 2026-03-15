import { runGame } from './src/game'

runGame().catch(err => {
  console.error(err)
  process.exit(1)
})
