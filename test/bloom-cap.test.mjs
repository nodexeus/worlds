// test/bloom-cap.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { LuminosityHighPassShader } from 'three/addons/shaders/LuminosityHighPassShader.js'
import { BLOOM_CAP, capped } from '../src/core/bloom-cap.js'

test('what one pixel can give to bloom is capped, in the pass three.js ships', () => {
  const shader = capped(LuminosityHighPassShader.fragmentShader, 2)
  // Capped after it is read and before anything is made of it.
  const read = shader.indexOf('texture2D( tDiffuse, vUv )')
  const cap = shader.indexOf('min( texel.rgb, vec3( 2.0 ) )')
  const used = shader.indexOf('luminance( texel.xyz )')
  assert.ok(read >= 0 && cap > read && used > cap, shader)
})

test('a pass it does not recognise is an error, not a cap silently left off', () => {
  assert.throws(() => capped('void main() { gl_FragColor = vec4(1.0); }', 2), /bloom/i)
})

test('the cap is above the brightest lamp, so lamps glow as they did', () => {
  // Amber light at the strength the campus drives it: see `bakedMaterial` in buildings.js.
  const amber = [0xfd, 0xc7, 0x00].map((c) => ((c / 255) ** 2.2) * 1.7)
  const brightest = Math.max(...amber)
  assert.ok(BLOOM_CAP > brightest, `${BLOOM_CAP} against ${brightest}`)
  assert.ok(BLOOM_CAP <= 3, 'and not so far above that a glint is let through')
})
