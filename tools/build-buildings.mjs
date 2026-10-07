/**
 * Packs the campus's own buildings for shipping.
 *
 * Each building is the project's own model, made in Blender (`design/campus/`) and exported
 * from there by `bake_model.py` as one mesh with one material of baked maps. This gathers
 * them into a single file, names each mesh after its building so the game can ask for it by
 * name, and brings the maps down to the size a building seen from the campus camera can show.
 *
 * Usage: build-buildings.mjs <design dir> <out.glb> [--force]
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, prune, textureCompress, unpartition } from '@gltf-transform/functions'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Longest edge of a deck building's packed maps. */
const TEXTURE_SIZE = 1024

/**
 * The models, by the name the game asks for them with, and the size of their maps. Source:
 * nodexeus-<name>.glb. The Library is a landmark four times the size of a deck building and
 * is looked at closely, so it keeps more.
 */
const BUILDINGS = {
  core: TEXTURE_SIZE,
  hall: TEXTURE_SIZE,
  array: TEXTURE_SIZE,
  mast: TEXTURE_SIZE,
  vault: TEXTURE_SIZE,
  dome: TEXTURE_SIZE,
  spire: TEXTURE_SIZE,
  forge: TEXTURE_SIZE,
  pad: TEXTURE_SIZE,
  lab: TEXTURE_SIZE,
  library: 2048,
  // What is scattered over the foundry floor: small, and seen from across the campus.
  stack: 512,
  pylon: 512,
  tanks: 512,
  manifold: 512,
  beacon: 512,
  cabinet: 512,
}

const [DIR, OUT] = process.argv.slice(2)
if (!DIR || !OUT) {
  console.error('usage: build-buildings.mjs <design dir> <out.glb> [--force]')
  process.exit(1)
}

const sources = Object.entries(BUILDINGS).map(([name, size]) => ({ name, size, file: join(DIR, `nodexeus-${name}.glb`) }))
const missing = sources.filter((s) => !existsSync(s.file))

// The Blender exports are not required to be present: the built file is what ships.
if (missing.length) {
  if (existsSync(OUT)) {
    console.log(`build-buildings: no Blender export for ${missing.map((s) => s.name).join(', ')}, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-buildings: missing ${missing.map((s) => s.file).join(', ')}: export from design/campus with bake_model.py`)
  process.exit(1)
}

// Resizing is slow and not byte-identical between runs, and `npm run dev` runs the asset step
// every time, so a build newer than its sources and this script is left alone.
if (existsSync(OUT) && !process.argv.includes('--force')) {
  const built = statSync(OUT).mtimeMs
  const newest = Math.max(statSync(fileURLToPath(import.meta.url)).mtimeMs, ...sources.map((s) => statSync(s.file).mtimeMs))
  if (built > newest) {
    console.log(`build-buildings: ${OUT} is up to date`)
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
  // WebP: a building's four maps as PNG are three megabytes, and there are eleven models.
  await one.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [size, size] }))
  if (doc) mergeDocuments(doc, one)
  else doc = one
}

// Merging leaves one scene per source; the game wants every building under one.
const root = doc.getRoot()
const [scene, ...rest] = root.listScenes()
scene.setName('campus-buildings')
for (const other of rest) {
  for (const child of other.listChildren()) scene.addChild(child)
  other.dispose()
}
root.setDefaultScene(scene)

await doc.transform(unpartition(), dedup(), prune())

// The drone rides along: bare geometry, one mesh per role, so there is nothing to shrink.
const droneSource = join(DIR, 'nodexeus-drone.glb')
if (existsSync(droneSource)) {
  const drone = await io.read(droneSource)
  await drone.transform(prune())
  await io.write(join(dirname(OUT), 'drone.glb'), drone)
  console.log(`drone.glb: ${drone.getRoot().listMeshes().length} parts`)
}

console.log(`${basename(OUT)}: ${root.listMeshes().length} buildings, ${root.listTextures().length} textures`)
mkdirSync(dirname(OUT), { recursive: true })
await io.write(OUT, doc)
