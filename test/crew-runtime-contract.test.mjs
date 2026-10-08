import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTONOMY, ENDINGS, checkEvent, checkTurnInput, turnController } from '../server/crew/runtimes/contract.mjs'
import { CrewError } from '../server/crew/errors.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code
const input = (more = {}) => ({
  agent: { id: 'a1', name: 'Ada', role: '' },
  folder: '/var/lib/worlds/workspaces/w1',
  text: 'hello',
  handle: null,
  autonomy: 'autonomous',
  onEvent() {},
  ...more,
})

test('there are three levels of autonomy and three ways a turn ends', () => {
  assert.deepEqual(AUTONOMY, ['ask', 'workspace', 'autonomous'])
  assert.deepEqual(ENDINGS, ['finished', 'failed', 'interrupted'])
})

test('a turn that makes sense is accepted as it is', () => {
  const good = input()
  assert.equal(checkTurnInput(good), good)
  assert.equal(checkTurnInput(input({ handle: 'abc' })).handle, 'abc')
})

test('a turn that does not make sense is refused before anything runs', () => {
  const bad = [
    { agent: null }, { agent: { id: 'a', name: 7 } }, { agent: { id: '', name: 'Ada' } },
    { folder: 'relative/path' }, { folder: '' }, { folder: 42 },
    { text: '' }, { text: '   ' }, { text: 7 }, { text: 'x'.repeat(100_001) },
    { handle: '' }, { handle: 7 }, { handle: undefined },
    { autonomy: 'reckless' }, { autonomy: undefined },
    { onEvent: null },
  ]
  for (const more of bad) assert.throws(() => checkTurnInput(input(more)), refused('bad_turn'), JSON.stringify(more))
  assert.throws(() => checkTurnInput(null), refused('bad_turn'))
})

test('every kind of event is accepted in its proper shape', () => {
  const good = [
    { type: 'started', handle: 'h1' },
    { type: 'started', handle: null },
    { type: 'delta', text: 'he' },
    { type: 'text', text: 'hello' },
    { type: 'tool', id: 't1', name: 'Bash', summary: 'ls', status: 'started' },
    { type: 'tool', id: 't1', name: 'Bash', summary: 'ls', status: 'finished', output: 'a\nb' },
    { type: 'tool', id: 't1', name: 'Bash', summary: 'ls', status: 'failed' },
    { type: 'approval', requestId: 'r1', tool: 'Bash', summary: 'rm -rf build' },
    { type: 'question', requestId: 'r2', questions: [{ question: 'Which?', options: ['A', 'B'] }] },
    { type: 'question', requestId: 'r2', questions: [{ question: 'Why?', options: [] }] },
    { type: 'finished', text: '' },
    { type: 'finished', text: 'done', costUsd: 0.01, durationMs: 900 },
    { type: 'failed', reason: 'Not signed in', code: 'auth' },
    { type: 'interrupted' },
  ]
  for (const event of good) assert.equal(checkEvent(event), event)
})

test('a malformed event is named for what is wrong with it', () => {
  const bad = [
    [null, /event/], [{}, /type/], [{ type: 'dance' }, /type/],
    [{ type: 'started' }, /handle/], [{ type: 'started', handle: 7 }, /handle/],
    [{ type: 'delta' }, /text/], [{ type: 'text', text: 7 }, /text/],
    [{ type: 'tool', id: 't', name: 'Bash', summary: 's', status: 'maybe' }, /status/],
    [{ type: 'tool', id: '', name: 'Bash', summary: 's', status: 'started' }, /id/],
    [{ type: 'tool', id: 't', name: 'Bash', summary: 's', status: 'finished', output: 7 }, /output/],
    [{ type: 'approval', tool: 'Bash', summary: 's' }, /requestId/],
    [{ type: 'approval', requestId: 'r', tool: 'Bash' }, /summary/],
    [{ type: 'question', requestId: 'r', questions: [] }, /questions/],
    [{ type: 'question', requestId: 'r', questions: [{ question: 'Q', options: [7] }] }, /options/],
    [{ type: 'finished' }, /text/], [{ type: 'finished', text: 'x', costUsd: 'free' }, /costUsd/],
    [{ type: 'failed', reason: 'x', code: 'weird' }, /code/], [{ type: 'failed', code: 'auth' }, /reason/],
  ]
  for (const [event, what] of bad) assert.throws(() => checkEvent(event), what, JSON.stringify(event))
})

