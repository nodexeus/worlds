import path from 'node:path'
import { CrewError } from '../errors.mjs'

/**
 * What every runtime adapter agrees to.
 *
 * A runtime is whatever actually runs an agent: Claude Code, Hermes, OpenClaw. Each has its
 * own flags, session ids and wire format, and none of that leaves its adapter. What comes
 * out is the same for all of them: one turn at a time, as a stream of the events below,
 * ending exactly once.
 *
 *   runtime.start(input) -> { answer(requestId, answer), interrupt(), done }
 *
 * The opaque `handle` is the one runtime-specific value a caller holds: it is given in the
 * `started` event and passed back to continue the same conversation.
 */

/** How much an agent may do unasked. See the spec, "Autonomy". */
export const AUTONOMY = ['ask', 'workspace', 'autonomous']

/** The three ways a turn ends. Exactly one of them, exactly once. */
export const ENDINGS = ['finished', 'failed', 'interrupted']

export const EVENT_TYPES = ['started', 'delta', 'text', 'tool', 'approval', 'question', ...ENDINGS]

const TOOL_STATUS = ['started', 'finished', 'failed']
const FAILURE_CODES = ['auth', 'inference', 'runtime', 'crashed']

/** A person's message is long; a pasted log is longer; a megabyte is a mistake. */
const TEXT_LIMIT = 100_000

/**
 * A role reaches some runtimes as a command-line argument, and an operating system only
 * takes so much of one.
 */
const ROLE_LIMIT = 32_000

const text = (value) => typeof value === 'string'
const filled = (value) => typeof value === 'string' && value.length > 0

/**
 * A turn's input, or a refusal. Checked before an adapter starts anything, so no runtime is
 * ever handed a folder that is not a folder or a message that is not a message.
 */
export function checkTurnInput(input) {
  const bad = (what) => new CrewError('bad_turn', `A turn needs ${what}`, 400)
  if (!input || typeof input !== 'object') throw bad('an agent, a folder and a message')
  const { agent, folder, text: said, handle, autonomy, onEvent } = input
  if (!agent || !filled(agent.id) || !filled(agent.name)) throw bad('an agent with an id and a name')
  if (agent.role !== undefined && (!text(agent.role) || agent.role.length > ROLE_LIMIT)) {
    throw bad(`an agent whose role is text of at most ${ROLE_LIMIT} characters`)
  }
  if (!filled(folder) || !path.isAbsolute(folder)) throw bad('an absolute workspace folder')
  if (!text(said) || !said.trim()) throw bad('a message')
  if (said.length > TEXT_LIMIT) throw bad(`a message of at most ${TEXT_LIMIT} characters`)
  if (handle !== null && !filled(handle)) throw bad('a handle, or null to start a conversation')
  if (!AUTONOMY.includes(autonomy)) throw bad(`an autonomy level: ${AUTONOMY.join(', ')}`)
  if (typeof onEvent !== 'function') throw bad('somewhere to send events')
  return input
}

/**
 * How a failure is put to the person, by its kind. These words never say what an agent runs
 * on or what a model is reached through: that is not theirs to know.
 */
const FAILED = {
  auth: 'This agent is not signed in on this server',
  inference: 'This agent could not get an answer: a limit was reached or the service is busy',
  crashed: 'This agent stopped before finishing',
  runtime: 'This agent could not finish what it was doing',
}

/**
 * A failed ending. `detail` is what the runtime itself said, in its own words: it is for the
 * server's log and is never kept in the record or sent to a page.
 *
 * @param {string} code one of the failure codes
 * @param {string} [detail]
 * @param {string} [reason] other neutral words, when the kind alone says too little
 */
export const failure = (code, detail, reason = FAILED[code]) => ({ type: 'failed', reason, code, ...(detail ? { detail: String(detail) } : {}) })

/**
 * An event in its proper shape, or an error naming the field that is wrong. This is a check
 * on adapters, not on people, so it throws a plain Error: a bad event is a bug.
 */
export function checkEvent(event) {
  const wrong = (field) => new Error(`event ${event?.type ?? ''}: bad ${field}`.replace('  ', ' '))
  if (!event || typeof event !== 'object') throw new Error('not an event')
  if (!EVENT_TYPES.includes(event.type)) throw wrong('type')
  switch (event.type) {
    case 'started':
      if (event.handle !== null && !filled(event.handle)) throw wrong('handle')
      break
    case 'delta':
    case 'text':
      if (!text(event.text)) throw wrong('text')
      break
    case 'tool':
      if (!filled(event.id)) throw wrong('id')
      if (!filled(event.name)) throw wrong('name')
      if (!text(event.summary)) throw wrong('summary')
      if (!TOOL_STATUS.includes(event.status)) throw wrong('status')
      if (event.output !== undefined && !text(event.output)) throw wrong('output')
      break
    case 'approval':
      if (!filled(event.requestId)) throw wrong('requestId')
      if (!filled(event.tool)) throw wrong('tool')
      if (!text(event.summary)) throw wrong('summary')
      break
    case 'question':
      if (!filled(event.requestId)) throw wrong('requestId')
      if (!Array.isArray(event.questions) || !event.questions.length) throw wrong('questions')
      for (const q of event.questions) {
        if (!q || !filled(q.question)) throw wrong('questions')
        if (!Array.isArray(q.options) || q.options.some((option) => !text(option))) throw wrong('options')
        if (q.multiple !== undefined && typeof q.multiple !== 'boolean') throw wrong('multiple')
      }
      break
    case 'finished':
      if (!text(event.text)) throw wrong('text')
      if (event.costUsd !== undefined && typeof event.costUsd !== 'number') throw wrong('costUsd')
      if (event.durationMs !== undefined && typeof event.durationMs !== 'number') throw wrong('durationMs')
      break
    case 'failed':
      if (!filled(event.reason)) throw wrong('reason')
      if (!FAILURE_CODES.includes(event.code)) throw wrong('code')
      if (event.detail !== undefined && typeof event.detail !== 'string') throw wrong('detail')
      break
    default:
      break
  }
  return event
}

