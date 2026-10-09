// test/districts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { CORE_CELLS, HEX_DIRS, fits, hexDistance } from '../src/world/plot-move.js'
import { allocateCells } from '../src/world/plots.js'
import { causeway, districtOf, frameDelta, toFrame, toWorld } from '../src/world/districts.js'

const key = (c) => `${c.q},${c.r}`
const touches = (a, b) => HEX_DIRS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r)
const [SHIP, LIBRARY] = CORE_CELLS

test('a crew workspace belongs to the crew\'s district and everything else to the local one', () => {
  assert.equal(districtOf('crew:01ab'), 'crew')
  assert.equal(districtOf('worlds'), 'local')
  assert.equal(districtOf('crew'), 'local')
})

test('a district\'s cells go to the campus and come back unchanged', () => {
  const cells = [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 3, r: 2 }]
  for (const district of ['local', 'crew']) {
    assert.deepEqual(toFrame(district, toWorld(district, cells)), cells)
    // Neighbours stay neighbours, so a workspace keeps its shape wherever it is put.
    assert.ok(touches(...toWorld(district, [{ q: 0, r: 0 }, { q: 1, r: -1 }])))
  }
})

test('a walkway of two platforms runs from the square to each district, on opposite sides', () => {
  const east = causeway('local')
  const west = causeway('crew')
  assert.equal(east.length, 2)
  assert.equal(west.length, 2)
  // Each starts beside the square and ends beside its district's first platform.
  assert.ok(touches(east[0], LIBRARY) && touches(east[0], east[1]))
  assert.ok(touches(west[0], SHIP) && touches(west[0], west[1]))
  assert.ok(touches(east[1], toWorld('local', [{ q: 0, r: 0 }])[0]))
  assert.ok(touches(west[1], toWorld('crew', [{ q: 0, r: 0 }])[0]))
  const all = [...east, ...west, SHIP, LIBRARY].map(key)
  assert.equal(new Set(all).size, 6, 'no two of them are the same platform')
})

test('nothing either district may hold is within reach of the other, or beside the square', () => {
  // Everything a district can be given: its own half of the lattice, out to the pool's edge.
  const held = (district) => {
    const out = []
    for (let q = 0; q < 12; q++) for (let r = -12; r < 12; r++) out.push(toWorld(district, [{ q, r }])[0])
    return out
  }
  const local = held('local')
  const crew = held('crew')
  const nearest = Math.min(...local.map((a) => Math.min(...crew.map((b) => hexDistance(a, b)))))
  assert.ok(nearest >= 7, `the districts come within ${nearest} platforms of each other`)
  for (const cell of [...local, ...crew]) {
    assert.ok(!touches(cell, SHIP) && !touches(cell, LIBRARY), `${key(cell)} is beside the square`)
  }
})

test('a workspace is never given ground on the square\'s side of its district', () => {
  const projects = Array.from({ length: 30 }, (_, n) => ({ id: `p${n}`, size: 9 }))
  for (const cells of allocateCells(projects).values()) {
    assert.ok(cells.length > 0)
    for (const cell of cells) assert.ok(cell.q >= 0, `${key(cell)} is on the square's side`)
  }
})

test('one remembered there from before is moved to its own side, and the rest stay put', () => {
  const previous = new Map([['old', [{ q: -1, r: 0 }]], ['stays', [{ q: 1, r: 0 }]]])
  const laid = allocateCells([{ id: 'old', size: 1 }, { id: 'stays', size: 1 }], previous)
  assert.ok(laid.get('old')[0].q >= 0)
  assert.deepEqual(laid.get('stays'), [{ q: 1, r: 0 }])
})

test('a workspace cannot be carried across to the square\'s side, however it is dropped', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]], ['b', [{ q: 1, r: 0 }]]])
  assert.equal(fits(layout, 'a', 0, 1), true)
  assert.equal(fits(layout, 'a', -1, 0), false)
  assert.equal(fits(layout, 'b', -2, 0), false)
})

test('a carry measured on the campus is the same carry in the district\'s own terms', () => {
  assert.deepEqual(frameDelta('local', 2, -1), { dq: 2, dr: -1 })
  // The crew's district faces the other way, so east on the campus is west in its terms.
  assert.deepEqual(frameDelta('crew', 2, -1), { dq: -2, dr: 1 })
  const cell = { q: 3, r: 1 }
  const moved = toWorld('crew', [{ q: cell.q - 2, r: cell.r + 1 }])[0]
  const before = toWorld('crew', [cell])[0]
  assert.deepEqual({ dq: moved.q - before.q, dr: moved.r - before.r }, { dq: 2, dr: -1 })
})
