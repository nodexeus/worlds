// test/crew-roster.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoster } from '../server/crew/roster.mjs'
import { loadCatalog } from '../server/crew/catalog.mjs'
import { NAMES } from '../server/crew/names.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code

/** A roster on a schema of its own. `options` overrides the world, limit and entitlements. */
const withRoster = (options, run) =>
  withDb(async (sql) => {
    const catalog = await loadCatalog()
    const make = (more = {}) =>
      createRoster({ sql, worldId: 'w', catalog, limit: 6, entitled: ['quill'], rand: () => 0, ...options, ...more })
    return run(make(), { sql, make })
  })

test('a new agent gets a friendly name, a robot and an empty role', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const agent = await roster.create({ runtime: 'claude-code' })
    assert.equal(agent.name, NAMES[0])
    assert.ok(['unit', 'rock'].includes(agent.kind))
    assert.equal(agent.role, '')
    assert.equal(agent.curated, false)
    assert.equal(agent.templateId, null)
    assert.equal(agent.speciality, null)
    assert.match(agent.id, /^[0-9a-f-]{36}$/)
    assert.deepEqual((await roster.list()).map((a) => a.id), [agent.id])
    assert.deepEqual(await roster.get(agent.id), agent)
  })
})

test('the second agent does not get the first one\'s name', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const a = await roster.create({ runtime: 'hermes' })
    const b = await roster.create({ runtime: 'hermes' })
    assert.notEqual(a.name, b.name)
  })
})

test('a chosen name, kind and role are kept as given', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const agent = await roster.create({ name: ' Ronnie ', kind: 'rock', runtime: 'openclaw', role: ' Reviews pull requests. ' })
    assert.equal(agent.name, 'Ronnie')
    assert.equal(agent.kind, 'rock')
    assert.equal(agent.runtime, 'openclaw')
    assert.equal(agent.role, 'Reviews pull requests.')
  })
})

test('what cannot be an agent is refused, and says why', needsDb, async () => {
  await withRoster({}, async (roster) => {
    await assert.rejects(roster.create({}), refused('bad_runtime'))
    await assert.rejects(roster.create({ runtime: 'gpt' }), refused('bad_runtime'))
    await assert.rejects(roster.create({ runtime: 'hermes', kind: 'dragon' }), refused('bad_kind'))
    await assert.rejects(roster.create({ runtime: 'hermes', name: 'two words' }), refused('bad_name'))
    await assert.rejects(roster.create({ runtime: 'hermes', role: 42 }), refused('bad_role'))
    await assert.rejects(roster.create({ runtime: 'hermes', role: 'x'.repeat(8001) }), refused('bad_role'))
    assert.deepEqual(await roster.list(), [])
  })
})

test('a name in use is taken whatever its case or padding', needsDb, async () => {
  await withRoster({}, async (roster) => {
    await roster.create({ name: 'Ada', runtime: 'hermes' })
    for (const again of ['Ada', 'ada', ' ADA ']) {
      await assert.rejects(roster.create({ name: again, runtime: 'hermes' }), refused('name_taken'))
    }
  })
})

test('a specialist\'s name is reserved, entitled or not, in any case', needsDb, async () => {
  await withRoster({ entitled: [] }, async (roster) => {
    for (const name of ['Quill', 'quill', ' QUILL ']) {
      await assert.rejects(roster.create({ name, runtime: 'hermes' }), refused('name_reserved'))
    }
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    await assert.rejects(roster.update(ada.id, { name: 'quill' }), refused('name_reserved'))
  })
})

test('the limit is the limit, and the refusal gives the count', needsDb, async () => {
  await withRoster({ limit: 2 }, async (roster) => {
    await roster.create({ runtime: 'hermes' })
    await roster.create({ runtime: 'hermes' })
    await assert.rejects(roster.create({ runtime: 'hermes' }), (error) => {
      assert.ok(refused('agent_limit')(error))
      assert.match(error.message, /2 of 2/)
      return true
    })
    assert.deepEqual((await roster.counts()).standard, { used: 2, limit: 2 })
  })
})

