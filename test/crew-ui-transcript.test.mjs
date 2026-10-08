// test/crew-ui-transcript.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { answerLabel, openRequest, transcript } from '../src/crew/transcript.js'

let next = 0
const ev = (type, data = {}, status = 'working') => ({ seq: ++next, conversationId: 'c', agentId: 'a', type, status, at: '2026-10-08T12:00:00.000Z', data })
/** Items without their sequence numbers, which most tests do not care about. */
const plain = (items) => items.map(({ seq, ...rest }) => rest)

test('a message and its reply', () => {
  const items = transcript([ev('message', { text: 'Tidy the README' }), ev('text', { text: 'On it.' }), ev('finished', { text: 'On it.' }, 'idle')])
  assert.deepEqual(plain(items), [
    { kind: 'message', text: 'Tidy the README', state: 'sent' },
    { kind: 'text', text: 'On it.' },
    { kind: 'ending', type: 'finished', note: 'finished' },
  ])
})

test('a tool call is one line from when it started, whatever came between', () => {
  const items = transcript([
    ev('message', { text: 'go' }),
    ev('tool', { id: 't1', name: 'Bash', summary: 'Bash: npm test', status: 'started' }),
    ev('text', { text: 'Running the tests.' }),
    ev('tool', { id: 't2', name: 'Read', summary: 'Read: a.js', status: 'started' }),
    ev('tool', { id: 't1', name: 'Bash', summary: 'Bash: npm test', status: 'finished', output: '12 passed' }),
    ev('tool', { id: 't2', name: 'Read', summary: 'Read: a.js', status: 'failed', output: 'no such file' }),
  ])
  assert.deepEqual(plain(items).slice(1), [
    { kind: 'tool', id: 't1', name: 'Bash', summary: 'Bash: npm test', state: 'done', output: '12 passed' },
    { kind: 'text', text: 'Running the tests.' },
    { kind: 'tool', id: 't2', name: 'Read', summary: 'Read: a.js', state: 'failed', output: 'no such file' },
  ])
})

test('a tool still running is running, and one the turn ended on was stopped', () => {
  const started = [ev('message', { text: 'go' }), ev('tool', { id: 't1', name: 'Bash', summary: 'Bash: sleep', status: 'started' })]
  assert.equal(transcript(started)[1].state, 'running')
  assert.equal(transcript([...started, ev('interrupted', {}, 'idle')])[1].state, 'stopped')
})

test('a tool id used again in a later turn is a new line', () => {
  const items = transcript([
    ev('message', { text: 'one' }),
    ev('tool', { id: 'read', name: 'Read', summary: 'Read: a', status: 'started' }),
    ev('tool', { id: 'read', name: 'Read', summary: 'Read: a', status: 'finished' }),
    ev('finished', { text: '' }, 'idle'),
    ev('message', { text: 'two' }),
    ev('tool', { id: 'read', name: 'Read', summary: 'Read: b', status: 'started' }),
  ])
  assert.deepEqual(items.filter((item) => item.kind === 'tool').map((item) => [item.summary, item.state]), [['Read: a', 'done'], ['Read: b', 'running']])
})

test('a tool that only ever reported its end still gets its line', () => {
  const items = transcript([ev('tool', { id: 't9', name: 'Edit', summary: 'Edit: a', status: 'finished' })])
  assert.deepEqual(plain(items), [{ kind: 'tool', id: 't9', name: 'Edit', summary: 'Edit: a', state: 'done' }])
})

test('a very large tool output is cut, and says by how much', () => {
  const output = 'x'.repeat(50_000)
  const [item] = transcript([ev('tool', { id: 't1', name: 'Bash', summary: 'cat', status: 'finished', output })])
  assert.ok(item.output.length < 21_000)
  assert.match(item.output, /30,?000 more characters/)
})

