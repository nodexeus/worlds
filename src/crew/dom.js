/**
 * Build an element. Children are elements or strings, and a string is always text: nothing
 * in the crew interface is ever parsed as HTML, because most of what it shows was written by
 * an agent or typed by a person.
 *
 * @param {string} tag `div`, or `div.one.two` for classes
 * @param {Record<string, any> | null} [props] `on*` adds a listener, `data` sets data
 *   attributes, anything else is an attribute (false or null leaves it off)
 * @param {...(Node | string | null | false | undefined)} children
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.')
  const el = document.createElement(name)
  if (classes.length) el.className = classes.join(' ')
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value === null || value === undefined) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'data') Object.assign(el.dataset, value)
    else if (key === 'class') el.className = `${el.className} ${value}`.trim()
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  el.append(...children.filter((child) => child !== null && child !== false && child !== undefined))
  return el
}

/** An icon from a fixed set, drawn here so no markup ever comes from anywhere else. */
const PATHS = {
  close: 'M6 6l12 12M18 6L6 18',
  history: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v3.6h3.6',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  send: 'M12 19V5M6 11l6-6 6 6',
  chevron: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  back: 'M14.5 5.5 8 12l6.5 6.5',
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', PATHS[name])
  svg.append(path)
  return svg
}

/** The two eyes that stand for an agent wherever it is listed, lit by how it is doing. */
export function face(status) {
  return h('span.crew-face', { data: { status: status || 'idle' }, 'aria-hidden': 'true' }, h('i'), h('i'))
}

/** How long ago, in a word or two. */
export function ago(at, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(at).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
