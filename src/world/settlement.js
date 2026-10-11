import { assetUrl } from '../core/asset-url.js'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { curveUniforms, withCurve } from '../core/curve.js'
import { tameSheen } from '../core/sheen.js'
import { RESHADE, SHADES, callPulse, shadeOf } from './shades.js'
import { TILE, boundTile, tileOf } from './tiles.js'
import { campusBuilding } from './campus-buildings.js'

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
  loading ??= new GLTFLoader().loadAsync(assetUrl(`campus/settlement.glb`)).then((gltf) => {
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
function surface(source, shaded = true, shade = null) {
  const material = source.clone()
  material.metalness = 0.7
  material.emissiveIntensity = 1.7
  // Steel in the sun must not go white: see `sheen.js`. And its lamps burn in the shade of the
  // workspace it stands on, which each instance carries: see `shades.js`.
  material.onBeforeCompile = (shader) => {
    tameSheen(withCurve(shader))
    // What is drawn one at a time, a walkway's pieces, has no shade to carry and stays amber.
    if (!shaded) {
      // Unless it is given one of its own: a walkway's lamps burn the colour of its strips.
      if (shade) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${RESHADE.replaceAll('GLOW', `vec4(${shade.map((v) => v.toFixed(3)).join(', ')}, 1.0)`)}`)
      return
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aGlow;\nvarying vec4 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = aGlow;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${RESHADE.replaceAll('GLOW', 'vGlow')}`)
  }
  // Two programs from one source: three must not take the one for the other.
  material.customProgramCacheKey = () => `settlement-${shaded ? 'shaded' : shade ? shade.join('-') : 'plain'}`
  return material
}

export class Settlement {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'settlement'
    scene.add(this.group)
    /** @type {Map<string, {mesh: THREE.InstancedMesh, capacity: number}>} */
    this.meshes = new Map()
    /** The squares of ground it is drawn by: see `tiles.js`. */
    this.tiles = new Map()
    this.materials = new Map()
    /** How far from the camera a square is drawn by its far twins. */
    this.farFrom = FAR_FROM
    this.parts = []
    this.lifts = new Map()
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._p = new THREE.Vector3()
    this._s = new THREE.Vector3(1, 1, 1)
    this._up = new THREE.Vector3(0, 1, 0)
    this._across = new THREE.Vector3(1, 0, 0)
    this._tip = new THREE.Quaternion()
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

  /**
   * Which workspaces need somebody, and the time: every lamp, lit strip and window on their
   * parts beats, by day as well as night. It is the fixtures themselves that beat, so a
   * workspace calls as plainly as it is built up. Only their own parts are touched.
   */
  setCalling(plots, elapsed) {
    const now = plots?.size ? [...plots].sort().join('|') : ''
    if (now !== this._calling) {
      // One that has stopped calling goes back to how it burns at rest.
      this._calling = now
      this._write()
    }
    if (!now) return
    const { gain, white } = callPulse(elapsed)
    const touched = new Set()
    for (const slot of this.slots) {
      if (!slot.shade || !plots.has(slot.part.plot)) continue
      for (let k = 0; k < 3; k++) slot.held.glow.array[slot.n * 4 + k] = (slot.shade[k] + (HOT[k] - slot.shade[k]) * white) * gain
      slot.held.glow.array[slot.n * 4 + 3] = 1
      touched.add(slot.held)
    }
    for (const held of touched) held.glow.needsUpdate = true
  }

  /**
   * How a part is drawn near and far. A part that has a far twin in the kit (`<part>-far`,
   * the same thing in a few triangles) is drawn in full near the camera and as its twin
   * beyond; a small thing that cannot be made out from far off is drawn near only; anything
   * else is drawn as it is wherever it is.
   *
   * @returns {Array<[string, string]>} each a level (`near`, `far` or `always`) and the model drawn at it
   */
  _levels(name) {
    if (models.has(`${name}-far`)) return [['near', name], ['far', `${name}-far`]]
    if (NEAR_ONLY.test(name)) return [['near', name]]
    return [['always', name]]
  }

  _write() {
    this.slots = []
    // Each kind of part, by the square of ground it stands on (see `tiles.js`) and by how near it is drawn.
    const keysOf = (part) => {
      const { tx, tz } = tileOf(part.x, part.z)
      return this._levels(part.part).map(([level, model]) => `${tx},${tz}|${model}|${level}`)
    }
    const counts = new Map()
    for (const part of this.parts) for (const key of keysOf(part)) counts.set(key, (counts.get(key) || 0) + 1)
    for (const [key, count] of counts) this._room(key, count)
    for (const tile of this.tiles.values()) {
      tile.low = Infinity
      tile.high = -Infinity
    }

    const at = new Map()
    for (const part of this.parts) {
      const y = part.y + (this.lifts.get(part.plot) || 0)
      this._p.set(part.x, y, part.z)
      this._q.setFromAxisAngle(this._up, part.turn)
      // A run hung between two stacks is tipped to meet its far end: see `settlementRuns`.
      if (part.pitch) this._q.multiply(this._tip.setFromAxisAngle(this._across, part.pitch))
      // Drawn out downward from the deck, where it has further to reach (see `reachDown`), or along its length to its span.
      this._s.set(1, part.stretch || 1, part.span || 1)
      this._m.compose(this._p, this._q, this._s)
      // A neon sign is its own colour; everything else takes the workspace's shade.
      const shade = /^sign-/.test(part.part) ? null : SHADES[shadeOf(part.plot)]
      for (const key of keysOf(part)) {
        const held = this.meshes.get(key)
        if (!held) continue
        const n = at.get(key) || 0
        at.set(key, n + 1)
        held.tile.low = Math.min(held.tile.low, y - BELOW)
        held.tile.high = Math.max(held.tile.high, y + ABOVE)
        held.mesh.setMatrixAt(n, this._m)
        held.glow.array.set(shade ? [...shade, 1] : [1, 1, 1, 0], n * 4)
        // What it beats from when its workspace calls: its shade, or the amber it was made. A sign keeps its own colour.
        this.slots.push({ part, held, n, shade: /^sign-/.test(part.part) ? null : shade || AMBER })
      }
    }
    for (const [key, held] of this.meshes) {
      held.mesh.count = at.get(key) || 0
      held.mesh.visible = held.mesh.count > 0
      held.mesh.instanceMatrix.needsUpdate = true
      held.glow.needsUpdate = true
    }
  }

  /**
   * Once a frame, with the camera as it is about to draw.
   *
   * Says where each square of the campus is to be looked for, so that three leaves out the
   * ones that cannot be seen: from the camera, and again from the sun when it draws the
   * shadows, which is the same parts over again and only a small part of a big campus. Where
   * a square is depends on the view, since the world bends: see `tiles.js`.
   *
   * And says which squares are near enough to be drawn in full: see `_levels`.
   */
  cull(camera) {
    const curve = { focus: curveUniforms.uCurveFocus.value, forward: curveUniforms.uCurveForward.value, amount: curveUniforms.uCurveAmount.value }
    for (const tile of this.tiles.values()) {
      if (!(tile.high > tile.low)) continue
      // Every mesh of the square has this one sphere for its bounds.
      boundTile(tile.sphere, tile, curve)
      // How far the nearest of the square is from the camera, over the ground. Once it is drawn
      // one way it stays so until it is well past the line, so nothing flickers on it.
      const dx = Math.max(tile.tx * TILE - camera.position.x, 0, camera.position.x - (tile.tx + 1) * TILE)
      const dz = Math.max(tile.tz * TILE - camera.position.z, 0, camera.position.z - (tile.tz + 1) * TILE)
      const away = Math.hypot(dx, dz, camera.position.y)
      if (tile.far ? away < this.farFrom - FAR_SLACK : away > this.farFrom + FAR_SLACK) tile.far = !tile.far
      tile.levels.near.visible = !tile.far
      tile.levels.far.visible = tile.far
    }
  }

  /** Make sure there is an instanced mesh for `key` (a square and a kind of part) with room for `count` of it. */
  _room(key, count) {
    const held = this.meshes.get(key)
    if (held && held.capacity >= count) return
    const [square, name, level] = key.split('|')
    const model = models.get(name)
    if (!model) return
    let tile = this.tiles.get(square)
    if (!tile) {
      const [tx, tz] = square.split(',').map(Number)
      tile = { tx, tz, low: Infinity, high: -Infinity, group: new THREE.Group(), sphere: new THREE.Sphere(new THREE.Vector3((tx + 0.5) * TILE, 0, (tz + 0.5) * TILE), TILE) }
      tile.group.name = `settlement-tile:${square}`
      tile.far = false
      tile.levels = { near: new THREE.Group(), far: new THREE.Group(), always: new THREE.Group() }
      tile.levels.far.visible = false
      tile.group.add(tile.levels.near, tile.levels.far, tile.levels.always)
      this.group.add(tile.group)
      this.tiles.set(square, tile)
    }
    if (held) {
      tile.levels[level].remove(held.mesh)
      held.mesh.geometry.dispose()
      held.mesh.dispose()
    }
    // Room to grow into, so a workspace arriving does not rebuild every kind of part.
    const capacity = Math.max(4, Math.ceil(count * 1.5))
    // The model's own vertices, shared by every square; only the shade of each instance's lamps is this mesh's own.
    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(model.geometry.index)
    for (const [attribute, value] of Object.entries(model.geometry.attributes)) geometry.setAttribute(attribute, value)
    for (const group of model.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex)
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    geometry.setAttribute('aGlow', glow)
    let material = this.materials.get(name)
    if (!material) this.materials.set(name, (material = surface(model.material)))
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.name = `settlement:${name}`
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Left out when its square cannot be seen. Its bounds are its square's, kept where the world's bend puts them: see `cull`.
    mesh.boundingSphere = tile.sphere
    tile.levels[level].add(mesh)
    this.meshes.set(key, { mesh, capacity, glow, tile })
  }

  dispose() {
    for (const { mesh } of this.meshes.values()) mesh.dispose()
    for (const material of this.materials.values()) material.dispose()
    this.meshes.clear()
    this.materials.clear()
    this.tiles.clear()
    this.group.removeFromParent()
  }
}

/** The small things that cannot be made out from far off, and are drawn near only. */
const NEAR_ONLY = /^(run-|mast-|under-lamp$|ladder$|edge|dish$|port-gate$)/
/** How far from the camera a square is drawn by its far twins, and how far past that line it goes before it changes. */
const FAR_FROM = 170
const FAR_SLACK = 12

/** How far below and above where a part is put anything of it reaches: a leg down into a canal, a stack and a mast up. */
const BELOW = 10
const ABOVE = 11
/** The amber a lamp is made, as a shade, and the hot white a calling workspace's lamps beat toward. */
const AMBER = [1.0, 0.69, 0.05]
const HOT = [1.0, 0.92, 0.78]

const TINT = { amber: 0xfdb000, cyan: 0x35d6ff, magenta: 0xff3fd0, white: 0xffd9a0, red: 0xff4a1c, teal: 0x2ee6c6, ice: 0x8cc6ff }

/**
 * The pools of light on the decks: the kit's two pictures, laid flat and added to what is
 * under them, one instanced mesh a picture for the whole campus. See `settlementPools`.
 */
export class LightPools {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'settlement-light'
    scene.add(this.group)
    this.pools = []
    this.lifts = new Map()
    this.strength = 1
    const loader = new THREE.TextureLoader()
    this.kinds = new Map(['round', 'band'].map((kind) => {
      const map = loader.load(assetUrl(`campus/pool-${kind}.png`))
      map.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.MeshBasicMaterial({
        map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })
      material.onBeforeCompile = (shader) => withCurve(shader)
      // A unit square lying flat, its own +z the way the light is thrown.
      const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
      return [kind, { geometry, material, mesh: null, capacity: 0 }]
    }))
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._p = new THREE.Vector3()
    this._s = new THREE.Vector3()
    this._c = new THREE.Color()
    this._white = new THREE.Color()
    this._up = new THREE.Vector3(0, 1, 0)
  }

  /** @param {ReturnType<typeof import('./settlement-plan.js').settlementPools>} pools  each with the `plot` it is on */
  set(pools) {
    this.pools = pools
    this._write()
  }

  setLift(plot, dy) {
    if (dy) this.lifts.set(plot, dy)
    else this.lifts.delete(plot)
    this._write()
  }

  /** How bright the pools are: nothing in full daylight, all of it after dark. */
  setStrength(strength) {
    if (Math.abs(strength - this.strength) < 0.01) return
    this.strength = strength
    this._write()
  }

  /**
   * Which workspaces need somebody, and the time: their pools beat, by day as well as night.
   * Only their own pools are touched, so a quiet campus costs nothing.
   */
  setCalling(plots, elapsed) {
    const calling = plots?.size ? plots : null
    if (!calling) {
      if (this._called) {
        this._called = false
        this._calling = ''
        this._write()
      }
      return
    }
    this._called = true
    const { gain, white } = callPulse(elapsed)
    const touched = new Set()
    for (const slot of this.slots || []) {
      if (!calling.has(slot.pool.calls ?? slot.pool.plot)) continue
      const base = this._base(slot.pool, Math.max(this.strength, 0.75))
      base.lerp(this._white.copy(base).setScalar(Math.max(base.r, base.g, base.b)), white).multiplyScalar(gain)
      slot.held.mesh.setColorAt(slot.n, base)
      touched.add(slot.held)
    }
    // A workspace that has stopped calling goes back to how it burns at rest.
    const now = [...calling].sort().join('|')
    if (now !== this._calling) {
      this._calling = now
      this._write()
      return this.setCalling(plots, elapsed)
    }
    for (const held of touched) if (held.mesh.instanceColor) held.mesh.instanceColor.needsUpdate = true
  }

  /** The colour a pool burns at rest. */
  _base(pool, strength = this.strength) {
    return this._c.setHex(TINT[pool.color] ?? TINT.amber).multiplyScalar(strength * (pool.color === 'amber' ? 0.5 : 0.7) * (pool.gain || 1))
  }

  _write() {
    this.slots = []
    const counts = new Map()
    for (const pool of this.pools) counts.set(pool.kind, (counts.get(pool.kind) || 0) + 1)
    const at = new Map()
    for (const [kind, held] of this.kinds) {
      const count = counts.get(kind) || 0
      if (count > held.capacity) {
        if (held.mesh) {
          this.group.remove(held.mesh)
          held.mesh.dispose()
        }
        held.capacity = Math.max(16, Math.ceil(count * 1.5))
        held.mesh = new THREE.InstancedMesh(held.geometry, held.material, held.capacity)
        held.mesh.name = `settlement-light:${kind}`
        held.mesh.frustumCulled = false
        held.mesh.renderOrder = 2
        this.group.add(held.mesh)
      }
      at.set(kind, 0)
    }
    for (const pool of this.pools) {
      const held = this.kinds.get(pool.kind)
      if (!held?.mesh) continue
      const n = at.get(pool.kind)
      at.set(pool.kind, n + 1)
      this._p.set(pool.x, pool.y + (this.lifts.get(pool.plot) || 0), pool.z)
      this._q.setFromAxisAngle(this._up, pool.turn)
      this._s.set(pool.width, 1, pool.depth)
      held.mesh.setMatrixAt(n, this._m.compose(this._p, this._q, this._s))
      held.mesh.setColorAt(n, this._base(pool))
      this.slots.push({ pool, held, n })
    }
    for (const [kind, held] of this.kinds) {
      if (!held.mesh) continue
      held.mesh.count = at.get(kind)
      held.mesh.instanceMatrix.needsUpdate = true
      if (held.mesh.instanceColor) held.mesh.instanceColor.needsUpdate = true
    }
  }

  dispose() {
    for (const held of this.kinds.values()) {
      held.mesh?.dispose()
      held.geometry.dispose()
      held.material.map?.dispose()
      held.material.dispose()
    }
    this.group.removeFromParent()
  }
}

/**
 * The numbers painted on the decks: the kit's sheet of ten stencilled digits, one flat quad a
 * digit, one instanced mesh for the whole campus. Each instance says which digit it is, and
 * the shader takes that tenth of the sheet. See `settlementNumbers`.
 */
export class DeckNumbers {
  constructor(scene) {
    this.digits = []
    this.lifts = new Map()
    this.capacity = 0
    this.mesh = null
    this.scene = scene
    const map = new THREE.TextureLoader().load(assetUrl('campus/stencil-digits.png'))
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
    // Old paint: pale, dull, and lit like the plate it is on, so it does not glow at night.
    this.material = new THREE.MeshStandardMaterial({
      map, color: 0xb9b6ab, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })
    this.material.onBeforeCompile = (shader) => {
      withCurve(shader)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDigit;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = vec2( ( uv.x + aDigit ) / 10.0, uv.y );')
    }
    // A unit square lying flat: the sheet's left to right along +x, its bottom to top along -z.
    this.geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._p = new THREE.Vector3()
    this._s = new THREE.Vector3()
    this._up = new THREE.Vector3(0, 1, 0)
  }

  /** @param {ReturnType<typeof import('./settlement-plan.js').settlementNumbers>} digits */
  set(digits) {
    this.digits = digits
    this._write()
  }

  setLift(plot, dy) {
    if (dy) this.lifts.set(plot, dy)
    else this.lifts.delete(plot)
    this._write()
  }

  _write() {
    const count = this.digits.length
    if (count > this.capacity) {
      if (this.mesh) {
        this.scene.remove(this.mesh)
        this.mesh.dispose()
      }
      this.capacity = Math.max(32, Math.ceil(count * 1.5))
      const geometry = this.geometry.clone()
      this.which = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1)
      geometry.setAttribute('aDigit', this.which)
      this.mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity)
      this.mesh.name = 'settlement-numbers'
      this.mesh.frustumCulled = false
      this.mesh.receiveShadow = true
      this.mesh.renderOrder = 1
      this.scene.add(this.mesh)
    }
    if (!this.mesh) return
    this.digits.forEach((digit, n) => {
      this._p.set(digit.x, digit.y + (this.lifts.get(digit.plot) || 0), digit.z)
      this._q.setFromAxisAngle(this._up, digit.turn)
      this._s.set(digit.width, 1, digit.height)
      this.mesh.setMatrixAt(n, this._m.compose(this._p, this._q, this._s))
      this.which.array[n] = digit.digit
    })
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    this.which.needsUpdate = true
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.dispose()
    }
    this.geometry.dispose()
    this.material.map?.dispose()
    this.material.dispose()
  }
}

