/**
 * The crew and the crossings: where a crossing lies, how high it is underfoot, and that the
 * walkable grid keeps the crew out of the gap everywhere except across one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { Navigation } from '../src/agents/navigation.js'
import { heightOnSpan, onSpan, spanOf } from '../src/world/crossing-spans.js'
import { hexToWorld } from '../src/world/plots.js'

const world = { gap: 1.4, levelStep: 1.35, deckTop: 0.45, elevation: (id) => (id === 'high' ? 1.35 : 0) }
const stair = { low: 'low', high: 'high', from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, rise: 1 }
const walkway = { ...stair, high: 'low', rise: 0 }

test('a crossing sits midway between its two cells and runs from the lower to the higher', () => {
  const a = hexToWorld(0, 0)
  const b = hexToWorld(1, 0)
  const span = spanOf(stair, world)
  assert.ok(Math.abs(span.x - (a.x + b.x) / 2) < 1e-9)
  assert.ok(Math.abs(span.z - (a.z + b.z) / 2) < 1e-9)
  assert.ok(Math.abs(Math.hypot(span.ux, span.uz) - 1) < 1e-9)
  assert.ok(span.ux * (b.x - a.x) + span.uz * (b.z - a.z) > 0, 'it points at the higher workspace')
  assert.equal(span.half, world.gap)
})

test('a staircase climbs evenly from one deck to the next, and holds each deck’s height past its ends', () => {
  const span = spanOf(stair, world)
  const at = (t) => heightOnSpan(span, span.x + span.ux * span.half * t, span.z + span.uz * span.half * t)
  assert.ok(Math.abs(at(-1) - 0.45) < 1e-9, 'the foot is at the lower deck')
  assert.ok(Math.abs(at(0) - (0.45 + 1.35 / 2)) < 1e-9, 'halfway is half a level up')
  assert.ok(Math.abs(at(1) - (0.45 + 1.35)) < 1e-9, 'the head is at the higher deck')
  assert.ok(Math.abs(at(-3) - 0.45) < 1e-9)
  assert.ok(Math.abs(at(3) - (0.45 + 1.35)) < 1e-9)
})

test('a walkway is level', () => {
  const span = spanOf(walkway, world)
  assert.equal(heightOnSpan(span, span.x, span.z), 0.45)
  assert.equal(heightOnSpan(span, span.x + span.ux, span.z + span.uz), 0.45)
})

test('being on a crossing is a matter of its width and how far past its ends', () => {
  const span = spanOf(walkway, world)
  const side = (d) => [span.x - span.uz * d, span.z + span.ux * d]
  assert.equal(onSpan(span, ...side(0.5), 0.85), true)
  assert.equal(onSpan(span, ...side(1.2), 0.85), false, 'outside the rail')
  const along = (d) => [span.x + span.ux * d, span.z + span.uz * d]
  assert.equal(onSpan(span, ...along(span.half + 0.3), 0.85), false)
  assert.equal(onSpan(span, ...along(span.half + 0.3), 0.85, 0.6), true, 'the overlap reaches onto the deck')
})

test('the walkable grid walls the gap off, and a path between decks goes over the crossing', () => {
  // Two decks either side of a gap along x, joined by one crossing at z = 0.
  const walkable = (x, z) => Math.abs(x) >= 1.4 || Math.abs(z) <= 0.85
  const nav = new Navigation()
  nav.rebuild([], walkable)
  assert.equal(nav.isBlocked(0, 5), true, 'in the gap')
  assert.equal(nav.isBlocked(0, 0), false, 'on the crossing')
  assert.equal(nav.isBlocked(-4, 5), false, 'on a deck')

  const path = nav.findPath(-6, 8, 6, 8)
  assert.ok(path && path.length, 'there is a way across')
  const crossed = path.filter((p) => Math.abs(p.x) < 1.4)
  assert.ok(crossed.length > 0, 'the path passes through the gap somewhere')
  for (const p of crossed) assert.ok(Math.abs(p.z) <= 1.1, `it crossed the gap away from the crossing, at z=${p.z}`)
})

test('with no crossing there is no way across, and nobody is routed through the gap', () => {
  const nav = new Navigation()
  nav.rebuild([], (x) => Math.abs(x) >= 1.4)
  const path = nav.findPath(-6, 0, 6, 0)
  assert.ok(!path || !path.length || path.every((p) => p.x <= -1.4 + 0.5), 'no path reaches the far deck')
})
