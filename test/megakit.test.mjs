/**
 * The packed MegaKit, read straight out of the checked-in glb.
 *
 * The packer is a no-op on a fresh clone, so what ships is whatever was last built. These pin
 * the promises the runtime relies on: models are found by their bare name, each stands centred
 * on the origin, the pack's branding is gone, and nothing in it can poison a render.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'

const file = new URL('../public/assets/megakit.glb', import.meta.url)
const glb = fs.readFileSync(file)
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))
const models = json.scenes[0].nodes.map((i) => json.nodes[i])
const byName = new Map(models.map((m) => [m.name, m]))

test('the scene is not named after a model, so the loader leaves model names alone', () => {
  assert.equal(json.scenes.length, 1)
  assert.equal(json.scenes[0].name, 'megakit')
  assert.equal(byName.size, models.length, 'every model has its own name')
})

test('the parts the campus is built from are all there', () => {
  assert.ok(models.length >= 150, `only ${models.length} models packed`)
  for (const name of ['Platform_Metal', 'Platform_Stairs_4Wide', 'Prop_Rail_4', 'Column_Large_Straight', 'WallAstra_Straight', 'Door_Frame_A']) {
    assert.ok(byName.has(name), `${name} is missing`)
  }
})

test('the model that ships with corrupt geometry is left out', () => {
  assert.equal(byName.has('Prop_Computer'), false)
})

test('every model stands on y=0, centred on its own footprint, with finite bounds', async () => {
  // Measured with the packer's own library: a few of the kit's nodes carry a rotation or a
  // scale, and bounds have to be taken through those.
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(glb))
  for (const node of doc.getRoot().listScenes()[0].listChildren()) {
    const name = node.getName()
    const { min, max } = getBounds(node)
    for (const v of [...min, ...max]) assert.ok(Number.isFinite(v), `${name} has a non-finite bound`)
    assert.ok(Math.abs(min[1]) < 1e-3, `${name} does not stand on the ground (min y ${min[1]})`)
    assert.ok(Math.abs(min[0] + max[0]) < 1e-3, `${name} is off-centre in x`)
    assert.ok(Math.abs(min[2] + max[2]) < 1e-3, `${name} is off-centre in z`)
  }
})

test('the pack’s own branding is stripped', () => {
  for (const material of json.materials) assert.doesNotMatch(material.name, /decal/i)
  for (const image of json.images) assert.doesNotMatch(image.name || '', /decal/i)
})

test('textures are packed at the reduced size, inside the file', () => {
  for (const image of json.images) assert.equal(image.uri, undefined, 'textures are embedded, not referenced')
  assert.ok(glb.length < 16 * 1024 * 1024, `megakit.glb has grown to ${(glb.length / 1048576).toFixed(1)} MB`)
})
