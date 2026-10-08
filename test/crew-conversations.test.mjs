// test/crew-conversations.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'
import { briefing } from '../server/crew/briefing.mjs'
import { needsDb } from './support/crew-db.mjs'
import { record, refused, withTalk } from './support/crew-talk.mjs'

const SCRIPTS = {
  work: [
    { type: 'tool', id: 't1', name: 'Bash', summary: 'Bash: ls', status: 'started' },
    { type: 'tool', id: 't1', name: 'Bash', summary: 'Bash: ls', status: 'finished', output: 'a.txt' },
    { type: 'text', text: 'Done.' },
    { type: 'finished', text: 'Done.', costUsd: 0.02, durationMs: 40 },
  ],
  ask: [
    { type: 'question', requestId: 'q1', questions: [{ question: 'Which colour?', options: ['Red', 'Blue'] }] },
    { wait: 'q1' },
    { type: 'finished', text: 'Blue it is.' },
  ],
  permit: [
    { type: 'approval', requestId: 'a1', tool: 'Bash', summary: 'Bash: rm -rf build' },
    { wait: 'a1', allow: [{ type: 'text', text: 'Removed.' }], deny: [{ type: 'text', text: 'Left alone.' }] },
    { type: 'finished', text: '' },
  ],
  slow: [{ pause: 300 }, { type: 'finished', text: 'Slow done.' }],
  long: [{ pause: 5000 }, { type: 'finished', text: 'never' }],
  talk: [{ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'text', text: 'Hello' }, { type: 'finished', text: 'Hello' }],
  crash: [{ type: 'text', text: 'Starting.' }, { crash: 'The model is out of credit' }],
  burst: [{ pause: 150 }, { type: 'delta', text: 'go' }, ...Array.from({ length: 5 }, (_, n) => ({ type: 'text', text: `t${n}` })), { pause: 100 }, { type: 'finished', text: 'done' }],
  flood: [{ pause: 40 }, ...Array.from({ length: 60 }, (_, n) => ({ type: 'text', text: `t${n}` })), { pause: 5000 }, { type: 'finished', text: '' }],
  sip: [{ type: 'text', text: 'one' }, { pause: 200 }, { type: 'text', text: 'two' }, { pause: 200 }, { type: 'finished', text: '' }],
  drip: [{ type: 'text', text: 'one' }, { pause: 200 }, { type: 'text', text: 'two' }, { pause: 200 }, { type: 'finished', text: '' }],
}

/** A crew with one agent and one workspace, which most tests want. */
const withOne = (run, options = {}) =>
  withTalk(async (crew) => {
    const agent = await crew.roster.create({ name: 'Ada', runtime: 'claude-code', role: 'Writes the docs.' })
    const site = await crew.workspaces.create({ name: 'Site', description: 'The public website.' })
    return run(crew, { agent, site })
  }, { scripts: SCRIPTS, ...options })

/** Wait until the hub has sent a stored event that `match` accepts. */
async function seen(crew, match, ms = 3000) {
  const deadline = Date.now() + ms
  while (!crew.sent.some(([kind, payload]) => kind === 'event' && match(payload))) {
    if (Date.now() > deadline) throw new Error('the event never came')
    await wait(5)
  }
}

const statusOf = async (crew, agentId) => (await crew.conversations.statuses()).get(agentId)?.status ?? 'idle'

test('the briefing gives an agent its role, its workspace, the others, and the standing rules', () => {
  const text = briefing({
    agent: { name: 'Ada', role: 'Writes the docs.' },
    workspace: { name: 'Site', description: 'The public website.' },
    others: [{ name: 'Api', description: 'The backend.' }, { name: 'Bare', description: '' }],
  })
  assert.match(text, /^Writes the docs\./)
  assert.match(text, /You are working in the workspace "Site": The public website\./)
  assert.match(text, /- Api: The backend\.\n- Bare\n/)
  assert.match(text, /belongs in a different workspace/)
  assert.match(text, /ask before doing any work/i)
  assert.match(text, /Never create a workspace/)
})

