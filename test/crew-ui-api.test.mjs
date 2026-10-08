// test/crew-ui-api.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { CrewApiError, createCrewApi } from '../src/crew/api.js'

/** A `fetch` that records what it was asked and answers from a list. */
function fake(...replies) {
  const calls = []
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body === undefined ? undefined : JSON.parse(options.body), headers: options.headers })
    const reply = replies.shift() ?? { status: 200, body: {} }
    if (reply instanceof Error) throw reply
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.body === undefined) throw new SyntaxError('not JSON')
        return reply.body
      },
    }
  }
  return { fetch, calls }
}

const AGENT = '0198c0de-0000-7000-8000-000000000001'
const TALK = '0198c0de-0000-7000-8000-000000000002'

test('each call asks the right address in the right way', async () => {
  const { fetch, calls } = fake()
  const api = createCrewApi({ fetch })
  await api.status()
  await api.agents()
  await api.workspaces()
  await api.specialists()
  await api.settings()
  await api.createAgent({ name: 'Ada', runtime: 'claude-code', role: 'Writes.' })
  await api.addSpecialist('quill')
  await api.createWorkspace({ name: 'Site', description: 'The site', gitUrl: 'https://example.com/a.git' })
  await api.setAutonomy('ask')
  await api.send(AGENT, { text: 'hi', workspaceId: 'w1' })
  await api.stop(AGENT)
  await api.answer(TALK, { requestId: 'r1', allow: true })
  await api.conversations(AGENT)
  await api.events(TALK)
  await api.events(TALK, { before: 40, limit: 100 })
  assert.deepEqual(calls.map((call) => [call.method, call.url, call.body]), [
    ['GET', '/api/crew', undefined],
    ['GET', '/api/crew/agents', undefined],
    ['GET', '/api/crew/workspaces', undefined],
    ['GET', '/api/crew/specialists', undefined],
    ['GET', '/api/crew/settings', undefined],
    ['POST', '/api/crew/agents', { name: 'Ada', runtime: 'claude-code', role: 'Writes.' }],
    ['POST', '/api/crew/agents', { templateId: 'quill' }],
    ['POST', '/api/crew/workspaces', { name: 'Site', description: 'The site', gitUrl: 'https://example.com/a.git' }],
    ['PATCH', '/api/crew/settings', { autonomy: 'ask' }],
    ['POST', `/api/crew/agents/${AGENT}/messages`, { text: 'hi', workspaceId: 'w1' }],
    ['POST', `/api/crew/agents/${AGENT}/stop`, {}],
    ['POST', `/api/crew/conversations/${TALK}/answers`, { requestId: 'r1', allow: true }],
    ['GET', `/api/crew/agents/${AGENT}/conversations`, undefined],
    ['GET', `/api/crew/conversations/${TALK}/events`, undefined],
    ['GET', `/api/crew/conversations/${TALK}/events?before=40&limit=100`, undefined],
  ])
  assert.equal(calls[5].headers['Content-Type'], 'application/json')
})

test('a reply is handed back as it came', async () => {
  const { fetch } = fake({ status: 202, body: { conversation: { id: TALK }, queued: false } })
  assert.deepEqual(await createCrewApi({ fetch }).send(AGENT, { text: 'hi' }), { conversation: { id: TALK }, queued: false })
})

test('what is left blank is left out, so the server chooses', async () => {
  const { fetch, calls } = fake()
  const api = createCrewApi({ fetch })
  await api.createAgent({ name: '  ', runtime: 'claude-code', role: '' })
  await api.createWorkspace({ name: 'Site', description: '', gitUrl: ' ' })
  await api.send(AGENT, { text: 'hi', workspaceId: undefined })
  assert.deepEqual(calls.map((call) => call.body), [{ runtime: 'claude-code' }, { name: 'Site' }, { text: 'hi' }])
})

test('a refusal is thrown with the code, the wording and the status the server gave', async () => {
  const { fetch } = fake({ status: 409, body: { error: 'Ada is in the middle of something', code: 'agent_busy' } })
  await assert.rejects(createCrewApi({ fetch }).send(AGENT, { text: 'hi', workspaceId: 'w' }), (error) => {
    assert.ok(error instanceof CrewApiError)
    assert.deepEqual([error.code, error.status, error.message], ['agent_busy', 409, 'Ada is in the middle of something'])
    return true
  })
})

test('a question that got no answer is reported as the server being out of reach', async () => {
  for (const reply of [new TypeError('Failed to fetch'), { status: 502, body: undefined }, { status: 200, body: undefined }]) {
    const { fetch } = fake(reply)
    await assert.rejects(createCrewApi({ fetch }).agents(), (error) => {
      assert.ok(error instanceof CrewApiError)
      assert.equal(error.code, 'unreachable')
      assert.match(error.message, /could not be reached/i)
      return true
    })
  }
})

test('a change that got no answer may have been made, and says so', async () => {
  for (const reply of [new TypeError('Failed to fetch'), { status: 504, body: undefined }, { status: 200, body: undefined }]) {
    const { fetch } = fake(reply)
    await assert.rejects(createCrewApi({ fetch }).send(AGENT, { text: 'hi' }), (error) => {
      assert.equal(error.code, 'unreachable')
      assert.match(error.message, /may or may not/i)
      assert.doesNotMatch(error.message, /nothing was sent/i)
      return true
    })
  }
})

test('a page of events is asked for by number, on a browser old or new', async () => {
  const { fetch, calls } = fake()
  const Real = globalThis.URLSearchParams
  // Older browsers have no `size` on this.
  globalThis.URLSearchParams = class extends Real { get size() { return undefined } }
  try {
    await createCrewApi({ fetch }).events(TALK, { before: 40 })
  } finally {
    globalThis.URLSearchParams = Real
  }
  assert.equal(calls[0].url, `/api/crew/conversations/${TALK}/events?before=40`)
})

test('a refusal with no wording still says something', async () => {
  const { fetch } = fake({ status: 500, body: {} })
  await assert.rejects(createCrewApi({ fetch }).agents(), (error) => error.code === 'fault' && error.status === 500 && error.message.length > 0)
})

test('the crew channel is read, posted to and corrected at its own addresses', async () => {
  const { fetch, calls } = fake()
  const api = createCrewApi({ fetch })
  await api.channel()
  await api.channel({ before: 'p 1', limit: 30 })
  await api.post('Who can fix the footer?')
  await api.release('p/1')
  await api.hand('p1', { agentId: AGENT })
  await api.hand('p1', { agentId: AGENT, workspaceId: 'w1' })
  await api.setChannelLimit(2)
  await api.setChannelLimit(null)
  assert.deepEqual(calls.map((call) => [call.method, call.url, call.body]), [
    ['GET', '/api/crew/channel', undefined],
    ['GET', '/api/crew/channel?before=p+1&limit=30', undefined],
    ['POST', '/api/crew/channel', { text: 'Who can fix the footer?' }],
    ['POST', '/api/crew/channel/p%2F1/release', {}],
    ['POST', '/api/crew/channel/p1/hand', { agentId: AGENT }],
    ['POST', '/api/crew/channel/p1/hand', { agentId: AGENT, workspaceId: 'w1' }],
    ['PATCH', '/api/crew/settings', { channelLimit: 2 }],
    ['PATCH', '/api/crew/settings', { channelLimit: null }],
  ])
})