test('two creations racing for the last place: one agent, one refusal', needsDb, async () => {
  await withRoster({ limit: 3 }, async (roster) => {
    await roster.create({ runtime: 'hermes' })
    await roster.create({ runtime: 'hermes' })
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => roster.create({ runtime: 'hermes' }))
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    for (const r of results.filter((r) => r.status === 'rejected')) assert.ok(refused('agent_limit')(r.reason))
    assert.equal((await roster.list()).length, 3)
  })
})

test('a limit lowered below the count keeps the agents and refuses new ones', needsDb, async () => {
  await withRoster({ limit: 3 }, async (roster, { make }) => {
    for (let i = 0; i < 3; i++) await roster.create({ runtime: 'hermes' })
    const smaller = make({ limit: 1 })
    assert.equal((await smaller.list()).length, 3)
    assert.deepEqual((await smaller.counts()).standard, { used: 3, limit: 1 })
    await assert.rejects(smaller.create({ runtime: 'hermes' }), /3 of 1/)
  })
})

test('retiring an agent frees its place and its name', needsDb, async () => {
  await withRoster({ limit: 1 }, async (roster) => {
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    await roster.retire(ada.id)
    assert.deepEqual(await roster.list(), [])
    await assert.rejects(roster.get(ada.id), refused('unknown_agent'))
    await assert.rejects(roster.retire(ada.id), refused('unknown_agent'))
    const again = await roster.create({ name: 'ada', runtime: 'hermes' })
    assert.notEqual(again.id, ada.id)
  })
})

test('renaming keeps the agent, and its own name in another case is allowed', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    const other = await roster.create({ name: 'Bolt', runtime: 'hermes' })
    assert.equal((await roster.update(ada.id, { name: 'ADA' })).name, 'ADA')
    const renamed = await roster.update(ada.id, { name: 'Grace', role: 'Writes docs.' })
    assert.deepEqual([renamed.id, renamed.name, renamed.role], [ada.id, 'Grace', 'Writes docs.'])
    await assert.rejects(roster.update(ada.id, { name: 'bolt' }), refused('name_taken'))
    await assert.rejects(roster.update(ada.id, { name: 'no good' }), refused('bad_name'))
    assert.equal((await roster.update(other.id, {})).name, 'Bolt')
    await assert.rejects(roster.update('00000000-0000-7000-8000-000000000000', { name: 'Zed' }), refused('unknown_agent'))
    await assert.rejects(roster.update('not-an-id', { name: 'Zed' }), refused('unknown_agent'))
  })
})

test('a specialist comes from its template and does not use a standard place', needsDb, async () => {
  await withRoster({ limit: 1 }, async (roster) => {
    await roster.create({ runtime: 'claude-code' })
    const quill = await roster.createCurated('quill')
    assert.equal(quill.name, 'Quill')
    assert.equal(quill.curated, true)
    assert.equal(quill.templateId, 'quill')
    assert.equal(quill.speciality, 'Research and briefings')
    assert.equal(quill.runtime, 'hermes')
    assert.match(quill.role, /research specialist/)
    assert.deepEqual(await roster.counts(), { standard: { used: 1, limit: 1 }, curated: { used: 1 } })
  })
})

test('there is never a second one, and its name and role cannot be changed', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const quill = await roster.createCurated('quill')
    await assert.rejects(roster.createCurated('quill'), refused('already_added'))
    await assert.rejects(roster.update(quill.id, { name: 'Feather' }), refused('name_fixed'))
    await assert.rejects(roster.update(quill.id, { role: 'Something else.' }), refused('role_fixed'))
    assert.equal((await roster.get(quill.id)).name, 'Quill')
  })
})

test('a specialist the world has not bought is refused by name, and one that does not exist is unknown', needsDb, async () => {
  await withRoster({ entitled: [] }, async (roster) => {
    await assert.rejects(roster.createCurated('quill'), (error) => {
      assert.ok(refused('not_entitled')(error))
      assert.match(error.message, /Quill/)
      return true
    })
    await assert.rejects(roster.createCurated('nobody'), refused('unknown_template'))
  })
})

