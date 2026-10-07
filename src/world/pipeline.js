import * as THREE from 'three'
import { withCurve } from '../core/curve.js'
import { campusBuilding } from './campus-buildings.js'
import { GROUND_SIZE } from './planet.js'

/**
 * The coolant lines of a world that has them: glass pipe on cradles, standing on the floor,
 * with the coolant alight inside it. A square ring round the colony, a line running out from
 * the middle of each side, and a pump house wherever lines meet.
 *
 * Square, and square to the world, because the floor it stands on is laid on a square grid:
 * the lines run along the plate seams, midway between the floor's conduits.
 *
 * Three models of the project's own (`design/campus/build_buildings.py`): `pipe`, eight
 * metres of line along x; `pipe_glass`, its sleeve, which is not baked because it is drawn
 * see-through; and `pump`. Each is one instanced draw however long the lines are.
 */

/** The length of one `pipe`, which is what the lines are measured out in. */
const LENGTH = 8

/** Time for the coolant's flow. The colony sets it once a frame. */
export const pipelineUniforms = { uTime: { value: 0 } }

/**
 * Where everything stands.
 *
 * @param {{ring: number}} spec  `ring` is how far out the ring runs, a multiple of the pipe length
 * @returns {{pipes: Array<{x: number, z: number, turned: boolean}>, pumps: Array<{x: number, z: number}>}}
 *   `turned` pipes run along z.
 */
export function pipelineLayout(spec) {
  const ring = spec.ring
  const reach = GROUND_SIZE / 2 - LENGTH
  const pipes = []
  const pumps = []
  for (const side of [-1, 1]) {
    for (let at = -ring + LENGTH / 2; at < ring; at += LENGTH) {
      pipes.push({ x: at, z: side * ring, turned: false })
      pipes.push({ x: side * ring, z: at, turned: true })
    }
    for (let at = ring + LENGTH / 2; at < reach; at += LENGTH) {
      pipes.push({ x: side * at, z: 0, turned: false })
      pipes.push({ x: 0, z: side * at, turned: true })
    }
    pumps.push({ x: side * ring, z: 0 }, { x: 0, z: side * ring })
    pumps.push({ x: side * ring, z: ring }, { x: side * ring, z: -ring })
  }
  return { pipes, pumps }
}

/**
 * Discs that cover the lines, for whatever must not be put down under them.
 * @returns {Array<{x: number, z: number, r: number}>}
 */
export function pipelineClearance(spec) {
  const { pipes, pumps } = pipelineLayout(spec)
  const out = pumps.map((p) => ({ x: p.x, z: p.z, r: 5 }))
  for (const p of pipes) {
    for (const along of [-LENGTH / 4, LENGTH / 4]) {
      out.push({ x: p.x + (p.turned ? 0 : along), z: p.z + (p.turned ? along : 0), r: 3.4 })
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
 * @param {{ring: number}} spec
 * @param {(x: number, z: number) => number} heightAt  the floor under a point
 * @returns {THREE.Group | null} null if the models have not loaded
 */
export function createPipeline(spec, heightAt) {
  const pipe = campusBuilding('pipe')
  const glass = campusBuilding('pipe_glass')
  const pump = campusBuilding('pump')
  if (!pipe || !glass || !pump) return null

  const { pipes, pumps } = pipelineLayout(spec)
  const group = new THREE.Group()
  group.name = 'pipeline'

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
  const houses = new THREE.InstancedMesh(pump.geometry.clone(), flowing(pump.material), pumps.length)

  const dummy = new THREE.Object3D()
  pipes.forEach((p, i) => {
    dummy.position.set(p.x, heightAt(p.x, p.z), p.z)
    dummy.rotation.set(0, p.turned ? Math.PI / 2 : 0, 0)
    dummy.updateMatrix()
    lines.setMatrixAt(i, dummy.matrix)
    sleeves.setMatrixAt(i, dummy.matrix)
  })
  pumps.forEach((p, i) => {
    dummy.position.set(p.x, heightAt(p.x, p.z), p.z)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    houses.setMatrixAt(i, dummy.matrix)
  })

  for (const mesh of [lines, houses]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  // After the coolant, so the sleeve blends over it.
  sleeves.renderOrder = 2
  group.add(sleeves)
  for (const mesh of group.children) {
    mesh.instanceMatrix.needsUpdate = true
    // The lines run to the edge of the world; one bounding sphere round an instance is not it.
    mesh.frustumCulled = false
  }
  return group
}
