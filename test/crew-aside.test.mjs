// test/crew-aside.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'
import { needsDb } from './support/crew-db.mjs'
import { record, refused, withTalk } from './support/crew-talk.mjs'

const SCRIPTS = {
  say: [{ type: 'text', text: 'The docs say per workspace.' }, { type: 'finished', text: 'The docs say per workspace.' }],
  quiet: [{ type: 'text', text: 'Only this.' }, { type: 'finished', text: '' }],
  slow: [{ pause: 300 }, { type: 'finished', text: 'Slow done.' }],
  long: [{ pause: 5000 }, { type: 'finished', text: 'never' }],
  work: [{ type: 'text', text: 'Done.' }, { type: 'finished', text: 'Done.' }],
  held: [{ until: null }, { type: 'finished', text: 'CLAIM: Site' }],
  crash: [{ type: 'text', text: 'Starting.' }, { crash: 'The model is out of credit' }],
  meddle: [
    { type: 'approval', requestId: 'a1', tool: 'Bash', summary: 'Bash: rm -rf build' },
    { wait: 'a1', allow: [{ type: 'text', text: 'Removed.' }], deny: [{ type: 'text', text: 'Left alone.' }] },
    { type: 'question', requestId: 'q1', questions: [{ question: 'Which?', options: ['A', 'B'] }, { question: 'And?', options: [] }] },
    { wait: 'q1' },
    { type: 'finished', text: 'Left alone.' },
  ],
}

/** A gate for the `held` script, which finishes when it is opened. */
const gated = () => {
  const gate = Promise.withResolvers()
  // The script reads `promise` when it is played, so this must be set before the turn starts.
  SCRIPTS.held[0].until = gate.promise
  return gate
}

const INSTRUCTION = 'This is the crew channel. Answer once.'

/** A crew with two agents, one workspace and one post to answer. */
const withPost = (run, options = {}) =>
  withTalk(async (crew) => {
    const ada = await crew.roster.create({ name: 'Ada', runtime: 'claude-code', role: 'Writes the docs.' })
    const bo = await crew.roster.create({ name: 'Bo', runtime: 'claude-code' })
    const site = await crew.workspaces.create({ name: 'Site', description: 'The public website.' })
    const [post] = await crew.sql`insert into channel_posts (world_id, text) values ('w', 'A post') returning id`
    const ends = []
    const ask = (agentId, text, more = {}) =>
      crew.conversations.aside(agentId, {
        text, title: text, postId: post.id, instruction: INSTRUCTION, channel: { workspaces: ['Site'] },
        onEnd: (ending) => ends.push([agentId, ending]), ...more,
      })
    return run(crew, { ada, bo, site, post, ask, ends })
  }, { scripts: SCRIPTS, ...options })

const statusOf = async (crew, agentId) => (await crew.conversations.statuses()).get(agentId)?.status ?? 'idle'

test('an agent answers aside from its task: one turn, in a conversation of its own, at the level that asks', needsDb, async () => {
  await withPost(async (crew, { ada, post, ask, ends }) => {
    const asked = await ask(ada.id, 'say')
    assert.equal(asked.started, true)
    assert.deepEqual(
      [asked.conversation.agentId, asked.conversation.kind, asked.conversation.workspaceId, asked.conversation.postId, asked.conversation.status],
      [ada.id, 'channel', null, post.id, 'working'])
    await crew.conversations.settled(ada.id)

    assert.deepEqual(await record(crew, asked.conversation.id), [
      ['message', 'working', { text: 'say' }],
      ['text', 'working', { text: 'The docs say per workspace.' }],
      ['finished', 'idle', { text: 'The docs say per workspace.' }],
    ])
    // Everything about it says which post, so a page never takes it for the agent's task.
    assert.deepEqual((await crew.events.page(asked.conversation.id)).map((event) => event.postId), [post.id, post.id, post.id])
    assert.notEqual((await crew.conversations.get(asked.conversation.id)).closedAt, null)
    assert.deepEqual(await crew.conversations.statuses(), new Map())
    assert.deepEqual(ends, [[ada.id, { type: 'finished', data: { text: 'The docs say per workspace.' }, said: 'The docs say per workspace.' }]])
    assert.deepEqual(crew.freed, [ada.id])

    const [turn] = crew.scripted.turns
    // It is in no workspace, so it answers from an empty folder that is nobody's work.
    assert.equal(turn.folder, crew.asideDir)
    assert.equal(turn.autonomy, 'ask', 'whatever the world has chosen')
    assert.equal(turn.handle, null)
    // Its role, who it is to anyone it talks to, and then what it is asked here.
    assert.match(turn.agent.role, /^Writes the docs\.\n\nYou are \w+, a member of this crew\. Speak as \w+\./)
    assert.ok(turn.agent.role.endsWith(`\n\n${INSTRUCTION}`))
    assert.deepEqual(turn.channel, { workspaces: ['Site'] })
  })
})

