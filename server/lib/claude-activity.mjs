import { jsonLines, readTail } from './fsutil.mjs'

// No host PID is available in Docker Desktop. Bound transcript inference so a killed
// process cannot remain active indefinitely. Quiet, long-running tools may time out too.
const TRANSCRIPT_WINDOW_MS = 5 * 60 * 1000

/** Recognize a delivered subagent report, including trailing parallel tool receipts.
 * @param {object[]} records
 * @returns {boolean}
 */
export function completedSubagentHandback(records) {
  const receipts = new Map()
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const content = record.message?.content
    if (record.type === 'user') {
      // A real follow-up starts new work. Tool receipts alone are bookkeeping;
      // another tool in the same batch may finish after the report was delivered.
      if (!Array.isArray(content) || !content.length || content.some(c => c?.type !== 'tool_result')) return false
      for (const result of content) {
        if (!receipts.has(result.tool_use_id)) receipts.set(result.tool_use_id, result)
      }
    } else if (record.type === 'assistant') {
      if (!Array.isArray(content)) return false
      return content.some(call => call?.type === 'tool_use' && call.name === 'SubagentHandback' &&
        handbackSucceeded(receipts.get(call.id)))
    }
  }
  return false
}

/** Require an acknowledged successful delivery, not merely an attempted handback.
 * @param {object | undefined} receipt
 * @returns {boolean}
 */
function handbackSucceeded(receipt) {
  if (!receipt || receipt.is_error) return false
  const blocks = typeof receipt.content === 'string'
    ? [{ type: 'text', text: receipt.content }]
    : receipt.content
  if (!Array.isArray(blocks)) return false
  return blocks.some(block => {
    if (block?.type !== 'text') return false
    try { return JSON.parse(block.text)?.success === true } catch { return false }
  })
}

/** Find recently written sessions when the host process namespace is unavailable.
 * @param {Map<string, {file: string, mtime: number}>} transcripts
 * @param {number} now
 * @returns {Promise<Set<string>>}
 */
export async function recentClaudeSessions(transcripts, now = Date.now()) {
  const recent = new Set()
  for (const [id, entry] of transcripts) {
    if (now - entry.mtime >= TRANSCRIPT_WINDOW_MS) continue
    try {
      const records = jsonLines(await readTail(entry.file, 64 * 1024))
      // Empty, malformed or bookkeeping-only tails are not activity evidence.
      if (records.some(r => r.type === 'user' || r.type === 'assistant')) recent.add(id)
    } catch {
      // The session may disappear or rotate while being scanned.
    }
  }
  return recent
}
