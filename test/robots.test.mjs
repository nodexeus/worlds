/**
 * How a robot is bound to the crew's skeleton, and which robot a thread gets.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import { ROBOT_BONES, ROBOT_KINDS, robotBoneMap, robotGeometry, robotKind, robotLights } from '../src/agents/robots.js'

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

test('the eyes are found by their mark, and their height with them', () => {
  const source = new THREE.BufferGeometry()
  source.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1.5, 0, 0, 1.7, 0, 0, 0.2, 0, 0, 1.0, 0]), 3))
  source.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(12), 3))
  source.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2))
  source.setAttribute('_bone', new THREE.BufferAttribute(new Float32Array([3, 3, 12, 2]), 1))
  source.setAttribute('_light', new THREE.BufferAttribute(new Float32Array([1, 0.9999, 0, 2]), 1))
  const geo = robotGeometry(source, RIG)
  assert.deepEqual([...geo.getAttribute('aMark').array], [1, 1, 0, 2])
  assert.ok(Math.abs(geo.userData.eyeY - 1.6) < 1e-6, 'midway between the two eye vertices')
})

test('a robot\'s lights say what its thread is doing', () => {
  const at = (status, t = 10) => robotLights(status, t, 1.3)
  const over = (status, pick) => Array.from({ length: 400 }, (_, i) => pick(robotLights(status, i * 0.05, 1.3)))

  // Asleep: lids all but shut, and dim. Never blinking open.
  assert.ok(over('sleeping', (l) => l.open).every((v) => v < 0.3))
  assert.ok(at('sleeping').eye < at('idle').eye)

  // Blocked is the only one that goes red, and it stutters between lit and nearly out.
  for (const status of ['waiting', 'working', 'celebrating', 'idle', 'sleeping']) assert.equal(at(status).fault, 0)
  assert.equal(at('blocked').fault, 1)
  const fault = over('blocked', (l) => l.eye)
  assert.ok(Math.min(...fault) < 0.3 && Math.max(...fault) > 1.5)

  // Waiting swells, and at its brightest outshines anything but a fault. Its eyes stay open.
  const call = over('waiting', (l) => l.eye)
  assert.ok(Math.max(...call) > at('working').eye * 1.5 && Math.min(...call) < Math.max(...call) * 0.6)
  assert.ok(over('waiting', (l) => l.open).every((v) => v === 1))

  // Working and idle blink: mostly open, now and then shut, and not at the same moment for two robots.
  for (const status of ['working', 'idle']) {
    const lids = over(status, (l) => l.open)
    const shut = lids.filter((v) => v < 0.5).length
    assert.ok(shut > 0 && shut < lids.length * 0.15, `${status} is shut ${shut} of ${lids.length} samples`)
  }
  const one = Array.from({ length: 400 }, (_, i) => robotLights('idle', i * 0.05, 0.4).open)
  const other = Array.from({ length: 400 }, (_, i) => robotLights('idle', i * 0.05, 2.9).open)
  assert.notDeepEqual(one, other)
})

