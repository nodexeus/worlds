// server/crew/index.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { connect } from './store/db.mjs'
import { migrate } from './store/migrate.mjs'
import { loadCatalog } from './catalog.mjs'
import { createRoster } from './roster.mjs'
import { createWorkspaces } from './workspaces.mjs'
import { createSettings } from './settings.mjs'
import { createHub } from './hub.mjs'
import { createEvents } from './events.mjs'
import { createConversations } from './conversations.mjs'
import { createRuntimes } from './runtimes/index.mjs'

/**
 * Prove the data directory can be written by writing to it. Asking the filesystem whether
 * a write would work is not the same thing: a read-only mount and a full volume both say yes.
 */
async function checkDataDir(dataDir) {
  const probe = path.join(dataDir, `.write-check-${randomUUID()}`)
  try {
    await fs.mkdir(path.join(dataDir, 'workspaces'), { recursive: true })
    await fs.writeFile(probe, '')
    await fs.rm(probe, { force: true })
  } catch (error) {
    throw new Error(
      `WORLDS_DATA_DIR (${dataDir}) cannot be written to: ${error.message}. ` +
        'Workspaces would be lost on restart, so the server will not start.'
    )
  }
}

/**
 * Bring a world's crew backend up: check both places it keeps things, bring the schema up to
 * date, and wire the parts together.
 *
 * It refuses to start if either place is not usable. A server that started anyway would
 * accept work it could not keep.
 *
 * @param {{databaseUrl: string, schema: string, dataDir: string, worldId: string,
 *   agentLimit: number, entitled: string[]}} config
 * @param {{runtimes?: {get: (id: string) => any}}} [parts] what runs the agents, when it is
 *   not the runtimes this server has: a test's own.
 */
export async function createCrew(config, { runtimes = createRuntimes() } = {}) {
  const catalog = await loadCatalog()
  const missing = config.entitled.filter((id) => !catalog.byId.has(id))
  if (missing.length) {
    throw new Error(`WORLDS_CURATED_AGENTS names specialists this server does not have: ${missing.join(', ')}`)
  }

  await checkDataDir(config.dataDir)

  const sql = connect(config.databaseUrl, { schema: config.schema })
  try {
    if (config.schema) await sql.unsafe(`create schema if not exists "${config.schema}"`)
    await migrate(sql)
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {})
    throw new Error(`WORLDS_DATABASE_URL could not be used: ${error.message || error.code || error}`)
  }

  const workspaces = createWorkspaces({ sql, worldId: config.worldId, dataDir: config.dataDir })
  await workspaces.sweep()

  const roster = createRoster({
    sql,
    worldId: config.worldId,
    catalog,
    limit: config.agentLimit,
    entitled: config.entitled,
  })
  const retired = await roster.reconcile()
  if (retired.length) console.log(`Crew: retired specialists this world no longer has: ${retired.join(', ')}`)

  const settings = createSettings({ sql, worldId: config.worldId })
  const hub = createHub()
  const events = createEvents({ sql, worldId: config.worldId, hub })
  const conversations = createConversations({
    sql, worldId: config.worldId, roster, workspaces, settings, runtimes, events, hub,
  })
  // A server that stopped took its agents' turns with it. Nothing must wait on one of those.
  const lost = await conversations.recover()
  if (lost) console.log(`Crew: ${lost} ${lost === 1 ? 'conversation was' : 'conversations were'} interrupted by the last stop`)

  return {
    worldId: config.worldId,
    catalog,
    roster,
    workspaces,
    settings,
    hub,
    events,
    conversations,
    runtimes,
    /** Stop every agent, finish writing the record, and only then let the database go. */
    async close() {
      await conversations.close()
      await sql.end({ timeout: 5 })
    },
  }
}
