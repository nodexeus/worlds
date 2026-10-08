// test/crew-demo.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCrewConfig } from '../server/crew/config.mjs'
import { RUNTIMES } from '../server/crew/names.mjs'
import { createDemoRuntimes, demoScript } from '../server/crew/runtimes/demo.mjs'
import { createScriptedRuntime } from '../server/crew/runtimes/scripted.mjs'
import { begin } from './support/runtime-contract.mjs'

const base = { WORLDS_DATABASE_URL: 'postgres://u:p@db:5432/worlds', WORLDS_DATA_DIR: '/var/lib/worlds' }
const input = (text, more = {}) => ({
  agent: { id: 'a1', name: 'Ada', role: '' },
  folder: '/var/lib/worlds/workspaces/w1',
  text,
  handle: null,
  autonomy: 'autonomous',
  ...more,
})
/** The demonstration, with its pauses taken out so a test does not sit through them. */
const quick = () => createScriptedRuntime((turn) => demoScript(turn, { pace: 0 }))

test('the demonstration is off unless it is asked for', () => {
  assert.equal(loadCrewConfig(base).demoRuntime, false)
  for (const on of ['1', 'true', ' TRUE ']) assert.equal(loadCrewConfig({ ...base, WORLDS_DEMO_RUNTIME: on }).demoRuntime, true, on)
  for (const off of ['', '0', 'no', 'false', 'yes please']) {
    assert.equal(loadCrewConfig({ ...base, WORLDS_DEMO_RUNTIME: off }).demoRuntime, false, off)
  }
})

test('a scripted runtime given a function plays what it returns, and echoes when it returns nothing', async () => {
  const runtime = createScriptedRuntime((turn) => (turn.text === 'hi' ? [{ type: 'text', text: `hello ${turn.agent.name}` }] : undefined))
  const scripted = begin(runtime, input('hi'))
  await scripted.until('finished')
  assert.deepEqual(scripted.types(), ['started', 'text', 'finished'])
  assert.equal(scripted.events[1].text, 'hello Ada')

  const echoed = begin(runtime, input('anything else'))
  await echoed.until('finished')
  assert.equal(echoed.events.find((event) => event.type === 'text').text, 'anything else')
})

test('in a demonstration every runtime an agent can be bound to is played by the one script', () => {
  const runtimes = createDemoRuntimes()
  assert.deepEqual(runtimes.available(), RUNTIMES)
  const first = runtimes.get(RUNTIMES[0])
  for (const id of RUNTIMES) assert.equal(runtimes.get(id), first)
  assert.equal(first.id, 'scripted')
})

test('an ordinary message is read, worked on and answered, in fragments', async () => {
  const played = begin(quick(), input('Tidy the README'))
  const finished = await played.until('finished')
  assert.deepEqual(played.types(), ['started', 'text', 'tool', 'tool', 'tool', 'tool', 'text', 'finished'])
  const said = played.events.filter((event) => event.type === 'text').at(-1).text
  const fragments = played.events.filter((event) => event.type === 'delta').map((event) => event.text)
  assert.ok(fragments.length > 3, 'the answer arrives a piece at a time')
  assert.ok(fragments.join('').endsWith(said), 'and the pieces are the answer')
  assert.ok(said.includes('Tidy the README'), 'which is about what was asked')
  assert.equal(typeof finished.durationMs, 'number')
})

test('a message that says question is answered with one, and waits for the reply', async () => {
  const played = begin(quick(), input('I have a question for you'))
  const asked = await played.until('question')
  assert.equal(asked.questions.length, 1)
  assert.ok(asked.questions[0].options.length >= 2)
  assert.equal(played.events.some((event) => event.type === 'finished'), false)
  played.turn.answer(asked.requestId, { text: asked.questions[0].options[0] })
  await played.until('finished')
  assert.ok(played.events.filter((event) => event.type === 'text').at(-1).text.includes(asked.questions[0].options[0]))
})

test('a message that says approve asks first, unless the agent is autonomous', async () => {
  const careful = begin(quick(), input('approve this', { autonomy: 'ask' }))
  const asked = await careful.until('approval')
  careful.turn.answer(asked.requestId, { allow: false })
  await careful.until('finished')
  assert.equal(careful.events.some((event) => event.type === 'tool'), false, 'refused, so nothing was run')

  const allowed = begin(quick(), input('approve this', { autonomy: 'ask' }))
  allowed.turn.answer((await allowed.until('approval')).requestId, { allow: true })
  await allowed.until('finished')
  assert.equal(allowed.events.some((event) => event.type === 'tool'), true)

  const free = begin(quick(), input('approve this'))
  await free.until('finished')
  assert.equal(free.events.some((event) => event.type === 'approval'), false)
  assert.equal(free.events.some((event) => event.type === 'tool'), true)
})

test('a message that says fail fails, and one that says long can be stopped', async () => {
  const failing = begin(quick(), input('please fail'))
  assert.equal((await failing.until('failed')).code, 'crashed')

  const long = begin(createScriptedRuntime(demoScript), input('a long one'))
  await long.until('text')
  long.turn.interrupt()
  await long.until('interrupted')
})