/** A controller that records what its listener was given. */
const recording = (onEvent) => {
  const seen = []
  const logged = []
  const turn = turnController((event) => { seen.push(event); onEvent?.(event) }, { log: (...args) => logged.push(args) })
  return { turn, seen, logged }
}

test('a turn starts, says things, and ends once with its handle', async () => {
  const { turn, seen } = recording()
  turn.emit({ type: 'started', handle: 'h1' })
  turn.emit({ type: 'text', text: 'hi' })
  assert.equal(turn.ended, false)
  turn.end({ type: 'finished', text: 'hi' })
  assert.equal(turn.ended, true)
  assert.deepEqual(await turn.done, { handle: 'h1', outcome: 'finished' })
  assert.deepEqual(seen.map((e) => e.type), ['started', 'text', 'finished'])
})

test('nothing follows the end, and a second end changes nothing', async () => {
  const { turn, seen } = recording()
  turn.emit({ type: 'started', handle: 'h1' })
  turn.end({ type: 'interrupted' })
  turn.emit({ type: 'text', text: 'too late' })
  turn.end({ type: 'finished', text: 'no' })
  turn.end({ type: 'failed', reason: 'no', code: 'runtime' })
  assert.deepEqual(seen.map((e) => e.type), ['started', 'interrupted'])
  assert.deepEqual(await turn.done, { handle: 'h1', outcome: 'interrupted' })
})

test('a turn may fail before it ever starts, and then has no handle', async () => {
  const { turn, seen } = recording()
  turn.end({ type: 'failed', reason: 'claude is not installed', code: 'runtime' })
  assert.deepEqual(seen, [{ type: 'failed', reason: 'claude is not installed', code: 'runtime' }])
  assert.deepEqual(await turn.done, { handle: null, outcome: 'failed' })
})

test('an adapter that speaks before starting, or sends nonsense, fails the turn and says so', async () => {
  const early = recording()
  early.turn.emit({ type: 'text', text: 'hi' })
  assert.deepEqual(early.seen.map((e) => [e.type, e.code]), [['failed', 'runtime']])
  assert.match(early.seen[0].reason, /before/)

  const nonsense = recording()
  nonsense.turn.emit({ type: 'started', handle: 'h' })
  nonsense.turn.emit({ type: 'tool', id: 't', name: 'Bash', summary: 's', status: 'maybe' })
  assert.deepEqual(nonsense.seen.map((e) => e.type), ['started', 'failed'])
  assert.deepEqual(await nonsense.turn.done, { handle: 'h', outcome: 'failed' })

  const ending = recording()
  ending.turn.emit({ type: 'started', handle: 'h' })
  ending.turn.emit({ type: 'finished', text: 'smuggled through emit' })
  assert.deepEqual(ending.seen.map((e) => [e.type, e.code]), [['started', undefined], ['failed', 'runtime']])

  const wrongEnd = recording()
  wrongEnd.turn.emit({ type: 'started', handle: 'h' })
  wrongEnd.turn.end({ type: 'text', text: 'not an ending' })
  assert.deepEqual(wrongEnd.seen.map((e) => e.type), ['started', 'failed'])
})

test('a listener that throws does not break the turn', async () => {
  let calls = 0
  const { turn, logged } = recording(() => { calls++; throw new Error('listener bug') })
  turn.emit({ type: 'started', handle: 'h' })
  turn.emit({ type: 'text', text: 'hi' })
  turn.end({ type: 'finished', text: 'hi' })
  assert.equal(calls, 3)
  assert.equal(logged.length, 3)
  assert.deepEqual(await turn.done, { handle: 'h', outcome: 'finished' })
})

