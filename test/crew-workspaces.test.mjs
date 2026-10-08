// test/crew-workspaces.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checkGitUrl, createWorkspaces } from '../server/crew/workspaces.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code
const exists = (file) => fs.access(file).then(() => true, () => false)

/** Set by `withWorkspaces` so a test's own clone function can look at the list mid-clone. */
let listNow = async () => []

const withWorkspaces = (run, options = {}) =>
  withDb(async (sql) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-ws-'))
    const cloned = []
    const clone = async (url, folder) => {
      cloned.push([url, folder])
      await fs.writeFile(path.join(folder, 'README.md'), `from ${url}`)
    }
    const make = (more = {}) => createWorkspaces({ sql, worldId: 'w', dataDir, clone, ...options, ...more })
    const first = make()
    listNow = () => first.list()
    try {
      return await run(first, { sql, dataDir, cloned, make })
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })

test('an address git would treat as a command or a local path is refused before git runs', () => {
  for (const good of ['https://github.com/nodexeus/worlds.git', 'ssh://git@github.com/nodexeus/worlds.git', 'git@github.com:nodexeus/worlds.git', '  https://example.com/a.git  ']) {
    assert.equal(checkGitUrl(good), good.trim())
  }
  for (const bad of [
    '--upload-pack=touch /tmp/owned', '-oProxyCommand=evil', 'ext::sh -c evil', 'file:///etc', '/etc/passwd',
    '../other', 'http://insecure.example/a.git', 'https://exa mple.com/a.git', 'https://example.com/a.git\n--config', '', 42, null,
  ]) {
    assert.throws(() => checkGitUrl(bad), refused('bad_git_url'), `accepted ${JSON.stringify(bad)}`)
  }
})

test('a workspace is a row and an empty folder under the data directory', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    const site = await workspaces.create({ name: ' Marketing site ', description: ' The public website. ' })
    assert.equal(site.name, 'Marketing site')
    assert.equal(site.description, 'The public website.')
    assert.equal(site.gitUrl, null)
    assert.equal(site.folder, path.join(dataDir, 'workspaces', site.id))
    assert.equal(workspaces.folderOf(site.id), site.folder)
    assert.deepEqual(await fs.readdir(site.folder), [])
    assert.deepEqual(await workspaces.list(), [site])
    assert.deepEqual(await workspaces.get(site.id), site)
  })
})

test('the folder is named by the id, never by anything a person typed', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    const sneaky = await workspaces.create({ name: '../../escape' })
    assert.ok(sneaky.folder.startsWith(path.join(dataDir, 'workspaces') + path.sep))
    assert.match(path.basename(sneaky.folder), /^[0-9a-f-]{36}$/)
    assert.ok(!(await exists(path.join(dataDir, '..', 'escape'))))
  })
})

test('what cannot be a workspace is refused and leaves nothing behind', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    for (const name of [undefined, '', '   ', 'x'.repeat(49), 'line\nbreak', 42]) {
      await assert.rejects(workspaces.create({ name }), refused('bad_workspace_name'))
    }
    await assert.rejects(workspaces.create({ name: 'A', description: 'x'.repeat(201) }), refused('bad_description'))
    await assert.rejects(workspaces.create({ name: 'A', description: 42 }), refused('bad_description'))
    await assert.rejects(workspaces.create({ name: 'A', gitUrl: 'file:///etc' }), refused('bad_git_url'))
    assert.deepEqual(await workspaces.list(), [])
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'workspaces')).catch(() => []), [])
  })
})

test('a name in use is taken whatever its case', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    await workspaces.create({ name: 'Billing' })
    await assert.rejects(workspaces.create({ name: 'billing' }), refused('workspace_name_taken'))
  })
})

test('a git source is cloned into the folder', needsDb, async () => {
  await withWorkspaces(async (workspaces, { cloned }) => {
    const repo = await workspaces.create({ name: 'Repo', gitUrl: 'https://example.com/a.git' })
    assert.equal(repo.gitUrl, 'https://example.com/a.git')
    assert.deepEqual(cloned.map(([url]) => url), ['https://example.com/a.git'])
    assert.equal(await fs.readFile(path.join(repo.folder, 'README.md'), 'utf8'), 'from https://example.com/a.git')
  })
})

test('a clone that fails leaves no workspace and no folder, and says what git said', needsDb, async () => {
  await withWorkspaces(
    async (workspaces, { dataDir }) => {
      await assert.rejects(workspaces.create({ name: 'Repo', gitUrl: 'https://example.com/a.git' }), (error) => {
        assert.ok(refused('clone_failed')(error))
        assert.match(error.message, /repository not found/)
        return true
      })
      assert.deepEqual(await workspaces.list(), [])
      assert.deepEqual(await fs.readdir(path.join(dataDir, 'workspaces')), [])
      assert.equal((await workspaces.create({ name: 'Repo' })).name, 'Repo')
    },
    { clone: async () => { throw new Error('fatal: repository not found') } }
  )
})

