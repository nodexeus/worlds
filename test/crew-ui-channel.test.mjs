// test/crew-ui-channel.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { audience, candidates, complete, createChannelState, headline, mentionAt, postView } from '../src/crew/channel.js'

const AGENTS = [
  { id: 'a1', name: 'Ada', status: 'working' },
  { id: 'a2', name: 'Bo', status: 'waiting' },
  { id: 'a3', name: 'Juniper', status: 'idle' },
  { id: 'a4', name: 'Juno', status: 'failed' },
]
const WORKSPACES = [{ id: 'w1', name: 'Site' }, { id: 'w2', name: 'Api' }]
const to = (name, state, more = {}) => ({ agentId: AGENTS.find((agent) => agent.name === name)?.id ?? name, name, state, reason: null, text: '', conversationId: null, ...more })
const post = (id, more = {}) => ({ id, text: `post ${id}`, at: '2026-10-08T10:00:00.000Z', named: false, to: [], claim: null, ...more })
const about = (seq, data) => ({ seq, type: 'post', postId: data.id, conversationId: null, agentId: null, status: null, data })

test('the channel keeps its posts in order, and an event replaces the post it is about', () => {
  const channel = createChannelState()
  const told = []
  channel.subscribe((what) => told.push(what))
  channel.setPosts({ posts: [post('p1'), post('p2')], seq: 10 })
  assert.deepEqual(channel.posts.map((one) => one.id), ['p1', 'p2'])
  assert.equal(told.length, 1)

  const changed = channel.apply(about(11, post('p1', { text: 'now' })))
  assert.deepEqual([changed.was.text, changed.now.text], ['post p1', 'now'])
  assert.equal(channel.posts[0].text, 'now')
  // A new post goes where its id puts it, which is when it was made.
  assert.equal(channel.apply(about(12, post('p3'))).was, null)
  channel.apply(about(13, post('p0')))
  assert.deepEqual(channel.posts.map((one) => one.id), ['p0', 'p1', 'p2', 'p3'])
  assert.equal(told.length, 4)
})

test('an older word about a post never undoes a newer one, from the stream or from a snapshot', () => {
  const channel = createChannelState()
  channel.setPosts({ posts: [post('p1')], seq: 10 })
  channel.apply(about(15, post('p1', { text: 'newest' })))
  assert.equal(channel.apply(about(12, post('p1', { text: 'older' }))), null)
  assert.equal(channel.apply(about(15, post('p1', { text: 'again' }))), null)
  assert.equal(channel.posts[0].text, 'newest')

  // A snapshot read before event 15 was written.
  channel.setPosts({ posts: [post('p1', { text: 'snapshot' }), post('p2')], seq: 14 })
  assert.deepEqual(channel.posts.map((one) => one.text), ['newest', 'post p2'])
  channel.setPosts({ posts: [post('p1', { text: 'snapshot' }), post('p2')], seq: 15 })
  assert.equal(channel.posts[0].text, 'snapshot')
})

test('a snapshot is the latest page: earlier posts already read are kept, and a record that went back forgets all', () => {
  const channel = createChannelState()
  channel.setPosts({ posts: [post('p5'), post('p6')], seq: 10 })
  channel.addEarlier([post('p3'), post('p4')])
  assert.deepEqual(channel.posts.map((one) => one.id), ['p3', 'p4', 'p5', 'p6'])
  channel.setPosts({ posts: [post('p5'), post('p6'), post('p7')], seq: 12 })
  assert.deepEqual(channel.posts.map((one) => one.id), ['p3', 'p4', 'p5', 'p6', 'p7'])
  channel.reset()
  assert.deepEqual(channel.posts, [])
  // After a reset the old numbers mean nothing.
  assert.notEqual(channel.apply(about(1, post('p1'))), null)
})

test('events that are not about a post, or carry none, are not the channel\'s', () => {
  const channel = createChannelState()
  assert.equal(channel.apply({ seq: 1, type: 'text', postId: 'p1', data: { text: 'x' } }), null)
  assert.equal(channel.apply({ seq: 2, type: 'post', postId: 'p1', data: null }), null)
  assert.deepEqual(channel.posts, [])
})

