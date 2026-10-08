/**
 * The world's live stream, in the page.
 *
 * One `EventSource` on `/api/crew/events`. A browser mends a dropped stream by itself and
 * tells the server the last event it was sent, so most of the time there is nothing to do
 * here. What it will not mend is a refusal (too many clients, a server that is starting):
 * then the source is closed for good, and this makes another, a little later each time.
 *
 * Whatever happens to the connection, a listener is given each stored event once, in order.
 *
 * @param {{url?: string, after?: number, EventSource?: any,
 *   setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout,
 *   onHello?: (hello: {seq: number, reset: boolean}) => void,
 *   onEvent?: (event: object) => void, onDelta?: (delta: object) => void,
 *   onState?: (state: 'live' | 'retrying') => void, log?: (...args: any[]) => void}} [options]
 */
export function connectStream({
  url = '/api/crew/events',
  after,
  EventSource: Source = globalThis.EventSource,
  setTimeout: later = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: forget = (timer) => globalThis.clearTimeout(timer),
  onHello = () => {},
  onEvent = () => {},
  onDelta = () => {},
  onState = () => {},
  log = console.error,
} = {}) {
  const FIRST_WAIT = 1000
  const LONGEST_WAIT = 30_000

  /** The last stored event given to the listener. */
  let seq = Number.isFinite(after) ? after : null
  let source = null
  let timer = null
  let wait = FIRST_WAIT
  let state = null
  let closed = false

  const tell = (fn, value) => {
    try {
      fn(value)
    } catch (error) {
      log('crew stream: a listener threw', error)
    }
  }

  const set = (next) => {
    if (state === next) return
    state = next
    tell(onState, next)
  }

  const parse = (frame) => {
    try {
      return JSON.parse(frame.data)
    } catch {
      return null
    }
  }

  function open() {
    const mine = new Source(seq === null ? url : `${url}?after=${seq}`)
    source = mine
    /** Whatever this source says after it has been replaced or closed is not heard. */
    const heard = (fn) => (frame) => {
      if (!closed && source === mine) fn(frame)
    }

    mine.addEventListener('hello', heard((frame) => {
      const hello = parse(frame)
      if (!hello || !Number.isFinite(hello.seq)) return
      wait = FIRST_WAIT
      // A record behind what was already seen is not the record that was being followed.
      const reset = seq !== null && hello.seq < seq
      if (reset || seq === null) seq = hello.seq
      set('live')
      tell(onHello, { seq: hello.seq, reset })
    }))

    mine.addEventListener('event', heard((frame) => {
      const event = parse(frame)
      if (!event || !Number.isFinite(event.seq)) return
      if (seq !== null && event.seq <= seq) return
      seq = event.seq
      tell(onEvent, event)
    }))

    mine.addEventListener('delta', heard((frame) => {
      const delta = parse(frame)
      if (delta) tell(onDelta, delta)
    }))

    mine.addEventListener('error', heard(() => {
      set('retrying')
      // Still connecting: the browser is trying again by itself, from the last event sent.
      if (mine.readyState !== 2) return
      mine.close()
      timer = later(() => {
        timer = null
        if (!closed) open()
      }, wait)
      wait = Math.min(wait * 2, LONGEST_WAIT)
    }))
  }

  set('live')
  open()

  return {
    close() {
      closed = true
      source?.close()
      forget(timer)
      timer = null
    },
    get seq() {
      return seq
    },
  }
}
