import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Desktop preferences independent of the colony's visual settings.
 * @typedef {{keepInMenuBar: boolean}} Preferences
 */

/** Read preferences, using a safe default on first launch or a malformed file.
 * @param {string} userData
 * @returns {Promise<Preferences>}
 */
export async function readPreferences(userData) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(userData, 'desktop.json'), 'utf8'))
    return { keepInMenuBar: value?.keepInMenuBar !== false }
  } catch {
    return { keepInMenuBar: true }
  }
}

/** Atomically persist the menu-bar preference.
 * @param {string} userData
 * @param {Preferences} preferences
 * @returns {Promise<void>}
 */
export async function writePreferences(userData, preferences) {
  await fs.mkdir(userData, { recursive: true })
  const target = path.join(userData, 'desktop.json')
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify({ keepInMenuBar: preferences.keepInMenuBar !== false }), { mode: 0o600 })
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

/** Import a validated colony only when no destination already exists.
 * @param {string} source
 * @param {string} userData
 * @returns {Promise<boolean>} Whether a colony was imported.
 */
export async function importColony(source, userData) {
  const target = path.join(userData, 'colony.json')
  try { await fs.access(target); return false } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  let text
  try {
    const info = await fs.stat(source)
    if (info.size > 4 * 1024 * 1024) throw new Error('Colony file exceeds 4 MB')
    text = await fs.readFile(source, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid colony file')
  for (const key of ['settings', 'plots', 'levels', 'seen', 'viewedAt', 'archivedAt']) {
    if (key === 'settings' && value[key] === null) continue
    if (key in value && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) {
      throw new Error(`Invalid colony ${key}`)
    }
  }
  for (const key of ['archived', 'hiddenProjects', 'opened']) {
    if (key in value && !Array.isArray(value[key])) throw new Error(`Invalid colony ${key}`)
  }
  await fs.mkdir(userData, { recursive: true })
  try {
    await fs.writeFile(target, text, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  }
  return true
}
