import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { withCurve } from '../core/curve.js'

/**
 * The settlement, drawn: the kit's parts (`design/campus/settlement.md`), each one mesh with one
 * material of baked maps, stood where `settlement-plan.js` says.
 *
 * A campus is dozens of workspaces and each is a dozen parts, so every kind of part is one
 * instanced mesh for the whole campus, however many of it there are.
 */

const models = new Map()
let loading = null

/** Load the kit. Idempotent: the first call owns the request and the rest await it. */
export function loadSettlement() {
  loading ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/campus/settlement.glb`).then((gltf) => {
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      // Whatever the export left on the node goes into the geometry: a part is its vertices.
      models.set(o.name, { geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: o.material })
    })
    return models
  })
  return loading
}

/** Whether the kit has arrived. Until it has, nothing of the settlement can be drawn. */
export const settlementReady = () => models.size > 0

/** The same lift the campus's baked buildings get: see `bakedMaterial` in buildings.js. */
function surface(source) {
  const material = source.clone()
  material.metalness = 0.7
  material.emissiveIntensity = 1.7
  material.onBeforeCompile = (shader) => withCurve(shader)
  return material
}

export class Settlement {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'settlement'
    scene.add(this.group)
    /** @type {Map<string, {mesh: THREE.InstancedMesh, capacity: number}>} */
    this.meshes = new Map()
    this.parts = []
    this.lifts = new Map()
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._p = new THREE.Vector3()
    this._s = new THREE.Vector3(1, 1, 1)
    this._up = new THREE.Vector3(0, 1, 0)
  }

  /**
   * Draw `parts`, in place of whatever was drawn before.
   * @param {import('./settlement-plan.js').Placed[]} parts
   */
  set(parts) {
    this.parts = parts
    this._write()
  }

  /** Carry one workspace's parts `dy` higher, or put them back with 0. Used while it is held. */
  setLift(plot, dy) {
    if (dy) this.lifts.set(plot, dy)
    else this.lifts.delete(plot)
    this._write()
  }

  _write() {
    const counts = new Map()
    for (const part of this.parts) counts.set(part.part, (counts.get(part.part) || 0) + 1)
    for (const [name, count] of counts) this._room(name, count)

    const at = new Map()
    for (const part of this.parts) {
      const held = this.meshes.get(part.part)
      if (!held) continue
      const n = at.get(part.part) || 0
      at.set(part.part, n + 1)
      this._p.set(part.x, part.y + (this.lifts.get(part.plot) || 0), part.z)
      this._q.setFromAxisAngle(this._up, part.turn)
      held.mesh.setMatrixAt(n, this._m.compose(this._p, this._q, this._s))
    }
    for (const [name, held] of this.meshes) {
      held.mesh.count = at.get(name) || 0
      held.mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Make sure there is an instanced mesh for `name` with room for `count` of it. */
  _room(name, count) {
    const held = this.meshes.get(name)
    if (held && held.capacity >= count) return
    const model = models.get(name)
    if (!model) return
    if (held) {
      this.group.remove(held.mesh)
      held.mesh.material.dispose()
      held.mesh.dispose()
    }
    // Room to grow into, so a workspace arriving does not rebuild every kind of part.
    const capacity = Math.max(8, Math.ceil(count * 1.5))
    const mesh = new THREE.InstancedMesh(model.geometry, surface(model.material), capacity)
    mesh.name = `settlement:${name}`
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Its instances are all over the campus: the bounds of one say nothing about the rest.
    mesh.frustumCulled = false
    this.group.add(mesh)
    this.meshes.set(name, { mesh, capacity })
  }

  dispose() {
    for (const { mesh } of this.meshes.values()) {
      mesh.material.dispose()
      mesh.dispose()
    }
    this.meshes.clear()
    this.group.removeFromParent()
  }
}
