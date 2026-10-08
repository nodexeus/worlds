/**
 * A conversation's events, as a card shows them.
 *
 * The record is a list of things that happened. A card shows fewer, larger things: a tool
 * call is one line however many events it took, a question is one card that is open or
 * answered, and a message that waited its turn is shown where it was finally heard. This is
 * the whole of that translation, and it touches no DOM.
 */

/** A megabyte of build log does not belong in a chat. The whole of it is in the record. */
const OUTPUT_LIMIT = 20_000

const ENDINGS = ['finished', 'failed', 'interrupted']

function duration(ms) {
  if (ms < 1000) return 'under 1s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** How a turn ended, in a few words. */
export function endingNote({ type, data = {} }) {
  if (type === 'failed') return `failed: ${data.reason || 'the runtime stopped'}`
  if (type === 'interrupted') {
    if (data.reason === 'restart') return 'interrupted when the server restarted'
    if (data.reason === 'lost') return 'interrupted: the server lost track of this turn'
    return 'stopped'
  }
  const bits = ['finished']
  if (Number.isFinite(data.durationMs)) bits.push(duration(data.durationMs))
  if (Number.isFinite(data.costUsd) && data.costUsd > 0) bits.push(`$${data.costUsd.toFixed(2)}`)
  return bits.join(' · ')
}

/** What an answered request was told, for the line it collapses to. */
export function answerLabel(item) {
  const answer = item.answer ?? {}
  if (item.type === 'approval') {
    if (answer.allow) return 'allowed'
    return answer.message ? `refused: ${answer.message}` : 'refused'
  }
  return (answer.answers ?? [answer.text]).filter((said) => typeof said === 'string').join(' · ')
}

const cut = (output) =>
  output.length > OUTPUT_LIMIT
    ? `${output.slice(0, OUTPUT_LIMIT)}\n… ${(output.length - OUTPUT_LIMIT).toLocaleString('en-US')} more characters`
    : output

/**
 * @param {object[]} events one conversation's, in any order, repeats allowed
 * @param {{draft?: string}} [options] `draft` is the text still arriving
 * @returns {object[]} items, each with a `kind`: message, text, tool, request, ending, draft
 */
export function transcript(events, { draft = '' } = {}) {
  const bySeq = new Map()
  for (const event of events) {
    if (event && Number.isFinite(event.seq) && typeof event.type === 'string') bySeq.set(event.seq, event)
  }
  const ordered = [...bySeq.values()].sort((a, b) => a.seq - b.seq)

  const items = []
  /** Messages by the number they were stored under, for the `queue` event that settles them. */
  const messages = new Map()
  /** This turn's tool lines, by the runtime's id for the call. */
  let tools = new Map()
  const requests = new Map()
  /** What the person said in the turn under way: what a retry would say again. */
  let said = []

  for (const event of ordered) {
    const { seq, type } = event
    const data = event.data ?? {}

    if (type === 'message') {
      const item = { kind: 'message', seq, text: String(data.text ?? ''), state: data.queued ? 'queued' : 'sent' }
      // A task the agent took from the crew channel begins with the post.
      if (data.postId) item.fromChannel = true
      messages.set(seq, item)
      items.push(item)
      said.push(item.text)
    } else if (type === 'queue') {
      const settled = (Array.isArray(data.of) ? data.of : []).map((of) => messages.get(of)).filter(Boolean)
      for (const item of settled) {
        if (data.outcome === 'delivered') {
          // Heard now, so shown now: after the turn it waited for.
          items.splice(items.indexOf(item), 1)
          items.push(item)
          item.state = 'sent'
        } else {
          item.state = 'cancelled'
        }
      }
      if (data.outcome === 'delivered') said = settled.map((item) => item.text)
    } else if (type === 'text') {
      items.push({ kind: 'text', seq, text: String(data.text ?? '') })
    } else if (type === 'tool') {
      let item = tools.get(data.id)
      if (!item) {
        item = { kind: 'tool', seq, id: data.id, name: data.name, summary: data.summary, state: 'running' }
        tools.set(data.id, item)
        items.push(item)
      }
      if (data.status === 'finished') item.state = 'done'
      if (data.status === 'failed') item.state = 'failed'
      if (typeof data.output === 'string' && data.output) item.output = cut(data.output)
    } else if (type === 'approval' || type === 'question') {
      const item = type === 'approval'
        ? { kind: 'request', seq, type, requestId: data.requestId, state: 'open', tool: data.tool, summary: data.summary }
        : { kind: 'request', seq, type, requestId: data.requestId, state: 'open', questions: Array.isArray(data.questions) ? data.questions : [] }
      requests.set(data.requestId, item)
      items.push(item)
    } else if (type === 'answer') {
      const item = requests.get(data.requestId)
      if (item && item.state === 'open') {
        const { requestId, ...answer } = data
        item.state = 'answered'
        item.answer = answer
      }
    } else if (ENDINGS.includes(type)) {
      for (const item of tools.values()) if (item.state === 'running') item.state = 'stopped'
      for (const item of requests.values()) if (item.state === 'open') item.state = 'lapsed'
      tools = new Map()
      const item = { kind: 'ending', seq, type, note: endingNote(event) }
      const unfinished = type === 'failed' || (type === 'interrupted' && data.reason)
      if (unfinished && said.length) item.again = said.join('\n\n')
      items.push(item)
      said = []
    }
  }

  // Trying again is offered only while nothing has been said since.
  const last = items.findLast((item) => item.kind !== 'message' || item.state !== 'cancelled')
  for (const item of items) {
    if (item.kind !== 'ending') continue
    if (item === last && item.again) item.retry = item.again
    delete item.again
  }

  if (draft) items.push({ kind: 'draft', text: draft })
  return items
}

/** The request the agent is stopped on: the earliest still open, or null. */
export function openRequest(items) {
  return items.find((item) => item.kind === 'request' && item.state === 'open') ?? null
}
