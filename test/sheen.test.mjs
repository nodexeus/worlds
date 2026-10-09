// test/sheen.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { ShaderLib } from 'three'
import { SHEEN_CAP, tamed } from '../src/core/sheen.js'

test('what the sun can add to a surface by reflection is capped, in the material three.js ships', () => {
  const shader = tamed(ShaderLib.standard.fragmentShader)
  const lit = shader.indexOf('#include <lights_fragment_end>')
  const cap = shader.indexOf('reflectedLight.directSpecular = min( reflectedLight.directSpecular')
  const used = shader.indexOf('#include <aomap_fragment>')
  assert.ok(lit >= 0 && cap > lit && used > cap, 'after the lights are added up and before anything is made of them')
  assert.ok(shader.includes(`vec3( ${SHEEN_CAP.toFixed(2)} )`))
})

test('a material it does not recognise is an error, not a cap silently left off', () => {
  assert.throws(() => tamed('void main() { gl_FragColor = vec4(1.0); }'), /sheen/i)
})

test('the cap leaves a surface able to shine, and unable to go white', () => {
  assert.ok(SHEEN_CAP >= 0.3 && SHEEN_CAP <= 0.8)
})
