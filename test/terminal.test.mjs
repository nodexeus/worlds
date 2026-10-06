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

import { launchScript, listTerminals, openInTerminal, warpLaunchConfig } from '../server/lib/terminal.mjs'
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
    // `appDirs` keeps a Mac's real Terminal out of it: there, an installed app is the last resort.
    const result = await withEnv(nothingInstalled(dir), () => openInTerminal(ARGV, dir, { appDirs: [dir] }))
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
    const onMac = await withPlatform('darwin', () => withEnv(headless, () => openInTerminal(ARGV, dir, { appDirs: [dir] })))
    assert.equal(onMac.ok, true)
  })
})

// ── a terminal picked from the installed list ─────────────────────────────────

const macOnly = { skip: process.platform !== 'darwin' }

/**
 * A directory named like an application bundle. `shellFor` gives it an `Info.plist` declaring
 * itself the shell for that file extension, which is all detection reads.
 */
async function fakeApp(dir, bundle, { shellFor } = {}) {
  const app = path.join(dir, bundle)
  await fsp.mkdir(path.join(app, 'Contents'), { recursive: true })
  if (shellFor) {
    await fsp.writeFile(
      path.join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeRole</key><string>Shell</string>
<key>CFBundleTypeExtensions</key><array><string>${shellFor}</string></array>
</dict></array></dict></plist>
`
    )
  }
  return app
}

// Reads real plists with `plutil`, so it only runs where there is one.
test('listTerminals finds any macOS app that declares itself a shell for .command files', macOnly, async () => {
  await withTmp(async (dir) => {
    await fakeApp(dir, 'Tabby.app', { shellFor: 'command' })
    await fakeApp(dir, 'Zap.app', { shellFor: 'command' })
    await fakeApp(dir, 'Ghostty.app')
    await fakeApp(dir, 'Notes.app')
    await fakeApp(dir, 'Chat.app', { shellFor: 'chattoken' })
    const found = await withEnv(nothingInstalled(dir), () => listTerminals({ appDirs: [dir] }))
    assert.deepEqual(found, [
      { id: 'Ghostty.app', name: 'Ghostty' },
      { id: 'Tabby.app', name: 'Tabby' },
      { id: 'Zap.app', name: 'Zap' },
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
      withEnv(nothingInstalled(dir), () => openInTerminal(ARGV, dir, { terminal: 'Zap.app' }))
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /not installed/)
    assert.equal(await kitty.called(), false)
  })
})

test('a macOS terminal that takes no argv is handed a script through open', posixOnly, async () => {
  await withTmp(async (dir) => {
    const app = await fakeApp(dir, 'Terminal.app')
    const opener = await fakeExecutable(dir, 'open')
    const argv = ['/bin/echo', "it's", 'two words']
    const result = await withPlatform('darwin', () =>
      withEnv(nothingInstalled(dir), () =>
        openInTerminal(argv, dir, { terminal: 'Terminal.app', appDirs: [dir], opener: opener.file })
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
        openInTerminal(ARGV, dir, { terminal: 'Ghostty.app', appDirs: [dir], opener: opener.file })
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

test('with nothing named on macOS, the automatic route falls back to Terminal first', posixOnly, async () => {
  await withTmp(async (dir) => {
    await fakeApp(dir, 'iTerm.app')
    const terminal = await fakeApp(dir, 'Terminal.app')
    const opener = await fakeExecutable(dir, 'open')
    const result = await withPlatform('darwin', () =>
      withEnv(nothingInstalled(dir), () => openInTerminal(ARGV, dir, { appDirs: [dir], opener: opener.file }))
    )
    assert.equal(result.ok, true)
    const [flag, target, script] = await opener.argv()
    assert.deepEqual([flag, target], ['-a', terminal])
    await fsp.rm(path.dirname(script), { recursive: true, force: true })
  })
})

test('a Warp-family terminal is handed a launch configuration through its own link', posixOnly, async () => {
  await withTmp(async (dir) => {
    await fakeApp(dir, 'Zap.app')
    const opener = await fakeExecutable(dir, 'open')
    const argv = ['/bin/echo', "it's", 'two words']
    const result = await withPlatform('darwin', () =>
      withEnv(nothingInstalled(dir), () =>
        openInTerminal(argv, dir, { terminal: 'Zap.app', appDirs: [dir], opener: opener.file, home: dir })
      )
    )
    assert.equal(result.ok, true)
    const [link] = await opener.argv()
    assert.match(link, /^zap:\/\/launch\/nodexeus-worlds-[0-9a-f-]+$/)
    const name = link.slice('zap://launch/'.length)
    const config = await fsp.readFile(path.join(dir, '.zap', 'launch_configurations', `${name}.yaml`), 'utf8')
    assert.equal(config, warpLaunchConfig(name, argv, dir))
    assert.ok(config.includes(`cwd: ${JSON.stringify(dir)}`))
    assert.ok(config.includes(String.raw`exec: "'/bin/echo' 'it'\\''s' 'two words'"`), config)
  })
})
