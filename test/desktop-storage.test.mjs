import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importColony, readPreferences, writePreferences } from '../desktop/storage.mjs'

/** Allocate a temporary data directory and clean it after the test.
 * @param {(root: string) => Promise<void>} run
 * @returns {Promise<void>}
 */
async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-desktop-'))
  try { await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
}

test('first-run import preserves colony data and leaves its source intact', async () => {
  await withRoot(async root => {
    const source = path.join(root, 'source.json')
    const target = path.join(root, 'app')
    const contents = JSON.stringify({ version: 2, archived: ['one'], settings: { planet: 'ocean' } })
    await fs.writeFile(source, contents)
    assert.equal(await importColony(source, target), true)
    assert.equal(await fs.readFile(path.join(target, 'colony.json'), 'utf8'), contents)
    assert.equal(await fs.readFile(source, 'utf8'), contents)
  })
})

test('import never overwrites an existing colony', async () => {
  await withRoot(async root => {
    const source = path.join(root, 'source.json')
    await fs.writeFile(source, JSON.stringify({ version: 2 }))
    await fs.writeFile(path.join(root, 'colony.json'), 'original')
    assert.equal(await importColony(source, root), false)
    assert.equal(await fs.readFile(path.join(root, 'colony.json'), 'utf8'), 'original')
  })
})

test('invalid migration input does not create colony state', async () => {
  await withRoot(async root => {
    const source = path.join(root, 'source.json')
    for (const invalid of ['broken', 'null', '[]', '{"settings":[]}']) {
      await fs.writeFile(source, invalid)
      await assert.rejects(importColony(source, path.join(root, 'app')))
    }
    await assert.rejects(fs.access(path.join(root, 'app', 'colony.json')))
  })
})

test('missing migration source is a normal first launch', async () => {
  await withRoot(async root => {
    assert.equal(await importColony(path.join(root, 'missing'), root), false)
  })
})

test('import accepts the existing API empty-state format with null settings', async () => {
  await withRoot(async root => {
    const source = path.join(root, 'source.json')
    await fs.writeFile(source, JSON.stringify({ version: 2, settings: null, plots: {}, archived: [] }))
    assert.equal(await importColony(source, path.join(root, 'app')), true)
  })
})

test('menu-bar preference persists independently of the colony', async () => {
  await withRoot(async root => {
    assert.deepEqual(await readPreferences(root), { keepInMenuBar: true })
    await writePreferences(root, { keepInMenuBar: false })
    assert.deepEqual(await readPreferences(root), { keepInMenuBar: false })
    await fs.writeFile(path.join(root, 'desktop.json'), '{broken')
    assert.deepEqual(await readPreferences(root), { keepInMenuBar: true })
  })
})
