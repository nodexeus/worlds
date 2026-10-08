/**
 * The Claude Code adapter's reading of the CLI's output, line by line.
 *
 * The lines here are in the shapes the real CLI (2.1.293) wrote on 2026-10-08, cut down to
 * the fields that matter. The live check (`npm run test:crew:live`) is what notices if a
 * later CLI changes them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createParser } from '../server/crew/runtimes/claude-code/parse.mjs'
import { checkEvent } from '../server/crew/runtimes/contract.mjs'

const SID = '9b5d14a5-d857-40ba-a8a2-38c2ead2899d'
const line = (object) => JSON.stringify(object)
const init = line({ type: 'system', subtype: 'init', session_id: SID, cwd: '/w', model: 'claude-haiku-5-5', permissionMode: 'manual', tools: [] })
const assistant = (...content) => line({ type: 'assistant', session_id: SID, message: { role: 'assistant', content } })
const toolResult = (id, content, is_error = false) =>
  line({ type: 'user', session_id: SID, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })
const result = (more = {}) =>
  line({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.0088, duration_ms: 3019, session_id: SID, permission_denials: [], ...more })
const canUse = (requestId, tool_name, input, more = {}) =>
  line({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name, input, ...more } })

/** Feed lines to a fresh parser and return every event, each checked against the contract. */
function read(...lines) {
  const parser = createParser()
  const events = lines.flatMap((l) => parser.feed(l))
  for (const event of events) checkEvent(event)
  return { parser, events }
}

test('the init line starts the turn with the session id as its handle, once', () => {
  assert.deepEqual(read(init).events, [{ type: 'started', handle: SID }])
  assert.deepEqual(read(init, init).events.length, 1)
})

test('hooks, status, rate limits, thinking and anything unknown say nothing', () => {
  const quiet = [
    line({ type: 'system', subtype: 'hook_started', hook_name: 'x', session_id: SID }),
    line({ type: 'system', subtype: 'hook_response', stdout: 'noise', session_id: SID }),
    line({ type: 'system', subtype: 'status', status: 'requesting' }),
    line({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 12 }),
    line({ type: 'system', subtype: 'commands_changed', commands: [] }),
    line({ type: 'rate_limit_event', rate_limit_info: {} }),
    line({ type: 'something_new', payload: 1 }),
    assistant({ type: 'thinking', thinking: '', signature: 'abc' }),
    'not json at all',
    '',
    '   ',
    '{"type":',
    'null',
    '[]',
  ]
  assert.deepEqual(read(init, ...quiet).events, [{ type: 'started', handle: SID }])
})

test('text arrives in fragments as it is written, and then whole', () => {
  const delta = (text) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
  const other = line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } } })
  const start = line({ type: 'stream_event', event: { type: 'message_start', message: {} } })
  const { events } = read(init, start, delta('fin'), other, delta('ished'), assistant({ type: 'text', text: 'finished' }))
  assert.deepEqual(events.slice(1), [
    { type: 'delta', text: 'fin' },
    { type: 'delta', text: 'ished' },
    { type: 'text', text: 'finished' },
  ])
})

test('two pieces of text in one message are two events, and an empty one is none', () => {
  const { events } = read(init, assistant({ type: 'text', text: 'one' }, { type: 'text', text: '' }, { type: 'text', text: 'two' }))
  assert.deepEqual(events.slice(1).map((e) => e.text), ['one', 'two'])
})

test('a tool is started when it is called and finished when its result comes back', () => {
  const { events } = read(
    init,
    assistant({ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo second > second.txt', description: 'Write second' } }),
    toolResult('toolu_1', '(Bash completed with no output)')
  )
  assert.deepEqual(events.slice(1), [
    { type: 'tool', id: 'toolu_1', name: 'run', summary: 'echo second > second.txt', status: 'started' },
    { type: 'tool', id: 'toolu_1', name: 'run', summary: 'echo second > second.txt', status: 'finished', output: '(Bash completed with no output)' },
  ])
})

test('a tool is summed up by the most telling thing it was given', () => {
  const summary = (name, input) => read(init, assistant({ type: 'tool_use', id: 't', name, input })).events[1].summary
  assert.equal(summary('Write', { file_path: '/w/hello.txt', content: 'hi' }), '/w/hello.txt')
  assert.equal(summary('Grep', { pattern: 'TODO', path: 'src' }), 'TODO')
  assert.equal(summary('WebFetch', { url: 'https://example.com', prompt: 'read' }), 'https://example.com')
  assert.equal(summary('Task', { description: 'Find the bug', prompt: 'long' }), 'Find the bug')
  assert.equal(summary('Mystery', {}), '')
  assert.equal(summary('Mystery', { count: 3 }), '')
  assert.equal(summary('Bash', { command: 'x'.repeat(500) }).length, 160)
  assert.equal(summary('Bash', { command: 'one\ntwo\n  three' }), 'one two three')
})

test('a tool that errors is failed, and a long result is cut', () => {
  const { events } = read(
    init,
    assistant({ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'false' } }, { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: '/w/big' } }),
    toolResult('a', 'exit 1', true),
    toolResult('b', [{ type: 'text', text: 'y'.repeat(5000) }, { type: 'text', text: 'tail' }])
  )
  const [failed, cut] = events.slice(3)
  assert.deepEqual([failed.id, failed.status, failed.output], ['a', 'failed', 'exit 1'])
  assert.deepEqual([cut.id, cut.status, cut.output.length], ['b', 'finished', 2000])
})

