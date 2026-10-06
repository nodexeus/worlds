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
