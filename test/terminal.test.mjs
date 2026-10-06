/**
 * The terminal launcher: which emulator it picks, and when it refuses to try at all.
 *
 * Every emulator here is a shell script that records its argv and exits 0, named after a real
 * terminal so the flag table matches it. Absolute paths keep PATH out of it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { launchScript, listTerminals, openInTerminal } from '../server/lib/terminal.mjs'
import { withEnv, withPlatform, fakeExecutable } from './support/env.mjs'

const ARGV = ['/bin/true', 'x']
const posixOnly = { skip: process.platform === 'win32' }

async function withTmp(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-terminal-'))
  try {
    return await fn(dir)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

const nothingInstalled = (dir) => ({
  PATH: dir,
  BOT_CROSSING_TERMINAL: undefined,
  TERMINAL: undefined,
  XDG_CURRENT_DESKTOP: '',
  DISPLAY: ':0',
})

test('openInTerminal refuses anything not already resolved to absolute paths', async () => {
  assert.equal((await openInTerminal(['ls'], '/tmp')).ok, false, 'relative argv[0]')
  assert.equal((await openInTerminal(['/bin/ls'], 'relative')).ok, false, 'relative cwd')
  assert.equal((await openInTerminal([], '/tmp')).ok, false, 'empty argv')
  assert.equal((await openInTerminal(['/bin/ls', 123], '/tmp')).ok, false, 'non-string argument')
})

test('BOT_CROSSING_TERMINAL wins over $TERMINAL, and the loser is never started', posixOnly, async () => {
  await withTmp(async (dir) => {
    const kitty = await fakeExecutable(dir, 'kitty')
    const alacritty = await fakeExecutable(dir, 'alacritty')
    const env = { ...nothingInstalled(dir), BOT_CROSSING_TERMINAL: kitty.file, TERMINAL: alacritty.file }
    const result = await withEnv(env, () => openInTerminal(ARGV, dir))
    assert.equal(result.ok, true)
    assert.deepEqual(await kitty.argv(), [`--directory=${dir}`, ...ARGV])
    assert.equal(await alacritty.called(), false)
  })
})

test('a named terminal the table does not know is skipped, not guessed at', posixOnly, async () => {
  await withTmp(async (dir) => {
    const tilix = await fakeExecutable(dir, 'tilix')
    const kitty = await fakeExecutable(dir, 'kitty')
    const env = { ...nothingInstalled(dir), BOT_CROSSING_TERMINAL: tilix.file, TERMINAL: kitty.file }
    await withEnv(env, () => openInTerminal(ARGV, dir))
    assert.equal(await tilix.called(), false)
    assert.deepEqual(await kitty.argv(), [`--directory=${dir}`, ...ARGV])
  })
})

test('with no terminal anywhere, the error says which variable to set', posixOnly, async () => {
  await withTmp(async (dir) => {
    const result = await withEnv(nothingInstalled(dir), () => openInTerminal(ARGV, dir))
    assert.equal(result.ok, false)
    assert.match(result.error, /BOT_CROSSING_TERMINAL/)
  })
})

test('a missing DISPLAY is a refusal on Linux and nothing at all on macOS', posixOnly, async () => {
  await withTmp(async (dir) => {
    const kitty = await fakeExecutable(dir, 'kitty')
    const headless = {
      ...nothingInstalled(dir),
      BOT_CROSSING_TERMINAL: kitty.file,
      DISPLAY: undefined,
      WAYLAND_DISPLAY: undefined,
      XDG_RUNTIME_DIR: undefined,
    }
    const onLinux = await withPlatform('linux', () => withEnv(headless, () => openInTerminal(ARGV, dir)))
    assert.match(onLinux.error, /graphical display/)
    const onMac = await withPlatform('darwin', () => withEnv(headless, () => openInTerminal(ARGV, dir)))
    assert.equal(onMac.ok, true)
  })
})

// ── a terminal picked from the installed list ─────────────────────────────────

/** An empty directory named like an application bundle is all detection looks for. */
async function fakeApp(dir, bundle) {
  const app = path.join(dir, bundle)
  await fsp.mkdir(app)
  return app
}

test('listTerminals finds macOS app bundles and offers only an id and a name', posixOnly, async () => {
  await withTmp(async (dir) => {
    await fakeApp(dir, 'Warp.app')
    await fakeApp(dir, 'Ghostty.app')
    const found = await withPlatform('darwin', () =>
      withEnv(nothingInstalled(dir), () => listTerminals({ appDirs: [dir] }))
    )
    assert.deepEqual(found, [
      { id: 'warp', name: 'Warp' },
      { id: 'ghostty', name: 'Ghostty' },
    ])
  })
})

