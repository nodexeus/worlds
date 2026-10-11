import test from 'node:test'
import assert from 'node:assert/strict'
import { TILE, bentBounds, boundTile, tileOf } from '../src/world/tiles.js'

/** The bend the shaders put on a point: see `bcBend` in core/curve.js. */
const bend = (p, { focus, forward, amount }) => {
  const dx = p.x - focus.x
  const dz = p.z - focus.z
  const ahead = Math.max(0, dx * forward.x + dz * forward.y)
  return { x: p.x, y: p.y - amount * (ahead * ahead + (dx * dx + dz * dz) * 0.22), z: p.z }
}

test('a thing is filed under the square of ground it stands on', () => {
  assert.deepEqual(tileOf(0, 0), { tx: 0, tz: 0 })
  assert.deepEqual(tileOf(TILE - 0.01, -0.01), { tx: 0, tz: -1 })
  assert.deepEqual(tileOf(-TILE * 2.5, TILE * 3.2), { tx: -3, tz: 3 })
})

test('the box a tile is looked for in holds everything on it once the world has bent it, wherever the view is', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let trial = 0; trial < 300; trial++) {
    const a = rand() * Math.PI * 2
    const curve = { focus: { x: (rand() - 0.5) * 600, z: (rand() - 0.5) * 600 }, forward: { x: Math.cos(a), y: Math.sin(a) }, amount: rand() < 0.2 ? 0 : rand() * 0.0055 }
    const tx = Math.floor((rand() - 0.5) * 10)
    const tz = Math.floor((rand() - 0.5) * 10)
    const box = bentBounds(tx, tz, -3, 14, curve)
    for (let n = 0; n < 60; n++) {
      const p = bend({ x: (tx + rand()) * TILE, y: -3 + rand() * 17, z: (tz + rand()) * TILE }, curve)
      assert.ok(p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z, 'in plan')
      assert.ok(p.y >= box.min.y - 1e-6 && p.y <= box.max.y + 1e-6, `in height: ${p.y} in ${box.min.y}..${box.max.y}`)
    }
  }
})

test('with no bend the box is the tile itself, with room for what overhangs its edge', () => {
  const box = bentBounds(1, -2, 0, 10, { focus: { x: 0, z: 0 }, forward: { x: 0, y: 1 }, amount: 0 })
  assert.ok(box.min.x <= TILE && box.min.x >= TILE - 20 && box.max.x >= TILE * 2 && box.max.x <= TILE * 2 + 20)
  assert.equal(box.min.y, 0)
  assert.equal(box.max.y, 10)
})

test('the sphere a square is tested by holds the whole of its box', () => {
  const curve = { focus: { x: 40, z: -70 }, forward: { x: 0.6, y: 0.8 }, amount: 0.004 }
  const tile = { tx: 2, tz: -1, low: -4, high: 15 }
  const sphere = { center: { x: 0, y: 0, z: 0 }, radius: 0 }
  boundTile(sphere, tile, curve)
  const box = bentBounds(2, -1, -4, 15, curve)
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    assert.ok(Math.hypot(x - sphere.center.x, y - sphere.center.y, z - sphere.center.z) <= sphere.radius + 1e-9)
  }
})
