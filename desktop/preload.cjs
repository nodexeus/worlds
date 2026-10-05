const { contextBridge, ipcRenderer } = require('electron')

let visible = true
const listeners = new Set()
ipcRenderer.on('desktop:visibility', (_event, next) => {
  visible = next === true
  for (const listener of listeners) listener(visible)
})

contextBridge.exposeInMainWorld('botCrossingDesktop', {
  /** Subscribe only to visibility, without exposing Node or raw IPC.
   * @param {(visible: boolean) => void} callback
   * @returns {() => void}
   */
  onVisibility(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a visibility callback')
    listeners.add(callback)
    callback(visible)
    return () => listeners.delete(callback)
  },
  /** Flush colony state before the main process closes the scanner.
   * @param {() => Promise<void>} callback
   * @returns {void}
   */
  onBeforeQuit(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a save callback')
    ipcRenderer.on('desktop:prepare-quit', async () => {
      try { await callback() } finally { ipcRenderer.send('desktop:quit-ready') }
    })
  },
})
