import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { withCurve } from '../core/curve.js'
import { campusBuilding } from './campus-buildings.js'
import { GROUND_SIZE, mulberry } from './planet.js'

/**
 * The coolant lines of a world that has them: glass pipe standing on cradles over the floor,
 * with the coolant alight and moving inside it.
 *
 * They are part of the landscape, not of the colony. Two trunk lines come in over one horizon,
 * curve past the colony on either side of it and go out over the other, wandering as the seed
 * has them wander. Pump houses stand in the trunks here and there. Spurs curve away from them
 * to a pump house of their own out on the floor. And a few thin feeders leave the trunks the
 * other way, for the colony, each ending at a cabinet against the edge of a deck: the colony
 * is plumbed in to whatever these lines are part of.
 *
 * Nothing about the trunks follows the colony's outline. What the colony decides is how wide
 * a berth they give it: each keeps outside a circle drawn round every deck, so a colony that
 * grows pushes the lines further out, keeping every curve they had, and nothing is ever built
 * over one. The feeders are drawn again to wherever the nearest deck now is.
 *
 * The glass and the coolant are swept along each line's own curve here, because glass curves
 * and a model of a straight length does not. Everything they rest on or run through is a model
 * of the project's own (`design/campus/build_buildings.py`): `cradle`, `pump`, the `joint` a
 * line branches at, and the `cabinet` a feeder ends in. Each is one instanced draw.
 */

/** How high the middle of a line runs above the floor, and how thick its glass is. */
const TRUNK = { height: 1.6, radius: 0.8, cradles: 4.6, scale: 1 }
/** A feeder is the same pipe at about a third the size, on cradles to match. */
const FEEDER = { height: 0.56, radius: 0.28, cradles: 3.0, scale: 0.35 }

/** How far apart a line is sampled. Short enough that a curve is a curve. */
const STEP = 2

/**
 * How far from the middle of a deck tile a feeder stops. A tile on this world is pulled in
 * from its cell, so this is just clear of its edge, with the cabinet standing against it.
 */
const DECK_EDGE = 6.4

/** Time for the coolant's flow. The colony sets it once a frame. */
export const pipelineUniforms = { uTime: { value: 0 } }

/**
 * How wide a berth the trunks give the colony: a circle about the middle of the world that
 * holds every deck, and `margin` more.
 *
 * @param {Array<{x: number, z: number}>} cells  the middle of every deck tile
 * @param {number} margin
 */
export function pipelineBerth(cells, margin) {
  let reach = 0
  for (const c of cells) reach = Math.max(reach, Math.hypot(c.x, c.z))
  return reach + margin
}

/** A smooth line through some points on the floor, as samples `STEP` apart with their headings. */
function sweep(points) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal')
  const count = Math.max(2, Math.round(curve.getLength() / STEP))
  const spaced = curve.getSpacedPoints(count)
  return spaced.map((p, i) => {
    const a = spaced[Math.max(0, i - 1)]
    const b = spaced[Math.min(count, i + 1)]
    return { x: p.x, z: p.z, angle: Math.atan2(-(b.z - a.z), b.x - a.x), along: (i * curve.getLength()) / count }
  })
}

/**
 * Where everything stands.
 *
 * @param {{margin: number, seed: number}} spec  how far clear of the outermost deck's middle
 *   the trunks keep, and what decides their wandering
 * @param {Array<{x: number, z: number}>} cells  the middle of every deck tile
 * @param {(x: number, z: number) => boolean} [open]  whether there is floor at a point to stand
 *   something on. Where there is not (a canal), a line still crosses, but as a clear span:
 *   no cradle is stood there, and no pump house or coupling.
 * @returns {{
 *   lines: Array<{kind: 'trunk' | 'spur' | 'feeder', samples: Array<{x: number, z: number, angle: number, along: number}>}>,
 *   cradles: Array<{x: number, z: number, angle: number, scale: number}>,
 *   joints: Array<{x: number, z: number}>,
 *   pumps: Array<{x: number, z: number, angle: number}>,
 *   cabinets: Array<{x: number, z: number, angle: number}>,
 * }} every `angle` is a turn about y.
 */
