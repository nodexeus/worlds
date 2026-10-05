// Run with Electron, not node:test: exercises its real bundled Node utility process.
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { startBackend } from '../desktop/backend.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(path.join(os.tmpdir(), 'bot-electron-test-'))
const configDir = path.join(temp, 'claude')
const project = path.join(configDir, 'projects', '-tmp-demo')
const id = '11111111-2222-4333-8444-555555555555'
const transcript = path.join(project, `${id}.jsonl`)
let backend

app.setPath('userData', path.join(temp, 'electron'))
process.env.HOME = temp
process.env.CLAUDE_CONFIG_DIR = configDir
process.env.CODEX_HOME = path.join(temp, 'codex')
process.env.BOT_CROSSING_CLAUDE_DESKTOP = path.join(temp, 'no-desktop')

/** Run against Electron's real utility process without opening a window.
 * @returns {Promise<void>}
 */
async function run() {
try {
  await fs.mkdir(project, { recursive: true })
  await fs.mkdir(path.join(configDir, 'sessions'), { recursive: true })
  await fs.writeFile(path.join(configDir, 'sessions', 'live.json'), JSON.stringify({ sessionId: id, pid: process.pid }))
  const user = { type: 'user', cwd: '/tmp/demo', message: { content: 'Build' } }
  const tool = { type: 'assistant', message: { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' } }
  await fs.writeFile(transcript, [user, tool].map(r => JSON.stringify(r)).join('\n') + '\n')
  backend = await startBackend({
    root, userData: path.join(temp, 'data'), onStatus: () => {},
    onFailure: error => { console.error(error); app.exit(1) }, log: message => process.stderr.write(message),
  })
  const headers = { 'X-Bot-Crossing-Token': backend.token, Origin: backend.origin, 'Content-Type': 'application/json' }
  assert.equal((await fetch(`${backend.origin}/api/threads`)).status, 403)
  const scan = async () => (await (await fetch(`${backend.origin}/api/threads`, { headers })).json()).threads
  const working = (await scan()).find(t => t.id === `claude-code:${id}`)
  assert.equal(working.running, true, 'bundled native scanner sees the real host PID')
  await fs.appendFile(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' } }) + '\n')
  const waiting = (await scan()).find(t => t.id === working.id)
  assert.equal(waiting.running, false)
  assert.equal(waiting.unread, true)
  assert.equal(waiting.needsAttention, false, 'a completed reply is not a request for help')
  await fs.appendFile(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Which branch should I use?' }], stop_reason: 'end_turn' } }) + '\n')
  const question = (await scan()).find(t => t.id === working.id)
  assert.equal(question.running, false)
  assert.equal(question.needsAttention, true, 'a direct question needs user input')
  const saved = await fetch(`${backend.origin}/api/state`, { method: 'PUT', headers, body: JSON.stringify({ settings: { planet: 'mars' }, archived: [], baseUpdatedAt: 0 }) })
  assert.equal(saved.status, 200)
  assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'data', 'colony.json'), 'utf8')).settings.planet, 'mars')
  const origin = backend.origin
  backend.stop()
  backend = null
  let closed = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(25)
    try { await fetch(origin) } catch { closed = true; break }
  }
  assert.equal(closed, true, 'worker exit closes its HTTP listener')
  console.log(`Electron ${process.versions.electron} / Node ${process.versions.node}: native PID activity, waiting state, token isolation, persistence, and worker shutdown PASS`)
  await fs.rm(temp, { recursive: true, force: true })
  app.quit()
} catch (error) {
  backend?.stop()
  console.error(error)
  await fs.rm(temp, { recursive: true, force: true })
  app.exit(1)
}
}

app.whenReady().then(run)
