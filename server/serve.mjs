import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './http-server.mjs'
import { bootCrew } from './crew/boot.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT) || 5274
const host = process.env.BOT_CROSSING_HOST || '127.0.0.1'

// Started before the port opens: a server that cannot keep its agents and workspaces must
// not look healthy to whatever is watching it.
let crew
try {
  crew = await bootCrew()
} catch (error) {
  console.error(`Nodexeus Worlds cannot start: ${error.message}`)
  process.exit(1)
}

const server = createAppServer({ distDir: path.join(here, '..', 'dist') })

server.listen(port, host, () => {
  console.log(`Nodexeus Worlds → http://${host}:${port}`)
  console.log(crew ? `Crew backend ready for world "${crew.worldId}"` : 'No database configured: running as a monitor only')
})
