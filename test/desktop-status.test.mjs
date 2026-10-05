import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeSessions } from '../desktop/status.mjs'

test('marking a session read clears its tray waiting count until new activity', () => {
  const thread = { id: 'one', unread: true, lastActivityAt: 100 }
  assert.equal(summarizeSessions([thread], { viewedAt: { one: 100 } }).waiting, 0)
  assert.equal(summarizeSessions([{ ...thread, lastActivityAt: 101 }], { viewedAt: { one: 100 } }).waiting, 1)
})

test('tray respects archived and hidden sessions and colony status precedence', () => {
  const threads = [
    { id: 'working', running: true, unread: true },
    { id: 'blocked', hasError: true, running: true, unread: true },
    { id: 'merged', prState: 'MERGED', unread: true },
    { id: 'archived', running: true },
    { id: 'hidden', project: 'hidden-project', unread: true },
    { id: 'harness-archived', archived: true, unread: true },
  ]
  assert.deepEqual(summarizeSessions(threads, { archived: ['archived'], hiddenProjects: ['hidden-project'] }), {
    total: 3, working: 1, waiting: 0,
  })
})

test('unread completions do not count as needing help when the scanner knows the intent', () => {
  assert.equal(summarizeSessions([{ id: 'done', unread: true, needsAttention: false }]).waiting, 0)
  assert.equal(summarizeSessions([{ id: 'question', unread: false, needsAttention: true }]).waiting, 1)
})

test('marking a request viewed dismisses its attention indicator', () => {
  assert.equal(summarizeSessions([{ id: 'question', needsAttention: true, lastActivityAt: 100 }], {
    viewedAt: { question: 100 },
  }).waiting, 0)
})
