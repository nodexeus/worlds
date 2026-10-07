/**
 * Where the coolant lines stand. The models are drawn elsewhere; this pins the plan they are
 * laid out to, which is plain numbers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { pipelineClearance, pipelineLayout, pipelineLoop } from '../src/world/pipeline.js'
import { hexToWorld } from '../src/world/plots.js'

const SPEC = { margin: 15, reach: 72 }
const LENGTH = 8
/** Centre to corner of a deck tile. */
const TILE_REACH = 7.6

const cellsAt = (list) => list.map(([q, r]) => hexToWorld(q, r))
// A lopsided colony: a clump, and an arm running off one way.
const COLONY = cellsAt([[0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [1, -1], [2, -1], [3, -1], [3, -2], [-2, 2]])

/** Both ends of a length of pipe, and its middle. */
const along = (p) => {
  const half = (LENGTH * p.stretch) / 2
  return [-half, 0, half].map((t) => ({ x: p.x + Math.cos(p.angle) * t, z: p.z - Math.sin(p.angle) * t }))
}
const nearestCell = (point, cells) => Math.min(...cells.map((c) => Math.hypot(point.x - c.x, point.z - c.z)))

test('the loop runs outside every deck, with room to spare', () => {
  const { pipes, joints } = pipelineLayout(SPEC, COLONY)
  assert.ok(joints.length >= 4, 'a loop has bends')
  for (const p of pipes) {
    for (const point of along(p)) {
      assert.ok(nearestCell(point, COLONY) > TILE_REACH + 3, `pipe ${nearestCell(point, COLONY).toFixed(1)} from a deck's middle`)
    }
  }
  for (const j of joints) assert.ok(nearestCell(j, COLONY) > TILE_REACH + 3)
})

test('it follows the colony: not a square, and no two sides alike', () => {
  const loop = pipelineLoop(COLONY, SPEC.margin)
  const sides = loop.map((a, i) => {
    const b = loop[(i + 1) % loop.length]
    return Math.hypot(b.x - a.x, b.z - a.z)
  })
  assert.ok(Math.max(...sides) - Math.min(...sides) > LENGTH, 'the sides differ')
  const square = loop.every((a, i) => {
    const b = loop[(i + 1) % loop.length]
    return Math.abs(b.x - a.x) < 1e-6 || Math.abs(b.z - a.z) < 1e-6
  })
  assert.equal(square, false)
})

test('every side is a whole number of lengths, none stretched out of recognition', () => {
  const { pipes } = pipelineLayout(SPEC, COLONY)
  assert.ok(pipes.length > 10)
  for (const p of pipes) assert.ok(p.stretch > 0.65 && p.stretch < 1.5, `a length stretched to ${p.stretch.toFixed(2)}`)
})

test('a new workspace outside the loop moves the loop out round it', () => {
  const extra = hexToWorld(-4, 4)
  const before = pipelineLayout(SPEC, COLONY)
  assert.ok(before.pipes.some((p) => along(p).some((point) => Math.hypot(point.x - extra.x, point.z - extra.z) < TILE_REACH + 2)) ||
    nearestCell(extra, before.joints) < 40, 'the new workspace starts near or across the old loop')
  const after = pipelineLayout(SPEC, [...COLONY, extra])
  for (const p of after.pipes) {
    for (const point of along(p)) assert.ok(Math.hypot(point.x - extra.x, point.z - extra.z) > TILE_REACH + 2)
  }
})

test('each pump house feeds the loop, and one the colony has grown past is left out', () => {
  const { pumps, pipes } = pipelineLayout(SPEC, COLONY)
  assert.equal(pumps.length, 4)
  for (const pump of pumps) {
    assert.equal(Math.max(Math.abs(pump.x), Math.abs(pump.z)), SPEC.reach)
    // Its port points down the first length of its feed.
    const first = pipes.reduce((best, p) => (Math.hypot(p.x - pump.x, p.z - pump.z) < Math.hypot(best.x - pump.x, best.z - pump.z) ? p : best))
    assert.ok(Math.abs(Math.sin(first.angle - pump.angle)) < 1e-6, 'the feed leaves square to the port')
  }
  const sprawling = cellsAt([[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [5, -5], [-5, 5]])
  assert.equal(pipelineLayout(SPEC, sprawling).pumps.length, 0)
})

test('the ground under every length, coupling and pump house is kept clear', () => {
  const { pipes, joints, pumps } = pipelineLayout(SPEC, COLONY)
  const clear = pipelineClearance(SPEC, COLONY)
  const covered = (point) => clear.some((c) => Math.hypot(point.x - c.x, point.z - c.z) < c.r)
  for (const p of pipes) for (const point of along(p)) assert.ok(covered(point))
  for (const p of [...joints, ...pumps]) assert.ok(covered(p))
})