export function pipelineLayout(spec, cells, open = () => true) {
  const berth = pipelineBerth(cells, spec.margin)
  // Room for something as big as a pump house, not just for its middle.
  const room = (p, r) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => open(p.x + dx, p.z + dz))
  const rand = mulberry(spec.seed)
  // The feeders are drawn from a seed of their own: where they go depends on where the decks
  // are, and that must not change what the trunks draw.
  const feederRand = mulberry(spec.seed ^ 0x5eed)
  const edge = GROUND_SIZE / 2
  const lines = []
  const joints = []
  const pumps = []
  const cabinets = []

  // The two trunks run roughly the same way, one each side of the colony. Roughly: a few
  // degrees apart, so they are not a pair of rails, but few enough that they would only
  // meet somewhere past the edge of the world.
  const heading = rand() * Math.PI
  ;[1, -1].forEach((side, which) => {
    const angle = heading + (side > 0 ? 0 : (rand() - 0.5) * 0.5)
    const ux = Math.cos(angle)
    const uz = Math.sin(angle)
    // Out to this side of the trunk's own heading.
    const nx = -uz * side
    const nz = ux * side
    // Clear of the berth by more than a curve drawn through these points can cut back.
    const off = berth + 9 + rand() * 18
    const route = []
    // The drawing is spent the same way however big the colony is, so a colony that grows
    // moves a trunk out without changing a single one of its curves.
    for (let t = -edge * 1.4; t < edge * 1.4; t += 26 + rand() * 40) {
      const out = off + rand() * rand() * 46
      route.push({ x: ux * t + nx * out, z: uz * t + nz * out })
    }
    const samples = sweep(route)
    lines.push({ kind: 'trunk', samples })
    const station = (p) => p.x * ux + p.z * uz

    // What stands on the trunk, in the order it is met: nothing nearer the last than this.
    let last = -Infinity
    const free = (p, room) => p.along - last > room

    for (const p of samples) {
      const t = station(p)
      if (Math.abs(t) > edge * 0.8) continue
      const roll = rand()
      // A pump house in the line, the line going in at one port and out at the one opposite.
      if (Math.abs(t) < edge * 0.5 && free(p, 60) && roll < 0.035 && room(p, 3)) {
        pumps.push({ x: p.x, z: p.z, angle: p.angle })
        last = p.along
        continue
      }
      // A spur: away from the colony, in a curve, to a pump house out on the floor.
      if (free(p, 46) && roll > 0.975 && room(p, 2)) {
        const lean = (rand() - 0.5) * 0.9
        const dx = nx * Math.cos(lean) - nz * Math.sin(lean)
        const dz = nx * Math.sin(lean) + nz * Math.cos(lean)
        const length = 26 + rand() * 34
        const bow = (rand() - 0.5) * length * 0.5
        const spur = sweep([
          p,
          { x: p.x + dx * length * 0.5 - dz * bow, z: p.z + dz * length * 0.5 + dx * bow },
          { x: p.x + dx * length, z: p.z + dz * length },
        ])
        const end = spur[spur.length - 1]
        if (!room(end, 3)) continue
        joints.push({ x: p.x, z: p.z })
        pumps.push({ x: end.x, z: end.z, angle: end.angle })
        lines.push({ kind: 'spur', samples: spur })
        last = p.along
      }
    }

    // Feeders: from the stretch of trunk that passes the colony, in to the nearest deck.
    if (!cells.length) return
    for (const want of which === 0 ? [-30, 34] : [6]) {
      let from = samples[0]
      for (const p of samples) if (Math.abs(station(p) - want) < Math.abs(station(from) - want)) from = p
      let deck = cells[0]
      for (const c of cells) if (Math.hypot(c.x - from.x, c.z - from.z) < Math.hypot(deck.x - from.x, deck.z - from.z)) deck = c
      const gap = Math.hypot(from.x - deck.x, from.z - deck.z)
      const dx = (from.x - deck.x) / gap
      const dz = (from.z - deck.z) / gap
      const end = { x: deck.x + dx * DECK_EDGE, z: deck.z + dz * DECK_EDGE }
      const bow = (feederRand() - 0.5) * gap * 0.45
      const feeder = sweep([
        from,
        { x: (from.x + end.x) / 2 - dz * bow, z: (from.z + end.z) / 2 + dx * bow },
        // Square on to the deck for the last of it, so it arrives looking meant.
        { x: end.x + dx * 4, z: end.z + dz * 4 },
        end,
      ])
      joints.push({ x: from.x, z: from.z })
      cabinets.push({ x: end.x, z: end.z, angle: feeder[feeder.length - 1].angle + Math.PI / 2 })
      lines.push({ kind: 'feeder', samples: feeder })
    }
  })

  // Cradles under every line, but not where something else already stands.
  const cradles = []
  const taken = [...joints.map((p) => [p, 2.6]), ...pumps.map((p) => [p, 3.4]), ...cabinets.map((p) => [p, 1.6])]
  for (const line of lines) {
    const size = line.kind === 'feeder' ? FEEDER : TRUNK
    let next = size.cradles / 2
    for (const p of line.samples) {
      if (p.along < next) continue
      next += size.cradles
      if (taken.some(([q, clear]) => Math.hypot(p.x - q.x, p.z - q.z) < clear)) continue
      if (!room(p, 1.2 * size.scale)) continue
      cradles.push({ x: p.x, z: p.z, angle: p.angle, scale: size.scale })
    }
  }
  return { lines, cradles, joints, pumps, cabinets }
}

