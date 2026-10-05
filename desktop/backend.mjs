import { utilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { desktopEnvironment } from './runtime.mjs'

/** Start the bundled scanner and wait for its authenticated loopback endpoint.
 * @param {{root: string, userData: string, onStatus: Function, onFailure: Function, log: Function}} options
 * @returns {Promise<{origin: string, token: string, stop: () => void}>}
 */
export function startBackend({ root, userData, onStatus, onFailure, log }) {
  return new Promise((resolve, reject) => {
    const token = randomBytes(32).toString('hex')
    const child = utilityProcess.fork(path.join(root, 'desktop', 'worker.mjs'), [], {
      env: { ...desktopEnvironment(process.env, userData), BOT_CROSSING_DESKTOP_TOKEN: token },
      serviceName: 'Bot Crossing Scanner', stdio: 'pipe',
    })
    let ready = false
    let stopping = false
    const timer = setTimeout(() => {
      stopping = true
      child.kill()
      reject(new Error('The session scanner did not start within 20 seconds.'))
    }, 20000)
    child.stdout?.on('data', data => log(String(data)))
    child.stderr?.on('data', data => log(String(data)))
    child.on('message', message => {
      if (message?.type === 'ready' && !ready) {
        if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(message.origin)) return
        ready = true
        clearTimeout(timer)
        resolve({ origin: message.origin, token, stop: () => { stopping = true; child.kill() } })
      } else if (message?.type === 'status') onStatus(message)
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (stopping) return
      const error = new Error(`The session scanner exited (code ${code}). Relaunch Bot Crossing to restart it.`)
      if (!ready) reject(error)
      else onFailure(error)
    })
  })
}
