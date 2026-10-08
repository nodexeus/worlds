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
  if (!filled(folder) || !path.isAbsolute(folder)) throw bad('an absolute workspace folder')
  if (!text(said) || !said.trim()) throw bad('a message')
  if (said.length > TEXT_LIMIT) throw bad(`a message of at most ${TEXT_LIMIT} characters`)
  if (handle !== null && !filled(handle)) throw bad('a handle, or null to start a conversation')
  if (!AUTONOMY.includes(autonomy)) throw bad(`an autonomy level: ${AUTONOMY.join(', ')}`)
  if (typeof onEvent !== 'function') throw bad('somewhere to send events')
  return input
}

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
      break
    default:
      break
  }
  return event
}

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
  /** @type {Map<string, 'approval' | 'question'>} */
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

  const broken = (why) => end({ type: 'failed', reason: `The runtime adapter is at fault: ${why}`, code: 'runtime' })

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
    if (event.type === 'approval' || event.type === 'question') open.set(event.requestId, event.type)
    deliver(event)
  }

  function end(event) {
    if (ended) return
    let ending = event
    try {
      checkEvent(event)
      if (!ENDINGS.includes(event.type)) throw new Error(`"${event.type}" is not a way for a turn to end`)
    } catch (error) {
      ending = { type: 'failed', reason: `The runtime adapter is at fault: ${error.message}`, code: 'runtime' }
    }
    ended = true
    open.clear()
    deliver(ending)
    resolve({ handle, outcome: ending.type })
  }

  /** Take a request off the waiting list, saying which kind it was, or refuse. */
  function settle(requestId) {
    const kind = open.get(requestId)
    if (!kind) throw new CrewError('unknown_request', 'Nothing is waiting for that answer', 409)
    open.delete(requestId)
    return kind
  }

  return {
    emit,
    end,
    settle,
    isOpen: (requestId) => open.has(requestId),
    get ended() {
      return ended
    },
    get handle() {
      return handle
    },
    done,
  }
}