test('a request is open from when it is asked until it is answered or the turn ends', () => {
  const { turn } = recording()
  turn.emit({ type: 'started', handle: 'h' })
  assert.equal(turn.isOpen('r1'), false)
  assert.throws(() => turn.settle('r1'), refused('unknown_request'))
  turn.emit({ type: 'approval', requestId: 'r1', tool: 'Bash', summary: 'rm' })
  turn.emit({ type: 'question', requestId: 'r2', questions: [{ question: 'Q', options: [] }] })
  assert.equal(turn.isOpen('r1') && turn.isOpen('r2'), true)
  assert.equal(turn.settle('r1'), 'approval')
  assert.throws(() => turn.settle('r1'), refused('unknown_request'), 'answered twice')
  turn.end({ type: 'interrupted' })
  assert.equal(turn.isOpen('r2'), false)
  assert.throws(() => turn.settle('r2'), refused('unknown_request'), 'answered after the end')
})

test('an answer has to fit what was asked', () => {
  const { turn } = recording()
  turn.emit({ type: 'started', handle: 'h' })
  turn.emit({ type: 'approval', requestId: 'r1', tool: 'Bash', summary: 'rm' })
  turn.emit({ type: 'question', requestId: 'r2', questions: [{ question: 'Q', options: [] }] })
  for (const bad of [null, {}, { allow: 'yes' }, { text: 'ok' }, { allow: false, message: 7 }]) {
    assert.throws(() => turn.settle('r1', bad), refused('bad_answer'), JSON.stringify(bad))
  }
  for (const bad of [null, {}, { allow: true }, { text: 7 }, { text: '  ' }]) {
    assert.throws(() => turn.settle('r2', bad), refused('bad_answer'), JSON.stringify(bad))
  }
  assert.equal(turn.isOpen('r1') && turn.isOpen('r2'), true, 'a refused answer leaves the request waiting')
  assert.equal(turn.settle('r1', { allow: false, message: 'no' }), 'approval')
  assert.equal(turn.settle('r2', { text: 'blue' }), 'question')
})

// ── the scripted runtime ─────────────────────────────────────────────────────────────────

import { createScriptedRuntime } from '../server/crew/runtimes/scripted.mjs'
import { begin, runtimeContract } from './support/runtime-contract.mjs'

const tool = (status, more = {}) => ({ type: 'tool', id: 't1', name: 'Bash', summary: 'echo hi', status, ...more })
const SCRIPTS = {
  'say hello': [{ type: 'delta', text: 'hel' }, { type: 'text', text: 'hello there' }, { type: 'finished', text: 'hello there' }],
  'use a tool': [tool('started'), tool('finished', { output: 'hi' }), { type: 'text', text: 'ran it' }, { type: 'finished', text: 'ran it' }],
  'ask first': [
    tool('started'),
    { type: 'approval', requestId: 'r1', tool: 'Bash', summary: 'echo hi' },
    { wait: 'r1', allow: [tool('finished', { output: 'hi' })], deny: [tool('failed', { output: 'denied' })] },
    { type: 'finished', text: 'ok' },
  ],
  'which one': [
    { type: 'question', requestId: 'q1', questions: [{ question: 'Which colour?', options: ['Blue', 'Red'] }] },
    { wait: 'q1' },
    { type: 'finished', text: 'thanks' },
  ],
  'take your time': [{ type: 'text', text: 'thinking' }, { pause: 60_000 }, { type: 'finished', text: 'late' }],
  'fall over': [{ crash: 'The model gateway is unreachable' }],
}

const scriptedSetup = () => {
  const runtime = createScriptedRuntime(SCRIPTS)
  return {
    runtime,
    say: { plain: 'say hello', tool: 'use a tool', approval: 'ask first', question: 'which one', slow: 'take your time', broken: 'fall over' },
    input: (more = {}) => input({ autonomy: 'autonomous', ...more }),
  }
}

runtimeContract('scripted runtime', scriptedSetup)

test('the scripted runtime records every turn and every answer it was given', async () => {
  const { runtime, input: make } = scriptedSetup()
  const { turn, until } = begin(runtime, make({ text: 'which one', agent: { id: 'a9', name: 'Bolt', role: 'Tester.' } }))
  const question = await until('question')
  turn.answer(question.requestId, { text: 'Blue' })
  await turn.done
  assert.equal(runtime.turns.length, 1)
  assert.equal(runtime.turns[0].agent.name, 'Bolt')
  assert.deepEqual(runtime.turns[0].answers, [{ requestId: 'q1', answer: { text: 'Blue' } }])
})

