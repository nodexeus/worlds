import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/http-server.mjs'
import { summarizeSessions } from './status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const token = process.env.BOT_CROSSING_DESKTOP_TOKEN
if (!token || !process.parentPort) throw new Error('The desktop scanner must be started by Bot Crossing')
const server = createAppServer({ distDir: path.join(root, 'dist'), token })
let timer
let polling = false

/** Poll the real API so tray status stays current while the renderer is hidden.
 * @param {string} origin
 * @returns {Promise<void>}
 */
async function poll(origin) {
  if (polling) return
  polling = true
  try {
    const responses = await Promise.all(['/api/threads', '/api/state'].map(route => fetch(`${origin}${route}`, {
      headers: { 'X-Bot-Crossing-Token': token }, signal: AbortSignal.timeout(12000),
    })))
    for (const response of responses) if (!response.ok) throw new Error(`Scanner HTTP ${response.status}`)
    const [{ threads, warnings }, state] = await Promise.all(responses.map(response => response.json()))
    process.parentPort.postMessage({
      type: 'status', ...summarizeSessions(threads, state),
      warning: warnings?.join('\n') || '',
    })
  } catch (error) {
    process.parentPort.postMessage({ type: 'status', error: error.message })
  } finally { polling = false }
}

server.on('error', error => { console.error(error.message); process.exit(1) })
server.listen(0, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`
  process.parentPort.postMessage({ type: 'ready', origin })
  void poll(origin)
  timer = setInterval(() => void poll(origin), 15000)
})

process.on('SIGTERM', () => {
  clearInterval(timer)
  server.close(() => process.exit(0))
  server.closeAllConnections()
})
