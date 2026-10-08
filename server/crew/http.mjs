// server/crew/http.mjs
import { CrewError } from './errors.mjs'
import { readJsonBody, send } from '../lib/json-http.mjs'
import { serveEvents } from './stream.mjs'

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
    parsed = await readJsonBody(req, 128 * 1024)
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

const notFound = () => new CrewError('not_found', 'Unknown endpoint', 404)

/** A whole number from the query string, within bounds, or a refusal. Absent is `undefined`. */
function whole(url, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = url.searchParams.get(name)
  if (raw === null) return undefined
  const value = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN
  if (!(value >= min && value <= max)) {
    throw new CrewError('bad_query', `${name} is a whole number from ${min} to ${max}`, 400)
  }
  return value
}

/** An agent as the page sees it: who it is, how it is doing, and where. */
const placed = (agent, statuses) => {
  const at = statuses.get(agent.id)
  return { ...agent, status: at?.status ?? 'idle', conversationId: at?.conversationId ?? null, workspaceId: at?.workspaceId ?? null }
}

/** Work out the answer to one request: `[status, body]`, or a thrown refusal. */
async function route(req, url, crew) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3)
  const [collection, id, extra, more] = parts
  const { method } = req

  if (!collection) {
    if (method !== 'GET') throw notAllowed()
    if (!crew) return reply(200, { enabled: false })
    return reply(200, {
      enabled: true,
      worldId: crew.worldId,
      // Agents play a script and no model is called. The page says so.
      demo: Boolean(crew.demo),
      // An agent may be bound to a runtime this server has no adapter for yet.
      runtimes: crew.runtimes.available(),
      counts: await crew.roster.counts(),
    })
  }
  if (!crew) {
    throw new CrewError('crew_disabled', 'This server is a monitor only: no crew backend is configured', 404)
  }
  if (more !== undefined) throw notFound()

  if (collection === 'agents') {
    const { roster, conversations } = crew
    if (extra === 'messages') {
      if (method !== 'POST') throw notAllowed()
      const { text, workspaceId } = await body(req)
      return reply(202, await conversations.send(id, { text, workspaceId }))
    }
    if (extra === 'stop') {
      if (method !== 'POST') throw notAllowed()
      return reply(200, await conversations.stop(id))
    }
    if (extra === 'conversations') {
      if (method !== 'GET') throw notAllowed()
      return reply(200, { conversations: await conversations.list(id) })
    }
    if (extra !== undefined) throw notFound()
    if (id === undefined) {
      if (method === 'GET') {
        // Read first, so the statuses are never behind it: a page that has since heard
        // something newer on the stream knows to keep that.
        const seq = await crew.events.head()
        const [agents, counts, statuses] = await Promise.all([roster.list(), roster.counts(), conversations.statuses()])
        return reply(200, { agents: agents.map((agent) => placed(agent, statuses)), counts, seq })
      }
      if (method === 'POST') {
        const input = await body(req)
        const agent = 'templateId' in input ? await roster.createCurated(input.templateId) : await roster.create(input)
        return reply(201, { agent: placed(agent, new Map()) })
      }
      throw notAllowed()
    }
    if (method === 'PATCH') {
      const { name, role } = await body(req)
      const agent = await roster.update(id, { name, role })
      return reply(200, { agent: placed(agent, await conversations.statuses()) })
    }
    if (method === 'DELETE') {
      await roster.retire(id)
      // Retired first, so nothing new can be asked of it while it is being stopped.
      await conversations.dismiss(id)
      return reply(200, { ok: true })
    }
    throw notAllowed()
  }

  if (collection === 'conversations') {
    const { conversations, events } = crew
    if (id === undefined) throw notFound()
    if (extra === undefined) {
      if (method !== 'GET') throw notAllowed()
      return reply(200, { conversation: await conversations.get(id) })
    }
    if (extra === 'events') {
      if (method !== 'GET') throw notAllowed()
      const after = whole(url, 'after')
      const before = whole(url, 'before')
      const limit = whole(url, 'limit', { min: 1, max: 500 })
      if (after !== undefined && before !== undefined) {
        throw new CrewError('bad_query', 'Give after or before, not both', 400)
      }
      const conversation = await conversations.get(id)
      return reply(200, { events: await events.page(conversation.id, { after, before, limit }) })
    }
    if (extra === 'answers') {
      if (method !== 'POST') throw notAllowed()
      return reply(200, await conversations.answer(id, await body(req)))
    }
    throw notFound()
  }

  if (collection === 'settings') {
    if (id !== undefined) throw notFound()
    if (method === 'GET') return reply(200, { settings: await crew.settings.get() })
    if (method === 'PATCH') {
      const { autonomy, channelLimit } = await body(req)
      return reply(200, { settings: await crew.settings.update({ autonomy, channelLimit }) })
    }
    throw notAllowed()
  }

  if (extra !== undefined) throw notFound()

  if (collection === 'specialists') {
    if (id !== undefined) throw notFound()
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

  throw notFound()
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
 * @param {{deadlineMs?: number, cloneDeadlineMs?: number, stream?: object}} [options]
 *   `stream` is passed to the live stream: see `stream.mjs`.
 */
export async function handleCrew(req, res, url, crew, {
  deadlineMs = DEADLINE, cloneDeadlineMs = CLONE_DEADLINE, stream = {},
} = {}) {
  const refuse = (error) => {
    if (res.headersSent) return res.destroy()
    if (error instanceof CrewError) return send(res, error.status, { error: error.message, code: error.code })
    if (unavailable(error)) {
      return send(res, 503, { error: 'The database cannot be reached right now. Nothing was changed.', code: 'store_unavailable' })
    }
    console.error('crew:', error)
    return send(res, 500, { error: 'Something went wrong on the server', code: 'fault' })
  }

  // The stream is the one reply that is meant to go on: it has no deadline.
  if (crew && /^\/api\/crew\/events\/?$/.test(url.pathname)) {
    try {
      if (req.method !== 'GET') throw notAllowed()
      return await serveEvents(req, res, url, crew, stream)
    } catch (error) {
      return refuse(error)
    }
  }

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
    return refuse(error)
  } finally {
    clearTimeout(timer)
  }
}
