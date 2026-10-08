// server/crew/conversations.mjs
import { setTimeout as wait } from 'node:timers/promises'
import { briefing } from './briefing.mjs'
import { CrewError } from './errors.mjs'
import { isUniqueViolation } from './store/db.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Plenty for a message typed or pasted into a chat box. */
const TEXT_LIMIT = 20_000
const TITLE_LIMIT = 80

const unknownAgent = () => new CrewError('unknown_agent', 'There is no such agent in this world', 404)
const unknownConversation = () => new CrewError('unknown_conversation', 'There is no such conversation in this world', 404)
const unknownRequest = () => new CrewError('unknown_request', 'Nothing is waiting for that answer', 409)
const needsWorkspace = (name) =>
  new CrewError('needs_workspace', `${name} is not working anywhere. Choose a workspace for this`, 409)

/** A turn is under way in these two. In the other two an agent takes a message at once. */
const BUSY = ['working', 'waiting']

/**
 * A world's conversations: the one part of the server that talks to a runtime.
 *
 * A conversation is one agent working in one workspace. A person's message becomes a turn on
 * the agent's runtime, and everything the runtime says back is stored as events, each
 * carrying the agent's status after it. That status is the only status there is: nothing
 * sets it by hand.
 *
 * Everything that concerns one agent happens in one line, in the order it arrived: a
 * message, an answer, a stop, and each thing its runtime says. So a message that arrives as
 * a turn is ending is either seen by that ending or finds the agent free, and can never
 * fall between the two.
 *
 * That line is in this process's memory. One server runs a world.
 *
 * @param {{sql: any, worldId: string, roster: any, workspaces: any, settings: any,
 *   runtimes: {get: (id: string) => any}, events: any, hub: any,
 *   retryDelays?: number[], log?: (...args: any[]) => void}} options
 */