test('renaming and describing keep the workspace and its folder', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    const a = await workspaces.create({ name: 'Alpha' })
    await workspaces.create({ name: 'Beta' })
    const b = await workspaces.update(a.id, { name: 'Gamma', description: 'Now described.' })
    assert.deepEqual([b.id, b.name, b.description, b.folder], [a.id, 'Gamma', 'Now described.', a.folder])
    assert.equal((await workspaces.update(a.id, { name: 'GAMMA' })).name, 'GAMMA')
    assert.equal((await workspaces.update(a.id, {})).name, 'GAMMA')
    await assert.rejects(workspaces.update(a.id, { name: 'beta' }), refused('workspace_name_taken'))
    await assert.rejects(workspaces.update(a.id, { name: '' }), refused('bad_workspace_name'))
    await assert.rejects(workspaces.update('not-an-id', { name: 'X' }), refused('unknown_workspace'))
  })
})

test('archiving takes it off the list, frees the name, and keeps the files', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    const a = await workspaces.create({ name: 'Alpha' })
    await fs.writeFile(path.join(a.folder, 'work.txt'), 'kept')
    await workspaces.archive(a.id)
    assert.deepEqual(await workspaces.list(), [])
    await assert.rejects(workspaces.get(a.id), refused('unknown_workspace'))
    await assert.rejects(workspaces.archive(a.id), refused('unknown_workspace'))
    assert.equal(await fs.readFile(path.join(a.folder, 'work.txt'), 'utf8'), 'kept')
    assert.notEqual((await workspaces.create({ name: 'alpha' })).id, a.id)
  })
})

test('one world never sees another world\'s workspaces', needsDb, async () => {
  await withWorkspaces(async (workspaces, { make }) => {
    const mine = await workspaces.create({ name: 'Alpha' })
    const theirs = make({ worldId: 'other' })
    assert.deepEqual(await theirs.list(), [])
    await assert.rejects(theirs.get(mine.id), refused('unknown_workspace'))
    await assert.rejects(theirs.archive(mine.id), refused('unknown_workspace'))
    assert.equal((await theirs.create({ name: 'Alpha' })).name, 'Alpha')
  })
})

test('a workspace does not exist until its source has arrived, and a taken name is refused before any cloning', needsDb, async () => {
  let during = null
  let clones = 0
  await withWorkspaces(
    async (workspaces) => {
      const repo = await workspaces.create({ name: 'Repo', gitUrl: 'https://example.com/a.git' })
      assert.deepEqual(during, [], 'it was on the list while still being cloned')
      assert.deepEqual((await workspaces.list()).map((w) => w.id), [repo.id])
      await assert.rejects(workspaces.create({ name: 'repo', gitUrl: 'https://example.com/b.git' }), refused('workspace_name_taken'))
      assert.equal(clones, 1, 'cloned a source for a name that was already taken')
    },
    {
      clone: async (url, folder) => {
        clones++
        during = await createWorkspacesList()
        await fs.writeFile(path.join(folder, 'README.md'), url)
      },
    }
  )
  async function createWorkspacesList() {
    return listNow()
  }
})

test('a clone that fails while the database is away still leaves nothing behind', needsDb, async () => {
  await withWorkspaces(async (_unused, { sql, dataDir, make }) => {
    const workspaces = make({
      clone: async () => {
        await sql.end({ timeout: 1 })
        throw new Error('fatal: could not read from remote')
      },
    })
    await assert.rejects(workspaces.create({ name: 'Half', gitUrl: 'https://example.com/a.git' }), refused('clone_failed'))
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'workspaces')), [])
  })
})

test('what a creation cut short left behind is swept away at start, and real workspaces are not', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    const kept = await workspaces.create({ name: 'Kept' })
    await fs.writeFile(path.join(kept.folder, 'work.txt'), 'kept')
    const stale = path.join(dataDir, 'workspaces', '.incoming-0193a7c0-0000-7000-8000-000000000000')
    await fs.mkdir(stale, { recursive: true })
    await fs.writeFile(path.join(stale, 'partial'), '')
    await workspaces.sweep()
    assert.equal(await exists(stale), false)
    assert.equal(await fs.readFile(path.join(kept.folder, 'work.txt'), 'utf8'), 'kept')
  })
})

test('a rename and a new description arriving together are both kept', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    for (let round = 0; round < 25; round++) {
      const space = await workspaces.create({ name: `Space${round}`, description: 'old' })
      await Promise.all([
        workspaces.update(space.id, { name: `Renamed${round}` }),
        workspaces.update(space.id, { description: 'new' }),
      ])
      const now = await workspaces.get(space.id)
      assert.deepEqual([now.name, now.description], [`Renamed${round}`, 'new'], `round ${round}`)
    }
  })
})
