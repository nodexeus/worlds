/**
 * The crew backend, as the page asks things of it.
 *
 * Every refusal the server gives has a code and a sentence written for a person. Both are
 * kept, so a form can show the sentence and the page can act on the code.
 */
export class CrewApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status = 0) {
    super(message)
    this.name = 'CrewApiError'
    this.code = code
    this.status = status
  }
}

const UNREACHABLE = 'The server could not be reached. Nothing was sent.'

/** Drop what was left blank, so the server applies its own default. */
const filled = (fields) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && !(typeof value === 'string' && !value.trim())))

/**
 * @param {{fetch?: typeof fetch, base?: string}} [options]
 */
export function createCrewApi({ fetch: ask = (...args) => globalThis.fetch(...args), base = '/api/crew' } = {}) {
  async function call(method, path, body) {
    let res
    let reply
    try {
      res = await ask(base + path, body === undefined
        ? { method }
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      reply = await res.json()
    } catch {
      throw new CrewApiError('unreachable', UNREACHABLE, res?.status ?? 0)
    }
    if (!res.ok) {
      throw new CrewApiError(reply?.code || 'fault', reply?.error || 'Something went wrong on the server', res.status)
    }
    return reply
  }

  const id = encodeURIComponent

  return {
    status: () => call('GET', ''),
    agents: () => call('GET', '/agents'),
    workspaces: () => call('GET', '/workspaces'),
    specialists: () => call('GET', '/specialists'),
    settings: () => call('GET', '/settings'),
    createAgent: ({ name, runtime, role }) => call('POST', '/agents', filled({ name, runtime, role })),
    addSpecialist: (templateId) => call('POST', '/agents', { templateId }),
    createWorkspace: ({ name, description, gitUrl }) => call('POST', '/workspaces', filled({ name, description, gitUrl })),
    setAutonomy: (autonomy) => call('PATCH', '/settings', { autonomy }),
    send: (agentId, { text, workspaceId }) => call('POST', `/agents/${id(agentId)}/messages`, filled({ text, workspaceId })),
    stop: (agentId) => call('POST', `/agents/${id(agentId)}/stop`, {}),
    answer: (conversationId, answer) => call('POST', `/conversations/${id(conversationId)}/answers`, answer),
    conversations: (agentId) => call('GET', `/agents/${id(agentId)}/conversations`),
    events(conversationId, { before, after, limit } = {}) {
      const query = new URLSearchParams(filled({ before, after, limit }))
      return call('GET', `/conversations/${id(conversationId)}/events${query.size ? `?${query}` : ''}`)
    },
  }
}
