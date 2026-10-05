import { app, Menu, Tray, nativeImage, shell, dialog } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { writePreferences } from './storage.mjs'
import { isLoginEnabled, setLoginEnabled } from './login.mjs'

/** Install native menus and the persistent menu-bar controller.
 * @param {{root: string, userData: string, preferences: {keepInMenuBar: boolean}, show: Function, logFile: string}} options
 * @returns {Promise<{update: Function, destroy: Function}>}
 */
export async function installMenus({ root, userData, preferences, show, logFile }) {
  const image = nativeImage.createFromPath(path.join(root, 'desktop', 'assets', 'trayTemplate.png'))
  image.setTemplateImage(true)
  const tray = new Tray(image)
  let login = process.platform === 'darwin' && await isLoginEnabled(os.homedir())
  let status = 'Scanning sessions…'
  tray.setToolTip('Bot Crossing')
  tray.on('click', show)

  /** Report a settings failure without leaving a checked but unapplied menu item.
   * @param {() => Promise<void>} run
   * @returns {Promise<void>}
   */
  async function change(run) {
    try { await run() } catch (error) { dialog.showErrorBox('Could not update settings', error.message) }
    rebuild()
  }

  /** Generate fresh preference items for both menus.
   * @returns {Electron.MenuItemConstructorOptions[]}
   */
  function settingsItems() {
    return [
      { label: 'Keep Running in Menu Bar', type: 'checkbox', checked: preferences.keepInMenuBar,
        click: item => void change(async () => {
          await writePreferences(userData, { keepInMenuBar: item.checked })
          preferences.keepInMenuBar = item.checked
        }) },
      { label: 'Open at Login', type: 'checkbox', checked: login,
        enabled: process.platform === 'darwin' && app.isPackaged,
        click: item => void change(async () => {
          const appPath = path.resolve(process.execPath, '..', '..', '..')
          await setLoginEnabled(item.checked, { home: os.homedir(), appPath })
          login = await isLoginEnabled(os.homedir())
        }) },
    ]
  }

  /** Rebuild native menus when preferences or activity change.
   * @returns {void}
   */
  function rebuild() {
    const utilities = [
      { label: 'Open Data Folder', click: () => void shell.openPath(userData) },
      { label: 'Open Log File', click: () => void shell.openPath(logFile) },
    ]
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Colony', click: show }, { label: status, enabled: false },
      { type: 'separator' }, ...settingsItems(), { type: 'separator' }, ...utilities,
      { type: 'separator' }, { label: 'Quit Bot Crossing', role: 'quit' },
    ]))
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Bot Crossing', submenu: [
        { label: 'About Bot Crossing', role: 'about' }, { type: 'separator' },
        ...settingsItems(), { type: 'separator' }, ...utilities,
        { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ] },
      { role: 'editMenu' },
      { label: 'View', submenu: [
        { label: 'Show Colony', accelerator: 'CmdOrCtrl+1', click: show },
        { role: 'reload' }, { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      ] },
      { role: 'windowMenu' },
    ]))
  }

  rebuild()
  return {
    update: info => {
      status = info.error ? 'Scanner unavailable' : `${info.working} working · ${info.waiting} waiting · ${info.total} sessions`
      tray.setToolTip(`Bot Crossing — ${status}${info.warning ? '\n' + info.warning : ''}`)
      rebuild()
    },
    destroy: () => tray.destroy(),
  }
}