test('a result for a tool nobody saw called is ignored', () => {
  assert.equal(read(init, toolResult('ghost', 'boo')).events.length, 1)
})

test('a permission request is an approval, described by what it wants to do', () => {
  const { events } = read(
    init,
    canUse('req-1', 'Bash', { command: 'rm -rf build', description: 'Remove the build folder' }, { description: 'Remove the build folder' }),
    canUse('req-2', 'Write', { file_path: '/etc/hosts', content: 'x' })
  )
  assert.deepEqual(events.slice(1), [
    { type: 'approval', requestId: 'req-1', tool: 'run', summary: 'rm -rf build' },
    { type: 'approval', requestId: 'req-2', tool: 'edit', summary: '/etc/hosts' },
  ])
})

test('the question tool is a question, with its options by label', () => {
  const input = {
    questions: [
      { question: 'Which colour?', header: 'Colour', options: [{ label: 'Blue', description: 'Calm' }, { label: 'Red', description: 'Loud' }], multiSelect: false },
      { question: 'Why?', header: 'Reason', options: [] },
    ],
  }
  assert.deepEqual(read(init, canUse('req-q', 'AskUserQuestion', input)).events[1], {
    type: 'question',
    requestId: 'req-q',
    questions: [{ question: 'Which colour?', options: ['Blue', 'Red'] }, { question: 'Why?', options: [] }],
  })
})

test('a question tool call with no usable questions is treated as an approval, not dropped', () => {
  const { events } = read(init, canUse('req-x', 'AskUserQuestion', { questions: [] }))
  assert.equal(events[1].type, 'approval')
})

test('other control requests are not the person\'s business, and are answered so the CLI does not wait', () => {
  const other = line({ type: 'control_request', request_id: 'r-hook', request: { subtype: 'hook_callback' } })
  const { events, parser } = read(init, other)
  assert.equal(events.length, 1)
  const replies = parser.takeReplies().map((reply) => JSON.parse(reply))
  assert.deepEqual(replies.map((r) => [r.type, r.response.subtype, r.response.request_id]), [['control_response', 'error', 'r-hook']])
  assert.deepEqual(parser.takeReplies(), [], 'taken once')
})

test('a single text answers a single question', () => {
  const ask = { questions: [{ question: 'Why?', options: [] }] }
  const { parser } = read(init, canUse('req-q', 'AskUserQuestion', ask))
  assert.deepEqual(JSON.parse(parser.answerLine('req-q', { text: 'Because.' })).response.response.updatedInput.answers, { 'Why?': 'Because.' })
})

test('a question says when more than one option may be chosen', () => {
  const ask = { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }] }
  assert.equal(read(init, canUse('req-q', 'AskUserQuestion', ask)).events[1].questions[0].multiple, true)
})

test('a tool call or a request with no id or name is ignored, not passed on broken', () => {
  const { events } = read(
    init,
    assistant({ type: 'tool_use', id: '', name: 'Bash', input: {} }, { type: 'tool_use', id: 't', name: '', input: {} }),
    canUse('', 'Bash', { command: 'x' }),
    canUse('req', '', { command: 'x' })
  )
  assert.equal(events.length, 1)
})

test('a failure is classed by what the API said, not by words that happen to be in it', () => {
  const code = (text, more = {}) => read(init, result({ is_error: true, subtype: 'error_during_execution', result: text, ...more })).events.at(-1).code
  for (const text of [
    'Tests failed: the login page did not render', 'Could not parse credentials.json in the workspace',
    'could not find the api key column in schema.sql', 'Error: the file has 500 lines', 'API Error: 400 max_tokens: 512 is below the minimum',
    'The accredited list could not be loaded', 'Budget of $500 exceeded',
  ]) assert.equal(code(text), 'runtime', text)
  for (const text of [
    'API Error: 403 Your credit balance is too low', 'API Error: 529 Overloaded. If this persists, check your login',
    'Claude usage limit reached. Resets at 5pm', 'You\'ve hit your session limit', 'Connection error.',
    'getaddrinfo ENOTFOUND gateway.internal', 'Request timed out', 'connect ECONNREFUSED 127.0.0.1:4000',
  ]) assert.equal(code(text), 'inference', text)
  for (const text of ['Not logged in · Please run /login', 'Invalid API key', 'API Error: 401 authentication_error', 'OAuth token has expired']) {
    assert.equal(code(text), 'auth', text)
  }
  assert.equal(code('x', { api_error_status: '503' }), 'inference')
  assert.equal(code('x', { api_error_status: 401 }), 'auth')
})

