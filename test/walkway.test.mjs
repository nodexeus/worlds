// test/walkway.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { WALK, walkwayRoute } from '../src/world/walkway.js'

const near = (a, b, by = 1e-6) => Math.abs(a - b) < by

/** Walk the pieces end to end and say where and which way the last one leaves you. */
function follow(route) {
  let { x, z } = route.from
  let heading = route.heading
  for (const piece of route.pieces) {
    assert.ok(near(piece.x, x, 1e-6) && near(piece.z, z, 1e-6), `${piece.part} does not start where the last ended`)
    assert.ok(near(Math.sin(piece.turn - heading), 0, 1e-6) && Math.cos(piece.turn - heading) > 0, `${piece.part} does not face the way the last left`)
    const end = WALK[piece.part]
    const side = piece.mirror ? -1 : 1
    const ex = end.x * side
    const ez = end.z * (piece.stretch || 1)
    x += ex * Math.cos(heading) + ez * Math.sin(heading)
    z += -ex * Math.sin(heading) + ez * Math.cos(heading)
    heading += end.bend * side
  }
  return { x, z, heading }
}

test('the way from the square to a district bends: four turns, of a twelfth or a sixth of a circle, and it arrives square on', () => {
  const route = walkwayRoute({ x: -10, z: 4 }, { x: 22, z: 16 }, 1.2, 'local')
  const turns = route.pieces.filter((piece) => WALK[piece.part].bend)
  assert.deepEqual(turns.map((piece) => piece.part), ['walk-turn-30', 'walk-turn-60', 'walk-turn-60', 'walk-turn-30'])
  // Out one way and back the other, so it ends heading as it began.
  assert.deepEqual(turns.map((piece) => piece.mirror), [turns[0].mirror, !turns[0].mirror, turns[0].mirror, !turns[0].mirror])
  const end = follow(route)
  assert.ok(near(end.x, 22, 1e-6) && near(end.z, 16, 1e-6), `it ends at ${end.x}, ${end.z}`)
  assert.ok(near(Math.sin(end.heading - 1.2), 0) && Math.cos(end.heading - 1.2) > 0)
})

test('its straight pieces are the kit\'s, laid end to end and stretched by no more than a quarter', () => {
  const route = walkwayRoute({ x: 0, z: 0 }, { x: 5, z: 34 }, 0.1, 'crew')
  const straights = route.pieces.filter((piece) => piece.part === 'walk')
  assert.ok(straights.length >= 8)
  for (const piece of straights) assert.ok(piece.stretch > 0.74 && piece.stretch < 1.26, `stretched by ${piece.stretch}`)
  follow(route)
})

test('which way it bends first is the district\'s own, and the same every time', () => {
  const a = walkwayRoute({ x: 0, z: 0 }, { x: 0, z: 36 }, 0, 'local')
  const b = walkwayRoute({ x: 0, z: 0 }, { x: 0, z: 36 }, 0, 'crew')
  assert.deepEqual(a, walkwayRoute({ x: 0, z: 0 }, { x: 0, z: 36 }, 0, 'local'))
  assert.notEqual(a.pieces.find((piece) => WALK[piece.part].bend).mirror, b.pieces.find((piece) => WALK[piece.part].bend).mirror)
})

test('where it can be walked is every piece of it, as spans a robot can follow', () => {
  const route = walkwayRoute({ x: 0, z: 0 }, { x: 3, z: 36 }, 0, 'local')
  assert.equal(route.spans.length, route.pieces.length)
  for (const span of route.spans) {
    assert.ok(span.half > 0.3 && near(Math.hypot(span.ux, span.uz), 1))
    assert.equal(span.rise, 0)
  }
  // The middle of the route is on one of them.
  const mid = route.pieces[Math.floor(route.pieces.length / 2)]
  assert.ok(route.spans.some((span) => Math.hypot(span.x - mid.x, span.z - mid.z) < 3))
})

test('two places too near for a bend to fit between them get no route, and the caller falls back', () => {
  assert.equal(walkwayRoute({ x: 0, z: 0 }, { x: 0, z: 6 }, 0, 'local'), null)
  // Nor when the end is so far to one side that a leg would have to run backward.
  assert.equal(walkwayRoute({ x: 0, z: 0 }, { x: 40, z: 4 }, 0, 'local'), null)
})
