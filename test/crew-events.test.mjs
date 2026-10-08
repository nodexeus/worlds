// test/crew-events.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvents } from '../server/crew/events.mjs'
import { createHub } from '../server/crew/hub.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

/** A world with one agent, one workspace and one conversation to write events into. */
async function seed(sql, worldId = 'w') {
  const [agent] = await sql`insert into agents (world_id, name, kind, runtime) values (${worldId}, 'Ada', 'unit', 'claude-code') returning id`
  const [place] = await sql`insert into workspaces (world_id, name) values (${worldId}, 'Site') returning id`
  const [talk] = await sql`insert into conversations (world_id, agent_id, workspace_id) values (${worldId}, ${agent.id}, ${place.id}) returning id`
  return { agentId: agent.id, conversationId: talk.id }
}

const withEvents = (run) =>
  withDb(async (sql) => {
    const hub = createHub({ log() {} })
    const published = []
    hub.subscribe((kind, payload) => published.push(payload))
    const events = createEvents({ sql, worldId: 'w', hub })
    return run(events, { sql, hub, published, ids: await seed(sql) })
  })

test('events are numbered from one with no gaps, and come back as they went in', needsDb, async () => {
  await withEvents(async (events, { ids, published }) => {
    const first = await events.append({ ...ids, type: 'message', status: 'working', data: { text: 'Hello' } })
    const second = await events.append({ ...ids, type: 'finished', status: 'idle', data: { text: 'Hi', costUsd: 0.01 } })
    assert.deepEqual([first.seq, second.seq], [1, 2])
    assert.equal(typeof first.seq, 'number')
    assert.deepEqual(
      { ...first, at: null },
      { seq: 1, conversationId: ids.conversationId, agentId: ids.agentId, type: 'message', status: 'working', at: null, data: { text: 'Hello' } }
    )
    assert.ok(!Number.isNaN(Date.parse(first.at)))
    assert.deepEqual(published, [first, second])
    assert.equal(await events.head(), 2)
  })
})

test('a world with no events has a head of zero', needsDb, async () => {
  await withEvents(async (events) => {
    assert.equal(await events.head(), 0)
    assert.deepEqual(await events.after(0, 10), [])
  })
})

test('what an agent wrote is stored exactly, whatever its keys look like', needsDb, async () => {
  await withEvents(async (events, { ids }) => {
    const data = { output: 'a_b', tool_use: { some_key: [{ inner_key: 1 }] }, 'kebab-key': true, requestId: 'r_1' }
    const stored = await events.append({ ...ids, type: 'tool', status: 'working', data })
    assert.deepEqual(stored.data, data)
    assert.deepEqual((await events.after(0, 10))[0].data, data)
  })
})

test('fifty events written together are numbered 1 to 50 and published in that order', needsDb, async () => {
  await withEvents(async (events, { ids, published }) => {
    const stored = await Promise.all(
      Array.from({ length: 50 }, (_, n) => events.append({ ...ids, type: 'text', status: 'working', data: { text: String(n) } }))
    )
    assert.deepEqual(stored.map((event) => event.seq), Array.from({ length: 50 }, (_, n) => n + 1))
    assert.deepEqual(stored.map((event) => event.data.text), Array.from({ length: 50 }, (_, n) => String(n)))
    assert.deepEqual(published.map((event) => event.seq), Array.from({ length: 50 }, (_, n) => n + 1))
  })
})

test('each world counts for itself', needsDb, async () => {
  await withEvents(async (events, { sql, hub, ids }) => {
    const theirs = createEvents({ sql, worldId: 'other', hub })
    const there = await seed(sql, 'other')
    await events.append({ ...ids, type: 'text', status: 'working', data: {} })
    await events.append({ ...ids, type: 'text', status: 'working', data: {} })
    assert.equal((await theirs.append({ ...there, type: 'text', status: 'working', data: {} })).seq, 1)
    assert.equal((await theirs.after(0, 10)).length, 1)
    assert.equal((await events.after(0, 10)).length, 2)
  })
})

