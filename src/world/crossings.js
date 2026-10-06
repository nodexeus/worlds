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
export function planCrossings(plots) {
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
