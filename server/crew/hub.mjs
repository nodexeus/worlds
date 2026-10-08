// server/crew/hub.mjs

/**
 * Where everything live goes out from. Whatever is stored is published here once it is
 * safely written, and whoever is connected is told.
 *
 * Two kinds of thing pass through:
 *
 *   - `event`: a stored event, with its sequence number. A client that misses one can ask
 *     for it again;
 *   - `delta`: a fragment of text as an agent writes it. Never stored and never repeated:
 *     the whole piece follows as an event.
 *
 * A listener is called at once and is not waited for. One that throws is logged and the
 * rest are still told, so a broken client can never hold up the record or anybody else.
 *
 * @param {{log?: (...args: any[]) => void}} [options]
 */
export function createHub({ log = console.error } = {}) {
  /** @type {Set<(kind: 'event' | 'delta', payload: object) => void>} */
  const listeners = new Set()

  const tell = (kind, payload) => {
    // A copy, so a listener that leaves or joins while being told does not disturb the round.
    for (const listener of [...listeners]) {
      try {
        listener(kind, payload)
      } catch (error) {
        log('crew hub: a listener threw', error)
      }
    }
  }

  return {
    publish: (event) => tell('event', event),
    transient: (item) => tell('delta', item),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get size() {
      return listeners.size
    },
  }
}
