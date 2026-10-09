// test/crew-ui-world.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { PER_PLATFORM, agentIdOf, crewWorld, isCrew } from '../src/crew/world.js'

const agent = (id, more = {}) => ({ id, name: id.toUpperCase(), kind: 'unit', status: 'idle', conversationId: null, workspaceId: null, ...more })
const SITE = { id: 'w1', name: 'Site' }
const API = { id: 'w2', name: 'Api' }

test('every agent is drawn, by its own id, as the robot the roster says it is', () => {
  const { members } = crewWorld({ agents: [agent('a1'), agent('a2', { kind: 'rock' })], workspaces: [] }, 1000)
  assert.deepEqual(members.map((one) => [one.id, one.agentId, one.title, one.robot]), [['crew:a1', 'a1', 'A1', 0], ['crew:a2', 'a2', 'A2', 1]])
  assert.ok(members.every((one) => one.crew && isCrew(one.id)))
  assert.equal(agentIdOf('crew:a1'), 'a1')
  assert.equal(agentIdOf('some-session'), null)
  assert.equal(isCrew('some-session'), false)
})

test('an agent says how it is doing in the terms the campus already draws', () => {
  const said = (status) => {
    const [one] = crewWorld({ agents: [agent('a1', { status })], workspaces: [] }, 1000).members
    return [Boolean(one.running), Boolean(one.needsAttention), Boolean(one.hasError)]
  }
  assert.deepEqual(said('idle'), [false, false, false])
  assert.deepEqual(said('working'), [true, false, false])
  assert.deepEqual(said('waiting'), [false, true, false])
  assert.deepEqual(said('failed'), [false, false, true])
})

test('an agent is never drawn as gone quiet, however long it has been idle', () => {
  const [one] = crewWorld({ agents: [agent('a1')], workspaces: [] }, 987654).members
  assert.equal(one.lastActivityAt, 987654)
})

test('an agent with a workspace stands on it, and one with none roams', () => {
  const { members } = crewWorld({ agents: [agent('a1', { workspaceId: 'w1' }), agent('a2')], workspaces: [SITE] }, 1000)
  assert.equal(members[0].project, 'crew:w1')
  assert.equal(members[0].roams, false)
  assert.equal(members[1].project, null)
  assert.equal(members[1].roams, true)
})

test('an agent whose workspace is not in the list roams until the list catches up', () => {
  const [one] = crewWorld({ agents: [agent('a1', { workspaceId: 'gone' })], workspaces: [SITE] }, 1000).members
  assert.equal(one.project, null)
  assert.equal(one.roams, true)
})

test('every workspace is a place, by its id and under its name, with nobody in it or not', () => {
  const { places } = crewWorld({ agents: [agent('a1', { workspaceId: 'w2' })], workspaces: [SITE, API] }, 1000)
  assert.deepEqual(places, [
    { id: 'crew:w1', title: 'Site', crew: true, platforms: 1 },
    { id: 'crew:w2', title: 'Api', crew: true, platforms: 1 },
  ])
})

test('a place has a platform for every two agents standing on it', () => {
  assert.equal(PER_PLATFORM, 2)
  const platforms = (count) => {
    const agents = Array.from({ length: count }, (_, n) => agent(`a${n}`, { workspaceId: 'w1' }))
    return crewWorld({ agents, workspaces: [SITE] }, 1000).places[0].platforms
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(platforms), [1, 1, 1, 2, 2, 3])
})

test('agents keep the order the roster gave them, oldest first', () => {
  const { members } = crewWorld({ agents: [agent('a1'), agent('a2'), agent('a3')], workspaces: [] }, 1000)
  assert.ok(members[0].createdAt < members[1].createdAt && members[1].createdAt < members[2].createdAt)
})

test('the crew cannot be filed away or hidden as a session can: they are always drawn', async () => {
  const { hiddenCatalog, liveThreadsForColony } = await import('../src/game/hidden-projects.js')
  const { members } = crewWorld({ agents: [agent('a1', { workspaceId: 'w1' }), agent('a2')], workspaces: [SITE] }, 1000)
  const session = { id: 's1', project: 'unknown' }
  // Whatever an older page saved, and with the project a session of no project is filed under hidden.
  const live = liveThreadsForColony([...members, session], new Set(['crew:a1', 'crew:a2']), new Set(['unknown', 'crew:w1']))
  assert.deepEqual(live.map((one) => one.id), ['crew:a1', 'crew:a2'])
  assert.deepEqual(hiddenCatalog(['unknown'], [...members, session]), [{ name: 'unknown', count: 1 }])
})
