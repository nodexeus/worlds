import { CORE_CELLS } from './plot-move.js'

/**
 * Two districts either side of the square.
 *
 * The gate and the Library stand in the middle of the campus. Workspaces scanned from this
 * computer are laid out on one side of them and the crew's on the other, far enough apart
 * that nobody takes one for the other, and each is reached from the square by a walkway of
 * its own.
 *
 * Every rule about where a workspace may stand (`plots.js`, `plot-move.js`) was written for
 * one colony growing out from an origin beside two cells nobody may claim. So each district
 * is laid out by those rules exactly as they are, in its own terms, and only then put on the
 * campus: the local one slid along the line the square lies on, the crew's turned to face the
 * other way and slid along it the other way. In a district's own terms the two cells nobody
 * may claim are its walkway.
 *
 * What keeps the districts apart is one more rule in those terms: nothing is given, and
 * nothing may be carried to, a cell with `q` below zero (`inDistrict` in `plot-move.js`).
 * That is the side the square is on.
 *
 * Layouts are remembered and saved in a district's own terms. For the local district those
 * are the terms the campus always used, so a saved campus is read as it was.
 */

/** A crew workspace's name on the campus starts with this. See `src/crew/world.js`. */
const CREW = 'crew:'

const PLACE = {
  // Two cells further along the square's own line, so its walkway begins beside the Library.
  local: (cell) => ({ q: cell.q + 2, r: cell.r }),
  // Turned about and sent the other way, so its walkway begins beside the gate. Doing it
  // twice comes back to where it began, which makes it its own way home.
  crew: (cell) => ({ q: -5 - cell.q, r: 2 - cell.r }),
}

const HOME = {
  local: (cell) => ({ q: cell.q - 2, r: cell.r }),
  crew: PLACE.crew,
}

/** @returns {'local' | 'crew'} which district a workspace of this name stands in */
export const districtOf = (name) => (String(name).startsWith(CREW) ? 'crew' : 'local')

/** A district's cells, where they are on the campus. */
export const toWorld = (district, cells) => cells.map(PLACE[district])

/** Cells on the campus, in a district's own terms. */
export const toFrame = (district, cells) => cells.map(HOME[district])

/**
 * A carry of (dq, dr) across the campus, in a district's own terms.
 *
 * @returns {{dq: number, dr: number}}
 */
export function frameDelta(district, dq, dr) {
  return district === 'crew' ? { dq: -dq, dr: -dr } : { dq, dr }
}

/**
 * The walkway from the square to a district, as cells on the campus: the one beside the
 * square first, the one beside the district's first platform last.
 */
export function causeway(district) {
  return toWorld(district, CORE_CELLS)
}
