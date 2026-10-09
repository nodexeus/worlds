import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { apiMiddleware } from './api.mjs'

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
}

/** Check the desktop credential without revealing a useful timing difference.
 * @param {string | string[] | undefined} supplied
 * @param {string} expected
 * @returns {boolean}
 */
function hasToken(supplied, expected) {
  if (typeof supplied !== 'string') return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** A file Vite named by a hash of its contents: `name-Bq3xK9aZ.js`. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/

/** Create the built-app server for browser, Docker, or authenticated desktop use.
 * @param {{distDir: string, token?: string}} options
 * @returns {http.Server}
 */
export function createAppServer({ distDir, token = '' }) {
  const root = path.resolve(distDir)
  return http.createServer(async (req, res) => {
    if (token && !hasToken(req.headers['x-bot-crossing-token'], token)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    let url
    let file
    try {
      url = new URL(req.url, 'http://localhost')
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      file = path.resolve(root, rel || 'index.html')
    } catch {
      res.writeHead(400).end('Bad request')
      return
    }
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    if (url.pathname.startsWith('/api/')) return apiMiddleware(req, res, null)
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html')
    } catch {
      file = path.join(root, 'index.html')
    }
    try {
      // Kept for good only when its name says what is in it: the bundles Vite builds carry a
      // hash of their contents, so a changed one has a new name. The models are packed under
      // fixed names and replaced in place, and a browser told to keep one of those for a year
      // goes on drawing the old campus after a new one has shipped. Those it asks about each
      // time, and is told "the one you have" unless it has changed.
      const hashed = HASHED.test(path.basename(file))
      const info = await fs.stat(file)
      const tag = `"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`
      if (!hashed && req.headers['if-none-match'] === tag) {
        res.writeHead(304, { ETag: tag, 'Cache-Control': 'no-cache' }).end()
        return
      }
      const body = await fs.readFile(file)
      const cache = hashed && file.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable' : 'no-cache'
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Content-Length': body.length, 'Cache-Control': cache, ETag: tag,
        'X-Content-Type-Options': 'nosniff',
        ...(token ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } : {}),
      })
      res.end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    }
  })
}
