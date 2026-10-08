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
