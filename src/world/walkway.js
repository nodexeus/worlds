/**
 * The walkway from the square out to a district: not a straight run, but one with bends in it.
 *
 * It is laid from the kit's ground-level pieces (`design/campus/settlement.md`): a straight
 * length and two corners, of a twelfth and a sixth of a circle. The route leaves heading the
 * way it will arrive, bends a twelfth to one side, runs out, bends a sixth back across its own
 * line, runs twice as far, bends a sixth again and a twelfth to finish, so it ends heading
 * as it began and square on to the stairs. How long the runs are is whatever makes it arrive
 * exactly: the straight pieces are stretched or squeezed a little to take up the difference,
 * which nobody can see in a boardwalk.
 *
 * Which side it bends to first is the district's own, so the two walkways do not mirror each
 * other and neither changes between visits.
 */

/** Where each piece ends, in its own space (it starts at the origin heading +z), and how far it turns toward +x. */
export const WALK = {
  walk: { x: 0, z: 2.76, bend: 0 },
  'walk-turn-30': { x: 0.322, z: 1.2, bend: Math.PI / 6 },
  'walk-turn-60': { x: 1.2, z: 2.078, bend: Math.PI / 3 },
}

/** A straight run before the first bend and after the last, so neither is at the very end. */
const LEAD = WALK.walk.z
/** The most a straight piece is stretched or squeezed along its length: a short run of two has to take up to a quarter. */
const GIVE = 0.26

/** FNV-1a, the hash the rest of the world uses to turn a name into a stable number. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * @param {{x: number, z: number}} from   where it leaves the square
 * @param {{x: number, z: number}} to     where it arrives: the foot of the stairs up
 * @param {number} heading                the way it arrives, as a turn about Y (its +z along (sin, cos))
 * @param {string} name                   the district, which decides the side it bends to first
 * @returns {{from: {x: number, z: number}, heading: number,
 *   pieces: Array<{part: string, x: number, z: number, turn: number, mirror: boolean, stretch: number}>,
 *   spans: Array<{x: number, z: number, ux: number, uz: number, half: number, y0: number, rise: number}>} | null}
 *   null when no such route fits between the two, for the caller to do something plainer
 */
export function walkwayRoute(from, to, heading, name) {
  // The two districts bend opposite ways; anything else takes a side from its name.
  const side = name === 'local' ? 1 : name === 'crew' ? -1 : hash(`${name}/walkway`) % 2 ? 1 : -1
  const dir = (h) => ({ x: Math.sin(h), z: Math.cos(h) })
  // What the four corners and the two leads add up to, with runs of no length at all.
  const order = [
    { part: 'walk', lead: true },
    { part: 'walk-turn-30', side },
    { run: 'a' },
    { part: 'walk-turn-60', side: -side },
    { run: 'b' },
    { part: 'walk-turn-60', side },
    { run: 'a' },
    { part: 'walk-turn-30', side: -side },
    { part: 'walk', lead: true },
  ]
  let h = heading
  let fx = 0
  let fz = 0
  const along = { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } }
  for (const step of order) {
    if (step.run) {
      along[step.run].x += dir(h).x
      along[step.run].z += dir(h).z
      continue
    }
    const end = WALK[step.part]
    const ex = end.x * (step.side || 1)
    fx += ex * Math.cos(h) + end.z * Math.sin(h)
    fz += -ex * Math.sin(h) + end.z * Math.cos(h)
    h += end.bend * (step.side || 0)
  }
  // Two runs, two unknown lengths, and two numbers they have to add up to.
  const need = { x: to.x - from.x - fx, z: to.z - from.z - fz }
  const det = along.a.x * along.b.z - along.a.z * along.b.x
  if (Math.abs(det) < 1e-9) return null
  const a = (need.x * along.b.z - need.z * along.b.x) / det
  const b = (along.a.x * need.z - along.a.z * need.x) / det
  // Each run is two outward legs of `a` and one back of `b`: all of them have to be real.
  if (!(a > LEAD * 0.9) || !(b > LEAD * 0.9)) return null

  const pieces = []
  const spans = []
  let x = from.x
  let z = from.z
  h = heading
  const lay = (part, mirror, stretch) => {
    const end = WALK[part]
    const flip = mirror ? -1 : 1
    const ex = end.x * flip
    const ez = end.z * stretch
    const nx = x + ex * Math.cos(h) + ez * Math.sin(h)
    const nz = z + -ex * Math.sin(h) + ez * Math.cos(h)
    pieces.push({ part, x, z, turn: h, mirror, stretch })
    const far = Math.hypot(nx - x, nz - z)
    spans.push({ x: (x + nx) / 2, z: (z + nz) / 2, ux: (nx - x) / far, uz: (nz - z) / far, half: far / 2, y0: WALK_TOP, rise: 0 })
    x = nx
    z = nz
    h += end.bend * flip
  }
  const run = (length) => {
    const count = Math.max(1, Math.round(length / WALK.walk.z))
    const stretch = length / (count * WALK.walk.z)
    if (Math.abs(stretch - 1) > GIVE) return false
    for (let n = 0; n < count; n++) lay('walk', false, stretch)
    return true
  }
  for (const step of order) {
    if (step.run) {
      if (!run(step.run === 'a' ? a : b)) return null
    } else lay(step.part, step.side === -1, 1)
  }
  return { from: { x: from.x, z: from.z }, heading, pieces, spans }
}

/** How high the top of the boardwalk is above the ground: the square's own height. */
export const WALK_TOP = 0.45