test('a queued message waits where it was said, and moves to after the turn once delivered', () => {
  const first = ev('message', { text: 'slow' })
  const queued = ev('message', { text: 'and this', queued: true })
  const waiting = transcript([first, queued])
  assert.deepEqual(plain(waiting), [
    { kind: 'message', text: 'slow', state: 'sent' },
    { kind: 'message', text: 'and this', state: 'queued' },
  ])

  const done = ev('finished', { text: '' }, 'idle')
  const delivered = transcript([first, queued, done, ev('queue', { of: [queued.seq], outcome: 'delivered' }), ev('text', { text: 'Both done.' })])
  assert.deepEqual(plain(delivered), [
    { kind: 'message', text: 'slow', state: 'sent' },
    { kind: 'ending', type: 'finished', note: 'finished' },
    { kind: 'message', text: 'and this', state: 'sent' },
    { kind: 'text', text: 'Both done.' },
  ])
})

test('a queued message that was cancelled stays where it was said, marked', () => {
  const long = ev('message', { text: 'long' })
  const queued = ev('message', { text: 'never mind', queued: true })
  const items = transcript([long, queued, ev('interrupted', {}, 'idle'), ev('queue', { of: [queued.seq], outcome: 'cancelled' }, 'idle')])
  assert.deepEqual(plain(items), [
    { kind: 'message', text: 'long', state: 'sent' },
    { kind: 'message', text: 'never mind', state: 'cancelled' },
    { kind: 'ending', type: 'interrupted', note: 'stopped' },
  ])
})

test('an approval is open until it is answered, and then says how', () => {
  const asked = [ev('message', { text: 'clean up' }), ev('approval', { requestId: 'r1', tool: 'Bash', summary: 'rm -rf build' }, 'waiting')]
  const open = transcript(asked)
  assert.deepEqual(plain(open)[1], { kind: 'request', type: 'approval', requestId: 'r1', state: 'open', tool: 'Bash', summary: 'rm -rf build' })
  assert.equal(openRequest(open).requestId, 'r1')

  const allowed = transcript([...asked, ev('answer', { requestId: 'r1', allow: true })])
  assert.equal(allowed[1].state, 'answered')
  assert.equal(answerLabel(allowed[1]), 'allowed')
  assert.equal(openRequest(allowed), null)

  const refused = transcript([...asked, ev('answer', { requestId: 'r1', allow: false, message: 'Keep dist' })])
  assert.equal(answerLabel(refused[1]), 'refused: Keep dist')
})

test('a question carries what was asked, and then what was answered', () => {
  const questions = [{ question: 'Which colour?', options: ['Red', 'Blue'] }, { question: 'Why?', options: [] }]
  const asked = [ev('question', { requestId: 'q1', questions }, 'waiting')]
  assert.deepEqual(transcript(asked)[0].questions, questions)
  const answered = transcript([...asked, ev('answer', { requestId: 'q1', answers: ['Blue', 'It is calm'] })])
  assert.equal(answerLabel(answered[0]), 'Blue · It is calm')
  const said = transcript([...asked, ev('answer', { requestId: 'q1', text: 'Green' })])
  assert.equal(answerLabel(said[0]), 'Green')
})

test('a request the turn ended on was never answered, and is no longer open', () => {
  const items = transcript([ev('question', { requestId: 'q1', questions: [{ question: 'Which?', options: [] }] }, 'waiting'), ev('interrupted', {}, 'idle')])
  assert.equal(items[0].state, 'lapsed')
  assert.equal(openRequest(items), null)
})

test('the earliest open request is the one to answer', () => {
  const items = transcript([
    ev('approval', { requestId: 'r1', tool: 'Bash', summary: 'a' }, 'waiting'),
    ev('approval', { requestId: 'r2', tool: 'Bash', summary: 'b' }, 'waiting'),
    ev('answer', { requestId: 'r1', allow: true }, 'waiting'),
  ])
  assert.equal(openRequest(items).requestId, 'r2')
})

