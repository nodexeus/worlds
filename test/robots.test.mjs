/**
 * How a robot is bound to the crew's skeleton, and which robot a thread gets.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import { ROBOT_BONES, ROBOT_KINDS, robotBoneMap, robotGeometry, robotKind } from '../src/agents/robots.js'

// A rig in some other order, named the way the loader leaves names: no dots.
const RIG = ['root', ...[...ROBOT_BONES].reverse(), 'hand.l', 'hand.r'].map((name) => ({ name: name.replace('.', '') }))

test('each of the models\' bones is found in the rig by name, whatever the loader did to it', () => {
  const map = robotBoneMap(RIG)
  assert.equal(map.length, ROBOT_BONES.length)
  ROBOT_BONES.forEach((name, i) => assert.equal(RIG[map[i]].name, name.replace('.', '')))
  assert.throws(() => robotBoneMap(RIG.filter((b) => b.name !== 'head')), /no bone "head"/)
})

test('every vertex rides exactly the bone its model names, at full weight', () => {
  const source = new THREE.BufferGeometry()
  source.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  source.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3))
  source.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2))
  // Blender writes the number as a float, and not always a whole one.
  source.setAttribute('_bone', new THREE.BufferAttribute(new Float32Array([3, 0.0000001, 16.9999]), 1))
  const geo = robotGeometry(source, RIG)
  const index = geo.getAttribute('skinIndex')
  const weight = geo.getAttribute('skinWeight')
  const map = robotBoneMap(RIG)
  assert.deepEqual([index.getX(0), index.getX(1), index.getX(2)], [map[3], map[0], map[17]])
  for (let i = 0; i < 3; i++) {
    assert.deepEqual([weight.getX(i), weight.getY(i), weight.getZ(i), weight.getW(i)], [1, 0, 0, 0])
  }
  source.deleteAttribute('_bone')
  assert.throws(() => robotGeometry(source, RIG), /which bone/)
})

test('a thread always gets the same robot, and threads between them get both kinds about evenly', () => {
  // The hash the crew uses for everything else about a thread.
  const hash = (str) => {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
    return h >>> 0
  }
  const counts = new Array(ROBOT_KINDS.length).fill(0)
  for (let i = 0; i < 4000; i++) {
    const id = `thread-${i}-${(i * 2654435761) >>> 0}`
    const kind = robotKind(hash(id))
    assert.equal(kind, robotKind(hash(id)))
    assert.ok(kind >= 0 && kind < ROBOT_KINDS.length)
    counts[kind]++
  }
  for (const n of counts) assert.ok(n > 4000 / ROBOT_KINDS.length * 0.85, `one kind got only ${n} of 4000`)
})