/**
 * An answer that fits what was asked.
 *
 *   - to an approval: `{ allow: true }` or `{ allow: false, message? }`;
 *   - to a question: `{ answers: string[] }`, one for each thing asked, in order. When only
 *     one thing was asked, `{ text }` says the same.
 *
 * @param {'approval' | 'question'} kind
 * @param {object} answer
 * @param {number} [asked] how many questions the request held
 */
export function checkAnswer(kind, answer, asked = 1) {
  const bad = (what) => new CrewError('bad_answer', what, 400)
  const said = (value) => text(value) && value.trim().length > 0
  if (!answer || typeof answer !== 'object') throw bad('An answer is needed')
  if (kind === 'approval') {
    if (typeof answer.allow !== 'boolean') throw bad('An approval is answered with allow: true or false')
    if (answer.message !== undefined && !text(answer.message)) throw bad('The reason for a refusal is text')
    return answer
  }
  if (answer.answers !== undefined) {
    if (!Array.isArray(answer.answers) || answer.answers.length !== asked || !answer.answers.every(said)) {
      throw bad(`${asked} ${asked === 1 ? 'question was' : 'questions were'} asked: give an answer to each`)
    }
    return answer
  }
  if (asked !== 1) throw bad(`${asked} questions were asked: give an answer to each, as answers`)
  if (!said(answer.text)) throw bad('A question is answered with text')
  return answer
}

/** A question's answers as a list, one per thing asked, whichever way they were given. */
export const answersOf = (answer) => answer.answers ?? [answer.text]

/**
 * The part of a turn that is the same in every adapter, kept in one place so the rules
 * cannot be got slightly different in each:
 *
 *   - the first event is `started` (unless the turn fails before it can start);
 *   - the turn ends once, with one of the endings, and nothing is delivered after it;
 *   - a listener that throws does not take the turn down with it;
 *   - a question or approval is open from when it is asked until it is answered or the
 *     turn ends, and cannot be answered at any other time.
 *
 * An adapter that breaks a rule fails its own turn, with a reason that says which.
 *
 * @param {(event: object) => void} onEvent
 * @param {{log?: (...args: any[]) => void}} [options]
 */
export function turnController(onEvent, { log = console.error } = {}) {
  let begun = false
  let ended = false
  let handle = null
  /** @type {Map<string, {kind: 'approval' | 'question', asked: number}>} */
  const open = new Map()
  let resolve
  const done = new Promise((r) => {
    resolve = r
  })

  const deliver = (event) => {
    try {
      onEvent(event)
    } catch (error) {
      log('crew runtime: a listener threw on', event.type, error)
    }
  }

  const broken = (why) => end(failure('runtime', `The runtime adapter is at fault: ${why}`))

  function emit(event) {
    if (ended) return
    try {
      checkEvent(event)
    } catch (error) {
      return broken(error.message)
    }
    if (ENDINGS.includes(event.type)) return broken(`it sent "${event.type}" as an ordinary event`)
    if (!begun && event.type !== 'started') return broken(`it sent "${event.type}" before the turn had started`)
    if (event.type === 'started') {
      if (begun) return
      begun = true
      handle = event.handle
    }
    if (event.type === 'approval') open.set(event.requestId, { kind: 'approval', asked: 1 })
    if (event.type === 'question') open.set(event.requestId, { kind: 'question', asked: event.questions.length })
    deliver(event)
  }

  function end(event) {
    if (ended) return
    let ending = event
    try {
      checkEvent(event)
      if (!ENDINGS.includes(event.type)) throw new Error(`"${event.type}" is not a way for a turn to end`)
    } catch (error) {
      ending = failure('runtime', `The runtime adapter is at fault: ${error.message}`)
    }
    ended = true
    open.clear()
    deliver(ending)
    resolve({ handle, outcome: ending.type })
  }

  /**
   * Take a request off the waiting list, saying which kind it was, or refuse. An answer that
   * does not fit what was asked is refused and the request stays waiting.
   */
  function settle(requestId, answer) {
    const waiting = open.get(requestId)
    if (!waiting) throw new CrewError('unknown_request', 'Nothing is waiting for that answer', 409)
    if (arguments.length > 1) checkAnswer(waiting.kind, answer, waiting.asked)
    open.delete(requestId)
    return waiting.kind
  }

  return {
    emit,
    end,
    settle,
    isOpen: (requestId) => open.has(requestId),
    /** Whether the turn is stopped on the person: a runtime is not stalled while it waits. */
    get waiting() {
      return open.size > 0
    },
    get ended() {
      return ended
    },
    get handle() {
      return handle
    },
    done,
  }
}
