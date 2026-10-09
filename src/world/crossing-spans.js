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

/**
 * How high the walking surface is at (x, z) if a crossing carries it, or null if none does.
 *
 * `overlap` lets a crossing answer for a little of the deck past each of its ends, where it
 * reports that end's height, which is the deck's own. It has to: a crossing's ends are measured
 * from the grid, and a deck is drawn a hair smaller than its cell, so the two stop a few
 * centimetres short of each other. Whoever is asked about a point in that sliver must not be
 * told it is on neither.
 *
 * @param {Span[]} spans
 * @param {number} halfWidth
 * @param {number} overlap
 * @returns {number | null}
 */
export function heightOnCrossings(spans, x, z, halfWidth, overlap) {
  for (const span of spans) {
    if (onSpan(span, x, z, halfWidth, overlap)) return heightOnSpan(span, x, z)
  }
  return null
}


/**
 * The walkway from the square out to a district: a long level run of plates, and at the far
 * end one flight of stairs when the workspace it arrives at stands a level up.
 *
 * It runs in a straight line between the middles of two platforms, from the rim of one to
 * the rim of the other. A flight is as long as the gap between two neighbouring workspaces,
 * which is what the stair is made to span, and the plates share out the rest evenly, each as
 * near that same length as divides it.
 *
 * @param {{x: number, z: number}} from  the middle of the square's platform
 * @param {{x: number, z: number}} to    the middle of the platform arrived at
 * @param {object} world
 * @param {number} world.reach      from the middle of a platform to its rim
 * @param {number} world.gap        how far each workspace pulls its outside edges in
 * @param {number} world.levelStep  how far apart levels are
 * @param {number} world.deckTop    height of a ground-level deck's top face
 * @param {number} world.rise       levels climbed at the far end: 0 or 1
 * @returns {{spans: Span[], plates: Array<{x: number, z: number, size: number}>,
 *   stair: {x: number, z: number} | null, heading: number, y: number} | null}
 *   null when the two platforms are too near for a walkway to fit between them
 */
export function causewayOf(from, to, { reach, gap, levelStep, deckTop, rise }) {
  const length = Math.hypot(to.x - from.x, to.z - from.z)
  const run = rise > 0 ? gap * 2 : 0
  const level = length - reach * 2 - run
  if (!(level > gap)) return null
  const ux = (to.x - from.x) / length
  const uz = (to.z - from.z) / length
  const at = (along) => ({ x: from.x + ux * along, z: from.z + uz * along })

  const count = Math.max(1, Math.round(level / (gap * 2)))
  const size = level / count
  const plates = []
  for (let n = 0; n < count; n++) plates.push({ ...at(reach + size * (n + 0.5)), size })

  const spans = [{ ...at(reach + level / 2), ux, uz, half: level / 2, y0: deckTop, rise: 0 }]
  let stair = null
  if (run) {
    stair = at(length - reach - run / 2)
    spans.push({ ...stair, ux, uz, half: gap, y0: deckTop, rise: levelStep })
  }
  return { spans, plates, stair, heading: Math.atan2(ux, uz), y: deckTop }
}