/**
 * The walkways from the square, drawn: the kit's ground pieces where `walkwayRoute` says, and
 * the stairs up at the far end. There are two of these at most and a few dozen pieces, and a
 * corner that bends the other way is the same piece seen in a mirror, so each is a mesh of
 * its own.
 */
export class Walkways {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'settlement-walkways'
    scene.add(this.group)
    this.materials = new Map()
  }

  /** @param {Array<{part: string, x: number, y: number, z: number, turn: number, mirror?: boolean, stretch?: number}>} pieces */
  set(pieces) {
    this.group.clear()
    for (const piece of pieces) {
      // A lamp beside the way is one of the campus's own buildings; everything else is the kit's.
      const model = piece.campus ? campusBuilding(piece.part) : models.get(piece.part)
      if (!model) continue
      const key = piece.shade ? `${piece.part}/${piece.shade}` : piece.part
      let material = this.materials.get(key)
      if (!material) {
        material = surface(model.material, false, piece.shade || null)
        this.materials.set(key, material)
      }
      const mesh = new THREE.Mesh(model.geometry, material)
      mesh.position.set(piece.x, piece.y, piece.z)
      mesh.rotation.y = piece.turn
      mesh.scale.set(piece.mirror ? -1 : 1, 1, piece.stretch || 1)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
  }

  dispose() {
    this.group.clear()
    for (const material of this.materials.values()) material.dispose()
    this.group.removeFromParent()
  }
}
