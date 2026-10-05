import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './http-server.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT) || 5274
const host = process.env.BOT_CROSSING_HOST || '127.0.0.1'
const server = createAppServer({ distDir: path.join(here, '..', 'dist') })

server.listen(port, host, () => {
  console.log(`Bot Crossing → http://${host}:${port}`)
})
