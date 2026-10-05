import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loginFile, isLoginEnabled, setLoginEnabled } from '../desktop/login.mjs'

test('login startup is opt-in and reversible without launching the app now', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-login-'))
  const appPath = '/Users/Test & Co/Applications/Bot Crossing.app'
  try {
    assert.equal(await isLoginEnabled(home), false)
    await setLoginEnabled(true, { home, appPath })
    assert.equal(await isLoginEnabled(home), true)
    const text = await fs.readFile(loginFile(home), 'utf8')
    assert.match(text, /Test &amp; Co/)
    assert.match(text, /--hidden/)
    assert.match(text, /RunAtLoad/)
    await setLoginEnabled(false, { home, appPath })
    assert.equal(await isLoginEnabled(home), false)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})
