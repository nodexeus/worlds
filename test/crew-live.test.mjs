/**
 * Checks against a real runtime. They call a real model, so they cost money and are never
 * part of `npm test`: they run only when WORLDS_LIVE_RUNTIME names the runtime to check.
 *
 *     npm run test:crew:live
 *
 * This is what notices when a new release of a runtime changes its wire format, which the
 * recorded shapes in the unit tests cannot.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRuntimes } from '../server/crew/runtimes/index.mjs'
import { createCrew } from '../server/crew/index.mjs'
import { connect } from '../server/crew/store/db.mjs'
import { TEST_DB } from './support/crew-db.mjs'
import { randomUUID } from 'node:crypto'
import { begin } from './support/runtime-contract.mjs'

const LIVE = process.env.WORLDS_LIVE_RUNTIME || ''
const live = LIVE === 'claude-code' ? { timeout: 180_000 } : { skip: 'set WORLDS_LIVE_RUNTIME=claude-code to run against the real CLI' }

async function withFolder(run) {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'crew-live-')))
  const runtime = createRuntimes({ claudeCode: { extraArgs: ['--model', process.env.WORLDS_LIVE_MODEL || 'haiku'] } }).get('claude-code')
  const input = (more = {}) => ({
    agent: { id: 'live', name: 'Ada', role: 'You answer in as few words as you can.' },
    folder, text: '', handle: null, autonomy: 'autonomous', onEvent() {}, ...more,
  })
  try {
    return await run({ runtime, folder, input })
  } finally {
    await fs.rm(folder, { recursive: true, force: true })
  }
}

test('live: a turn finishes, and a second turn remembers the first', live, async () => {
  await withFolder(async ({ runtime, input }) => {
    const first = begin(runtime, input({ text: 'Remember the word "heliotrope". Reply with exactly: noted' }))
    const { handle, outcome } = await first.turn.done
    assert.equal(outcome, 'finished', JSON.stringify(first.events.at(-1)))
    assert.equal(first.events[0].type, 'started')
    assert.ok(first.events.some((event) => event.type === 'text'))

    const second = begin(runtime, input({ text: 'What word did I ask you to remember? Reply with only that word.', handle }))
    const again = await second.turn.done
    assert.equal(again.handle, handle)
    assert.match(second.events.at(-1).text.toLowerCase(), /heliotrope/)
  })
})

test('live: an autonomous agent uses a tool in its workspace without asking', live, async () => {
  await withFolder(async ({ runtime, folder, input }) => {
    const { turn, events } = begin(runtime, input({ text: 'Create a file named hello.txt containing the word hi. Then reply with exactly: done' }))
    assert.equal((await turn.done).outcome, 'finished', JSON.stringify(events.at(-1)))
    assert.ok(!events.some((event) => event.type === 'approval'))
    assert.deepEqual(events.filter((event) => event.type === 'tool').map((event) => event.status).slice(0, 2), ['started', 'finished'])
    assert.match(await fs.readFile(path.join(folder, 'hello.txt'), 'utf8'), /hi/)
  })
})

test('live: under "ask" a command waits for approval, and a refusal stops it', live, async () => {
  await withFolder(async ({ runtime, folder, input }) => {
    const { turn, events, until } = begin(runtime, input({ autonomy: 'ask', text: 'Use the Bash tool to run exactly: echo second > second.txt   Then tell me in one sentence what happened.' }))
    const approval = await until('approval')
    assert.equal(approval.tool, 'Bash')
    assert.match(approval.summary, /second\.txt/)
    turn.answer(approval.requestId, { allow: false, message: 'Not allowed in this check.' })
    assert.equal((await turn.done).outcome, 'finished', JSON.stringify(events.at(-1)))
    await assert.rejects(fs.access(path.join(folder, 'second.txt')))
  })
})

test('live: a question reaches the person and the answer reaches the agent', live, async () => {
  await withFolder(async ({ runtime, input }) => {
    const { turn, events, until } = begin(runtime, input({ text: 'Use the AskUserQuestion tool to ask me which of two colours I prefer, blue or red. After I answer, reply with exactly: You chose <colour>' }))
    const question = await until('question')
    assert.ok(question.questions[0].options.length >= 2, JSON.stringify(question))
    turn.answer(question.requestId, { text: question.questions[0].options[0] })
    assert.equal((await turn.done).outcome, 'finished', JSON.stringify(events.at(-1)))
    assert.match(events.at(-1).text.toLowerCase(), new RegExp(question.questions[0].options[0].toLowerCase()))
  })
})

test('live: a message to an agent is run on the real runtime and recorded from start to finish', TEST_DB ? live : { skip: 'needs WORLDS_TEST_DATABASE_URL as well' }, async () => {
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'crew-live-world-')))
  const runtimes = createRuntimes({ claudeCode: { extraArgs: ['--model', process.env.WORLDS_LIVE_MODEL || 'haiku'] } })
  const crew = await createCrew(
    { databaseUrl: TEST_DB, schema, dataDir, worldId: 'live', agentLimit: 2, entitled: [] },
    { runtimes }
  )
  try {
    const agent = await crew.roster.create({ name: 'Ada', runtime: 'claude-code', role: 'You answer in as few words as you can.' })
    const site = await crew.workspaces.create({ name: 'Site', description: 'A test folder.' })
    const { conversation } = await crew.conversations.send(agent.id, {
      text: 'Write the single word "kept" into a file called note.txt, then reply with exactly: done',
      workspaceId: site.id,
    })
    await crew.conversations.settled(agent.id)
    const events = await crew.events.page(conversation.id, { limit: 500 })
    assert.equal(events.at(-1).type, 'finished', JSON.stringify(events.at(-1)))
    assert.equal(events.at(-1).status, 'idle')
    assert.ok(events.some((event) => event.type === 'tool' && event.data.status === 'finished'), 'the tool call was recorded')
    assert.match(await fs.readFile(path.join(site.folder, 'note.txt'), 'utf8'), /kept/)

    await crew.conversations.send(agent.id, { text: 'What word did you write into the file? Reply with that word only.' })
    await crew.conversations.settled(agent.id)
    const after = await crew.events.page(conversation.id, { limit: 500 })
    assert.equal(after.at(-1).type, 'finished')
    assert.match(after.at(-1).data.text, /kept/i, 'the second turn continued the first')
  } finally {
    await crew.close()
    const admin = connect(TEST_DB, { max: 1 })
    await admin.unsafe(`drop schema if exists "${schema}" cascade`)
    await admin.end({ timeout: 5 })
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
