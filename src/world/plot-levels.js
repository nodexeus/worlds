/**
 * Which raised level a workspace stands on, on a world that has levels.
 *
 * A level is part of where a workspace *is*, as much as the ground it holds: it is decided
 * once, the first time the workspace is placed, and remembered in the colony file next to the
 * layout. It never depends on any other workspace, so one project gaining a thread cannot lift
 * or drop a different one, which is the same promise the layout itself makes.
 */

/** FNV-1a, the same hash the rest of the world uses to turn a name into a stable number. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The level for one workspace.
 *
 * @param {string} name
 * @param {Map<string, number>} remembered  levels already decided, by workspace name
 * @param {number} count  how many levels this world has; one or fewer means it has none
 * @returns {number} a whole number from 0 to `count - 1`
 */
export function levelFor(name, remembered, count) {
  if (!(count > 1)) return 0
  const known = remembered.get(name)
  // A remembered level from a world with more levels than this one is brought down to fit.
  if (Number.isInteger(known) && known >= 0) return Math.min(known, count - 1)
  return hash(name) % count
}

/**
 * Decide every workspace's level together, so that the campus is one connected whole.
 *
 * Each workspace starts from the level it remembers, or failing that the one its name gives
 * it (`levelFor`). That alone can strand some of them: two neighbours a single level apart
 * are joined by a staircase, but two that are further apart are not joined at all, and a
 * workspace whose every neighbour is too far above or below it ends up joined to nothing.
 *
 * So while any part of the campus cannot be reached from the rest, one workspace on the
 * boundary between the two parts is moved until it is a single level from its neighbour on the
 * other side. Nothing is touched on a campus that is already connected, and what is decided
 * here is remembered, so a workspace only ever moves when something would otherwise be cut off.
 *
 * Workspaces that do not touch any other cannot be joined by anything and are left alone.
 *
 * @param {Array<{id: string, neighbours: Iterable<string>}>} plots  each with the ids of the
 *   workspaces it touches
 * @param {Map<string, number>} remembered
 * @param {number} count  how many levels this world has
 * @returns {Map<string, number>} a level for every workspace in `plots`
 */
export function settleLevels(plots, remembered, count) {
  const levels = new Map(plots.map((plot) => [plot.id, levelFor(plot.id, remembered, count)]))
  if (!(count > 1)) return levels
  const touching = new Map(plots.map((plot) => [plot.id, [...plot.neighbours].filter((id) => levels.has(id)).sort()]))
  const ids = [...levels.keys()].sort()
  const joined = (a, b) => Math.abs(levels.get(a) - levels.get(b)) <= 1

  /** The group of workspaces that can reach `start` over crossings. */
  const groupOf = (start) => {
    const group = new Set([start])
    const queue = [start]
    while (queue.length) {
      const here = queue.shift()
      for (const next of touching.get(here)) {
        if (group.has(next) || !joined(here, next)) continue
        group.add(next)
        queue.push(next)
      }
    }
    return group
  }

  // Each pass joins two groups that touch, so it cannot run for longer than there are
  // workspaces; the bound is there for worlds with more levels than have been thought about.
  for (let pass = 0; pass < ids.length * count; pass++) {
    const main = groupOf(ids[0])
    // Somebody outside the main group who touches somebody inside it, taken in a fixed order.
    let bridge = null
    for (const outside of ids) {
      if (main.has(outside)) continue
      const inside = touching.get(outside).find((id) => main.has(id))
      if (inside) {
        bridge = { outside, inside }
        break
      }
    }
    if (!bridge) {
      // Whatever is left over touches nothing in the main group. It may still be a group of
      // its own that needs joining up, so the search starts again from one of its members.
      const stray = ids.find((id) => !main.has(id) && touching.get(id).some((other) => !joined(id, other)))
      if (!stray) break
      const other = touching.get(stray).find((id) => !joined(stray, id))
      levels.set(stray, levels.get(other) + Math.sign(levels.get(stray) - levels.get(other)))
      continue
    }
    // Brought to one level from its neighbour inside, on the side it was already on.
    const { outside, inside } = bridge
    levels.set(outside, levels.get(inside) + Math.sign(levels.get(outside) - levels.get(inside)))
  }
  return levels
}

/**
 * Take remembered levels out of the colony file. It is a file a person can edit, so anything
 * that is not a small whole number is dropped and the workspace is simply decided afresh.
 *
 * @param {unknown} saved
 * @returns {Map<string, number>}
 */
export function readLevels(saved) {
  const out = new Map()
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out
  for (const [name, level] of Object.entries(saved)) {
    if (Number.isInteger(level) && level >= 0 && level < 16) out.set(String(name), level)
  }
  return out
}
