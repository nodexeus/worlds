// server/crew/channel.mjs
import { CrewError } from './errors.mjs'
import { nameKey } from './names.mjs'
import { isUniqueViolation } from './store/db.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A post is a question or a task in a sentence or two, not a document. */
const TEXT_LIMIT = 4000
/** What is kept of an answer. An agent is told to be far shorter: this is for one that is not. */
const REPLY_LIMIT = 1500
const PAGE = 30
const PAGE_LIMIT = 100
const DESCRIPTION = 200
const WORKSPACES = 40

const BUSY = ['working', 'waiting']

const unknownPost = () => new CrewError('unknown_post', 'There is no such post in this world', 404)

const cut = (text, limit = REPLY_LIMIT) => (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text)

/**
 * The names a post addresses: each word that follows an `@`, as it was typed. An `@` in the
 * middle of a word is an address or a handle from somewhere else, and names nobody here.
 */
export function mentions(text) {
  const seen = new Set()
  const names = []
  for (const [, name] of String(text).matchAll(/(?<![\p{L}\p{N}_@.-])@(\p{L}[\p{L}\p{N}_-]{1,23})/gu)) {
    const key = nameKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/**
 * What an agent did with a post, read from what it said. Only its first line decides:
 *
 *   - `PASS`, or nothing at all: it passes;
 *   - `CLAIM: <workspace>`: it wants the task, there. The rest is what it says about it;
 *   - anything else: a contribution.
 *
 * An agent's words are never trusted further than that. Whether the workspace it names
 * exists, and whether it gets the task, is decided by the channel.
 */
export function parseMove(said) {
  const text = typeof said === 'string' ? said.trim() : ''
  if (!text) return { move: 'pass' }
  const [first, ...rest] = text.split('\n')
  const line = first.replace(/^[\s*_`]+|[\s*_`]+$/g, '')
  if (/^pass[.!]?$/i.test(line)) return { move: 'pass' }
  const claim = /^claim\s*:(.*)$/i.exec(line)
  if (claim) {
    const workspace = claim[1].trim().replace(/^["'`“‘]+|["'`”’.]+$/g, '').trim()
    return { move: 'claim', workspace, text: cut(rest.join('\n').trim()) }
  }
  return { move: 'reply', text: cut(text) }
}

/**
 * What an agent is told, after its own role, when a post reaches it.
 *
 * @param {{named: boolean, workspaces: {name: string, description?: string}[]}} input
 */
export function channelInstruction({ named, workspaces }) {
  const shown = workspaces.slice(0, WORKSPACES)
  const more = workspaces.length - shown.length
  const places = shown.length
    ? [
        'The workspaces in this world:',
        ...shown.map((workspace) => {
          const about = String(workspace.description || '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION)
          return about ? `- ${workspace.name}: ${about}` : `- ${workspace.name}`
        }),
        ...(more > 0 ? [`(and ${more} more)`] : []),
      ].join('\n')
    : 'There are no workspaces in this world, so nothing can be claimed.'

  return [
    'The message you have just been given was posted to the crew channel, ' +
      (named
        ? 'to you by name.'
        : 'to the whole crew: every agent who is free has been given it, and each answers separately.') +
      ' It is not your task unless you take it. You answer once.',
    [
      'Answer in exactly one of these three ways:',
      '- To contribute something useful: say it, in 80 words or fewer.',
      '- To take it on as your task: make your first line exactly `CLAIM: <workspace name>`, naming the workspace the work belongs in, then one line on what you will do. Only one agent is given a task, so claim only what suits you.',
      '- If you have nothing to add: answer with exactly `PASS`.',
    ].join('\n'),
    'While answering you may read, and you may not change anything: a change is refused. If it is unclear what is being asked, or which workspace it belongs in, do not claim it. Say what is unclear.',
    places,
  ].join('\n\n')
}

/**
 * The crew channel: one place to say something to the whole crew, or to some of it by name.
 *
 * A post is given to agents, each of which answers once, aside from whatever task it has:
 * it contributes, passes, or claims the post as its task. A claim is a row in the database
 * that only one agent can hold for a post, so however many claim at once, one is given it.
 * Its work then becomes an ordinary task, and the person can take it back or hand it on.
 *
 * Every time anything about a post changes, the whole post goes out on the world's record,
 * so whoever is watching replaces what they had and can never apply a change out of order.
 *
 * Everything about one post happens in one line, in the order it arrived, as everything
 * about one agent does in `conversations.mjs`. A post's line may wait on an agent's line.
 * An agent's line never waits on a post's.
 *
 * @param {{sql: any, worldId: string, roster: any, workspaces: any, settings: any,
 *   conversations: any, runtimes: {get: (id: string) => any}, events: any,
 *   log?: (...args: any[]) => void}} options
 */
export function createChannel({ sql, worldId, roster, workspaces, settings, conversations, runtimes, events, log = console.error }) {
  /** The tail of each post's line. */
  const lines = new Map()
  /** Everything begun and not waited for by whoever began it. */
  const work = new Set()
  /** What is still being made of each agent's latest answer. */
  const deciding = new Map()

  function inPost(postId, step) {
    const result = (lines.get(postId) ?? Promise.resolve()).then(step)
    const tail = result.catch(() => {})
    lines.set(postId, tail)
    tail.then(() => {
      if (lines.get(postId) === tail) lines.delete(postId)
    })
    return result
  }

  function track(promise) {
    const tracked = promise.catch((error) => log('crew channel:', error)).finally(() => work.delete(tracked))
    work.add(tracked)
    return tracked
  }

  // ── reading ─────────────────────────────────────────────────────────────────────────

  /** Posts as the page is given them, in the order of `ids`. */
  async function assemble(ids) {
    if (!ids.length) return []
    const [posts, deliveries, claims] = await Promise.all([
      sql`select id, text, named, created_at from channel_posts where world_id = ${worldId} and id in ${sql(ids)}`,
      sql`
        select d.post_id, d.agent_id, a.name, d.state, d.reason, d.text, d.conversation_id
        from channel_deliveries d join agents a on a.id = d.agent_id
        where d.world_id = ${worldId} and d.post_id in ${sql(ids)}
        order by a.created_at, a.id`,
      sql`
        select distinct on (c.post_id)
          c.post_id, c.agent_id, a.name, c.workspace_id, c.conversation_id, c.reason, c.released_at
        from channel_claims c join agents a on a.id = c.agent_id
        where c.world_id = ${worldId} and c.post_id in ${sql(ids)}
        order by c.post_id, c.id desc`,
    ])
    const byId = new Map(posts.map((post) => [post.id, { id: post.id, text: post.text, at: post.createdAt.toISOString(), named: post.named, to: [], claim: null }]))
    for (const row of deliveries) {
      byId.get(row.postId)?.to.push({
        agentId: row.agentId, name: row.name, state: row.state, reason: row.reason, text: row.text, conversationId: row.conversationId,
      })
    }
    for (const row of claims) {
      const post = byId.get(row.postId)
      if (!post) continue
      post.claim = {
        agentId: row.agentId, name: row.name, workspaceId: row.workspaceId, conversationId: row.conversationId,
        state: row.releasedAt ? 'released' : 'granted', reason: row.reason,
      }
    }
    return ids.map((id) => byId.get(id)).filter(Boolean)
  }

  async function get(postId) {
    if (typeof postId !== 'string' || !UUID.test(postId)) throw unknownPost()
    const [post] = await assemble([postId])
    if (!post) throw unknownPost()
    return post
  }

  /**
   * The latest posts, oldest first, or with `before` the latest that came earlier. `seq` is
   * where the record stood before they were read: anything the stream says after it is news.
   */
  async function list({ before, limit = PAGE } = {}) {
    if (before !== undefined && (typeof before !== 'string' || !UUID.test(before))) {
      throw new CrewError('bad_query', 'before is the id of a post', 400)
    }
    const seq = await events.head()
    const rows = await sql`
      select id from channel_posts
      where world_id = ${worldId} ${before ? sql`and id < ${before}` : sql``}
      order by id desc limit ${Math.min(limit, PAGE_LIMIT)}`
    return { posts: await assemble(rows.map((row) => row.id).reverse()), seq }
  }

  /** Say how a post stands now, to everyone watching. Call it in the post's line. */
  async function publish(postId) {
    const [post] = await assemble([postId])
    if (post) await events.append({ type: 'post', postId, data: post })
    return post
  }

  // ── changing ────────────────────────────────────────────────────────────────────────

  const setDelivery = (postId, agentId, fields) => sql`
    update channel_deliveries set ${sql(fields)}, updated_at = now()
    where world_id = ${worldId} and post_id = ${postId} and agent_id = ${agentId}`

  const deliveryOf = async (postId, agentId) => {
    const [row] = await sql`
      select state, conversation_id from channel_deliveries
      where world_id = ${worldId} and post_id = ${postId} and agent_id = ${agentId}`
    return row ?? null
  }

  const grantedOf = async (postId) => {
    const [row] = await sql`
      select id, agent_id, workspace_id, conversation_id from channel_claims
      where world_id = ${worldId} and post_id = ${postId} and released_at is null`
    return row ?? null
  }

  const releaseClaim = (claimId, reason) => sql`
    update channel_claims set released_at = now(), reason = ${reason}
    where id = ${claimId} and world_id = ${worldId} and released_at is null`

  const runs = (agent) => {
    try {
      runtimes.get(agent.runtime)
      return true
    } catch (error) {
      if (error instanceof CrewError) return false
      throw error
    }
  }

  /**
   * Give a post to an agent it is waiting for. In the post's line.
   * @returns {Promise<string | null>} what became of it for that agent
   */
  async function give(postId, agentId) {
    const delivery = await deliveryOf(postId, agentId)
    if (delivery?.state !== 'queued') return delivery?.state ?? null
    const [post] = await sql`select text, named from channel_posts where world_id = ${worldId} and id = ${postId}`
    const places = await workspaces.list()
    let asked
    try {
      asked = await conversations.aside(agentId, {
        text: post.text,
        title: post.text,
        postId,
        instruction: channelInstruction({ named: post.named, workspaces: places }),
        channel: { workspaces: places.map((place) => place.name) },
        onEnd: (ending) => {
          const made = track(inPost(postId, () => answered(postId, agentId, ending)))
          deciding.set(agentId, made)
          made.finally(() => {
            if (deciding.get(agentId) === made) deciding.delete(agentId)
          })
        },
      })
    } catch (error) {
      if (!(error instanceof CrewError)) throw error
      const reason = error.code === 'unknown_agent' ? 'retired' : error.code === 'runtime_unavailable' ? 'runtime' : error.message
      await setDelivery(postId, agentId, { state: 'skipped', reason })
      await publish(postId)
      return 'skipped'
    }
    if (asked.started) {
      await setDelivery(postId, agentId, { state: 'answering', conversationId: asked.conversation.id })
      await publish(postId)
      return 'answering'
    }
    // Busy after all. One that was named still gets it, when it is free: see `freed`.
    if (post.named) return 'queued'
    await setDelivery(postId, agentId, { state: 'skipped', reason: asked.status })
    await publish(postId)
    return 'skipped'
  }

  const deliver = (postId, agentId) => inPost(postId, () => give(postId, agentId))

  /** An agent's answer has ended. In the post's line. */
  async function answered(postId, agentId, { type, data, said }) {
    const delivery = await deliveryOf(postId, agentId)
    // Decided already: the post was taken while this agent was still answering.
    if (delivery?.state !== 'answering') return
    if (type !== 'finished') {
      await setDelivery(postId, agentId, { state: 'failed', reason: type === 'failed' ? cut(String(data?.reason || 'failed'), 300) : 'stopped' })
      return publish(postId)
    }
    const move = parseMove(said)
    if (move.move === 'pass') {
      await setDelivery(postId, agentId, { state: 'passed' })
      return publish(postId)
    }
    if (move.move === 'reply') {
      await setDelivery(postId, agentId, { state: 'replied', text: move.text })
      return publish(postId)
    }
    const wanted = nameKey(move.workspace)
    const place = wanted ? (await workspaces.list()).find((one) => nameKey(one.name) === wanted) : null
    if (!place) {
      // It would take the task and has not said where it belongs, so no work begins. The
      // person can make it a task, with a workspace.
      await setDelivery(postId, agentId, { state: 'replied', reason: 'unplaced', text: move.text || 'I can take this.' })
      return publish(postId)
    }

    let claim
    try {
      ;[claim] = await sql`
        insert into channel_claims (world_id, post_id, agent_id, workspace_id)
        values (${worldId}, ${postId}, ${agentId}, ${place.id}) returning id`
    } catch (error) {
      if (!isUniqueViolation(error, 'channel_claims_granted_key')) throw error
      await setDelivery(postId, agentId, { state: 'passed', reason: 'taken', text: move.text })
      return publish(postId)
    }
    await setDelivery(postId, agentId, { state: 'claimed', text: move.text })
    await taken(postId, agentId)
    await publish(postId)
    await begin(postId, claim.id, agentId, place.id).catch((error) => {
      // The claim has been let go and the post says why. There is nobody here to tell.
      if (!(error instanceof CrewError)) throw error
    })
  }

  /** A post has been taken: nobody else need answer it. */
  async function taken(postId, winnerId) {
    const stopped = await sql`
      update channel_deliveries set state = 'passed', reason = 'taken', updated_at = now()
      where world_id = ${worldId} and post_id = ${postId} and agent_id <> ${winnerId} and state = 'answering'
      returning agent_id, conversation_id`
    await sql`
      update channel_deliveries set state = 'skipped', reason = 'taken', updated_at = now()
      where world_id = ${worldId} and post_id = ${postId} and agent_id <> ${winnerId} and state = 'queued'`
    // Not waited for: their endings find the post already decided and add nothing.
    for (const row of stopped) {
      if (row.conversationId) track(conversations.stopIn(row.agentId, row.conversationId))
    }
  }

  /**
   * Start the task a claim stands for. If it cannot start, the claim is let go, with the
   * reason, so no post is left held by an agent that is not doing it.
   */
  async function begin(postId, claimId, agentId, workspaceId) {
    try {
      const [post] = await sql`select text from channel_posts where world_id = ${worldId} and id = ${postId}`
      const sent = await conversations.send(agentId, { text: post.text, workspaceId, postId })
      await sql`update channel_claims set conversation_id = ${sent.conversation.id} where id = ${claimId} and world_id = ${worldId}`
      await publish(postId)
    } catch (error) {
      const refusal = error instanceof CrewError
      if (!refusal) log('crew channel: a claimed task could not be started', error)
      await releaseClaim(claimId, refusal ? error.message : 'The task could not be started')
      await publish(postId)
      throw refusal ? error : new CrewError('fault', 'The task could not be started', 500)
    }
  }

  /**
   * Post to the crew. With names after an `@`, to those agents: one that is busy gets it
   * when it is free. With none, to every agent that is free now, up to the world's limit.
   */
  async function post({ text } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > TEXT_LIMIT) {
      throw new CrewError('bad_post', `A post is text of at most ${TEXT_LIMIT} characters`, 400)
    }
    const said = text.trim()
    const agents = await roster.list()
    if (!agents.length) throw new CrewError('no_agents', 'There is nobody in the crew to post to. Add an agent first', 409)

    const byName = new Map(agents.map((agent) => [nameKey(agent.name), agent]))
    const names = mentions(said)
    const unknown = names.filter((name) => !byName.has(nameKey(name)))
    if (unknown.length) {
      throw new CrewError(
        'unknown_mention',
        `There is no agent called ${unknown.join(' or ')}. A post goes only to the agents it names, so nothing was posted`,
        400)
    }

    let rows
    if (names.length) {
      const named = new Set(names.map((name) => byName.get(nameKey(name)).id))
      rows = agents.filter((agent) => named.has(agent.id)).map((agent) =>
        runs(agent) ? { agent, state: 'queued', reason: null } : { agent, state: 'skipped', reason: 'runtime' })
    } else {
      const statuses = await conversations.statuses()
      const { channelLimit } = await settings.get()
      const status = (agent) => statuses.get(agent.id)?.status
      const free = agents.filter((agent) => runs(agent) && !BUSY.includes(status(agent)))
      let chosen = new Set(free.map((agent) => agent.id))
      if (channelLimit && free.length > channelLimit) {
        // Those asked least recently go first, so a limit does not always fall on the same few.
        const asked = await sql`
          select agent_id, max(post_id::text) as last from channel_deliveries
          where world_id = ${worldId} and state <> 'skipped' group by agent_id`
        const last = new Map(asked.map((row) => [row.agentId, row.last]))
        const order = [...free].sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? ''))
        chosen = new Set(order.slice(0, channelLimit).map((agent) => agent.id))
      }
      rows = agents.map((agent) => {
        if (!runs(agent)) return { agent, state: 'skipped', reason: 'runtime' }
        if (BUSY.includes(status(agent))) return { agent, state: 'skipped', reason: status(agent) }
        if (!chosen.has(agent.id)) return { agent, state: 'skipped', reason: 'limit' }
        return { agent, state: 'queued', reason: null }
      })
    }

    const made = await sql.begin(async (tx) => {
      const [row] = await tx`
        insert into channel_posts (world_id, text, named) values (${worldId}, ${said}, ${names.length > 0}) returning id`
      for (const { agent, state, reason } of rows) {
        await tx`
          insert into channel_deliveries (world_id, post_id, agent_id, state, reason)
          values (${worldId}, ${row.id}, ${agent.id}, ${state}, ${reason})`
      }
      return row
    })
    await inPost(made.id, () => publish(made.id))
    await Promise.all(rows.filter((row) => row.state === 'queued').map((row) =>
      deliver(made.id, row.agent.id).catch((error) => log('crew channel: a post could not be given to an agent', error))))
    return get(made.id)
  }

  /** Take a post back from the agent that has it. If it is still at work on it, it is stopped. */
  async function release(postId) {
    await get(postId)
    return inPost(postId, async () => {
      const claim = await grantedOf(postId)
      if (!claim) throw new CrewError('no_claim', 'Nobody has this post', 409)
      await releaseClaim(claim.id, 'released')
      if (claim.conversationId) await conversations.stopIn(claim.agentId, claim.conversationId)
      return publish(postId)
    })
  }

  /**
   * Make a post an agent's task, taking it from whoever has it. This is also how a reply is
   * turned into a task for the agent that gave it.
   *
   * With no workspace given it goes where the post's last claim was, and failing that where
   * the agent already is.
   */
  async function hand(postId, { agentId, workspaceId } = {}) {
    await get(postId)
    return inPost(postId, async () => {
      const agent = await roster.get(agentId)
      runtimes.get(agent.runtime)
      const at = (await conversations.statuses()).get(agent.id)
      if (BUSY.includes(at?.status)) {
        throw new CrewError('agent_busy', `${agent.name} is in the middle of something. Stop it, or wait, before handing it this`, 409)
      }
      const [last] = await sql`
        select workspace_id from channel_claims where world_id = ${worldId} and post_id = ${postId} order by id desc limit 1`
      const wanted = workspaceId ?? last?.workspaceId ?? at?.workspaceId
      if (!wanted) throw new CrewError('needs_workspace', `Choose a workspace for ${agent.name} to do this in`, 409)
      const place = await workspaces.get(wanted)

      const held = await grantedOf(postId)
      const claim = await sql.begin(async (tx) => {
        if (held) await tx`update channel_claims set released_at = now(), reason = 'handed' where id = ${held.id} and released_at is null`
        const [row] = await tx`
          insert into channel_claims (world_id, post_id, agent_id, workspace_id)
          values (${worldId}, ${postId}, ${agent.id}, ${place.id}) returning id`
        await tx`
          insert into channel_deliveries (world_id, post_id, agent_id, state)
          values (${worldId}, ${postId}, ${agent.id}, 'claimed')
          on conflict (post_id, agent_id) do update set state = 'claimed', reason = null, updated_at = now()`
        return row
      })
      await taken(postId, agent.id)
      if (held?.conversationId) await conversations.stopIn(held.agentId, held.conversationId)
      await begin(postId, claim.id, agent.id, place.id)
      const [now] = await assemble([postId])
      return now
    })
  }

  /**
   * An agent has nothing under way: give it the oldest post that is waiting for it. The
   * next waits for the next time it is free, so its task's own messages are never jumped.
   */
  function freed(agentId) {
    return track((async () => {
      // If its last answer was a claim, the task that follows comes before any other post.
      await deciding.get(agentId)
      for (;;) {
        const [next] = await sql`
          select post_id from channel_deliveries
          where world_id = ${worldId} and agent_id = ${agentId} and state = 'queued'
          order by post_id limit 1`
        if (!next) return
        const state = await deliver(next.postId, agentId)
        if (state === 'queued' || state === 'answering') return
      }
    })())
  }

  /** An agent has left the world. What was waiting for it is not waiting any more. */
  async function forget(agentId) {
    const rows = await sql`
      update channel_deliveries set state = 'skipped', reason = 'retired', updated_at = now()
      where world_id = ${worldId} and agent_id = ${agentId} and state = 'queued'
      returning post_id`
    for (const row of rows) await inPost(row.postId, () => publish(row.postId))
  }

  /**
   * At start: a server that stopped took its agents' answers with it. Nothing must be left
   * answering, or held by a claim whose task never began, and what was queued is delivered.
   */
  async function recover() {
    const lost = await sql`
      update channel_deliveries set state = 'failed', reason = 'restart', updated_at = now()
      where world_id = ${worldId} and state = 'answering' returning post_id`
    const stuck = await sql`
      update channel_claims set released_at = now(), reason = 'restart'
      where world_id = ${worldId} and released_at is null and conversation_id is null returning post_id`
    for (const postId of new Set([...lost, ...stuck].map((row) => row.postId))) await inPost(postId, () => publish(postId))
    const waiting = await sql`
      select distinct agent_id from channel_deliveries where world_id = ${worldId} and state = 'queued'`
    for (const row of waiting) freed(row.agentId)
    return lost.length + stuck.length
  }

  /** Resolves once nothing the channel began is still under way. */
  async function settled() {
    while (work.size || lines.size) await Promise.all([...work, ...lines.values()])
  }

  return { post, list, get, release, hand, freed, forget, recover, settled }
}
