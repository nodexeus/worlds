import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopEnvironment, isAppUrl, isExternalUrl } from '../desktop/runtime.mjs'
import { connectDesktopLifecycle } from '../src/core/desktop-lifecycle.js'

test('desktop worker uses native detection and a GUI-safe executable path', () => {
  const env = desktopEnvironment({ HOME: '/Users/test', PATH: '/usr/bin', BOT_CROSSING_CLAUDE_ACTIVITY: 'transcript' }, '/tmp/data')
  assert.equal(env.BOT_CROSSING_CLAUDE_ACTIVITY, 'process')
  assert.equal(env.BOT_CROSSING_DATA, '/tmp/data')
  assert.ok(env.PATH.split(':').includes('/opt/homebrew/bin'))
  assert.ok(env.PATH.split(':').includes('/Users/test/.local/bin'))
  assert.equal(env.HOME, '/Users/test')
})

test('navigation stays on the exact desktop origin', () => {
  const origin = 'http://127.0.0.1:53000'
  assert.equal(isAppUrl(`${origin}/api/state`, origin), true)
  for (const url of ['http://127.0.0.1:53001', 'https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'malformed']) {
    assert.equal(isAppUrl(url, origin), false)
  }
  assert.equal(isExternalUrl('https://example.com/help'), true)
  assert.equal(isExternalUrl('file:///etc/passwd'), false)
  assert.equal(isExternalUrl('claude://resume'), false)
  assert.equal(isAppUrl('bot-crossing://app/api/state', 'bot-crossing://app'), true)
  assert.equal(isAppUrl('bot-crossing://other/api/state', 'bot-crossing://app'), false)
  assert.equal(isAppUrl('bot-crossing://user@app/', 'bot-crossing://app'), false)
})

test('desktop visibility pauses rendering and refreshes on return', () => {
  let listener
  const calls = []
  connectDesktopLifecycle({
    desktop: { onVisibility: callback => { listener = callback } },
    engine: { start: () => calls.push('start'), stop: () => calls.push('stop') },
    refresh: () => calls.push('refresh'),
  })
  listener(false)
  listener(true)
  assert.deepEqual(calls, ['stop', 'start', 'refresh'])
})

test('the browser build does not require a desktop bridge', () => {
  assert.doesNotThrow(() => connectDesktopLifecycle({ desktop: undefined, engine: {}, refresh: () => {} }))
})

test('desktop quit requests flush pending colony state', async () => {
  let listener
  let saved = false
  connectDesktopLifecycle({
    desktop: { onVisibility: () => {}, onBeforeQuit: callback => { listener = callback } },
    engine: {}, refresh: () => {}, flush: async () => { saved = true },
  })
  await listener()
  assert.equal(saved, true)
})
