// test/crew-stream.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { setTimeout as wait } from 'node:timers/promises'
import { handleCrew } from '../server/crew/http.mjs'
import { needsDb } from './support/crew-db.mjs'
import { listen, withTalk } from './support/crew-talk.mjs'

const SCRIPTS = {
  talk: [{ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'text', text: 'Hello' }, { type: 'finished', text: 'Hello' }],
  ask: [
    { type: 'question', requestId: 'q1', questions: [{ question: 'Which colour?', options: ['Red', 'Blue'] }] },
    { wait: 'q1' },
    { type: 'finished', text: 'Blue it is.' },
  ],
  long: [{ pause: 5000 }, { type: 'finished', text: 'never' }],
}

/** A scripted crew behind the real handler, with one agent and one workspace. */
const withServer = (run, { stream = {}, ...options } = {}) =>
  withTalk(async (crew) => {
    const server = http.createServer((req, res) => handleCrew(req, res, new URL(req.url, 'http://localhost'), crew, { stream }))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/crew`
    const call = async (method, route, body) => {
      const res = await fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await res.json() }
    }
    const agent = await crew.roster.create({ name: 'Ada', runtime: 'claude-code' })
    const site = await crew.workspaces.create({ name: 'Site' })
    const streams = []
    const open = async (query = '', headers) => {
      const stream = await listen(`${base}/events${query}`, headers)
      streams.push(stream)
      return stream
    }
    try {
      return await run({ crew, call, open, base, agent, site })
    } finally {
      for (const stream of streams) stream.close()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }, { scripts: SCRIPTS, ...options })

const kinds = (items) => items.map((item) => (item.event === 'event' ? item.data.type : item.event))

test('the stream says where the world is, then sends what happens as it happens', needsDb, async () => {
  await withServer(async ({ crew, open, agent, site }) => {
    const stream = await open()
    assert.equal(stream.res.status, 200)
    assert.match(stream.res.headers.get('content-type'), /^text\/event-stream/)
    assert.equal(stream.res.headers.get('cache-control'), 'no-store')
    await stream.until(1)
    assert.deepEqual(stream.items[0], { id: null, event: 'hello', data: { seq: 0 } })

    const { conversation } = await crew.conversations.send(agent.id, { text: 'talk', workspaceId: site.id })
    await stream.until(6)
    assert.deepEqual(kinds(stream.items), ['hello', 'message', 'delta', 'delta', 'text', 'finished'])
    assert.deepEqual(stream.items.map((item) => item.id), [null, 1, null, null, 2, 3])
    assert.deepEqual(stream.items[2].data, { conversationId: conversation.id, agentId: agent.id, text: 'Hel' })
    assert.deepEqual(stream.items[5].data, {
      seq: 3, conversationId: conversation.id, agentId: agent.id, type: 'finished', status: 'idle',
      at: stream.items[5].data.at, data: { text: 'Hello' },
    })
  })
})

test('a client that comes back is sent exactly what it missed, by number or by its last id', needsDb, async () => {
  await withServer(async ({ crew, open, agent, site }) => {
    await crew.conversations.send(agent.id, { text: 'talk', workspaceId: site.id })
    await crew.conversations.settled(agent.id)

    const fromOne = await open('?after=1')
    await fromOne.until(3)
    assert.deepEqual(fromOne.items.map((item) => [item.event, item.id]), [['hello', null], ['event', 2], ['event', 3]])
    assert.deepEqual(fromOne.items[0].data, { seq: 3 })

    const byHeader = await open('', { 'Last-Event-ID': '2' })
    await byHeader.until(2)
    assert.deepEqual(byHeader.items.map((item) => item.id), [null, 3])

    const fresh = await open()
    const all = await open('?after=0')
    await all.until(4)
    await crew.conversations.send(agent.id, { text: 'hello' })
    await fresh.until(4)
    assert.deepEqual(fresh.items.map((item) => item.id), [null, 4, 5, 6], 'a first visit starts from now')
    await all.until(7)
    assert.deepEqual(all.items.map((item) => item.id), [null, 1, 2, 3, 4, 5, 6])
  })
})

test('a client that connects while events are being written sees each of them once', needsDb, async () => {
  await withServer(async ({ crew, open, agent }) => {
    const { conversationId } = await (async () => {
      const [row] = await crew.sql`insert into conversations (world_id, agent_id, workspace_id)
        select 'w', ${agent.id}, id from workspaces limit 1 returning id`
      return { conversationId: row.id }
    })()
    const write = (n) => crew.events.append({ conversationId, agentId: agent.id, type: 'text', status: 'working', data: { n } })
    for (let n = 0; n < 700; n += 1) await write(n)

    // Keep writing while four clients connect and catch up, each from a different place.
    const writing = (async () => {
      for (let n = 700; n < 1000; n += 1) await write(n)
    })()
    const streams = []
    for (const after of [0, 250, 699, 700]) {
      streams.push([after, await open(`?after=${after}`)])
      await wait(15)
    }
    await writing
    for (const [after, stream] of streams) {
      await stream.until(1000 - after + 1, 10_000)
      const ids = stream.items.filter((item) => item.event === 'event').map((item) => item.id)
      assert.deepEqual(ids, Array.from({ length: 1000 - after }, (_, n) => after + n + 1), `from ${after}`)
    }
  })
})

test('a client ahead of the world is told where the world is and sent everything new', needsDb, async () => {
  await withServer(async ({ crew, open, agent, site }) => {
    const stream = await open('?after=5000')
    await stream.until(1)
    assert.deepEqual(stream.items[0].data, { seq: 0 })
    await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
    await stream.until(4)
    assert.deepEqual(stream.items.map((item) => item.id), [null, 1, 2, 3])
  })
})

test('a place to start from that is not a number is refused', needsDb, async () => {
  await withServer(async ({ call, base }) => {
    for (const bad of ['abc', '-1', '1.5', '', '99999999999999999999']) {
      const res = await call('GET', `/events?after=${bad}`)
      assert.deepEqual([res.status, res.body.code], [400, 'bad_query'], bad)
    }
    const res = await fetch(`${base}/events`, { headers: { 'Last-Event-ID': 'x' } })
    assert.equal(res.status, 400)
    const post = await call('POST', '/events', {})
    assert.deepEqual([post.status, post.body.code], [405, 'method_not_allowed'])
  })
})

test('a quiet stream is kept open with a heartbeat', needsDb, async () => {
  await withServer(async ({ open }) => {
    const stream = await open()
    await stream.until(1)
    await wait(120)
    assert.ok(stream.comments.length >= 2, `${stream.comments.length} heartbeats`)
  }, { stream: { heartbeatMs: 30 } })
})

test('a client that leaves is forgotten', needsDb, async () => {
  await withServer(async ({ crew, open }) => {
    const before = crew.hub.size
    const stream = await open()
    await stream.until(1)
    assert.equal(crew.hub.size, before + 1)
    stream.close()
    for (let n = 0; n < 40 && crew.hub.size !== before; n += 1) await wait(10)
    assert.equal(crew.hub.size, before)
  })
})

test('one client too many is turned away, and let in once another leaves', needsDb, async () => {
  await withServer(async ({ call, open }) => {
    const first = await open()
    const second = await open()
    await Promise.all([first.until(1), second.until(1)])
    const res = await call('GET', '/events')
    assert.deepEqual([res.status, res.body.code], [503, 'too_many_clients'])
    first.close()
    await wait(60)
    const third = await open()
    await third.until(1)
    assert.equal(third.res.status, 200)
  }, { stream: { maxClients: 2 } })
})

test('a client that stops reading is dropped, and the others and the record carry on', needsDb, async () => {
  await withServer(async ({ crew, open, base, agent }) => {
    const [row] = await crew.sql`insert into conversations (world_id, agent_id, workspace_id)
      select 'w', ${agent.id}, id from workspaces limit 1 returning id`
    // A client that asks and then never reads a byte.
    const url = new URL(`${base}/events`)
    const stuck = await new Promise((resolve, reject) => {
      const req = http.get({ host: url.hostname, port: url.port, path: url.pathname }, (res) => {
        res.pause()
        resolve({ req, res })
      })
      req.on('error', reject)
    })
    let dropped = false
    stuck.res.on('close', () => {
      dropped = true
    })
    const healthy = await open()
    await healthy.until(1)

    const big = 'x'.repeat(64 * 1024)
    for (let n = 0; n < 60; n += 1) {
      await crew.events.append({ conversationId: row.id, agentId: agent.id, type: 'text', status: 'working', data: { text: big } })
    }
    await healthy.until(61, 10_000)
    stuck.res.resume()
    for (let n = 0; n < 100 && !dropped; n += 1) await wait(20)
    assert.equal(dropped, true, 'the client that would not read was disconnected')
    assert.equal(await crew.events.head(), 60)
    stuck.req.destroy()
  }, { stream: { maxBufferedBytes: 256 * 1024 } })
})

test('a monitor-only server has no stream', async () => {
  const server = http.createServer((req, res) => handleCrew(req, res, new URL(req.url, 'http://localhost'), null))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/crew/events`)
    assert.equal(res.status, 404)
    assert.equal((await res.json()).code, 'crew_disabled')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the stream outlives the deadline every other request has', needsDb, async () => {
  await withTalk(async (crew) => {
    const server = http.createServer((req, res) =>
      handleCrew(req, res, new URL(req.url, 'http://localhost'), crew, { deadlineMs: 40 })
    )
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const stream = await listen(`http://127.0.0.1:${server.address().port}/api/crew/events`)
    try {
      await stream.until(1)
      await wait(150)
      const agent = await crew.roster.create({ name: 'Ada', runtime: 'claude-code' })
      const site = await crew.workspaces.create({ name: 'Site' })
      await crew.conversations.send(agent.id, { text: 'hello', workspaceId: site.id })
      await stream.until(4)
      assert.deepEqual(kinds(stream.items), ['hello', 'message', 'text', 'finished'])
    } finally {
      stream.close()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

// The routes.

test('an agent is messaged, answered and stopped over HTTP, and the roster says how it is doing', needsDb, async () => {
  await withServer(async ({ crew, call, open, agent, site }) => {
    const stream = await open()
    await stream.until(1)

    const idle = await call('GET', '/agents')
    assert.deepEqual(
      idle.body.agents.map((a) => [a.name, a.status, a.conversationId, a.workspaceId]),
      [['Ada', 'idle', null, null]]
    )

    const sent = await call('POST', `/agents/${agent.id}/messages`, { text: 'ask', workspaceId: site.id })
    assert.equal(sent.status, 202)
    assert.equal(sent.body.queued, false)
    assert.deepEqual([sent.body.event.type, sent.body.event.data], ['message', { text: 'ask' }])
    const talk = sent.body.conversation
    assert.deepEqual([talk.agentId, talk.workspaceId, talk.title], [agent.id, site.id, 'ask'])

    await stream.until(3)
    const waiting = await call('GET', '/agents')
    assert.deepEqual(
      waiting.body.agents.map((a) => [a.status, a.conversationId, a.workspaceId]),
      [['waiting', talk.id, site.id]]
    )

    const queued = await call('POST', `/agents/${agent.id}/messages`, { text: 'and then this' })
    assert.deepEqual([queued.status, queued.body.queued], [202, true])

    const wrong = await call('POST', `/conversations/${talk.id}/answers`, { requestId: 'q1', allow: true })
    assert.deepEqual([wrong.status, wrong.body.code], [400, 'bad_answer'])
    const answered = await call('POST', `/conversations/${talk.id}/answers`, { requestId: 'q1', answers: ['Blue'] })
    assert.equal(answered.status, 200)
    assert.deepEqual(answered.body.event.data, { requestId: 'q1', answers: ['Blue'] })
    const again = await call('POST', `/conversations/${talk.id}/answers`, { requestId: 'q1', answers: ['Blue'] })
    assert.deepEqual([again.status, again.body.code], [409, 'unknown_request'])

    await crew.conversations.settled(agent.id)
    const listed = await call('GET', `/agents/${agent.id}/conversations`)
    assert.deepEqual(listed.body.conversations.map((c) => [c.id, c.status]), [[talk.id, 'idle']])
    const one = await call('GET', `/conversations/${talk.id}`)
    assert.deepEqual(one.body.conversation, listed.body.conversations[0])

    const events = await call('GET', `/conversations/${talk.id}/events`)
    assert.deepEqual(events.body.events.map((e) => e.type), [
      'message', 'question', 'message', 'answer', 'finished', 'queue', 'text', 'finished',
    ])
    const tail = await call('GET', `/conversations/${talk.id}/events?limit=2`)
    assert.deepEqual(tail.body.events.map((e) => e.seq), [7, 8])
    const earlier = await call('GET', `/conversations/${talk.id}/events?before=7&limit=2`)
    assert.deepEqual(earlier.body.events.map((e) => e.seq), [5, 6])
    const later = await call('GET', `/conversations/${talk.id}/events?after=6`)
    assert.deepEqual(later.body.events.map((e) => e.seq), [7, 8])

    await call('POST', `/agents/${agent.id}/messages`, { text: 'long' })
    const stopped = await call('POST', `/agents/${agent.id}/stop`)
    assert.deepEqual([stopped.status, stopped.body], [200, { stopped: true }])
    const nothing = await call('POST', `/agents/${agent.id}/stop`)
    assert.deepEqual(nothing.body, { stopped: false })
    assert.equal((await call('GET', '/agents')).body.agents[0].status, 'idle')
  })
})

test('the conversation routes refuse what they should', needsDb, async () => {
  await withServer(async ({ call, agent, site }) => {
    const none = '00000000-0000-7000-8000-000000000000'
    const cases = [
      ['POST', `/agents/${agent.id}/messages`, { text: 'hello' }, 409, 'needs_workspace'],
      ['POST', `/agents/${agent.id}/messages`, { text: '' , workspaceId: site.id }, 400, 'bad_message'],
      ['POST', `/agents/${agent.id}/messages`, { text: 'hello', workspaceId: none }, 404, 'unknown_workspace'],
      ['POST', `/agents/${none}/messages`, { text: 'hello', workspaceId: site.id }, 404, 'unknown_agent'],
      ['GET', `/agents/${agent.id}/messages`, undefined, 405, 'method_not_allowed'],
      ['POST', `/agents/${none}/stop`, undefined, 404, 'unknown_agent'],
      ['GET', `/agents/${agent.id}/stop`, undefined, 405, 'method_not_allowed'],
      ['GET', `/agents/${agent.id}/nonsense`, undefined, 404, 'not_found'],
      ['GET', `/agents/${agent.id}/conversations/extra`, undefined, 404, 'not_found'],
      ['GET', '/agents/not-an-id/conversations', undefined, 404, 'unknown_agent'],
      ['GET', `/conversations/${none}`, undefined, 404, 'unknown_conversation'],
      ['GET', `/conversations/${none}/events`, undefined, 404, 'unknown_conversation'],
      ['POST', `/conversations/${none}/answers`, { requestId: 'q', text: 'x' }, 404, 'unknown_conversation'],
      ['GET', '/conversations', undefined, 404, 'not_found'],
      ['PATCH', '/settings', { autonomy: 'reckless' }, 400, 'bad_autonomy'],
      ['DELETE', '/settings', undefined, 405, 'method_not_allowed'],
      ['GET', '/settings/extra', undefined, 404, 'not_found'],
    ]
    for (const [method, route, body, status, code] of cases) {
      const res = await call(method, route, body)
      assert.deepEqual([res.status, res.body.code], [status, code], `${method} ${route}`)
    }
    const sent = await call('POST', `/agents/${agent.id}/messages`, { text: 'hello', workspaceId: site.id })
    for (const query of ['limit=0', 'limit=501', 'limit=x', 'after=-1', 'before=1.5', 'after=1&before=2']) {
      const res = await call('GET', `/conversations/${sent.body.conversation.id}/events?${query}`)
      assert.deepEqual([res.status, res.body.code], [400, 'bad_query'], query)
    }
  })
})

test('the world\'s settings are read and changed over HTTP, one at a time or together', needsDb, async () => {
  await withServer(async ({ call }) => {
    assert.deepEqual((await call('GET', '/settings')).body, { settings: { autonomy: 'autonomous', channelLimit: null } })
    const changed = await call('PATCH', '/settings', { autonomy: 'ask' })
    assert.deepEqual([changed.status, changed.body], [200, { settings: { autonomy: 'ask', channelLimit: null } }])
    const limited = await call('PATCH', '/settings', { channelLimit: 3 })
    assert.deepEqual([limited.status, limited.body], [200, { settings: { autonomy: 'ask', channelLimit: 3 } }])
    const refused = await call('PATCH', '/settings', { channelLimit: 0 })
    assert.deepEqual([refused.status, refused.body.code], [400, 'bad_channel_limit'])
    assert.deepEqual((await call('GET', '/settings')).body, { settings: { autonomy: 'ask', channelLimit: 3 } })
  })
})

test('retiring an agent stops what it was doing', needsDb, async () => {
  await withServer(async ({ crew, call, agent, site }) => {
    const sent = await call('POST', `/agents/${agent.id}/messages`, { text: 'long', workspaceId: site.id })
    const retired = await call('DELETE', `/agents/${agent.id}`)
    assert.equal(retired.status, 200)
    const events = await crew.events.page(sent.body.conversation.id)
    assert.equal(events.at(-1).type, 'interrupted')
    assert.notEqual((await crew.conversations.get(sent.body.conversation.id)).closedAt, null)
    const after = await call('POST', `/agents/${agent.id}/messages`, { text: 'hello' })
    assert.deepEqual([after.status, after.body.code], [404, 'unknown_agent'])
  })
})

// Found in review.

test('when a client gives both a query and a last id, the later of the two is where it starts', needsDb, async () => {
  await withServer(async ({ crew, open, agent, site }) => {
    await crew.conversations.send(agent.id, { text: 'talk', workspaceId: site.id })
    await crew.conversations.settled(agent.id)
    // As a browser reconnects: the address it first used, and the last id it was sent.
    const back = await open('?after=0', { 'Last-Event-ID': '2' })
    await back.until(2)
    await wait(50)
    assert.deepEqual(back.items.map((item) => item.id), [null, 3])
    const ahead = await open('?after=3', { 'Last-Event-ID': '1' })
    await ahead.until(1)
    await wait(50)
    assert.deepEqual(ahead.items.map((item) => item.id), [null])
  })
})

test('a client reading a long backlog at its own pace is not cut off for being behind', needsDb, async () => {
  await withServer(async ({ crew, base, agent }) => {
    const [row] = await crew.sql`insert into conversations (world_id, agent_id, workspace_id)
      select 'w', ${agent.id}, id from workspaces limit 1 returning id`
    const big = 'x'.repeat(3000)
    for (let n = 0; n < 1500; n += 1) {
      await crew.events.append({ conversationId: row.id, agentId: agent.id, type: 'text', status: 'working', data: { text: big } })
    }
    // 4.5 MB of backlog, a 256 KB allowance, and a reader that takes a breath between chunks.
    const url = new URL(`${base}/events?after=0`)
    const got = await new Promise((resolve, reject) => {
      let ids = 0
      let pending = ''
      const req = http.get({ host: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
        res.on('data', (chunk) => {
          pending += chunk
          ids += (pending.match(/^id: /gm) || []).length
          pending = pending.slice(pending.lastIndexOf('\n\n') + 2)
          if (ids >= 1500) {
            req.destroy()
            return resolve(ids)
          }
          res.pause()
          setTimeout(() => res.resume(), 2)
        })
        res.on('close', () => resolve(ids))
      })
      req.on('error', reject)
    })
    assert.equal(got, 1500, 'the whole backlog arrived on one connection')
  }, { stream: { maxBufferedBytes: 256 * 1024 } })
})
