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
