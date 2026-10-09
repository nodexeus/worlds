/**
 * A limit on what any one pixel can give to bloom.
 *
 * The scene is drawn with more range than a screen has, so that a lamp can be brighter than
 * white and glow. Bloom takes every pixel past its threshold at full value, and that is the
 * trouble: a lamp is a little over one, and a glint of the sun off a steel plate can be
 * fifty, in a pixel or two. Blurred, those two pixels become a white disc a building wide,
 * and no threshold stops it, because a glint clears any threshold a lamp can.
 *
 * So a pixel is counted up to this much and no further. A lit strip is thousands of pixels
 * near the cap and glows as it did. A glint is two pixels at the cap and is lost in the blur.
 */

/** How bright a pixel is taken to be, at most, for bloom. A lamp is about 1.7 at its brightest. */
export const BLOOM_CAP = 2

const READ = 'vec4 texel = texture2D( tDiffuse, vUv );'

/**
 * The bloom pass's bright-pixel filter, with the cap in it.
 *
 * @param {string} fragmentShader  three.js's `LuminosityHighPassShader` fragment shader
 * @param {number} [cap]
 * @returns {string}
 */
export function capped(fragmentShader, cap = BLOOM_CAP) {
  if (!fragmentShader.includes(READ)) {
    throw new Error('bloom: the bright-pixel filter is not the one this cap was written for, so it has not been capped')
  }
  return fragmentShader.replace(READ, `${READ}\n\t\t\ttexel.rgb = min( texel.rgb, vec3( ${cap.toFixed(1)} ) );`)
}

/** Cap a bloom pass. Call once, when the pass is made. */
export function capBloom(pass, cap = BLOOM_CAP) {
  const material = pass.materialHighPassFilter
  material.fragmentShader = capped(material.fragmentShader, cap)
  material.needsUpdate = true
  return pass
}
