// server/crew/conversations.mjs
import { setTimeout as wait } from 'node:timers/promises'
import { asideBriefing, briefing } from './briefing.mjs'
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

/** What an agent is told when it asks leave to act, or asks a question, while answering aside. */
const NOT_HERE = 'Nothing can be changed while answering the crew channel. Say what you would do, or claim the task and do it there.'
const NOBODY = 'Nobody can answer a question here. Say what you can, or say what you would need to know.'

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
 * An agent can also be asked something aside from its task, which is how it answers the crew
 * channel: one turn in a conversation of its own, in which it may look and may not touch.
 * It is a turn like any other on the agent's line, so an agent answering is busy.
 *
 * @param {{sql: any, worldId: string, roster: any, workspaces: any, settings: any,
 *   runtimes: {get: (id: string) => any}, events: any, hub: any,
 *   asideDir?: string, onFree?: (agentId: string) => void,
 *   retryDelays?: number[], log?: (...args: any[]) => void}} options
 *   `asideDir` is where an agent in no workspace answers from. `onFree` is called, and not
 *   waited for, each time an agent is left with nothing under way.
 */
export function createConversations({
  sql, worldId, roster, workspaces, settings, runtimes, events, hub, asideDir, onFree,
  retryDelays = [100, 400], log = console.error,
}) {
  /**
   * The turn each agent has under way.
   * @type {Map<string, {conversation: any, turn: any, open: Set<string>, broken: boolean,
   *   stopped: boolean, said: string, aside: null | {rest: string, onEnd?: (ending: object) => void},
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
    ...(row.postId ? { postId: row.postId } : {}),
  })

  /** A conversation's rows, each with the status its last event left. */
  const select = (where) => sql`
    select c.id, c.agent_id, c.workspace_id, c.kind, c.title, c.handle, c.created_at, c.closed_at, c.post_id,
      (select e.status from events e
        where e.world_id = c.world_id and e.conversation_id = c.id
        order by e.seq desc limit 1) as status
    from conversations c
    where c.world_id = ${worldId} and ${where}`

  const openTask = sql`c.kind = 'task' and c.closed_at is null`
  const openAside = sql`c.kind = 'channel' and c.closed_at is null`

  async function openOf(agentId) {
    const [row] = await select(sql`c.agent_id = ${agentId} and ${openTask}`)
    return row ?? null
  }

  const record = (conversation, type, status, data = {}) =>
    events.append({
      conversationId: conversation.id, agentId: conversation.agentId, type, status, data,
      ...(conversation.postId ? { postId: conversation.postId } : {}),
    })

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
    if (waiting.length) await keep(conversation, 'queue', status, { of: waiting.map((m) => m.seq), outcome: 'cancelled' })
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

  const closeAside = (conversation) => sql`
    update conversations set closed_at = now()
    where id = ${conversation.id} and world_id = ${worldId} and closed_at is null`

  /**
   * Answers the record says are under way, with no turn behind them: the same two causes as
   * `settleStale`. An answer is not gone back to, so each is ended and closed.
   */
  async function settleAsides(agentId, reason = 'lost') {
    const rows = await select(sql`c.agent_id = ${agentId} and ${openAside}`)
    for (const row of rows) {
      if (running.get(agentId)?.conversation.id === row.id) continue
      if (BUSY.includes(row.status)) await record(row, 'interrupted', 'idle', { reason })
      await closeAside(row)
    }
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
  async function begin(agent, conversation, workspace, text, aside = null) {
    const entry = { conversation, turn: null, open: new Set(), broken: false, stopped: false, said: '', aside, over: null, finish: null }
    entry.over = new Promise((resolve) => {
      entry.finish = resolve
    })
    try {
      let role
      let autonomy
      if (aside) {
        // An answer is given at the level that asks, and what it asks is refused: see `take`.
        role = asideBriefing({ agent, instruction: aside.instruction })
        autonomy = 'ask'
      } else {
        const others = (await workspaces.list()).filter((other) => other.id !== workspace.id)
        role = briefing({ agent, workspace, others })
        autonomy = (await settings.get()).autonomy
      }
      const runtime = runtimes.get(agent.runtime)
      running.set(agent.id, entry)
      entry.turn = runtime.start({
        agent: { id: agent.id, name: agent.name, role },
        folder: workspace ? workspace.folder : asideDir,
        text,
        handle: conversation.handle ?? null,
        autonomy,
        ...(aside?.channel ? { channel: aside.channel } : {}),
        onEvent: (event) => {
          inLine(agent.id, () => take(entry, agent, event)).catch((error) => log('crew conversations:', error))
        },
      })
    } catch (error) {
      if (running.get(agent.id) === entry) running.delete(agent.id)
      const refusal = error instanceof CrewError
      if (!refusal) log('crew conversations: a turn could not be started', error)
      const data = { reason: refusal ? error.message : 'The runtime could not be started', code: 'runtime' }
      try {
        const status = aside ? aside.rest : 'failed'
        await keep(conversation, 'failed', status, data)
        if (aside) await closeAside(conversation)
        else await cancelQueued(conversation, 'failed')
      } catch (inner) {
        log('crew conversations: a failed start could not be recorded', inner)
      }
      entry.finish()
      after(entry, agent.id, 'failed', data)
    }
  }

  /**
   * A turn is over and its part of the line is done. Whoever asked an agent aside is told
   * how it ended, and whoever wants to know is told the agent is free, if it is. Neither is
   * waited for: what they go on to do takes its own place in the line.
   */
  function after(entry, agentId, type, data) {
    queueMicrotask(() => {
      try {
        entry.aside?.onEnd?.({ type, data, said: (type === 'finished' && data.text) || entry.said })
      } catch (error) {
        log('crew conversations: whoever asked an agent aside threw on its answer', error)
      }
      try {
        if (!running.has(agentId)) onFree?.(agentId)
      } catch (error) {
        log('crew conversations: whoever was told an agent is free threw', error)
      }
    })
  }

  /** One thing a runtime said, in the agent's line. */
  async function take(entry, agent, event) {
    if (running.get(agent.id) !== entry) return
    const { conversation } = entry
    const { type, ...data } = event
    if (type === 'finished' || type === 'failed' || type === 'interrupted') return end(entry, agent, type, data)
    // The turn is being stopped because nothing can be written. What it said meanwhile is
    // not tried: each try would hold the agent up, and the ending says what happened.
    if (entry.broken) return
    try {
      if (type === 'started') {
        if (event.handle && event.handle !== conversation.handle) {
          conversation.handle = event.handle
          await sql`update conversations set handle = ${event.handle} where id = ${conversation.id} and world_id = ${worldId}`
        }
      } else if (type === 'delta') {
        hub.transient({ conversationId: conversation.id, agentId: agent.id, text: event.text })
      } else if (entry.aside && type === 'approval') {
        entry.turn.answer(event.requestId, { allow: false, message: NOT_HERE })
      } else if (entry.aside && type === 'question') {
        entry.turn.answer(event.requestId, { answers: event.questions.map(() => NOBODY) })
      } else {
        if (type === 'approval' || type === 'question') entry.open.add(event.requestId)
        if (type === 'text') entry.said = event.text
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

  /**
   * A turn's ending: record it, free the agent, and deal with whatever was waiting. Only
   * then is the turn over for anyone waiting on it, so a stop answers once the record is
   * complete.
   */
  async function end(entry, agent, type, data) {
    const { conversation } = entry
    const ending = entry.broken
      ? ['failed', { reason: 'The server could not record what the agent was doing, so it was stopped', code: 'runtime' }]
      : [type, data]
    // An answer aside leaves the agent as it was before it was asked.
    const status = entry.aside ? entry.aside.rest : ending[0] === 'failed' ? 'failed' : 'idle'
    try {
      await keep(conversation, ending[0], status, ending[1])
      running.delete(agent.id)
      if (entry.aside) {
        await closeAside(conversation)
        // What was said to the agent meanwhile was said about its task, and is due now.
        const task = await openOf(agent.id)
        if (task) await follow(agent.id, task, true, task.status ?? 'idle')
      } else {
        // A stop means stop, even when the runtime finished by itself a moment before it.
        await follow(agent.id, conversation, ending[0] === 'finished' && !entry.stopped, status)
      }
    } catch (error) {
      // If the ending itself was not recorded, the record still says the agent is busy.
      // `settleStale` puts that right the next time anything is asked of it, and at the
      // next start. What was waiting and could not be dealt with is picked up by `send`.
      log('crew conversations: the end of a turn could not be recorded in full', error)
    } finally {
      if (running.get(agent.id) === entry) running.delete(agent.id)
      entry.finish()
      after(entry, agent.id, ending[0], ending[1])
    }
  }

  /** After a turn: deliver what was waiting if it finished, cancel it if it did not. */
  async function follow(agentId, conversation, deliver, status) {
    const waiting = await queued(conversation)
    if (!waiting.length) return
    const of = waiting.map((message) => message.seq)
    let agent
    let workspace
    if (deliver) {
      try {
        agent = await roster.get(agentId)
        runtimes.get(agent.runtime)
        workspace = await placeOf(conversation, agent)
      } catch (error) {
        // The agent was retired or its workspace archived meanwhile. Anything else is a
        // fault, and the messages stay waiting until it has passed.
        if (!(error instanceof CrewError)) throw error
        deliver = false
      }
    }
    if (!deliver) {
      await keep(conversation, 'queue', status, { of, outcome: 'cancelled' })
      return
    }
    await keep(conversation, 'queue', 'working', { of, outcome: 'delivered' })
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
  async function send(agentId, { text, workspaceId, postId } = {}) {
    const said = checkText(text)
    if (typeof agentId !== 'string' || !UUID.test(agentId)) throw unknownAgent()
    // A task taken from the crew channel says which post it came from.
    const from = typeof postId === 'string' && UUID.test(postId) ? { postId } : {}
    return inLine(agentId, async () => {
      const agent = await roster.get(agentId)
      runtimes.get(agent.runtime)
      let conversation = await openOf(agent.id)
      if (conversation) conversation = await settleStale(conversation)
      await settleAsides(agent.id)
      const entry = running.get(agent.id)

      let workspace
      if (workspaceId !== undefined) {
        if (entry) {
          throw new CrewError('agent_busy', `${agent.name} is in the middle of something. Stop it, or wait, before giving it a new task`, 409)
        }
        workspace = await workspaces.get(workspaceId)
        // Anything left waiting in the conversation being replaced belongs to the old task.
        if (conversation) await cancelQueued(conversation, conversation.status ?? 'idle')
        conversation = await openIn(agent, workspace, said, conversation)
      } else {
        if (!conversation) throw needsWorkspace(agent.name)
        if (entry) {
          const event = await record(conversation, 'message', entry.open.size ? 'waiting' : 'working', { text: said, queued: true })
          return { conversation: present({ ...conversation, status: event.status }), event, queued: true }
        }
        workspace = await placeOf(conversation, agent)
      }

      const event = await record(conversation, 'message', 'working', { text: said, ...from })
      // Messages can be left waiting under a free agent when the end of a turn could not be
      // recorded in full. They were said first, so they go first.
      const left = await queued(conversation)
      if (left.length) await keep(conversation, 'queue', 'working', { of: left.map((m) => m.seq), outcome: 'delivered' })
      await begin(agent, conversation, workspace, [...left.map((m) => m.text), said].join('\n\n'))
      return { conversation: present({ ...conversation, status: 'working' }), event, queued: false }
    })
  }

  /**
   * Ask an agent something aside from its task: one turn, in a conversation of its own, from
   * which nothing can be changed. A busy agent is not asked, and the answer says so.
   *
   * `instruction` follows the agent's role. `onEnd` is told how the turn ended and what the
   * agent said last, once the agent is free of it.
   *
   * @returns {Promise<{started: true, conversation: object} | {started: false, status: string}>}
   */
  async function aside(agentId, { text, title, postId, instruction = '', channel, onEnd } = {}) {
    const said = checkText(text)
    if (typeof agentId !== 'string' || !UUID.test(agentId)) throw unknownAgent()
    return inLine(agentId, async () => {
      const agent = await roster.get(agentId)
      runtimes.get(agent.runtime)
      let task = await openOf(agent.id)
      if (task) task = await settleStale(task)
      await settleAsides(agent.id)
      const entry = running.get(agent.id)
      if (entry) return { started: false, status: entry.open.size ? 'waiting' : 'working' }

      // It answers from where it is, so it can read what it is asked about. A workspace that
      // has gone is no reason not to answer.
      let workspace = null
      if (task) {
        workspace = await workspaces.get(task.workspaceId).catch((error) => {
          if (error instanceof CrewError) return null
          throw error
        })
      }
      const [conversation] = await sql`
        insert into conversations (world_id, agent_id, workspace_id, kind, title, post_id)
        values (${worldId}, ${agent.id}, ${workspace?.id ?? null}, 'channel', ${titleOf(title ?? said)}, ${postId ?? null})
        returning id, agent_id, workspace_id, kind, title, handle, created_at, closed_at, post_id`
      await record(conversation, 'message', 'working', { text: said })
      await begin(agent, conversation, workspace, said, {
        rest: task?.status === 'failed' ? 'failed' : 'idle', instruction, channel, onEnd,
      })
      return { started: true, conversation: present({ ...conversation, status: 'working' }) }
    })
  }

  /** Stop the agent's turn if it is in this conversation, and only then. */
  async function stopIn(agentId, conversationId) {
    const entry = await inLine(agentId, async () => {
      const current = running.get(agentId)
      if (!current || current.conversation.id !== conversationId) return null
      current.stopped = true
      current.turn?.interrupt()
      return current
    })
    if (!entry) return { stopped: false }
    await entry.over
    return { stopped: true }
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
        current.stopped = true
        current.turn?.interrupt()
        return current
      }
      const conversation = await openOf(agentId)
      if (conversation) await settleStale(conversation)
      await settleAsides(agentId)
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
    const [rows, asides] = await Promise.all([select(openTask), select(openAside)])
    const all = new Map(rows.map((row) => [
      row.agentId,
      { status: row.status ?? 'idle', conversationId: row.id, workspaceId: row.workspaceId },
    ]))
    // An agent answering the crew channel is working, wherever its task stands.
    for (const row of asides) {
      if (!BUSY.includes(row.status)) continue
      all.set(row.agentId, { conversationId: null, workspaceId: null, ...all.get(row.agentId), status: 'working' })
    }
    return all
  }

  /** An agent's tasks, newest first. What it said to the crew channel is the channel's to show. */
  async function list(agentId) {
    if (typeof agentId !== 'string' || !UUID.test(agentId)) throw unknownAgent()
    const rows = await select(sql`c.agent_id = ${agentId} and c.kind = 'task' order by c.created_at desc, c.id desc`)
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
    const asides = (await select(openAside)).filter((row) => running.get(row.agentId)?.conversation.id !== row.id)
    for (const agentId of new Set(asides.map((row) => row.agentId))) await inLine(agentId, () => settleAsides(agentId, 'restart'))
    return rows.length + asides.length
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

  return { send, aside, stopIn, answer, stop, dismiss, statuses, list, get, recover, settled, close }
}
