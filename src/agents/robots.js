import * as THREE from 'three'

/**
 * The crew's bodies: robots of the project's own (`design/campus/build_crew.py`), in more than
 * one kind.
 *
 * Every kind is a single mesh with one baked material, drawn on the skeleton the crew have
 * always had, so one can stand in for another with nothing else changing: the same clips, the
 * same bone texture, the same instance attributes. What differs from an ordinary skinned mesh
 * is how it is bound. Every part of a robot is rigid and belongs to exactly one bone, so the
 * model carries a single number per vertex, the bone's place in `ROBOT_BONES`, and the binding
 * is made here: that bone, at full weight.
 */

/** The models, by the name they are packed under. Which one a thread gets is `robotKind`. */
export const ROBOT_KINDS = ['crew-unit', 'crew-rock']

/**
 * The rig's bones in the order the models number them. This is `BONES` in
 * `design/campus/build_crew.py`, and the two must agree.
 */
export const ROBOT_BONES = [
  'hips', 'spine', 'chest', 'head',
  'upperarm.l', 'lowerarm.l', 'wrist.l', 'upperarm.r', 'lowerarm.r', 'wrist.r',
  'upperleg.l', 'lowerleg.l', 'foot.l', 'toes.l', 'upperleg.r', 'lowerleg.r', 'foot.r', 'toes.r',
]

/** A bone's name as the loader may have left it: the dots it strips, and case, set aside. */
const plain = (name) => name.replace(/[^a-z0-9]/gi, '').toLowerCase()

/**
 * Which kind a thread's robot is: decided by the thread alone, so it is the same robot every
 * time that thread is seen, and by nothing else about it, so any workspace may hold any mix.
 *
 * @param {number} hash  a hash of the thread's id
 * @param {number} [kinds]
 */
export function robotKind(hash, kinds = ROBOT_KINDS.length) {
  // The high bits: the low ones already choose a suit tone and a face.
  return ((hash >>> 11) ^ (hash >>> 19)) % kinds
}

/**
 * Where each of `ROBOT_BONES` is in a skeleton, by name.
 *
 * @param {Array<{name: string}>} bones  the rig's bones, in skinning order
 * @returns {number[]}
 */
export function robotBoneMap(bones) {
  const at = new Map(bones.map((bone, i) => [plain(bone.name), i]))
  return ROBOT_BONES.map((name) => {
    const index = at.get(plain(name))
    if (index === undefined) throw new Error(`robots: the rig has no bone "${name}"`)
    return index
  })
}

/**
 * A robot's geometry, bound to the rig.
 *
 * @param {THREE.BufferGeometry} source  the packed model: position, normal, uv and `_bone`
 * @param {Array<{name: string}>} bones
 * @returns {THREE.BufferGeometry} with `skinIndex` and `skinWeight`, ready for the crew's shader
 */
export function robotGeometry(source, bones) {
  const numbered = source.getAttribute('_bone')
  if (!numbered) throw new Error('robots: the model does not say which bone each vertex rides')
  const map = robotBoneMap(bones)
  const count = numbered.count
  const skinIndex = new Float32Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const bone = map[Math.round(numbered.getX(i))]
    if (bone === undefined) throw new Error(`robots: vertex ${i} names bone ${numbered.getX(i)}, which is not on the list`)
    skinIndex[i * 4] = bone
    skinWeight[i * 4] = 1
  }
  const geometry = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, source.getAttribute(name).clone())
  if (source.index) geometry.setIndex(source.index.clone())
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  // Which vertices are lights, and of which sort: an eye (1), any other lamp (2), neither (0).
  const light = source.getAttribute('_light')
  const mark = new Float32Array(count)
  let eyeY = 0
  let eyes = 0
  for (let i = 0; i < count; i++) {
    mark[i] = light ? Math.round(light.getX(i)) : 0
    if (mark[i] === 1) {
      eyeY += geometry.getAttribute('position').getY(i)
      eyes++
    }
  }
  geometry.setAttribute('aMark', new THREE.BufferAttribute(mark, 1))
  // How high the eyes are in the rest pose: what a lid closes toward.
  geometry.userData.eyeY = eyes ? eyeY / eyes : 0
  geometry.computeBoundingBox()
  return geometry
}

