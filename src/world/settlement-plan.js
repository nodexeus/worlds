/**
 * Where every part of the settlement goes.
 *
 * A workspace on the campus stands on stilts: a deck for each of its platforms, legs under
 * each, a piece joining neighbouring platforms into one floor, something along every open
 * edge, and a gangway or a flight of stairs wherever it is joined to a neighbour. The parts
 * are the kit in `design/campus/settlement.md`; this says which part goes where, as a plain
 * list, and nothing is drawn here.
 *
 * Everything about a workspace is decided from its own name and cells, so it looks the same
 * every time it is seen and nothing about one workspace changes because another arrived. The
 * one thing a neighbour does decide is which of its edges a crossing meets.
 */
import { HEX_DIRS, cellKey } from './plot-move.js'
import { hexToWorld } from './plots.js'

const SIXTH = Math.PI / 3

/** FNV-1a, the hash the rest of the world uses to turn a name into a stable number. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Decks that look walked on, and decks that do not. See the kit's notes. */
const USED = ['deck-a', 'deck-c']
const CLEAN = ['deck-b', 'deck-d']

/** What stands along an open edge, most likely first: a rail, a bare kerb, a rail with a light. */
const EDGES = ['edge-rail', 'edge-rail', 'edge-rail', 'edge-kerb', 'edge-kerb', 'edge-rail-lit']
const LIT = /lit$/

/** The turn about Y that points a part's own +z along (dx, dz). */
const facing = (dx, dz) => Math.atan2(dx, dz)

/**
 * @typedef {object} Placed
 * @property {string} part   the kit part's name
 * @property {string} plot   the workspace it belongs to
 * @property {number} x
 * @property {number} y      the height of the part's origin: for most, the walking surface
 * @property {number} z
 * @property {number} turn   about Y, in radians
 */

/**
 * @param {Array<{id: string, cells: Array<{q: number, r: number}>, level: number}>} plots
 * @param {import('./crossings.js').Crossing[]} crossings
 * @param {object} world
 * @param {number} world.deckTop    height of a ground-level deck's top face
 * @param {number} world.levelStep  how far apart levels are
 * @param {number} world.apothem    from the middle of a platform to the middle of an edge
 * @returns {Placed[]}
 */
export function settlementParts(plots, crossings, { deckTop, levelStep, apothem }) {
  const owner = new Map()
  for (const plot of plots) for (const cell of plot.cells) owner.set(cellKey(cell.q, cell.r), plot)

  // Which edges a crossing meets, as "cell>neighbour", both ways round.
  const crossed = new Set()
  for (const crossing of crossings) {
    crossed.add(`${cellKey(crossing.from.q, crossing.from.r)}>${cellKey(crossing.to.q, crossing.to.r)}`)
    crossed.add(`${cellKey(crossing.to.q, crossing.to.r)}>${cellKey(crossing.from.q, crossing.from.r)}`)
  }

  const parts = []
  for (const plot of plots) {
    const y = deckTop + plot.level * levelStep
    const mine = new Set(plot.cells.map((cell) => cellKey(cell.q, cell.r)))
    const put = (part, x, z, turn = 0, at = y) => parts.push({ part, plot: plot.id, x, y: at, z, turn })
    const edges = []

    for (const cell of plot.cells) {
      const key = cellKey(cell.q, cell.r)
      const seed = hash(`${plot.id}/${key}`)
      const here = hexToWorld(cell.q, cell.r)
      const busy = HEX_DIRS.some(([dq, dr]) => crossed.has(`${key}>${cellKey(cell.q + dq, cell.r + dr)}`))
      // A deck with a crossing on it has been walked over; most others have not.
      const worn = busy || seed % 5 === 0
      put((worn ? USED : CLEAN)[(seed >>> 4) % 2], here.x, here.z, ((seed >>> 8) % 6) * SIXTH)
      // Level 0 is the ground and has no legs; nothing in the kit is asked for past the fifth.
      if (plot.level >= 1) put(`legs-${Math.min(plot.level, 5)}`, here.x, here.z, ((seed >>> 12) % 6) * SIXTH)
      if ((seed >>> 16) % 3 === 0) put('under-lamp', here.x, here.z)

      HEX_DIRS.forEach(([dq, dr], d) => {
        const other = { q: cell.q + dq, r: cell.r + dr }
        const otherKey = cellKey(other.q, other.r)
        const there = hexToWorld(other.q, other.r)
        const dx = there.x - here.x
        const dz = there.z - here.z
        const far = Math.hypot(dx, dz)
        if (mine.has(otherKey)) {
          // One join for the pair, laid by whichever of the two comes first.
          if (key < otherKey) put('deck-join', (here.x + there.x) / 2, (here.z + there.z) / 2, facing(dx, dz))
          return
        }
        if (crossed.has(`${key}>${otherKey}`)) return
        edges.push({ x: here.x + (dx / far) * apothem, z: here.z + (dz / far) * apothem, turn: facing(dx, dz), seed: hash(`${plot.id}/${key}/${d}`) })
      })

      // Where three of its platforms meet there is a hole the joins leave, and a piece for it.
      // Each such corner is found from all three sides; it is laid from the first.
      HEX_DIRS.forEach(([dq, dr], d) => {
        const [eq, er] = HEX_DIRS[(d + 1) % 6]
        const b = { q: cell.q + dq, r: cell.r + dr }
        const c = { q: cell.q + eq, r: cell.r + er }
        const keys = [key, cellKey(b.q, b.r), cellKey(c.q, c.r)]
        if (!mine.has(keys[1]) || !mine.has(keys[2]) || keys[0] !== [...keys].sort()[0]) return
        const pb = hexToWorld(b.q, b.r)
        const pc = hexToWorld(c.q, c.r)
        const mx = (here.x + pb.x + pc.x) / 3
        const mz = (here.z + pb.z + pc.z) / 3
        // As made, one corner of the piece points along -z; it is turned to point at this deck.
        put('deck-fill', mx, mz, Math.atan2(-(here.x - mx), -(here.z - mz)))
      })
    }

    // Every open edge has something along it, and one or two of them are lit: enough to say
    // somebody is home, never an outline.
    const chosen = edges.map((edge) => EDGES[edge.seed % EDGES.length])
    const lit = () => chosen.filter((part) => LIT.test(part)).length
    const order = edges.map((edge, n) => n).sort((a, b) => edges[a].seed - edges[b].seed)
    for (const n of order) {
      if (lit() >= 1) break
      chosen[n] = 'edge-rail-lit'
    }
    for (const n of order) {
      if (lit() <= 2) break
      if (LIT.test(chosen[n])) chosen[n] = 'edge-rail'
    }
    edges.forEach((edge, n) => put(chosen[n], edge.x, edge.z, edge.turn))
  }

  // A crossing stands in the middle of the gap at the lower deck's height, its own +z running
  // from the lower platform to the higher. Two levels and more are not joined directly.
  for (const crossing of crossings) {
    if (crossing.rise > 1) continue
    const low = owner.get(cellKey(crossing.from.q, crossing.from.r))
    if (!low) continue
    const from = hexToWorld(crossing.from.q, crossing.from.r)
    const to = hexToWorld(crossing.to.q, crossing.to.r)
    parts.push({
      part: crossing.rise ? 'stair-1' : 'gangway',
      plot: crossing.low,
      x: (from.x + to.x) / 2,
      y: deckTop + low.level * levelStep,
      z: (from.z + to.z) / 2,
      turn: facing(to.x - from.x, to.z - from.z),
    })
  }
  return parts
}
