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
import { answersOf, failure } from '../contract.mjs'

const SUMMARY_LIMIT = 160
const OUTPUT_LIMIT = 2000

/** The built-in tool the agent uses to ask the person something. */
const QUESTION_TOOL = 'AskUserQuestion'

/** The input that says most about what a tool call is for, in the order to look. */
const TELLING = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt']

const filled = (value) => typeof value === 'string' && value.length > 0

/**
 * JSON on one line, for a reader that takes a line at a time. JSON.stringify already
 * escapes a newline, but it leaves U+2028 and U+2029 as they are, and some line readers
 * (Node's own among them) break a line at those.
 */
export const oneLine = (value) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

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

const AUTH = /not logged in|\/login|invalid api key|authentication_error|oauth token|invalid x-api-key|permission_error/
const INFERENCE = new RegExp(
  [
    'rate.?limit', 'overloaded', 'credit balance', 'usage limit', 'session limit', 'billing_error', 'insufficient_quota',
    'connection error', 'timed out', 'timeout', 'enotfound', 'econnrefused', 'econnreset', 'ehostunreach', 'fetch failed',
  ].join('|')
)

/**
 * Which kind of failure this is, for the page to say something useful about it.
 *
 * Read from what the API reported, not from words that happen to be in the text: an agent
 * whose task was about a login page, or a file of 500 lines, has not failed to sign in and
 * has not hit a server error. So a status only counts where the CLI gave one, either as
 * `api_error_status` or as the "API Error: 429 ..." it prints.
 *
 * `auth`: the runtime is not signed in. `inference`: the model could not be reached or
 * would not answer (limits, credit, overload, gateway). `runtime`: anything else.
 */
export function failureCode(reason, status) {
  const said = String(reason).toLowerCase()
  const printed = /\bapi error:? (\d{3})\b/.exec(said)
  const code = Number(status) || (printed ? Number(printed[1]) : 0)
  // Money and limits are reported with a 403 or a 400 as often as not, so they are read first.
  if (INFERENCE.test(said)) return 'inference'
  if (code === 401 || code === 403 || AUTH.test(said)) return 'auth'
  if (code === 429 || code >= 500) return 'inference'
  return 'runtime'
}

function questionsOf(input) {
  if (!Array.isArray(input?.questions)) return []
  return input.questions
    .filter((q) => typeof q?.question === 'string' && q.question.trim())
    .map((q) => ({
      question: q.question,
      options: Array.isArray(q.options) ? q.options.map((option) => option?.label).filter((label) => typeof label === 'string') : [],
      ...(q.multiSelect === true ? { multiple: true } : {}),
    }))
}

export function createParser() {
  let started = false
  let finished = false
  /** Tool calls seen and not yet answered: id -> { name, summary }. */
  const tools = new Map()
  /** Requests waiting on the person: requestId -> { kind, input }. */
  const requests = new Map()
  /** Replies to requests that are nobody's to answer. */
  const replies = []

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
        } else if (block?.type === 'tool_use' && filled(block.id) && filled(block.name)) {
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
      if (!filled(entry.request_id)) return []
      if (request?.subtype !== 'can_use_tool') {
        // Not something a person answers, and not something this host does. Said so at
        // once, because the CLI waits for a reply to every request it makes.
        replies.push(oneLine({
          type: 'control_response',
          response: { subtype: 'error', request_id: entry.request_id, error: 'This host does not handle that request' },
        }))
        return []
      }
      if (!filled(request.tool_name)) return []
      const events = begin(entry.session_id)
      const questions = request.tool_name === QUESTION_TOOL ? questionsOf(request.input) : []
      if (questions.length) {
        requests.set(entry.request_id, { kind: 'question', input: request.input })
        events.push({ type: 'question', requestId: entry.request_id, questions })
      } else {
        requests.set(entry.request_id, { kind: 'approval', input: request.input ?? {} })
        const summary = summarise(request.input) || summarise({ description: request.description })
        events.push({ type: 'approval', requestId: entry.request_id, tool: request.tool_name, summary })
      }
      return events
    }

    if (entry.type === 'result') {
      const events = begin(entry.session_id)
      finished = true
      const said = typeof entry.result === 'string' ? entry.result : ''
      if (entry.is_error || (entry.subtype && entry.subtype !== 'success')) {
        // What it said can name what it is and how to sign in to it. That is for the log.
        const detail = said.trim() || `The turn ended with an error (${entry.subtype || 'unknown'})`
        events.push(failure(failureCode(detail, entry.api_error_status), detail))
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
      const given = answersOf(answer)
      const answers = Object.fromEntries(questionsOf(request.input).map((q, index) => [q.question, given[index]]))
      response = { behavior: 'allow', updatedInput: { ...request.input, answers } }
    } else if (answer.allow) {
      response = { behavior: 'allow', updatedInput: request.input }
    } else {
      response = { behavior: 'deny', message: answer.message?.trim() || 'The owner declined this.' }
    }
    return oneLine({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }

  /** Lines the CLI is owed that nobody had to decide. Each is handed over once. */
  const takeReplies = () => replies.splice(0)

  return {
    feed,
    answerLine,
    takeReplies,
    get finished() {
      return finished
    },
  }
}
