// test/crew-settings.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettings } from '../server/crew/settings.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code

test('a world that has never chosen is fully autonomous', needsDb, async () => {
  await withDb(async (sql) => {
    assert.deepEqual(await createSettings({ sql, worldId: 'w' }).get(), { autonomy: 'autonomous' })
  })
})

test('a chosen autonomy level is kept, and kept apart from other worlds', needsDb, async () => {
  await withDb(async (sql) => {
    const mine = createSettings({ sql, worldId: 'w' })
    const theirs = createSettings({ sql, worldId: 'other' })
    assert.deepEqual(await mine.update({ autonomy: 'ask' }), { autonomy: 'ask' })
    assert.deepEqual(await mine.update({ autonomy: 'workspace' }), { autonomy: 'workspace' })
    assert.deepEqual(await mine.get(), { autonomy: 'workspace' })
    assert.deepEqual(await theirs.get(), { autonomy: 'autonomous' })
  })
})

test('an autonomy level that does not exist is refused and nothing changes', needsDb, async () => {
  await withDb(async (sql) => {
    const settings = createSettings({ sql, worldId: 'w' })
    await settings.update({ autonomy: 'ask' })
    for (const bad of ['everything', '', 3, null, undefined]) {
      await assert.rejects(settings.update({ autonomy: bad }), refused('bad_autonomy'))
    }
    await assert.rejects(settings.update(), refused('bad_autonomy'))
    assert.deepEqual(await settings.get(), { autonomy: 'ask' })
  })
})

test('the database refuses a second open task conversation for one agent', needsDb, async () => {
  await withDb(async (sql) => {
    const [agent] = await sql`insert into agents (world_id, name, kind, runtime) values ('w', 'Ada', 'unit', 'claude-code') returning id`
    const [place] = await sql`insert into workspaces (world_id, name) values ('w', 'Site') returning id`
    const open = () => sql`insert into conversations (world_id, agent_id, workspace_id) values ('w', ${agent.id}, ${place.id}) returning id`
    const [first] = await open()
    await assert.rejects(open(), (error) => error.code === '23505' && error.constraint_name === 'conversations_open_task_key')
    await sql`update conversations set closed_at = now() where id = ${first.id}`
    await open()
  })
})
