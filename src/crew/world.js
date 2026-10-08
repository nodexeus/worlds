/**
 * The crew as the campus draws it.
 *
 * The campus was built to draw scanned sessions: one robot a session, one plot a project.
 * This says the crew in those terms, so the same ground, robots and markers serve both. An
 * agent is one member; a workspace is one place, there whether or not anybody is on it.
 *
 * A place grows with the agents standing on it and with nothing else: a platform for every
 * `PER_PLATFORM` of them. What an agent did last week adds nothing to the ground.
 *
 * No DOM, no drawing: a function of the crew's state.
 */

/** Marks an id as the crew's, so it can never be taken for a session's or a project's. */
const PREFIX = 'crew:'

/** How many agents, and so how many buildings, one platform of a workspace holds. */
export const PER_PLATFORM = 2

/** The robots, in the order the campus numbers its models. */
const ROBOTS = ['unit', 'rock']

export const isCrew = (id) => typeof id === 'string' && id.startsWith(PREFIX)

/** The agent a drawn member is, or null for anything that is not the crew's. */
export const agentIdOf = (id) => (isCrew(id) ? id.slice(PREFIX.length) : null)

/**
 * @param {{agents: Array<object>, workspaces: Array<{id: string, name: string}>}} state
 * @param {number} [now]
 * @returns {{members: Array<object>, places: Array<{id: string, title: string, crew: true, platforms: number}>}}
 */
export function crewWorld({ agents = [], workspaces = [] }, now = Date.now()) {
  const known = new Set(workspaces.map((workspace) => workspace.id))
  const standing = new Map()

  const members = agents.map((agent, index) => {
    // A workspace the list has not caught up with yet is nowhere to stand.
    const placed = agent.workspaceId && known.has(agent.workspaceId) ? agent.workspaceId : null
    if (placed) standing.set(placed, (standing.get(placed) ?? 0) + 1)
    return {
      id: PREFIX + agent.id,
      crew: true,
      agentId: agent.id,
      title: agent.name,
      project: placed ? PREFIX + placed : null,
      roams: !placed,
      robot: Math.max(0, ROBOTS.indexOf(agent.kind)),
      running: agent.status === 'working',
      needsAttention: agent.status === 'waiting',
      hasError: agent.status === 'failed',
      // The roster lists agents oldest first, and that is the order they take their places in.
      createdAt: index,
      // An agent with nothing to do is idle, not gone: it is here for as long as it is in the crew.
      lastActivityAt: now,
      sizeBytes: 0,
    }
  })

  const places = workspaces.map((workspace) => ({
    id: PREFIX + workspace.id,
    title: workspace.name,
    crew: true,
    platforms: Math.max(1, Math.ceil((standing.get(workspace.id) ?? 0) / PER_PLATFORM)),
  }))

  return { members, places }
}
