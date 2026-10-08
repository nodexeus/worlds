/**
 * Run a refresh one at a time.
 *
 * Many things ask for the crew to be read again: a timer, the window coming forward, an
 * event the page cannot explain, the page's own changes. If each started a request of its
 * own, a slow server would be asked four things every quarter second and every answer would
 * be overtaken by the next. So a request made while one is under way waits, and when that
 * one lands a single further run serves everyone who asked in the meantime.
 *
 * The promise a caller gets resolves once a run that *started after it asked* has finished,
 * so what it then reads is at least as new as its own change.
 *
 * @param {() => Promise<void>} run
 * @returns {() => Promise<void>}
 */
export function createRefresher(run) {
  let running = null
  let next = null

  function start() {
    running = run().finally(() => {
      running = null
      if (!next) return
      const waiting = next
      next = null
      start().then(waiting.resolve, waiting.reject)
    })
    return running
  }

  return function refresh() {
    if (!running) return start()
    if (!next) {
      next = {}
      next.promise = new Promise((resolve, reject) => Object.assign(next, { resolve, reject }))
    }
    return next.promise
  }
}
