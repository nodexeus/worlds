/**
 * Packs Quaternius' Modular Sci-Fi MegaKit into one glb.
 *
 * This kit is built differently from both KayKit's and Kenney's: its models share a handful
 * of PBR trim sheets (base colour, normal, and an occlusion/roughness/metalness map each)
 * rather than one gradient atlas or flat colours. So nothing is baked into the shared building
 * geometry here. Every model is kept whole, as a named scene node with its own materials, for
 * the runtime to clone.
 *
 * Four things are done to it on the way in:
 *
 * - **Re-homed.** The kit's pivots are wherever its grid wanted them, which differs model to
 *   model. Each model is wrapped so that its footprint is centred on the origin and its lowest
 *   point sits at y=0, which lets a recipe place any part by its centre without knowing that.
 * - **Stripped of its branding.** The kit carries the logo and lettering of a fictional
 *   company on decal materials. Those primitives are dropped.
 * - **Downscaled.** The trim sheets ship at 2048px, which is several times what a building
 *   seen from the campus camera can show.
 * - **Filtered.** Aliens and loose decal meshes are not packed, and neither is the one model
 *   whose geometry is corrupt as shipped.
 *
 * Usage: build-megakit.mjs <kit-dir> <out.glb> [--force]
 * `<kit-dir>` is the unzipped "Modular SciFi MegaKit[Standard]" folder.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, getBounds, mergeDocuments, prune, textureCompress, unpartition } from '@gltf-transform/functions'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [SRC, OUT] = process.argv.slice(2)
if (!SRC || !OUT) {
  console.error('usage: build-megakit.mjs <kit-dir> <out.glb>')
  process.exit(1)
}

// The raw pack is not checked in, the built glb is. Without the pack this is a no-op, which
// is what a fresh clone needs.
if (!existsSync(SRC)) {
  if (existsSync(OUT)) {
    console.log(`build-megakit: no source pack, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-megakit: missing ${SRC}: see README, "Where the art comes from"`)
  process.exit(1)
}

// Resizing fifteen textures takes a few seconds and does not come out byte-identical twice,
// and `npm run dev` runs the asset step every time. So a build that is already newer than the
// pack and than this script is left alone; pass --force to pack anyway.
const newest = (dir) =>
  Math.max(...readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs))
if (existsSync(OUT) && !process.argv.includes('--force')) {
  const built = statSync(OUT).mtimeMs
  if (built > newest(SRC) && built > statSync(fileURLToPath(import.meta.url)).mtimeMs) {
    console.log(`build-megakit: ${OUT} is up to date`)
    process.exit(0)
  }
}

/** The folders worth packing. `Aliens` and `Decals` are left behind. */
const CATEGORIES = ['Columns', 'Platforms', 'Props', 'Walls']
/** Shipped with non-finite vertex positions, which poison every post-processing pass. */
const BROKEN = new Set(['Prop_Computer'])
/** Longest edge of a packed texture. */
const TEXTURE_SIZE = 1024

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const textures = join(SRC, 'Textures')

/**
 * Read one model. The .gltf files name their textures as siblings, but the pack keeps them all
 * in one `Textures` folder, so the resources are gathered by hand rather than left to the
 * reader's own path resolution.
 */
async function read(dir, file) {
  const json = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const resources = {}
  for (const buffer of json.buffers || []) resources[buffer.uri] = readFileSync(join(dir, buffer.uri))
  for (const image of json.images || []) resources[image.uri] = readFileSync(join(textures, image.uri))
  return io.readJSON({ json, resources })
}

let doc = null
let packed = 0
let strippedPrimitives = 0

for (const category of CATEGORIES) {
  const dir = join(SRC, 'glTF', category)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.gltf')).sort()) {
    const name = basename(file, '.gltf')
    if (BROKEN.has(name)) continue
    const one = await read(dir, file)
    const scene = one.getRoot().listScenes()[0]

    // The branding first, so the bounds below are of what is actually kept.
    for (const mesh of one.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        if (/decal/i.test(primitive.getMaterial()?.getName() || '')) {
          mesh.removePrimitive(primitive)
          primitive.dispose()
          strippedPrimitives++
        }
      }
    }

    const bounds = getBounds(scene)
    // Two wrappers: the outer one carries the model's name and is what a recipe moves, the
    // inner one holds the offset that re-homes it. The loader makes names unique across
    // scenes, nodes and meshes alike, so only the outer node may be called by the bare name.
    const pivot = one.createNode(`${name}-pivot`).setTranslation([
      -(bounds.min[0] + bounds.max[0]) / 2,
      -bounds.min[1],
      -(bounds.min[2] + bounds.max[2]) / 2,
    ])
    for (const child of scene.listChildren()) {
      scene.removeChild(child)
      pivot.addChild(child)
      child.traverse((node) => {
        node.setName(`${name}-node`)
        node.getMesh()?.setName(`${name}-mesh`)
      })
    }
    scene.addChild(one.createNode(name).addChild(pivot))

    if (!doc) doc = one
    else mergeDocuments(doc, one)
    packed++
  }
}

const root = doc.getRoot()
const scene = root.listScenes()[0]
scene.setName('megakit')
for (const other of root.listScenes().slice(1)) {
  for (const child of other.listChildren()) scene.addChild(child)
  other.dispose()
}

await doc.transform(
  dedup(), // every model brings its own copy of the same few trim sheets
  prune(), // and stripping the decals leaves their material and texture unreferenced
  textureCompress({ resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
  unpartition()
)

console.log(
  `${basename(OUT)}: ${packed} models, ${root.listMaterials().length} materials, ` +
    `${root.listTextures().length} textures at ${TEXTURE_SIZE}px, ${strippedPrimitives} decal primitives stripped`
)

mkdirSync(dirname(OUT), { recursive: true })
await io.write(OUT, doc)
