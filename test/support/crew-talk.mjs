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
export const withTalk = (run, { scripts = {}, worldId = 'w', retryDelays = [20, 40] } = {}) =>
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
    const roster = createRoster({ sql, worldId, catalog, limit: 6, entitled: [], rand: () => 0 })
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
