// test/crew-end-to-end.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createCrew } from '../server/crew/index.mjs'
import { handleCrew } from '../server/crew/http.mjs'
import { createScriptedRuntime } from '../server/crew/runtimes/scripted.mjs'
import { connect } from '../server/crew/store/db.mjs'
import { TEST_DB, needsDb } from './support/crew-db.mjs'
import { listen } from './support/crew-talk.mjs'

const SCRIPTS = {
  'Tidy the README': [
    { type: 'tool', id: 't1', name: 'Edit', summary: 'Edit: README.md', status: 'started' },
    { type: 'tool', id: 't1', name: 'Edit', summary: 'Edit: README.md', status: 'finished' },
    { type: 'text', text: 'Tidied.' },
    { type: 'finished', text: 'Tidied.' },
  ],
  long: [{ pause: 5000 }, { type: 'finished', text: 'never' }],
}

/** A crew made the way the server makes one, in a schema and a directory thrown away after. */
async function world(run, scripts = SCRIPTS) {
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-e2e-'))
  const config = { databaseUrl: TEST_DB, schema, dataDir, worldId: 'acme', agentLimit: 3, entitled: [] }
  const scripted = createScriptedRuntime(scripts)
  const start = () => createCrew(config, { runtimes: { get: () => scripted, available: () => ['scripted'] } })
  const crews = []
  try {
    return await run(async () => {
      const crew = await start()
      crews.push(crew)
      return crew
    }, { dataDir, scripted })
  } finally {
    for (const crew of crews) await crew.close().catch(() => {})
    const admin = connect(TEST_DB, { max: 1 })
    await admin.unsafe(`drop schema if exists "${schema}" cascade`)
    await admin.end({ timeout: 5 })
    await fs.rm(dataDir, { recursive: true, force: true })
  }
}

