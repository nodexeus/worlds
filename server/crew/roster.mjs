// server/crew/roster.mjs
import { CrewError } from './errors.mjs'
import { KINDS, RUNTIMES, checkName, nameKey, pickName } from './names.mjs'
import { isUniqueViolation } from './store/db.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Long enough for real instructions, short enough that nobody stores a book in it. */
const ROLE_LIMIT = 8000

/**
 * A world's agents: who they are, how many there may be, and what they are called.
 *
 * Two kinds. A standard agent is the customer's own to name and instruct, and counts against
 * the world's limit. A curated agent is made from a catalog template the world is entitled
 * to: its name and instructions are the template's and stay that way, there is at most one
 * of each, and it does not use a standard place.
 *
 * An agent is durable. It is never deleted, only retired, which gives back its place and its
 * name and keeps its history.
 *
 * @param {{sql: any, worldId: string, catalog: {templates: any[], byId: Map<string, any>,
 *   reserved: Set<string>}, limit: number, entitled: string[], rand?: () => number}} options
 */
export function createRoster({ sql, worldId, catalog, limit, entitled, rand = Math.random }) {
  const allowed = new Set(entitled)

  /** What the rest of the server sees. A curated agent's role is read from its template. */
  const present = (row) => {
    const template = row.templateId ? catalog.byId.get(row.templateId) : null
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      runtime: row.runtime,
      role: template ? template.role : row.role,
      curated: Boolean(row.templateId),
      templateId: row.templateId,
      speciality: template ? template.speciality : null,
      createdAt: row.createdAt,
    }
  }

  /**
   * One creation at a time in a world. Counting and then inserting is two steps, and without
   * this two requests arriving together would both count five and both become the sixth.
   */
  const oneAtATime = (tx) => tx`select pg_advisory_xact_lock(hashtext(${'crew-roster:' + worldId}))`

  const living = (db) => db`
    select id, name, kind, runtime, role, template_id, created_at
    from agents where world_id = ${worldId} and retired_at is null
    order by created_at, id`

  const checkRole = (role) => {
    if (role === undefined) return ''
    if (typeof role !== 'string' || role.length > ROLE_LIMIT) {
      throw new CrewError('bad_role', `A role is text of at most ${ROLE_LIMIT} characters`, 400)
    }
    return role.trim()
  }

  /** A name somebody asked for: well formed, not a specialist's, not in use. */
  const checkFree = (name, rows, exceptId) => {
    const wanted = checkName(name)
    const key = nameKey(wanted)
    if (catalog.reserved.has(key)) {
      throw new CrewError('name_reserved', `"${wanted}" is the name of a Nodexeus specialist`, 409)
    }
    if (rows.some((row) => row.id !== exceptId && nameKey(row.name) === key)) {
      throw new CrewError('name_taken', `There is already an agent called ${wanted}`, 409)
    }
    return wanted
  }

  const taken = (error) =>
    isUniqueViolation(error, 'agents_name_key')
      ? new CrewError('name_taken', 'There is already an agent with that name', 409)
      : error

  async function list() {
    return (await living(sql)).map(present)
  }

  async function get(id) {
    const unknown = new CrewError('unknown_agent', 'There is no such agent in this world', 404)
    if (typeof id !== 'string' || !UUID.test(id)) throw unknown
    const [row] = await sql`
      select id, name, kind, runtime, role, template_id, created_at
      from agents where id = ${id} and world_id = ${worldId} and retired_at is null`
    if (!row) throw unknown
    return present(row)
  }

  async function create({ name, kind, runtime, role } = {}) {
    if (!RUNTIMES.includes(runtime)) {
      throw new CrewError('bad_runtime', `A runtime is one of ${RUNTIMES.join(', ')}`, 400)
    }
    if (kind !== undefined && !KINDS.includes(kind)) {
      throw new CrewError('bad_kind', `A robot is one of ${KINDS.join(', ')}`, 400)
    }
    const text = checkRole(role)

    try {
      return await sql.begin(async (tx) => {
        await oneAtATime(tx)
        const rows = await living(tx)
        const used = rows.filter((row) => !row.templateId).length
        if (used >= limit) {
          throw new CrewError('agent_limit', `This world has ${used} of ${limit} agents`, 409)
        }
        const chosen = name === undefined
          ? pickName(new Set([...rows.map((row) => nameKey(row.name)), ...catalog.reserved]), rand)
          : checkFree(name, rows)
        const robot = kind ?? KINDS[Math.min(KINDS.length - 1, Math.floor(rand() * KINDS.length))]
        const [row] = await tx`
          insert into agents (world_id, name, kind, runtime, role)
          values (${worldId}, ${chosen}, ${robot}, ${runtime}, ${text})
          returning id, name, kind, runtime, role, template_id, created_at`
        return present(row)
      })
    } catch (error) {
      throw taken(error)
    }
  }

  async function createCurated(templateId) {
    const template = typeof templateId === 'string' ? catalog.byId.get(templateId) : null
    if (!template) throw new CrewError('unknown_template', 'There is no such specialist', 404)
    if (!allowed.has(template.id)) {
      throw new CrewError('not_entitled', `${template.name} is an upgrade this world does not have`, 403)
    }
    const already = new CrewError('already_added', `${template.name} is already in this world`, 409)
    try {
      return await sql.begin(async (tx) => {
        await oneAtATime(tx)
        const rows = await living(tx)
        if (rows.some((row) => row.templateId === template.id)) throw already
        const [row] = await tx`
          insert into agents (world_id, name, kind, runtime, role, template_id)
          values (${worldId}, ${template.name}, ${template.kind}, ${template.runtime}, '', ${template.id})
          returning id, name, kind, runtime, role, template_id, created_at`
        return present(row)
      })
    } catch (error) {
      if (isUniqueViolation(error, 'agents_template_key')) throw already
      throw taken(error)
    }
  }

  async function update(id, { name, role } = {}) {
    const before = await get(id)
    if (name === undefined && role === undefined) return before
    const fixed = (what) =>
      new CrewError(`${what}_fixed`, `${before.name} is a specialist and keeps its ${what}`, 409)
    if (before.curated && name !== undefined) throw fixed('name')
    if (before.curated && role !== undefined) throw fixed('role')
    const text = role === undefined ? undefined : checkRole(role)

    try {
      return await sql.begin(async (tx) => {
        await oneAtATime(tx)
        // Read again now that nothing else can be changing it: what was read before the lock
        // may be a moment old, and writing that back would undo somebody else's change.
        const rows = await living(tx)
        const current = rows.find((row) => row.id === id)
        if (!current) throw new CrewError('unknown_agent', 'There is no such agent in this world', 404)
        const chosen = name === undefined ? current.name : checkFree(name, rows, id)
        const [row] = await tx`
          update agents set name = ${chosen}, role = ${text ?? current.role}
          where id = ${id} and world_id = ${worldId} and retired_at is null
          returning id, name, kind, runtime, role, template_id, created_at`
        return present(row)
      })
    } catch (error) {
      throw taken(error)
    }
  }

  async function retire(id) {
    await get(id)
    const rows = await sql`
      update agents set retired_at = now()
      where id = ${id} and world_id = ${worldId} and retired_at is null
      returning id`
    if (!rows.length) throw new CrewError('unknown_agent', 'There is no such agent in this world', 404)
  }

  async function counts() {
    const rows = await living(sql)
    const curated = rows.filter((row) => row.templateId).length
    return { standard: { used: rows.length - curated, limit }, curated: { used: curated } }
  }

  async function specialists() {
    const rows = await living(sql)
    return catalog.templates.map((template) => ({
      ...template,
      entitled: allowed.has(template.id),
      agentId: rows.find((row) => row.templateId === template.id)?.id ?? null,
    }))
  }

  /**
   * Retire every specialist this world may no longer have: one it is not entitled to any
   * more, and one whose template this server no longer carries. Run once, at start, which
   * is when entitlements and the catalog can have changed.
   *
   * Retired like any other agent, so its history is kept. If the world is entitled again
   * later, adding the specialist makes a new agent.
   *
   * @returns {Promise<string[]>} the names retired
   */
  async function reconcile() {
    return sql.begin(async (tx) => {
      await oneAtATime(tx)
      const gone = (await living(tx)).filter(
        (row) => row.templateId && !(catalog.byId.has(row.templateId) && allowed.has(row.templateId))
      )
      for (const row of gone) {
        await tx`update agents set retired_at = now() where id = ${row.id} and world_id = ${worldId}`
      }
      return gone.map((row) => row.name)
    })
  }

  return { list, get, create, createCurated, update, retire, counts, specialists, reconcile }
}
