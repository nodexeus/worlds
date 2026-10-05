import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBackend } from './backend.mjs'
import { installMenus } from './menus.mjs'
import { importColony, readPreferences } from './storage.mjs'
import { isAppUrl, isExternalUrl } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_ORIGIN = 'bot-crossing://app'
app.setName('Bot Crossing')
app.setPath('userData', process.env.BOT_CROSSING_DESKTOP_DATA || path.join(app.getPath('appData'), 'Bot Crossing'))
protocol.registerSchemesAsPrivileged([
  { scheme: 'bot-crossing', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

let window
let backend
let menus
let preferences
let quitting = false
let flushed = false
const userData = app.getPath('userData')
const logFile = path.join(userData, 'desktop.log')

/** Append diagnostic messages without recording session contents or the API secret.
 * @param {string} message
 * @returns {void}
 */
function log(message) {
  void fs.appendFile(logFile, `${new Date().toISOString()} ${message.trim()}\n`).catch(() => {})
}

/** Restore the colony window from either the Dock or menu bar.
 * @returns {void}
 */
function showColony() {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** Match rendering and audio to actual window visibility.
 * @returns {void}
 */
function syncVisibility() {
  if (!window || window.isDestroyed()) return
  const visible = window.isVisible() && !window.isMinimized()
  window.webContents.setAudioMuted(!visible)
  window.webContents.send('desktop:visibility', visible)
}

/** Report a fatal startup/worker failure and leave no background scanner behind.
 * @param {Error} error
 * @returns {void}
 */
function fail(error) {
  log(error.stack || error.message)
  dialog.showErrorBox('Bot Crossing could not continue', `${error.message}\n\nLogs: ${logFile}`)
  app.quit()
}

/** Start the authenticated service and the sandboxed desktop window.
 * @returns {Promise<void>}
 */
async function start() {
  await fs.mkdir(userData, { recursive: true })
  const existingLog = await fs.stat(logFile).catch(() => null)
  if (existingLog?.size > 1024 * 1024) await fs.rename(logFile, `${logFile}.previous`)
  log(`Starting Bot Crossing ${app.getVersion()} (Electron ${process.versions.electron}, Node ${process.versions.node})`)
  preferences = await readPreferences(userData)
  await importColony(process.env.BOT_CROSSING_IMPORT_COLONY || path.join(root, 'data', 'colony.json'), userData)
  menus = await installMenus({ root, userData, preferences, show: showColony, logFile })
  backend = await startBackend({ root, userData, log, onStatus: info => menus.update(info), onFailure: fail })
  log('Native scanner ready')

  const browserSession = session.fromPartition('persist:colony')
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.protocol.handle('bot-crossing', async request => {
    if (!isAppUrl(request.url, APP_ORIGIN)) return new Response('Forbidden', { status: 403 })
    if (request.initiatorOrigin && request.initiatorOrigin !== APP_ORIGIN) return new Response('Forbidden', { status: 403 })
    const url = new URL(request.url)
    try {
      // The renderer never receives the loopback credential. A stable app origin also
      // keeps browser preferences intact when the private port changes on each launch.
      return await fetch(`${backend.origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers: { 'X-Bot-Crossing-Token': backend.token, Origin: backend.origin,
          'Content-Type': request.headers.get('content-type') || 'application/json' },
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer()),
        signal: AbortSignal.timeout(20000),
      })
    } catch (error) {
      log(`Request failed: ${error.message}`)
      return new Response(JSON.stringify({ error: 'The session scanner is unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
  })

  window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 800, minHeight: 600, show: false,
    title: 'Bot Crossing', backgroundColor: '#101725',
    icon: path.join(root, 'desktop', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'),
      session: browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, backgroundThrottling: true },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, APP_ORIGIN)) return
    event.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('console-message', details => {
    if (details.level === 'error') log(`Renderer: ${details.message}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => fail(new Error(`The colony renderer stopped: ${details.reason}`)))
  window.webContents.on('did-finish-load', syncVisibility)
  for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, syncVisibility)
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    if (preferences.keepInMenuBar) window.hide()
    else app.quit()
  })
  await window.loadURL(`${APP_ORIGIN}/`)
  if (!process.argv.includes('--hidden')) showColony()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showColony)
  app.on('activate', showColony)
  app.on('window-all-closed', () => { if (!preferences?.keepInMenuBar) app.quit() })
  app.on('before-quit', event => {
    quitting = true
    if (flushed || !window || window.isDestroyed()) { backend?.stop(); menus?.destroy(); return }
    event.preventDefault()
    const finish = () => { flushed = true; backend?.stop(); app.quit() }
    const timer = setTimeout(finish, 3000)
    ipcMain.once('desktop:quit-ready', ipcEvent => {
      if (ipcEvent.sender !== window.webContents) return
      clearTimeout(timer)
      finish()
    })
    window.webContents.send('desktop:prepare-quit')
  })
  app.whenReady().then(start).catch(fail)
}
