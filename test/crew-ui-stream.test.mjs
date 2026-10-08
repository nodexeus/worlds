// test/crew-ui-stream.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { connectStream } from '../src/crew/stream.js'

/** A stand-in for the browser's EventSource, and for its clock. */
function world() {
  const sources = []
  const timers = []
  class FakeSource {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.listeners = {}
      this.closed = false
      sources.push(this)
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn
    }
    close() {
      this.closed = true
      this.readyState = 2
    }
    /** As the server sending a frame. */
    say(type, data, id) {
      this.listeners[type]?.({ data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId: id === undefined ? '' : String(id) })
    }
    /** As the browser giving up on it: a refusal, or a network that is gone. */
    fail() {
      this.readyState = 2
      this.listeners.error?.({})
    }
    /** As the browser losing it and trying again by itself. */
    blip() {
      this.readyState = 0
      this.listeners.error?.({})
    }
  }
  const seen = []
  const options = {
    EventSource: FakeSource,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true
    },
    onHello: (hello) => seen.push(['hello', hello]),
    onEvent: (event) => seen.push(['event', event.seq]),
    onDelta: (delta) => seen.push(['delta', delta.text]),
    onState: (state) => seen.push(['state', state]),
  }
  /** Run the retry that is waiting, saying how long it was set for. */
  const tick = () => {
    const timer = timers.filter((t) => !t.cleared).at(-1)
    timer.cleared = true
    timer.fn()
    return timer.ms
  }
  return { sources, timers, seen, options, tick }
}

const event = (seq) => ({ seq, conversationId: 'c', agentId: 'a', type: 'text', status: 'working', data: {} })

test('it connects, and reports the greeting, events and fragments as they come', () => {
  const w = world()
  const stream = connectStream(w.options)
  assert.equal(w.sources[0].url, '/api/crew/events')
  w.sources[0].say('hello', { seq: 4 })
  w.sources[0].say('event', event(5), 5)
  w.sources[0].say('delta', { conversationId: 'c', agentId: 'a', text: 'He' })
  w.sources[0].say('event', event(6), 6)
  assert.deepEqual(w.seen, [['state', 'live'], ['hello', { seq: 4, reset: false }], ['event', 5], ['delta', 'He'], ['event', 6]])
  assert.equal(stream.seq, 6)
})

test('asked to start from somewhere, it says so in the address', () => {
  const w = world()
  connectStream({ ...w.options, after: 12 })
  assert.equal(w.sources[0].url, '/api/crew/events?after=12')
})

test('an event it has already been given is not reported twice', () => {
  const w = world()
  connectStream(w.options)
  w.sources[0].say('hello', { seq: 0 })
  for (const seq of [1, 2, 2, 1, 3]) w.sources[0].say('event', event(seq), seq)
  assert.deepEqual(w.seen.filter(([kind]) => kind === 'event'), [['event', 1], ['event', 2], ['event', 3]])
})

test('a frame that is not JSON is dropped and the stream goes on', () => {
  const w = world()
  connectStream(w.options)
  w.sources[0].say('hello', { seq: 0 })
  w.sources[0].say('event', '{not json', 1)
  w.sources[0].say('delta', 'nor this')
  w.sources[0].say('event', event(1), 1)
  assert.deepEqual(w.seen.slice(2), [['event', 1]])
})

test('a source the browser gave up on is replaced, asking for everything since the last event', () => {
  const w = world()
  connectStream(w.options)
  w.sources[0].say('hello', { seq: 0 })
  w.sources[0].say('event', event(7), 7)
  w.sources[0].fail()
  assert.deepEqual(w.seen.at(-1), ['state', 'retrying'])
  assert.equal(w.sources.length, 1, 'not at once')
  assert.equal(w.tick(), 1000)
  assert.equal(w.sources[1].url, '/api/crew/events?after=7')
  w.sources[1].say('hello', { seq: 9 })
  assert.deepEqual(w.seen.slice(-2), [['state', 'live'], ['hello', { seq: 9, reset: false }]])
})

test('each failed try waits twice as long, up to half a minute, and a greeting starts the count again', () => {
  const w = world()
  connectStream(w.options)
  const waits = []
  for (let n = 0; n < 7; n += 1) {
    w.sources.at(-1).fail()
    waits.push(w.tick())
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000])
  w.sources.at(-1).say('hello', { seq: 0 })
  w.sources.at(-1).fail()
  assert.equal(w.tick(), 1000)
})

test('a blip the browser is mending by itself is reported, and no second source is made', () => {
  const w = world()
  connectStream(w.options)
  w.sources[0].say('hello', { seq: 0 })
  w.sources[0].blip()
  assert.deepEqual(w.seen.at(-1), ['state', 'retrying'])
  assert.equal(w.timers.length, 0)
  w.sources[0].say('hello', { seq: 0 })
  assert.deepEqual(w.seen.slice(-2), [['state', 'live'], ['hello', { seq: 0, reset: false }]])
  assert.equal(w.sources.length, 1)
})

test('a record that has gone back, as after a restore, starts the count again and says so', () => {
  const w = world()
  const stream = connectStream(w.options)
  w.sources[0].say('hello', { seq: 0 })
  w.sources[0].say('event', event(40), 40)
  w.sources[0].fail()
  w.tick()
  w.sources[1].say('hello', { seq: 3 })
  assert.deepEqual(w.seen.at(-1), ['hello', { seq: 3, reset: true }])
  assert.equal(stream.seq, 3)
  w.sources[1].say('event', event(4), 4)
  assert.deepEqual(w.seen.at(-1), ['event', 4])
})

test('closed, it lets go of the source and of any retry, and says nothing more', () => {
  const w = world()
  const stream = connectStream(w.options)
  w.sources[0].fail()
  stream.close()
  assert.equal(w.timers.every((timer) => timer.cleared), true)

  const second = world()
  const open = connectStream(second.options)
  second.sources[0].say('hello', { seq: 0 })
  open.close()
  assert.equal(second.sources[0].closed, true)
  const before = second.seen.length
  second.sources[0].say('event', event(1), 1)
  second.sources[0].fail()
  assert.equal(second.seen.length, before)
  assert.equal(second.timers.length, 0)
})

test('a listener that throws does not break the stream', () => {
  const w = world()
  const stream = connectStream({ ...w.options, onEvent: () => { throw new Error('a view fell over') }, log() {} })
  w.sources[0].say('hello', { seq: 0 })
  w.sources[0].say('event', event(1), 1)
  w.sources[0].say('event', event(2), 2)
  assert.equal(stream.seq, 2)
})
