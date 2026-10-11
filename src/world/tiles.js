/**
 * The campus by the square of ground: what stands where, so that what is out of the view is
 * not drawn.
 *
 * A campus of hundreds of workspaces is mostly out of the view at any moment, and drawn as
 * one thing it is all drawn all the time. Kept by the square it stands on, a whole square is
 * left out when none of it can be seen.
 *
 * Seeing whether a square can be seen is not three's usual test, because the world bends
 * (`core/curve.js`): what is far ahead of where the camera looks is drawn lower than where it
 * stands, by the square of how far, and a test of where it stands would leave out things
 * that are on the screen. So a square is looked for where the bend puts it.
 */

/** How wide a square is. Wide enough that a view takes in a handful, not dozens. */
export const TILE = 96
/** How far past its square a thing filed in it can reach: half the longest part, and a run hung from it. */
const OVERHANG = 16

/** The square a point is in. */
export function tileOf(x, z) {
  return { tx: Math.floor(x / TILE), tz: Math.floor(z / TILE) }
}

/**
 * The box that holds everything on a square once the world has bent it.
 *
 * The bend only ever lowers a point, by `amount * (ahead² + 0.22 * away²)`: `ahead` how far in
 * front of the focus it is, `away` how far from it at all. Both grow outward, so the most a
 * square is lowered is at one of its corners, and the least is no less than the least of each
 * part taken alone.
 *
 * @param {number} tx
 * @param {number} tz
 * @param {number} low   the lowest anything on it reaches
 * @param {number} high  the highest
 * @param {{focus: {x: number, z: number}, forward: {x: number, y: number}, amount: number}} curve
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}}
 */
export function bentBounds(tx, tz, low, high, curve) {
  const x0 = tx * TILE - OVERHANG
  const x1 = (tx + 1) * TILE + OVERHANG
  const z0 = tz * TILE - OVERHANG
  const z1 = (tz + 1) * TILE + OVERHANG
  let most = 0
  let least = 0
  if (curve.amount > 0) {
    const { focus, forward } = curve
    let nearAhead = Infinity
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const dx = x - focus.x
      const dz = z - focus.z
      const ahead = Math.max(0, dx * forward.x + dz * forward.y)
      nearAhead = Math.min(nearAhead, ahead)
      most = Math.max(most, ahead * ahead + (dx * dx + dz * dz) * 0.22)
    }
    // The nearest the square comes to the focus: nothing on it is lowered less for being far.
    const cx = Math.min(Math.max(focus.x, x0), x1) - focus.x
    const cz = Math.min(Math.max(focus.z, z0), z1) - focus.z
    least = (nearAhead * nearAhead + (cx * cx + cz * cz) * 0.22) * curve.amount
    most *= curve.amount
  }
  return { min: { x: x0, y: low - most, z: z0 }, max: { x: x1, y: high - least, z: z1 } }
}

/**
 * Put a sphere round the box a square is looked for in: what three tests against the view.
 *
 * @param {{center: {x: number, y: number, z: number}, radius: number}} sphere  a THREE.Sphere, or anything shaped like one
 * @param {{tx: number, tz: number, low: number, high: number}} tile
 */
export function boundTile(sphere, tile, curve) {
  const { min, max } = bentBounds(tile.tx, tile.tz, tile.low, tile.high, curve)
  sphere.center.x = (min.x + max.x) / 2
  sphere.center.y = (min.y + max.y) / 2
  sphere.center.z = (min.z + max.z) / 2
  sphere.radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2
}