test('a retired specialist can be added again', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const first = await roster.createCurated('quill')
    await roster.retire(first.id)
    const second = await roster.createCurated('quill')
    assert.notEqual(second.id, first.id)
  })
})

test('the specialists list says which the world may have and which it has', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const before = (await roster.specialists()).find((s) => s.id === 'quill')
    assert.deepEqual([before.entitled, before.agentId, before.name], [true, null, 'Quill'])
    const quill = await roster.createCurated('quill')
    assert.equal((await roster.specialists()).find((s) => s.id === 'quill').agentId, quill.id)
  })
  await withRoster({ entitled: [] }, async (roster) => {
    assert.equal((await roster.specialists()).find((s) => s.id === 'quill').entitled, false)
  })
})

test('one world never sees another world\'s agents or names', needsDb, async () => {
  await withRoster({}, async (roster, { make }) => {
    const mine = await roster.create({ name: 'Ada', runtime: 'hermes' })
    const theirs = make({ worldId: 'other' })
    assert.deepEqual(await theirs.list(), [])
    await assert.rejects(theirs.get(mine.id), refused('unknown_agent'))
    await assert.rejects(theirs.retire(mine.id), refused('unknown_agent'))
    assert.equal((await theirs.create({ name: 'Ada', runtime: 'hermes' })).name, 'Ada')
    assert.equal((await roster.list()).length, 1)
  })
})

test('a look-alike of a specialist\'s name cannot be taken and then block the specialist', needsDb, async () => {
  await withRoster({}, async (roster) => {
    await assert.rejects(roster.create({ name: 'QUİLL', runtime: 'hermes' }), refused('name_reserved'))
    await roster.create({ name: 'Zoë', runtime: 'hermes' })
    await assert.rejects(roster.create({ name: 'Zoe', runtime: 'hermes' }), refused('name_taken'))
    assert.equal((await roster.createCurated('quill')).name, 'Quill')
  })
})

test('a rename and a new role arriving together are both kept', needsDb, async () => {
  await withRoster({}, async (roster, { sql }) => {
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes', role: 'Old role.' })
    // Hold the roster's own lock so both changes are waiting on it at the same moment.
    let release
    const held = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${'crew-roster:w'}))`
      await new Promise((resolve) => { release = resolve })
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const both = Promise.all([roster.update(ada.id, { name: 'Grace' }), roster.update(ada.id, { role: 'New role.' })])
    await new Promise((resolve) => setTimeout(resolve, 150))
    release()
    await held
    await both
    const now = await roster.get(ada.id)
    assert.deepEqual([now.name, now.role], ['Grace', 'New role.'])
  })
})

test('a specialist the world is no longer entitled to is retired, and so is one whose template is gone', needsDb, async () => {
  await withRoster({}, async (roster, { make }) => {
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    const quill = await roster.createCurated('quill')
    assert.deepEqual(await roster.reconcile(), [], 'an entitled specialist is left alone')

    const downgraded = make({ entitled: [] })
    assert.deepEqual(await downgraded.reconcile(), ['Quill'])
    assert.deepEqual((await downgraded.list()).map((a) => a.id), [ada.id])
    await assert.rejects(downgraded.get(quill.id), refused('unknown_agent'))
    assert.deepEqual(await downgraded.reconcile(), [], 'and only once')

    // Entitled again later: a new Quill, not the old one brought back.
    const again = await roster.createCurated('quill')
    assert.notEqual(again.id, quill.id)

    const empty = { templates: [], byId: new Map(), reserved: new Set() }
    const withoutTemplate = make({ catalog: empty, entitled: [] })
    assert.deepEqual(await withoutTemplate.reconcile(), ['Quill'])
    assert.deepEqual((await withoutTemplate.list()).map((a) => a.name), ['Ada'])
  })
})
