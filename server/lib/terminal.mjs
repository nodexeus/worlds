/**
 * Put a command in a new terminal window.
 *
 * Only `server/api.mjs` uses this, on Linux and macOS. It is split out because it is a page of
 * terminal-emulator trivia with nothing to do with HTTP, and nothing in here knows about a
 * particular harness — an adapter never imports it. An adapter hands the server an argv; the
 * server decides whether a terminal is the right place for it.
 */
import { execFile, spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findExecutable } from './fsutil.mjs'
import { openInTerminalWindows } from './win-terminal.mjs'

/**
 * How each terminal wants "run this command in this directory". The command comes after the
 * terminal's own end-of-options marker where it has one, so nothing in it is ever read as a
 * flag; the working directory is also set on the spawn itself, which is all the xterm family
 * needs and what the D-Bus terminals forward to their server anyway.
 *
 * Only terminals whose flags are documented are listed. `tilix` is deliberately absent: its `-e`
 * takes one string that it re-splits itself, which would mean building a shell string.
 */
const TERMINALS = {
  'gnome-terminal': (dir, cmd) => [`--working-directory=${dir}`, '--', ...cmd],
  kgx: (dir, cmd) => [`--working-directory=${dir}`, '--', ...cmd],
  ptyxis: (dir, cmd) => [`--working-directory=${dir}`, '--', ...cmd],
  konsole: (dir, cmd) => ['--workdir', dir, '-e', ...cmd],
  'xfce4-terminal': (dir, cmd) => [`--working-directory=${dir}`, '-x', ...cmd],
  'mate-terminal': (dir, cmd) => [`--working-directory=${dir}`, '-x', ...cmd],
  kitty: (dir, cmd) => [`--directory=${dir}`, ...cmd],
  alacritty: (dir, cmd) => ['--working-directory', dir, '-e', ...cmd],
  ghostty: (dir, cmd) => [`--working-directory=${dir}`, '-e', ...cmd],
  wezterm: (dir, cmd) => ['start', '--cwd', dir, '--', ...cmd],
  foot: (dir, cmd) => [`--working-directory=${dir}`, ...cmd],
  terminator: (dir, cmd) => [`--working-directory=${dir}`, '-x', ...cmd],
  xterm: (_dir, cmd) => ['-e', ...cmd],
  uxterm: (_dir, cmd) => ['-e', ...cmd],
  urxvt: (_dir, cmd) => ['-e', ...cmd],
  rxvt: (_dir, cmd) => ['-e', ...cmd],
  st: (_dir, cmd) => ['-e', ...cmd],
}

const GENERAL_ORDER = [
  'gnome-terminal', 'konsole', 'xfce4-terminal', 'mate-terminal', 'kitty', 'alacritty', 'ghostty',
  'wezterm', 'foot', 'terminator', 'ptyxis', 'kgx', 'xterm', 'uxterm', 'urxvt', 'rxvt', 'st',
]

/** What the settings list calls each one. A terminal missing here is listed by its own name. */
const LABELS = {
  'gnome-terminal': 'GNOME Terminal', kgx: 'GNOME Console', ptyxis: 'Ptyxis', konsole: 'Konsole',
  'xfce4-terminal': 'Xfce Terminal', 'mate-terminal': 'MATE Terminal', alacritty: 'Alacritty',
  ghostty: 'Ghostty', wezterm: 'WezTerm', terminator: 'Terminator', urxvt: 'rxvt-unicode',
}

/**
 * macOS terminals are found as application bundles, because that is how they are installed
 * there: none of them puts a binary on `PATH` by default, and a Finder-launched app would not
 * see the user's `PATH` or `$TERMINAL` anyway.
 *
 * Nothing is matched by product name except the four below, which take the same flags as on
 * Linux. Every other terminal is recognised by what its own `Info.plist` declares: a bundle
 * that says it is the *shell* for `.command` scripts can be handed one, whatever it is called.
 * That is what lets a fork or a terminal nobody has heard of show up without a release here.
 */
