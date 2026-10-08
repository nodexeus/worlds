// server/crew/events.mjs

/** A page of a conversation is what a card shows at once; a catch-up page is what fits a reply. */
const PAGE = 200
const PAGE_LIMIT = 500

/**
 * The record of a world: every message, everything an agent said or did, every question and
 * its answer, in one numbered line.
 *
 * The numbers are the point. A client holds the last number it saw, and asking for
 * everything after it must return exactly what it missed. That needs the numbers to be gap
 * free and in the order the events became visible, which two things together give:
 *
 *   - the next number is taken from the world's counter row in the same statement that
 *     inserts the event, so the row stays locked until the event is committed;
 *   - appends are written one at a time by this process, and each is published as soon as
 *     it is committed, so listeners are told in the same order.
 *
 * An event is never changed or deleted.
 *
 * @param {{sql: any, worldId: string, hub: {publish: (event: object) => void}}} options
 */
export function createEvents({ sql, worldId, hub }) {
  /** The tail of the line of writes. Each waits for the one before, whatever became of it. */
  let last = Promise.resolve()

  const present = (row) => ({
    seq: Number(row.seq),
    conversationId: row.conversationId,
    agentId: row.agentId,
    type: row.type,
    status: row.status,
    at: row.createdAt.toISOString(),
    // Read as text and parsed here: the keys are an agent's own and are kept as they are.
    data: JSON.parse(row.data),
  })

  async function write({ conversationId, agentId, type, status, data = {} }) {
    const [row] = await sql`
      with next as (
        insert into event_counters (world_id, seq) values (${worldId}, 1)
        on conflict (world_id) do update set seq = event_counters.seq + 1
        returning seq
      )
      insert into events (world_id, seq, conversation_id, agent_id, type, status, data)
      select ${worldId}, next.seq, ${conversationId}, ${agentId}, ${type}, ${status}, ${sql.json(data)}
      from next
      returning seq, conversation_id, agent_id, type, status, data::text as data, created_at`
    const event = present(row)
    hub.publish(event)
    return event
  }

  /** Store an event and tell whoever is listening. Resolves to the event as stored. */
  function append(event) {
    const written = last.then(() => write(event))
    last = written.catch(() => {})
    return written
  }

  /** The world's events after `seq`, oldest first. */
  async function after(seq, limit = PAGE_LIMIT) {
    const rows = await sql`
      select seq, conversation_id, agent_id, type, status, data::text as data, created_at
      from events where world_id = ${worldId} and seq > ${seq}
      order by seq limit ${Math.min(limit, PAGE_LIMIT)}`
    return rows.map(present)
  }

  /**
   * Part of one conversation, oldest first. With `after`, what follows it. Otherwise the
   * latest, or with `before` the latest that came earlier: how a card scrolls back.
   */
  async function page(conversationId, { after: from, before, limit = PAGE } = {}) {
    const size = Math.min(limit, PAGE_LIMIT)
    if (from !== undefined) {
      const rows = await sql`
        select seq, conversation_id, agent_id, type, status, data::text as data, created_at
        from events where world_id = ${worldId} and conversation_id = ${conversationId} and seq > ${from}
        order by seq limit ${size}`
      return rows.map(present)
    }
    const rows = await sql`
      select seq, conversation_id, agent_id, type, status, data::text as data, created_at
      from events
      where world_id = ${worldId} and conversation_id = ${conversationId}
        and seq < ${before ?? Number.MAX_SAFE_INTEGER}
      order by seq desc limit ${size}`
    return rows.map(present).reverse()
  }

  async function head() {
    const [row] = await sql`select seq from event_counters where world_id = ${worldId}`
    return row ? Number(row.seq) : 0
  }

  return { append, after, page, head, idle: () => last }
}
