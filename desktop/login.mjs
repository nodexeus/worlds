import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const LABEL = 'local.botcrossing.desktop'

/** Locate this app's per-user login job.
 * @param {string} home
 * @returns {string}
 */
export const loginFile = home => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)

/** Read the app-owned login preference without requiring a signing certificate.
 * @param {string} home
 * @returns {Promise<boolean>}
 */
export async function isLoginEnabled(home) {
  try { return (await fs.readFile(loginFile(home), 'utf8')).includes(`<string>${LABEL}</string>`) }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

/** Escape an executable path for a launchd property list.
 * @param {string} value
 * @returns {string}
 */
function xml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Enable or remove next-login startup; do not launch another copy now.
 * @param {boolean} enabled
 * @param {{home: string, appPath: string}} options
 * @returns {Promise<void>}
 */
export async function setLoginEnabled(enabled, { home, appPath }) {
  const target = loginFile(home)
  if (!enabled) {
    if (await isLoginEnabled(home)) await fs.unlink(target)
    return
  }
  if (!path.isAbsolute(appPath) || !appPath.endsWith('.app')) throw new Error('Install Nodexeus Worlds.app before enabling login startup')
  await fs.mkdir(path.dirname(target), { recursive: true })
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>${xml(appPath)}</string><string>--args</string><string>--hidden</string></array>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
</dict></plist>
`
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, content, { mode: 0o600 })
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
