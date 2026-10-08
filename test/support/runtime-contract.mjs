import test from 'node:test'
import assert from 'node:assert/strict'
import { ENDINGS } from '../../server/crew/runtimes/contract.mjs'
import { CrewError } from '../../server/crew/errors.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Start a turn and collect what it says. `until(type)` resolves with the first event of that
 * type, whether it has already arrived or not, and rejects if the turn ends without one.
 */
export function begin(runtime, input) {
  const events = []
  const waiters = []
  const onEvent = (event) => {
    events.push(event)
    for (const waiter of [...waiters]) {
      if (waiter.type === event.type) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(event)
      } else if (ENDINGS.includes(event.type)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.reject(new Error(`the turn ended "${event.type}" before any "${waiter.type}": ${JSON.stringify(event)}`))
      }
    }
  }
  const turn = runtime.start({ ...input, onEvent })
  const until = (type) => {
    const seen = events.find((event) => event.type === type)
    if (seen) return Promise.resolve(seen)
    const over = events.find((event) => ENDINGS.includes(event.type))
    if (over) return Promise.reject(new Error(`the turn ended "${over.type}" with no "${type}"`))
    return new Promise((resolve, reject) => waiters.push({ type, resolve, reject }))
  }
  return { turn, events, until, types: () => events.map((event) => event.type).filter((type) => type !== 'delta') }
}

/** The rules that hold for any turn, however it went. */
function wellFormed(events) {
  const endings = events.filter((event) => ENDINGS.includes(event.type))
  assert.equal(endings.length, 1, `a turn ends exactly once, this one: ${endings.map((e) => e.type)}`)
  assert.ok(ENDINGS.includes(events.at(-1).type), 'nothing follows the end')
  if (events.length > 1 || events[0].type !== 'failed') assert.equal(events[0].type, 'started', 'started comes first')
}

/**
 * The suite every runtime adapter must pass.
 *
 * `setup()` returns `{ runtime, say, input, cleanup? }`. `say` maps each scenario below to the
 * message that makes this runtime play it, and `input(more)` builds a turn's input.
 *
 * Scenarios: `plain` says something and finishes; `tool` uses one tool; `approval` wants to
 * use a tool it must ask about, and uses it only if allowed; `question` asks the person
 * something; `slow` starts and then takes a long time; `broken` fails.
 */
