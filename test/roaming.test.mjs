// test/roaming.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextRoam, visitSpot } from '../src/agents/roaming.js'

/** A source of chance that gives back what it is handed, in order. */
const dealt = (...values) => () => values.shift() ?? 0

test('most of the time a roamer walks somewhere else and stays a while', () => {
  const plan = nextRoam(dealt(0.1, 0.5), { company: true })
  assert.equal(plan.kind, 'walk')
  assert.ok(plan.seconds >= 8 && plan.seconds <= 20)
})

test('now and then it stops by somebody, briefly', () => {
  const plan = nextRoam(dealt(0.6, 0.5), { company: true })
  assert.equal(plan.kind, 'visit')
  assert.ok(plan.seconds >= 6 && plan.seconds <= 12)
})

test('with nobody about there is nobody to stop by, and it walks', () => {
  assert.equal(nextRoam(dealt(0.6, 0.5), { company: false }).kind, 'walk')
})

test('and now and then it sits down for a good while', () => {
  const plan = nextRoam(dealt(0.9, 0.5), { company: true })
  assert.equal(plan.kind, 'rest')
  assert.ok(plan.seconds >= 20 && plan.seconds <= 45)
})

test('it never rests twice running: it gets up and goes somewhere', () => {
  assert.equal(nextRoam(dealt(0.9, 0.5), { company: true, rested: true }).kind, 'walk')
})

test('a visit ends a conversational step short of the other, on the near side', () => {
  const spot = visitSpot({ x: 0, z: 0 }, { x: 10, z: 0 })
  assert.ok(Math.abs(spot.x - 8.7) < 1e-9)
  assert.equal(spot.z, 0)
})

test('somebody already close enough is visited from where they stand', () => {
  assert.deepEqual(visitSpot({ x: 9.5, z: 0 }, { x: 10, z: 0 }), { x: 9.5, z: 0 })
})
