// test/crew-ui-copy.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CREW = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'crew')

/**
 * The person using a world is never told what an agent runs on, or what a model is reached
 * through. The page is not sent it, so the page has no business knowing any of these names.
 */
const TECHNOLOGY = /claude|anthropic|codex|openai|hermes|openclaw|litellm|openrouter|\bgpt\b|\bjev\b|runs on|harness/i

test('nothing in the crew\'s part of the page names what an agent runs on', async () => {
  const files = (await fs.readdir(CREW)).filter((name) => /\.(js|css|html)$/.test(name))
  assert.ok(files.length > 5)
  for (const name of files) {
    const lines = (await fs.readFile(path.join(CREW, name), 'utf8')).split('\n')
    const found = lines.flatMap((line, at) => (TECHNOLOGY.test(line) ? [`${name}:${at + 1}: ${line.trim()}`] : []))
    assert.deepEqual(found, [])
  }
})
