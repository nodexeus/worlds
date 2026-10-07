import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * The campus's own buildings: the project's models (`design/campus/`), each one mesh with one
 * material of baked maps, packed into a single file by `tools/build-buildings.mjs`.
 *
 * Loaded once at boot. Until then, and for any building not yet modelled, `campusBuilding`
 * answers null and whoever asked falls back to the kit.
 */

const models = new Map()
let loading = null

/** Load the set. Idempotent: the first call owns the request and the rest await it. */
export function loadCampusBuildings() {
  if (!loading) {
    loading = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}assets/campus/buildings.glb`)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true)
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return
          // Whatever the export left on the node goes into the geometry, so a building is
          // its vertices and nothing else: standing on y = 0, centred on its own middle.
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld)
          models.set(o.name, { geometry, material: o.material })
        })
        return models
      })
  }
  return loading
}

/**
 * One building by name.
 * @returns {{geometry: import('three').BufferGeometry, material: import('three').MeshStandardMaterial} | null}
 */
export function campusBuilding(name) {
  return models.get(name) || null
}
