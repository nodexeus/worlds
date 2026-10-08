// server/crew/stream.mjs
import { CrewError } from './errors.mjs'

/** How many events are read from the record at a time while a client catches up. */
const PAGE = 500
/** What may pile up for a client while it is still catching up. */
const MAX_PENDING = 20_000

/** How many clients each world's hub has on its stream. The hub has other listeners too. */
const clients = new WeakMap()

const frame = (event, data, id) => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

/**
 * The live stream: one long reply of server-sent events, per client, for the whole world.
 *
 *   event: hello   { seq }      where the world's record stood when the client connected
 *   event: event   <an event>   with `id:` its sequence number
 *   event: delta   { conversationId, agentId, text }   a fragment, not stored, no id
 *   : hb                        now and then, so nothing in between closes a quiet stream
 *
 * A client says where it got to with `?after=<seq>`, or the `Last-Event-ID` header a
 * browser sends by itself when it reconnects (the later of the two when both are given), and is sent everything since, then whatever
 * happens. With neither it starts from now. Nothing is sent twice and nothing is missed:
 * the client is subscribed before the record is read, and what arrived meanwhile is sent
 * after, less what the record already covered.
 *
 * A live client that cannot keep up is disconnected. It will come back and catch up, which
 * costs less than holding everything it has not read. Catching up itself goes at the
 * client's own pace.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {{events: any, hub: any}} crew
 * @param {{heartbeatMs?: number, maxBufferedBytes?: number, maxClients?: number}} [options]
 */
export async function serveEvents(req, res, url, { events, hub }, {
  heartbeatMs = 15_000, maxBufferedBytes = 4 * 1024 * 1024, maxClients = 100,
} = {}) {
  // A browser that reconnects asks the address it first asked, and adds the last id it was
  // sent. Whichever is further on is where it got to.
  const places = [url.searchParams.get('after'), req.headers['last-event-id'] ?? null].filter((value) => value !== null)
  if (places.some((value) => !/^\d{1,15}$/.test(value))) {
    throw new CrewError('bad_query', 'after is the number of the last event seen', 400)
  }
  const asked = places.length ? Math.max(...places.map(Number)) : null
  if ((clients.get(hub) ?? 0) >= maxClients) {
    throw new CrewError('too_many_clients', 'Too many clients are connected to this world', 503)
  }

  /** What arrived while the record was being read. Null once the client is live. */
  let pending = []
  let last = 0
  let closed = false

  const write = (chunk) => {
    if (closed) return
    res.write(chunk)
    if (res.writableLength > maxBufferedBytes) res.destroy()
  }

  /** Resolves when the client has taken what it was sent, or has gone. */
  const taken = () =>
    new Promise((resolve) => {
      const done = () => {
        res.off('drain', done)
        res.off('close', done)
        resolve()
      }
      res.once('drain', done)
      res.once('close', done)
    })

  const unsubscribe = hub.subscribe((kind, payload) => {
    if (pending) {
      // Fragments are of the moment: one from before the client was live is of no use.
      if (kind === 'event') pending.push(payload)
      if (pending.length > MAX_PENDING) res.destroy()
      return
    }
    if (kind === 'delta') return write(frame('delta', payload))
    if (payload.seq <= last) return
    last = payload.seq
    write(frame('event', payload, payload.seq))
  })
  clients.set(hub, (clients.get(hub) ?? 0) + 1)
  let heartbeat = null
  const leave = () => {
    if (closed) return
    closed = true
    unsubscribe()
    clearInterval(heartbeat)
    clients.set(hub, clients.get(hub) - 1)
  }
  res.on('close', leave)

  let head
  try {
    head = await events.head()
  } catch (error) {
    leave()
    throw error
  }
  // A client ahead of the record (the database was restored, say) is started from the head
  // and told where that is, which is how it knows to start again.
  last = asked === null ? head : Math.min(asked, head)
  if (closed) return

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // For a proxy that would otherwise hold the stream back to send it in one piece.
    'X-Accel-Buffering': 'no',
  })
  write(frame('hello', { seq: head }))
  heartbeat = setInterval(() => write(': hb\n\n'), heartbeatMs)
  heartbeat.unref()

  try {
    for (;;) {
      if (closed) return
      const page = await events.after(last, PAGE)
      for (const event of page) {
        if (closed) return
        last = event.seq
        // Catching up is sent at the client's pace. Being behind is what catching up is: the
        // limit on how far behind a client may fall is for one that is live.
        if (!res.write(frame('event', event, event.seq))) await taken()
      }
      if (page.length < PAGE) break
    }
  } catch (error) {
    // The reply has begun, so there is no status left to give. Hang up: the client comes
    // back and asks again from where it got to.
    console.error('crew stream: catching a client up failed', error)
    res.destroy()
    return
  }

  for (const event of pending) {
    if (event.seq <= last) continue
    last = event.seq
    write(frame('event', event, event.seq))
  }
  pending = null
}
