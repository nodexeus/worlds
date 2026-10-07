import * as THREE from 'three'
import { withCurve } from '../core/curve.js'
import { campusBuilding } from './campus-buildings.js'

/**
 * The coolant lines of a world that has them: glass pipe on cradles, standing on the floor,
 * with the coolant alight inside it.
 *
 * The line is a loop round the colony, whatever shape the colony is. It is drawn a fixed margin
 * outside every deck, so it bends where the colony bends and is laid again whenever a
 * workspace is added or moved: nothing is ever built over it, and no two colonies have the
 * same loop. A round coupling stands at each bend, and a feed runs in to the loop from each
 * pump house out on the canal.
 *
 * Four models of the project's own (`design/campus/build_buildings.py`): `pipe`, eight metres
 * of line along x; `pipe_glass`, its sleeve, which is not baked because it is drawn
 * see-through; `joint`, the coupling; and `pump`. Each is one instanced draw however long the
 * lines are.
 */

/** The length of one `pipe` as modelled. A run is laid in lengths stretched a little to fit. */
const LENGTH = 8

/** Time for the coolant's flow. The colony sets it once a frame. */
export const pipelineUniforms = { uTime: { value: 0 } }

/** The smallest convex outline round a set of points, counter-clockwise. */
function hull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const half = (list) => {
    const out = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

/** How sharply the outline turns at vertex `i`, in radians. */
function turn(outline, i) {
  const n = outline.length
  const a = outline[(i + n - 1) % n]
  const b = outline[i]
  const c = outline[(i + 1) % n]
  const inward = Math.atan2(b.z - a.z, b.x - a.x)
  const outward = Math.atan2(c.z - b.z, c.x - b.x)
  return Math.abs(Math.atan2(Math.sin(outward - inward), Math.cos(outward - inward)))
}

/**
 * The loop: a convex outline `margin` outside every cell, with the corners that hardly turn
 * and the sides too short to hold a length of pipe taken out.
 *
 * @param {Array<{x: number, z: number}>} cells  the middle of everything the loop must clear
 * @param {number} margin
 * @returns {Array<{x: number, z: number}>}
 */
export function pipelineLoop(cells, margin) {
  const round = []
  for (const cell of cells) {
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6
      round.push({ x: cell.x + Math.cos(a) * margin, z: cell.z + Math.sin(a) * margin })
    }
  }
  const outline = hull(round)
  // Taking a corner out cuts across it, so only the gentlest go, one at a time, until what is
  // left is a handful of real bends with a run of pipe between each.
  while (outline.length > 4) {
    let least = -1
    let leastCost = Infinity
    for (let i = 0; i < outline.length; i++) {
      const next = outline[(i + 1) % outline.length]
      const short = Math.hypot(next.x - outline[i].x, next.z - outline[i].z) < LENGTH * 1.6
      const angle = turn(outline, i)
      if (angle > MIN_BEND && !short) continue
      // Not if the short cut it leaves would pass too near a deck.
      const before = outline[(i + outline.length - 1) % outline.length]
      if (cells.some((c) => toSegment(c, before, next) < margin - CUT)) continue
      if (angle < leastCost) {
        leastCost = angle
        least = i
      }
    }
    if (least < 0) break
    outline.splice(least, 1)
  }
  return outline
}

/** How far a point is from the stretch of line between two others. */
function toSegment(p, a, b) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

/** How much of the margin a corner may be cut by. */
const CUT = 3.5

/** A bend gentler than this is not worth a coupling. */
const MIN_BEND = (24 * Math.PI) / 180

/**
 * Where everything stands.
 *
 * @param {{margin: number, reach: number}} spec  how far outside the decks the loop runs, and
 *   how far out along each axis a pump house stands
 * @param {Array<{x: number, z: number}>} cells  the middle of every deck tile
 * @returns {{
 *   pipes: Array<{x: number, z: number, angle: number, stretch: number}>,
 *   joints: Array<{x: number, z: number}>,
 *   pumps: Array<{x: number, z: number, angle: number}>,
 * }} `angle` is a turn about y; `stretch` is how much longer than modelled a length is.
 */
export function pipelineLayout(spec, cells) {
  const pipes = []
  const joints = pipelineLoop(cells, spec.margin)
  const pumps = []
  if (joints.length < 3) return { pipes, joints: [], pumps }

  const run = (a, b, trimA, trimB) => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const full = Math.hypot(dx, dz)
    const length = full - trimA - trimB
    if (length < LENGTH * 0.5) return
    const count = Math.max(1, Math.round(length / LENGTH))
    const each = length / count
    for (let i = 0; i < count; i++) {
      const along = trimA + each * (i + 0.5)
      pipes.push({ x: a.x + (dx / full) * along, z: a.z + (dz / full) * along, angle: Math.atan2(-dz, dx), stretch: each / LENGTH })
    }
  }

  // The loop. A length runs into the coupling at each end of it, which is a ball a metre across.
  joints.forEach((a, i) => run(a, joints[(i + 1) % joints.length], COUPLING, COUPLING))

  // The feeds: from each pump house in to whichever bend of the loop is nearest. A pump house
  // the colony has grown out past is left out, not laid through the middle of it.
  const reach = joints.reduce((far, p) => Math.max(far, Math.hypot(p.x, p.z)), 0)
  for (const [x, z] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const house = { x: x * spec.reach, z: z * spec.reach }
    if (reach > spec.reach - LENGTH) continue
    let nearest = joints[0]
    for (const p of joints) {
      if (Math.hypot(p.x - house.x, p.z - house.z) < Math.hypot(nearest.x - house.x, nearest.z - house.z)) nearest = p
    }
    pumps.push({ ...house, angle: Math.atan2(-(nearest.z - house.z), nearest.x - house.x) })
    run(house, nearest, PUMP_PORT, COUPLING)
  }
  return { pipes, joints, pumps }
}

