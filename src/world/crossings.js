/**
 * Which workspaces are joined across the gap between them, and where.
 *
 * On a world whose workspaces stand apart, two that are neighbours on the lattice get one
 * crossing: a walkway when they stand on the same level, a staircase when they are one level
 * apart. Two levels apart is too far for a flight that fits in the gap, so those two are not
 * joined directly and are reached by way of somebody in between.
 *
 * This is the plain description of that, with no renderer in sight. What is drawn and how the
 * crew find their way are both read off the same list, so they cannot disagree.
 */
import { HEX_DIRS, cellKey } from './plot-move.js'

/**
 * @typedef {object} Crossing
 * @property {string} low   the workspace at the lower end (or either, when they are level)
 * @property {string} high  the workspace at the upper end
 * @property {{q: number, r: number}} from  the cell of `low` the crossing leaves from
 * @property {{q: number, r: number}} to    the neighbouring cell of `high` it arrives at
 * @property {number} rise  how many levels it climbs: 0 for a walkway, 1 for a staircase
 */

/**
 * One crossing for each pair of neighbouring workspaces that can have one.
 *
 * Where two workspaces share a long border there are many places a crossing could go. It goes
 * between the two cells each of them has held longest, so it stays put while either grows:
 * a workspace's cells are listed in the order it claimed them, and new ones go on the end.
 *
 * @param {Array<{id: string, cells: Array<{q: number, r: number}>, level?: number}>} plots
 * @returns {Crossing[]} ordered by workspace pair, so the same plots always give the same list
 */
export function planCrossings(plots, { sparing = false } = {}) {
  const every = everyCrossing(plots)
  return sparing ? sparingly(every) : every
}

/** FNV-1a, the hash the rest of the world uses to turn a name into a stable number. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** How many of the crossings a campus could do without are kept anyway: about one in this many. */
const SPARE = 7

/**
 * The crossings a campus needs, and a few more.
 *
 * Joining every pair of neighbours puts a staircase on every edge of every workspace. This
 * keeps enough that every workspace can still be reached from every other it could be reached
 * from before, a level walk in preference to a climb, and then about one in `SPARE` of the
 * rest, so there is usually more than one way round. Which are kept depends on the two
 * workspaces' names and on nothing else, so it is the same every time.
 *
 * @param {Crossing[]} crossings
 * @returns {Crossing[]} in the order they were given
 */
function sparingly(crossings) {
  const seed = (crossing) => hash(`${crossing.low}\u0000${crossing.high}`)
  const order = crossings.map((crossing, n) => n).sort((a, b) =>
    crossings[a].rise - crossings[b].rise || seed(crossings[a]) - seed(crossings[b]) || a - b)
  const group = new Map()
  const find = (id) => {
    while (group.has(id) && group.get(id) !== id) id = group.get(id)
    return id
  }
  const kept = new Set()
  for (const n of order) {
    const a = find(crossings[n].low)
    const b = find(crossings[n].high)
    if (a === b) continue
    group.set(a, b)
    group.set(b, b)
    kept.add(n)
  }
  for (const n of order) if (!kept.has(n) && seed(crossings[n]) % SPARE === 0) kept.add(n)
  return crossings.filter((crossing, n) => kept.has(n))
}

function everyCrossing(plots) {
  const owner = new Map()
  for (const plot of plots) {
    plot.cells.forEach((cell, age) => owner.set(cellKey(cell.q, cell.r), { plot, cell, age }))
  }

  const best = new Map()
  for (const here of owner.values()) {
    for (const [dq, dr] of HEX_DIRS) {
      const there = owner.get(cellKey(here.cell.q + dq, here.cell.r + dr))
      if (!there || there.plot === here.plot) continue
      // Each facing pair of cells is met twice, once from each side. Keep one of the two.
      if (here.plot.id > there.plot.id) continue
      const pair = `${here.plot.id}\u0000${there.plot.id}`
      const age = here.age + there.age
      const held = best.get(pair)
      // Oldest cells first; between equally old pairs, a fixed order so the choice is stable.
      const order = `${cellKey(here.cell.q, here.cell.r)}>${cellKey(there.cell.q, there.cell.r)}`
      if (!held || age < held.age || (age === held.age && order < held.order)) {
        best.set(pair, { here, there, age, order })
      }
    }
  }

  const crossings = []
  for (const pair of [...best.keys()].sort()) {
    const { here, there } = best.get(pair)
    const rise = Math.abs((here.plot.level || 0) - (there.plot.level || 0))
    if (rise > 1) continue
    const [low, high] = (here.plot.level || 0) <= (there.plot.level || 0) ? [here, there] : [there, here]
    crossings.push({ low: low.plot.id, high: high.plot.id, from: { ...low.cell }, to: { ...high.cell }, rise })
  }
  return crossings
}

/**
 * Which workspaces can be reached from `start` over crossings alone, itself included.
 *
 * @param {Crossing[]} crossings
 * @param {string} start
 * @returns {Set<string>}
 */
export function reachable(crossings, start) {
  const next = new Map()
  for (const { low, high } of crossings) {
    if (!next.has(low)) next.set(low, [])
    if (!next.has(high)) next.set(high, [])
    next.get(low).push(high)
    next.get(high).push(low)
  }
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    for (const id of next.get(queue.shift()) || []) {
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(id)
    }
  }
  return seen
}
