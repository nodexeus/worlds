/**
 * Raised levels: decided once per workspace, remembered, and never moved by anything else.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { levelFor, readLevels } from '../src/world/plot-levels.js'
import { mergeState } from '../src/game/merge-state.js'

test('a world without levels keeps everything on the ground', () => {
  assert.equal(levelFor('api', new Map([['api', 2]]), 1), 0)
  assert.equal(levelFor('api', new Map(), 0), 0)
  assert.equal(levelFor('api', new Map(), undefined), 0)
})

test('a new workspace gets a level from its own name alone', () => {
  const alone = levelFor('homepage', new Map(), 3)
  const crowded = levelFor('homepage', new Map([['api', 0], ['litellm', 2], ['roxon', 1]]), 3)
  assert.equal(alone, crowded, 'other workspaces do not move it')
  assert.ok(alone >= 0 && alone < 3)
  const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((n) => levelFor(n, new Map(), 3)))
  assert.equal(spread.size, 3, 'names spread across all the levels')
})

test('a remembered level wins, and is brought down to fit a world with fewer', () => {
  const natural = levelFor('homepage', new Map(), 3)
  const other = (natural + 1) % 3
  assert.equal(levelFor('homepage', new Map([['homepage', other]]), 3), other)
  assert.equal(levelFor('homepage', new Map([['homepage', 5]]), 3), 2)
})

test('levels read from the colony file are sanitised', () => {
  const levels = readLevels({ a: 0, b: 2, c: -1, d: 1.5, e: '2', f: null, g: 99 })
  assert.deepEqual([...levels], [['a', 0], ['b', 2]])
  assert.equal(readLevels(null).size, 0)
  assert.equal(readLevels([1, 2]).size, 0)
})

test('levels merge between tabs key by key, like the layout', () => {
  const out = mergeState({ levels: { a: 0, b: 1 } }, { levels: { a: 2, b: 1 } }, { levels: { a: 0, b: 0 } })
  assert.deepEqual(out.levels, { a: 2, b: 0 })
})