test('an agent in a workspace answers from there, and its task is not touched', needsDb, async () => {
  await withPost(async (crew, { ada, site, ask, ends }) => {
    const task = await crew.conversations.send(ada.id, { text: 'work', workspaceId: site.id })
    await crew.conversations.settled(ada.id)
    const before = await record(crew, task.conversation.id)

    const asked = await ask(ada.id, 'quiet')
    await crew.conversations.settled(ada.id)

    assert.equal(asked.conversation.workspaceId, site.id)
    assert.equal(crew.scripted.turns[1].folder, site.folder)
    assert.equal(crew.scripted.turns[1].handle, null, 'a conversation of its own, not a continuation of the task')
    assert.deepEqual(await record(crew, task.conversation.id), before)
    assert.deepEqual((await crew.conversations.statuses()).get(ada.id), { status: 'idle', conversationId: task.conversation.id, workspaceId: site.id })
    // What it said last is its answer when the runtime ends without repeating it.
    assert.equal(ends[0][1].said, 'Only this.')
    // The agent's history is its tasks.
    assert.deepEqual((await crew.conversations.list(ada.id)).map((one) => one.id), [task.conversation.id])
  })
})

test('a busy agent is not asked, and nothing is begun or kept', needsDb, async () => {
  await withPost(async (crew, { ada, bo, site, ask, ends }) => {
    await crew.conversations.send(ada.id, { text: 'long', workspaceId: site.id })
    assert.deepEqual(await ask(ada.id, 'say'), { started: false, status: 'working' })
    // Answering one post is being busy too.
    const first = await ask(bo.id, 'slow')
    assert.equal(first.started, true)
    assert.deepEqual(await ask(bo.id, 'say'), { started: false, status: 'working' })
    await crew.conversations.settled(bo.id)

    assert.deepEqual(ends.map(([agentId, ending]) => [agentId, ending.type]), [[bo.id, 'finished']])
    const [{ count }] = await crew.sql`select count(*)::int as count from conversations where kind = 'channel'`
    assert.equal(count, 1)
    await crew.conversations.stop(ada.id)
  })
})

test('asking is refused for an agent that is not there, has no runtime, or with nothing to say', needsDb, async () => {
  await withPost(async (crew, { ada, ask }) => {
    const claw = await crew.roster.create({ name: 'Claw', runtime: 'openclaw' })
    await assert.rejects(ask('nobody', 'say'), refused('unknown_agent'))
    await assert.rejects(ask(claw.id, 'say'), refused('runtime_unavailable'))
    await assert.rejects(ask(ada.id, '  '), refused('bad_message'))
    assert.equal(crew.scripted.turns.length, 0)
  })
})

test('nothing can be changed from an answer: leave to act is refused at once, and a question is not waited on', needsDb, async () => {
  await withPost(async (crew, { ada, ask, ends }) => {
    await crew.settings.update({ autonomy: 'autonomous' })
    const asked = await ask(ada.id, 'meddle')
    await crew.conversations.settled(ada.id)

    assert.deepEqual(crew.scripted.turns[0].answers.map(({ requestId, answer }) => [requestId, Object.keys(answer)]), [
      ['a1', ['allow', 'message']],
      ['q1', ['answers']],
    ])
    assert.equal(crew.scripted.turns[0].answers[0].answer.allow, false)
    assert.equal(crew.scripted.turns[0].answers[1].answer.answers.length, 2)
    // The agent was never left waiting on a person who was not asked.
    assert.deepEqual((await record(crew, asked.conversation.id)).map(([type, status]) => [type, status]), [
      ['message', 'working'],
      ['text', 'working'],
      ['finished', 'idle'],
    ])
    assert.equal(ends[0][1].said, 'Left alone.')
  })
})