test('listTerminals on Linux lists the known emulators on PATH', posixOnly, async () => {
  await withTmp(async (dir) => {
    await fakeExecutable(dir, 'kitty')
    await fakeExecutable(dir, 'tilix')
    const found = await withPlatform('linux', () => withEnv(nothingInstalled(dir), () => listTerminals()))
    assert.deepEqual(found, [{ id: 'kitty', name: 'kitty' }], 'tilix has no known flags, so it is not offered')
  })
})

test('a picked terminal is the only one started, whatever the environment names', posixOnly, async () => {
  await withTmp(async (dir) => {
    const kitty = await fakeExecutable(dir, 'kitty')
    const alacritty = await fakeExecutable(dir, 'alacritty')
    const env = { ...nothingInstalled(dir), BOT_CROSSING_TERMINAL: kitty.file }
    const result = await withPlatform('linux', () =>
      withEnv(env, () => openInTerminal(ARGV, dir, { terminal: 'alacritty' }))
    )
    assert.equal(result.ok, true)
    assert.deepEqual(await alacritty.argv(), ['--working-directory', dir, '-e', ...ARGV])
    assert.equal(await kitty.called(), false)
  })
})

test('a picked terminal that is not installed fails rather than opening another', posixOnly, async () => {
  await withTmp(async (dir) => {
    const kitty = await fakeExecutable(dir, 'kitty')
    const result = await withPlatform('linux', () =>
      withEnv(nothingInstalled(dir), () => openInTerminal(ARGV, dir, { terminal: 'warp' }))
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /not installed/)
    assert.equal(await kitty.called(), false)
  })
})

test('a macOS terminal that takes no argv is handed a script through open', posixOnly, async () => {
  await withTmp(async (dir) => {
    const app = await fakeApp(dir, 'Warp.app')
    const opener = await fakeExecutable(dir, 'open')
    const argv = ['/bin/echo', "it's", 'two words']
    const result = await withPlatform('darwin', () =>
      withEnv(nothingInstalled(dir), () =>
        openInTerminal(argv, dir, { terminal: 'warp', appDirs: [dir], opener: opener.file })
      )
    )
    assert.equal(result.ok, true)
    const [flag, target, script] = await opener.argv()
    assert.deepEqual([flag, target], ['-a', app])
    try {
      assert.equal(path.extname(script), '.command')
      assert.equal(await fsp.readFile(script, 'utf8'), launchScript(argv, dir))
      assert.equal((await fsp.stat(script)).mode & 0o777, 0o700, 'runnable, and private to this user')
    } finally {
      await fsp.rm(path.dirname(script), { recursive: true, force: true })
    }
  })
})

test('a macOS terminal that takes flags gets them after --args', posixOnly, async () => {
  await withTmp(async (dir) => {
    const app = await fakeApp(dir, 'Ghostty.app')
    const opener = await fakeExecutable(dir, 'open')
    const result = await withPlatform('darwin', () =>
      withEnv(nothingInstalled(dir), () =>
        openInTerminal(ARGV, dir, { terminal: 'ghostty', appDirs: [dir], opener: opener.file })
      )
    )
    assert.equal(result.ok, true)
    assert.deepEqual(await opener.argv(), ['-n', '-a', app, '--args', `--working-directory=${dir}`, '-e', ...ARGV])
  })
})

test('launchScript quotes every word, so the shell runs the argv exactly as given', posixOnly, async () => {
  await withTmp(async (dir) => {
    const out = path.join(dir, 'out')
    const cwd = await fsp.mkdtemp(path.join(dir, "it's here "))
    const words = ["it's", 'two words', '$HOME', '`id`', '; rm -rf /', '']
    const script = path.join(dir, 'run.command')
    // `printf` stands in for a CLI: one line per argument it actually received, then the folder.
    const argv = ['/bin/sh', '-c', `printf '%s\\n' "$@" > '${out}'; pwd -P >> '${out}'`, 'sh', ...words]
    await fsp.writeFile(script, launchScript(argv, cwd), { mode: 0o700 })
    const { execFile } = await import('node:child_process')
    await new Promise((resolve, reject) => execFile(script, (err) => (err ? reject(err) : resolve())))
    assert.deepEqual((await fsp.readFile(out, 'utf8')).split('\n').slice(0, -1), [...words, await fsp.realpath(cwd)])
  })
})
