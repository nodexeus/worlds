import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * The campus gate: the Nodexeus mark as a steel arch, and where the crew arrive on a world
 * that has one. It is the project's own model (`design/campus/nodexeus-gate.blend`), packed
 * by `tools/build-gate.mjs`.
 *
 * One mesh and one material, with every surface baked to maps, so there is nothing to
 * assemble here: it is loaded once, and whoever asks gets the same object.
 */

/** How hard the baked lights glow. Above one, so the bloom pass picks the amber out. */
const GLOW = 2.4

let loading = null

/**
 * Load the gate. Idempotent: the first call owns the request and the rest await it.
 * @returns {Promise<import('three').Object3D>} the gate, standing on y=0 and centred on its
 *   opening, which runs along z. Eight units wide and tall before any scaling.
 */
export function loadGate() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/gate.glb`).then((gltf) => {
      const gate = gltf.scene
      gate.name = 'campus-gate'
      gate.traverse((o) => {
        if (!o.isMesh) return
        o.castShadow = true
        o.receiveShadow = true
        o.material.emissiveIntensity = GLOW
      })
      return gate
    })
  }
  return loading
}