/**
 * What a robot's lights are doing, given what its thread is doing: the one place a robot's
 * face says anything.
 *
 * An eye is a ring of light with a point in it, so it has three things to say with: how
 * bright it is, how far open, and what colour. Everything else that is lit on a robot (the
 * mark on its chest, the rings on its ears) shares one brightness.
 *
 * @param {string} status  the thread's state, as the colony names it
 * @param {number} elapsed  seconds, for whatever pulses
 * @param {number} phase  the robot's own offset, so no two blink together
 * @returns {{eye: number, open: number, lamp: number, fault: number}} `open` runs from shut
 *   (0) to wide (1); `fault` from the eye's own amber (0) to red (1)
 */
export function robotLights(status, elapsed, phase) {
  // A blink: shut for an eighth of a second, every few seconds, each to its own clock.
  const every = 3.2 + ((phase * 1.7) % 2.6)
  const blink = (elapsed + phase * 5) % every < 0.13 ? 0.1 : 1
  const breath = 0.5 + 0.5 * Math.sin(elapsed * 2.6 + phase)
  switch (status) {
    // Something is wrong, and it should be seen across the campus: red, and stuttering like
    // a fault light.
    case 'blocked': {
      const on = Math.sin(elapsed * 9 + phase) > 0.2 ? 1 : 0.12
      return { eye: 1.7 * on, open: 1, lamp: 1.6 * on, fault: 1 }
    }
    // Asking for you: wide, and swelling slowly, which is a call and not an alarm.
    case 'waiting':
      return { eye: 0.9 + 1.1 * (0.5 + 0.5 * Math.sin(elapsed * 3.2 + phase)), open: 1, lamp: 0.8 + 0.9 * breath, fault: 0 }
    case 'working':
      return { eye: 1.15, open: blink, lamp: 0.8 + 0.35 * breath, fault: 0 }
    case 'celebrating':
      return { eye: 1.7, open: 1, lamp: 1.5, fault: 0 }
    // Dormant, not dead: lids all but shut, the lights turned right down.
    case 'sleeping':
      return { eye: 0.3, open: 0.2, lamp: 0.3, fault: 0 }
    default:
      return { eye: 0.9, open: blink, lamp: 0.55 + 0.25 * breath, fault: 0 }
  }
}

/**
 * Make a robot's skinned material answer to `robotLights`. Call it after the crew's own
 * skinning hook is on the material: this adds to that, and does not replace it.
 *
 * Reads two attributes: `aMark` per vertex, from `robotGeometry`, and `aLight` per instance,
 * holding (eye, open, lamp, fault).
 *
 * @param {THREE.Material} material
 * @param {number} eyeY  how high the eyes are in the rest pose
 */
export function decorateLights(material, eyeY) {
  const skinned = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    skinned?.(shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aMark;
         attribute vec4 aLight;
         varying float vMark;
         varying vec4 vLight;`
      )
      // Ahead of the skinning, in the rest pose, where "up" is still up: a lid closing is the
      // eye's light drawn in toward its own middle.
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vMark = aMark;
         vLight = aLight;
         if ( aMark > 0.5 && aMark < 1.5 ) transformed.y = ${eyeY.toFixed(5)} + ( transformed.y - ${eyeY.toFixed(5)} ) * aLight.y;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vMark;\n varying vec4 vLight;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         if ( vMark > 0.5 && vMark < 1.5 ) {
           // Amber to red is green and blue taken away, with the red left to carry it.
           totalEmissiveRadiance *= vLight.x * mix( vec3( 1.0 ), vec3( 1.25, 0.12, 0.1 ), vLight.w );
         } else if ( vMark > 1.5 ) {
           totalEmissiveRadiance *= vLight.z;
         }`
      )
  }
  material.customProgramCacheKey = () => `bc-robot-lights-${eyeY.toFixed(5)}`
  return material
}
