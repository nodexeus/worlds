/**
 * The little of markdown that agents actually write, as data.
 *
 * Nothing here makes HTML. It returns blocks and spans, and the card builds elements from
 * them and sets their text, so what an agent wrote can only ever be shown, never run. A link
 * is a link only when it is plainly `http:` or `https:`.
 *
 * What it does not know (tables, quotes, nested emphasis) is shown as it was written.
 */

/** A line longer than this is shown as written: nobody formats a minified bundle. */
const INLINE_LIMIT = 5000

const FENCE = /^\s*```\s*([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.+)$/
const ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(\S.*)$/
const WEB = /^https?:\/\/[^\s]+$/i

// One pass, no backtracking over more than a line: each alternative is bounded by a
// character it cannot contain.
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\s][^*\n]*)\*|\[([^\]\n]+)\]\(([^)\n]*)\)|(https?:\/\/[^\s<>()[\]]+)/g

/** A line's formatting, as spans. */
function spans(text) {
  if (text.length > INLINE_LIMIT) return [{ type: 'text', text }]
  const out = []
  const push = (span) => {
    const last = out.at(-1)
    if (span.type === 'text' && last?.type === 'text') last.text += span.text
    else out.push(span)
  }
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    const [whole, code, bold, italic, label, target, bare] = match
    let span
    if (code !== undefined) span = { type: 'code', text: code }
    else if (bold !== undefined) span = { type: 'b', text: bold }
    else if (italic !== undefined) span = { type: 'i', text: italic }
    else if (label !== undefined) span = WEB.test(target) ? { type: 'link', text: label, href: target } : { type: 'text', text: whole }
    else {
      // A full stop or comma after an address ends the sentence, not the address.
      const href = bare.replace(/[.,;:!?'"]+$/, '')
      span = { type: 'link', text: href, href }
      match.trail = bare.slice(href.length)
    }
    if (match.index > at) push({ type: 'text', text: text.slice(at, match.index) })
    push(span)
    if (match.trail) push({ type: 'text', text: match.trail })
    at = match.index + whole.length
  }
  if (at < text.length) push({ type: 'text', text: text.slice(at) })
  return out
}

/**
 * @param {string} text
 * @returns {Array<{type: 'p' | 'h' | 'li', spans: object[], level?: number, marker?: string, depth?: number}
 *   | {type: 'code', lang: string, text: string}>}
 */
export function parseMarkdown(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let paragraph = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', spans: spans(paragraph.join('\n')) })
    paragraph = []
  }

  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n]
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const body = []
      for (n += 1; n < lines.length && !/^\s*```\s*$/.test(lines[n]); n += 1) body.push(lines[n])
      blocks.push({ type: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'h', level: heading[1].length, spans: spans(heading[2].trim()) })
      continue
    }
    const item = line.length <= INLINE_LIMIT ? ITEM.exec(line) : null
    if (item) {
      flush()
      blocks.push({
        type: 'li',
        marker: item[2] ? '•' : `${item[3]}.`,
        depth: Math.min(4, Math.floor(item[1].length / 2)),
        spans: spans(item[4]),
      })
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks
}