async function serving(crew, run) {
  const server = http.createServer((req, res) => handleCrew(req, res, new URL(req.url, 'http://localhost'), crew))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/crew`
  const call = async (method, route, body) => {
    const res = await fetch(base + route, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    return await run(call, base)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('from nothing: an agent is made, given a task, and watched doing it, all over HTTP', needsDb, async () => {
  await world(async (start) => {
    const crew = await start()
    await serving(crew, async (call, base) => {
      const stream = await listen(`${base}/events?after=0`)
      try {
        const { agent } = (await call('POST', '/agents', { name: 'Ada', runtime: 'claude-code', role: 'Keeps the docs.' })).body
        const { workspace } = (await call('POST', '/workspaces', { name: 'Site', description: 'The website.' })).body
        assert.equal(agent.status, 'idle')

        const sent = await call('POST', `/agents/${agent.id}/messages`, { text: 'Tidy the README', workspaceId: workspace.id })
        assert.equal(sent.status, 202)
        await stream.until(6)
        assert.deepEqual(
          stream.items.map((item) => (item.event === 'event' ? [item.id, item.data.type, item.data.status] : [item.event])),
          [['hello'], [1, 'message', 'working'], [2, 'tool', 'working'], [3, 'tool', 'working'], [4, 'text', 'working'], [5, 'finished', 'idle']]
        )
        const roster = (await call('GET', '/agents')).body.agents
        assert.deepEqual([roster[0].status, roster[0].workspaceId], ['idle', workspace.id])
        const kept = (await call('GET', `/conversations/${sent.body.conversation.id}/events`)).body.events
        assert.deepEqual(kept, stream.items.slice(1).map((item) => item.data), 'what was streamed is what was stored')
      } finally {
        stream.close()
      }
    })
  })
})

test('a server that starts finds what the last one left running, and marks it interrupted', needsDb, async () => {
  await world(async (start) => {
    const first = await start()
    const agent = await first.roster.create({ name: 'Ada', runtime: 'claude-code' })
    const site = await first.workspaces.create({ name: 'Site' })
    const { conversation } = await first.conversations.send(agent.id, { text: 'long', workspaceId: site.id })

    // The first server is not stopped, as one that was killed is not: a second starts on its record.
    const second = await start()
    assert.equal((await second.conversations.statuses()).get(agent.id).status, 'idle')
    const last = (await second.events.page(conversation.id)).at(-1)
    assert.deepEqual([last.type, last.data], ['interrupted', { reason: 'restart' }])

    const again = await second.conversations.send(agent.id, { text: 'Tidy the README' })
    await second.conversations.settled(agent.id)
    assert.equal(again.conversation.id, conversation.id)
    assert.equal((await second.events.page(conversation.id)).at(-1).type, 'finished')
  })
})

test('closing a crew stops its agents and records that before the database is let go', needsDb, async () => {
  await world(async (start) => {
    const crew = await start()
    const agent = await crew.roster.create({ name: 'Ada', runtime: 'claude-code' })
    const site = await crew.workspaces.create({ name: 'Site' })
    const { conversation } = await crew.conversations.send(agent.id, { text: 'long', workspaceId: site.id })
    await crew.close()

    const after = await start()
    const last = (await after.events.page(conversation.id)).at(-1)
    assert.deepEqual([last.type, last.data], ['interrupted', {}])
  })
})

/** Ask until the answer is what is wanted. */
async function eventually(ask, wanted, ms = 5000) {
  const deadline = Date.now() + ms
  for (;;) {
    const answer = await ask()
    if (wanted(answer)) return answer
    if (Date.now() > deadline) throw new Error(`it never came to that: ${JSON.stringify(answer)}`)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

test('the crew channel over HTTP: a post, who answered, the one that took it, and taking it back', needsDb, async () => {
  const gate = Promise.withResolvers()
  const said = (text) => [{ type: 'text', text }, { type: 'finished', text }]
  const scripts = (input) => {
    if (!input.channel) return input.agent.name === 'Ada' ? [{ pause: 5000 }, { type: 'finished', text: 'never' }] : said('Done.')
    return input.agent.name === 'Ada' ? [{ until: gate.promise }, ...said('CLAIM: Site\nI will fix it.')] : said('It is in layout.css.')
  }
  await world(async (start, { dataDir, scripted }) => {
    const crew = await start()
    await serving(crew, async (call, base) => {
      const ada = (await call('POST', '/agents', { name: 'Ada', runtime: 'claude-code' })).body.agent
      const bo = (await call('POST', '/agents', { name: 'Bo', runtime: 'claude-code' })).body.agent
      const site = (await call('POST', '/workspaces', { name: 'Site' })).body.workspace
      assert.deepEqual((await call('GET', '/channel')).body, { posts: [], seq: 0 })
      const stream = await listen(`${base}/events?after=0`)
      try {
        const made = await call('POST', '/channel', { text: 'Fix the footer' })
        assert.equal(made.status, 202)
        const { id } = made.body.post
        assert.deepEqual(made.body.post.to.map((one) => one.name), ['Ada', 'Bo'])

        await eventually(() => call('GET', `/channel/${id}`), (got) => got.body.post.to[1].state === 'replied')
        // Ada is still answering, and the roster says she is busy without moving her anywhere.
        const busy = (await call('GET', '/agents')).body.agents.find((agent) => agent.id === ada.id)
        assert.deepEqual([busy.status, busy.conversationId, busy.workspaceId], ['working', null, null])
        gate.resolve()
        const taken = (await eventually(() => call('GET', `/channel/${id}`), (got) => got.body.post.claim?.conversationId)).body.post
        assert.deepEqual([taken.claim.agentId, taken.claim.workspaceId, taken.claim.state], [ada.id, site.id, 'granted'])
        assert.deepEqual(taken.to.map((one) => [one.name, one.state, one.text]), [['Ada', 'claimed', 'I will fix it.'], ['Bo', 'replied', 'It is in layout.css.']])

        const working = (await call('GET', '/agents')).body.agents.find((agent) => agent.id === ada.id)
        assert.deepEqual([working.status, working.conversationId, working.workspaceId], ['working', taken.claim.conversationId, site.id])
        // An answer was given from a folder that is nobody's work, at the level that asks.
        const asides = scripted.turns.filter((turn) => turn.channel)
        assert.deepEqual(asides.map((turn) => [turn.folder, turn.autonomy]), [[path.join(dataDir, 'channel'), 'ask'], [path.join(dataDir, 'channel'), 'ask']])
        assert.deepEqual(await fs.readdir(path.join(dataDir, 'channel')), [])

        const listed = (await call('GET', '/channel')).body
        assert.deepEqual(listed.posts, [taken])
        assert.ok(listed.seq > 0)

        // The stream said all of it: every change to the post, and each agent's answer marked as the post's.
        const items = stream.items.filter((item) => item.event === 'event').map((item) => item.data)
        const about = items.filter((event) => event.type === 'post')
        assert.ok(about.length >= 4)
        assert.deepEqual(about.at(-1).data, taken)
        assert.ok(items.filter((event) => event.conversationId && event.conversationId !== taken.claim.conversationId).every((event) => event.postId === id))
        assert.ok(items.filter((event) => event.conversationId === taken.claim.conversationId).every((event) => !('postId' in event)))

        const released = await call('POST', `/channel/${id}/release`)
        assert.deepEqual([released.status, released.body.post.claim.state, released.body.post.claim.reason], [200, 'released', 'released'])
        assert.equal((await call('GET', '/agents')).body.agents.find((agent) => agent.id === ada.id).status, 'idle')
        assert.deepEqual([(await call('POST', `/channel/${id}/release`)).status, (await call('POST', `/channel/${id}/release`)).body.code], [409, 'no_claim'])

        const handed = await call('POST', `/channel/${id}/hand`, { agentId: bo.id })
        assert.deepEqual([handed.status, handed.body.post.claim.agentId, handed.body.post.claim.workspaceId, handed.body.post.claim.state], [200, bo.id, site.id, 'granted'])

        for (const [method, route, body, status, code] of [
          ['POST', '/channel', {}, 400, 'bad_post'],
          ['POST', '/channel', { text: '@Nobody hello' }, 400, 'unknown_mention'],
          ['GET', '/channel?limit=0', undefined, 400, 'bad_query'],
          ['GET', '/channel?before=yesterday', undefined, 400, 'bad_query'],
          ['PUT', '/channel', {}, 405, 'method_not_allowed'],
          ['GET', '/channel/nothing', undefined, 404, 'unknown_post'],
          ['DELETE', `/channel/${id}`, undefined, 405, 'method_not_allowed'],
          ['GET', `/channel/${id}/release`, undefined, 405, 'method_not_allowed'],
          ['POST', `/channel/${id}/hand`, {}, 404, 'unknown_agent'],
          ['POST', `/channel/${id}/steal`, {}, 404, 'not_found'],
          ['POST', `/channel/${id}/hand/again`, {}, 404, 'not_found'],
        ]) {
          const got = await call(method, route, body)
          assert.deepEqual([got.status, got.body.code], [status, code], `${method} ${route}`)
        }
      } finally {
        stream.close()
      }
    })
  }, scripts)
})

test('a post waiting for a busy agent is still delivered by the server that starts next', needsDb, async () => {
  const said = (text) => [{ type: 'text', text }, { type: 'finished', text }]
  const scripts = (input) => (input.channel ? said('Here now.') : [{ pause: 5000 }, { type: 'finished', text: 'never' }])
  await world(async (start) => {
    const first = await start()
    const ada = await first.roster.create({ name: 'Ada', runtime: 'claude-code' })
    const site = await first.workspaces.create({ name: 'Site' })
    await first.conversations.send(ada.id, { text: 'long', workspaceId: site.id })
    const post = await first.channel.post({ text: '@Ada when you are done' })
    assert.deepEqual(post.to.map((one) => one.state), ['queued'])

    // Killed, not closed: the next server finds Ada's turn gone and the post still waiting.
    const second = await start()
    const now = await eventually(() => second.channel.get(post.id), (got) => got.to[0].state === 'replied')
    assert.equal(now.to[0].text, 'Here now.')
    await second.channel.settled()
  }, scripts)
})

test('closing a crew while agents are answering leaves nothing answering and starts nothing new', needsDb, async () => {
  const scripts = (input) => (input.channel ? [{ pause: 5000 }, { type: 'finished', text: 'CLAIM: Site' }] : [{ type: 'finished', text: 'Done.' }])
  await world(async (start, { scripted }) => {
    const crew = await start()
    const ada = await crew.roster.create({ name: 'Ada', runtime: 'claude-code' })
    await crew.workspaces.create({ name: 'Site' })
    const first = await crew.channel.post({ text: '@Ada one' })
    const second = await crew.channel.post({ text: '@Ada two' })
    assert.deepEqual([first.to[0].state, second.to[0].state], ['answering', 'queued'])
    await crew.close()
    assert.equal(scripted.turns.length, 1, 'being stopped did not hand Ada the post that was waiting')

    const after = await start()
    assert.deepEqual((await after.channel.get(first.id)).to.map((one) => [one.state, one.reason]), [['failed', 'stopped']])
    await eventually(() => after.channel.get(second.id), (got) => got.to[0].state === 'answering')
    assert.equal((await after.conversations.statuses()).get(ada.id).status, 'working')
  }, scripts)
})
