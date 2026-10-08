// test/crew-ui-store.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCrewStore } from '../src/crew/store.js'

const ADA = { id: 'a1', name: 'Ada', kind: 'unit', runtime: 'claude-code', role: '', curated: false, status: 'idle', conversationId: null, workspaceId: null }
const BO = { ...ADA, id: 'a2', name: 'Bo' }
const COUNTS = { standard: { used: 2, limit: 6 }, curated: { used: 0 } }
const ev = (seq, more = {}) => ({ seq, conversationId: 'c1', agentId: 'a1', type: 'text', status: 'working', at: 'now', data: { text: `t${seq}` }, ...more })

/** A store with two agents, and a list of everything it told its listeners. */
function made({ seq = 0, agents = [ADA, BO] } = {}) {
  const store = createCrewStore()
  const told = []
  store.subscribe((what) => told.push(what))
  store.setRoster({ agents, counts: COUNTS, seq })
  told.length = 0
  return { store, told }
}

test('a snapshot sets the agents and the counts, and says so once', () => {
  const store = createCrewStore()
  const told = []
  store.subscribe((what) => told.push(what.kind))
  store.setRoster({ agents: [ADA, BO], counts: COUNTS, seq: 4 })
  assert.deepEqual(store.state.agents.map((agent) => [agent.name, agent.status]), [['Ada', 'idle'], ['Bo', 'idle']])
  assert.deepEqual(store.state.counts, COUNTS)
  assert.equal(store.agent('a2').name, 'Bo')
  assert.equal(store.agent('nobody'), null)
  assert.deepEqual(told, ['roster'])

  store.setRoster({ agents: [ADA, BO], counts: COUNTS, seq: 4 })
  assert.deepEqual(told, ['roster'], 'the same again is not news')
  store.setRoster({ agents: [{ ...ADA, name: 'Grace' }, BO], counts: COUNTS, seq: 4 })
  assert.deepEqual(told, ['roster', 'roster'])
})

test('an event sets its agent\'s status and conversation, and an older one does not undo it', () => {
  const { store, told } = made()
  store.applyEvent(ev(5, { status: 'waiting' }))
  assert.deepEqual([store.agent('a1').status, store.agent('a1').conversationId], ['waiting', 'c1'])
  assert.equal(store.agent('a2').status, 'idle')
  store.applyEvent(ev(3, { status: 'working' }))
  assert.equal(store.agent('a1').status, 'waiting')
  assert.deepEqual(told.map((what) => what.kind), ['roster'])
})

test('an agent answering the crew channel is busy, and is still in the task it was in', () => {
  const { store, told } = made()
  store.applyEvent(ev(5, { status: 'idle' }))
  store.setPlace('a1', { id: 'c1', workspaceId: 'w1' })
  told.length = 0
  store.watch('c1')

  store.applyEvent(ev(6, { conversationId: 'side', postId: 'p1', type: 'message', status: 'working' }))
  assert.deepEqual([store.agent('a1').status, store.agent('a1').conversationId], ['working', 'c1'])
  assert.equal(store.needsRoster(), false, 'nothing a fresh snapshot is needed to explain')
  assert.deepEqual(store.eventsOf('c1').map((event) => event.seq), [], 'and none of it is in the card')

  store.applyEvent(ev(7, { conversationId: 'side', postId: 'p1', type: 'finished', status: 'idle' }))
  assert.deepEqual([store.agent('a1').status, store.agent('a1').conversationId], ['idle', 'c1'])
  assert.deepEqual(told.map((what) => what.kind), ['roster', 'roster'])
})

test('what became of a post is not about any agent', () => {
  const { store, told } = made()
  store.applyEvent({ seq: 9, conversationId: null, agentId: null, type: 'post', status: null, at: 'now', data: { id: 'p1' }, postId: 'p1' })
  assert.deepEqual(told, [])
  assert.equal(store.needsRoster(), false)
  assert.deepEqual(store.state.agents.map((agent) => agent.status), ['idle', 'idle'])
})

