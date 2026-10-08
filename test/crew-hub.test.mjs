// test/crew-hub.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHub } from '../server/crew/hub.mjs'

test('a subscriber is handed events and fragments in the order they were sent', () => {
  const hub = createHub({ log() {} })
  const seen = []
  hub.subscribe((kind, payload) => seen.push([kind, payload]))
  hub.publish({ seq: 1 })
  hub.transient({ text: 'a' })
  hub.publish({ seq: 2 })
  assert.deepEqual(seen, [['event', { seq: 1 }], ['delta', { text: 'a' }], ['event', { seq: 2 }]])
  assert.equal(hub.size, 1)
})

test('after unsubscribing, nothing more arrives', () => {
  const hub = createHub({ log() {} })
  const seen = []
  const stop = hub.subscribe((kind, payload) => seen.push(payload))
  hub.publish({ seq: 1 })
  stop()
  stop()
  hub.publish({ seq: 2 })
  assert.deepEqual(seen, [{ seq: 1 }])
  assert.equal(hub.size, 0)
})

test('a subscriber that throws stops neither the others nor the sender', () => {
  const logged = []
  const hub = createHub({ log: (...args) => logged.push(args) })
  const seen = []
  hub.subscribe(() => {
    throw new Error('broken client')
  })
  hub.subscribe((kind, payload) => seen.push(payload))
  hub.publish({ seq: 1 })
  hub.publish({ seq: 2 })
  assert.deepEqual(seen, [{ seq: 1 }, { seq: 2 }])
  assert.equal(logged.length, 2)
})

test('a subscriber that leaves while being told does not disturb the round', () => {
  const hub = createHub({ log() {} })
  const seen = []
  const stop = hub.subscribe(() => stop())
  hub.subscribe((kind, payload) => seen.push(payload))
  hub.publish({ seq: 1 })
  assert.deepEqual(seen, [{ seq: 1 }])
})
