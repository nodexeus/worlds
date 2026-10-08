// server/crew/boot.mjs
import { loadCrewConfig } from './config.mjs'

/**
 * The process's one crew backend, started the first time anything asks for it.
 *
 * `./index.mjs` is imported only once a database is configured. Without one the server is
 * the read-only monitor, which the desktop app ships, and it must never need the Postgres
 * client to be installed or loaded.
 */
let booted = null

/** @returns {Promise<import('./index.mjs').createCrew extends (...a: any) => Promise<infer C> ? C | null : never>} */
export function bootCrew(env = process.env) {
  booted ??= start(env)
  return booted
}

async function start(env) {
  const config = loadCrewConfig(env)
  if (!config) return null
  const { createCrew } = await import('./index.mjs')
  return createCrew(config)
}

/** Close and forget, so each test can start from nothing. */
export async function resetCrewForTests() {
  const was = booted
  booted = null
  const crew = await was?.catch(() => null)
  await crew?.close()
}
