// test/settlement-load.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { STOREYS, capacityOf, placesOf, platformsFor, stackHeights } from '../src/world/settlement-load.js'

const SMALL = { buildings: 1, stacks: 1 }
const MEDIUM = { buildings: 2, stacks: 2 }
const LARGE = { buildings: 4, stacks: 4 }

test('a deck holds a building for each place on its floor and three storeys on each stack', () => {
  assert.equal(STOREYS, 3)
  assert.deepEqual([SMALL, MEDIUM, LARGE].map(capacityOf), [4, 8, 16])
})

test('sessions go up, not out: the floors fill first, then every stack rises a storey at a time', () => {
  const places = placesOf([MEDIUM, SMALL])
  assert.equal(places.length, 12)
  // Three buildings on the two floors, then the three stacks' first storeys, and so on up.
  assert.deepEqual(places.slice(0, 3).map((p) => [p.deck, p.kind, p.spot]), [[0, 'floor', 0], [0, 'floor', 1], [1, 'floor', 0]])
  assert.deepEqual(places.slice(3, 6).map((p) => [p.deck, p.kind, p.spot, p.storey]), [[0, 'stack', 0, 0], [0, 'stack', 1, 0], [1, 'stack', 0, 0]])
  assert.deepEqual(places.slice(9).map((p) => p.storey), [2, 2, 2])
})

test('a stack is as high as the sessions in it, closed up, whichever of them have left', () => {
  const places = placesOf([MEDIUM])
  // Eight places: 0 and 1 on the floor, then stacks 0 and 1 alternately, three storeys each.
  assert.deepEqual(stackHeights(places, new Set([0, 1, 2, 3, 4, 5, 6, 7])), [[3, 3]])
  assert.deepEqual(stackHeights(places, new Set([0, 2])), [[1, 0]])
  // The middle storey's session has gone: what is left of that stack is two high, not three with a gap.
  assert.deepEqual(stackHeights(places, new Set([2, 6])), [[2, 0]])
  assert.deepEqual(stackHeights(places, new Set()), [[0, 0]])
})

test('a workspace is given platforms by what it has to hold: the biggest today, 31 sessions, takes four', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 16, 17, 31, 32, 33].map(platformsFor), [1, 1, 1, 1, 2, 2, 3, 4, 4, 5])
  // And four platforms as two large decks hold all 31 with a place to spare.
  assert.ok(capacityOf(LARGE) * 2 >= 31)
})
