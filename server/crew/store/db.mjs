// server/crew/store/db.mjs
import postgres from 'postgres'

/**
 * Open a pool on the crew database.
 *
 * `schema` puts every unqualified table name in that schema, which is how one Postgres can
 * hold several worlds' tables apart and how each test gets tables of its own.
 *
 * Column names are camel-cased on the way out (`template_id` is read as `templateId`). SQL
 * text is written in snake case as usual.
 *
 * @param {string} databaseUrl
 * @param {{schema?: string, max?: number}} [options]
 */
export function connect(databaseUrl, { schema = '', max = 10 } = {}) {
  return postgres(databaseUrl, {
    max,
    onnotice() {},
    connect_timeout: 5,
    transform: postgres.camel,
    connection: schema ? { search_path: schema } : {},
  })
}

/** Postgres refused a row because it would break a unique rule, optionally a named one. */
export function isUniqueViolation(error, constraint) {
  if (!error || error.code !== '23505') return false
  return constraint ? error.constraint_name === constraint : true
}

const UNREACHABLE = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  // The server is there and is not taking connections: starting up, shutting down, full.
  '57P01', '57P02', '57P03', '53300',
])

/** The database could not be reached at all, as opposed to answering with an error. */
export function isUnavailable(error) {
  if (!error) return false
  if (UNREACHABLE.has(error.code)) return true
  return Array.isArray(error.errors) && error.errors.some((inner) => UNREACHABLE.has(inner?.code))
}
