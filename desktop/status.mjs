/** Summarize sessions using the colony's saved visibility and read-state overrides.
 * @param {object[]} threads
 * @param {{archived?: string[], hiddenProjects?: string[], viewedAt?: Record<string, number>}} state
 * @returns {{total: number, working: number, waiting: number}}
 */
export function summarizeSessions(threads, state = {}) {
  const archived = new Set(state.archived || [])
  const hidden = new Set(state.hiddenProjects || [])
  const current = threads.filter(thread => !thread.archived && !archived.has(thread.id) && !hidden.has(thread.project || 'unknown'))
  let working = 0
  let waiting = 0
  for (const thread of current) {
    if (thread.hasError) continue
    if (thread.running) { working++; continue }
    if (thread.prState === 'MERGED') continue
    const seen = state.viewedAt?.[thread.id]
    if ((thread.needsAttention ?? thread.unread) && !(seen && thread.lastActivityAt <= seen)) waiting++
  }
  return { total: current.length, working, waiting }
}
