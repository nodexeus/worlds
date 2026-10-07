/**
 * Where each crossing lies on the ground, as numbers.
 *
 * `crossings.js` says which workspaces are joined. This turns that into the strip of world
 * each walkway or staircase occupies, which is what three things need to agree on: where it
 * is drawn, where the crew may walk off a deck, and how high somebody standing on it is.
 */
import { hexToWorld } from './plots.js'

/**
 * @typedef {object} Span
 * @property {number} x      centre of the crossing
 * @property {number} z
 * @property {number} ux     unit vector along it, from the lower end to the higher
 * @property {number} uz
 * @property {number} half   half its length, deck edge to deck edge
 * @property {number} y0     height of the lower end
 * @property {number} rise   how far it climbs over its length; zero for a walkway
 */

/**
 * @param {import('./crossings.js').Crossing} crossing
 * @param {object} world
 * @param {number} world.gap  how far each workspace pulls its outside edges in
 * @param {number} world.levelStep  how far apart levels are
 * @param {number} world.deckTop  height of a ground-level deck's top face
 * @param {(id: string) => number} world.elevation  how far above that a workspace stands
 * @returns {Span}
 */
export function spanOf(crossing, { gap, levelStep, deckTop, elevation }) {
  const a = hexToWorld(crossing.from.q, crossing.from.r)
  const b = hexToWorld(crossing.to.q, crossing.to.r)
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    ux: (b.x - a.x) / length,
    uz: (b.z - a.z) / length,
    half: gap,
    y0: deckTop + elevation(crossing.low),
    rise: crossing.rise * levelStep,
  }
}

/**
 * Whether (x, z) is on the crossing, within `halfWidth` of its centre line and no more than
 * `overlap` past either end.
 *
 * @param {Span} span
 * @returns {boolean}
 */
export function onSpan(span, x, z, halfWidth, overlap = 0) {
  const dx = x - span.x
  const dz = z - span.z
  const along = dx * span.ux + dz * span.uz
  const across = dx * -span.uz + dz * span.ux
  return Math.abs(along) <= span.half + overlap && Math.abs(across) <= halfWidth
}

/**
 * How high the crossing's surface is under (x, z): level along a walkway, climbing evenly from
 * one deck edge to the other on a staircase. Past either end it holds that end's height.
 *
 * @param {Span} span
 * @returns {number}
 */
export function heightOnSpan(span, x, z) {
  const along = (x - span.x) * span.ux + (z - span.z) * span.uz
  const t = Math.min(1, Math.max(0, (along + span.half) / (span.half * 2)))
  return span.y0 + span.rise * t
}
