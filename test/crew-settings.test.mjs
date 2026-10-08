// test/crew-settings.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettings } from '../server/crew/settings.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code

test('a world that has never chosen is fully autonomous', needsDb, async () => {
  await withDb(async (sql) => {
    assert.deepEqual(await createSettings({ sql, worldId: 'w' }).get(), { autonomy: 'autonomous', channelLimit: null })
  })
})

test('a chosen autonomy level is kept, and kept apart from other worlds', needsDb, async () => {
  await withDb(async (sql) => {
    const mine = createSettings({ sql, worldId: 'w' })
    const theirs = createSettings({ sql, worldId: 'other' })
    assert.deepEqual(await mine.update({ autonomy: 'ask' }), { autonomy: 'ask', channelLimit: null })
    assert.deepEqual(await mine.update({ autonomy: 'workspace' }), { autonomy: 'workspace', channelLimit: null })
    assert.deepEqual(await mine.get(), { autonomy: 'workspace', channelLimit: null })
    assert.deepEqual(await theirs.get(), { autonomy: 'autonomous', channelLimit: null })
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
    assert.deepEqual(await settings.get(), { autonomy: 'ask', channelLimit: null })
  })
})

test('how many agents answer an open post can be limited, and set back to all', needsDb, async () => {
  await withDb(async (sql) => {
    const settings = createSettings({ sql, worldId: 'w' })
    // Given alone, in a world that has chosen nothing else.
    assert.deepEqual(await settings.update({ channelLimit: 2 }), { autonomy: 'autonomous', channelLimit: 2 })
    assert.deepEqual(await settings.update({ autonomy: 'ask' }), { autonomy: 'ask', channelLimit: 2 })
    assert.deepEqual(await settings.update({ channelLimit: null }), { autonomy: 'ask', channelLimit: null })
    assert.deepEqual(await settings.update({ autonomy: 'workspace', channelLimit: 50 }), { autonomy: 'workspace', channelLimit: 50 })
    for (const bad of [0, 51, -1, 1.5, '3', true, {}]) {
      await assert.rejects(settings.update({ channelLimit: bad }), refused('bad_channel_limit'))
    }
    // A request with one good field and one bad changes neither.
    await assert.rejects(settings.update({ autonomy: 'ask', channelLimit: 0 }), refused('bad_channel_limit'))
    assert.deepEqual(await settings.get(), { autonomy: 'workspace', channelLimit: 50 })
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

test('a task conversation has a workspace, a channel one need not, and a post takes one claim at a time', needsDb, async () => {
  await withDb(async (sql) => {
    const [ada] = await sql`insert into agents (world_id, name, kind, runtime) values ('w', 'Ada', 'unit', 'claude-code') returning id`
    const [bo] = await sql`insert into agents (world_id, name, kind, runtime) values ('w', 'Bo', 'unit', 'claude-code') returning id`
    const [place] = await sql`insert into workspaces (world_id, name) values ('w', 'Site') returning id`
    const [post] = await sql`insert into channel_posts (world_id, text) values ('w', 'Who can fix the footer?') returning id`

    await assert.rejects(
      sql`insert into conversations (world_id, agent_id) values ('w', ${ada.id})`,
      (error) => error.constraint_name === 'conversations_place_check')
    // Several side conversations may be open for one agent's history: only tasks are one at a time.
    await sql`insert into conversations (world_id, agent_id, kind, post_id) values ('w', ${ada.id}, 'channel', ${post.id})`
    await sql`insert into conversations (world_id, agent_id, kind, post_id) values ('w', ${ada.id}, 'channel', ${post.id})`

    const claim = (agent) => sql`
      insert into channel_claims (world_id, post_id, agent_id, workspace_id) values ('w', ${post.id}, ${agent.id}, ${place.id}) returning id`
    const [first] = await claim(ada)
    await assert.rejects(claim(bo), (error) => error.code === '23505' && error.constraint_name === 'channel_claims_granted_key')
    await sql`update channel_claims set released_at = now() where id = ${first.id}`
    await claim(bo)

    await assert.rejects(
      sql`insert into channel_deliveries (world_id, post_id, agent_id, state) values ('w', ${post.id}, ${ada.id}, 'pondering')`,
      (error) => error.constraint_name === 'channel_deliveries_state_check')
    await sql`insert into channel_deliveries (world_id, post_id, agent_id, state) values ('w', ${post.id}, ${ada.id}, 'queued')`
    await assert.rejects(
      sql`insert into channel_deliveries (world_id, post_id, agent_id, state) values ('w', ${post.id}, ${ada.id}, 'queued')`,
      (error) => error.code === '23505')
  })
})
