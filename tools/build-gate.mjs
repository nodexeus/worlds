/**
 * Packs the campus gate for shipping.
 *
 * The gate is the project's own model, made in Blender (`design/campus/nodexeus-gate.blend`)
 * and exported from there as a glb with its baked maps at full size. Nothing about the model
 * changes here; the maps are only brought down to a size a landmark seen from the campus
 * camera can actually show, which is most of the file.
 *
 * Usage: build-gate.mjs <export.glb> <out.glb> [--force]
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, textureCompress } from '@gltf-transform/functions'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const [SRC, OUT] = process.argv.slice(2)
if (!SRC || !OUT) {
  console.error('usage: build-gate.mjs <export.glb> <out.glb> [--force]')
  process.exit(1)
}

// The Blender export is not required to be present: the built file is what ships.
if (!existsSync(SRC)) {
  if (existsSync(OUT)) {
    console.log(`build-gate: no Blender export, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-gate: missing ${SRC}: export it from design/campus/nodexeus-gate.blend`)
  process.exit(1)
}

// Resizing is slow and not byte-identical between runs, and `npm run dev` runs the asset step
// every time, so a build newer than its source and this script is left alone.
if (existsSync(OUT) && !process.argv.includes('--force')) {
  const built = statSync(OUT).mtimeMs
  if (built > statSync(SRC).mtimeMs && built > statSync(fileURLToPath(import.meta.url)).mtimeMs) {
    console.log(`build-gate: ${OUT} is up to date`)
    process.exit(0)
  }
}

/** Longest edge of a packed texture. */
const TEXTURE_SIZE = 1024

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(SRC)
await doc.transform(dedup(), prune(), textureCompress({ resize: [TEXTURE_SIZE, TEXTURE_SIZE] }))

const root = doc.getRoot()
console.log(`${basename(OUT)}: ${root.listMeshes().length} mesh, ${root.listMaterials().length} material, ${root.listTextures().length} textures at ${TEXTURE_SIZE}px`)
mkdirSync(dirname(OUT), { recursive: true })
await io.write(OUT, doc)
