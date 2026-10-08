// server/crew/config.mjs
import path from 'node:path'

/**
 * Where the crew backend keeps things, read once from the environment.
 *
 * Two places hold everything that has to survive a restart or an image update: a Postgres
 * database and one directory. Nothing else is written anywhere, which is what lets a
 * deployment mount a single persistent volume and point at a single database.
 *
 * With no database configured there is no crew at all: the server is the read-only monitor
 * it has always been, and the desktop app runs it that way.
 *
 * This module imports nothing from the rest of `server/crew/`, so reading the configuration
 * never loads the Postgres client.
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/
const WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{databaseUrl: string, schema: string, dataDir: string, worldId: string,
 *   agentLimit: number, entitled: string[], demoRuntime: boolean} | null}
 */
export function loadCrewConfig(env) {
  const databaseUrl = (env.WORLDS_DATABASE_URL || '').trim()
  if (!databaseUrl) return null
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error('WORLDS_DATABASE_URL must be a postgres:// address')
  }

  const dataDir = (env.WORLDS_DATA_DIR || '').trim()
  if (!dataDir) {
    throw new Error('WORLDS_DATA_DIR must be set when WORLDS_DATABASE_URL is: workspaces need somewhere to live')
  }

  const schema = (env.WORLDS_DATABASE_SCHEMA || '').trim()
  if (schema && !IDENTIFIER.test(schema)) {
    throw new Error('WORLDS_DATABASE_SCHEMA must be lower-case letters, digits and underscores')
  }

  const worldId = (env.WORLDS_WORLD_ID || 'default').trim()
  if (!WORLD_ID.test(worldId)) {
    throw new Error('WORLDS_WORLD_ID must be letters, digits, hyphens and underscores, at most 64')
  }

  const rawLimit = env.WORLDS_AGENT_LIMIT === undefined ? '6' : String(env.WORLDS_AGENT_LIMIT).trim()
  if (!/^\d+$/.test(rawLimit)) {
    throw new Error('WORLDS_AGENT_LIMIT must be a whole number of agents')
  }

  const entitled = (env.WORLDS_CURATED_AGENTS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return {
    databaseUrl,
    schema,
    dataDir: path.resolve(dataDir),
    worldId,
    agentLimit: Number(rawLimit),
    entitled,
    // Agents play a script and no model is called: for showing the interface, and testing it.
    demoRuntime: ['1', 'true'].includes((env.WORLDS_DEMO_RUNTIME || '').trim().toLowerCase()),
  }
}