const MAC_FLAG_APPS = { 'Ghostty.app': 'ghostty', 'kitty.app': 'kitty', 'Alacritty.app': 'alacritty', 'WezTerm.app': 'wezterm' }
/** Offered even when the plist cannot be read: these two are known to run a `.command`. */
const MAC_SCRIPT_APPS = new Set(['Terminal.app', 'iTerm.app'])

const macAppDirs = () => [
  '/Applications', '/Applications/Utilities', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications'),
]

/** How long one sweep of the application folders is trusted before the next request repeats it. */
const MAC_SCAN_TTL_MS = 30000
let macScan = null

/** How long a launch script is left on disk for the terminal to pick up. */
const SCRIPT_TTL_MS = 60000

/**
 * A terminal that ships with the desktop first. `XDG_CURRENT_DESKTOP` is a colon list, such as
 * `ubuntu:GNOME`, and GNOME gets the three it has shipped over the years in the order they are
 * most likely to be the one actually configured.
 */
function desktopOrder() {
  const parts = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase().split(':')
  if (parts.includes('kde')) return ['konsole']
  if (parts.includes('xfce')) return ['xfce4-terminal']
  if (parts.includes('mate')) return ['mate-terminal']
  if (parts.some((p) => ['gnome', 'ubuntu', 'unity', 'cinnamon', 'x-cinnamon'].includes(p))) {
    return ['gnome-terminal', 'kgx', 'ptyxis']
  }
  return []
}

/**
 * Is there anywhere for a window to appear? Deliberately loose: only the plainly headless case
 * is refused here, so that it gets a message saying so, and anything less clear-cut is left to
 * the launch itself, whose exit code is the real answer. Wayland clients find their socket
 * without the variable being set, so the runtime dir is checked too.
 */
async function hasDisplay() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return true
  const run = process.env.XDG_RUNTIME_DIR
  if (!run) return false
  try {
    return (await fsp.readdir(run)).some((name) => name.startsWith('wayland-'))
  } catch {
    return false
  }
}

/**
 * A terminal that refuses does so at once — well under 50 ms on a GNOME desktop — while a window
 * takes longer than this to come up. A refusal slower than this is knowingly reported as a
 * success: the alternative, treating every late non-zero exit as a failure, would open a second
 * terminal whenever the command inside the first one ended quickly.
 */
const REFUSAL_MS = 300
/** After this a foreground terminal (xterm, Debian's `--wait` wrapper) is plainly up. */
const GRACE_MS = 1500
/**
 * And a ceiling on the whole walk. Each candidate can cost `GRACE_MS`, and a machine with
 * several terminals installed and a display that is misbehaving would otherwise hold the request
 * for the sum of them while the page waits on a spinner. Better to give up and say so.
 */
const WALK_BUDGET_MS = 4000

/**
 * Spawn a terminal and say whether it actually came up. The D-Bus terminals hand the window to a
 * service and exit 0 at once; when they cannot — no display, a flag they reject — they exit
 * non-zero just as fast, and that is the failure worth reporting instead of a toast that says
 * "opened". A non-zero exit that arrives *later* is different: the window came up and the command
 * inside it has ended, which is the user's to see and no reason to open a second terminal on top.
 */
function trySpawn(cmd, args, cwd) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, stdio: 'ignore', detached: true })
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) })
      return
    }
    const startedAt = Date.now()
    let timer = null
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', (err) => done({ ok: false, error: err?.message || String(err) }))
    child.on('exit', (code, signal) => {
      if (code === 0 || Date.now() - startedAt >= REFUSAL_MS) return done({ ok: true })
      const how = signal ? `signal ${signal}` : `code ${code}`
      done({ ok: false, error: `${path.basename(cmd)} exited with ${how}` })
    })
    timer = setTimeout(() => {
      child.unref()
      done({ ok: true })
    }, GRACE_MS)
  })
}

/**
 * Does this bundle declare itself the shell for `.command` scripts? `plutil` does the reading
 * because an `Info.plist` is as often binary as XML. Any failure is a plain "no".
 */
