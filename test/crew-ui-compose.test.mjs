// test/crew-ui-compose.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { agentLine, answerFor, composer, payload, statusLabel } from '../src/crew/compose.js'

const SITE = { id: 'w-site', name: 'Site' }
const API = { id: 'w-api', name: 'Api' }
const agent = (more = {}) => ({ id: 'a1', name: 'Ada', runs: true, status: 'idle', conversationId: null, workspaceId: null, ...more })
const view = (more = {}) => composer({ agent: agent(), workspaces: [SITE, API], picked: null, ...more })

test('a free agent with a conversation continues it unless a workspace is chosen', () => {
  const there = agent({ conversationId: 'c1', workspaceId: SITE.id })
  const going = view({ agent: there })
  assert.equal(going.mode, 'continue')
  assert.equal(going.canSend, true)
  assert.deepEqual(going.chips, [
    { id: SITE.id, name: 'Site', current: true, on: false },
    { id: API.id, name: 'Api', current: false, on: false },
  ])
  assert.match(going.hint, /Continuing in Site/)
  assert.deepEqual(payload(going, 'and the footer'), { text: 'and the footer' })

  const task = view({ agent: there, picked: API.id })
  assert.equal(task.mode, 'task')
  assert.match(task.hint, /New task in Api/)
  assert.deepEqual(task.chips.map((chip) => chip.on), [false, true])
  assert.deepEqual(payload(task, 'fix the route'), { text: 'fix the route', workspaceId: API.id })
})

test('the workspace it is already in can be chosen too, for a fresh start there', () => {
  const again = view({ agent: agent({ conversationId: 'c1', workspaceId: SITE.id }), picked: SITE.id })
  assert.equal(again.mode, 'task')
  assert.deepEqual(payload(again, 'x'), { text: 'x', workspaceId: SITE.id })
})

test('a failed agent takes a message exactly as an idle one does', () => {
  const failed = view({ agent: agent({ status: 'failed', conversationId: 'c1', workspaceId: SITE.id }) })
  assert.deepEqual([failed.mode, failed.canSend], ['continue', true])
})

test('an agent that is not working anywhere must be told where', () => {
  const nowhere = view()
  assert.deepEqual([nowhere.mode, nowhere.canSend], ['choose', false])
  assert.match(nowhere.hint, /Choose a workspace/)
  assert.equal(view({ picked: SITE.id }).mode, 'task')
})

test('with one workspace there is nothing to choose', () => {
  const only = view({ workspaces: [SITE] })
  assert.deepEqual([only.mode, only.canSend, only.workspaceId], ['task', true, SITE.id])
  assert.deepEqual(only.chips, [{ id: SITE.id, name: 'Site', current: false, on: true }])
})

test('with no workspace at all there is nowhere to work', () => {
  const none = view({ workspaces: [] })
  assert.deepEqual([none.mode, none.canSend, none.chips], ['no-workspace', false, []])
  assert.match(none.hint, /workspace first/)
})

test('a conversation whose workspace has gone cannot be continued', () => {
  const orphan = view({ agent: agent({ conversationId: 'c1', workspaceId: 'w-archived' }) })
  assert.equal(orphan.mode, 'choose')
  assert.equal(view({ agent: agent({ conversationId: 'c1', workspaceId: 'w-archived' }), workspaces: [SITE] }).mode, 'task')
})

test('a choice that is no longer a workspace is not a choice', () => {
  assert.equal(view({ agent: agent({ conversationId: 'c1', workspaceId: SITE.id }), picked: 'w-gone' }).mode, 'continue')
})

test('a busy agent is sent a message to wait its turn, and is never given a workspace', () => {
  for (const status of ['working', 'waiting']) {
    const busy = view({ agent: agent({ status, conversationId: 'c1', workspaceId: SITE.id }), picked: API.id })
    assert.deepEqual([busy.mode, busy.canSend, busy.chips], ['queue', true, []], status)
    assert.match(busy.placeholder, /when it finishes/)
    assert.deepEqual(payload(busy, 'also this'), { text: 'also this' })
  }
})

test('an agent this server cannot run cannot be sent anything, and is not said to run on anything', () => {
  const stuck = view({ agent: agent({ runs: false, conversationId: 'c1', workspaceId: SITE.id }) })
  assert.deepEqual([stuck.mode, stuck.canSend], ['unavailable', false])
  assert.equal(stuck.hint, 'Ada is not available on this server yet.')
})

test('what is sent is trimmed', () => {
  assert.deepEqual(payload(view({ picked: SITE.id }), '  hello \n'), { text: 'hello', workspaceId: SITE.id })
})

test('an approval is answered with yes or no, and a reason if one was given', () => {
  const request = { type: 'approval', requestId: 'r1' }
  assert.deepEqual(answerFor(request, { allow: true }), { requestId: 'r1', allow: true })
  assert.deepEqual(answerFor(request, { allow: false }), { requestId: 'r1', allow: false })
  assert.deepEqual(answerFor(request, { allow: false, message: ' Keep dist ' }), { requestId: 'r1', allow: false, message: 'Keep dist' })
})

test('a question is answered once for each thing asked', () => {
  const one = { type: 'question', requestId: 'q1', questions: [{ question: 'Which?', options: ['Red', 'Blue'] }] }
  assert.deepEqual(answerFor(one, { answers: ['Blue'] }), { requestId: 'q1', answers: ['Blue'] })
  assert.deepEqual(answerFor(one, { answers: [' something else '] }), { requestId: 'q1', answers: ['something else'] })

  const two = { type: 'question', requestId: 'q2', questions: [{ question: 'Which?', options: ['Red', 'Blue'], multiple: true }, { question: 'Why?', options: [] }] }
  assert.deepEqual(answerFor(two, { answers: [['Red', 'Blue'], 'Both suit'] }), { requestId: 'q2', answers: ['Red, Blue', 'Both suit'] })
  assert.equal(answerFor(two, { answers: [['Red'], '  '] }), null, 'not until each has an answer')
  assert.equal(answerFor(two, { answers: [[], 'x'] }), null)
  assert.equal(answerFor(two, { answers: ['Red'] }), null)
})

test('how an agent is described in a line', () => {
  assert.equal(statusLabel('waiting'), 'needs you')
  assert.equal(statusLabel('working'), 'working')
  assert.equal(statusLabel('nonsense'), 'idle')
  assert.equal(agentLine(agent({ status: 'working', conversationId: 'c', workspaceId: SITE.id }), [SITE, API]), 'working · Site')
  assert.equal(agentLine(agent({ status: 'idle', conversationId: 'c', workspaceId: SITE.id }), [SITE, API]), 'idle · last in Site')
  assert.equal(agentLine(agent(), [SITE]), 'idle')
  assert.equal(agentLine(agent({ status: 'failed', conversationId: 'c', workspaceId: 'gone' }), [SITE]), 'failed')
})

test('a tool is put in words for what it does, and an unknown one is just a tool', async () => {
  const { toolDoes } = await import('../src/crew/render.js')
  assert.deepEqual(['run', 'edit', 'Bash', undefined].map(toolDoes), ['run a command', 'change a file', 'use a tool', 'use a tool'])
})