export function createConversations({
  sql, worldId, roster, workspaces, settings, runtimes, events, hub,
  retryDelays = [100, 400], log = console.error,
}) {
  /**
   * The turn each agent has under way.
   * @type {Map<string, {conversation: any, turn: any, open: Set<string>, broken: boolean,
   *   over: Promise<void>, finish: () => void}>}
   */
  const running = new Map()
  /** The tail of each agent's line. */
  const lines = new Map()

  /** Do `step` after everything already asked of this agent, whatever became of it. */
  function inLine(agentId, step) {
    const result = (lines.get(agentId) ?? Promise.resolve()).then(step)
    const tail = result.catch(() => {})
    lines.set(agentId, tail)
    tail.then(() => {
      if (lines.get(agentId) === tail) lines.delete(agentId)
    })
    return result
  }

  const present = (row) => ({
    id: row.id,
    agentId: row.agentId,
    workspaceId: row.workspaceId,
    kind: row.kind,
    title: row.title,
    status: row.status ?? 'idle',
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  })

  /** A conversation's rows, each with the status its last event left. */
  const select = (where) => sql`
    select c.id, c.agent_id, c.workspace_id, c.kind, c.title, c.handle, c.created_at, c.closed_at,
      (select e.status from events e
        where e.world_id = c.world_id and e.conversation_id = c.id
        order by e.seq desc limit 1) as status
    from conversations c
    where c.world_id = ${worldId} and ${where}`

  const openTask = sql`c.kind = 'task' and c.closed_at is null`

  async function openOf(agentId) {
    const [row] = await select(sql`c.agent_id = ${agentId} and ${openTask}`)
    return row ?? null
  }

  const record = (conversation, type, status, data = {}) =>
    events.append({ conversationId: conversation.id, agentId: conversation.agentId, type, status, data })

  /**
   * Record something a turn did, trying again if the database is briefly away. A turn that
   * cannot be recorded at all is not worth running, so the caller stops it.
   */
  async function keep(conversation, type, status, data) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await record(conversation, type, status, data)
      } catch (error) {
        if (attempt >= retryDelays.length) throw error
        await wait(retryDelays[attempt])
      }
    }
  }

  /** The messages still waiting their turn in a conversation, oldest first. */
  async function queued(conversation) {
    const rows = await sql`
      select e.seq, e.data->>'text' as text
      from events e
      where e.world_id = ${worldId} and e.conversation_id = ${conversation.id}
        and e.type = 'message' and e.data->>'queued' = 'true'
        and not exists (
          select 1 from events q
          where q.world_id = e.world_id and q.conversation_id = e.conversation_id
            and q.type = 'queue' and q.data->'of' @> to_jsonb(e.seq))
      order by e.seq`
    return rows.map((row) => ({ seq: Number(row.seq), text: row.text }))
  }

  async function cancelQueued(conversation, status) {
    const waiting = await queued(conversation)
    if (waiting.length) await record(conversation, 'queue', status, { of: waiting.map((m) => m.seq), outcome: 'cancelled' })
  }

  /**
   * A conversation the record says is busy, with no turn behind it: the server stopped, or
   * the record could not be written when the turn ended. Say so in the record, so the agent
   * is free again.
   */
  async function settleStale(conversation, reason = 'lost') {
    if (!BUSY.includes(conversation.status) || running.has(conversation.agentId)) return conversation
    await record(conversation, 'interrupted', 'idle', { reason })
    await cancelQueued(conversation, 'idle')
    return { ...conversation, status: 'idle' }
  }

  /** The workspace a conversation is in, if it is still there. */
  async function placeOf(conversation, agent) {
    try {
      return await workspaces.get(conversation.workspaceId)
    } catch (error) {
      if (error instanceof CrewError && error.code === 'unknown_workspace') throw needsWorkspace(agent.name)
      throw error
    }
  }

  const titleOf = (text) => {
    const first = text.trim().split('\n')[0].replace(/\s+/g, ' ').trim()
    return first.length > TITLE_LIMIT ? `${first.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : first
  }

  /** Close the agent's open conversation, if any, and open a new one in `workspace`. */
  async function openIn(agent, workspace, text, previous) {
    try {
      return await sql.begin(async (tx) => {
        if (previous) await tx`update conversations set closed_at = now() where id = ${previous.id} and world_id = ${worldId}`
        const [row] = await tx`
          insert into conversations (world_id, agent_id, workspace_id, title, predecessor_id)
          values (${worldId}, ${agent.id}, ${workspace.id}, ${titleOf(text)}, ${null})
          returning id, agent_id, workspace_id, kind, title, handle, created_at, closed_at`
        return row
      })
    } catch (error) {
      if (isUniqueViolation(error, 'conversations_open_task_key')) {
        throw new CrewError('agent_busy', `${agent.name} was given something else at the same moment`, 409)
      }
      throw error
    }
  }

  /**
   * Start a turn. Never throws: whatever stops the turn from starting is recorded as the
   * turn having failed, because by now the person's message is already in the record.
   */
  async function begin(agent, conversation, workspace, text) {
    const entry = { conversation, turn: null, open: new Set(), broken: false, over: null, finish: null }
    entry.over = new Promise((resolve) => {
      entry.finish = resolve
    })
    try {
      const { autonomy } = await settings.get()
      const others = (await workspaces.list()).filter((other) => other.id !== workspace.id)
      const runtime = runtimes.get(agent.runtime)
      running.set(agent.id, entry)
      entry.turn = runtime.start({
        agent: { id: agent.id, name: agent.name, role: briefing({ agent, workspace, others }) },
        folder: workspace.folder,
        text,
        handle: conversation.handle ?? null,
        autonomy,
        onEvent: (event) => {
          inLine(agent.id, () => take(entry, agent, event)).catch((error) => log('crew conversations:', error))
        },
      })
    } catch (error) {
      if (running.get(agent.id) === entry) running.delete(agent.id)
      entry.finish()
      const refusal = error instanceof CrewError
      if (!refusal) log('crew conversations: a turn could not be started', error)
      try {
        await keep(conversation, 'failed', 'failed', {
          reason: refusal ? error.message : 'The runtime could not be started',
          code: 'runtime',
        })
        await cancelQueued(conversation, 'failed')
      } catch (inner) {
        log('crew conversations: a failed start could not be recorded', inner)
      }
    }
  }

  /** One thing a runtime said, in the agent's line. */
  async function take(entry, agent, event) {
    if (running.get(agent.id) !== entry) return
    const { conversation } = entry
    const { type, ...data } = event
    if (type === 'finished' || type === 'failed' || type === 'interrupted') return end(entry, agent, type, data)
    try {
      if (type === 'started') {
        if (event.handle && event.handle !== conversation.handle) {
          conversation.handle = event.handle
          await sql`update conversations set handle = ${event.handle} where id = ${conversation.id} and world_id = ${worldId}`
        }
      } else if (type === 'delta') {
        hub.transient({ conversationId: conversation.id, agentId: agent.id, text: event.text })
      } else {
        if (type === 'approval' || type === 'question') entry.open.add(event.requestId)
        await keep(conversation, type, entry.open.size ? 'waiting' : 'working', data)
      }
    } catch (error) {
      spoil(entry, error)
    }
  }

  /** The record cannot be written, so the turn is stopped. Its ending says why. */
  function spoil(entry, error) {
    log('crew conversations: the record could not be written, so the turn is being stopped', error)
    if (entry.broken) return
    entry.broken = true
    entry.turn?.interrupt()
  }

  /** A turn's ending: record it, free the agent, and deal with whatever was waiting. */
  async function end(entry, agent, type, data) {
    const { conversation } = entry
    const ending = entry.broken
      ? ['failed', { reason: 'The server could not record what the agent was doing, so it was stopped', code: 'runtime' }]
      : [type, data]
    const status = ending[0] === 'failed' ? 'failed' : 'idle'
    try {
      await keep(conversation, ending[0], status, ending[1])
    } catch (error) {
      // The record still says the agent is busy. `settleStale` puts that right the next time
      // anything is asked of it, and at the next start.
      log('crew conversations: the end of a turn could not be recorded', error)
      running.delete(agent.id)
      entry.finish()
      return
    }
    running.delete(agent.id)
    entry.finish()
    try {
      await follow(agent.id, conversation, ending[0], status)
    } catch (error) {
      log('crew conversations: what was waiting could not be dealt with', error)
    }
  }

  /** After a turn: deliver what was waiting if it finished, cancel it if it did not. */
  async function follow(agentId, conversation, ending, status) {
    const waiting = await queued(conversation)
    if (!waiting.length) return
    const of = waiting.map((message) => message.seq)
    let agent
    let workspace
    try {
      if (ending !== 'finished') throw new Error('the turn did not finish')
      agent = await roster.get(agentId)
      runtimes.get(agent.runtime)
      workspace = await placeOf(conversation, agent)
    } catch {
      await record(conversation, 'queue', status, { of, outcome: 'cancelled' })
      return
    }
    await record(conversation, 'queue', 'working', { of, outcome: 'delivered' })
    await begin(agent, conversation, workspace, waiting.map((message) => message.text).join('\n\n'))
  }

  function checkText(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > TEXT_LIMIT) {
      throw new CrewError('bad_message', `A message is text of at most ${TEXT_LIMIT} characters`, 400)
    }
    return text.trim()
  }

  /**
   * Say something to an agent. With a workspace it is a new task there, in a conversation of
   * its own. Without one it continues what the agent is already on, waiting its turn if the
   * agent is in the middle of something.
   */
  async function send(agentId, { text, workspaceId } = {}) {
    const said = checkText(text)
    if (typeof agentId !== 'string' || !UUID.test(agentId)) throw unknownAgent()
    return inLine(agentId, async () => {
      const agent = await roster.get(agentId)
      runtimes.get(agent.runtime)
      let conversation = await openOf(agent.id)
      if (conversation) conversation = await settleStale(conversation)
      const entry = running.get(agent.id)

      let workspace
      if (workspaceId !== undefined) {
        if (entry) {
          throw new CrewError('agent_busy', `${agent.name} is in the middle of something. Stop it, or wait, before giving it a new task`, 409)
        }
        workspace = await workspaces.get(workspaceId)
        conversation = await openIn(agent, workspace, said, conversation)
      } else {
        if (!conversation) throw needsWorkspace(agent.name)
        if (entry) {
          const event = await record(conversation, 'message', entry.open.size ? 'waiting' : 'working', { text: said, queued: true })
          return { conversation: present({ ...conversation, status: event.status }), event, queued: true }
        }
        workspace = await placeOf(conversation, agent)
      }

      const event = await record(conversation, 'message', 'working', { text: said })
      await begin(agent, conversation, workspace, said)
      return { conversation: present({ ...conversation, status: 'working' }), event, queued: false }
    })
  }

  /** Answer the question or approval a turn is stopped on. */
  async function answer(conversationId, { requestId, allow, message, answers, text } = {}) {
    const conversation = await get(conversationId)
    if (typeof requestId !== 'string' || !requestId) {
      throw new CrewError('bad_answer', 'An answer says which request it answers', 400)
    }
    const given = Object.fromEntries(Object.entries({ allow, message, answers, text }).filter(([, value]) => value !== undefined))
    return inLine(conversation.agentId, async () => {
      const entry = running.get(conversation.agentId)
      if (!entry || entry.conversation.id !== conversation.id || !entry.open.has(requestId)) throw unknownRequest()
      entry.turn.answer(requestId, given)
      entry.open.delete(requestId)
      try {
        return { event: await keep(entry.conversation, 'answer', entry.open.size ? 'waiting' : 'working', { requestId, ...given }) }
      } catch (error) {
        spoil(entry, error)
        throw error
      }
    })
  }

  /** Stop the agent's turn, if it has one, and wait until the record says so. */
  async function halt(agentId) {
    const entry = await inLine(agentId, async () => {
      const current = running.get(agentId)
      if (current) {
        current.turn?.interrupt()
        return current
      }
      const conversation = await openOf(agentId)
      if (conversation) await settleStale(conversation)
      return null
    })
    if (!entry) return { stopped: false }
    await entry.over
    return { stopped: true }
  }

  async function stop(agentId) {
    await roster.get(agentId)
    return halt(agentId)
  }

  /** An agent is leaving the world: stop it and close what it was on. */
  async function dismiss(agentId) {
    if (typeof agentId !== 'string' || !UUID.test(agentId)) throw unknownAgent()
    await halt(agentId)
    await inLine(agentId, () => sql`
      update conversations set closed_at = now()
      where world_id = ${worldId} and agent_id = ${agentId} and closed_at is null`)
  }

  /** Where each agent with an open conversation is, and how it is doing. */
  async function statuses() {
    const rows = await select(openTask)
    return new Map(rows.map((row) => [
      row.agentId,
      { status: row.status ?? 'idle', conversationId: row.id, workspaceId: row.workspaceId },
    ]))
  }

  /** An agent's conversations, newest first. */
  async function list(agentId) {
    if (typeof agentId !== 'string' || !UUID.test(agentId)) throw unknownAgent()
    const rows = await select(sql`c.agent_id = ${agentId} order by c.created_at desc, c.id desc`)
    return rows.map(present)
  }

  async function get(conversationId) {
    if (typeof conversationId !== 'string' || !UUID.test(conversationId)) throw unknownConversation()
    const [row] = await select(sql`c.id = ${conversationId}`)
    if (!row) throw unknownConversation()
    return present(row)
  }

  /**
   * At start: a server that stopped took its turns with it. Mark every conversation it left
   * busy as interrupted, so no agent waits on a turn that is not there.
   *
   * @returns {Promise<number>} how many were marked
   */
  async function recover() {
    const rows = (await select(openTask)).filter((row) => BUSY.includes(row.status) && !running.has(row.agentId))
    for (const row of rows) await inLine(row.agentId, () => settleStale(row, 'restart'))
    return rows.length
  }

  /** Resolves when the agent has no turn under way and nothing left in its line. */
  async function settled(agentId) {
    for (;;) {
      await lines.get(agentId)
      const entry = running.get(agentId)
      if (entry) await entry.over
      else if (!lines.has(agentId)) return
    }
  }

  /** Stop every turn and wait for the record to be complete. */
  async function close() {
    const agents = [...running.keys()]
    await Promise.all(agents.map((agentId) => halt(agentId).catch((error) => log('crew conversations:', error))))
    await Promise.all([...lines.values()])
    await events.idle()
  }

  return { send, answer, stop, dismiss, statuses, list, get, recover, settled, close }
}
