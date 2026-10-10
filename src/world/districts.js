import { LIBRARY_CELL, SHIP_CELL, hexDistance } from './plot-move.js'

/**
 * Two districts either side of the square.
 *
 * The gate and the Library stand in the middle of the campus. Workspaces scanned from this
 * computer are laid out on one side of them and the crew's on the other, far enough apart
 * that nobody takes one for the other, and each is reached from the square by a walkway of
 * its own (`causewayOf` in `crossing-spans.js`).
 *
 * Every rule about where a workspace may stand (`plots.js`, `plot-move.js`) was written for
 * one colony growing out from an origin. So each district is laid out by those rules exactly
 * as they are, in its own terms, and only then put on the campus: the local one slid along
 * the line the square lies on, the crew's turned to face the other way and slid along it the
 * other way. A district's origin, where its first workspace settles, is on that line, eight
 * cells out from the square: far enough that the walkway to it has room to wind.
 *
 * What keeps the districts apart is one more rule in those terms: nothing is given, and
 * nothing may be carried to, a cell more than three platforms back toward the square from the
 * district's origin (`inDistrict` in `plot-move.js`). Up to there a district grows evenly on
 * every side, as a rounded cluster.
 *
 * Layouts are remembered and saved in a district's own terms. For the local district those
 * are the terms the campus always used, so a saved campus is read as it was.
 */

/** A crew workspace's name on the campus starts with this. See `src/crew/world.js`. */
const CREW = 'crew:'

const PLACE = {
  // Out along the square's own line, past the Library.
  local: (cell) => ({ q: cell.q + 7, r: cell.r + 1 }),
  // Turned about and sent the other way, past the gate. Doing it twice comes back to where
  // it began, which makes it its own way home.
  crew: (cell) => ({ q: -10 - cell.q, r: 1 - cell.r }),
}

const HOME = {
  local: (cell) => ({ q: cell.q - 7, r: cell.r - 1 }),
  crew: PLACE.crew,
}

/** The cell of the square each district's walkway leaves from: the one on its side. */
const END = { local: LIBRARY_CELL, crew: SHIP_CELL }

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

/** The cell of the square a district's walkway leaves from. */
export const squareEnd = (district) => END[district]

/**
 * Where a district's walkway arrives: whichever of the cells standing in it is nearest the
 * square. That is the district's origin for as long as anything stands there, which is a
 * straight run out along the square's line.
 *
 * @param {'local' | 'crew'} district
 * @param {Array<{q: number, r: number}>} cells  every cell held in the district, on the campus
 * @returns {{q: number, r: number} | null}
 */
export function landing(district, cells) {
  const from = END[district]
  let best = null
  let bestScore = Infinity
  for (const cell of cells) {
    // Nearest first; between equals, a fixed order, so the walkway does not flicker.
    const score = hexDistance(cell, from) * 1000 + Math.abs(cell.r - from.r) * 10 + Math.abs(cell.q) * 0.01
    if (score < bestScore) {
      bestScore = score
      best = cell
    }
  }
  return best
}
