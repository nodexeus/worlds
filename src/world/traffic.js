import * as THREE from 'three'
import { campusBuilding } from './campus-buildings.js'
import { GROUND_SIZE, mulberry } from './planet.js'

/**
 * What crosses the sky of a world that has traffic: a flight of cargo skiffs, now and then, on
 * its way from somewhere to somewhere else. It is to a built world what a skein of birds is to
 * a grown one. Nothing about it means anything; it is there because a sky nothing ever
 * crosses is a painted one.
 *
 * A pass is a straight line over the world, edge to edge, at a height and speed of its own,
 * flown by one to three craft in a loose V. Between passes the sky is empty for a while.
 *
 * The craft is a model of the project's own (`skiff` in `design/campus/build_buildings.py`),
 * drawn as one instanced mesh.
 */

/** The most craft in a flight, and so the most ever in the air. */
const MOST = 3

/** How far out a pass starts and ends: past the edge of the ground, and well into the fog. */
const REACH = GROUND_SIZE * 0.72

/**
 * Plan one pass.
 *
 * @param {() => number} rand
 * @param {{flight?: [number, number]}} spec  the fewest and the most craft in a flight
 * @returns {{
 *   from: {x: number, z: number}, heading: {x: number, z: number}, length: number,
 *   height: number, speed: number,
 *   craft: Array<{back: number, out: number, up: number}>,
 * }} `craft` is where each flies relative to the leader: behind it, out to one side, above.
 */
export function planPass(rand, spec = {}) {
  const [fewest, most] = spec.flight || [1, MOST]
  // Any heading, and never straight over the middle: off to one side by up to a third of
  // the way out, so a pass crosses the view and does not just come at it.
  const bearing = rand() * Math.PI * 2
  const heading = { x: Math.cos(bearing), z: Math.sin(bearing) }
  const side = (rand() - 0.5) * 2 * REACH * 0.36
  const from = { x: -heading.x * REACH - heading.z * side, z: -heading.z * REACH + heading.x * side }
  const count = Math.min(MOST, fewest + Math.floor(rand() * (most - fewest + 1)))
  const craft = []
  for (let i = 0; i < count; i++) {
    // The leader, then one off each wing, a little behind and a little above or below.
    const wing = i === 0 ? 0 : i % 2 === 1 ? 1 : -1
    const rank = Math.ceil(i / 2)
    craft.push({ back: rank * (9 + rand() * 4), out: wing * rank * (7 + rand() * 3), up: (rand() - 0.5) * 2.4 })
  }
  return { from, heading, length: REACH * 2, height: 30 + rand() * 18, speed: 22 + rand() * 10, craft }
}

export class Traffic {
  /**
   * @param {THREE.Object3D} group
   * @param {{every?: [number, number], flight?: [number, number]}} spec  `every` is the
   *   shortest and longest the sky stays empty between passes, in seconds
   * @param {number} seed
   */
  constructor(group, spec, seed) {
    this.spec = spec
    this.rand = mulberry(seed)
    this.pass = null
    this.gone = 0
    // Not long before the first: a world should not have to be watched for a minute to find
    // out that anything flies over it.
    this.wait = 6 + this.rand() * 14
    this.mesh = null
    this.group = group
    this._dummy = new THREE.Object3D()
  }

  /** Built when first needed, because the model may not have loaded when the world was. */
  _build() {
    const model = campusBuilding('skiff')
    if (!model) return false
    const material = model.material.clone()
    // As for everything else of the campus's: see `bakedMaterial` in buildings.js.
    material.metalness = 0.7
    material.emissiveIntensity = 2.2
    this.mesh = new THREE.InstancedMesh(model.geometry.clone(), material, MOST)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)
    return true
  }

  update(dt, elapsed, motion = 1) {
    if (!this.mesh && !this._build()) return
    if (!this.pass) {
      this.wait -= dt
      if (this.wait > 0) return
      this.pass = planPass(this.rand, this.spec)
      this.gone = 0
    }
    const pass = this.pass
    this.gone += pass.speed * dt * motion
    const { heading, from } = pass
    // Yaw that points the model's nose (+x) along the heading.
    const yaw = Math.atan2(-heading.z, heading.x)
    const dummy = this._dummy
    let shown = 0
    for (const craft of pass.craft) {
      const along = this.gone - craft.back
      if (along < 0 || along > pass.length) continue
      // A long slow rise and fall, each to its own beat: air, not rails.
      const bob = Math.sin(elapsed * 0.7 + craft.back) * 0.5
      dummy.position.set(
        from.x + heading.x * along - heading.z * craft.out,
        pass.height + craft.up + bob,
        from.z + heading.z * along + heading.x * craft.out
      )
      dummy.rotation.set(Math.sin(elapsed * 0.5 + craft.out) * 0.06, yaw, Math.cos(elapsed * 0.7 + craft.back) * 0.03, 'YXZ')
      dummy.updateMatrix()
      this.mesh.setMatrixAt(shown++, dummy.matrix)
    }
    this.mesh.count = shown
    this.mesh.instanceMatrix.needsUpdate = true
    // Over once the last of them is out the far side.
    if (this.gone > pass.length + Math.max(...pass.craft.map((c) => c.back))) {
      this.pass = null
      const [soonest, latest] = this.spec.every || [40, 90]
      this.wait = soonest + this.rand() * (latest - soonest)
    }
  }

  dispose() {
    if (!this.mesh) return
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh = null
  }
}
