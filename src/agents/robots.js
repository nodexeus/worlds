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
  geometry.computeBoundingBox()
  return geometry
}
