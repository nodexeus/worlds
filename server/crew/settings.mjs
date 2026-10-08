// server/crew/settings.mjs
import { CrewError } from './errors.mjs'
import { AUTONOMY } from './runtimes/contract.mjs'

/**
 * What a world has chosen for itself. One row, made the first time something is changed.
 *
 * Today that is the autonomy level: how much an agent may do unasked. It is one setting for
 * the whole world, not one per agent, and a world that has never chosen is fully autonomous.
 *
 * @param {{sql: any, worldId: string}} options
 */
export function createSettings({ sql, worldId }) {
  async function get() {
    const [row] = await sql`select autonomy from settings where world_id = ${worldId}`
    return { autonomy: row?.autonomy ?? 'autonomous' }
  }

  async function update({ autonomy } = {}) {
    if (!AUTONOMY.includes(autonomy)) {
      throw new CrewError('bad_autonomy', `An autonomy level is one of ${AUTONOMY.join(', ')}`, 400)
    }
    await sql`
      insert into settings (world_id, autonomy) values (${worldId}, ${autonomy})
      on conflict (world_id) do update set autonomy = excluded.autonomy, updated_at = now()`
    return { autonomy }
  }

  return { get, update }
}