test('the name being typed after an @ is found where the caret is', () => {
  assert.deepEqual(mentionAt('hello @Ju', 9), { start: 6, query: 'Ju' })
  assert.deepEqual(mentionAt('@', 1), { start: 0, query: '' })
  assert.deepEqual(mentionAt('(@a) and @b', 3), { start: 1, query: 'a' })
  assert.equal(mentionAt('hello @Ju there', 15), null, 'the caret has moved on')
  assert.equal(mentionAt('me@exa', 6), null, 'an address is not a name')
  assert.equal(mentionAt('hello', 5), null)
  assert.equal(mentionAt('@Ada ', 5), null)
})

test('the names offered are those that start as typed, whatever the case', () => {
  assert.deepEqual(candidates(AGENTS, 'ju').map((agent) => agent.name), ['Juniper', 'Juno'])
  assert.deepEqual(candidates(AGENTS, '').map((agent) => agent.name), ['Ada', 'Bo', 'Juniper', 'Juno'])
  assert.deepEqual(candidates(AGENTS, 'x'), [])
  assert.equal(candidates(Array.from({ length: 20 }, (_, n) => ({ id: `x${n}`, name: `Ab${n}` })), 'a').length, 6)
})

test('choosing a name writes it in, with a space after, and puts the caret there', () => {
  assert.deepEqual(complete('hello @Ju', { start: 6, query: 'Ju' }, 'Juniper'), { text: 'hello @Juniper ', caret: 15 })
  assert.deepEqual(complete('@a, look', { start: 0, query: 'a' }, 'Ada'), { text: '@Ada, look', caret: 4 })
})

test('the box says who a post will go to before it is sent', () => {
  assert.deepEqual(audience('Anyone?', AGENTS), { ok: true, text: 'Goes to every agent that is free: 2 of 4 now. Type @ to name one.' })
  assert.deepEqual(audience('@juniper look', AGENTS), { ok: true, text: 'Goes only to Juniper.' })
  assert.deepEqual(audience('@Ada @Juno @bo look', AGENTS), { ok: true, text: 'Goes only to Ada, Bo and Juno. Ada and Bo are busy and get it when they are free.' })
  assert.deepEqual(audience('@Ada look', AGENTS), { ok: true, text: 'Goes only to Ada. Ada is busy and gets it when it is free.' })
  assert.deepEqual(audience('@Zed and @Ada', AGENTS), { ok: false, text: 'There is no agent called Zed.' })
  assert.deepEqual(audience('Anyone?', AGENTS.slice(0, 2)), { ok: true, text: 'Everyone is busy, so nobody would get this. Name an agent with @ and it gets it when it is free.' })
  assert.deepEqual(audience('Anyone?', []), { ok: false, text: 'There is nobody in the crew yet.' })
  assert.deepEqual(audience('  ', AGENTS), { ok: false, text: 'Goes to every agent that is free: 2 of 4 now. Type @ to name one.' })
})

test('a post shows who it went to, what each said, and who was left out and why', () => {
  const view = postView(post('p1', {
    to: [
      to('Ada', 'skipped', { reason: 'working' }),
      to('Bo', 'skipped', { reason: 'waiting' }),
      to('Juniper', 'replied', { text: 'The docs say per workspace.' }),
      to('Juno', 'passed'),
      to('Quill', 'answering'),
      to('Mabel', 'failed', { reason: 'The model is out of credit' }),
      to('Pip', 'skipped', { reason: 'limit' }),
    ],
  }), { workspaces: WORKSPACES })
  assert.equal(view.sent, 'sent to Juniper, Juno, Quill, Mabel · skipped Ada (working), Bo (needs you), Pip (over the limit)')
  assert.deepEqual(view.replies, [{ agentId: 'a3', name: 'Juniper', text: 'The docs say per workspace.', note: null, canTask: true }])
  assert.deepEqual(view.notes, [
    { tone: 'pend', text: 'Quill is answering…' },
    { tone: 'fail', text: 'Mabel could not answer: The model is out of credit' },
    { tone: 'pass', text: 'Juno passed' },
  ])
  assert.equal(view.claim, null)
})

test('a post that named agents says who is still to get it', () => {
  const view = postView(post('p1', { named: true, to: [to('Ada', 'queued'), to('Juniper', 'replied', { text: 'Yes.' })] }), { workspaces: WORKSPACES })
  assert.equal(view.sent, 'sent to Juniper · queued for Ada')
  assert.deepEqual(view.notes, [{ tone: 'wait', text: 'Ada is busy. It gets this when it is free.' }])
  assert.equal(postView(post('p2', { to: [to('Ada', 'skipped', { reason: 'working' })] }), { workspaces: [] }).sent, 'nobody was free · skipped Ada (working)')
})