function runsShellScripts(bundle) {
  return new Promise((resolve) => {
    const plist = path.join(bundle, 'Contents', 'Info.plist')
    const args = ['-extract', 'CFBundleDocumentTypes', 'json', '-o', '-', plist]
    execFile('/usr/bin/plutil', args, { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(false)
      try {
        const types = JSON.parse(stdout)
        resolve(Array.isArray(types) && types.some((type) =>
          type?.CFBundleTypeRole === 'Shell' &&
          ((type.LSItemContentTypes || []).includes('com.apple.terminal.shell-script') ||
            (type.CFBundleTypeExtensions || []).includes('command'))))
      } catch {
        resolve(false)
      }
    })
  })
}

/** Every terminal among the application bundles in `dirs`, by name. The first folder wins a tie. */
async function scanMacApps(dirs) {
  const bundles = new Map()
  for (const dir of dirs) {
    for (const entry of await fsp.readdir(dir).catch(() => [])) {
      if (entry.endsWith('.app') && !bundles.has(entry)) bundles.set(entry, path.join(dir, entry))
    }
  }
  const found = await Promise.all([...bundles].map(async ([entry, app]) => {
    const base = { id: entry, name: entry.slice(0, -'.app'.length), app }
    if (MAC_FLAG_APPS[entry]) return { ...base, flags: MAC_FLAG_APPS[entry] }
    if (MAC_SCRIPT_APPS.has(entry) || (await runsShellScripts(app))) return { ...base, script: true }
    return null
  }))
  return found.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * The terminals on this machine that can be driven, in the order the settings list shows them.
 *
 * A binary on `PATH` wins over an application bundle of the same terminal, since that is the
 * one the user put there on purpose. `appDirs` is only ever passed by the tests, which also
 * keeps them clear of the cache.
 *
 * @param {{appDirs?: string[]}} [options]
 * @returns {Promise<Array<{id: string, name: string, flags?: string, exec?: string, app?: string, script?: boolean}>>}
 */
async function installedTerminals({ appDirs } = {}) {
  if (process.platform === 'win32') return []
  let found = []
  if (process.platform === 'darwin') {
    if (appDirs) found = await scanMacApps(appDirs)
    else {
      if (!macScan || Date.now() - macScan.at > MAC_SCAN_TTL_MS) macScan = { at: Date.now(), list: scanMacApps(macAppDirs()) }
      found = (await macScan.list).map((t) => ({ ...t }))
    }
  }
  for (const name of new Set([...desktopOrder(), ...GENERAL_ORDER])) {
    const exec = await findExecutable(name)
    if (!exec) continue
    const bundled = found.find((t) => t.flags === name)
    if (bundled) Object.assign(bundled, { exec, app: undefined })
    else found.push({ id: name, name: LABELS[name] || name, flags: name, exec })
  }
  return found
}

/**
 * The same list for the page: an id to send back and a name to show, and nothing else. Paths
 * stay on this side, so the page can only ever choose among terminals found here.
 *
 * @param {{appDirs?: string[]}} [options]
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listTerminals(options) {
  return (await installedTerminals(options)).map(({ id, name }) => ({ id, name }))
}

const quote = (text) => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * The script a `.command` terminal is handed. Every word is single-quoted, the one shell
 * quoting with no escapes to get wrong, so the argv arrives exactly as the adapter built it.
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {string}
 */
export function launchScript(argv, cwd) {
  return ['#!/bin/sh', `cd -- ${quote(cwd)} || exit 1`, `exec ${argv.map(quote).join(' ')}`, ''].join('\n')
}

/** Write that script somewhere only this user can read, and clear it away afterwards. */
async function writeLaunchScript(argv, cwd) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nodexeus-worlds-open-'))
  const file = path.join(dir, 'open-thread.command')
  await fsp.writeFile(file, launchScript(argv, cwd), { mode: 0o700 })
  setTimeout(() => void fsp.rm(dir, { recursive: true, force: true }).catch(() => {}), SCRIPT_TTL_MS).unref()
  return file
}

/** Start one terminal from the installed list. */
async function launchInstalled(terminal, argv, cwd, opener) {
  if (terminal.exec) return trySpawn(terminal.exec, TERMINALS[terminal.flags](cwd, argv), cwd)
  if (terminal.script) return trySpawn(opener, ['-a', terminal.app, await writeLaunchScript(argv, cwd)], cwd)
  return trySpawn(opener, ['-n', '-a', terminal.app, '--args', ...TERMINALS[terminal.flags](cwd, argv)], cwd)
}