test('a briefing never outgrows what a runtime will take, however many workspaces there are', () => {
  const others = Array.from({ length: 500 }, (_, n) => ({ name: `Workspace ${n}`, description: 'x'.repeat(400) }))
  const text = briefing({ agent: { name: 'Ada', role: 'r'.repeat(8000) }, workspace: { name: 'Site', description: '' }, others })
  assert.ok(text.length <= 32_000, `${text.length} characters`)
  assert.match(text, /and \d+ more/)
  assert.match(text, /Never create a workspace/)
})

test('a task is run in its workspace and everything said is kept', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const sent = await crew.conversations.send(agent.id, { text: 'work', workspaceId: site.id })
    assert.equal(sent.queued, false)
    assert.deepEqual(
      [sent.conversation.agentId, sent.conversation.workspaceId, sent.conversation.kind, sent.conversation.title, sent.conversation.closedAt],
      [agent.id, site.id, 'task', 'work', null]
    )
    assert.ok(!('handle' in sent.conversation), 'the runtime handle is not for the page')
    assert.deepEqual([sent.event.type, sent.event.status, sent.event.data], ['message', 'working', { text: 'work' }])
    await crew.conversations.settled(agent.id)

    assert.deepEqual(await record(crew, sent.conversation.id), [
      ['message', 'working', { text: 'work' }],
      ['tool', 'working', { id: 't1', name: 'Bash', summary: 'Bash: ls', status: 'started' }],
      ['tool', 'working', { id: 't1', name: 'Bash', summary: 'Bash: ls', status: 'finished', output: 'a.txt' }],
      ['text', 'working', { text: 'Done.' }],
      ['finished', 'idle', { text: 'Done.', costUsd: 0.02, durationMs: 40 }],
    ])
    assert.equal(await statusOf(crew, agent.id), 'idle')

    const [turn] = crew.scripted.turns
    assert.equal(turn.folder, site.folder)
    assert.equal(turn.handle, null)
    assert.equal(turn.autonomy, 'autonomous')
    assert.deepEqual([turn.agent.id, turn.agent.name], [agent.id, 'Ada'])
    assert.match(turn.agent.role, /^Writes the docs\./)
    assert.match(turn.agent.role, /workspace "Site"/)
  })
})

test('a further message continues the same conversation, with the level the world has chosen', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const first = await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    await crew.settings.update({ autonomy: 'ask' })
    const second = await crew.conversations.send(agent.id, { text: 'again' })
    await crew.conversations.settled(agent.id)

    assert.equal(second.conversation.id, first.conversation.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => [turn.text, turn.handle, turn.autonomy]), [
      ['hello', null, 'autonomous'],
      ['again', 'scripted:1', 'ask'],
    ])
    assert.equal((await record(crew, first.conversation.id)).length, 6)
  })
})

test('a message with nowhere to go is refused, and so is everything malformed, before anything is kept', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversations } = crew
    await assert.rejects(conversations.send(agent.id, { text: 'hello' }), refused('needs_workspace'))
    await assert.rejects(conversations.send('nobody', { text: 'hello', workspaceId: site.id }), refused('unknown_agent'))
    await assert.rejects(conversations.send('00000000-0000-7000-8000-000000000000', { text: 'hello', workspaceId: site.id }), refused('unknown_agent'))
    await assert.rejects(conversations.send(agent.id, { text: 'hello', workspaceId: 'nowhere' }), refused('unknown_workspace'))
    for (const text of ['', '   ', 7, null, undefined, 'x'.repeat(20_001)]) {
      await assert.rejects(conversations.send(agent.id, { text, workspaceId: site.id }), refused('bad_message'))
    }
    await assert.rejects(conversations.send(agent.id), refused('bad_message'))

    const claw = await crew.roster.create({ name: 'Bo', runtime: 'openclaw' })
    await assert.rejects(conversations.send(claw.id, { text: 'hello', workspaceId: site.id }), refused('runtime_unavailable'))

    const gone = await crew.workspaces.create({ name: 'Gone' })
    await crew.workspaces.archive(gone.id)
    await assert.rejects(conversations.send(agent.id, { text: 'hello', workspaceId: gone.id }), refused('unknown_workspace'))

    assert.equal(await crew.events.head(), 0)
    assert.deepEqual(await conversations.list(agent.id), [])
    assert.equal(crew.scripted.turns.length, 0)
  })
})

