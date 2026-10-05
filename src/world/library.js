import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { bendPoint } from '../core/curve.js'

/** Build the permanent reading hall independently of session buildings and their lifecycle. */
export class Library {
  /** @param {THREE.Scene} scene @param {THREE.Vector3} position */
  constructor(scene, position) {
    this.group = new THREE.Group()
    this.group.name = 'campus-library'
    this.group.position.copy(position)
    this.group.rotation.y = Math.atan2(-position.x, -position.z)
    this.radius = 4.6
    this.ray = new THREE.Raycaster()
    this.bent = new THREE.Vector3()
    this.meshes = []
    const parts = new Map()

    /** Collect geometry by material to keep the entire landmark to four draw calls.
     * @param {THREE.BufferGeometry} geometry @param {number} color @returns {void}
     */
    const add = (geometry, color) => {
      if (!parts.has(color)) parts.set(color, [])
      const flat = geometry.toNonIndexed()
      parts.get(color).push(flat)
      geometry.dispose()
    }
    /** Place a solid architectural element in the hall's local frame.
     * @param {number[]} size @param {number[]} at @param {number} color
     * @param {number} tilt @returns {void}
     */
    const box = (size, at, color, tilt = 0) => {
      const geometry = new THREE.BoxGeometry(...size)
      geometry.rotateZ(tilt)
      geometry.translate(...at)
      add(geometry, color)
    }
    const ink = 0x24252b, stone = 0xe6e3da, amber = 0xfdc700, glass = 0x487b91
    const pad = new THREE.CylinderGeometry(6.0, 6.2, 0.5, 6)
    pad.rotateY(Math.PI / 6)
    pad.translate(0, 0.05, 0)
    add(pad, ink)
    box([7.0, 2.65, 4.6], [0, 1.62, 0], stone)
    box([6.6, 1.55, 0.12], [0, 1.7, 2.32], glass)
    box([0.12, 1.55, 3.8], [-3.52, 1.7, 0], glass)
    box([0.12, 1.55, 3.8], [3.52, 1.7, 0], glass)
    for (const x of [-3.1, -1.5, 1.5, 3.1]) box([0.13, 1.8, 0.2], [x, 1.7, 2.4], ink)
    box([1.1, 2.2, 0.22], [0, 1.4, 2.42], ink)
    box([0.12, 1.9, 0.24], [-0.65, 1.4, 2.44], amber)
    box([0.12, 1.9, 0.24], [0.65, 1.4, 2.44], amber)
    // Two rising roof leaves give the Library its open-book silhouette.
    for (const side of [-1, 1]) {
      box([3.85, 0.3, 5.35], [side * 1.88, 3.23, 0], ink, side * 0.17)
      box([3.85, 0.09, 5.36], [side * 1.88, 3.42, 0], amber, side * 0.17)
      box([3.25, 0.08, 3.85], [side * 1.88, 3.48, 0], stone, side * 0.17)
    }
    box([1.8, 0.14, 1.3], [0, 0.31, 3.15], stone)
    box([2.2, 0.11, 1.1], [0, 0.22, 4.0], stone)
    // Reading benches on the apron; they remain clear of the entrance.
    for (const x of [-3.5, 3.5]) box([1.35, 0.45, 0.6], [x, 0.53, 3.3], amber)

    for (const [color, geometries] of parts) {
      const geometry = mergeGeometries(geometries)
      geometries.forEach(part => part.dispose())
      const material = new THREE.MeshStandardMaterial({ color, roughness: color === glass ? 0.22 : 0.65, metalness: 0.08 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.meshes.push(mesh)
    }
    scene.add(this.group)
  }

  /** Hit the physical building, adjusting for the world's shader curvature at its anchor.
   * @param {number} x @param {number} y @param {THREE.Camera} camera @returns {boolean}
   */
  containsPointer(x, y, camera) {
    this.group.updateWorldMatrix(true, true)
    this.ray.setFromCamera({ x, y }, camera)
    const offset = bendPoint(this.bent.copy(this.group.position)).y - this.group.position.y
    this.ray.ray.origin.y -= offset
    return this.ray.intersectObjects(this.meshes, false).length > 0
  }

  /** Release the landmark's owned GPU resources.
   * @returns {void}
   */
  dispose() {
    this.group.removeFromParent()
    for (const mesh of this.meshes) { mesh.geometry.dispose(); mesh.material.dispose() }
  }
}
