/**
 * Where the coolant lines stand. The models are drawn elsewhere; this pins the plan they are
 * laid out to, which is plain numbers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { pipelineBerth, pipelineClearance, pipelineLayout } from '../src/world/pipeline.js'
import { hexToWorld } from '../src/world/plots.js'

const SPEC = { margin: 16, seed: 0x71be }

const cellsAt = (list) => list.map(([q, r]) => hexToWorld(q, r))
// A lopsided colony: a clump, and an arm running off one way.
const COLONY = cellsAt([[0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [1, -1], [2, -1], [3, -1], [3, -2], [-2, 2]])
const GROWN = [...COLONY, ...cellsAt([[-4, 4], [5, -3], [0, -4], [4, 1]])]

const reach = (p) => Math.hypot(p.x, p.z)
const nearestCell = (p, cells) => Math.min(...cells.map((c) => Math.hypot(p.x - c.x, p.z - c.z)))
const of = (layout, kind) => layout.lines.filter((line) => line.kind === kind)
const turnBetween = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))

test('no trunk or spur comes inside the berth the colony is given, however big the colony', () => {
  for (const colony of [COLONY, GROWN]) {
    const berth = pipelineBerth(colony, SPEC.margin)
    const layout = pipelineLayout(SPEC, colony)
    for (const line of [...of(layout, 'trunk'), ...of(layout, 'spur')]) {
      for (const p of line.samples) assert.ok(reach(p) >= berth, `${line.kind} ${reach(p).toFixed(1)} from the middle, berth ${berth.toFixed(1)}`)
    }
    for (const p of layout.pumps) assert.ok(reach(p) >= berth)
  }
})

test('the trunks cross the world: in over one horizon and out over the other', () => {
  const trunks = of(pipelineLayout(SPEC, COLONY), 'trunk')
  assert.equal(trunks.length, 2)
  for (const { samples } of trunks) {
    const first = samples[0]
    const last = samples[samples.length - 1]
    assert.ok(reach(first) > 170 && reach(last) > 170, 'both ends are past the edge of the ground')
    assert.ok(first.x * last.x + first.z * last.z < 0, 'and at opposite ends of it')
  }
})

test('they pass the colony and do not go round it', () => {
  for (const { samples } of of(pipelineLayout(SPEC, COLONY), 'trunk')) {
    // Seen from the colony, something that goes round it sweeps through a full turn. A line
    // going past sweeps through less than half of one.
    let swept = 0
    for (let i = 1; i < samples.length; i++) {
      const a = Math.atan2(samples[i - 1].z, samples[i - 1].x)
      const b = Math.atan2(samples[i].z, samples[i].x)
      swept += Math.atan2(Math.sin(b - a), Math.cos(b - a))
    }
    assert.ok(Math.abs(swept) < Math.PI, `a trunk sweeps ${((Math.abs(swept) * 180) / Math.PI).toFixed(0)} degrees round the colony`)
  }
})

test('every line is a curve: it turns a long way in all, and never sharply', () => {
  const layout = pipelineLayout(SPEC, COLONY)
  for (const line of layout.lines) {
    let total = 0
    for (let i = 1; i < line.samples.length; i++) {
      const turn = turnBetween(line.samples[i - 1].angle, line.samples[i].angle)
      assert.ok(turn < 0.35, `${line.kind} turns ${((turn * 180) / Math.PI).toFixed(0)} degrees in one step`)
      total += turn
    }
    if (line.kind === 'trunk') assert.ok(total > 2, 'a trunk wanders')
  }
})

test('pump houses stand in the trunks and at the end of every spur, some within sight of the colony', () => {
  const layout = pipelineLayout(SPEC, COLONY)
  const spurs = of(layout, 'spur')
  assert.ok(spurs.length >= 1, 'there are spurs')
  assert.ok(layout.pumps.length - spurs.length >= 2, 'and pump houses in the trunks besides')
  for (const { samples } of spurs) {
    const end = samples[samples.length - 1]
    assert.ok(layout.pumps.some((p) => Math.hypot(p.x - end.x, p.z - end.z) < 1e-6), 'a spur ends at a pump house')
  }
  const berth = pipelineBerth(COLONY, SPEC.margin)
  assert.ok(layout.pumps.filter((p) => reach(p) < berth + 70).length >= 2)
})

test('feeders run from a trunk in to the edge of a deck, and end at a cabinet', () => {
  for (const colony of [COLONY, GROWN]) {
    const layout = pipelineLayout(SPEC, colony)
    const feeders = of(layout, 'feeder')
    assert.equal(feeders.length, 3)
    assert.equal(layout.cabinets.length, 3)
    const trunkPoints = of(layout, 'trunk').flatMap((line) => line.samples)
    for (const { samples } of feeders) {
      const start = samples[0]
      const end = samples[samples.length - 1]
      assert.ok(trunkPoints.some((p) => Math.hypot(p.x - start.x, p.z - start.z) < 1e-6), 'it leaves a trunk')
      const toDeck = nearestCell(end, colony)
      // A campus tile's edge is about 5.2 from its middle at the nearest, and its cell's 6.6.
      assert.ok(toDeck > 5.6 && toDeck < 7.4, `it stops ${toDeck.toFixed(1)} from a deck's middle: at its edge, not on it`)
      // And nowhere along the way does it run over a deck.
      for (const p of samples) assert.ok(nearestCell(p, colony) > 5.6)
    }
  }
})

test('the same colony always gets the same lines, and one that grows still gets two trunks clear of it', () => {
  const before = pipelineLayout(SPEC, COLONY)
  assert.deepEqual(pipelineLayout(SPEC, COLONY), before)
  const after = pipelineLayout(SPEC, GROWN)
  assert.equal(of(after, 'trunk').length, 2)
  const berth = pipelineBerth(GROWN, SPEC.margin)
  for (const { samples } of of(after, 'trunk')) for (const p of samples) assert.ok(reach(p) >= berth)
})

test('a trunk keeps to the ground inside the canal, and crosses it only on its way out, squarely', () => {
  const CANAL = 96
  const spec = { ...SPEC, canal: CANAL }
  const onCanal = (p) => Math.abs(Math.max(Math.abs(p.x), Math.abs(p.z)) - CANAL) < 3.8
  const layout = pipelineLayout(spec, COLONY)
  for (const { samples } of of(layout, 'trunk')) {
    // Two crossings of a channel under eight metres wide, at two metres a sample: a dozen
    // samples at most. A trunk running along the canal would have scores.
    const over = samples.filter(onCanal).length
    assert.ok(over > 0, 'it does cross')
    assert.ok(over <= 12, `${over} samples of a trunk are over the canal`)
    // Between its crossings it is inside the canal's square, and outside the colony's berth.
    const berth = pipelineBerth(COLONY, spec.margin)
    for (const p of samples) assert.ok(reach(p) >= berth)
  }
  // A colony too big to leave room inside takes its trunks out past the canal, clear of it.
  const huge = cellsAt([[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [6, -6], [-6, 6]])
  for (const { samples } of of(pipelineLayout(spec, huge), 'trunk')) {
    assert.ok(samples.filter(onCanal).length === 0, 'outside the canal altogether, never along it')
  }
})

test('cradles stand under every line, and not on top of what else stands there', () => {
  const layout = pipelineLayout(SPEC, COLONY)
  assert.ok(layout.cradles.length > 100)
  for (const c of layout.cradles) {
    for (const p of layout.pumps) assert.ok(Math.hypot(c.x - p.x, c.z - p.z) >= 3.4)
    for (const p of layout.joints) assert.ok(Math.hypot(c.x - p.x, c.z - p.z) >= 2.6)
  }
  assert.ok(layout.cradles.some((c) => c.scale < 0.5), 'feeders have cradles their own size')
})

test('over a canal a line is a clear span: nothing is stood where there is no floor', () => {
  // A canal eight metres wide straight across the world, which both trunks have to cross.
  const canal = (x, z) => Math.abs(x + z * 0.3 - 12) < 4
  const open = (x, z) => !canal(x, z)
  const plain = pipelineLayout(SPEC, COLONY)
  const layout = pipelineLayout(SPEC, COLONY, open)
  assert.ok(plain.cradles.some((c) => canal(c.x, c.z)), 'with no canal declared, cradles do stand there')
  for (const c of layout.cradles) assert.ok(open(c.x, c.z), 'no cradle over the canal')
  for (const p of [...layout.pumps, ...layout.joints]) assert.ok(open(p.x, p.z), 'nor a pump house or a coupling')
  // The line itself still crosses.
  assert.ok(layout.lines.some((line) => line.samples.some((p) => canal(p.x, p.z))))
  assert.ok(layout.cradles.length > plain.cradles.length * 0.8, 'and is held up everywhere else')
})

test('the ground under every line and everything on it is kept clear', () => {
  const layout = pipelineLayout(SPEC, COLONY)
  const clear = pipelineClearance(SPEC, COLONY)
  const covered = (point) => clear.some((c) => Math.hypot(point.x - c.x, point.z - c.z) < c.r)
  for (const line of layout.lines) for (const p of line.samples) assert.ok(covered(p))
  for (const p of [...layout.joints, ...layout.pumps, ...layout.cabinets, ...layout.cradles]) assert.ok(covered(p))
})