/**
 * Run `argv` in a new terminal window with `cwd` as its working directory.
 *
 * The caller has already resolved both: `argv[0]` is an absolute executable and `cwd` an
 * existing directory. Which terminal is up to the machine — `BOT_CROSSING_TERMINAL` if set, then
 * `$TERMINAL`, then the desktop's own, then whatever is installed, then Debian's
 * `x-terminal-emulator` alternative. That last is tried by name and given `-e`, the one form
 * Debian policy guarantees, because on Ubuntu it is a wrapper script that knows no other flags —
 * pass it `--working-directory` and it opens an empty window. Which is also why a real
 * `gnome-terminal` is looked for first.
 *
 * A named terminal the table does not know is skipped rather than guessed at: `-e` means "the
 * rest of the line" to xterm and "one string, which I will split" to tilix, and guessing wrong
 * opens a window on the wrong command — worse than moving on to a terminal we do know.
 *
 * On macOS the desktop walk finds nothing, so only a named terminal works there — kitty,
 * alacritty, ghostty and wezterm take the same flags on both.
 *
 * `options.terminal` is an id from `listTerminals`, chosen in the settings. It skips the walk
 * entirely: that terminal is started or the call fails, because opening a different one after
 * somebody picked theirs reads as the setting being ignored. `appDirs` and `opener` are only
 * ever passed by the tests.
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @param {{terminal?: string, appDirs?: string[], opener?: string}} [options]
 */
export async function openInTerminal(argv, cwd, { terminal, appDirs, opener = '/usr/bin/open' } = {}) {
  // Windows shares none of the trivia below — no PATH walk over sixteen emulators, no display
  // to check — so it is a different file entirely, reached through the same door. The caller
  // asks for a terminal and does not learn which platform it is on.
  if (process.platform === 'win32') return openInTerminalWindows(argv, cwd)

  const wellFormed = Array.isArray(argv) && argv.length > 0 && argv.every((a) => typeof a === 'string' && a)
  if (!wellFormed || !path.isAbsolute(argv[0]) || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    return { ok: false, error: 'Invalid launch command' }
  }
  // A macOS session always has a window server; only Linux can be headless in a way worth naming.
  if (process.platform === 'linux' && !(await hasDisplay())) {
    return { ok: false, error: 'No graphical display to open a terminal on' }
  }

  if (terminal) {
    const chosen = (await installedTerminals({ appDirs })).find((t) => t.id === terminal)
    if (!chosen) {
      return { ok: false, error: 'That terminal is not installed on this machine any more. Pick another in Settings' }
    }
    const result = await launchInstalled(chosen, argv, cwd, opener)
    return result.ok ? { ok: true } : { ok: false, error: `Could not open ${chosen.name} (${result.error})` }
  }

  const preferred = [
    process.env.BOT_CROSSING_TERMINAL || '',
    process.env.TERMINAL || '',
    ...desktopOrder(),
    ...GENERAL_ORDER,
    'x-terminal-emulator',
  ]
  const names = [...new Set(preferred.filter(Boolean))]
  const deadline = Date.now() + WALK_BUDGET_MS
  const tried = new Set()
  let lastError = ''
  let ranOut = false

  for (const name of names) {
    if (Date.now() >= deadline) {
      ranOut = true
      break
    }
    const resolved = await findExecutable(name)
    if (!resolved || tried.has(resolved)) continue
    tried.add(resolved)

    const base = path.basename(name)
    let args
    if (base === 'x-terminal-emulator') args = ['-e', ...argv]
    else if (TERMINALS[base]) args = TERMINALS[base](cwd, argv)
    else continue

    const result = await trySpawn(resolved, args, cwd)
    if (result.ok) return { ok: true }
    lastError = result.error
  }

  if (ranOut) {
    return { ok: false, error: 'Gave up waiting for a terminal to open — is the display responding?' }
  }
  return {
    ok: false,
    error: lastError
      ? `Could not open a terminal (${lastError})`
      : 'No terminal emulator found — set BOT_CROSSING_TERMINAL or $TERMINAL, or install one (gnome-terminal, kitty, xterm)',
  }
}
