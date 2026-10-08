// test/crew-boot.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createCrew } from '../server/crew/index.mjs'
import { bootCrew, resetCrewForTests } from '../server/crew/boot.mjs'
import { connect } from '../server/crew/store/db.mjs'
import { TEST_DB, needsDb } from './support/crew-db.mjs'

/** A real configuration on a schema and a data directory of its own, both removed after. */
async function withConfig(run) {
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-boot-'))
  const config = { databaseUrl: TEST_DB, schema, dataDir, worldId: 'w', agentLimit: 2, entitled: ['quill'] }
  try {
    return await run(config)
  } finally {
    const admin = connect(TEST_DB, { max: 1 })
    await admin.unsafe(`drop schema if exists "${schema}" cascade`)
    await admin.end({ timeout: 5 })
    await fs.rm(dataDir, { recursive: true, force: true })
  }
}

test('a crew starts on an empty database: schema made, tables made, parts wired', needsDb, async () => {
  await withConfig(async (config) => {
    const crew = await createCrew(config)
    try {
      assert.equal(crew.worldId, 'w')
      const agent = await crew.roster.create({ runtime: 'hermes' })
      const space = await crew.workspaces.create({ name: 'Alpha' })
      assert.ok(space.folder.startsWith(config.dataDir))
      assert.deepEqual((await crew.roster.counts()).standard, { used: 1, limit: 2 })
      assert.equal((await crew.roster.createCurated('quill')).name, 'Quill')
      assert.ok(crew.catalog.byId.has('quill'))
      assert.equal((await crew.roster.get(agent.id)).id, agent.id)
    } finally {
      await crew.close()
    }
  })
})

test('what was made survives a restart', needsDb, async () => {
  await withConfig(async (config) => {
    const first = await createCrew(config)
    const agent = await first.roster.create({ name: 'Ada', runtime: 'hermes' })
    await first.close()
    const second = await createCrew(config)
    try {
      assert.deepEqual((await second.roster.list()).map((a) => [a.id, a.name]), [[agent.id, 'Ada']])
    } finally {
      await second.close()
    }
  })
})

test('a data directory that cannot be written stops the start, and names the setting', needsDb, async () => {
  await withConfig(async (config) => {
    const file = path.join(config.dataDir, 'not-a-directory')
    await fs.writeFile(file, '')
    await assert.rejects(createCrew({ ...config, dataDir: path.join(file, 'inside') }), /WORLDS_DATA_DIR/)
  })
})

test('a database that cannot be reached stops the start, and names the setting', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-boot-'))
  try {
    await assert.rejects(
      createCrew({ databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none', schema: '', dataDir, worldId: 'w', agentLimit: 6, entitled: [] }),
      /WORLDS_DATABASE_URL/
    )
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('a specialist the world is entitled to but the server does not have stops the start', needsDb, async () => {
  await withConfig(async (config) => {
    await assert.rejects(createCrew({ ...config, entitled: ['nobody'] }), /WORLDS_CURATED_AGENTS.*nobody/)
  })
})

test('with no database there is no crew, and nothing is loaded to find that out', async () => {
  await resetCrewForTests()
  assert.equal(await bootCrew({}), null)
  await resetCrewForTests()
})

test('the process has one crew, however many times it is asked for', needsDb, async () => {
  await withConfig(async (config) => {
    await resetCrewForTests()
    const env = {
      WORLDS_DATABASE_URL: config.databaseUrl,
      WORLDS_DATABASE_SCHEMA: config.schema,
      WORLDS_DATA_DIR: config.dataDir,
    }
    const [a, b] = await Promise.all([bootCrew(env), bootCrew(env)])
    assert.equal(a, b)
    assert.equal(a.worldId, 'default')
    await resetCrewForTests()
  })
})

test('a monitor-only server never loads the Postgres client or the store', async () => {
  const { execFile } = await import('node:child_process')
  const script = `
    import { register } from 'node:module'
    register('data:text/javascript,' + encodeURIComponent(
      "export async function resolve(specifier, context, next) {" +
      "  const found = await next(specifier, context);" +
      "  if (specifier === 'postgres' || /crew\\\\/(index\\\\.mjs|store\\\\/)/.test(found.url)) throw new Error('LOADED ' + found.url);" +
      "  return found }"
    ))
    const { apiMiddleware } = await import('./server/api.mjs')
    const { bootCrew } = await import('./server/crew/boot.mjs')
    await import('./server/http-server.mjs')
    if ((await bootCrew({})) !== null || typeof apiMiddleware !== 'function') throw new Error('unexpected')
    console.log('clean')
  `
  const out = await new Promise((resolve) =>
    execFile(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, WORLDS_DATABASE_URL: '' } },
      (error, stdout, stderr) => resolve({ stdout, stderr }))
  )
  assert.equal(out.stdout.trim(), 'clean', out.stderr)
})

test('starting without an entitlement retires the specialist that needed it', needsDb, async () => {
  await withConfig(async (config) => {
    const first = await createCrew(config)
    await first.roster.createCurated('quill')
    await first.roster.create({ name: 'Ada', runtime: 'hermes' })
    await first.close()
    const second = await createCrew({ ...config, entitled: [] })
    try {
      assert.deepEqual((await second.roster.list()).map((a) => a.name), ['Ada'])
    } finally {
      await second.close()
    }
  })
})
