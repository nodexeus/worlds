// test/support/crew-talk.mjs
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadCatalog } from '../../server/crew/catalog.mjs'
import { createConversations } from '../../server/crew/conversations.mjs'
import { CrewError } from '../../server/crew/errors.mjs'
import { createEvents } from '../../server/crew/events.mjs'
import { createHub } from '../../server/crew/hub.mjs'
import { createRoster } from '../../server/crew/roster.mjs'
import { createScriptedRuntime } from '../../server/crew/runtimes/scripted.mjs'
import { createSettings } from '../../server/crew/settings.mjs'
import { createWorkspaces } from '../../server/crew/workspaces.mjs'
import { withDb } from './crew-db.mjs'

/**
 * A whole crew backend for a test, on a schema and a data directory of its own, whose agents
 * all run on the scripted runtime. An agent on `openclaw` has no runtime, as on a real
 * server today.
 *
 * `run` is given the crew (as `createCrew` would make it, plus the scripted runtime, a list
 * of everything the hub sent, and a switch that makes writing events fail) and two helpers:
 * `shape` reduces events to what a test compares, `record` reads a conversation that way.
 */
export const withTalk = (run, { scripts = {}, worldId = 'w', retryDelays = [20, 40], limit = 6, entitled = [] } = {}) =>
  withDb(async (sql) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-talk-'))
    const catalog = await loadCatalog()
    const scripted = createScriptedRuntime(scripts)
    const hub = createHub({ log() {} })
    const sent = []
    hub.subscribe((kind, payload) => sent.push([kind, payload]))
    const stored = createEvents({ sql, worldId, hub })
    const store = { failing: false }
    const events = {
      ...stored,
      append: (event) => (store.failing ? Promise.reject(new Error('the database is away')) : stored.append(event)),
    }
    const roster = createRoster({ sql, worldId, catalog, limit, entitled, rand: () => 0 })
    const workspaces = createWorkspaces({ sql, worldId, dataDir, clone: async () => {} })
    const settings = createSettings({ sql, worldId })
    const runtimes = {
      get(id) {
        if (id === 'openclaw') throw new CrewError('runtime_unavailable', 'This server cannot run agents on "openclaw" yet', 501)
        return scripted
      },
    }
    const logged = []
    const conversations = createConversations({
      sql, worldId, roster, workspaces, settings, runtimes, events, hub, retryDelays, log: (...args) => logged.push(args),
    })
    const crew = { worldId, sql, catalog, roster, workspaces, settings, hub, events, conversations, scripted, sent, store, logged, dataDir }
    try {
      return await run(crew)
    } finally {
      await conversations.close()
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })

/** An event as a test compares it: its type, the status it left, and what it carried. */
export const shape = (event) => [event.type, event.status, event.data]

/** A conversation's whole record, shaped. */
export const record = async (crew, conversationId) => (await crew.events.page(conversationId, { limit: 500 })).map(shape)

export const refused = (code) => (error) => error instanceof CrewError && error.code === code

/**
 * Read a server-sent event stream until told to stop. `items` fills with what arrives, as
 * `{ id, event, data }` (a comment line arrives as `{ comment }`); `until(n)` resolves once
 * there are `n` of them, not counting comments.
 */
export async function listen(url, headers = {}) {
  const control = new AbortController()
  const res = await fetch(url, { headers, signal: control.signal })
  const items = []
  const comments = []
  let wake = () => {}
  const reading = (async () => {
    if (!res.ok || !res.body) return
    let pending = ''
    try {
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        pending += chunk
        let cut
        while ((cut = pending.indexOf('\n\n')) !== -1) {
          const block = pending.slice(0, cut)
          pending = pending.slice(cut + 2)
          const item = {}
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) comments.push(line.slice(1).trim())
            else {
              const colon = line.indexOf(':')
              item[line.slice(0, colon)] = line.slice(colon + 1).trimStart()
            }
          }
          if (item.event) items.push({ id: item.id === undefined ? null : Number(item.id), event: item.event, data: JSON.parse(item.data) })
          wake()
        }
      }
    } catch {
      // Closed, by the test or by the server: either way there is no more to read.
    }
    wake()
  })()
  const until = async (count, ms = 3000) => {
    const deadline = Date.now() + ms
    while (items.length < count) {
      if (Date.now() > deadline) throw new Error(`the stream gave ${items.length} of ${count}: ${JSON.stringify(items.map((item) => item.event))}`)
      await new Promise((resolve) => {
        wake = resolve
        setTimeout(resolve, 25)
      })
    }
    return items
  }
  return { res, items, comments, until, ended: reading, close: () => control.abort() }
}