test('a conversation whose workspace was archived needs a new one', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    await crew.workspaces.archive(site.id)
    const before = await crew.events.head()
    await assert.rejects(crew.conversations.send(agent.id, { text: 'again' }), refused('needs_workspace'))
    assert.equal(await crew.events.head(), before)
  })
})

test('a question leaves the agent waiting until it is answered', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'ask', workspaceId: site.id })
    await wait(30)
    assert.equal(await statusOf(crew, agent.id), 'waiting')

    await assert.rejects(crew.conversations.answer(conversation.id, { requestId: 'nope', text: 'Blue' }), refused('unknown_request'))
    await assert.rejects(crew.conversations.answer(conversation.id, { requestId: 'q1', allow: true }), refused('bad_answer'))
    await assert.rejects(crew.conversations.answer(conversation.id, { text: 'Blue' }), refused('bad_answer'))
    await assert.rejects(crew.conversations.answer('00000000-0000-7000-8000-000000000000', { requestId: 'q1', text: 'Blue' }), refused('unknown_conversation'))
    assert.equal(await statusOf(crew, agent.id), 'waiting')

    const { event } = await crew.conversations.answer(conversation.id, { requestId: 'q1', text: 'Blue', stray: 'ignored' })
    assert.deepEqual([event.type, event.status, event.data], ['answer', 'working', { requestId: 'q1', text: 'Blue' }])
    await assert.rejects(crew.conversations.answer(conversation.id, { requestId: 'q1', text: 'Red' }), refused('unknown_request'))
    await crew.conversations.settled(agent.id)

    assert.deepEqual(await record(crew, conversation.id), [
      ['message', 'working', { text: 'ask' }],
      ['question', 'waiting', { requestId: 'q1', questions: [{ question: 'Which colour?', options: ['Red', 'Blue'] }] }],
      ['answer', 'working', { requestId: 'q1', text: 'Blue' }],
      ['finished', 'idle', { text: 'Blue it is.' }],
    ])
    assert.deepEqual(crew.scripted.turns[0].answers, [{ requestId: 'q1', answer: { text: 'Blue' } }])
    await assert.rejects(crew.conversations.answer(conversation.id, { requestId: 'q1', text: 'Blue' }), refused('unknown_request'))
  })
})

test('an approval can be given or refused, and either is recorded', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    await crew.settings.update({ autonomy: 'ask' })
    const { conversation } = await crew.conversations.send(agent.id, { text: 'permit', workspaceId: site.id })
    await wait(30)
    await crew.conversations.answer(conversation.id, { requestId: 'a1', allow: false, message: 'Not that folder' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual((await record(crew, conversation.id)).slice(1), [
      ['approval', 'waiting', { requestId: 'a1', tool: 'Bash', summary: 'Bash: rm -rf build' }],
      ['answer', 'working', { requestId: 'a1', allow: false, message: 'Not that folder' }],
      ['text', 'working', { text: 'Left alone.' }],
      ['finished', 'idle', { text: '' }],
    ])
  })
})

test('a message to a working agent waits its turn and is delivered when the turn finishes', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'slow', workspaceId: site.id })
    const second = await crew.conversations.send(agent.id, { text: 'and this' })
    const third = await crew.conversations.send(agent.id, { text: 'and that' })
    assert.deepEqual([second.queued, third.queued], [true, true])
    assert.deepEqual([second.event.status, second.event.data], ['working', { text: 'and this', queued: true }])
    await crew.conversations.settled(agent.id)

    assert.deepEqual(await record(crew, conversation.id), [
      ['message', 'working', { text: 'slow' }],
      ['message', 'working', { text: 'and this', queued: true }],
      ['message', 'working', { text: 'and that', queued: true }],
      ['finished', 'idle', { text: 'Slow done.' }],
      ['queue', 'working', { of: [second.event.seq, third.event.seq], outcome: 'delivered' }],
      ['text', 'working', { text: 'and this\n\nand that' }],
      ['finished', 'idle', { text: 'and this\n\nand that' }],
    ])
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['slow', 'and this\n\nand that'])
    assert.equal(crew.scripted.turns[1].handle, 'scripted:1')
  })
})

