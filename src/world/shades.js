/**
 * The shade a workspace's lights burn in.
 *
 * The campus's light is amber, and most of it stays amber. But a settlement that grew a
 * workspace at a time did not buy all its lamps at once: some burn a warmer white, some the
 * red of a cheap sodium tube, a few a cold teal or ice blue. A workspace has one shade for
 * everything on it, by its own name, so it reads as one place.
 */

/** The shades, as what a lamp's own brightness is multiplied by; null leaves it the amber it was made. */
export const SHADES = {
  amber: null,
  white: [1.0, 0.82, 0.58],
  red: [1.0, 0.3, 0.14],
  teal: [0.18, 0.92, 0.78],
  ice: [0.55, 0.78, 1.0],
}

/** How often each turns up, out of twenty: amber three workspaces in five. */
const DEAL = ['amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber',
  'white', 'white', 'white', 'red', 'red', 'teal', 'teal', 'ice']

/** FNV-1a, the hash the rest of the world uses to turn a name into a stable number. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** @returns {keyof typeof SHADES} the shade of the workspace with this id */
export const shadeOf = (id) => DEAL[hash(`${id}/shade`) % DEAL.length]

/**
 * GLSL that turns a lamp's amber into another shade: its brightness kept, its colour swapped,
 * by as much as `glow.a` says. Goes after `emissivemap_fragment`.
 */
export const RESHADE = `
  totalEmissiveRadiance = mix( totalEmissiveRadiance, vec3( dot( totalEmissiveRadiance, vec3( 0.42, 0.55, 0.03 ) ) * 1.35 ) * GLOW.rgb, GLOW.a );`

/**
 * How the lights of a workspace that needs somebody burn at a moment: a slow beat, from
 * dimmer than usual to far brighter and whiter, so it is picked out from across the campus
 * by day or night without reading a label. The same beat for every such workspace, in step.
 *
 * @param {number} elapsed  seconds
 * @returns {{gain: number, white: number}} what its lights are multiplied by, and how far toward white they go
 */
export function callPulse(elapsed) {
  const beat = 0.5 + 0.5 * Math.sin(elapsed * 3.4)
  return { gain: 0.5 + 2.5 * beat * beat, white: 0.6 * beat * beat }
}