/**
 * Discs that cover the lines, for whatever must not be put down under them.
 * @returns {Array<{x: number, z: number, r: number}>}
 */
export function pipelineClearance(spec, cells, open) {
  const { lines, joints, pumps, cabinets } = pipelineLayout(spec, cells, open)
  const out = [
    ...pumps.map((p) => ({ x: p.x, z: p.z, r: 5 })),
    ...joints.map((p) => ({ x: p.x, z: p.z, r: 3.4 })),
    ...cabinets.map((p) => ({ x: p.x, z: p.z, r: 2.4 })),
  ]
  for (const line of lines) {
    const r = line.kind === 'feeder' ? 2.4 : 3.6
    line.samples.forEach((p, i) => {
      if (i % 2 === 0) out.push({ x: p.x, z: p.z, r })
    })
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

/** The coolant itself: a column of light, with a swell and a ripple running along it. */
function coolant() {
  const material = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfdc700, emissiveIntensity: 1, roughness: 0.5 })
  material.onBeforeCompile = (shader) => {
    withCurve(shader)
    shader.uniforms.uTime = pipelineUniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float aAlong;\n varying float vAlong;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vAlong = aAlong;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vAlong;\n uniform float uTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           // Measured along the line itself, so the flow follows every curve of it.
           float swell = 0.5 + 0.5 * sin( vAlong * 0.22 - uTime * 1.6 );
           float ripple = 0.5 + 0.5 * sin( vAlong * 1.9 - uTime * 5.0 );
           totalEmissiveRadiance *= 0.4 + swell * 0.6 + ripple * 0.14;
         }`
      )
  }
  material.customProgramCacheKey = () => 'bc-pipeline-coolant'
  return material
}

/**
 * Build the lines.
 *
 * @param {{margin: number, seed: number}} spec
 * @param {Array<{x: number, z: number}>} cells  the middle of every deck tile
 * @param {(x: number, z: number) => number} heightAt  the floor under a point
 * @param {(x: number, z: number) => boolean} [open]  see `pipelineLayout`
 * @returns {THREE.Group | null} null if the models have not loaded
 */
export function createPipeline(spec, cells, heightAt, open) {
  const models = { cradle: campusBuilding('cradle'), joint: campusBuilding('joint'), pump: campusBuilding('pump'), cabinet: campusBuilding('cabinet') }
  if (Object.values(models).some((m) => !m)) return null

  const layout = pipelineLayout(spec, cells, open)
  const group = new THREE.Group()
  group.name = 'pipeline'

  // The glass and the coolant, swept along each line.
  const sleeves = []
  const columns = []
  for (const line of layout.lines) {
    const size = line.kind === 'feeder' ? FEEDER : TRUNK
    const path = new THREE.CatmullRomCurve3(
      line.samples.map((p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + size.height, p.z)),
      false,
      'centripetal'
    )
    const length = line.samples[line.samples.length - 1].along
    const tube = (radius, sides) => {
      const geo = new THREE.TubeGeometry(path, line.samples.length * 2, radius, sides, false)
      const uv = geo.attributes.uv
      const run = new Float32Array(uv.count)
      for (let i = 0; i < uv.count; i++) run[i] = uv.getX(i) * length
      geo.setAttribute('aAlong', new THREE.BufferAttribute(run, 1))
      return geo
    }
    sleeves.push(tube(size.radius, 16))
    columns.push(tube(size.radius * 0.575, 10))
  }
  const merged = (parts) => {
    const geo = BufferGeometryUtils.mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())
    return geo
  }
  const column = new THREE.Mesh(merged(columns), coolant())
  const sleeve = new THREE.Mesh(
    merged(sleeves),
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
    })
  )
  // After the coolant, so the sleeve blends over it.
  sleeve.renderOrder = 2

  const dummy = new THREE.Object3D()
  const stand = (model, places) => {
    const mesh = new THREE.InstancedMesh(model.geometry.clone(), flowing(model.material), Math.max(1, places.length))
    mesh.count = places.length
    places.forEach((p, i) => {
      dummy.position.set(p.x, heightAt(p.x, p.z), p.z)
      dummy.rotation.set(0, p.angle || 0, 0)
      dummy.scale.setScalar(p.scale || 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  group.add(
    column,
    stand(models.cradle, layout.cradles),
    stand(models.joint, layout.joints),
    stand(models.pump, layout.pumps),
    stand(models.cabinet, layout.cabinets),
    sleeve
  )
  // The lines run from one edge of the world to the other; one instance's bounds are not it.
  for (const mesh of group.children) mesh.frustumCulled = false
  return group
}