test('a message waiting on a turn that fails or is stopped is cancelled, and said to be', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    const queued = await crew.conversations.send(agent.id, { text: 'also' })
    assert.deepEqual(await crew.conversations.stop(agent.id), { stopped: true })
    assert.deepEqual(await record(crew, conversation.id), [
      ['message', 'working', { text: 'long' }],
      ['message', 'working', { text: 'also', queued: true }],
      ['interrupted', 'idle', {}],
      ['queue', 'idle', { of: [queued.event.seq], outcome: 'cancelled' }],
    ])
    assert.equal(await statusOf(crew, agent.id), 'idle')
    assert.equal(crew.scripted.turns.length, 1)

    // What was cancelled stays cancelled: the next turn does not pick it up.
    await crew.conversations.send(agent.id, { text: 'hello' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['long', 'hello'])
  })
})

test('a new task is refused while the agent is busy, and replaces the old conversation when it is not', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const api = await crew.workspaces.create({ name: 'Api' })
    const first = await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    await assert.rejects(crew.conversations.send(agent.id, { text: 'other', workspaceId: api.id }), refused('agent_busy'))
    await crew.conversations.stop(agent.id)

    const second = await crew.conversations.send(agent.id, { text: 'Build the API\nwith care', workspaceId: api.id })
    await crew.conversations.settled(agent.id)
    assert.notEqual(second.conversation.id, first.conversation.id)
    assert.equal(second.conversation.title, 'Build the API')
    assert.equal(crew.scripted.turns.at(-1).folder, api.folder)
    assert.equal(crew.scripted.turns.at(-1).handle, null)

    const listed = await crew.conversations.list(agent.id)
    assert.deepEqual(listed.map((c) => [c.id, c.closedAt === null, c.status]), [
      [second.conversation.id, true, 'idle'],
      [first.conversation.id, false, 'idle'],
    ])
    assert.deepEqual((await crew.conversations.statuses()).get(agent.id), {
      status: 'idle', conversationId: second.conversation.id, workspaceId: api.id,
    })
    assert.equal((await crew.conversations.get(first.conversation.id)).workspaceId, site.id)
    await assert.rejects(crew.conversations.get('nope'), refused('unknown_conversation'))
  })
})

test('a long title is cut', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: `  ${'word '.repeat(40)}`, workspaceId: site.id })
    assert.ok(conversation.title.length <= 80)
    assert.match(conversation.title, /^word word/)
  })
})

test('stopping an agent that is doing nothing does nothing', needsDb, async () => {
  await withOne(async (crew, { agent }) => {
    assert.deepEqual(await crew.conversations.stop(agent.id), { stopped: false })
    await assert.rejects(crew.conversations.stop('nobody'), refused('unknown_agent'))
    assert.equal(await crew.events.head(), 0)
  })
})

test('a turn that fails leaves the agent failed, and the next message works', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'crash', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    assert.equal(await statusOf(crew, agent.id), 'failed')
    await crew.conversations.send(agent.id, { text: 'hello' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(await record(crew, conversation.id), [
      ['message', 'working', { text: 'crash' }],
      ['text', 'working', { text: 'Starting.' }],
      ['failed', 'failed', { reason: 'The model is out of credit', code: 'crashed' }],
      ['message', 'working', { text: 'hello' }],
      ['text', 'working', { text: 'hello' }],
      ['finished', 'idle', { text: 'hello' }],
    ])
  })
})