test('a message with no script is echoed back, and each new conversation gets its own handle', async () => {
  const { runtime, input: make } = scriptedSetup()
  const a = begin(runtime, make({ text: 'anything at all' }))
  const b = begin(runtime, make({ text: 'something else' }))
  const [first, second] = await Promise.all([a.turn.done, b.turn.done])
  assert.notEqual(first.handle, second.handle)
  assert.equal(a.events.at(-1).text, 'anything at all')
})

// ── the registry ─────────────────────────────────────────────────────────────────────────

import { createRuntimes } from '../server/crew/runtimes/index.mjs'
import { RUNTIMES } from '../server/crew/names.mjs'

test('the server has Claude Code, and the scripted runtime only when it is given scripts', () => {
  const plain = createRuntimes()
  assert.equal(plain.get('claude-code').id, 'claude-code')
  assert.throws(() => plain.get('scripted'), refused('runtime_unavailable'))
  assert.deepEqual(plain.available(), ['claude-code'])

  const testing = createRuntimes({ scripted: SCRIPTS })
  assert.equal(testing.get('scripted').id, 'scripted')
  assert.deepEqual(testing.available(), ['claude-code', 'scripted'])
})

test('a runtime an agent may be bound to but that has no adapter yet says so', () => {
  const runtimes = createRuntimes()
  for (const id of RUNTIMES.filter((id) => id !== 'claude-code')) {
    assert.throws(() => runtimes.get(id), (error) => refused('runtime_unavailable')(error) && error.status === 501 && error.message.includes(id))
  }
  assert.throws(() => runtimes.get('__proto__'), refused('runtime_unavailable'))
  assert.throws(() => runtimes.get(undefined), refused('runtime_unavailable'))
})

test('options for Claude Code reach its adapter', () => {
  const runtimes = createRuntimes({ claudeCode: { command: '/opt/claude', extraArgs: ['--model', 'haiku'] } })
  assert.equal(runtimes.get('claude-code').describe().resume, true)
})

// ── after review ─────────────────────────────────────────────────────────────────────────

test('several questions are answered one each, and a single text only fits a single question', () => {
  const { turn } = recording()
  turn.emit({ type: 'started', handle: 'h' })
  const two = [{ question: 'Which database?', options: [] }, { question: 'Deploy today?', options: ['Yes', 'No'], multiple: false }]
  turn.emit({ type: 'question', requestId: 'q2', questions: two })
  turn.emit({ type: 'question', requestId: 'q1', questions: [{ question: 'Why?', options: [] }] })
  for (const bad of [{ text: 'Postgres' }, { answers: ['Postgres'] }, { answers: ['a', 'b', 'c'] }, { answers: ['a', 7] }, { answers: ['a', ' '] }, { answers: 'a,b' }]) {
    assert.throws(() => turn.settle('q2', bad), refused('bad_answer'), JSON.stringify(bad))
  }
  assert.equal(turn.settle('q2', { answers: ['Postgres', 'No'] }), 'question')
  assert.equal(turn.settle('q1', { text: 'Because.' }), 'question')
})

test('a question may say that more than one option can be chosen, and nothing else may ride along', () => {
  assert.ok(checkEvent({ type: 'question', requestId: 'r', questions: [{ question: 'Q', options: ['a'], multiple: true }] }))
  assert.throws(() => checkEvent({ type: 'question', requestId: 'r', questions: [{ question: 'Q', options: [], multiple: 'yes' }] }), /multiple/)
})

test('an agent\'s role has to be text of a size that can be handed to a runtime', () => {
  for (const role of [7, null, {}, 'x'.repeat(32_001)]) {
    assert.throws(() => checkTurnInput(input({ agent: { id: 'a', name: 'Ada', role } })), refused('bad_turn'), String(role).slice(0, 20))
  }
  assert.ok(checkTurnInput(input({ agent: { id: 'a', name: 'Ada' } })), 'no role at all is fine')
})

test('the scripted runtime, like a real one, never stops an autonomous agent for approval', async () => {
  const { runtime, input: make } = scriptedSetup()
  const { turn, events } = begin(runtime, make({ text: 'ask first', autonomy: 'autonomous' }))
  assert.equal((await turn.done).outcome, 'finished')
  assert.ok(!events.some((event) => event.type === 'approval'))
  assert.equal(events.filter((event) => event.type === 'tool').at(-1).status, 'finished')
})