test('a message sent while the agent is answering waits, and goes to its task when the answer is done', needsDb, async () => {
  await withPost(async (crew, { ada, bo, site, ask }) => {
    const task = await crew.conversations.send(ada.id, { text: 'work', workspaceId: site.id })
    await crew.conversations.settled(ada.id)

    const asked = await ask(ada.id, 'slow')
    const sent = await crew.conversations.send(ada.id, { text: 'say' })
    assert.deepEqual([sent.queued, sent.conversation.id], [true, task.conversation.id])
    await assert.rejects(crew.conversations.send(ada.id, { text: 'work', workspaceId: site.id }), refused('agent_busy'))
    await crew.conversations.settled(ada.id)

    assert.deepEqual((await record(crew, asked.conversation.id)).map(([type]) => type), ['message', 'finished'])
    assert.deepEqual((await record(crew, task.conversation.id)).slice(3).map(([type, status]) => [type, status]), [
      ['message', 'working'],
      ['queue', 'working'],
      ['text', 'working'],
      ['finished', 'idle'],
    ])
    assert.deepEqual(crew.scripted.turns.map((turn) => turn.text), ['work', 'slow', 'say'])
    // Free only once what was waiting had been done too.
    assert.deepEqual(crew.freed, [ada.id, ada.id])

    // An agent with no task has nowhere for a message to wait.
    await ask(bo.id, 'slow')
    await assert.rejects(crew.conversations.send(bo.id, { text: 'hello' }), refused('needs_workspace'))
  })
})

test('stopping an agent that is answering ends the answer and leaves its task as it was', needsDb, async () => {
  await withPost(async (crew, { ada, site, ask, ends }) => {
    const task = await crew.conversations.send(ada.id, { text: 'crash', workspaceId: site.id })
    await crew.conversations.settled(ada.id)
    assert.equal(await statusOf(crew, ada.id), 'failed')

    const asked = await ask(ada.id, 'long')
    assert.equal(await statusOf(crew, ada.id), 'working')
    assert.deepEqual(await crew.conversations.stop(ada.id), { stopped: true })

    assert.deepEqual((await record(crew, asked.conversation.id)).at(-1), ['interrupted', 'failed', {}])
    assert.equal(ends[0][1].type, 'interrupted')
    // It is as it was before it was asked: its task had failed, and still has.
    assert.deepEqual((await crew.conversations.statuses()).get(ada.id), { status: 'failed', conversationId: task.conversation.id, workspaceId: site.id })
  })
})

test('a turn can be stopped by the conversation it is in, and then nothing else is', needsDb, async () => {
  await withPost(async (crew, { ada, bo, site, ask, ends }) => {
    const asked = await ask(ada.id, 'long')
    const task = await crew.conversations.send(bo.id, { text: 'long', workspaceId: site.id })

    assert.deepEqual(await crew.conversations.stopIn(ada.id, task.conversation.id), { stopped: false })
    assert.deepEqual(await crew.conversations.stopIn(bo.id, asked.conversation.id), { stopped: false })
    assert.equal(await statusOf(crew, bo.id), 'working')
    assert.equal(await statusOf(crew, ada.id), 'working')

    assert.deepEqual(await crew.conversations.stopIn(ada.id, asked.conversation.id), { stopped: true })
    assert.deepEqual(ends.map(([agentId, ending]) => [agentId, ending.type]), [[ada.id, 'interrupted']])
    assert.deepEqual(await crew.conversations.stopIn(ada.id, asked.conversation.id), { stopped: false })
    assert.deepEqual(await crew.conversations.stopIn(bo.id, task.conversation.id), { stopped: true })
    assert.equal(await statusOf(crew, bo.id), 'idle')
  })
})

test('an answer that fails is told to whoever asked, and the agent is free again', needsDb, async () => {
  await withPost(async (crew, { ada, ask, ends }) => {
    const asked = await ask(ada.id, 'crash')
    await crew.conversations.settled(ada.id)
    assert.deepEqual((await record(crew, asked.conversation.id)).at(-1), ['failed', 'idle', { reason: 'The model is out of credit', code: 'crashed' }])
    assert.deepEqual(ends, [[ada.id, { type: 'failed', data: { reason: 'The model is out of credit', code: 'crashed' }, said: 'Starting.' }]])
    assert.equal(await statusOf(crew, ada.id), 'idle')
    assert.equal((await ask(ada.id, 'say')).started, true)
  })
})

test('a runtime that refuses the answer outright is a failed answer, not a lost one', needsDb, async () => {
  await withPost(async (crew, { ada, ask, ends }) => {
    const start = crew.scripted.start
    crew.scripted.start = () => {
      throw new Error('spawn ENOENT')
    }
    const asked = await ask(ada.id, 'say')
    crew.scripted.start = start
    assert.equal(asked.started, true)
    await crew.conversations.settled(ada.id)

    assert.deepEqual(ends.map(([, ending]) => [ending.type, ending.data.code, ending.said]), [['failed', 'runtime', '']])
    assert.notEqual((await crew.conversations.get(asked.conversation.id)).closedAt, null)
    assert.equal(await statusOf(crew, ada.id), 'idle')
    assert.deepEqual(crew.freed, [ada.id])
  })
})