test('a runtime that refuses the turn outright is a failed turn, not a lost one', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    await crew.roster.update(agent.id, { role: 'r'.repeat(8000) })
    const real = crew.scripted.start
    crew.scripted.start = () => {
      throw new Error('spawn exploded')
    }
    const { conversation } = await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    crew.scripted.start = real
    assert.deepEqual((await record(crew, conversation.id)).at(-1), ['failed', 'failed', { reason: 'The runtime could not be started', code: 'runtime' }])
    await crew.conversations.send(agent.id, { text: 'again' })
    await crew.conversations.settled(agent.id)
    assert.equal(await statusOf(crew, agent.id), 'idle')
  })
})

test('fragments are passed on as they come and never kept', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'talk', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    const live = crew.sent.map(([kind, payload]) => (kind === 'delta' ? ['delta', payload] : [payload.type]))
    assert.deepEqual(live, [
      ['message'],
      ['delta', { conversationId: conversation.id, agentId: agent.id, text: 'Hel' }],
      ['delta', { conversationId: conversation.id, agentId: agent.id, text: 'lo' }],
      ['text'],
      ['finished'],
    ])
    assert.deepEqual((await record(crew, conversation.id)).map(([type]) => type), ['message', 'text', 'finished'])
  })
})

test('two messages arriving together make one turn and one queued message, never two turns', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    const both = await Promise.all([
      crew.conversations.send(agent.id, { text: 'slow' }),
      crew.conversations.send(agent.id, { text: 'second' }),
    ])
    assert.deepEqual(both.map((sent) => sent.queued), [false, true])
    assert.equal(crew.scripted.turns.length, 2, 'the second message did not start a turn of its own')
    await crew.conversations.settled(agent.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['hello', 'slow', 'second'])
  })
})

test('two tasks arriving together for one agent: one is taken and one is refused', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const results = await Promise.allSettled([
      crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id }),
      crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id }),
    ])
    assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected'])
    assert.ok(refused('agent_busy')(results[1].reason))
    assert.equal(crew.scripted.turns.length, 1)
  })
})

test('a message sent at any moment around the end of a turn is delivered or cancelled, never left waiting', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'slow', workspaceId: site.id })
    const sends = []
    for (let n = 0; n < 12; n += 1) {
      sends.push(crew.conversations.send(agent.id, { text: `m${n}` }))
      await wait(10)
    }
    await Promise.all(sends)
    await crew.conversations.settled(agent.id)

    const events = await crew.events.page(conversation.id, { limit: 500 })
    const settledSeqs = new Set(events.filter((event) => event.type === 'queue').flatMap((event) => event.data.of))
    const left = events.filter((event) => event.type === 'message' && event.data.queued && !settledSeqs.has(event.seq))
    assert.deepEqual(left, [])
    assert.equal(events.filter((event) => event.type === 'message').length, 13)
    assert.equal(events.at(-1).status, 'idle')
    // Every message reached the runtime exactly once.
    const delivered = crew.scripted.turns.flatMap((turn) => turn.text.split('\n\n'))
    assert.deepEqual(delivered.sort(), ['slow', ...Array.from({ length: 12 }, (_, n) => `m${n}`)].sort())
  })
})

test('when the record cannot be written the turn is stopped, and the agent is not left working for ever', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'sip', workspaceId: site.id })
    await seen(crew, (event) => event.data.text === 'one')
    crew.store.failing = true
    await crew.conversations.settled(agent.id)
    crew.store.failing = false

    assert.ok(crew.logged.length > 0, 'the failure is logged')
    assert.equal(await statusOf(crew, agent.id), 'working', 'the record still says working: nothing could be written')
    await crew.conversations.send(agent.id, { text: 'hello' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(await record(crew, conversation.id), [
      ['message', 'working', { text: 'sip' }],
      ['text', 'working', { text: 'one' }],
      ['interrupted', 'idle', { reason: 'lost' }],
      ['message', 'working', { text: 'hello' }],
      ['text', 'working', { text: 'hello' }],
      ['finished', 'idle', { text: 'hello' }],
    ])
    assert.equal(crew.scripted.turns.length, 2)
  })
})

