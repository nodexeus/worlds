// test/crew-config.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { loadCrewConfig } from '../server/crew/config.mjs'
import { CrewError } from '../server/crew/errors.mjs'

const base = { WORLDS_DATABASE_URL: 'postgres://u:p@db:5432/worlds', WORLDS_DATA_DIR: '/var/lib/worlds' }

test('with no database the server is a monitor and there is no crew', () => {
  assert.equal(loadCrewConfig({}), null)
  assert.equal(loadCrewConfig({ WORLDS_DATA_DIR: '/data' }), null)
})

test('the defaults are one world of six agents with no specialists', () => {
  assert.deepEqual(loadCrewConfig(base), {
    databaseUrl: 'postgres://u:p@db:5432/worlds',
    schema: '',
    dataDir: '/var/lib/worlds',
    worldId: 'default',
    agentLimit: 6,
    entitled: [],
  })
})

test('everything can be set', () => {
  const config = loadCrewConfig({
    ...base,
    WORLDS_DATABASE_SCHEMA: 'acme',
    WORLDS_WORLD_ID: 'acme',
    WORLDS_AGENT_LIMIT: '12',
    WORLDS_CURATED_AGENTS: ' quill, sophie ,,',
  })
  assert.equal(config.schema, 'acme')
  assert.equal(config.worldId, 'acme')
  assert.equal(config.agentLimit, 12)
  assert.deepEqual(config.entitled, ['quill', 'sophie'])
})

test('a relative data directory is made absolute', () => {
  const config = loadCrewConfig({ ...base, WORLDS_DATA_DIR: 'data/crew' })
  assert.equal(config.dataDir, path.resolve('data/crew'))
})

test('a database with nowhere to keep files is refused, by name', () => {
  assert.throws(() => loadCrewConfig({ WORLDS_DATABASE_URL: base.WORLDS_DATABASE_URL }), /WORLDS_DATA_DIR/)
})

test('values that would be dangerous as identifiers are refused', () => {
  assert.throws(() => loadCrewConfig({ ...base, WORLDS_DATABASE_SCHEMA: 'a"; drop' }), /WORLDS_DATABASE_SCHEMA/)
  assert.throws(() => loadCrewConfig({ ...base, WORLDS_WORLD_ID: 'has space' }), /WORLDS_WORLD_ID/)
  assert.throws(() => loadCrewConfig({ ...base, WORLDS_DATABASE_URL: 'mysql://x' }), /WORLDS_DATABASE_URL/)
})

test('a limit has to be a whole number of agents, and zero is allowed', () => {
  assert.equal(loadCrewConfig({ ...base, WORLDS_AGENT_LIMIT: '0' }).agentLimit, 0)
  for (const bad of ['-1', '2.5', 'six']) {
    assert.throws(() => loadCrewConfig({ ...base, WORLDS_AGENT_LIMIT: bad }), /WORLDS_AGENT_LIMIT/)
  }
})

test('a refusal carries a code and a status', () => {
  const error = new CrewError('agent_limit', 'This world has 6 of 6 agents', 409)
  assert.equal(error.code, 'agent_limit')
  assert.equal(error.status, 409)
  assert.equal(error.message, 'This world has 6 of 6 agents')
  assert.ok(error instanceof Error)
})
