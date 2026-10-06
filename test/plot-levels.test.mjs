/**
 * Raised levels: decided once per workspace, remembered, and never moved by anything else.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { levelFor, readLevels, settleLevels } from '../src/world/plot-levels.js'
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

// ── settling a whole campus ───────────────────────────────────────────────────

/** Whether every workspace can reach every other, a staircase being one level at most. */
function connected(plots, levels) {
  if (!plots.length) return true
  const seen = new Set([plots[0].id])
  const queue = [plots[0].id]
  const byId = new Map(plots.map((p) => [p.id, p]))
  while (queue.length) {
    const here = queue.shift()
    for (const next of byId.get(here).neighbours) {
      if (seen.has(next) || Math.abs(levels.get(here) - levels.get(next)) > 1) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen.size === plots.length
}

test('a campus that is already connected is left exactly as it is', () => {
  const plots = [
    { id: 'a', neighbours: ['b'] },
    { id: 'b', neighbours: ['a', 'c'] },
    { id: 'c', neighbours: ['b'] },
  ]
  const remembered = new Map([['a', 0], ['b', 1], ['c', 2]])
  assert.deepEqual([...settleLevels(plots, remembered, 3)], [['a', 0], ['b', 1], ['c', 2]])
})

test('a workspace whose only neighbour is two levels away is brought within reach', () => {
  const plots = [
    { id: 'homepage', neighbours: ['agent-setup'] },
    { id: 'agent-setup', neighbours: ['homepage', 'api'] },
    { id: 'api', neighbours: ['agent-setup'] },
  ]
  const remembered = new Map([['homepage', 0], ['agent-setup', 2], ['api', 2]])
  const levels = settleLevels(plots, remembered, 3)
  assert.equal(connected(plots, levels), true)
  assert.equal(levels.get('homepage'), 1, 'it moves one level, toward its neighbour, and no further')
  assert.equal(levels.get('agent-setup'), 2, 'the neighbour it joins is not disturbed')
  assert.equal(levels.get('api'), 2)
})

test('two groups that cannot reach each other are joined', () => {
  // The layout the bug was reported on: a low pair cut off from a high group.
  const plots = [
    { id: 'sqd-bulk-register', neighbours: ['litellm', 'blockvisor', 'roxon', 'worker-outer-app', 'worlds'] },
    { id: 'litellm', neighbours: ['sqd-bulk-register', 'agent-setup', 'api', 'blockvisor'] },
    { id: 'homepage', neighbours: ['agent-setup'] },
    { id: 'worker-outer-app', neighbours: ['worlds', 'sqd-bulk-register'] },
    { id: 'agent-setup', neighbours: ['api', 'litellm', 'homepage'] },
    { id: 'api', neighbours: ['litellm', 'agent-setup'] },
    { id: 'blockvisor', neighbours: ['roxon', 'sqd-bulk-register', 'litellm'] },
    { id: 'roxon', neighbours: ['sqd-migrator', 'sqd-bulk-register', 'blockvisor'] },
    { id: 'sqd-migrator', neighbours: ['roxon'] },
    { id: 'worlds', neighbours: ['worker-outer-app', 'sqd-bulk-register'] },
  ]
  const remembered = new Map(Object.entries({
    'sqd-bulk-register': 2, litellm: 2, homepage: 0, 'worker-outer-app': 0, 'agent-setup': 2,
    api: 2, blockvisor: 1, roxon: 2, 'sqd-migrator': 2, worlds: 0,
  }))
  assert.equal(connected(plots, remembered), false, 'the saved levels really are cut off')
  const levels = settleLevels(plots, remembered, 3)
  assert.equal(connected(plots, levels), true)
  const moved = plots.filter((p) => levels.get(p.id) !== remembered.get(p.id)).map((p) => p.id)
  assert.ok(moved.length <= 3, `moved more than it needed to: ${moved.join(', ')}`)
})

test('every layout ends up connected, whatever the names give', () => {
  // A ring of twelve, each touching the next: with levels from names alone some are cut off.
  const ids = Array.from({ length: 12 }, (_, i) => `project-${i}`)
  const plots = ids.map((id, i) => ({ id, neighbours: [ids[(i + 11) % 12], ids[(i + 1) % 12]] }))
  const levels = settleLevels(plots, new Map(), 3)
  assert.equal(connected(plots, levels), true)
  for (const level of levels.values()) assert.ok(level >= 0 && level <= 2)
})

test('settling is repeatable, and settles for good', () => {
  const plots = [
    { id: 'a', neighbours: ['b'] },
    { id: 'b', neighbours: ['a', 'c'] },
    { id: 'c', neighbours: ['b'] },
  ]
  const remembered = new Map([['a', 0], ['b', 2], ['c', 0]])
  const once = settleLevels(plots, remembered, 3)
  assert.deepEqual([...settleLevels(plots, remembered, 3)], [...once])
  assert.deepEqual([...settleLevels(plots, once, 3)], [...once], 'a settled campus is not moved again')
})

test('a workspace that touches nothing keeps its own level', () => {
  const levels = settleLevels([{ id: 'alone', neighbours: [] }], new Map([['alone', 2]]), 3)
  assert.equal(levels.get('alone'), 2)
})
