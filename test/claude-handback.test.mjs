import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { withEnv } from './support/env.mjs'

const SESSION = '11111111-2222-4333-8444-555555555555'
const prompt = { type: 'user', message: { content: 'Review the changes' } }
const handback = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'handback-1', name: 'SubagentHandback' }] } }
const working = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash' }] } }

/** Create a tool receipt in the same shape as Claude's transcript.
 * @param {string} id
 * @param {boolean} success
 * @param {boolean} isError
 * @returns {object}
 */
function receipt(id = 'handback-1', success = true, isError = false) {
  return { type: 'user', message: { content: [{
    type: 'tool_result', tool_use_id: id, is_error: isError,
    content: [{ type: 'text', text: JSON.stringify({ success, message: 'Report delivered to your caller.' }) }],
  }] } }
}

/** Scan real fixture files with a live parent and a recent subagent transcript.
 * @param {object[]} records
 * @param {string} mode
 * @returns {Promise<object>}
 */
async function scan(records, mode = 'process') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-handback-'))
  const project = path.join(root, 'projects', '-tmp-demo')
  const subagents = path.join(project, SESSION, 'subagents')
  try {
    await fs.mkdir(subagents, { recursive: true })
    await fs.mkdir(path.join(root, 'sessions'))
    await fs.writeFile(path.join(root, 'sessions', 'live.json'), JSON.stringify({ pid: process.pid, sessionId: SESSION }))
    await fs.writeFile(path.join(project, `${SESSION}.jsonl`), JSON.stringify({ ...prompt, cwd: '/tmp/demo' }) + '\n')
    await fs.writeFile(path.join(subagents, 'agent-review.jsonl'), [prompt, ...records].map(r => JSON.stringify(r)).join('\n') + '\n')
    return await withEnv({
      CLAUDE_CONFIG_DIR: root,
      BOT_CROSSING_CLAUDE_DESKTOP: path.join(root, 'desktop'),
      BOT_CROSSING_CLAUDE_ACTIVITY: mode,
    }, async () => {
      const { default: harness } = await import(`../server/harnesses/claude-code.mjs?${root}`)
      const [thread] = await harness.scanThreads()
      return thread
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

for (const mode of ['process', 'transcript']) {
  test(`${mode}: a successful handback removes the finished subagent immediately`, async () => {
    const thread = await scan([handback, receipt()], mode)
    assert.equal(thread.subagents, undefined)
    assert.equal(thread.running, true, 'the parent continues working')
  })
}

test('late results from other tools do not revive a completed subagent', async () => {
  const thread = await scan([working, handback, receipt(), receipt('bash-1'), { type: 'attachment' }])
  assert.equal(thread.subagents, undefined)
})

test('a plain final answer still completes a subagent', async () => {
  const thread = await scan([{ type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' } }])
  assert.equal(thread.subagents, undefined)
})

for (const [name, records] of [
  ['ordinary tool work', [working, receipt('bash-1')]],
  ['handback without a receipt', [handback]],
  ['failed handback', [handback, receipt('handback-1', false)]],
  ['errored handback', [handback, receipt('handback-1', true, true)]],
  ['receipt for a different tool', [handback, receipt('other')]],
  ['new user request after handback', [handback, receipt(), prompt]],
  ['new tool call after handback', [handback, receipt(), working]],
]) {
  test(`${name} remains active`, async () => {
    const thread = await scan(records)
    assert.equal(thread.subagents?.length, 1)
  })
}
