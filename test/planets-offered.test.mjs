import test from 'node:test'
import assert from 'node:assert/strict'
import { OFFERED, offeredPlanet } from '../src/world/planets-offered.js'

test('the campus is the only world on offer, and a world remembered from before opens as the campus', () => {
  assert.deepEqual(OFFERED, ['campus'])
  assert.equal(offeredPlanet('campus'), 'campus')
  for (const gone of ['moon', 'mars', 'terra', 'sky', undefined, 'nowhere']) assert.equal(offeredPlanet(gone), 'campus')
})

test('settings never hold a world that is not on offer', async () => {
  const kept = new Map([['botcrossing.settings.v1', JSON.stringify({ planet: 'mars' })]])
  globalThis.localStorage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) }
  const { Settings } = await import('../src/core/settings.js')
  const settings = new Settings()
  assert.equal(settings.get('planet'), 'campus', 'a stored world that has gone')
  settings.set('planet', 'moon')
  assert.equal(settings.get('planet'), 'campus', 'one asked for')
  clearTimeout(settings._saveTimer)
})
