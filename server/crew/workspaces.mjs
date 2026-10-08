// server/crew/workspaces.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { CrewError } from './errors.mjs'
import { isUniqueViolation } from './store/db.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_LIMIT = 48
const DESCRIPTION_LIMIT = 200

/** https, ssh, or the `user@host:path` short form. Nothing local and nothing git runs. */
const GIT_URL = /^(https:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[^\s\u0000-\u001f]+$/

/**
 * A git address that is safe to hand to `git clone`.
 *
 * Git treats some things that look like addresses as instructions: an argument starting with
 * a hyphen is an option, `ext::` runs a command, and `file://` or a bare path reads the
 * server's own disk. All of those are refused here, before git is ever started.
 */
export function checkGitUrl(url) {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  if (!trimmed || !GIT_URL.test(trimmed)) {
    throw new CrewError('bad_git_url', 'A git source is an https:// or ssh:// address', 400)
  }
  return trimmed
}

/** Clone without ever stopping to ask for a password: there is nobody to answer. */
function gitClone(url, folder) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['clone', '--', url, folder],
      { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, _stdout, stderr) => {
        if (!error) return resolve()
        const said = String(stderr || error.message).trim().split('\n').pop()
        reject(new Error(said || 'git clone failed'))
      }
    )
  })
}

/**
 * A world's workspaces: named projects, each with a folder of its own on the data volume.
 *
 * The folder is named by the workspace's id and nothing else, so no name anybody types can
 * reach outside the data directory, and renaming a workspace moves nothing on disk.
 *
 * Archiving takes a workspace off the campus and frees its name. Its files stay where they
 * are: work is never deleted by a click.
 *
 * @param {{sql: any, worldId: string, dataDir: string,
 *   clone?: (url: string, folder: string) => Promise<void>}} options
 */
export function createWorkspaces({ sql, worldId, dataDir, clone = gitClone }) {
  const root = path.join(dataDir, 'workspaces')
  const folderOf = (id) => path.join(root, id)

  const present = (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    gitUrl: row.gitUrl,
    folder: folderOf(row.id),
    createdAt: row.createdAt,
  })

  const checkName = (name) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed || trimmed.length > NAME_LIMIT || /[\u0000-\u001f]/.test(trimmed)) {
      throw new CrewError('bad_workspace_name', `A workspace name is 1 to ${NAME_LIMIT} characters on one line`, 400)
    }
    return trimmed
  }

  const checkDescription = (description) => {
    if (description === undefined) return ''
    if (typeof description !== 'string' || description.trim().length > DESCRIPTION_LIMIT) {
      throw new CrewError('bad_description', `A description is text of at most ${DESCRIPTION_LIMIT} characters`, 400)
    }
    return description.trim()
  }

  const taken = (error) =>
    isUniqueViolation(error, 'workspaces_name_key')
      ? new CrewError('workspace_name_taken', 'There is already a workspace with that name', 409)
      : error

  async function list() {
    const rows = await sql`
      select id, name, description, git_url, created_at
      from workspaces where world_id = ${worldId} and archived_at is null
      order by created_at, id`
    return rows.map(present)
  }

  async function get(id) {
    const unknown = new CrewError('unknown_workspace', 'There is no such workspace in this world', 404)
    if (typeof id !== 'string' || !UUID.test(id)) throw unknown
    const [row] = await sql`
      select id, name, description, git_url, created_at
      from workspaces where id = ${id} and world_id = ${worldId} and archived_at is null`
    if (!row) throw unknown
    return present(row)
  }

  async function create({ name, description, gitUrl } = {}) {
    const chosen = checkName(name)
    const about = checkDescription(description)
    const source = gitUrl === undefined || gitUrl === null ? null : checkGitUrl(gitUrl)

    let row
    try {
      ;[row] = await sql`
        insert into workspaces (world_id, name, description, git_url)
        values (${worldId}, ${chosen}, ${about}, ${source})
        returning id, name, description, git_url, created_at`
    } catch (error) {
      throw taken(error)
    }

    const folder = folderOf(row.id)
    try {
      await fs.mkdir(folder, { recursive: true })
      if (source) await clone(source, folder)
    } catch (error) {
      // Nothing half made: a workspace with no folder, or a folder with no workspace, would
      // each be found later by somebody with no idea how it got there.
      await sql`delete from workspaces where id = ${row.id}`
      await fs.rm(folder, { recursive: true, force: true })
      if (source) throw new CrewError('clone_failed', `Could not clone that source: ${error.message}`, 422)
      throw error
    }
    return present(row)
  }

  async function update(id, { name, description } = {}) {
    const current = await get(id)
    if (name === undefined && description === undefined) return current
    const chosen = name === undefined ? current.name : checkName(name)
    const about = description === undefined ? current.description : checkDescription(description)
    try {
      const [row] = await sql`
        update workspaces set name = ${chosen}, description = ${about}
        where id = ${id} and world_id = ${worldId} and archived_at is null
        returning id, name, description, git_url, created_at`
      if (!row) throw new CrewError('unknown_workspace', 'There is no such workspace in this world', 404)
      return present(row)
    } catch (error) {
      throw taken(error)
    }
  }

  async function archive(id) {
    await get(id)
    const rows = await sql`
      update workspaces set archived_at = now()
      where id = ${id} and world_id = ${worldId} and archived_at is null
      returning id`
    if (!rows.length) throw new CrewError('unknown_workspace', 'There is no such workspace in this world', 404)
  }

  return { list, get, create, update, archive, folderOf }
}
