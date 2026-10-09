/**
 * A limit on how bright the sun's reflection off a surface can be.
 *
 * The campus is steel, and steel is drawn as metal so that it has a sheen. With the sun at
 * the wrong angle that sheen is not a highlight but a sheet: every roof and deck facing the
 * same way goes white at once, the glow pass picks all of it up, and the colony is washed out.
 * No roughness in a texture prevents it, because at the mirror angle even a rough metal throws
 * back more light than the screen has room for.
 *
 * So what direct light adds by reflection is counted up to this much and no further. A surface
 * still catches the light and still reads as metal; it cannot outshine a lamp.
 */

/** The most that reflected sunlight adds to any one point, in the scene's own units. A lamp is about 1.7. */
export const SHEEN_CAP = 0.55

const AFTER = '#include <lights_fragment_end>'

/**
 * A standard material's fragment shader, with the cap in it.
 * @param {string} fragmentShader
 * @param {number} [cap]
 * @returns {string}
 */
export function tamed(fragmentShader, cap = SHEEN_CAP) {
  if (!fragmentShader.includes(AFTER)) {
    throw new Error('sheen: this is not the material the cap was written for, so its reflections have not been capped')
  }
  return fragmentShader.replace(AFTER, `${AFTER}\n\treflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( ${cap.toFixed(2)} ) );`)
}

/** Cap a material's reflections. For use inside its `onBeforeCompile`. */
export function tameSheen(shader, cap = SHEEN_CAP) {
  shader.fragmentShader = tamed(shader.fragmentShader, cap)
  return shader
}
