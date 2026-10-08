/**
 * The crew channel as the page knows it: the posts, and what each has to say for itself.
 *
 * The server gives a post whole every time anything about it changes, so there is nothing to
 * piece together here. A post is replaced by a newer word about it and never by an older
 * one, whether that word came on the stream or in a snapshot.
 *
 * No DOM, no network: both are someone else's job.
 */

const BUSY = ['working', 'waiting']

/** As the server finds names: see `mentions` in `server/crew/channel.mjs`. */
const MENTION = /(?<![\p{L}\p{N}_@.-])@(\p{L}[\p{L}\p{N}_-]{1,23})/gu
const TYPING = /(?:^|[^\p{L}\p{N}_@.-])@([\p{L}\p{N}_-]*)$/u

const key = (name) => String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

/** "Ada", "Ada and Bo", "Ada, Bo and Juno". */
const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

export function createChannelState({ log = console.error } = {}) {
  /** Oldest first. An id is made from the time, so order by id is order by when. */
  let posts = []
  /** The number of the last word heard about each post. */
  const heard = new Map()
  const listeners = new Set()

  const tell = (what) => {
    for (const listener of [...listeners]) {
      try {
        listener(what)
      } catch (error) {
        log('crew channel: a listener threw', error)
      }
    }
  }

  const put = (post) => {
    posts = [...posts.filter((one) => one.id !== post.id), post].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  return {
    get posts() {
      return posts
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** The latest page of the channel, current to `seq`. Earlier posts already read stay. */
    setPosts({ posts: incoming, seq = 0 }) {
      for (const post of incoming) {
        const latest = heard.get(post.id)
        if (latest !== undefined && seq < latest) continue
        heard.set(post.id, Math.max(latest ?? 0, seq))
        put(post)
      }
      tell({ kind: 'posts' })
    },
    /** Posts from further back, current to `seq`, read when the person scrolls up. */
    addEarlier(earlier, seq = 0) {
      for (const post of earlier) {
        if (posts.some((one) => one.id === post.id)) continue
        heard.set(post.id, Math.max(heard.get(post.id) ?? 0, seq))
        put(post)
      }
      tell({ kind: 'posts' })
    },
    /**
     * What the stream said. Gives the post as it was and as it is, or null if this was not
     * about a post or was older than what is already known.
     */
    apply(event) {
      const now = event?.type === 'post' ? event.data : null
      if (!now || typeof now.id !== 'string') return null
      if (event.seq <= (heard.get(now.id) ?? 0)) return null
      const was = posts.find((one) => one.id === now.id) ?? null
      // From before the page that is held. Taking it would leave a gap between it and the
      // rest that reading back could never fill: it is read, as it then stands, when the
      // person reads back that far.
      if (!was && posts.length && now.id < posts[0].id) return null
      heard.set(now.id, event.seq)
      put(now)
      tell({ kind: 'post', postId: now.id })
      return { was, now }
    },
    /** The record went back: nothing numbered by the old one can be trusted. */
    reset() {
      posts = []
      heard.clear()
      tell({ kind: 'posts' })
    },
  }
}

/** The name being typed at the caret, after an `@`: where the `@` is and what follows it. */
export function mentionAt(text, caret) {
  const match = TYPING.exec(String(text).slice(0, caret))
  if (!match) return null
  return { start: caret - match[1].length - 1, query: match[1] }
}

/** The agents whose names begin as typed. */
export function candidates(agents, query, limit = 6) {
  const wanted = key(query)
  return agents.filter((agent) => key(agent.name).startsWith(wanted)).slice(0, limit)
}

/** Write a chosen name where one was being typed. */
export function complete(text, mention, name) {
  const before = text.slice(0, mention.start)
  // The caret may be inside a name already written: the rest of that name goes too.
  const after = text.slice(mention.start + 1 + mention.query.length).replace(/^[\p{L}\p{N}_-]+/u, '')
  const written = `${before}@${name}${after ? '' : ' '}`
  return { text: written + after, caret: written.length }
}

/**
 * Who a post would go to, said before it is sent. `ok` is whether it can be. `limit` is the
 * world's limit on how many answer a post that names nobody, or null for none.
 */
export function audience(text, agents, { limit = null } = {}) {
  if (!agents.length) return { ok: false, text: 'There is nobody in the crew yet.' }
  const byKey = new Map(agents.map((agent) => [key(agent.name), agent]))
  const names = [...String(text).matchAll(MENTION)].map((match) => match[1])
  const unknown = names.filter((name, at) => !byKey.has(key(name)) && names.findIndex((other) => key(other) === key(name)) === at)
  if (unknown.length) return { ok: false, text: `There is no agent called ${unknown.join(' or ')}.` }
  const ok = Boolean(String(text).trim())

  if (names.length) {
    const wanted = new Set(names.map((name) => byKey.get(key(name)).id))
    const named = agents.filter((agent) => wanted.has(agent.id))
    const busy = named.filter((agent) => BUSY.includes(agent.status)).map((agent) => agent.name)
    const wait = busy.length > 1
      ? ` ${listed(busy)} are busy and get it when they are free.`
      : busy.length ? ` ${busy[0]} is busy and gets it when it is free.` : ''
    return { ok, text: `Goes only to ${listed(named.map((agent) => agent.name))}.${wait}` }
  }

  const free = agents.filter((agent) => !BUSY.includes(agent.status)).length
  if (!free) return { ok, text: 'Everyone is busy, so nobody would get this. Name an agent with @ and it gets it when it is free.' }
  if (limit && limit < free) return { ok, text: `Goes to ${limit} of the ${free} agents that are free. Type @ to name one.` }
  return { ok, text: `Goes to every agent that is free: ${free} of ${agents.length} now. Type @ to name one.` }
}

const SKIPPED = { working: 'working', waiting: 'needs you', limit: 'over the limit', runtime: 'cannot run here', taken: 'taken', retired: 'retired' }

/**
 * A post as the dock shows it.
 *
 * @returns {{id: string, text: string, sent: string,
 *   replies: {agentId: string, name: string, text: string, note: string | null, canTask: boolean}[],
 *   notes: {tone: 'pend' | 'wait' | 'fail' | 'pass', text: string}[],
 *   claim: null | {state: string, agentId: string, title: string, line: string, canOpen: boolean, canRelease: boolean}}}
 */
export function postView(post, { workspaces }) {
  const of = (state) => post.to.filter((one) => one.state === state)
  const granted = post.claim?.state === 'granted' ? post.claim : null

  const went = post.to.filter((one) => one.state !== 'skipped' && one.state !== 'queued')
  const queued = of('queued')
  const skipped = of('skipped')
  const sent = [
    went.length ? `sent to ${went.map((one) => one.name).join(', ')}` : queued.length ? null : 'nobody was free',
    queued.length ? `queued for ${queued.map((one) => one.name).join(', ')}` : null,
    skipped.length ? `skipped ${skipped.map((one) => `${one.name} (${SKIPPED[one.reason] ?? one.reason ?? 'skipped'})`).join(', ')}` : null,
  ].filter(Boolean).join(' · ')

  const replies = post.to.filter((one) => one.state === 'replied' || one.state === 'claimed').map((one) => ({
    agentId: one.agentId,
    name: one.name,
    text: one.text || (one.state === 'claimed' ? 'I will take this.' : ''),
    note: one.reason === 'unplaced' ? 'would take it, and did not say where' : null,
    canTask: granted?.agentId !== one.agentId,
  }))

  const notes = [
    ...of('answering').map((one) => ({ tone: 'pend', text: `${one.name} is answering…` })),
    ...queued.map((one) => ({ tone: 'wait', text: `${one.name} is busy. It gets this when it is free.` })),
    ...of('failed').map((one) => ({
      tone: 'fail',
      text: one.reason === 'stopped' ? `${one.name} was stopped`
        : one.reason === 'restart' ? `${one.name} was cut off by a restart`
          : `${one.name} could not answer: ${one.reason ?? 'it failed'}`,
    })),
    ...of('passed').map((one) => ({ tone: 'pass', text: one.reason === 'taken' ? `${one.name} stood down: it was taken` : `${one.name} passed` })),
  ]

  let claim = null
  if (post.claim) {
    const { agentId, name, state, reason, conversationId, workspaceId } = post.claim
    if (state === 'granted') {
      const place = workspaces.find((one) => one.id === workspaceId)?.name ?? 'a workspace that has gone'
      claim = {
        state, agentId, title: `Taken by ${name}`,
        line: conversationId ? `Its task is in ${place}.` : 'Starting on it.',
        canOpen: Boolean(conversationId), canRelease: true,
      }
    } else {
      const why = reason === 'released' || reason === 'handed' ? `${name} was taken off it.`
        : reason === 'retired' ? `${name} left the crew.`
          : reason === 'restart' ? `The server restarted before ${name} began.`
            : `${name} could not start: ${String(reason ?? 'it is not known why').replace(/\.+$/, '')}.`
      claim = { state, agentId, title: 'Released', line: `${why} Nobody has this now.`, canOpen: false, canRelease: false }
    }
  }

  return { id: post.id, text: post.text, sent, replies, notes, claim }
}

/** What an agent just did to a post, in a few words, or null if it was nothing to remark on. */
export function headline(was, now) {
  if (!was) return null
  const held = (post) => (post.claim?.state === 'granted' ? post.claim : null)
  const [before, after] = [held(was), held(now)]
  if (after && after.agentId !== before?.agentId) return `${after.name} took a task`
  if (before && !after) return `${before.name} was taken off a task`

  const earlier = new Map(was.to.map((one) => [one.agentId, one.state]))
  const changed = now.to.filter((one) => earlier.get(one.agentId) !== one.state)
  const first = (state) => changed.find((one) => one.state === state)
  if (first('replied')) return `${first('replied').name} replied`
  if (first('failed')) return `${first('failed').name} could not answer`
  if (first('passed')) return `${first('passed').name} passed`
  return null
}
