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
async function world(run) {
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-e2e-'))
  const config = { databaseUrl: TEST_DB, schema, dataDir, worldId: 'acme', agentLimit: 3, entitled: [] }
  const scripted = createScriptedRuntime(SCRIPTS)
  const start = () => createCrew(config, { runtimes: { get: () => scripted, available: () => ['scripted'] } })
  const crews = []
  try {
    return await run(async () => {
      const crew = await start()
      crews.push(crew)
      return crew
    })
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
