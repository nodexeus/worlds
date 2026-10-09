// test/districts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { CORE_CELLS, HEX_DIRS, fits, hexDistance, inDistrict } from '../src/world/plot-move.js'
import { allocateCells } from '../src/world/plots.js'
import { districtOf, frameDelta, landing, squareEnd, toFrame, toWorld } from '../src/world/districts.js'
import { causewayOf, onSpan } from '../src/world/crossing-spans.js'

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

test('each district\'s walkway leaves the square from its own side and arrives at its first platform, in a straight line', () => {
  assert.deepEqual(squareEnd('local'), LIBRARY)
  assert.deepEqual(squareEnd('crew'), SHIP)
  for (const district of ['local', 'crew']) {
    const [origin, beside] = toWorld(district, [{ q: 0, r: 0 }, { q: 1, r: 0 }])
    const end = squareEnd(district)
    assert.deepEqual(landing(district, [beside, origin]), origin)
    // Eight platforms out, on the line the gate and the Library stand on.
    assert.equal(hexDistance(origin, end), 8)
    assert.equal(origin.r, end.r)
  }
  // With nothing on its first platform the walkway goes to whatever is nearest, and to nothing at all if nothing is there.
  assert.deepEqual(landing('local', toWorld('local', [{ q: 2, r: 0 }, { q: 1, r: 0 }])), toWorld('local', [{ q: 1, r: 0 }])[0])
  assert.equal(landing('local', []), null)
})

const WORLD = { reach: 5, gap: 1.4, levelStep: 1.35, deckTop: 0.45 }

test('a walkway is a level run of plates from one rim to the other, each about as long as a crossing', () => {
  const way = causewayOf({ x: 0, z: 0 }, { x: 40, z: 0 }, { ...WORLD, rise: 0 })
  // Thirty units between the rims, and a crossing is 2.8 long.
  assert.equal(way.plates.length, 11)
  assert.ok(way.plates.every((plate) => Math.abs(plate.size - 30 / 11) < 1e-9 && plate.z === 0))
  assert.ok(Math.abs(way.plates[0].x - plate0()) < 1e-9)
  assert.ok(Math.abs(way.plates.at(-1).x + way.plates.at(-1).size / 2 - 35) < 1e-9, 'the last plate ends at the far rim')
  assert.equal(way.stair, null)
  assert.equal(way.spans.length, 1)
  // Walked on from rim to rim, and not beside it.
  assert.equal(onSpan(way.spans[0], 5.1, 0, 1), true)
  assert.equal(onSpan(way.spans[0], 34.9, 0.9, 1), true)
  assert.equal(onSpan(way.spans[0], 20, 1.2, 1), false)
  assert.equal(onSpan(way.spans[0], 4, 0, 1), false)
  function plate0() { return 5 + 30 / 11 / 2 }
})

test('where the district stands a level up, the last stretch is one flight of stairs', () => {
  const way = causewayOf({ x: 0, z: 0 }, { x: 0, z: 40 }, { ...WORLD, rise: 1 })
  assert.ok(Math.abs(way.stair.z - (35 - 1.4)) < 1e-9)
  assert.equal(way.spans.length, 2)
  assert.equal(way.spans[1].rise, 1.35)
  assert.ok(Math.abs(way.spans[0].half * 2 - (30 - 2.8)) < 1e-9, 'the level run stops where the flight begins')
  assert.ok(Math.abs(way.plates.at(-1).z + way.plates.at(-1).size / 2 - (35 - 2.8)) < 1e-9)
  assert.equal(way.heading, 0)
})

test('two platforms too near each other have no walkway between them', () => {
  assert.equal(causewayOf({ x: 0, z: 0 }, { x: 11, z: 0 }, { ...WORLD, rise: 0 }), null)
})

test('nothing either district may hold is within reach of the other, or beside the square', () => {
  // Everything a district can be given, out to the pool's edge.
  const held = (district) => {
    const out = []
    for (let q = -12; q < 12; q++) for (let r = -12; r < 12; r++) if (inDistrict({ q, r })) out.push(toWorld(district, [{ q, r }])[0])
    return out
  }
  const local = held('local')
  const crew = held('crew')
  assert.ok(local.length > 150 && crew.length === local.length)
  const nearest = Math.min(...local.map((a) => Math.min(...crew.map((b) => hexDistance(a, b)))))
  assert.ok(nearest >= 11, `the districts come within ${nearest} platforms of each other`)
  // And each is at least five platforms from the square, which is the room its walkway winds in.
  const toSquare = Math.min(...[...local, ...crew].map((cell) => Math.min(hexDistance(cell, SHIP), hexDistance(cell, LIBRARY))))
  assert.ok(toSquare >= 5, `a district comes within ${toSquare} platforms of the square`)
  for (const cell of [...local, ...crew]) {
    assert.ok(!touches(cell, SHIP) && !touches(cell, LIBRARY), `${key(cell)} is beside the square`)
    assert.ok(key(cell) !== key(SHIP) && key(cell) !== key(LIBRARY))
  }
})

test('a district is round about its origin for three platforms on every side', () => {
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const cell = { q, r }
      if (hexDistance(cell, { q: 0, r: 0 }) <= 3) assert.equal(inDistrict(cell), true, key(cell))
    }
  }
  // Past that, on the square's side only, it stops: straight across, the same either side.
  assert.equal(inDistrict({ q: -4, r: 0 }), false)
  assert.equal(inDistrict({ q: -5, r: 4 }), true)
  assert.equal(inDistrict({ q: -6, r: 4 }), false)
  assert.equal(inDistrict({ q: -1, r: -4 }), true)
  assert.equal(inDistrict({ q: -2, r: -4 }), false)
  assert.equal(inDistrict({ q: 9, r: -3 }), true)
})

test('a workspace is never given ground that is not its district\'s', () => {
  const projects = Array.from({ length: 30 }, (_, n) => ({ id: `p${n}`, size: 9 }))
  for (const cells of allocateCells(projects).values()) {
    assert.ok(cells.length > 0)
    for (const cell of cells) assert.ok(inDistrict(cell), `${key(cell)} is on the square's side`)
  }
})

test('one remembered there from before is moved to its own side, and the rest stay put', () => {
  const previous = new Map([['old', [{ q: -5, r: 0 }]], ['stays', [{ q: -1, r: 0 }]]])
  const laid = allocateCells([{ id: 'old', size: 1 }, { id: 'stays', size: 1 }], previous)
  assert.ok(inDistrict(laid.get('old')[0]))
  assert.deepEqual(laid.get('stays'), [{ q: -1, r: 0 }])
})

test('a workspace cannot be carried across toward the square, however it is dropped', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]], ['b', [{ q: 1, r: 0 }]]])
  assert.equal(fits(layout, 'a', 0, 1), true)
  assert.equal(fits(layout, 'a', -3, 0), true)
  assert.equal(fits(layout, 'a', -4, 0), false)
  assert.equal(fits(layout, 'b', -12, 0), false)
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