test('a post that was taken says by whom and where, and what can be done about it', () => {
  const taken = postView(post('p1', {
    to: [to('Juniper', 'claimed', { text: 'I will change the page.' }), to('Juno', 'passed', { reason: 'taken' }), to('Bo', 'replied', { text: 'Me too.', reason: 'unplaced' }), to('Ada', 'failed', { reason: 'stopped' })],
    claim: { agentId: 'a3', name: 'Juniper', workspaceId: 'w1', conversationId: 'c9', state: 'granted', reason: null },
  }), { workspaces: WORKSPACES })
  assert.deepEqual(taken.replies, [
    { agentId: 'a3', name: 'Juniper', text: 'I will change the page.', note: null, canTask: false },
    { agentId: 'a2', name: 'Bo', text: 'Me too.', note: 'would take it, and did not say where', canTask: true },
  ])
  assert.deepEqual(taken.claim, { state: 'granted', agentId: 'a3', title: 'Taken by Juniper', line: 'Its task is in Site.', canOpen: true, canRelease: true })
  assert.deepEqual(taken.notes, [{ tone: 'fail', text: 'Ada was stopped' }, { tone: 'pass', text: 'Juno stood down: it was taken' }])

  // An agent that claimed and said nothing more still has a line of its own.
  const quiet = postView(post('p1', { to: [to('Juniper', 'claimed')], claim: taken.claim && { agentId: 'a3', name: 'Juniper', workspaceId: 'gone', conversationId: null, state: 'granted', reason: null } }), { workspaces: WORKSPACES })
  assert.equal(quiet.replies[0].text, 'I will take this.')
  assert.deepEqual([quiet.claim.line, quiet.claim.canOpen], ['Starting on it.', false])
})

test('a claim that was let go says why, and that nobody has the post', () => {
  const released = (reason) => postView(post('p1', {
    to: [to('Juniper', 'claimed')],
    claim: { agentId: 'a3', name: 'Juniper', workspaceId: 'w1', conversationId: 'c9', state: 'released', reason },
  }), { workspaces: WORKSPACES }).claim
  assert.deepEqual(released('released'), { state: 'released', agentId: 'a3', title: 'Released', line: 'Juniper was taken off it. Nobody has this now.', canOpen: false, canRelease: false })
  assert.equal(released('retired').line, 'Juniper left the crew. Nobody has this now.')
  assert.equal(released('restart').line, 'The server restarted before Juniper began. Nobody has this now.')
  assert.equal(released('Juniper is in the middle of something').line, 'Juniper could not start: Juniper is in the middle of something. Nobody has this now.')
  // Once released, the agent's reply can be made a task again.
  assert.equal(postView(post('p1', { to: [to('Juniper', 'claimed', { text: 'x' })], claim: { agentId: 'a3', name: 'Juniper', workspaceId: 'w1', conversationId: 'c9', state: 'released', reason: 'released' } }), { workspaces: WORKSPACES }).replies[0].canTask, true)
})

test('what the collapsed bar says is the latest thing an agent did', () => {
  const before = post('p1', { to: [to('Ada', 'answering'), to('Bo', 'answering'), to('Juniper', 'queued')] })
  const now = (changes, claim = null) => post('p1', { to: before.to.map((one) => ({ ...one, ...(changes[one.name] ?? {}) })), claim })
  assert.equal(headline(before, now({ Ada: { state: 'replied', text: 'x' } })), 'Ada replied')
  assert.equal(headline(before, now({ Ada: { state: 'claimed' } }, { agentId: 'a1', name: 'Ada', state: 'granted' })), 'Ada took a task')
  assert.equal(headline(before, now({ Bo: { state: 'failed', reason: 'x' } })), 'Bo could not answer')
  assert.equal(headline(before, now({ Bo: { state: 'passed' } })), 'Bo passed')
  assert.equal(headline(before, now({ Juniper: { state: 'answering' } })), null, 'being asked is not news')
  assert.equal(headline(before, before), null)
  assert.equal(headline(null, before), null, 'the person\'s own post is not news to them')
  assert.equal(headline(now({}, { agentId: 'a1', name: 'Ada', state: 'granted' }), now({}, { agentId: 'a1', name: 'Ada', state: 'released' })), 'Ada was taken off a task')
})
