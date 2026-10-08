// server/crew/catalog.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, RUNTIMES, checkName, nameKey } from './names.mjs'

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates')
const ID = /^[a-z][a-z0-9-]{1,39}$/

/**
 * The curated specialists this server knows how to make: one JSON file each in `templates/`.
 *
 * A template's name is its agent's name, fixed and reserved in every world whether or not
 * that world may use it. Which templates a world may use is configuration (`entitled`), not
 * something the catalog knows.
 *
 * A bad file stops the server from starting, and says which file and which field. A
 * specialist that half loads is worse than one that is plainly missing.
 */
export async function loadCatalog(dir = TEMPLATES) {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort()
  const templates = []
  const byId = new Map()
  const reserved = new Set()

  for (const file of files) {
    const fail = (field, why) => {
      throw new Error(`Curated template ${file}: ${field} ${why}`)
    }
    let raw
    try {
      raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))
    } catch (error) {
      fail('file', `is not valid JSON (${error.message})`)
    }
    if (typeof raw.id !== 'string' || !ID.test(raw.id)) fail('id', 'must be lower-case letters, digits and hyphens')
    let name
    try {
      name = checkName(raw.name)
    } catch (error) {
      fail('name', `is not a usable name: ${error.message}`)
    }
    if (!KINDS.includes(raw.kind)) fail('kind', `must be one of ${KINDS.join(', ')}`)
    if (!RUNTIMES.includes(raw.runtime)) fail('runtime', `must be one of ${RUNTIMES.join(', ')}`)
    if (typeof raw.speciality !== 'string' || !raw.speciality.trim()) fail('speciality', 'must say what this agent is for')
    if (typeof raw.role !== 'string' || !raw.role.trim()) fail('role', 'must hold the agent\'s instructions')
    if (!Array.isArray(raw.skills) || raw.skills.some((skill) => typeof skill !== 'string')) fail('skills', 'must be a list of names')
    if (byId.has(raw.id)) fail('id', `"${raw.id}" is used by another template`)
    if (reserved.has(nameKey(name))) fail('name', `"${name}" is used by another template`)

    const template = Object.freeze({
      id: raw.id,
      name,
      speciality: raw.speciality.trim(),
      kind: raw.kind,
      runtime: raw.runtime,
      role: raw.role.trim(),
      skills: Object.freeze([...raw.skills]),
    })
    templates.push(template)
    byId.set(template.id, template)
    reserved.add(nameKey(name))
  }
  return { templates, byId, reserved }
}
