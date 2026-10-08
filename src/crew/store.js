/**
 * What the page knows about the crew, in one place.
 *
 * Two things feed it. Snapshots, asked for over HTTP: the agents, the workspaces, the
 * settings. And the stream, which says everything that happens, in order. An agent's status
 * is whatever the latest event about it said, and a snapshot only overrules that when it is
 * at least as recent, which the server says by numbering its snapshot.
 *
 * It keeps the events of the conversations a card is showing and no others. Views subscribe
 * and are told what kind of thing changed, so each redraws only what it shows.
 *
 * No DOM, no network: both are someone else's job.
 */

/** A draft is a sentence or two on its way. This is only a guard against a runaway. */
const DRAFT_LIMIT = 200_000

const ENDINGS = ['finished', 'failed', 'interrupted']

export function createCrewStore({ log = console.error } = {}) {
  const state = {
    enabled: false,
    worldId: null,
    demo: false,
    agents: [],
    counts: { standard: { used: 0, limit: 0 }, curated: { used: 0 } },
    workspaces: [],
    specialists: [],
    autonomy: 'autonomous',
    channelLimit: null,
    link: 'live',
  }

  const listeners = new Set()
  const tell = (what) => {
    for (const listener of [...listeners]) {
      try {
        listener(what)
      } catch (error) {
        log('crew store: a listener threw', error)
      }
    }
  }

  /** The last event applied to each agent: what a snapshot has to be level with to win. */
  const heard = new Map()
  /** Agents whose conversation the stream named without saying which workspace it is in. */
  const unplaced = new Set()
  let strangers = false

  /** The conversations a card is showing: how many are showing it, its events, its draft. */
  const watched = new Map()

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const agent = (id) => state.agents.find((one) => one.id === id) ?? null

  function setRoster({ agents, counts, seq = 0 }) {
    const next = agents.map((incoming) => {
      const was = agent(incoming.id)
      const latest = heard.get(incoming.id) ?? 0
      if (!was || seq >= latest) {
        unplaced.delete(incoming.id)
        // Anything the stream has still to say from before this snapshot is old news.
        heard.set(incoming.id, Math.max(latest, seq))
        return { ...incoming }
      }
      // The stream is ahead of this snapshot: who the agent is comes from the snapshot, how
      // it is doing stays as the stream left it.
      const kept = { ...incoming, status: was.status, conversationId: was.conversationId, workspaceId: was.workspaceId }
      if (incoming.conversationId === was.conversationId) {
        kept.workspaceId = incoming.workspaceId
        unplaced.delete(incoming.id)
      }
      return kept
    })
    for (const id of [...unplaced]) if (!next.some((one) => one.id === id)) unplaced.delete(id)
    for (const id of [...heard.keys()]) if (!next.some((one) => one.id === id)) heard.delete(id)
    strangers = false
    if (same(next, state.agents) && same(counts, state.counts)) return
    state.agents = next
    state.counts = counts
    tell({ kind: 'roster' })
  }

  function setPlace(agentId, conversation) {
    const one = agent(agentId)
    if (!one) return
    unplaced.delete(agentId)
    if (one.conversationId === conversation.id && one.workspaceId === conversation.workspaceId) return
    state.agents = state.agents.map((each) =>
      each.id === agentId ? { ...each, conversationId: conversation.id, workspaceId: conversation.workspaceId } : each)
    tell({ kind: 'roster' })
  }

  function insert(talk, event) {
    const { events } = talk
    let at = events.length
    while (at > 0 && events[at - 1].seq > event.seq) at -= 1
    if (at > 0 && events[at - 1].seq === event.seq) return false
    events.splice(at, 0, event)
    return true
  }

  function applyEvent(event) {
    // What became of a post to the crew channel: no agent did it and no card shows it.
    if (!event.agentId) return
    const one = agent(event.agentId)
    if (!one) strangers = true
    else if (event.seq > (heard.get(one.id) ?? 0)) {
      heard.set(one.id, event.seq)
      // An agent answering the channel is busy, and is still in the task it was in.
      const aside = Boolean(event.postId)
      const moved = !aside && event.conversationId !== one.conversationId
      if (moved) unplaced.add(one.id)
      if (moved || event.status !== one.status) {
        state.agents = state.agents.map((each) =>
          each.id === one.id ? { ...each, status: event.status, conversationId: aside ? each.conversationId : event.conversationId } : each)
        tell({ kind: 'roster' })
      }
    }

    const talk = watched.get(event.conversationId)
    if (!talk) return
    const added = insert(talk, event)
    const settles = event.type === 'text' || ENDINGS.includes(event.type)
    if (settles) talk.draft = ''
    if (added || settles) tell({ kind: 'conversation', conversationId: event.conversationId })
  }

  function applyDelta({ conversationId, text }) {
    const talk = watched.get(conversationId)
    if (!talk || typeof text !== 'string' || !text) return
    if (talk.draft.length < DRAFT_LIMIT) talk.draft += text
    tell({ kind: 'draft', conversationId })
  }

  function watch(conversationId) {
    const talk = watched.get(conversationId)
    if (talk) talk.watchers += 1
    else watched.set(conversationId, { watchers: 1, events: [], draft: '' })
  }

  function unwatch(conversationId) {
    const talk = watched.get(conversationId)
    if (talk && (talk.watchers -= 1) <= 0) watched.delete(conversationId)
  }

  function addEvents(conversationId, events) {
    const talk = watched.get(conversationId)
    if (!talk) return
    let added = false
    for (const event of events) added = insert(talk, event) || added
    if (added) tell({ kind: 'conversation', conversationId })
  }

  /** The record went back: nothing numbered by the old one can be trusted. */
  function reset() {
    heard.clear()
    unplaced.clear()
    for (const [conversationId, talk] of watched) {
      talk.events = []
      talk.draft = ''
      tell({ kind: 'conversation', conversationId })
    }
  }

  const put = (key, value, kind) => {
    if (same(state[key], value)) return
    state[key] = value
    tell({ kind })
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setStatus({ enabled, worldId, demo }) {
      const next = { enabled: Boolean(enabled), worldId: worldId ?? null, demo: Boolean(demo) }
      if (Object.entries(next).every(([key, value]) => same(state[key], value))) return
      Object.assign(state, next)
      tell({ kind: 'settings' })
    },
    setRoster,
    setPlace,
    setWorkspaces: (workspaces) => put('workspaces', workspaces, 'workspaces'),
    setSpecialists: (specialists) => put('specialists', specialists, 'specialists'),
    setAutonomy: (autonomy) => put('autonomy', autonomy, 'settings'),
    setChannelLimit: (limit) => put('channelLimit', limit ?? null, 'settings'),
    setLink: (link) => put('link', link, 'link'),
    applyEvent,
    applyDelta,
    watch,
    unwatch,
    addEvents,
    reset,
    eventsOf: (conversationId) => watched.get(conversationId)?.events ?? [],
    draftOf: (conversationId) => watched.get(conversationId)?.draft ?? '',
    agent,
    workspace: (id) => state.workspaces.find((one) => one.id === id) ?? null,
    /** Whether the stream has mentioned something only a fresh snapshot can explain. */
    needsRoster: () => strangers || unplaced.size > 0,
  }
}
