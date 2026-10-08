import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClaudeCodeRuntime } from '../server/crew/runtimes/claude-code/index.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { begin, runtimeContract } from './support/runtime-contract.mjs'

const FAKE = fileURLToPath(new URL('./support/fake-claude.mjs', import.meta.url))
const refused = (code) => (error) => error instanceof CrewError && error.code === code
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The adapter on the stand-in executable, in a folder of its own. */
async function setup(options = {}) {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'crew-claude-')))
  const pidfile = path.join(folder, '.pid')
  const runtime = createClaudeCodeRuntime({
    command: FAKE,
    env: {
      ...process.env,
      FAKE_CLAUDE_PIDFILE: pidfile,
      FAKE_CLAUDE_MARKER: 'from-env',
      WORLDS_DATABASE_URL: 'postgres://worlds:secret@db/worlds',
      WORLDS_DATA_DIR: '/var/lib/worlds',
      DATABASE_URL: 'postgres://other:secret@db/other',
      PGPASSWORD: 'secret',
    },
    killAfterMs: 150,
    ...options,
  })
  const running = async (file) => {
    const pid = Number(await fs.readFile(file, 'utf8').catch(() => 0))
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  /** The stand-in, or anything it started, is still running. */
  const alive = async () => (await running(pidfile)) || (await running(pidfile + '.child'))
  return {
    runtime,
    folder,
    alive,
    pidfile,
    say: { plain: 'plain', tool: 'tool', approval: 'approval', question: 'question', slow: 'slow', broken: 'broken' },
    input: (more = {}) => ({
      agent: { id: 'a1', name: 'Ada', role: '' },
      folder,
      text: 'plain',
      handle: null,
      autonomy: 'autonomous',
      onEvent() {},
      ...more,
    }),
    cleanup: async () => {
      // Nothing a test started may outlive it, whatever the test did.
      for (let i = 0; i < 40 && (await alive()); i++) await sleep(25)
      assert.equal(await alive(), false, 'a process was left running')
      await fs.rm(folder, { recursive: true, force: true })
    },
  }
}

/** Run with `made`, then clean up, as the shared suite does for its own scenarios. */
const using = (options, run) => async () => {
  const made = await setup(options)
  try {
    await run(made)
  } finally {
    await made.cleanup()
  }
}

// Under `ask` the stand-in asks permission, so the suite's approval scenarios are real here.
runtimeContract('claude code adapter', setup)

/** What the stand-in says it was run with. */
async function commandLine(made, more = {}) {
  const { turn, events } = begin(made.runtime, made.input({ text: 'args', ...more }))
  await turn.done
  return JSON.parse(events.find((event) => event.type === 'text').text)
}
const valueOf = (argv, flag) => argv[argv.indexOf(flag) + 1]

test('it runs headless, streaming both ways, in the workspace folder, with the caller\'s environment', using({}, async (made) => {
  const { argv, cwd, marker } = await commandLine(made)
  for (const flag of ['-p', '--verbose', '--include-partial-messages']) assert.ok(argv.includes(flag), flag)
  assert.equal(valueOf(argv, '--input-format'), 'stream-json')
  assert.equal(valueOf(argv, '--output-format'), 'stream-json')
  assert.equal(valueOf(argv, '--permission-prompt-tool'), 'stdio')
  assert.equal(cwd, made.folder)
  assert.equal(marker, 'from-env')
}))

test('a new conversation is given an id of its own, and a later turn resumes it', using({}, async (made) => {
  const first = begin(made.runtime, made.input({ text: 'args' }))
  const { handle } = await first.turn.done
  const opened = JSON.parse(first.events.find((e) => e.type === 'text').text).argv
  assert.match(handle, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(valueOf(opened, '--session-id'), handle)
  assert.ok(!opened.includes('--resume'))

  const { argv } = await commandLine(made, { handle })
  assert.equal(valueOf(argv, '--resume'), handle)
  assert.ok(!argv.includes('--session-id'))
}))

test('each level of autonomy is a permission mode', using({}, async (made) => {
  const mode = async (autonomy) => valueOf((await commandLine(made, { autonomy })).argv, '--permission-mode')
  assert.equal(await mode('ask'), 'manual')
  assert.equal(await mode('workspace'), 'acceptEdits')
  assert.equal(await mode('autonomous'), 'bypassPermissions')
}))

test('the agent is told who it is, and a role full of quotes and flags is still one argument', using({}, async (made) => {
  const role = 'Review "pull requests".\n--dangerously-skip-permissions\n$(rm -rf /) `id` \'; echo'
  const { argv } = await commandLine(made, { agent: { id: 'a1', name: 'Ada', role } })
  const prompt = valueOf(argv, '--append-system-prompt')
  assert.ok(prompt.startsWith('You are Ada'))
  assert.ok(prompt.endsWith(role))
  assert.equal(argv.filter((arg) => arg === '--dangerously-skip-permissions').length, 0)

  const bare = (await commandLine(made, { agent: { id: 'a1', name: 'Ada', role: '' } })).argv
  assert.equal(valueOf(bare, '--append-system-prompt'), 'You are Ada, a member of the crew.')
}))

test('extra arguments are passed along after the adapter\'s own', using({ extraArgs: ['--model', 'haiku'] }, async (made) => {
  const { argv } = await commandLine(made)
  assert.equal(valueOf(argv, '--model'), 'haiku')
}))

test('a handle that is not a session id is refused before anything is run', using({}, async (made) => {
  for (const handle of ['--dangerously-skip-permissions', '-x', 'scripted:1', '../../etc', 'not a uuid']) {
    assert.throws(() => made.runtime.start(made.input({ handle })), refused('bad_turn'), handle)
  }
  assert.equal(await made.alive(), false)
}))

test('an autonomous agent is never stopped for approval, and the tool goes ahead', using({}, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'approval', autonomy: 'autonomous' }))
  assert.equal((await turn.done).outcome, 'finished')
  assert.ok(!events.some((event) => event.type === 'approval'))
  const last = events.filter((event) => event.type === 'tool').at(-1)
  assert.deepEqual([last.status, last.output], ['finished', 'ran rm -rf build'])
}))

