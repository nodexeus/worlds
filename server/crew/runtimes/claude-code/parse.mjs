/**
 * Claude Code's output, one line at a time, turned into the crew's events.
 *
 * Pure: lines in, events out, and the lines to write back when the person answers. No
 * process, no pipe, no clock, which is what lets every shape the CLI is known to write be
 * tested without running it. The shapes were recorded from CLI 2.1.293 and are listed in
 * `docs/superpowers/plans/2026-10-08-crew-runtimes.md`.
 *
 * It is deliberately deaf: a line it does not recognise, or cannot parse, says nothing. The
 * CLI adds new kinds of line in most releases, and one of them must never fail a turn.
 */

const SUMMARY_LIMIT = 160
const OUTPUT_LIMIT = 2000

/** The built-in tool the agent uses to ask the person something. */
const QUESTION_TOOL = 'AskUserQuestion'

/** The input that says most about what a tool call is for, in the order to look. */
const TELLING = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt']

function summarise(input) {
  if (!input || typeof input !== 'object') return ''
  for (const key of TELLING) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      return input[key].trim().replace(/\s+/g, ' ').slice(0, SUMMARY_LIMIT)
    }
  }
  return ''
}

/** A tool result's content is a string, or a list of blocks some of which are text. */
function outputOf(content) {
  const whole = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
      : ''
  return whole.slice(0, OUTPUT_LIMIT)
}

/** Which kind of failure this is, for the page to say something useful about it. */
function failureCode(reason, status) {
  const said = reason.toLowerCase()
  if (status === 401 || status === 403 || /\b401\b|\b403\b|login|log in|credential|api key|authenticat|unauthori[sz]ed/.test(said)) return 'auth'
  if ((typeof status === 'number' && (status === 429 || status >= 500)) || /\b429\b|\b5\d\d\b|rate.?limit|overloaded|credit|quota|billing/.test(said)) {
    return 'inference'
  }
  return 'runtime'
}

function questionsOf(input) {
  if (!Array.isArray(input?.questions)) return []
  return input.questions
    .filter((q) => typeof q?.question === 'string' && q.question.trim())
    .map((q) => ({
      question: q.question,
      options: Array.isArray(q.options) ? q.options.map((option) => option?.label).filter((label) => typeof label === 'string') : [],
    }))
}

export function createParser() {
  let started = false
  let finished = false
  /** Tool calls seen and not yet answered: id -> { name, summary }. */
  const tools = new Map()
  /** Requests waiting on the person: requestId -> { kind, input }. */
  const requests = new Map()

  const begin = (sessionId) => {
    if (started) return []
    started = true
    return [{ type: 'started', handle: typeof sessionId === 'string' && sessionId ? sessionId : null }]
  }

  /** @returns {object[]} the events this line amounts to, often none */
  function feed(line) {
    if (finished || typeof line !== 'string' || !line.trim()) return []
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      return []
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []

    if (entry.type === 'system') return entry.subtype === 'init' ? begin(entry.session_id) : []

    if (entry.type === 'stream_event') {
      const delta = entry.event?.type === 'content_block_delta' ? entry.event.delta : null
      return started && delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text
        ? [{ type: 'delta', text: delta.text }]
        : []
    }

    if (entry.type === 'assistant' || entry.type === 'user') {
      const content = entry.message?.content
      if (!Array.isArray(content)) return []
      const events = begin(entry.session_id)
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
          events.push({ type: 'text', text: block.text })
        } else if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          const tool = { name: block.name, summary: summarise(block.input) }
          tools.set(block.id, tool)
          events.push({ type: 'tool', id: block.id, ...tool, status: 'started' })
        } else if (block?.type === 'tool_result' && tools.has(block.tool_use_id)) {
          const tool = tools.get(block.tool_use_id)
          tools.delete(block.tool_use_id)
          events.push({
            type: 'tool',
            id: block.tool_use_id,
            ...tool,
            status: block.is_error ? 'failed' : 'finished',
            output: outputOf(block.content),
          })
        }
      }
      return events
    }

    if (entry.type === 'control_request') {
      const request = entry.request
      if (request?.subtype !== 'can_use_tool' || typeof entry.request_id !== 'string' || typeof request.tool_name !== 'string') return []
      const events = begin(entry.session_id)
      const questions = request.tool_name === QUESTION_TOOL ? questionsOf(request.input) : []
      if (questions.length) {
        requests.set(entry.request_id, { kind: 'question', input: request.input })
        events.push({ type: 'question', requestId: entry.request_id, questions })
      } else {
        requests.set(entry.request_id, { kind: 'approval', input: request.input ?? {} })
        const summary = summarise(request.input) || (typeof request.description === 'string' ? request.description.slice(0, SUMMARY_LIMIT) : '')
        events.push({ type: 'approval', requestId: entry.request_id, tool: request.tool_name, summary })
      }
      return events
    }

    if (entry.type === 'result') {
      const events = begin(entry.session_id)
      finished = true
      const said = typeof entry.result === 'string' ? entry.result : ''
      if (entry.is_error || (entry.subtype && entry.subtype !== 'success')) {
        const reason = said.trim() || `Claude Code ended the turn with an error (${entry.subtype || 'unknown'})`
        events.push({ type: 'failed', reason, code: failureCode(reason, entry.api_error_status) })
      } else {
        const ending = { type: 'finished', text: said }
        if (typeof entry.total_cost_usd === 'number') ending.costUsd = entry.total_cost_usd
        if (typeof entry.duration_ms === 'number') ending.durationMs = entry.duration_ms
        events.push(ending)
      }
      return events
    }

    return []
  }

  /**
   * The line to write to the CLI for the person's answer to an open request, or null if
   * that request is not waiting. A request is answered once.
   *
   * @param {string} requestId
   * @param {{allow: boolean, message?: string} | {text: string}} answer
   */
  function answerLine(requestId, answer) {
    const request = requests.get(requestId)
    if (!request) return null
    requests.delete(requestId)
    let response
    if (request.kind === 'question') {
      const answers = Object.fromEntries(questionsOf(request.input).map((q) => [q.question, answer.text]))
      response = { behavior: 'allow', updatedInput: { ...request.input, answers } }
    } else if (answer.allow) {
      response = { behavior: 'allow', updatedInput: request.input }
    } else {
      response = { behavior: 'deny', message: answer.message?.trim() || 'The owner declined this.' }
    }
    return JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }

  return {
    feed,
    answerLine,
    get finished() {
      return finished
    },
  }
}
