/** Connect Electron visibility to the render loop without coupling the browser build to it.
 * @param {{desktop?: {onVisibility: Function, onBeforeQuit?: Function}, engine: {start?: Function, stop?: Function}, refresh: Function, flush?: Function}} options
 * @returns {void}
 */
export function connectDesktopLifecycle({ desktop, engine, refresh, flush }) {
  let previous = true
  desktop?.onVisibility(visible => {
    if (visible === previous) return
    previous = visible
    if (visible) {
      engine.start()
      refresh()
    } else {
      engine.stop()
    }
  })
  if (flush) desktop?.onBeforeQuit?.(flush)
}
