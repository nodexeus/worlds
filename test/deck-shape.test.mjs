/**
 * The outline of a deck tile whose outside edges are pulled in: what is drawn, what edges it,
 * and what counts as standing on it all come from this, so it is pinned here on its own.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { edgeAngle, edgeSegments, onTile, tileOutline } from '../src/world/deck-shape.js'

const APOTHEM = 6
const GAP = 1.5
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
const length = ({ a, b }) => Math.hypot(b[0] - a[0], b[1] - a[1])

test('with nothing pulled in, the outline is the plain hexagon', () => {
  const outline = tileOutline(APOTHEM)
  assert.equal(outline.length, 6)
  const circumradius = APOTHEM / Math.cos(Math.PI / 6)
  for (const [x, z] of outline) assert.ok(near(Math.hypot(x, z), circumradius, 1e-9))
})

test('every edge pulled in gives a smaller hexagon, still regular', () => {
  const outline = tileOutline(APOTHEM, Array(6).fill(GAP))
  assert.equal(outline.length, 6)
  const circumradius = (APOTHEM - GAP) / Math.cos(Math.PI / 6)
  for (const [x, z] of outline) assert.ok(near(Math.hypot(x, z), circumradius, 1e-9))
})

test('a shared edge stays put while its neighbours are pulled in', () => {
  const insets = [0, GAP, GAP, GAP, GAP, GAP]
  const [shared] = edgeSegments(APOTHEM, insets, [0])
  // Still on the original edge line...
  for (const [x, z] of [shared.a, shared.b]) {
    assert.ok(near(x * Math.cos(edgeAngle(0)) + z * Math.sin(edgeAngle(0)), APOTHEM, 1e-9))
  }
  // ...and shorter than the full side, because the edges either side of it came in.
  const side = (2 * APOTHEM) * Math.tan(Math.PI / 6)
  assert.ok(length(shared) < side)
})

test('two tiles of one workspace meet along exactly the same stretch of their shared edge', () => {
  // Tile A shares its edge 0 with tile B, which sees the same edge as its edge 3. Every other
  // edge of both is an outside edge.
  const a = edgeSegments(APOTHEM, [0, GAP, GAP, GAP, GAP, GAP], [0])[0]
  const b = edgeSegments(APOTHEM, [GAP, GAP, GAP, 0, GAP, GAP], [3])[0]
  // B's centre is two apothems away along A's edge-0 normal.
  const dx = 2 * APOTHEM * Math.cos(edgeAngle(0))
  const dz = 2 * APOTHEM * Math.sin(edgeAngle(0))
  const inA = [b.a, b.b].map(([x, z]) => [x + dx, z + dz])
  const same = (p, q) => near(p[0], q[0], 1e-9) && near(p[1], q[1], 1e-9)
  assert.ok(
    (same(inA[0], a.a) && same(inA[1], a.b)) || (same(inA[0], a.b) && same(inA[1], a.a)),
    'the two outlines join with no notch and no step'
  )
})

test('standing on the tile respects the pulled-in edges and the size of what stands there', () => {
  const insets = Array(6).fill(GAP)
  const out = APOTHEM - GAP
  const [nx, nz] = [Math.cos(edgeAngle(2)), Math.sin(edgeAngle(2))]
  assert.equal(onTile(0, 0, APOTHEM, insets), true)
  assert.equal(onTile(nx * (out - 0.01), nz * (out - 0.01), APOTHEM, insets), true)
  assert.equal(onTile(nx * (out + 0.01), nz * (out + 0.01), APOTHEM, insets), false, 'in the gap')
  assert.equal(onTile(nx * (out - 0.5), nz * (out - 0.5), APOTHEM, insets, 1), false, 'overhangs the edge')
  assert.equal(onTile(nx * (APOTHEM - 0.01), nz * (APOTHEM - 0.01), APOTHEM), true, 'a plain tile runs to its edge')
})

test('only the edges asked for are reported, each with a real length', () => {
  const insets = [0, GAP, GAP, 0, GAP, GAP]
  const outside = edgeSegments(APOTHEM, insets, [1, 2, 4, 5])
  assert.deepEqual(outside.map((s) => s.edge), [1, 2, 4, 5])
  for (const segment of outside) assert.ok(length(segment) > 1)
})
