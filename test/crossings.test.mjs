/**
 * Which workspaces are joined, and where: one crossing per neighbouring pair, stable as they
 * grow, a walkway on the level and a staircase one level up, nothing across two.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { planCrossings, reachable } from '../src/world/crossings.js'

const cell = (q, r) => ({ q, r })

test('neighbouring workspaces get exactly one crossing, however long their border', () => {
  const plots = [
    { id: 'a', cells: [cell(0, 0), cell(0, 1), cell(0, 2)], level: 0 },
    { id: 'b', cells: [cell(1, 0), cell(1, 1), cell(1, 2)], level: 0 },
  ]
  const crossings = planCrossings(plots)
  assert.equal(crossings.length, 1)
  assert.equal(crossings[0].rise, 0)
  assert.deepEqual([crossings[0].low, crossings[0].high].sort(), ['a', 'b'])
})

test('workspaces that do not touch are not joined', () => {
  const plots = [
    { id: 'a', cells: [cell(0, 0)], level: 0 },
    { id: 'b', cells: [cell(3, 0)], level: 0 },
  ]
  assert.deepEqual(planCrossings(plots), [])
})

test('the crossing stays where it is while either workspace grows', () => {
  const before = planCrossings([
    { id: 'a', cells: [cell(0, 0)], level: 0 },
    { id: 'b', cells: [cell(1, 0)], level: 0 },
  ])
  const after = planCrossings([
    { id: 'a', cells: [cell(0, 0), cell(0, 1), cell(-1, 1)], level: 0 },
    { id: 'b', cells: [cell(1, 0), cell(1, 1), cell(2, 0)], level: 0 },
  ])
  assert.deepEqual(after, before)
})

test('a staircase climbs from the lower workspace to the higher one', () => {
  const [stair] = planCrossings([
    { id: 'a', cells: [cell(0, 0)], level: 2 },
    { id: 'b', cells: [cell(1, 0)], level: 1 },
  ])
  assert.equal(stair.rise, 1)
  assert.equal(stair.low, 'b')
  assert.equal(stair.high, 'a')
  assert.deepEqual(stair.from, cell(1, 0))
  assert.deepEqual(stair.to, cell(0, 0))
})

test('two levels apart is not joined directly, but can be reached round the side', () => {
  const plots = [
    { id: 'low', cells: [cell(0, 0)], level: 0 },
    { id: 'top', cells: [cell(1, 0)], level: 2 },
    { id: 'mid', cells: [cell(0, 1)], level: 1 }, // touches both
  ]
  const crossings = planCrossings(plots)
  assert.equal(crossings.some((c) => [c.low, c.high].includes('low') && [c.low, c.high].includes('top')), false)
  assert.equal(crossings.length, 2)
  assert.deepEqual([...reachable(crossings, 'low')].sort(), ['low', 'mid', 'top'])
})

test('the same plots always give the same list, whatever order they arrive in', () => {
  const plots = [
    { id: 'c', cells: [cell(0, 1)], level: 0 },
    { id: 'a', cells: [cell(0, 0)], level: 0 },
    { id: 'b', cells: [cell(1, 0)], level: 0 },
  ]
  assert.deepEqual(planCrossings(plots), planCrossings([...plots].reverse()))
})

test('a workspace nobody is joined to reaches only itself', () => {
  assert.deepEqual([...reachable([], 'alone')], ['alone'])
})

// ── a campus that is joined up without a crossing on every edge ───────────────────────

/** A honeycomb of single-cell workspaces, all within a level of their neighbours. */
function honeycomb(rings = 3) {
  const plots = []
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) {
      if (Math.abs(q + r) > rings) continue
      plots.push({ id: `p${q}_${r}`, cells: [{ q, r }], level: 1 + (((q * 7 + r * 13) % 2) + 2) % 2 })
    }
  }
  return plots
}

test('sparingly joined, a campus has far fewer crossings and every workspace can still be reached', async () => {
  const { planCrossings, reachable } = await import('../src/world/crossings.js')
  const plots = honeycomb()
  const every = planCrossings(plots)
  const few = planCrossings(plots, { sparing: true })
  assert.ok(few.length < every.length * 0.55, `${few.length} of ${every.length}`)
  assert.ok(few.length >= plots.length - 1, 'enough to join them all')
  assert.equal(reachable(few, plots[0].id).size, plots.length)
  // Nothing is joined that was not joined before.
  const was = new Set(every.map((c) => JSON.stringify(c)))
  assert.ok(few.every((c) => was.has(JSON.stringify(c))))
})

test('there is more than one way round: a few crossings are kept beyond the bare minimum', async () => {
  const { planCrossings } = await import('../src/world/crossings.js')
  const plots = honeycomb()
  assert.ok(planCrossings(plots, { sparing: true }).length > plots.length - 1)
})

test('which crossings are kept is the same every time, and a level walk is kept before a climb', async () => {
  const { planCrossings } = await import('../src/world/crossings.js')
  const plots = honeycomb()
  assert.deepEqual(planCrossings(plots, { sparing: true }), planCrossings([...plots].reverse(), { sparing: true }))
  const every = planCrossings(plots)
  const few = planCrossings(plots, { sparing: true })
  const share = (list) => list.filter((c) => c.rise === 0).length / list.length
  assert.ok(share(few) > share(every), 'more of what is kept is level')
})
