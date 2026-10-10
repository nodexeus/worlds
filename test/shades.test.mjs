// test/shades.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { SHADES, shadeOf } from '../src/world/shades.js'

test('most workspaces burn amber, and the rest a handful of other shades', () => {
  const count = {}
  for (let n = 0; n < 2000; n++) count[shadeOf(`workspace-${n}`)] = (count[shadeOf(`workspace-${n}`)] || 0) + 1
  assert.ok(count.amber > 1050 && count.amber < 1350, `${count.amber} amber of 2000`)
  for (const shade of Object.keys(SHADES)) assert.ok(count[shade] > 40, `${shade}: ${count[shade]}`)
  assert.equal(Object.values(count).reduce((a, b) => a + b, 0), 2000)
})

test('a workspace keeps its shade', () => {
  assert.equal(shadeOf('worlds'), shadeOf('worlds'))
  assert.equal(SHADES.amber, null, 'amber is the lamp as it was made')
})

test('the lights of a workspace that needs somebody beat: from dimmer than usual to far brighter and whiter, and back, about once every two seconds', async () => {
  const { callPulse } = await import('../src/world/shades.js')
  const beats = Array.from({ length: 400 }, (_, n) => callPulse(n * 0.01))
  const gains = beats.map((b) => b.gain)
  assert.ok(Math.min(...gains) < 0.7 && Math.min(...gains) > 0.3, 'never out altogether')
  assert.ok(Math.max(...gains) > 2.5 && Math.max(...gains) <= 3.2, 'far brighter than a deck at rest')
  assert.ok(beats.every((b) => b.white >= 0 && b.white <= 0.7), 'whiter at the top of the beat, never all white')
  const top = beats.findIndex((b, n) => n > 0 && n < 399 && b.gain > beats[n - 1].gain && b.gain >= beats[n + 1].gain)
  const next = beats.findIndex((b, n) => n > top + 5 && n < 399 && b.gain > beats[n - 1].gain && b.gain >= beats[n + 1].gain)
  assert.ok(next - top > 150 && next - top < 220, `one beat is ${(next - top) / 100}s`)
})

test('light is put under a deck of its own shape where there is slab to hang it from, on most decks and not all', async () => {
  const { underLamps } = await import('../src/world/settlement-plan.js')
  const unit = (n) => ({ deck: 'deck-m7', at: { stacks: [{ x: n, z: 1, turn: 0 }, { x: n + 2, z: -1, turn: 0 }], x: n, z: 0 } })
  const all = Array.from({ length: 60 }, (_, n) => underLamps(`plot-${n}`, unit(n)))
  const lit = all.filter((lamps) => lamps.length)
  assert.ok(lit.length > 30 && lit.length < 55, `${lit.length} of 60 decks`)
  assert.ok(all.some((lamps) => lamps.length === 2), 'some have two')
  for (const [n, lamps] of all.entries()) for (const lamp of lamps) assert.ok(unit(n).at.stacks.some((s) => s.x === lamp.x && s.z === lamp.z), 'under where a stack stands: there is slab there')
  assert.deepEqual(underLamps('plot-3', unit(3)), all[3], 'the same every time')
  assert.deepEqual(underLamps('p', { deck: 'deck-s1', at: { stacks: [] } }), [], 'nowhere to hang one')
})