test('catching up returns only what came later, oldest first, a page at a time', needsDb, async () => {
  await withEvents(async (events, { ids }) => {
    for (let n = 0; n < 7; n += 1) await events.append({ ...ids, type: 'text', status: 'working', data: { n } })
    assert.deepEqual((await events.after(4, 100)).map((event) => event.seq), [5, 6, 7])
    assert.deepEqual((await events.after(0, 3)).map((event) => event.seq), [1, 2, 3])
    assert.deepEqual(await events.after(7, 100), [])
  })
})

test('a conversation is read a page at a time, the latest first asked for', needsDb, async () => {
  await withEvents(async (events, { sql, ids }) => {
    const [other] = await sql`
      insert into conversations (world_id, agent_id, workspace_id, closed_at)
      select world_id, agent_id, workspace_id, now() from conversations where id = ${ids.conversationId} returning id`
    for (let n = 0; n < 6; n += 1) {
      await events.append({ ...ids, type: 'text', status: 'working', data: { n } })
      await events.append({ ...ids, conversationId: other.id, type: 'text', status: 'working', data: { n } })
    }
    const seqs = async (options) => (await events.page(ids.conversationId, options)).map((event) => event.seq)
    assert.deepEqual(await seqs({}), [1, 3, 5, 7, 9, 11])
    assert.deepEqual(await seqs({ limit: 2 }), [9, 11])
    assert.deepEqual(await seqs({ before: 9, limit: 2 }), [5, 7])
    assert.deepEqual(await seqs({ after: 5, limit: 2 }), [7, 9])
    assert.deepEqual(await seqs({ before: 1 }), [])
  })
})

test('a write that fails is reported, and the next one still takes the next number', needsDb, async () => {
  await withEvents(async (events, { ids, published }) => {
    await events.append({ ...ids, type: 'text', status: 'working', data: {} })
    await assert.rejects(events.append({ ...ids, type: 'text', status: 'sleeping', data: {} }))
    await assert.rejects(events.append({ ...ids, conversationId: '00000000-0000-7000-8000-000000000000', type: 'text', status: 'idle', data: {} }))
    const next = await events.append({ ...ids, type: 'text', status: 'working', data: {} })
    assert.equal(next.seq, 2)
    assert.deepEqual(published.map((event) => event.seq), [1, 2])
  })
})

test('idle resolves once everything asked for has been written', needsDb, async () => {
  await withEvents(async (events, { ids }) => {
    events.append({ ...ids, type: 'text', status: 'working', data: {} })
    events.append({ ...ids, type: 'text', status: 'working', data: {} }).catch(() => {})
    await events.idle()
    assert.equal(await events.head(), 2)
  })
})

test('an event about a post needs no conversation, and says which post', needsDb, async () => {
  await withEvents(async (events, { sql, published, ids }) => {
    const [post] = await sql`insert into channel_posts (world_id, text) values ('w', 'Anyone?') returning id`
    const about = await events.append({ type: 'post', postId: post.id, data: { id: post.id, text: 'Anyone?' } })
    assert.deepEqual(
      { ...about, at: null },
      { seq: 1, conversationId: null, agentId: null, type: 'post', status: null, at: null, data: { id: post.id, text: 'Anyone?' }, postId: post.id })

    // An agent answering a post: its own conversation, and the post it is about.
    const aside = await events.append({ ...ids, type: 'text', status: 'working', data: { text: 'Me.' }, postId: post.id })
    assert.equal(aside.postId, post.id)
    // An ordinary event does not grow a field.
    const plain = await events.append({ ...ids, type: 'text', status: 'working', data: { text: 'Hi.' } })
    assert.equal('postId' in plain, false)

    assert.deepEqual(published, [about, aside, plain])
    assert.deepEqual(await events.after(0), [about, aside, plain])
    assert.deepEqual(await events.page(ids.conversationId), [aside, plain])
  })
})

test('an event about nothing at all is refused by the database', needsDb, async () => {
  await withEvents(async (events) => {
    await assert.rejects(events.append({ type: 'post', data: {} }), (error) => error.constraint_name === 'events_subject_check')
    assert.equal(await events.head(), 0)
  })
})