/** How far from a coupling's middle a length of pipe ends, and from a pump house's. */
const COUPLING = 0.9
const PUMP_PORT = 1.9

/**
 * Discs that cover the lines, for whatever must not be put down under them.
 * @returns {Array<{x: number, z: number, r: number}>}
 */
export function pipelineClearance(spec, cells) {
  const { pipes, joints, pumps } = pipelineLayout(spec, cells)
  const out = [...pumps.map((p) => ({ x: p.x, z: p.z, r: 5 })), ...joints.map((p) => ({ x: p.x, z: p.z, r: 3.4 }))]
  for (const p of pipes) {
    const reach = (LENGTH * p.stretch) / 4
    for (const along of [-reach, reach]) {
      out.push({ x: p.x + Math.cos(p.angle) * along, z: p.z - Math.sin(p.angle) * along, r: 3.6 })
    }
  }
  return out
}

/** A baked material of the campus's, with its light made to travel: coolant on the move. */
function flowing(source) {
  const material = source.clone()
  material.metalness = 0.7
  // Kept under the point where the bloom washes amber out to white.
  material.emissiveIntensity = 1.0
  material.onBeforeCompile = (shader) => {
    withCurve(shader)
    shader.uniforms.uTime = pipelineUniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec2 vLineXZ;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vLineXZ = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xz;
         #else
           vLineXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
         #endif`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec2 vLineXZ;\n uniform float uTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           // Slow swells with a quicker ripple on them, running round the ring and out along
           // the spokes: one measure of distance does for both, since every line is square on.
           float along = vLineXZ.x + vLineXZ.y;
           float swell = 0.5 + 0.5 * sin( along * 0.22 - uTime * 1.6 );
           float ripple = 0.5 + 0.5 * sin( along * 1.9 - uTime * 5.0 );
           totalEmissiveRadiance *= 0.4 + swell * 0.6 + ripple * 0.14;
         }`
      )
  }
  material.customProgramCacheKey = () => 'bc-pipeline-flow'
  return material
}

/**
 * Build the lines.
 *
 * @param {{margin: number, reach: number}} spec
 * @param {Array<{x: number, z: number}>} cells  the middle of every deck tile
 * @param {(x: number, z: number) => number} heightAt  the floor under a point
 * @returns {THREE.Group | null} null if the models have not loaded
 */
export function createPipeline(spec, cells, heightAt) {
  const pipe = campusBuilding('pipe')
  const glass = campusBuilding('pipe_glass')
  const joint = campusBuilding('joint')
  const pump = campusBuilding('pump')
  if (!pipe || !glass || !joint || !pump) return null

  const { pipes, joints, pumps } = pipelineLayout(spec, cells)
  const group = new THREE.Group()
  group.name = 'pipeline'
  if (!pipes.length) return group

  const lines = new THREE.InstancedMesh(pipe.geometry.clone(), flowing(pipe.material), pipes.length)
  const sleeves = new THREE.InstancedMesh(
    glass.geometry.clone(),
    new THREE.MeshPhysicalMaterial({
      color: 0xdfeaff,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.2,
      // Glass is mostly its reflections. Not written to depth, so the coolant inside and
      // whatever is behind are both still drawn through it.
      envMapIntensity: 2.2,
      clearcoat: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    pipes.length
  )
  const couplings = new THREE.InstancedMesh(joint.geometry.clone(), flowing(joint.material), joints.length)
  const houses = new THREE.InstancedMesh(pump.geometry.clone(), flowing(pump.material), Math.max(1, pumps.length))
  houses.count = pumps.length

  const dummy = new THREE.Object3D()
  const place = (mesh, i, p, angle = 0, stretch = 1) => {
    dummy.position.set(p.x, heightAt(p.x, p.z), p.z)
    dummy.rotation.set(0, angle, 0)
    dummy.scale.set(stretch, 1, 1)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  pipes.forEach((p, i) => {
    place(lines, i, p, p.angle, p.stretch)
    place(sleeves, i, p, p.angle, p.stretch)
  })
  joints.forEach((p, i) => place(couplings, i, p))
  pumps.forEach((p, i) => place(houses, i, p, p.angle))

  for (const mesh of [lines, couplings, houses]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  // After the coolant, so the sleeve blends over it.
  sleeves.renderOrder = 2
  group.add(sleeves)
  for (const mesh of group.children) {
    mesh.instanceMatrix.needsUpdate = true
    // The lines run right round the colony; one bounding sphere round an instance is not it.
    mesh.frustumCulled = false
  }
  return group
}