test('each ending says what happened', () => {
  const note = (type, data) => transcript([ev('message', { text: 'x' }), ev(type, data, 'idle')])[1].note
  assert.equal(note('finished', { text: '', durationMs: 12_400, costUsd: 0.0234 }), 'finished · 12s · $0.02')
  assert.equal(note('finished', { text: '', durationMs: 400 }), 'finished · under 1s')
  assert.equal(note('finished', { text: '', durationMs: 125_000, costUsd: 0 }), 'finished · 2m 5s')
  assert.equal(note('finished', { text: '', costUsd: 1.5 }), 'finished · $1.50')
  assert.equal(note('failed', { reason: 'The model is out of credit', code: 'inference' }), 'failed: The model is out of credit')
  assert.equal(note('interrupted', {}), 'stopped')
  assert.equal(note('interrupted', { reason: 'restart' }), 'interrupted when the server restarted')
  assert.equal(note('interrupted', { reason: 'lost' }), 'interrupted: the server lost track of this turn')
})

test('only the last ending offers to try again, and only when the turn did not finish', () => {
  const failed = [ev('message', { text: 'first' }), ev('failed', { reason: 'boom', code: 'crashed' }, 'failed')]
  assert.equal(transcript(failed).at(-1).retry, 'first')
  assert.equal(transcript([ev('message', { text: 'x' }), ev('interrupted', { reason: 'restart' }, 'idle')]).at(-1).retry, 'x')
  assert.equal(transcript([ev('message', { text: 'x' }), ev('interrupted', {}, 'idle')]).at(-1).retry, undefined, 'a stop was the person\'s own')
  assert.equal(transcript([ev('message', { text: 'x' }), ev('finished', { text: '' }, 'idle')]).at(-1).retry, undefined)

  const moved = transcript([...failed, ev('message', { text: 'second' }), ev('text', { text: 'ok' })])
  assert.equal(moved.find((item) => item.kind === 'ending').retry, undefined, 'the conversation has moved on')
})

test('a retry sends everything that was said in the turn that failed', () => {
  const before = [ev('message', { text: 'old' }), ev('finished', { text: '' }, 'idle'), ev('message', { text: 'a' })]
  const queued = ev('message', { text: 'and b', queued: true })
  const items = transcript([
    ...before, queued, ev('failed', { reason: 'boom', code: 'crashed' }, 'failed'),
    ev('queue', { of: [queued.seq], outcome: 'cancelled' }, 'failed'),
  ])
  assert.equal(items.findLast((item) => item.kind === 'ending').retry, 'a\n\nand b')
})

test('text still arriving is the last thing shown', () => {
  const items = transcript([ev('message', { text: 'x' })], { draft: 'Hel' })
  assert.deepEqual(plain(items).at(-1), { kind: 'draft', text: 'Hel' })
  assert.equal(transcript([ev('message', { text: 'x' })], { draft: '' }).length, 1)
})

test('events out of order, or given twice, come out the same', () => {
  const events = [
    ev('message', { text: 'go' }), ev('tool', { id: 't1', name: 'Bash', summary: 'ls', status: 'started' }),
    ev('tool', { id: 't1', name: 'Bash', summary: 'ls', status: 'finished' }), ev('text', { text: 'Done.' }), ev('finished', { text: 'Done.' }, 'idle'),
  ]
  const straight = transcript(events)
  assert.deepEqual(transcript([...events].reverse()), straight)
  assert.deepEqual(transcript([...events, ...events]), straight)
})

test('an event of a kind this page does not know is passed over', () => {
  assert.deepEqual(transcript([ev('message', { text: 'x' }), ev('hologram', { text: '?' }), { nonsense: true }, null]).length, 1)
})

test('a task taken from the crew channel says so on the message that began it', () => {
  const items = transcript([ev('message', { text: 'Fix the footer', postId: 'p1' }), ev('message', { text: 'and the header' })])
  assert.deepEqual(plain(items), [
    { kind: 'message', text: 'Fix the footer', state: 'sent', fromChannel: true },
    { kind: 'message', text: 'and the header', state: 'sent' },
  ])
})