test('a short outage of the record loses nothing', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'drip', workspaceId: site.id })
    await seen(crew, (event) => event.data.text === 'one')
    crew.store.failing = true
    // Until one write has been refused, so the outage is over a write and not between two.
    while (!crew.store.refused) await wait(2)
    crew.store.failing = false
    await crew.conversations.settled(agent.id)
    assert.deepEqual(await record(crew, conversation.id), [
      ['message', 'working', { text: 'drip' }],
      ['text', 'working', { text: 'one' }],
      ['text', 'working', { text: 'two' }],
      ['finished', 'idle', { text: '' }],
    ])
  })
})

test('when the record comes back only after the turn was stopped for it, the turn is recorded as failed', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'drip', workspaceId: site.id })
    await seen(crew, (event) => event.data.text === 'one')
    crew.store.failing = true
    while (!crew.logged.length) await wait(5)
    crew.store.failing = false
    await crew.conversations.settled(agent.id)
    const last = (await record(crew, conversation.id)).at(-1)
    assert.deepEqual([last[0], last[1], last[2].code], ['failed', 'failed', 'runtime'])
    assert.match(last[2].reason, /could not record/)
    assert.equal(await statusOf(crew, agent.id), 'failed')
  })
})

test('at start, a conversation a stopped server left working is marked interrupted, once', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    // As a server that died mid-turn leaves things: a message, a queued one, and no ending.
    const lost = await crew.events.append({ conversationId: conversation.id, agentId: agent.id, type: 'message', status: 'working', data: { text: 'lost' } })
    const queued = await crew.events.append({ conversationId: conversation.id, agentId: agent.id, type: 'message', status: 'working', data: { text: 'q', queued: true } })
    assert.ok(lost.seq < queued.seq)

    assert.equal(await crew.conversations.recover(), 1)
    assert.equal(await crew.conversations.recover(), 0)
    assert.deepEqual((await record(crew, conversation.id)).slice(-2), [
      ['interrupted', 'idle', { reason: 'restart' }],
      ['queue', 'idle', { of: [queued.seq], outcome: 'cancelled' }],
    ])
    assert.equal(await statusOf(crew, agent.id), 'idle')
  })
})

test('recovery leaves a turn that is really running alone', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    assert.equal(await crew.conversations.recover(), 0)
    assert.equal(await statusOf(crew, agent.id), 'working')
  })
})

test('dismissing an agent stops it and closes its conversation', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const { conversation } = await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    await crew.conversations.dismiss(agent.id)
    assert.deepEqual((await record(crew, conversation.id)).at(-1), ['interrupted', 'idle', {}])
    assert.notEqual((await crew.conversations.get(conversation.id)).closedAt, null)
    assert.equal((await crew.conversations.statuses()).has(agent.id), false)
    await crew.conversations.dismiss(agent.id)
  })
})

test('closing stops every turn and leaves nothing unwritten', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const other = await crew.roster.create({ name: 'Bo', runtime: 'claude-code' })
    const a = await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    const b = await crew.conversations.send(other.id, { text: 'long', workspaceId: site.id })
    await crew.conversations.close()
    for (const { conversation } of [a, b]) {
      assert.deepEqual((await record(crew, conversation.id)).at(-1), ['interrupted', 'idle', {}])
    }
  })
})

test('agents work side by side, each in its own conversation', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const other = await crew.roster.create({ name: 'Bo', runtime: 'claude-code' })
    const [a, b] = await Promise.all([
      crew.conversations.send(agent.id, { text: 'slow', workspaceId: site.id }),
      crew.conversations.send(other.id, { text: 'work', workspaceId: site.id }),
    ])
    await Promise.all([crew.conversations.settled(agent.id), crew.conversations.settled(other.id)])
    assert.equal((await record(crew, a.conversation.id)).at(-1)[0], 'finished')
    assert.equal((await record(crew, b.conversation.id)).length, 5)
    const seqs = crew.sent.filter(([kind]) => kind === 'event').map(([, event]) => event.seq)
    assert.deepEqual(seqs, seqs.map((_, n) => n + 1), 'published in order with no gaps')
  })
})

// Found in review.

