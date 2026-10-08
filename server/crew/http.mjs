// server/crew/http.mjs
import { CrewError } from './errors.mjs'
import { readJsonBody, send } from '../lib/json-http.mjs'

/**
 * A database error, without loading the Postgres client to recognise one: this file is
 * imported by the monitor-only server too. Kept in step with `isUnavailable` in
 * `store/db.mjs`, which a test holds it to.
 */
const UNREACHABLE = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  '57P01', '57P02', '57P03', '53300',
  // Cancelled for taking too long: see `statementTimeout`.
  '57014',
])
const unavailable = (error) =>
  Boolean(error) &&
  (UNREACHABLE.has(error.code) || (Array.isArray(error.errors) && error.errors.some((inner) => UNREACHABLE.has(inner?.code))))

/** The page is told what a workspace is, not where on the server's disk it lives. */
const publicWorkspace = ({ folder, ...rest }) => rest

/** A JSON object body, or a refusal: a list or a bare value is not a request. */
async function body(req) {
  let parsed
  try {
    parsed = await readJsonBody(req, 64 * 1024)
  } catch {
    throw new CrewError('bad_json', 'The request body must be a JSON object', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CrewError('bad_json', 'The request body must be a JSON object', 400)
  }
  return parsed
}

const notAllowed = () => new CrewError('method_not_allowed', 'That is not something this address does', 405)

const reply = (status, body) => [status, body]

/** Reads and small writes. A stalled database should be noticed in seconds, not minutes. */
const DEADLINE = 15_000
/** Making a workspace may clone a repository, which is given two minutes of its own. */
const CLONE_DEADLINE = 150_000
const LATE = Symbol('late')

/** Work out the answer to one request: `[status, body]`, or a thrown refusal. */
async function route(req, url, crew) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3)
  const [collection, id, extra] = parts
  const { method } = req

  if (!collection) {
    if (method !== 'GET') throw notAllowed()
    if (!crew) return reply(200, { enabled: false })
    return reply(200, { enabled: true, worldId: crew.worldId, counts: await crew.roster.counts() })
  }
  if (!crew) {
    throw new CrewError('crew_disabled', 'This server is a monitor only: no crew backend is configured', 404)
  }
  if (extra !== undefined) throw new CrewError('not_found', 'Unknown endpoint', 404)

  if (collection === 'agents') {
    const { roster } = crew
    if (id === undefined) {
      if (method === 'GET') return reply(200, { agents: await roster.list(), counts: await roster.counts() })
      if (method === 'POST') {
        const input = await body(req)
        const agent = 'templateId' in input ? await roster.createCurated(input.templateId) : await roster.create(input)
        return reply(201, { agent })
      }
      throw notAllowed()
    }
    if (method === 'PATCH') {
      const { name, role } = await body(req)
      return reply(200, { agent: await roster.update(id, { name, role }) })
    }
    if (method === 'DELETE') {
      await roster.retire(id)
      return reply(200, { ok: true })
    }
    throw notAllowed()
  }

  if (collection === 'specialists') {
    if (id !== undefined) throw new CrewError('not_found', 'Unknown endpoint', 404)
    if (method !== 'GET') throw notAllowed()
    return reply(200, { specialists: await crew.roster.specialists() })
  }

  if (collection === 'workspaces') {
    const { workspaces } = crew
    if (id === undefined) {
      if (method === 'GET') return reply(200, { workspaces: (await workspaces.list()).map(publicWorkspace) })
      if (method === 'POST') {
        const { name, description, gitUrl } = await body(req)
        return reply(201, { workspace: publicWorkspace(await workspaces.create({ name, description, gitUrl })) })
      }
      throw notAllowed()
    }
    if (method === 'PATCH') {
      const { name, description } = await body(req)
      return reply(200, { workspace: publicWorkspace(await workspaces.update(id, { name, description })) })
    }
    if (method === 'DELETE') {
      await workspaces.archive(id)
      return reply(200, { ok: true })
    }
    throw notAllowed()
  }

  throw new CrewError('not_found', 'Unknown endpoint', 404)
}

/**
 * Everything under `/api/crew`.
 *
 * `crew` is null on a server with no database: the monitor. It still answers `GET /api/crew`
 * so the page can ask what it is talking to, and says plainly that the rest is switched off.
 *
 * Every request has a deadline. A database that is connected and has stopped answering
 * never errors, it just never replies, and without this the page would wait on it for ever.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {any | null} crew
 * @param {{deadlineMs?: number, cloneDeadlineMs?: number}} [options]
 */
export async function handleCrew(req, res, url, crew, { deadlineMs = DEADLINE, cloneDeadlineMs = CLONE_DEADLINE } = {}) {
  const cloning = req.method === 'POST' && /\/workspaces\/?$/.test(url.pathname)
  let timer
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(LATE), cloning ? cloneDeadlineMs : deadlineMs)
  })
  try {
    const work = route(req, url, crew)
    // If the deadline wins, the work may still fail later, with nobody left to tell.
    work.catch(() => {})
    const answer = await Promise.race([work, late])
    if (answer === LATE) {
      const changed = req.method === 'GET' ? '' : ' The change may or may not have been made: look before trying again.'
      return send(res, 503, { error: `The database did not answer in time.${changed}`, code: 'store_timeout' })
    }
    return send(res, ...answer)
  } catch (error) {
    if (error instanceof CrewError) return send(res, error.status, { error: error.message, code: error.code })
    if (unavailable(error)) {
      return send(res, 503, { error: 'The database cannot be reached right now. Nothing was changed.', code: 'store_unavailable' })
    }
    console.error('crew:', error)
    return send(res, 500, { error: 'Something went wrong on the server', code: 'fault' })
  } finally {
    clearTimeout(timer)
  }
}
