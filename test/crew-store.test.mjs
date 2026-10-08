// test/crew-store.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { connect, isUniqueViolation, isUnavailable } from '../server/crew/store/db.mjs'
import { migrate } from '../server/crew/store/migrate.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

test('migrations run once, and a second run applies nothing', needsDb, async () => {
  await withDb(async (sql) => {
    assert.deepEqual(await migrate(sql), [])
    const [{ count }] = await sql`select count(*)::int as count from crew_migrations`
    assert.ok(count >= 1)
  })
})

test('two servers starting together do not both apply a migration', needsDb, async () => {
  await withDb(async (sql) => {
    await sql`delete from crew_migrations`
    await sql`drop table events, event_counters, conversations, settings, agents, workspaces`
    const results = await Promise.all([migrate(sql), migrate(sql)])
    assert.deepEqual(results.flat().sort(), ['001_roster.sql', '002_conversations.sql'])
  })
})

test('column names come back camel-cased', needsDb, async () => {
  await withDb(async (sql) => {
    const [row] = await sql`
      insert into agents (world_id, name, kind, runtime) values ('w', 'Ada', 'unit', 'claude-code')
      returning id, template_id, created_at`
    assert.ok('templateId' in row && 'createdAt' in row)
    assert.equal(row.templateId, null)
  })
})

test('a name is unique in its world whatever its case, and free again once retired', needsDb, async () => {
  await withDb(async (sql) => {
    const add = (world, name) =>
      sql`insert into agents (world_id, name, kind, runtime) values (${world}, ${name}, 'unit', 'claude-code') returning id`
    const [{ id }] = await add('w', 'Ada')
    await assert.rejects(add('w', 'ADA'), (error) => isUniqueViolation(error, 'agents_name_key'))
    await add('other', 'Ada')
    await sql`update agents set retired_at = now() where id = ${id}`
    await add('w', 'ada')
  })
})

test('a world holds one agent per curated template', needsDb, async () => {
  await withDb(async (sql) => {
    const add = (name) =>
      sql`insert into agents (world_id, name, kind, runtime, template_id) values ('w', ${name}, 'unit', 'hermes', 'quill')`
    await add('Quill')
    await assert.rejects(add('Quill2'), (error) => isUniqueViolation(error, 'agents_template_key'))
  })
})

test('a kind outside the two there are is refused by the database', needsDb, async () => {
  await withDb(async (sql) => {
    await assert.rejects(
      sql`insert into agents (world_id, name, kind, runtime) values ('w', 'Ada', 'dragon', 'hermes')`,
      /agents_kind_check/
    )
  })
})

test('a database that is not there is reported as unavailable, not as a fault', async () => {
  const sql = connect('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1 })
  try {
    await assert.rejects(sql`select 1`, (error) => isUnavailable(error))
  } finally {
    await sql.end({ timeout: 1 })
  }
})

test('the API and the store agree on what "the database is not there" looks like', async () => {
  const fs = await import('node:fs/promises')
  const codes = async (file) => {
    const text = await fs.readFile(new URL(file, import.meta.url), 'utf8')
    const block = text.slice(text.indexOf('const UNREACHABLE = new Set(['), text.indexOf('])', text.indexOf('const UNREACHABLE = new Set([')))
    return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]).sort()
  }
  assert.deepEqual(await codes('../server/crew/http.mjs'), await codes('../server/crew/store/db.mjs'))
})

test('a query the database never finishes is given up on, and counts as the database being away', needsDb, async () => {
  const sql = connect(process.env.WORLDS_TEST_DATABASE_URL, { max: 1, statementTimeout: 200 })
  try {
    const started = Date.now()
    await assert.rejects(sql`select pg_sleep(5)`, (error) => isUnavailable(error))
    assert.ok(Date.now() - started < 3000)
  } finally {
    await sql.end({ timeout: 1 })
  }
})
