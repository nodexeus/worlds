/**
 * What the message box on an agent's card is for, right now.
 *
 * One box does three things: it continues the conversation, it starts a new task in a
 * workspace, and it leaves a message for an agent that is busy. Which of them it is depends
 * on how the agent is doing and whether a workspace has been chosen, and is decided here so
 * the card only has to draw the answer.
 */

const STATUS = { idle: 'idle', working: 'working', waiting: 'needs you', failed: 'failed' }

export const statusLabel = (status) => STATUS[status] ?? STATUS.idle

const BUSY = ['working', 'waiting']

/** An agent's status and where it is, as one line. */
export function agentLine(agent, workspaces) {
  const label = statusLabel(agent.status)
  const place = agent.conversationId ? workspaces.find((workspace) => workspace.id === agent.workspaceId) : null
  if (!place) return label
  return BUSY.includes(agent.status) ? `${label} · ${place.name}` : `${label} · last in ${place.name}`
}

/**
 * @param {{agent: object, workspaces: {id: string, name: string}[], picked: string | null}} input
 *   `picked` is the workspace chip the person chose, if any. `agent.runs` is whether this
 *   server can run it. The page is never told what that takes.
 * @returns {{mode: 'continue' | 'task' | 'queue' | 'choose' | 'no-workspace' | 'unavailable',
 *   chips: {id: string, name: string, current: boolean, on: boolean}[], workspaceId: string | null,
 *   placeholder: string, hint: string, canSend: boolean}}
 */
export function composer({ agent, workspaces, picked }) {
  const none = { chips: [], workspaceId: null }
  if (agent.runs === false) {
    return {
      ...none, mode: 'unavailable', canSend: false, placeholder: `${agent.name} cannot be reached`,
      hint: `${agent.name} is not available on this server yet.`,
    }
  }
  if (BUSY.includes(agent.status)) {
    return { ...none, mode: 'queue', canSend: true, placeholder: `Message ${agent.name}… (sent when it finishes)`, hint: '' }
  }
  const placeholder = `Ask ${agent.name}, or give it a task…`
  if (!workspaces.length) {
    return { ...none, mode: 'no-workspace', canSend: false, placeholder, hint: 'Create a workspace first: an agent works in one.' }
  }

  const here = agent.conversationId ? workspaces.find((workspace) => workspace.id === agent.workspaceId) ?? null : null
  let chosen = workspaces.find((workspace) => workspace.id === picked) ?? null
  // Nothing to continue and only one place to start: no need to ask.
  if (!chosen && !here && workspaces.length === 1) chosen = workspaces[0]

  const chips = workspaces.map((workspace) => ({
    id: workspace.id, name: workspace.name, current: workspace.id === here?.id, on: workspace.id === chosen?.id,
  }))
  if (chosen) {
    return { mode: 'task', chips, workspaceId: chosen.id, canSend: true, placeholder, hint: `New task in ${chosen.name}` }
  }
  if (here) {
    return {
      mode: 'continue', chips, workspaceId: null, canSend: true, placeholder,
      hint: `Continuing in ${here.name}. Choose a workspace to start a new task.`,
    }
  }
  return { mode: 'choose', chips, workspaceId: null, canSend: false, placeholder, hint: 'Choose a workspace for this task.' }
}

/** What to send for a message typed into a box in the state `view` describes. */
export function payload(view, text) {
  const said = { text: String(text).trim() }
  return view.mode === 'task' ? { ...said, workspaceId: view.workspaceId } : said
}

/**
 * The reply to a request, or null while it is not yet complete.
 *
 * @param {{type: 'approval' | 'question', requestId: string, questions?: object[]}} request
 * @param {{allow?: boolean, message?: string, answers?: Array<string | string[]>}} choice
 *   for a question, one answer for each thing asked: text, or the options ticked
 */
export function answerFor(request, choice) {
  const { requestId } = request
  if (request.type === 'approval') {
    const message = typeof choice.message === 'string' ? choice.message.trim() : ''
    return { requestId, allow: Boolean(choice.allow), ...(message && !choice.allow ? { message } : {}) }
  }
  const asked = request.questions?.length ?? 1
  const given = Array.isArray(choice.answers) ? choice.answers : []
  const answers = given.map((answer) => (Array.isArray(answer) ? answer.join(', ') : String(answer ?? '')).trim())
  if (answers.length !== asked || answers.some((answer) => !answer)) return null
  return { requestId, answers }
}
