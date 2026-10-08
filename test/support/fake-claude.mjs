#!/usr/bin/env node
/**
 * A stand-in for the `claude` executable, for testing the adapter without a model.
 *
 * It speaks the real CLI's wire format (see the runtimes plan): it reads one user message
 * from stdin, plays the scenario that message names, and where the scenario asks permission
 * it waits for the control response before going on. The session id comes from
 * `--session-id` or `--resume`, as the real one's does.
 */
import fs from 'node:fs'
import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const session = flag('--session-id') ?? flag('--resume') ?? 'no-session'
if (process.env.FAKE_CLAUDE_PIDFILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PIDFILE, String(process.pid))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const write = (object) => process.stdout.write(JSON.stringify(object) + '\n')
const init = () => write({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [] })
const say = (text) => write({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const use = (id, name, input) =>
  write({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const got = (id, content, is_error = false) =>
  write({ type: 'user', session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })
const result = (text, more = {}) =>
  write({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.001, duration_ms: 5, session_id: session, ...more })

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
// Note: this reader, like Node's readline, also breaks a line at U+2028 and U+2029. The
// adapter must therefore never write those raw, which the `echo:` scenario checks.
const next = async () => {
  const { value, done } = await lines.next()
  return done ? null : JSON.parse(value)
}
/** Ask to use a tool and wait to be told. */
const ask = async (requestId, tool_name, input) => {
  write({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name, input } })
  for (;;) {
    const reply = await next()
    if (!reply) process.exit(0)
    if (reply.type === 'control_response' && reply.response?.request_id === requestId) return reply.response.response
  }
}

const first = await next()
const text = first?.message?.content ?? ''

write({ type: 'system', subtype: 'hook_started', hook_name: 'noise', session_id: session })
init()

if (text === 'plain') {
  write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hel' } } })
  say('hello there')
  result('hello there')
} else if (text === 'tool') {
  use('toolu_1', 'Bash', { command: 'echo hi' })
  got('toolu_1', 'hi')
  say('ran it')
  result('ran it')
} else if (text === 'approval') {
  use('toolu_2', 'Bash', { command: 'rm -rf build' })
  const answer = await ask('req-1', 'Bash', { command: 'rm -rf build' })
  if (answer.behavior === 'allow') got('toolu_2', `ran ${answer.updatedInput.command}`)
  else got('toolu_2', answer.message, true)
  say('ok')
  result('ok')
} else if (text === 'question') {
  const input = { questions: [{ question: 'Which colour?', options: [{ label: 'Blue' }, { label: 'Red' }] }] }
  const answer = await ask('req-q', 'AskUserQuestion', input)
  say(`you said ${answer.updatedInput.answers['Which colour?']}`)
  result('thanks')
} else if (text === 'slow' || text === 'stubborn') {
  // `stubborn` ignores the polite signal, as a wedged process does.
  if (text === 'stubborn') process.on('SIGTERM', () => {})
  say('thinking')
  await sleep(60_000)
} else if (text === 'broken') {
  result('API Error: 529 Overloaded', { is_error: true, subtype: 'error_during_execution' })
} else if (text === 'crash') {
  say('about to fall over')
  process.stderr.write('warning: something minor\nfatal: the runtime fell over\n')
  process.exit(3)
} else if (text === 'silent-exit') {
  process.exit(0)
} else if (text === 'fragments') {
  // One line in three writes, then two lines in one write: a pipe promises nothing else.
  const one = JSON.stringify({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: 'in pieces' }] } })
  process.stdout.write(one.slice(0, 20))
  await sleep(15)
  process.stdout.write(one.slice(20, 55))
  await sleep(15)
  const two = JSON.stringify({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: 'together' }] } })
  const three = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: session })
  process.stdout.write(one.slice(55) + '\n' + two + '\n' + three + '\n')
} else if (text === 'grandchild' || text === 'holdpipe') {
  // A tool the agent started: a process of its own, which must not outlive the turn.
  const { spawn } = await import('node:child_process')
  const child = spawn('sleep', [text === 'holdpipe' ? '3' : '30'], { stdio: ['ignore', text === 'holdpipe' ? 'inherit' : 'ignore', 'ignore'] })
  fs.writeFileSync(process.env.FAKE_CLAUDE_PIDFILE + '.child', String(child.pid))
  say('started a child')
  if (text === 'holdpipe') process.exit(3)
  await sleep(60_000)
} else if (text === 'othercontrol') {
  write({ type: 'control_request', request_id: 'req-other', request: { subtype: 'mcp_message', server_name: 'x' } })
  for (;;) {
    const reply = await next()
    if (!reply) process.exit(0)
    if (reply.type === 'control_response' && reply.response?.request_id === 'req-other') break
  }
  say('carried on')
  result('carried on')
} else if (text === 'separators') {
  say('line\u2028separator and paragraph\u2029separator')
  result('ok')
} else if (text.startsWith('echo:')) {
  say(text)
  result('echoed')
} else if (text === 'longline') {
  process.stdout.write('x'.repeat(50_000))
  await sleep(60_000)
} else if (text === 'lingers') {
  result('done')
  await sleep(60_000)
} else {
  // `args`: say what it was run with, so a test can read the command line the adapter built.
  const secrets = Object.keys(process.env).filter((key) => /^WORLDS_|DATABASE_URL|^PG/.test(key))
  say(JSON.stringify({ argv, cwd: process.cwd(), marker: process.env.FAKE_CLAUDE_MARKER ?? null, secrets }))
  result('args')
}
