/**
 * The outline of one deck tile whose edges may be pulled inboard.
 *
 * On most worlds a plot's tiles are plain hexagons that meet their neighbours edge to edge. A
 * world can ask instead for workspaces that stand apart: every *outside* edge of a plot is
 * pulled in by a margin, while the edges its own tiles share stay where they are. The tiles of
 * one workspace then still join into a single floor, and a gap of twice the margin opens
 * between it and whatever is next door.
 *
 * Pulling edges in one tile at a time is exact, not an approximation of offsetting the whole
 * plot's outline. Where two of a plot's tiles meet at a corner that turns inward, each tile's
 * pulled-in edge reaches their shared edge at the same point, so the two outlines join there
 * with neither a notch nor a step.
 *
 * Everything here is plain numbers in a tile's own frame (its centre at the origin), with no
 * renderer in sight, so the deck that is drawn, the kerb that edges it and the test for
 * whether something is standing on it can all be derived from the one description.
 */

/** Which way edge `i` faces, as an angle in the x/z plane. Edge 0 faces 30° round from +x. */
export const edgeAngle = (edge) => (Math.PI / 3) * edge + Math.PI / 6

const EDGES = [0, 1, 2, 3, 4, 5]

/**
 * The tile's corners, in order round the outline, as `[x, z]` pairs.
 *
 * @param {number} apothem  centre to the middle of an edge, before any is pulled in
 * @param {number[]} [insets]  how far each of the six edges is pulled inboard; missing is zero
 * @returns {Array<[number, number]>}
 */
export function tileOutline(apothem, insets = []) {
  // Start from a square that comfortably contains the tile and cut it down one edge at a time.
  const reach = apothem * 4
  let outline = [[-reach, -reach], [reach, -reach], [reach, reach], [-reach, reach]]
  for (const edge of EDGES) {
    const nx = Math.cos(edgeAngle(edge))
    const nz = Math.sin(edgeAngle(edge))
    const limit = apothem - (insets[edge] || 0)
    const kept = []
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i]
      const q = outline[(i + 1) % outline.length]
      const sp = p[0] * nx + p[1] * nz - limit
      const sq = q[0] * nx + q[1] * nz - limit
      if (sp <= 0) kept.push(p)
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
        const t = sp / (sp - sq)
        kept.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
      }
    }
    outline = kept
  }
  return outline
}

/**
 * Whether a disc of `radius` centred on (x, z) lies wholly on the tile.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} apothem
 * @param {number[]} [insets]
 * @param {number} [radius]
 * @returns {boolean}
 */
export function onTile(x, z, apothem, insets = [], radius = 0) {
  for (const edge of EDGES) {
    const limit = apothem - (insets[edge] || 0) - radius
    if (x * Math.cos(edgeAngle(edge)) + z * Math.sin(edgeAngle(edge)) > limit) return false
  }
  return true
}

/**
 * The stretch of outline that lies along each edge in `edges`, for whatever is drawn along it.
 *
 * An edge next to a pulled-in neighbour is shorter than the hexagon's own side and one next
 * to a shared edge is longer, so the ends are read off the finished outline, never assumed.
 *
 * @param {number} apothem
 * @param {number[]} insets
 * @param {number[]} edges  which edges to report
 * @returns {Array<{edge: number, a: [number, number], b: [number, number]}>}
 */
export function edgeSegments(apothem, insets, edges) {
  const outline = tileOutline(apothem, insets)
  const out = []
  for (const edge of edges) {
    const nx = Math.cos(edgeAngle(edge))
    const nz = Math.sin(edgeAngle(edge))
    const limit = apothem - (insets[edge] || 0)
    const on = (p) => Math.abs(p[0] * nx + p[1] * nz - limit) < 1e-6
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]
      const b = outline[(i + 1) % outline.length]
      if (on(a) && on(b) && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) out.push({ edge, a, b })
    }
  }
  return out
}

/**
 * Whether (x, z) is on a deck of several tiles, and at least `margin` in from its outer rim.
 *
 * The margin is kept only from the edges that are pulled in, which are the ones facing a gap.
 * A seam between two of the deck's own tiles is floor like any other: holding a margin off
 * it, as `onTile` does with a radius, would cut one deck into as many islands as it has tiles.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} apothem
 * @param {Array<{x: number, z: number}>} centres  each tile's centre, in the frame of (x, z)
 * @param {number[][]} [insets]  each tile's six insets; missing means a plain hexagon
 * @param {number} [margin]
 * @returns {boolean}
 */
export function onDeck(x, z, apothem, centres, insets = [], margin = 0) {
  return centres.some((c, i) => {
    const kept = insets[i]?.map((inset) => (inset > 0 ? inset + margin : 0))
    return onTile(x - c.x, z - c.z, apothem, kept)
  })
}