test('whoever asked is told once, even if what it does on being told throws', needsDb, async () => {
  await withPost(async (crew, { ada, ask }) => {
    let told = 0
    await ask(ada.id, 'say', {
      onEnd: () => {
        told += 1
        throw new Error('the channel fell over')
      },
    })
    await crew.conversations.settled(ada.id)
    assert.equal(told, 1)
    assert.equal(await statusOf(crew, ada.id), 'idle')
    assert.equal(crew.logged.length, 1)
  })
})

test('at start, an answer a stopped server left under way is ended, and the agent is free', needsDb, async () => {
  await withPost(async (crew, { ada, site, post }) => {
    // What a server that stopped mid-answer leaves behind.
    const [left] = await crew.sql`
      insert into conversations (world_id, agent_id, kind, post_id, title) values ('w', ${ada.id}, 'channel', ${post.id}, 'A post') returning id`
    await crew.events.append({ conversationId: left.id, agentId: ada.id, type: 'message', status: 'working', data: { text: 'A post' }, postId: post.id })
    assert.equal(await statusOf(crew, ada.id), 'working')

    assert.equal(await crew.conversations.recover(), 1)
    assert.deepEqual((await record(crew, left.id)).at(-1), ['interrupted', 'idle', { reason: 'restart' }])
    assert.notEqual((await crew.conversations.get(left.id)).closedAt, null)
    assert.equal(await statusOf(crew, ada.id), 'idle')
    assert.equal(await crew.conversations.recover(), 0)

    const sent = await crew.conversations.send(ada.id, { text: 'work', workspaceId: site.id })
    assert.equal(sent.queued, false)
  })
})

test('the engine says when an agent has nothing left under way, and not while more is coming', needsDb, async () => {
  await withPost(async (crew, { ada, site }) => {
    await crew.conversations.send(ada.id, { text: 'slow', workspaceId: site.id })
    await crew.conversations.send(ada.id, { text: 'work' })
    await wait(20)
    assert.deepEqual(crew.freed, [])
    await crew.conversations.settled(ada.id)
    assert.deepEqual(crew.freed, [ada.id])

    await crew.conversations.send(ada.id, { text: 'long' })
    await crew.conversations.stop(ada.id)
    assert.deepEqual(crew.freed, [ada.id, ada.id])
  })
})

test('a task that came from a post says so on its first message', needsDb, async () => {
  await withPost(async (crew, { ada, site, post }) => {
    const sent = await crew.conversations.send(ada.id, { text: 'work', workspaceId: site.id, postId: post.id })
    assert.deepEqual(sent.event.data, { text: 'work', postId: post.id })
    // The task itself is not channel chatter: its events are an ordinary conversation's.
    assert.equal('postId' in sent.event, false)
    await crew.conversations.settled(ada.id)
  })
})

test('a message that waited behind an answer and cannot be delivered does not leave the agent working', needsDb, async () => {
  await withPost(async (crew, { ada, site, ask }) => {
    const task = await crew.conversations.send(ada.id, { text: 'work', workspaceId: site.id })
    await crew.conversations.settled(ada.id)
    const gate = gated()
    await ask(ada.id, 'held')
    await crew.conversations.send(ada.id, { text: 'say' })
    await crew.workspaces.archive(site.id)
    gate.resolve()
    await crew.conversations.settled(ada.id)

    assert.deepEqual((await record(crew, task.conversation.id)).at(-1), ['queue', 'idle', { of: [(await crew.events.page(task.conversation.id)).at(-2).seq], outcome: 'cancelled' }])
    assert.equal(await statusOf(crew, ada.id), 'idle')
  })
})

test('a stop that lands as the answer finishes is still a stop to whoever asked', needsDb, async () => {
  await withPost(async (crew, { ada, ask, ends }) => {
    const gate = gated()
    const asked = await ask(ada.id, 'held')
    // Something ahead of the stop in the agent's line, so the answer finishes while the stop waits.
    const ahead = ask(ada.id, 'say')
    const stopping = crew.conversations.stopIn(ada.id, asked.conversation.id)
    gate.resolve()
    await Promise.all([ahead, stopping])
    await crew.conversations.settled(ada.id)
    assert.deepEqual(ends.map(([, ending]) => ending.type), ['interrupted'])
  })
})
