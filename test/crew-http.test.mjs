// test/crew-http.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { handleCrew } from '../server/crew/http.mjs'
import { needsDb } from './support/crew-db.mjs'
import { withTalk } from './support/crew-talk.mjs'
import { withEnv } from './support/env.mjs'

/** Serve `crew` (or no crew) on a loopback port and hand back a JSON caller. */
async function serving(crew, run) {
  const server = http.createServer((req, res) => handleCrew(req, res, new URL(req.url, 'http://localhost'), crew))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, route, body) => {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    return await run(call)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const withCrew = (run, options = {}) =>
  withTalk((crew) => serving(crew, (call) => run(call, { sql: crew.sql, crew })), { limit: 2, entitled: ['quill'], ...options })

test('with no crew the server says so, and every other route is switched off', async () => {
  await serving(null, async (call) => {
    assert.deepEqual(await call('GET', '/api/crew'), { status: 200, body: { enabled: false } })
    for (const [method, route] of [['GET', '/api/crew/agents'], ['POST', '/api/crew/agents'], ['GET', '/api/crew/workspaces']]) {
      const res = await call(method, route, method === 'POST' ? {} : undefined)
      assert.equal(res.status, 404)
      assert.equal(res.body.code, 'crew_disabled')
    }
  })
})

test('the status route gives the world and the counts', needsDb, async () => {
  await withCrew(async (call) => {
    assert.deepEqual(await call('GET', '/api/crew'), {
      status: 200,
      body: { enabled: true, worldId: 'w', counts: { standard: { used: 0, limit: 2 }, curated: { used: 0 } } },
    })
  })
})

test('agents can be made, listed, changed and retired', needsDb, async () => {
  await withCrew(async (call) => {
    const made = await call('POST', '/api/crew/agents', { name: 'Ada', kind: 'rock', runtime: 'hermes', role: 'Writes docs.' })
    assert.equal(made.status, 201)
    const { agent } = made.body
    assert.deepEqual([agent.name, agent.kind, agent.runtime, agent.role, agent.curated], ['Ada', 'rock', 'hermes', 'Writes docs.', false])

    const listed = await call('GET', '/api/crew/agents')
    assert.deepEqual(listed.body.agents.map((a) => a.id), [agent.id])
    assert.deepEqual(listed.body.counts.standard, { used: 1, limit: 2 })

    const changed = await call('PATCH', `/api/crew/agents/${agent.id}`, { name: 'Grace' })
    assert.deepEqual([changed.status, changed.body.agent.name, changed.body.agent.id], [200, 'Grace', agent.id])

    assert.deepEqual(await call('DELETE', `/api/crew/agents/${agent.id}`), { status: 200, body: { ok: true } })
    assert.deepEqual((await call('GET', '/api/crew/agents')).body.agents, [])
  })
})

test('a specialist is made from its template id', needsDb, async () => {
  await withCrew(async (call) => {
    const before = await call('GET', '/api/crew/specialists')
    assert.deepEqual(before.body.specialists.map((s) => [s.id, s.entitled, s.agentId]), [['quill', true, null]])
    const made = await call('POST', '/api/crew/agents', { templateId: 'quill' })
    assert.deepEqual([made.status, made.body.agent.name, made.body.agent.curated], [201, 'Quill', true])
    assert.equal((await call('GET', '/api/crew/specialists')).body.specialists[0].agentId, made.body.agent.id)
  })
})

test('a refusal answers with its status, its code and its words', needsDb, async () => {
  await withCrew(async (call) => {
    await call('POST', '/api/crew/agents', { name: 'Ada', runtime: 'hermes' })
    await call('POST', '/api/crew/agents', { name: 'Bolt', runtime: 'hermes' })
    const cases = [
      [await call('POST', '/api/crew/agents', { runtime: 'hermes' }), 409, 'agent_limit'],
      [await call('POST', '/api/crew/agents', { runtime: 'gpt' }), 400, 'bad_runtime'],
      [await call('POST', '/api/crew/agents', { templateId: 'nobody' }), 404, 'unknown_template'],
      [await call('PATCH', '/api/crew/agents/not-an-id', { name: 'Zed' }), 404, 'unknown_agent'],
      [await call('DELETE', '/api/crew/agents/00000000-0000-7000-8000-000000000000'), 404, 'unknown_agent'],
      [await call('POST', '/api/crew/workspaces', { name: '' }), 400, 'bad_workspace_name'],
      [await call('POST', '/api/crew/workspaces', { name: 'A', gitUrl: '--upload-pack=x' }), 400, 'bad_git_url'],
    ]
    for (const [res, status, code] of cases) {
      assert.deepEqual([res.status, res.body.code], [status, code])
      assert.ok(res.body.error.length > 5)
    }
    assert.match(cases[0][0].body.error, /2 of 2/)
  })
})

test('workspaces can be made, listed, changed and archived', needsDb, async () => {
  await withCrew(async (call) => {
    const made = await call('POST', '/api/crew/workspaces', { name: 'Billing', description: 'Invoices and payments.' })
    assert.equal(made.status, 201)
    const { workspace } = made.body
    assert.deepEqual([workspace.name, workspace.description, workspace.gitUrl], ['Billing', 'Invoices and payments.', null])
    assert.equal('folder' in workspace, false, 'a path on the server is not the page\'s business')

    assert.deepEqual((await call('GET', '/api/crew/workspaces')).body.workspaces.map((w) => w.id), [workspace.id])
    const changed = await call('PATCH', `/api/crew/workspaces/${workspace.id}`, { description: 'Money.' })
    assert.deepEqual([changed.status, changed.body.workspace.description], [200, 'Money.'])
    assert.deepEqual(await call('DELETE', `/api/crew/workspaces/${workspace.id}`), { status: 200, body: { ok: true } })
    assert.deepEqual((await call('GET', '/api/crew/workspaces')).body.workspaces, [])
  })
})

test('what is not a route, a method or JSON is refused without a fault', needsDb, async () => {
  await withCrew(async (call) => {
    assert.equal((await call('GET', '/api/crew/nothing')).status, 404)
    assert.equal((await call('PUT', '/api/crew/agents', {})).status, 405)
    assert.equal((await call('DELETE', '/api/crew/agents')).status, 405)
    const broken = await call('POST', '/api/crew/agents', '{not json')
    assert.deepEqual([broken.status, broken.body.code], [400, 'bad_json'])
    const list = await call('POST', '/api/crew/agents', '[1,2]')
    assert.deepEqual([list.status, list.body.code], [400, 'bad_json'])
  })
})

test('a database that has gone away is a 503 that says so, and the server lives', needsDb, async () => {
  await withCrew(async (call, { sql }) => {
    await sql.end({ timeout: 1 })
    const res = await call('GET', '/api/crew/agents')
    assert.deepEqual([res.status, res.body.code], [503, 'store_unavailable'])
    assert.match(res.body.error, /database/i)
    assert.equal((await call('GET', '/api/crew/nothing')).status, 404)
  })
})

test('a host named in WORLDS_ALLOWED_HOSTS may reach the API, and no other may', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-hosts-'))
  try {
    await withEnv({ BOT_CROSSING_DATA: dir, WORLDS_ALLOWED_HOSTS: ' worlds.example.com , Other.Example.com ', WORLDS_DATABASE_URL: undefined }, async () => {
      const { apiMiddleware } = await import(`../server/api.mjs?hosts-${Date.now()}`)
      const server = http.createServer((req, res) => apiMiddleware(req, res, null))
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = server.address().port
      /** `fetch` will not let a test set Host, so this one is made by hand. */
      const get = (host, origin) =>
        new Promise((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port, path: '/api/crew', method: 'GET', headers: { Host: host, ...(origin ? { Origin: origin } : {}) } },
            (res) => {
              res.resume()
              res.on('end', () => resolve(res.statusCode))
            }
          )
          req.on('error', reject)
          req.end()
        })
      try {
        assert.equal(await get('worlds.example.com', 'https://worlds.example.com'), 200)
        assert.equal(await get('other.example.com'), 200)
        assert.equal(await get('evil.example.com'), 403)
        assert.equal(await get('worlds.example.com', 'https://evil.example.com'), 403)
        assert.equal(await get(`127.0.0.1:${port}`), 200)
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a request the store never answers gets a 503 in bounded time, and says it may have happened', async () => {
  const never = () => new Promise(() => {})
  const crew = { worldId: 'w', roster: { list: never, counts: never, create: never }, workspaces: {}, conversations: { statuses: never } }
  const server = http.createServer((req, res) =>
    handleCrew(req, res, new URL(req.url, 'http://localhost'), crew, { deadlineMs: 80 })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const started = Date.now()
    const read = await fetch(`${base}/api/crew/agents`, { signal: AbortSignal.timeout(3000) })
    assert.equal(read.status, 503)
    assert.equal((await read.json()).code, 'store_timeout')
    assert.ok(Date.now() - started < 2000)
    const write = await fetch(`${base}/api/crew/agents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"runtime":"hermes"}', signal: AbortSignal.timeout(3000),
    })
    assert.equal(write.status, 503)
    assert.match((await write.json()).error, /may or may not/)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a named host may change things only from its own page', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-hosts-'))
  try {
    await withEnv({ BOT_CROSSING_DATA: dir, WORLDS_ALLOWED_HOSTS: 'worlds.example.com', WORLDS_DATABASE_URL: undefined }, async () => {
      const { apiMiddleware } = await import(`../server/api.mjs?hosts-post-${Date.now()}`)
      const server = http.createServer((req, res) => apiMiddleware(req, res, null))
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const post = (origin) =>
        new Promise((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port: server.address().port, path: '/api/crew/agents', method: 'POST',
              headers: { Host: 'worlds.example.com', 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } },
            (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) }
          )
          req.on('error', reject)
          req.end('{}')
        })
      try {
        assert.equal(await post('https://worlds.example.com'), 404, 'let through, then told there is no crew')
        assert.equal(await post('https://evil.example.com'), 403)
        assert.equal(await post(undefined), 403)
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