test('an autonomous agent\'s question still reaches the person', using({}, async (made) => {
  const { turn, events, until } = begin(made.runtime, made.input({ text: 'question', autonomy: 'autonomous' }))
  const question = await until('question')
  turn.answer(question.requestId, { text: 'Red' })
  await turn.done
  assert.ok(events.some((event) => event.type === 'text' && event.text === 'you said Red'))
}))

test('a refusal reaches the agent with the reason given', using({}, async (made) => {
  const { turn, events, until } = begin(made.runtime, made.input({ text: 'approval', autonomy: 'ask' }))
  turn.answer((await until('approval')).requestId, { allow: false, message: 'Not on a Friday.' })
  await turn.done
  assert.equal(events.filter((event) => event.type === 'tool').at(-1).output, 'Not on a Friday.')
}))

test('output that arrives in pieces, or several lines at once, is read as whole lines', using({}, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'fragments' }))
  assert.equal((await turn.done).outcome, 'finished')
  assert.deepEqual(events.filter((e) => e.type === 'text').map((e) => e.text), ['in pieces', 'together'])
}))

test('a process that dies mid-turn fails the turn with the last thing it said', using({}, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'crash' }))
  assert.equal((await turn.done).outcome, 'failed')
  assert.deepEqual(events.at(-1), { type: 'failed', reason: 'fatal: the runtime fell over', code: 'crashed' })
  assert.deepEqual(events.map((e) => e.type), ['started', 'text', 'failed'])
}))

test('a process that exits without a word fails the turn and says how it exited', using({}, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'silent-exit' }))
  await turn.done
  assert.equal(events.at(-1).code, 'crashed')
  assert.match(events.at(-1).reason, /Claude Code stopped before finishing/)
}))

test('a command that is not there fails the turn, naming it', using({ command: '/nonexistent/claude-binary' }, async (made) => {
  const { turn, events } = begin(made.runtime, made.input())
  assert.equal((await turn.done).outcome, 'failed')
  assert.deepEqual(events.map((e) => e.type), ['failed'])
  assert.equal(events[0].code, 'runtime')
  assert.match(events[0].reason, /\/nonexistent\/claude-binary/)
}))

test('a workspace folder that is not there fails the turn and does not crash the server', using({}, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ folder: path.join(made.folder, 'gone') }))
  assert.equal((await turn.done).outcome, 'failed')
  assert.equal(events.at(-1).code, 'runtime')
}))

test('a process that ignores being asked to stop is stopped anyway', using({}, async (made) => {
  const { turn, until } = begin(made.runtime, made.input({ text: 'stubborn' }))
  await until('text')
  assert.equal(await made.alive(), true)
  turn.interrupt()
  assert.equal((await turn.done).outcome, 'interrupted')
  for (let i = 0; i < 40 && (await made.alive()); i++) await sleep(25)
  assert.equal(await made.alive(), false)
}))

test('a process that finishes and then will not leave is shown the door', using({}, async (made) => {
  const { turn } = begin(made.runtime, made.input({ text: 'lingers' }))
  assert.equal((await turn.done).outcome, 'finished')
  for (let i = 0; i < 60 && (await made.alive()); i++) await sleep(25)
  assert.equal(await made.alive(), false)
}))

test('a listener that throws does not leave a process behind', using({}, async (made) => {
  const turn = made.runtime.start(made.input({ text: 'tool', onEvent() { throw new Error('listener bug') } }))
  assert.equal((await turn.done).outcome, 'finished')
}))

// ── after review ─────────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process'
import { createParser } from '../server/crew/runtimes/claude-code/parse.mjs'

const gone = async (made) => {
  for (let i = 0; i < 60 && (await made.alive()); i++) await sleep(25)
  return !(await made.alive())
}

