/**
 * Packs the settlement kit for shipping.
 *
 * The kit is the parts the campus's workspaces are built from: decks, legs, edges, stairs,
 * frames, modules, gantries, signs and the walkway (`design/campus/settlement.md`). Each is the
 * project's own model, exported from Blender by `bake_settlement.py` as one mesh with one
 * material of baked maps, the same way the buildings are. This gathers them into a single
 * file and names each mesh after its part, so the game can ask for one by name.
 *
 * Usage: build-settlement.mjs <design dir> <out.glb> [--force]
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, prune, textureCompress, unpartition } from '@gltf-transform/functions'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PREFIX = 'nodexeus-set-'
/** Parts that are stood on or looked at closely keep bigger maps; the rest are small or thin. */
const LARGE = /^(deck-[a-z]|mod-|stair-2$)/
/** The pools of light and the sheet of deck digits are pictures, laid on a deck by the game, and ride along as they are. */
const POOLS = ['pool-round.png', 'pool-band.png', 'stencil-digits.png']

const [DIR, OUT] = process.argv.slice(2)
if (!DIR || !OUT) {
  console.error('usage: build-settlement.mjs <design dir> <out.glb> [--force]')
  process.exit(1)
}

// What the game has to know about the decks that are not hexagons (their outlines, their
// ports, where things stand on them) is written by the Blender build as data, and is turned
// here into a module the game imports. Done before anything else, since it is quick and the
// packing below is skipped when the models have not changed.
const SHAPES = join(DIR, 'deck-shapes.json')
if (existsSync(SHAPES)) {
  const shapes = JSON.parse(readFileSync(SHAPES, 'utf8'))
  const here = dirname(fileURLToPath(import.meta.url))
  writeFileSync(
    join(here, '..', 'src', 'world', 'deck-shapes.js'),
    `// Written by tools/build-settlement.mjs from design/campus/deck-shapes.json. Do not edit.\nexport default ${JSON.stringify(shapes, null, 1)}\n`
  )
}

const sources = (existsSync(DIR) ? readdirSync(DIR) : [])
  .filter((file) => file.startsWith(PREFIX) && file.endsWith('.glb'))
  .sort()
  .map((file) => {
    const name = file.slice(PREFIX.length, -'.glb'.length)
    return { name, size: LARGE.test(name) ? 1024 : 512, file: join(DIR, file) }
  })

// The Blender exports are not required to be present: the built file is what ships.
if (!sources.length) {
  if (existsSync(OUT)) {
    console.log(`build-settlement: no Blender exports, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-settlement: no ${PREFIX}*.glb in ${DIR}: export from design/campus with bake_settlement.py`)
  process.exit(1)
}

// Resizing is slow and not byte-identical between runs: a build newer than its sources and
// this script is left alone.
if (existsSync(OUT) && !process.argv.includes('--force')) {
  const built = statSync(OUT).mtimeMs
  const newest = Math.max(statSync(fileURLToPath(import.meta.url)).mtimeMs, ...sources.map((s) => statSync(s.file).mtimeMs))
  if (built > newest) {
    console.log(`build-settlement: ${OUT} is up to date`)
    process.exit(0)
  }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
let doc = null
for (const { name, size, file } of sources) {
  const one = await io.read(file)
  // Blender numbers a name it has used before, so the export's own names cannot be relied on.
  const meshes = one.getRoot().listMeshes()
  if (meshes.length !== 1) throw new Error(`${file}: expected one mesh, found ${meshes.length}`)
  meshes[0].setName(name)
  for (const node of one.getRoot().listNodes()) if (node.getMesh()) node.setName(name)
  for (const material of one.getRoot().listMaterials()) material.setName(name)
  await one.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [size, size] }))
  if (doc) mergeDocuments(doc, one)
  else doc = one
}

// Merging leaves one scene per source; the game wants every part under one.
const root = doc.getRoot()
const [scene, ...rest] = root.listScenes()
scene.setName('campus-settlement')
for (const other of rest) {
  for (const child of other.listChildren()) scene.addChild(child)
  other.dispose()
}
root.setDefaultScene(scene)

await doc.transform(unpartition(), dedup(), prune())

mkdirSync(dirname(OUT), { recursive: true })
for (const pool of POOLS) {
  if (existsSync(join(DIR, pool))) copyFileSync(join(DIR, pool), join(dirname(OUT), pool))
}
console.log(`${basename(OUT)}: ${root.listMeshes().length} parts, ${root.listTextures().length} textures`)
await io.write(OUT, doc)