export function runtimeContract(name, setup) {
  const scenario = (title, run) =>
    test(`${name}: ${title}`, async () => {
      const made = await setup()
      try {
        await run(made)
      } finally {
        await made.cleanup?.()
      }
    })

  scenario('says what it supports', ({ runtime }) => {
    const supports = runtime.describe()
    for (const key of ['streaming', 'approvals', 'questions', 'resume']) assert.equal(typeof supports[key], 'boolean', key)
    assert.equal(typeof runtime.id, 'string')
  })

  scenario('a plain turn starts, speaks and finishes with a handle', async ({ runtime, say, input }) => {
    const { turn, events, types } = begin(runtime, input({ text: say.plain }))
    const result = await turn.done
    wellFormed(events)
    assert.deepEqual([types()[0], types().at(-1)], ['started', 'finished'])
    assert.ok(types().includes('text'))
    assert.equal(result.outcome, 'finished')
    assert.ok(result.handle && result.handle === events[0].handle)
    assert.equal(typeof events.at(-1).text, 'string')
  })

  scenario('a second turn with the handle continues the same conversation', async ({ runtime, say, input }) => {
    const first = await begin(runtime, input({ text: say.plain })).turn.done
    const second = begin(runtime, input({ text: say.plain, handle: first.handle }))
    const result = await second.turn.done
    wellFormed(second.events)
    assert.equal(result.handle, first.handle)
    assert.equal(result.outcome, 'finished')
  })

  scenario('a tool is reported started and then finished, under one id', async ({ runtime, say, input }) => {
    const { turn, events } = begin(runtime, input({ text: say.tool }))
    await turn.done
    wellFormed(events)
    const tools = events.filter((event) => event.type === 'tool')
    assert.deepEqual(tools.map((t) => t.status), ['started', 'finished'])
    assert.equal(tools[0].id, tools[1].id)
    assert.ok(tools[0].name && typeof tools[0].summary === 'string')
  })

  scenario('an approval holds the turn until it is allowed', async ({ runtime, say, input }) => {
    const { turn, events, until } = begin(runtime, input({ text: say.approval, autonomy: 'ask' }))
    const approval = await until('approval')
    assert.ok(approval.requestId && approval.tool)
    await sleep(60)
    assert.ok(!events.some((event) => ENDINGS.includes(event.type)), 'it did not wait for the answer')
    turn.answer(approval.requestId, { allow: true })
    assert.equal((await turn.done).outcome, 'finished')
    wellFormed(events)
    assert.equal(events.filter((e) => e.type === 'tool').at(-1).status, 'finished')
  })

  scenario('an approval that is denied fails the tool and the turn still finishes', async ({ runtime, say, input }) => {
    const { turn, events, until } = begin(runtime, input({ text: say.approval, autonomy: 'ask' }))
    const approval = await until('approval')
    turn.answer(approval.requestId, { allow: false, message: 'Not on a Friday.' })
    assert.equal((await turn.done).outcome, 'finished')
    wellFormed(events)
    assert.equal(events.filter((e) => e.type === 'tool').at(-1).status, 'failed')
  })

  scenario('a question holds the turn until it is answered', async ({ runtime, say, input }) => {
    const { turn, events, until } = begin(runtime, input({ text: say.question }))
    const question = await until('question')
    assert.ok(question.questions[0].question)
    turn.answer(question.requestId, { text: 'The blue one.' })
    assert.equal((await turn.done).outcome, 'finished')
    wellFormed(events)
  })

  scenario('an answer nobody asked for, a second answer, and a malformed one are refused', async ({ runtime, say, input }) => {
    const { turn, until } = begin(runtime, input({ text: say.approval, autonomy: 'ask' }))
    const approval = await until('approval')
    assert.throws(() => turn.answer('no-such-request', { allow: true }), refused('unknown_request'))
    assert.throws(() => turn.answer(approval.requestId, { text: 'yes please' }), refused('bad_answer'))
    assert.throws(() => turn.answer(approval.requestId, null), refused('bad_answer'))
    turn.answer(approval.requestId, { allow: true })
    assert.throws(() => turn.answer(approval.requestId, { allow: true }), refused('unknown_request'))
    await turn.done
  })

  scenario('an answer that arrives after the turn has ended is refused', async ({ runtime, say, input }) => {
    const { turn, until } = begin(runtime, input({ text: say.approval, autonomy: 'ask' }))
    const approval = await until('approval')
    turn.interrupt()
    await turn.done
    assert.throws(() => turn.answer(approval.requestId, { allow: true }), refused('unknown_request'))
  })

  scenario('an interrupt ends a running turn as interrupted, once', async ({ runtime, say, input }) => {
    const { turn, events, until } = begin(runtime, input({ text: say.slow }))
    await until('started')
    turn.interrupt()
    turn.interrupt()
    const result = await turn.done
    await sleep(80)
    wellFormed(events)
    assert.equal(result.outcome, 'interrupted')
    assert.equal(events.at(-1).type, 'interrupted')
  })

  scenario('an interrupt while waiting on an approval ends the turn', async ({ runtime, say, input }) => {
    const { turn, events, until } = begin(runtime, input({ text: say.approval, autonomy: 'ask' }))
    await until('approval')
    turn.interrupt()
    assert.equal((await turn.done).outcome, 'interrupted')
    wellFormed(events)
  })

  scenario('a runtime that fails says why, in a word and in a sentence', async ({ runtime, say, input }) => {
    const { turn, events } = begin(runtime, input({ text: say.broken }))
    const result = await turn.done
    wellFormed(events)
    assert.equal(result.outcome, 'failed')
    const failed = events.at(-1)
    assert.ok(failed.reason.length > 3)
    assert.ok(['auth', 'inference', 'runtime', 'crashed'].includes(failed.code))
  })

  scenario('an interrupt after the end does nothing, and done never rejects', async ({ runtime, say, input }) => {
    const { turn, events } = begin(runtime, input({ text: say.plain }))
    await turn.done
    const count = events.length
    turn.interrupt()
    await sleep(40)
    assert.equal(events.length, count)
    assert.equal((await turn.done).outcome, 'finished')
  })

  scenario('a turn that makes no sense is refused before anything runs', ({ runtime, say, input }) => {
    assert.throws(() => runtime.start(input({ text: '' })), refused('bad_turn'))
    assert.throws(() => runtime.start(input({ text: say.plain, folder: 'relative' })), refused('bad_turn'))
    assert.throws(() => runtime.start(input({ text: say.plain, autonomy: 'reckless' })), refused('bad_turn'))
  })
}