/** A parser that hands the adapter one event the contract will refuse. */
const faultyParser = () => {
  const real = createParser()
  return {
    ...real,
    feed: (line) => real.feed(line).map((event) => (event.type === 'text' ? { type: 'tool', id: '', name: 'Bash', summary: '', status: 'started' } : event)),
    answerLine: real.answerLine,
    takeReplies: real.takeReplies,
    get finished() { return real.finished },
  }
}

test('a turn that ends for any reason takes its process with it, and approves nothing afterwards', using({ createParser: faultyParser }, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'slow', autonomy: 'autonomous' }))
  assert.equal((await turn.done).outcome, 'failed')
  assert.match(events.at(-1).reason, /adapter is at fault/)
  assert.equal(await gone(made), true, 'the process outlived a turn that had already failed')
}))

test('the server stopping takes every running agent with it', using({}, async (made) => {
  const script = `
    import { createClaudeCodeRuntime } from ${JSON.stringify(new URL('../server/crew/runtimes/claude-code/index.mjs', import.meta.url).href)}
    const runtime = createClaudeCodeRuntime({ command: ${JSON.stringify(FAKE)}, env: { ...process.env, FAKE_CLAUDE_PIDFILE: ${JSON.stringify(made.pidfile)} } })
    runtime.start({ agent: { id: 'a', name: 'Ada', role: '' }, folder: ${JSON.stringify(made.folder)}, text: 'grandchild', handle: null, autonomy: 'autonomous',
      onEvent: (event) => { if (event.type === 'text') process.exit(0) } })
  `
  await new Promise((resolve) => execFile(process.execPath, ['--input-type=module', '-e', script], resolve))
  assert.equal(await gone(made), true, 'an agent or its tool survived the server')
}))

test('stopping an agent stops what the agent started', using({}, async (made) => {
  const { turn, until } = begin(made.runtime, made.input({ text: 'grandchild' }))
  await until('text')
  assert.equal(await made.alive(), true)
  turn.interrupt()
  await turn.done
  assert.equal(await gone(made), true, 'a tool the agent started is still running')
}))

test('a crash is reported promptly even if something the agent started still holds its output open', using({}, async (made) => {
  const started = Date.now()
  const { turn, events } = begin(made.runtime, made.input({ text: 'holdpipe' }))
  assert.equal((await turn.done).outcome, 'failed')
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`)
  assert.equal(events.at(-1).code, 'crashed')
}))

test('a request the adapter has no use for is answered, so the turn is not left waiting on it', using({}, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'othercontrol' }))
  const outcome = await Promise.race([turn.done.then((r) => r.outcome), sleep(2500).then(() => 'still waiting')])
  turn.interrupt()
  assert.equal(outcome, 'finished')
  assert.ok(events.some((event) => event.text === 'carried on'))
}))

test('unusual line and paragraph separators survive in both directions', using({}, async (made) => {
  const out = begin(made.runtime, made.input({ text: 'separators' }))
  assert.equal((await out.turn.done).outcome, 'finished')
  assert.equal(out.events.find((e) => e.type === 'text').text, 'line separator and paragraph separator')

  const said = 'echo: one two three\nfour {"type":"control_response"}'
  const back = begin(made.runtime, made.input({ text: said }))
  assert.equal((await back.turn.done).outcome, 'finished')
  assert.equal(back.events.find((e) => e.type === 'text').text, said)
}))

test('an agent that goes silent is given up on, but not while it is waiting on the person', using({ stallAfterMs: 250 }, async (made) => {
  const silent = begin(made.runtime, made.input({ text: 'slow' }))
  assert.equal((await silent.turn.done).outcome, 'failed')
  assert.deepEqual([silent.events.at(-1).code, /stopped responding/.test(silent.events.at(-1).reason)], ['runtime', true])

  const waiting = begin(made.runtime, made.input({ text: 'approval', autonomy: 'ask' }))
  const approval = await waiting.until('approval')
  await sleep(600)
  waiting.turn.answer(approval.requestId, { allow: true })
  assert.equal((await waiting.turn.done).outcome, 'finished')
}))

test('output that never ends a line is cut off before it fills the server\'s memory', using({ maxLineBytes: 4000 }, async (made) => {
  const { turn, events } = begin(made.runtime, made.input({ text: 'longline' }))
  assert.equal((await turn.done).outcome, 'failed')
  assert.match(events.at(-1).reason, /too much output/)
}))

test('an agent does not get the server\'s secrets or the server user\'s own Claude Code setup', using({}, async (made) => {
  const { argv, secrets, marker } = await commandLine(made)
  assert.deepEqual(secrets, [], 'the agent can read the server\'s database credentials')
  assert.equal(marker, 'from-env', 'the rest of the environment still reaches it')
  assert.equal(valueOf(argv, '--setting-sources'), 'local')
  assert.ok(argv.includes('--strict-mcp-config'))
}))

test('the server user\'s setup can be let in on purpose', using({ isolated: false }, async (made) => {
  const { argv } = await commandLine(made)
  assert.ok(!argv.includes('--setting-sources') && !argv.includes('--strict-mcp-config'))
}))
