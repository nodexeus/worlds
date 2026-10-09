/**
 * What somebody in the crew with no workspace does with themselves.
 *
 * They have no site to stand at, so they choose: walk somewhere else on the campus and
 * potter there a while, stop by another of the crew, or sit down. Each choice comes with how
 * long it lasts once they have got to where it happens. Chance is handed in, so the choosing
 * can be checked without it.
 */

/** How near two of the crew stand to pass the time of day. */
const VISIT_GAP = 1.3

const between = (rand, low, high) => low + rand() * (high - low)

/**
 * @param {() => number} rand
 * @param {{company?: boolean, rested?: boolean}} [about]  whether there is anybody to stop
 *   by, and whether the last thing done was a rest
 * @returns {{kind: 'walk' | 'visit' | 'rest', seconds: number}}
 */
export function nextRoam(rand, { company = false, rested = false } = {}) {
  const roll = rand()
  if (roll >= 0.78 && !rested) return { kind: 'rest', seconds: between(rand, 20, 45) }
  if (roll >= 0.5 && roll < 0.78 && company) return { kind: 'visit', seconds: between(rand, 6, 12) }
  return { kind: 'walk', seconds: between(rand, 8, 20) }
}

/**
 * Where to stand to visit somebody: a step short of them, on the side come from.
 *
 * @param {{x: number, z: number}} from
 * @param {{x: number, z: number}} other
 * @returns {{x: number, z: number}}
 */
export function visitSpot(from, other) {
  const dx = from.x - other.x
  const dz = from.z - other.z
  const away = Math.hypot(dx, dz)
  if (away <= VISIT_GAP) return { x: from.x, z: from.z }
  return { x: other.x + (dx / away) * VISIT_GAP, z: other.z + (dz / away) * VISIT_GAP }
}
