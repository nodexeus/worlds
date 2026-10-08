// test/crew-ui-refresher.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRefresher } from '../src/crew/refresher.js'

/** A job that is finished by hand, so a test decides what overlaps what. */
function job() {
  const runs = []
  const run = () => new Promise((resolve, reject) => runs.push({ resolve, reject }))
  return { runs, run }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('one at a time: asked again while one is running, it runs once more when that one lands', async () => {
  const { runs, run } = job()
  const refresh = createRefresher(run)
  const first = refresh()
  const second = refresh()
  const third = refresh()
  assert.equal(runs.length, 1, 'nothing is started alongside the one under way')
  runs[0].resolve()
  await first
  await tick()
  assert.equal(runs.length, 2, 'one more, for everyone who asked meanwhile')
  let done = false
  Promise.all([second, third]).then(() => { done = true })
  await tick()
  assert.equal(done, false, 'and those who asked wait for that one, which is the one that is fresh')
  runs[1].resolve()
  await Promise.all([second, third])
  assert.equal(runs.length, 2)
})

test('a run that fails rejects for those who asked for it, and the next still runs', async () => {
  const { runs, run } = job()
  const refresh = createRefresher(run)
  const first = refresh()
  const second = refresh()
  runs[0].reject(new Error('away'))
  await assert.rejects(first, /away/)
  await tick()
  runs[1].resolve()
  await second
  const third = refresh()
  assert.equal(runs.length, 3)
  runs[2].resolve()
  await third
})
