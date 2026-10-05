import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { withEnv } from './support/env.mjs'

const SESSION = '11111111-2222-4333-8444-555555555555'
const user = { type: 'user', cwd: '/tmp/demo', message: { content: 'Continue' } }
const working = { type: 'assistant', message: { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' } }
const finished = { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' } }

/** Scan an isolated Claude store with no host PID registry.
 * @param {object[]} records
 * @param {{mode?: string, ageMs?: number, subagent?: boolean}} options
 * @returns {Promise<object[]>}
 */
async function scanFixture(records, { mode = 'transcript', ageMs = 0, subagent = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-container-'))
  const project = path.join(root, 'projects', '-tmp-demo')
  const transcript = path.join(project, `${SESSION}.jsonl`)
  try {
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(transcript, records.map(r => JSON.stringify(r)).join('\n') + '\n')
    if (ageMs) {
      const stamp = new Date(Date.now() - ageMs)
      await fs.utimes(transcript, stamp, stamp)
    }
    if (subagent) {
      const dir = path.join(project, SESSION, 'subagents')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'agent-test.jsonl'), [user, working].map(r => JSON.stringify(r)).join('\n') + '\n')
    }
    return await withEnv({
      CLAUDE_CONFIG_DIR: root,
      BOT_CROSSING_CLAUDE_DESKTOP: path.join(root, 'desktop'),
      BOT_CROSSING_CLAUDE_ACTIVITY: mode,
    }, async () => {
      const { default: harness } = await import(`../server/harnesses/claude-code.mjs?${root}`)
      return harness.scanThreads()
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('container reports a recent tool call as working without a host PID', async () => {
  const [thread] = await scanFixture([user, working])
  assert.equal(thread.running, true)
  assert.equal(thread.unread, false)
})

test('container reports a new user turn as working without a host PID', async () => {
  const [thread] = await scanFixture([user])
  assert.equal(thread.running, true)
})

test('container reports a completed turn as waiting rather than working', async () => {
  const [thread] = await scanFixture([user, working, finished])
  assert.equal(thread.running, false)
  assert.equal(thread.unread, true)
})

test('container expires an unfinished turn after five minutes without transcript writes', async () => {
  const [thread] = await scanFixture([user, working], { ageMs: 6 * 60 * 1000 })
  assert.equal(thread.running, false)
  assert.equal(thread.unread, false)
})

test('native mode still requires a live PID for a recent tool call', async () => {
  const [thread] = await scanFixture([user, working], { mode: 'process' })
  assert.equal(thread.running, false)
})

test('container does not treat an empty transcript as working', async () => {
  const [thread] = await scanFixture([])
  assert.equal(thread.running, false)
})

test('container reports subagent activity without a host PID', async () => {
  const [thread] = await scanFixture([user, working], { subagent: true })
  assert.equal(thread.subagents?.length, 1)
})

test('a progress reply while a reviewer runs keeps the parent working without asking for help', async () => {
  const [thread] = await scanFixture([user, working, finished], { subagent: true })
  assert.equal(thread.running, true)
  assert.equal(thread.needsAttention, false)
})

test('an ordinary completed reply does not need the user', async () => {
  const [thread] = await scanFixture([user, finished])
  assert.equal(thread.running, false)
  assert.equal(thread.needsAttention, false)
})

for (const text of ['Which branch should I use?', 'Please approve the deployment before I continue.']) {
  test(`an explicit request needs the user: ${text}`, async () => {
    const [thread] = await scanFixture([user, { ...finished, message: { ...finished.message, content: [{ type: 'text', text }] } }])
    assert.equal(thread.running, false)
    assert.equal(thread.needsAttention, true)
  })
}

const question = { type: 'assistant', message: { stop_reason: 'tool_use', content: [
  { type: 'tool_use', name: 'AskUserQuestion', id: 'question-1', input: { questions: [] } },
] } }

test('an unanswered question tool needs the user rather than showing as working', async () => {
  const [thread] = await scanFixture([user, question])
  assert.equal(thread.running, false)
  assert.equal(thread.needsAttention, true)
})

test('answering a question tool clears the request and resumes work', async () => {
  const [thread] = await scanFixture([user, question, { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'question-1', content: 'main' },
  ] } }])
  assert.equal(thread.running, true)
  assert.equal(thread.needsAttention, false)
})

test('streamed thinking is work, not a request for help', async () => {
  const [thread] = await scanFixture([user, { type: 'assistant', message: { stop_reason: null, content: [
    { type: 'thinking', thinking: 'Reviewing changes' },
  ] } }])
  assert.equal(thread.running, true)
  assert.equal(thread.needsAttention, false)
})
