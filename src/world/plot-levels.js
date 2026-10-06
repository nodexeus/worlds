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
