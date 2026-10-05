import { jsonLines, readTail } from './fsutil.mjs'
import { completedSubagentHandback } from './claude-activity.mjs'

const INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Distinguish an ended turn from an actual request for human input.
 * @param {object[]} records
 * @returns {{ended: boolean, needsAttention: boolean}}
 */
export function claudeTurnState(records) {
  const pending = new Set()
  let latest
  for (const record of records) {
    if (!['user', 'assistant'].includes(record.type)) continue
    const content = record.message?.content
    if (record.type === 'user') {
      if (Array.isArray(content) && content.length && content.every(c => c?.type === 'tool_result')) {
        for (const result of content) pending.delete(result.tool_use_id)
      } else pending.clear()
    } else if (Array.isArray(content)) {
      for (const call of content) {
        if (call?.type === 'tool_use' && INPUT_TOOLS.has(call.name) && call.id) pending.add(call.id)
      }
    }
    latest = record
  }
  if (pending.size) return { ended: false, needsAttention: true }
  if (latest?.type !== 'assistant') return { ended: false, needsAttention: false }
  const content = latest.message?.content
  const blocks = Array.isArray(content) ? content : []
  const text = typeof content === 'string' ? content : blocks.filter(c => c?.type === 'text').map(c => c.text || '').join('\n')
  const calling = blocks.some(c => c?.type === 'tool_use') || latest.message?.stop_reason === 'tool_use'
  const ended = !calling && (latest.message?.stop_reason === 'end_turn' || Boolean(text.trim()))
  return { ended, needsAttention: ended && requestsInput(text) }
}

/** Recognize direct closing questions or requests, excluding quoted/code examples.
 * This is conservative text inference; ordinary completion and progress reports stay quiet.
 * @param {string} text
 * @returns {boolean}
 */
function requestsInput(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/^\s*>.*$/gm, '')
    .replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').trim()
  const closing = prose.split(/\n\s*\n/).at(-1) || ''
  return /(?:^|[.!]\s+|\n)\s*(?:[-*]\s*)?(?:which|what|where|when|how|would|should|can|could|do|does|are|is|will)\b[^\n?]*\?\s*$/i.test(closing) ||
    /(?:^|[.!]\s+|\n)\s*(?:please\s+(?:confirm|approve|choose|select|provide|tell me)|(?:I need|I’m waiting for|I'm waiting for|Waiting for)\s+your\s+(?:approval|confirmation|input|decision))\b/i.test(closing)
}

/** Read only the current transcript tail; subagent delivery is a separate completion signal.
 * @param {string} file
 * @param {boolean} subagent
 * @returns {Promise<{ended: boolean, needsAttention: boolean}>}
 */
export async function readClaudeTurn(file, subagent = false) {
  try {
    const records = jsonLines(await readTail(file, 64 * 1024))
    if (subagent && completedSubagentHandback(records)) return { ended: true, needsAttention: false }
    return claudeTurnState(records)
  } catch { return { ended: false, needsAttention: false } }
}
