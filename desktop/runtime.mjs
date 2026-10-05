import path from 'node:path'

/** Prepare native scanning and CLI lookup for a Finder-launched process.
 * @param {NodeJS.ProcessEnv} source
 * @param {string} userData
 * @returns {NodeJS.ProcessEnv}
 */
export function desktopEnvironment(source, userData) {
  const env = { ...source, BOT_CROSSING_DATA: userData, BOT_CROSSING_CLAUDE_ACTIVITY: 'process' }
  const extra = [path.join(source.HOME || '', '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  env.PATH = [...new Set([...(source.PATH || '').split(path.delimiter).filter(Boolean), ...extra])].join(path.delimiter)
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  return env
}

/** Check an exact app origin without trusting a URL prefix.
 * @param {string} value
 * @param {string} origin
 * @returns {boolean}
 */
export function isAppUrl(value, origin) {
  try {
    const url = new URL(value)
    const base = new URL(origin)
    return url.protocol === base.protocol && url.hostname === base.hostname &&
      url.port === base.port && !url.username && !url.password
  } catch { return false }
}

/** Allow ordinary web links, never arbitrary OS or file protocols.
 * @param {string} value
 * @returns {boolean}
 */
export function isExternalUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false }
}
