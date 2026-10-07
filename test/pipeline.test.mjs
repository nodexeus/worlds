/**
 * Where the coolant lines stand. The models are drawn elsewhere; this pins the plan they are
 * laid out to, which is plain numbers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { pipelineClearance, pipelineLayout } from '../src/world/pipeline.js'

const SPEC = { ring: 64 }
const LENGTH = 8
const ends = (p) => (p.turned ? [[p.x, p.z - LENGTH / 2], [p.x, p.z + LENGTH / 2]] : [[p.x - LENGTH / 2, p.z], [p.x + LENGTH / 2, p.z]])
const key = ([x, z]) => `${x},${z}`

test('the ring is closed: every length of it meets another, or a pump house, at both ends', () => {
  const { pipes, pumps } = pipelineLayout(SPEC)
  const joints = new Map()
  for (const p of pipes) for (const end of ends(p)) joints.set(key(end), (joints.get(key(end)) || 0) + 1)
  const houses = new Set(pumps.map((p) => key([p.x, p.z])))
  const onRing = pipes.filter((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) === SPEC.ring)
  assert.equal(onRing.length, (4 * 2 * SPEC.ring) / LENGTH)
  for (const p of onRing) {
    for (const end of ends(p)) assert.ok(joints.get(key(end)) >= 2 || houses.has(key(end)), `open end at ${key(end)}`)
  }
})

test('there is a pump house at each corner and where each spoke leaves the ring', () => {
  const { pumps } = pipelineLayout(SPEC)
  const have = new Set(pumps.map((p) => key([p.x, p.z])))
  assert.equal(have.size, 8)
  for (const [x, z] of [[64, 64], [64, -64], [-64, 64], [-64, -64], [64, 0], [-64, 0], [0, 64], [0, -64]]) {
    assert.ok(have.has(key([x, z])), `no pump house at ${x},${z}`)
  }
})

test('nothing is laid inside the ring, and the spokes run out along the axes', () => {
  const { pipes } = pipelineLayout(SPEC)
  for (const p of pipes) {
    const reach = Math.max(Math.abs(p.x), Math.abs(p.z))
    assert.ok(reach >= SPEC.ring, `a pipe inside the ring at ${p.x},${p.z}`)
    if (reach > SPEC.ring) assert.ok(p.x === 0 || p.z === 0, `a spoke off its axis at ${p.x},${p.z}`)
  }
})

test('the ground under every length is kept clear', () => {
  const { pipes } = pipelineLayout(SPEC)
  const clear = pipelineClearance(SPEC)
  for (const p of pipes) {
    for (const [x, z] of [...ends(p), [p.x, p.z]]) {
      assert.ok(clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r), `not kept clear at ${x},${z}`)
    }
  }
})