test('answers are written back in the form the CLI waits for', () => {
  const bash = { command: 'rm -rf build' }
  const ask = { questions: [{ question: 'Which colour?', options: [{ label: 'Blue' }] }, { question: 'Why?', options: [] }] }
  const { parser } = read(init, canUse('req-1', 'Bash', bash), canUse('req-2', 'Bash', bash), canUse('req-q', 'AskUserQuestion', ask))
  const reply = (id, answer) => JSON.parse(parser.answerLine(id, answer))

  assert.deepEqual(reply('req-1', { allow: true }), {
    type: 'control_response',
    response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'allow', updatedInput: bash } },
  })
  assert.deepEqual(reply('req-2', { allow: false, message: 'Not today.' }).response.response, { behavior: 'deny', message: 'Not today.' })
  assert.deepEqual(reply('req-q', { answers: ['Blue', 'It is calm.'] }).response.response, {
    behavior: 'allow',
    updatedInput: { ...ask, answers: { 'Which colour?': 'Blue', 'Why?': 'It is calm.' } },
  })
  assert.equal(parser.answerLine('req-1', { allow: true }), null, 'a request is answered once')
  assert.equal(parser.answerLine('nope', { allow: true }), null)
})

test('an answer is one line whatever is in it', () => {
  const { parser } = read(init, canUse('req-1', 'Bash', { command: 'printf "a\nb"\u2028' }), canUse('req-2', 'Bash', { command: 'x' }))
  for (const written of [parser.answerLine('req-1', { allow: true }), parser.answerLine('req-2', { allow: false, message: 'no\n{"type":"control_response"}\u2029' })]) {
    assert.ok(written.length > 20)
    assert.ok(!/[\n\r\u2028\u2029]/.test(written), written)
    assert.doesNotThrow(() => JSON.parse(written))
  }
})

test('a refusal with no reason still gives the agent one', () => {
  const { parser } = read(init, canUse('req-1', 'Bash', { command: 'x' }))
  assert.match(JSON.parse(parser.answerLine('req-1', { allow: false })).response.response.message, /declined/)
})

test('the result line finishes the turn, with what it cost', () => {
  const { events, parser } = read(init, assistant({ type: 'text', text: 'done' }), result())
  assert.deepEqual(events.at(-1), { type: 'finished', text: 'done', costUsd: 0.0088, durationMs: 3019 })
  assert.equal(parser.finished, true)
})

test('a model that says nothing still finishes', () => {
  assert.deepEqual(read(init, result({ result: '', total_cost_usd: undefined, duration_ms: undefined })).events.at(-1), { type: 'finished', text: '' })
  assert.deepEqual(read(init, result({ result: null })).events.at(-1).text, '')
})

test('a result that is an error fails the turn, and says which kind', () => {
  const failed = (more) => read(init, result({ is_error: true, subtype: 'error_during_execution', ...more })).events.at(-1)
  assert.deepEqual(failed({ result: 'Invalid API key · Please run /login' }), { type: 'failed', reason: 'This agent is not signed in on this server', code: 'auth', detail: 'Invalid API key · Please run /login' })
  assert.equal(failed({ result: 'Claude usage limit reached' }).reason, 'This agent could not get an answer: a limit was reached or the service is busy')
  assert.equal(failed({ result: 'API Error: 401 authentication_error' }).code, 'auth')
  assert.equal(failed({ result: 'API Error: 429 rate_limit_error' }).code, 'inference')
  assert.equal(failed({ result: 'API Error: 529 Overloaded' }).code, 'inference')
  assert.equal(failed({ result: 'Credit balance is too low' }).code, 'inference')
  assert.equal(failed({ result: 'x', api_error_status: 503 }).code, 'inference')
  assert.equal(failed({ result: 'Something else went wrong' }).code, 'runtime')
  assert.deepEqual([failed({ result: '' }).reason, failed({ result: '' }).detail], ['This agent could not finish what it was doing', 'The turn ended with an error (error_during_execution)'])
  assert.equal(read(init, result({ subtype: 'error_max_turns', is_error: false, result: 'x' })).events.at(-1).type, 'failed')
})

test('nothing is read after the result', () => {
  const { events } = read(init, result(), assistant({ type: 'text', text: 'late' }), result())
  assert.deepEqual(events.map((e) => e.type), ['started', 'finished'])
})

test('a result with no init before it still starts the turn first', () => {
  assert.deepEqual(read(result()).events.map((e) => [e.type, e.handle]), [['started', SID], ['finished', undefined]])
})

test('a tool is named for what it does, never by what the CLI calls it', () => {
  const kinds = { Read: 'read', Write: 'edit', Edit: 'edit', NotebookEdit: 'edit', Bash: 'run', Grep: 'search', Glob: 'search', WebFetch: 'fetch', WebSearch: 'fetch', TodoWrite: 'plan', Task: 'plan', mcp__linear__save_issue: 'tool', SomethingNew: 'tool' }
  for (const [name, kind] of Object.entries(kinds)) {
    const { events } = read(init, assistant({ type: 'tool_use', id: 't', name, input: {} }), canUse('r', name, {}))
    assert.deepEqual([events.find((e) => e.type === 'tool').name, events.find((e) => e.type === 'approval').tool], [kind, kind], name)
  }
})
