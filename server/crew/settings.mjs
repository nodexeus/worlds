import { CrewError } from './errors.mjs'
import { AUTONOMY } from './runtimes/contract.mjs'

/** More agents than this answering one post is a mistake, whatever a world's limit on agents. */
const CHANNEL_LIMIT_MAX = 50

/**
 * What a world has chosen for itself. One row, made the first time something is changed.
 *
 *   - `autonomy`: how much an agent may do unasked. One setting for the whole world, not one
 *     per agent, and a world that has never chosen is fully autonomous;
 *   - `channelLimit`: how many agents answer a post to the crew channel that names nobody.
 *     Null, which is where a world starts, is all of them.
 *
 * @param {{sql: any, worldId: string}} options
 */
export function createSettings({ sql, worldId }) {
  async function get() {
    const [row] = await sql`select autonomy, channel_limit from settings where world_id = ${worldId}`
    return { autonomy: row?.autonomy ?? 'autonomous', channelLimit: row?.channelLimit ?? null }
  }

  /** Change one or both. What is not given stays as it was. */
  async function update({ autonomy, channelLimit } = {}) {
    if ((autonomy === undefined && channelLimit === undefined) || (autonomy !== undefined && !AUTONOMY.includes(autonomy))) {
      throw new CrewError('bad_autonomy', `An autonomy level is one of ${AUTONOMY.join(', ')}`, 400)
    }
    if (channelLimit !== undefined && channelLimit !== null &&
        !(Number.isInteger(channelLimit) && channelLimit >= 1 && channelLimit <= CHANNEL_LIMIT_MAX)) {
      throw new CrewError('bad_channel_limit', `The channel answer limit is a whole number from 1 to ${CHANNEL_LIMIT_MAX}, or null for everyone`, 400)
    }
    const [row] = await sql`
      insert into settings (world_id, autonomy, channel_limit)
      values (${worldId}, ${autonomy ?? 'autonomous'}, ${channelLimit ?? null})
      on conflict (world_id) do update set
        autonomy = ${autonomy === undefined ? sql`settings.autonomy` : sql`excluded.autonomy`},
        channel_limit = ${channelLimit === undefined ? sql`settings.channel_limit` : sql`excluded.channel_limit`},
        updated_at = now()
      returning autonomy, channel_limit`
    return { autonomy: row.autonomy, channelLimit: row.channelLimit }
  }

  return { get, update }
}
