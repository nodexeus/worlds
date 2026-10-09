// test/navigation-extent.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { Navigation, extentFor } from '../src/agents/navigation.js'

const reaches = (nav, from, to) => {
  const path = nav.findPath(from.x, from.z, to.x, to.z)
  const last = path?.[path.length - 1]
  return Boolean(last) && Math.hypot(last.x - to.x, last.z - to.z) < 0.6
}

test('as first made the map covers a small campus and nothing beyond it', () => {
  const nav = new Navigation()
  nav.rebuild([])
  assert.equal(reaches(nav, { x: 0, z: 0 }, { x: 40, z: 30 }), true)
  assert.equal(nav.isBlocked(120, 0), true, 'off the map is nowhere to stand')
})

test('the map is made as big as the campus, so a workspace far from the middle can be walked to', () => {
  const nav = new Navigation()
  // Two districts either side of the square put workspaces well over a hundred units out.
  nav.fit(extentFor([{ x: -128, z: -20 }, { x: 96, z: 70 }]))
  nav.rebuild([{ x: 10, z: 0, r: 3 }])
  assert.equal(nav.isBlocked(-128, -20), false)
  assert.equal(nav.isBlocked(96, 70), false)
  assert.equal(reaches(nav, { x: -128, z: -20 }, { x: 96, z: 70 }), true, 'from one end of the campus to the other')
  assert.equal(nav.isBlocked(10, 0), true, 'and what is in the way still is')
})

test('the map only ever grows in steps, and is not remade for a campus that still fits', () => {
  const small = extentFor([{ x: 20, z: 5 }])
  assert.equal(small, 56, 'never smaller than it always was')
  assert.equal(extentFor([{ x: 100, z: 0 }]), extentFor([{ x: 104, z: 3 }]))
  assert.ok(extentFor([{ x: 100, z: 0 }]) >= 100 + 16, 'with room to walk round the outermost workspace')
  const nav = new Navigation()
  const before = nav.blocked
  nav.fit(56)
  assert.equal(nav.blocked, before, 'the same map')
  nav.fit(160)
  assert.notEqual(nav.blocked, before)
  assert.equal(nav.half, 160)
})