test('an event that changes nothing about an agent is not roster news', () => {
  const { store, told } = made()
  store.applyEvent(ev(1))
  store.applyEvent(ev(2))
  store.applyEvent(ev(3))
  assert.deepEqual(told.map((what) => what.kind), ['roster'])
})

test('a snapshot behind what the stream has said keeps the stream\'s word', () => {
  const { store } = made()
  store.applyEvent(ev(9, { status: 'working' }))
  store.setRoster({ agents: [{ ...ADA, status: 'idle', conversationId: null }, BO], counts: COUNTS, seq: 7 })
  assert.deepEqual([store.agent('a1').status, store.agent('a1').conversationId], ['working', 'c1'])

  store.setRoster({ agents: [{ ...ADA, status: 'idle', conversationId: 'c1', workspaceId: 'w1' }, BO], counts: COUNTS, seq: 9 })
  assert.deepEqual([store.agent('a1').status, store.agent('a1').workspaceId], ['idle', 'w1'], 'level with it, the snapshot wins')
})

test('a snapshot that wins is not undone by older events still on their way', () => {
  const { store } = made()
  // As after a reconnect: the snapshot lands while the stream is still replaying what it missed.
  store.setRoster({ agents: [{ ...ADA, status: 'idle', conversationId: 'c2', workspaceId: 'w2' }, BO], counts: COUNTS, seq: 30 })
  store.applyEvent(ev(21, { status: 'working', conversationId: 'c1' }))
  assert.deepEqual([store.agent('a1').status, store.agent('a1').conversationId], ['idle', 'c2'])
  assert.equal(store.needsRoster(), false)
  store.applyEvent(ev(31, { status: 'working', conversationId: 'c2' }))
  assert.equal(store.agent('a1').status, 'working')
})

test('a snapshot behind the stream still says where a conversation is, when it is the same one', () => {
  const { store } = made()
  store.applyEvent(ev(9, { status: 'working' }))
  assert.equal(store.needsRoster(), true, 'the stream does not say which workspace')
  store.setRoster({ agents: [{ ...ADA, status: 'working', conversationId: 'c1', workspaceId: 'w1' }, BO], counts: COUNTS, seq: 8 })
  assert.equal(store.agent('a1').workspaceId, 'w1')
  assert.equal(store.needsRoster(), false)
})

test('the page saying where it sent an agent settles it without asking the server', () => {
  const { store } = made()
  store.applyEvent(ev(9))
  store.setPlace('a1', { id: 'c1', workspaceId: 'w2' })
  assert.equal(store.agent('a1').workspaceId, 'w2')
  assert.equal(store.needsRoster(), false)
  store.setPlace('a2', { id: 'c7', workspaceId: 'w2' })
  assert.deepEqual([store.agent('a2').conversationId, store.agent('a2').workspaceId], ['c7', 'w2'])
})

test('an event about an agent the page has not heard of means the roster is stale', () => {
  const { store } = made()
  assert.equal(store.needsRoster(), false)
  store.applyEvent(ev(2, { agentId: 'a-new' }))
  assert.equal(store.needsRoster(), true)
  store.setRoster({ agents: [ADA, BO, { ...ADA, id: 'a-new', name: 'Cy' }], counts: COUNTS, seq: 2 })
  assert.equal(store.needsRoster(), false)
})

test('an agent no longer in the snapshot is gone', () => {
  const { store } = made()
  store.applyEvent(ev(3))
  store.setRoster({ agents: [BO], counts: COUNTS, seq: 3 })
  assert.equal(store.agent('a1'), null)
  assert.equal(store.needsRoster(), false)
})

test('a watched conversation keeps its events in order, each once', () => {
  const { store, told } = made()
  store.watch('c1')
  store.applyEvent(ev(5))
  store.addEvents('c1', [ev(2), ev(3), ev(5)])
  store.applyEvent(ev(4))
  store.applyEvent(ev(6, { conversationId: 'c-other' }))
  assert.deepEqual(store.eventsOf('c1').map((event) => event.seq), [2, 3, 4, 5])
  assert.deepEqual(store.eventsOf('c-other'), [])
  assert.ok(told.some((what) => what.kind === 'conversation' && what.conversationId === 'c1'))
})