test('stop asked for as a turn is finishing still cancels what was waiting', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    // Slow writes, so the stop is still in the line behind the agent's last words when the
    // runtime finishes by itself.
    const real = crew.events.append
    crew.events.append = async (event) => {
      await wait(30)
      return real(event)
    }
    const { conversation } = await crew.conversations.send(agent.id, { text: 'burst', workspaceId: site.id })
    const queued = await crew.conversations.send(agent.id, { text: 'queued one' })
    // The fragment is sent on the instant the agent starts talking. From then its words
    // take 150ms to write and it finishes by itself in 100, so a stop asked now is behind
    // them in the line when it does.
    while (!crew.sent.some(([kind, payload]) => kind === 'delta' && payload.text === 'go')) await wait(2)
    assert.deepEqual(await crew.conversations.stop(agent.id), { stopped: true })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['burst'])
    assert.deepEqual((await record(crew, conversation.id)).at(-1), ['queue', 'idle', { of: [queued.event.seq], outcome: 'cancelled' }])
  })
})

test('stop answers only once what was waiting has been cancelled in the record', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const real = crew.events.append
    crew.events.append = async (event) => {
      if (event.type === 'queue') await wait(60)
      return real(event)
    }
    const { conversation } = await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    await crew.conversations.send(agent.id, { text: 'also' })
    await crew.conversations.stop(agent.id)
    assert.equal((await record(crew, conversation.id)).at(-1)[0], 'queue')
  })
})

test('a queued message whose delivery could not be recorded is not left behind or overtaken', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const real = crew.events.append
    let failures = 3
    crew.events.append = (event) => (event.type === 'queue' && failures-- > 0 ? Promise.reject(new Error('blip')) : real(event))
    const { conversation } = await crew.conversations.send(agent.id, { text: 'slow', workspaceId: site.id })
    const queued = await crew.conversations.send(agent.id, { text: 'queued one' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['slow'], 'every try at recording the delivery failed')

    const newer = await crew.conversations.send(agent.id, { text: 'newer' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['slow', 'queued one\n\nnewer'])
    const events = await record(crew, conversation.id)
    assert.deepEqual(events.slice(3, 5), [
      ['message', 'working', { text: 'newer' }],
      ['queue', 'working', { of: [queued.event.seq], outcome: 'delivered' }],
    ])
    assert.equal(newer.queued, false)
  })
})

test('one failed try at recording a delivery does not stop it', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const real = crew.events.append
    let failures = 1
    crew.events.append = (event) => (event.type === 'queue' && failures-- > 0 ? Promise.reject(new Error('blip')) : real(event))
    await crew.conversations.send(agent.id, { text: 'slow', workspaceId: site.id })
    await crew.conversations.send(agent.id, { text: 'queued one' })
    await crew.conversations.settled(agent.id)
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['slow', 'queued one'])
  })
})

test('a new task cancels what was left waiting in the conversation it replaces', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    const real = crew.events.append
    let failures = 3
    crew.events.append = (event) => (event.type === 'queue' && failures-- > 0 ? Promise.reject(new Error('blip')) : real(event))
    const { conversation } = await crew.conversations.send(agent.id, { text: 'slow', workspaceId: site.id })
    const queued = await crew.conversations.send(agent.id, { text: 'queued one' })
    await crew.conversations.settled(agent.id)
    await crew.conversations.send(agent.id, { text: 'something else', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    assert.deepEqual((await record(crew, conversation.id)).at(-1), ['queue', 'idle', { of: [queued.event.seq], outcome: 'cancelled' }])
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['slow', 'something else'])
  })
})

test('once the record has failed, the agent is free at once and not after every backlogged event has been retried', needsDb, async () => {
  await withOne(async (crew, { agent, site }) => {
    await crew.conversations.send(agent.id, { text: 'flood', workspaceId: site.id })
    await wait(15)
    crew.store.failing = true
    await wait(40)
    const began = Date.now()
    await crew.conversations.settled(agent.id)
    crew.store.failing = false
    // Sixty events at three tries each would be several seconds.
    assert.ok(Date.now() - began < 1000, `${Date.now() - began} ms`)
  })
})
