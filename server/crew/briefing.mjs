// server/crew/briefing.mjs

/** What a runtime will take as a role: see `ROLE_LIMIT` in `runtimes/contract.mjs`. */
const LIMIT = 32_000
const DESCRIPTION = 200
const OTHERS = 40

const line = (workspace) => {
  const about = String(workspace.description || '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION)
  return about ? `- ${workspace.name}: ${about}` : `- ${workspace.name}`
}

/**
 * Who an agent is, to anyone it talks to: itself, by its crew name. What runs it is never the
 * person's to know, so it does not say. It is not asked to pretend to be anything but an AI.
 */
const identity = (agent) => {
  const name = String(agent.name || '').trim()
  return [
    name ? `You are ${name}, a member of this crew. Speak as ${name}.` : 'You are a member of this crew.',
    'If you are asked what you are, say that you are an AI agent in this crew. Do not name the software, the model or the company behind you, and do not mention them in what you write.',
  ].join(' ')
}

/**
 * What an agent is told on every turn, on top of its own role: where it is, what else there
 * is, and the rules about where work happens. Those rules hold at every autonomy level.
 *
 * The rules come last and are never cut: when there is too much to say, it is the list of
 * other workspaces that is shortened, and then the role.
 *
 * @param {{agent: {name?: string, role?: string}, workspace: {name: string, description?: string},
 *   others: {name: string, description?: string}[]}} input
 */
export function briefing({ agent, workspace, others }) {
  const here = String(workspace.description || '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION)
  const rules = [
    'Rules that always hold:',
    '- Do all of your work inside this workspace\'s folder, which is your working directory.',
    '- If the task belongs in a different workspace, do not do it here. Say which workspace it belongs in, and stop.',
    '- If it is unclear what is being asked, or where it belongs, ask before doing any work.',
    '- Never create a workspace yourself. Ask for one.',
  ].join('\n')

  const shown = others.slice(0, OTHERS)
  const more = others.length - shown.length
  const elsewhere = shown.length
    ? `The other workspaces in this world:\n${shown.map(line).join('\n')}\n${more > 0 ? `(and ${more} more)\n` : ''}`
    : 'There are no other workspaces in this world.\n'

  const standing = [
    identity(agent),
    `You are working in the workspace "${workspace.name}"${here ? `: ${here}` : '.'}`,
    elsewhere,
    rules,
  ].join('\n\n')

  const role = String(agent.role || '').trim().slice(0, Math.max(0, LIMIT - standing.length - 2))
  return role ? `${role}\n\n${standing}` : standing
}

/**
 * What an agent is told when it is asked something aside from its task: its own role, then
 * the instruction for the occasion. As above, it is the role that gives way.
 *
 * @param {{agent: {role?: string}, instruction: string}} input
 */
export function asideBriefing({ agent, instruction }) {
  const told = String(instruction || '').trim()
  const standing = `${identity(agent)}${told ? `\n\n${told}` : ''}`.slice(0, LIMIT)
  const role = String(agent.role || '').trim().slice(0, Math.max(0, LIMIT - standing.length - 2))
  return role ? `${role}\n\n${standing}` : standing
}