test('a conversation nobody is watching is not kept, and one let go of is forgotten', () => {
  const { store } = made()
  store.applyEvent(ev(1))
  assert.deepEqual(store.eventsOf('c1'), [])
  store.watch('c1')
  store.watch('c1')
  store.applyEvent(ev(2))
  store.unwatch('c1')
  assert.equal(store.eventsOf('c1').length, 1, 'still watched by one')
  store.unwatch('c1')
  assert.deepEqual(store.eventsOf('c1'), [])
})

test('fragments build a draft, and the finished text or an ending clears it', () => {
  const { store, told } = made()
  store.watch('c1')
  store.applyDelta({ conversationId: 'c1', agentId: 'a1', text: 'Hel' })
  store.applyDelta({ conversationId: 'c1', agentId: 'a1', text: 'lo' })
  store.applyDelta({ conversationId: 'c-other', agentId: 'a2', text: 'no' })
  assert.equal(store.draftOf('c1'), 'Hello')
  assert.equal(store.draftOf('c-other'), '')
  assert.deepEqual(told.map((what) => what.kind), ['draft', 'draft'])
  store.applyEvent(ev(1, { type: 'text' }))
  assert.equal(store.draftOf('c1'), '')

  store.applyDelta({ conversationId: 'c1', agentId: 'a1', text: 'half a thou' })
  store.applyEvent(ev(2, { type: 'tool', data: { id: 't', name: 'Bash', summary: 'ls', status: 'started' } }))
  assert.equal(store.draftOf('c1'), 'half a thou', 'a tool call does not end a sentence')
  store.applyEvent(ev(3, { type: 'interrupted', status: 'idle', data: {} }))
  assert.equal(store.draftOf('c1'), '')
})

test('starting again from a record that went back forgets what was kept', () => {
  const { store } = made()
  store.watch('c1')
  store.applyEvent(ev(40, { status: 'working' }))
  store.applyDelta({ conversationId: 'c1', agentId: 'a1', text: 'x' })
  store.reset()
  assert.deepEqual(store.eventsOf('c1'), [])
  assert.equal(store.draftOf('c1'), '')
  store.setRoster({ agents: [ADA, BO], counts: COUNTS, seq: 3 })
  assert.equal(store.agent('a1').status, 'idle', 'and a snapshot is believed again')
  store.applyEvent(ev(4, { status: 'working' }))
  assert.equal(store.agent('a1').status, 'working')
})

test('the rest of what the page knows is set, and told, only when it changes', () => {
  const { store, told } = made()
  store.setStatus({ enabled: true, worldId: 'w', demo: true, runtimes: ['claude-code'] })
  store.setWorkspaces([{ id: 'w1', name: 'Site', description: '' }])
  store.setWorkspaces([{ id: 'w1', name: 'Site', description: '' }])
  store.setSpecialists([{ id: 'quill', name: 'Quill', entitled: true, agentId: null }])
  store.setAutonomy('ask')
  store.setAutonomy('ask')
  store.setLink('retrying')
  store.setLink('retrying')
  assert.deepEqual(told.map((what) => what.kind), ['settings', 'workspaces', 'specialists', 'settings', 'link'])
  assert.deepEqual([store.state.demo, store.state.runtimes, store.state.autonomy, store.state.link], [true, ['claude-code'], 'ask', 'retrying'])
  assert.equal(store.workspace('w1').name, 'Site')
  assert.equal(store.workspace('nope'), null)
})

test('a listener that throws does not stop the others, and one that left hears nothing', () => {
  const store = createCrewStore({ log() {} })
  const heard = []
  store.subscribe(() => { throw new Error('a view fell over') })
  const leave = store.subscribe((what) => heard.push(what.kind))
  store.setLink('retrying')
  leave()
  store.setLink('live')
  assert.deepEqual(heard, ['link'])
})
