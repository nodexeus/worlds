/**
 * The flights that cross a world's sky: the plan for one, which is plain numbers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { mulberry } from '../src/world/planet.js'
import { planPass } from '../src/world/traffic.js'

const passes = (n, spec) => {
  const rand = mulberry(0x5f51)
  return Array.from({ length: n }, () => planPass(rand, spec))
}

test('a pass crosses the whole world: it starts and ends out past the edge of the ground', () => {
  for (const pass of passes(200)) {
    const end = { x: pass.from.x + pass.heading.x * pass.length, z: pass.from.z + pass.heading.z * pass.length }
    assert.ok(Math.hypot(pass.from.x, pass.from.z) > 360 && Math.hypot(end.x, end.z) > 360)
    assert.ok(Math.abs(Math.hypot(pass.heading.x, pass.heading.z) - 1) < 1e-9)
  }
})

test('it flies over the campus, over the buildings and under the camera', () => {
  for (const pass of passes(200)) {
    // Nearest it comes to the middle of the world: within sight of it, never far off to one side.
    const along = -(pass.from.x * pass.heading.x + pass.from.z * pass.heading.z)
    const nearest = Math.hypot(pass.from.x + pass.heading.x * along, pass.from.z + pass.heading.z * along)
    // The ground is some 720 across now, and a campus with two districts fills the middle 300 of it.
    assert.ok(nearest < 100, `a pass ${nearest.toFixed(0)} from the middle`)
    assert.ok(pass.height >= 15 && pass.height <= 23)
    assert.ok(pass.speed >= 16 && pass.speed <= 24)
  }
})

test('a flight is one to three craft, the others off the leader\'s wings and behind it', () => {
  const seen = new Set()
  for (const pass of passes(300)) {
    seen.add(pass.craft.length)
    assert.deepEqual(pass.craft[0].back, 0)
    assert.deepEqual(pass.craft[0].out, 0)
    for (const craft of pass.craft.slice(1)) {
      assert.ok(craft.back > 5 && Math.abs(craft.out) > 5, 'clear of the leader')
    }
    if (pass.craft.length === 3) assert.ok(pass.craft[1].out * pass.craft[2].out < 0, 'one on each wing')
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3])
  for (const pass of passes(50, { flight: [2, 2] })) assert.equal(pass.craft.length, 2)
})

test('no two passes are the same', () => {
  const all = passes(40)
  const bearings = new Set(all.map((p) => Math.atan2(p.heading.z, p.heading.x).toFixed(2)))
  assert.ok(bearings.size > 30)
})
