import test from 'node:test'
import assert from 'node:assert/strict'
import { claudeTurnState } from '../server/lib/claude-turn.mjs'

/** Create a finished assistant reply for attention classification.
 * @param {string} text
 * @returns {object}
 */
function reply(text) {
  return { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } }
}

for (const text of [
  'Done. All tests passed.',
  'Task 5’s fix round is still running.',
  'Review complete. No action needed from you.',
  'The test fixture contains this question:\n\n> Which branch should I use?',
  'Added this example:\n\n```text\nPlease approve the deployment.\n```',
  'The troubleshooting guide asks “Why does this fail?” and explains the solution.',
]) {
  test(`a report does not request attention: ${text.slice(0, 55)}`, () => {
    assert.deepEqual(claudeTurnState([reply(text)]), { ended: true, needsAttention: false })
  })
}

test('a newer user message clears a previous request', () => {
  assert.deepEqual(claudeTurnState([reply('Which branch should I use?'), {
    type: 'user', message: { content: 'Use main' },
  }]), { ended: false, needsAttention: false })
})

test('plan approval stays pending across unrelated tool receipts and clears when answered', () => {
  const records = [{ type: 'assistant', message: { content: [
    { type: 'tool_use', name: 'ExitPlanMode', id: 'plan' },
    { type: 'tool_use', name: 'Bash', id: 'check' },
  ] } }, { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'check', content: 'OK' },
  ] } }]
  assert.equal(claudeTurnState(records).needsAttention, true)
  records.push({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'plan', content: 'Approved' },
  ] } })
  assert.equal(claudeTurnState(records).needsAttention, false)
})
