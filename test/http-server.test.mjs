import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAppServer } from '../server/http-server.mjs'

/** Serve a temporary build on an available loopback port.
 * @param {string} token
 * @param {(url: string) => Promise<void>} run
 * @returns {Promise<void>}
 */
async function withApp(token, run) {
  const distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-http-'))
  await fs.writeFile(path.join(distDir, 'index.html'), '<h1>Colony</h1>')
  await fs.writeFile(path.join(distDir, 'bundle.js'), 'export const ready = true')
  const server = createAppServer({ distDir, token })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(distDir, { recursive: true, force: true })
  }
}

test('desktop server rejects requests without its per-launch token', async () => {
  await withApp('secret', async url => {
    assert.equal((await fetch(url)).status, 403)
    assert.equal((await fetch(`${url}/api/state`)).status, 403)
    assert.equal((await fetch(url, { headers: { 'X-Bot-Crossing-Token': 'wrong' } })).status, 403)
  })
})

test('authenticated desktop requests serve the app and its existing API', async () => {
  await withApp('secret', async url => {
    const headers = { 'X-Bot-Crossing-Token': 'secret' }
    assert.match(await (await fetch(url, { headers })).text(), /Colony/)
    const response = await fetch(`${url}/api/state`, { headers })
    assert.equal(response.status, 200)
    assert.equal(typeof (await response.json()).settings, 'object')
    assert.match((await fetch(`${url}/bundle.js`, { headers })).headers.get('content-type'), /javascript/)
  })
})

test('browser mode continues to work without desktop authentication', async () => {
  await withApp('', async url => {
    assert.equal((await fetch(url)).status, 200)
    assert.equal((await fetch(`${url}/api/state`)).status, 200)
  })
})

test('desktop CSP permits GLTF embedded textures while keeping network access local', async () => {
  await withApp('secret', async url => {
    const response = await fetch(url, { headers: { 'X-Bot-Crossing-Token': 'secret' } })
    const directive = response.headers.get('content-security-policy').split(';').find(value => value.trim().startsWith('connect-src'))
    assert.deepEqual(directive.trim().split(/\s+/).slice(1), ["'self'", 'blob:'])
  })
})

test('malformed and escaping static paths fail without crashing the server', async () => {
  await withApp('', async url => {
    assert.equal((await fetch(`${url}/%E0%A4%A`)).status, 400)
    assert.equal((await fetch(`${url}/..%2Fsecret`)).status, 403)
    assert.equal((await fetch(url)).status, 200)
  })
})

test('a model file is checked for a newer copy every time, and only a file named by its contents is kept for good', async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'worlds-cache-'))
  await fs.mkdir(path.join(dist, 'assets', 'campus'), { recursive: true })
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html>')
  await fs.writeFile(path.join(dist, 'assets', 'index-Bq3xK9aZ.js'), 'export {}')
  await fs.writeFile(path.join(dist, 'assets', 'campus', 'settlement.glb'), 'first')
  const server = createAppServer({ distDir: dist })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    // Built by Vite with a hash of its contents in its name: it can never change under that name.
    const bundle = await fetch(`${base}/assets/index-Bq3xK9aZ.js`)
    assert.match(bundle.headers.get('cache-control'), /immutable/)

    // Packed under a fixed name and replaced in place: the browser must ask each time.
    const first = await fetch(`${base}/assets/campus/settlement.glb`)
    assert.equal(first.headers.get('cache-control'), 'no-cache')
    const tag = first.headers.get('etag')
    assert.ok(tag)
    assert.equal(await first.text(), 'first')

    // Unchanged, it is not sent again.
    const same = await fetch(`${base}/assets/campus/settlement.glb`, { headers: { 'If-None-Match': tag } })
    assert.equal(same.status, 304)

    // Replaced, it is.
    await fs.writeFile(path.join(dist, 'assets', 'campus', 'settlement.glb'), 'second, and longer')
    const next = await fetch(`${base}/assets/campus/settlement.glb`, { headers: { 'If-None-Match': tag } })
    assert.equal(next.status, 200)
    assert.equal(await next.text(), 'second, and longer')
    assert.notEqual(next.headers.get('etag'), tag)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dist, { recursive: true, force: true })
  }
})
