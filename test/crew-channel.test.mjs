// test/crew-channel.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { channelInstruction, mentions, parseMove } from '../server/crew/channel.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb } from './support/crew-db.mjs'
import { held, outline, posted, rest, withChannel } from './support/crew-channel.mjs'
import { record, refused } from './support/crew-talk.mjs'

const slowly = (text, ms = 150) => [{ pause: ms }, { type: 'text', text }, { type: 'finished', text }]
const LONG = [{ pause: 5000 }, { type: 'finished', text: 'never' }]

test('the names after an @ are found, and an address is not one', () => {
  assert.deepEqual(mentions('@Ada and @bo, then @Cy-2. Not me@example.com, not @ nobody, not @@Dot'), ['Ada', 'bo', 'Cy-2'])
  assert.deepEqual(mentions("(@Ada's turn) @ADA again, @Élodie too"), ['Ada', 'Élodie'])
  assert.deepEqual(mentions('nobody here'), [])
})

test('what an agent says is a pass, a claim or a contribution, by its first line alone', () => {
  assert.deepEqual(parseMove('PASS'), { move: 'pass' })
  assert.deepEqual(parseMove('  pass.\n'), { move: 'pass' })
  assert.deepEqual(parseMove('**PASS**'), { move: 'pass' })
  assert.deepEqual(parseMove(''), { move: 'pass' })
  assert.deepEqual(parseMove(undefined), { move: 'pass' })
  // A pass is a pass, whatever was said after it.
  assert.deepEqual(parseMove('PASS\nbut here is a page about why'), { move: 'pass' })

  assert.deepEqual(parseMove('CLAIM: Site\nI will fix the footer.'), { move: 'claim', workspace: 'Site', text: 'I will fix the footer.' })
  assert.deepEqual(parseMove('claim : "Site".'), { move: 'claim', workspace: 'Site', text: '' })
  assert.deepEqual(parseMove('CLAIM:'), { move: 'claim', workspace: '', text: '' })

  // Only the first line counts: an agent that talks about claiming has not claimed.
  assert.deepEqual(parseMove('I could CLAIM: Site if you like'), { move: 'reply', text: 'I could CLAIM: Site if you like' })
  assert.deepEqual(parseMove('Here is what I think.\nCLAIM: Site'), { move: 'reply', text: 'Here is what I think.\nCLAIM: Site' })
  assert.deepEqual(parseMove('Passing this to Bo would be best.'), { move: 'reply', text: 'Passing this to Bo would be best.' })

  const long = parseMove('x'.repeat(100_000))
  assert.equal(long.text.length, 1500)
  assert.ok(long.text.endsWith('…'))
  assert.equal(parseMove(`CLAIM: Site\n${'y'.repeat(100_000)}`).text.length, 1500)
})

test('an agent is told the three ways to answer, that it may not change anything, and where work can go', () => {
  const open = channelInstruction({ named: false, workspaces: [{ name: 'Site', description: 'The public   website.' }, { name: 'Api', description: '' }] })
  assert.match(open, /crew channel/)
  assert.match(open, /every agent who is free/)
  assert.match(open, /^- .*`CLAIM: <workspace name>`/m)
  assert.match(open, /exactly `PASS`/)
  assert.match(open, /may not change anything/)
  assert.match(open, /^- Site: The public website\.$/m)
  assert.match(open, /^- Api$/m)
  assert.match(channelInstruction({ named: true, workspaces: [] }), /to you by name/)
  assert.match(channelInstruction({ named: true, workspaces: [] }), /no workspaces .* nothing can be claimed/)
  const many = Array.from({ length: 500 }, (_, n) => ({ name: `W${n}`, description: 'd'.repeat(200) }))
  assert.ok(channelInstruction({ named: false, workspaces: many }).length < 12_000)
})

test('a post goes to every free agent, and each answers once: a claim, a contribution, a pass', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, moves }) => {
    // Ada takes a moment longer, so Bo has said its piece before the post is taken.
    Object.assign(moves, { Ada: slowly('CLAIM: site\nI will fix the footer.'), Bo: 'The footer is in layout.css.' })
    const post = await crew.channel.post({ text: '  Who can fix the footer?  ' })
    assert.equal(post.text, 'Who can fix the footer?')
    assert.equal(post.named, false)
    assert.deepEqual(post.to.map((one) => [one.name, one.agentId]), [['Ada', ada.id], ['Bo', bo.id], ['Cy', cy.id]])
    await rest(crew, [ada, bo, cy])

    const now = await crew.channel.get(post.id)
    assert.deepEqual(outline(now), [
      ['Ada', 'claimed', null, 'I will fix the footer.'],
      ['Bo', 'replied', null, 'The footer is in layout.css.'],
      ['Cy', 'passed', null, ''],
    ])
    assert.deepEqual(
      [now.claim.agentId, now.claim.name, now.claim.workspaceId, now.claim.state, now.claim.reason],
      [ada.id, 'Ada', site.id, 'granted', null])

    // The claim became an ordinary task, in the workspace Ada named, begun with the post.
    const task = await crew.conversations.get(now.claim.conversationId)
    assert.deepEqual([task.agentId, task.workspaceId, task.kind, task.title], [ada.id, site.id, 'task', 'Who can fix the footer?'])
    assert.deepEqual(await record(crew, task.id), [
      ['message', 'working', { text: 'Who can fix the footer?', postId: post.id }],
      ['text', 'working', { text: 'Done.' }],
      ['finished', 'idle', { text: 'Done.' }],
    ])
    // Nothing from the channel is in it but the post itself.
    assert.equal(crew.scripted.turns.filter((turn) => !turn.channel).length, 1)

    // Each was asked in a conversation of its own, told how to answer and what there is.
    const asked = crew.scripted.turns.filter((turn) => turn.channel)
    assert.deepEqual(asked.map((turn) => turn.agent.name).sort(), ['Ada', 'Bo', 'Cy'])
    for (const turn of asked) {
      assert.equal(turn.text, 'Who can fix the footer?')
      assert.deepEqual(turn.channel, { workspaces: ['Site', 'Api'] })
      assert.match(turn.agent.role, /CLAIM: <workspace name>/)
      assert.equal(turn.autonomy, 'ask')
    }
    assert.match(asked.find((turn) => turn.agent.name === 'Ada').agent.role, /^Writes the docs\./)

    // Every change went out as the whole post, and the last is how it stands.
    const events = posted(crew)
    assert.ok(events.length >= 4)
    assert.ok(events.every((event) => event.postId === post.id && event.conversationId === null && event.agentId === null && event.status === null))
    assert.deepEqual(events.at(-1).data, JSON.parse(JSON.stringify(now)))
    assert.deepEqual(events[0].data.to.map((one) => one.state), ['queued', 'queued', 'queued'])
  })
})

test('agents who are busy are skipped, and the post says who and why', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, moves, tasks }) => {
    tasks.long = LONG
    tasks.ask = [{ type: 'question', requestId: 'q1', questions: [{ question: 'Which?', options: [] }] }, { wait: 'q1' }]
    moves.Cy = 'Here.'
    await crew.conversations.send(ada.id, { text: 'long', workspaceId: site.id })
    await crew.conversations.send(bo.id, { text: 'ask', workspaceId: site.id })
    while ((await crew.conversations.statuses()).get(bo.id).status !== 'waiting') await new Promise((resolve) => setTimeout(resolve, 5))

    const post = await crew.channel.post({ text: 'Anyone?' })
    await rest(crew, [cy])
    assert.deepEqual(outline(await crew.channel.get(post.id)), [
      ['Ada', 'skipped', 'working', ''],
      ['Bo', 'skipped', 'waiting', ''],
      ['Cy', 'replied', null, 'Here.'],
    ])

    // With nobody free the post is still kept, and says so.
    tasks.long2 = LONG
    await crew.conversations.send(cy.id, { text: 'long2', workspaceId: site.id })
    const unheard = await crew.channel.post({ text: 'Anyone at all?' })
    assert.deepEqual(unheard.to.map((one) => one.state), ['skipped', 'skipped', 'skipped'])
  })
})

test('a post that names agents goes only to them, and a name nobody has is refused', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, moves }) => {
    Object.assign(moves, { Ada: 'Yes.', Bo: 'No.', Cy: 'Maybe.' })
    const post = await crew.channel.post({ text: '@bo and @CY: is the build green? (@Bo?)' })
    assert.equal(post.named, true)
    await rest(crew, [ada, bo, cy])
    assert.deepEqual(outline(await crew.channel.get(post.id)), [['Bo', 'replied', null, 'No.'], ['Cy', 'replied', null, 'Maybe.']])
    assert.match(crew.scripted.turns[0].agent.role, /to you by name/)

    const before = (await crew.channel.list()).posts.length
    await assert.rejects(crew.channel.post({ text: '@Ada and @Zed, look' }), (error) => refused('unknown_mention')(error) && /Zed/.test(error.message) && !/Ada/.test(error.message))
    for (const bad of [undefined, '', '   ', 7, 'x'.repeat(4001)]) await assert.rejects(crew.channel.post({ text: bad }), refused('bad_post'))
    await assert.rejects(crew.channel.post(), refused('bad_post'))
    assert.equal((await crew.channel.list()).posts.length, before)
  })
})

test('a world with no agents has nobody to post to', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy }) => {
    for (const agent of [ada, bo, cy]) await crew.roster.retire(agent.id)
    await assert.rejects(crew.channel.post({ text: 'Hello?' }), refused('no_agents'))
  })
})

test('a named agent that is busy has the post queued, and gets it when it is free', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, site, moves, tasks }) => {
    tasks.slow = slowly('Slow done.', 250)
    Object.assign(moves, { Ada: 'Now I can say: yes.', Bo: 'Yes.' })
    await crew.conversations.send(ada.id, { text: 'slow', workspaceId: site.id })

    const post = await crew.channel.post({ text: '@Ada @Bo does the install section match?' })
    assert.deepEqual(post.to.map((one) => [one.name, one.state]), [['Ada', 'queued'], ['Bo', 'answering']])
    const second = await crew.channel.post({ text: '@Ada and another thing' })
    assert.deepEqual(second.to.map((one) => [one.name, one.state]), [['Ada', 'queued']])

    await rest(crew, [ada, bo])
    assert.deepEqual(outline(await crew.channel.get(post.id)), [['Ada', 'replied', null, 'Now I can say: yes.'], ['Bo', 'replied', null, 'Yes.']])
    assert.deepEqual(outline(await crew.channel.get(second.id)), [['Ada', 'replied', null, 'Now I can say: yes.']])
    // Its task came first, then the posts in the order they were made, one at a time.
    assert.deepEqual(crew.scripted.turns.filter((turn) => turn.agent.name === 'Ada').map((turn) => turn.text), [
      'slow', '@Ada @Bo does the install section match?', '@Ada and another thing',
    ])
  })
})

test('two agents claiming at the same moment: one is given the task, the other is told it is taken', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, api, moves }) => {
    Object.assign(moves, { Ada: 'CLAIM: Site', Bo: 'CLAIM: Api\nMine.', Cy: 'CLAIM: Site' })
    const post = await crew.channel.post({ text: 'Fix the footer' })
    await rest(crew, [ada, bo, cy])

    const now = await crew.channel.get(post.id)
    const winners = now.to.filter((one) => one.state === 'claimed')
    assert.equal(winners.length, 1)
    assert.deepEqual(now.to.filter((one) => one.state !== 'claimed').map((one) => [one.state, one.reason]), [['passed', 'taken'], ['passed', 'taken']])
    assert.equal(now.claim.agentId, winners[0].agentId)
    assert.equal(now.claim.workspaceId, winners[0].name === 'Bo' ? api.id : site.id)

    const [{ count }] = await crew.sql`select count(*)::int as count from channel_claims where post_id = ${post.id}`
    assert.equal(count, 1)
    assert.equal(crew.scripted.turns.filter((turn) => !turn.channel).length, 1, 'one task, not three')
    const tasks = await crew.sql`select agent_id from conversations where kind = 'task'`
    assert.deepEqual(tasks.map((row) => row.agentId), [now.claim.agentId])
  })
})

test('when one agent takes the task, those still answering are stopped and those waiting are not asked', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, moves, tasks }) => {
    tasks.slow = slowly('Slow done.', 300)
    Object.assign(moves, { Ada: 'CLAIM: Site', Bo: LONG, Cy: 'CLAIM: Site' })
    await crew.conversations.send(cy.id, { text: 'slow', workspaceId: site.id })
    const post = await crew.channel.post({ text: '@Ada @Bo @Cy fix the footer' })
    await rest(crew, [ada, bo, cy])

    assert.deepEqual(outline(await crew.channel.get(post.id)), [
      ['Ada', 'claimed', null, ''],
      ['Bo', 'passed', 'taken', ''],
      ['Cy', 'skipped', 'taken', ''],
    ])
    assert.equal((await crew.conversations.statuses()).get(bo.id), undefined, 'Bo is free again')
    assert.equal(crew.scripted.turns.filter((turn) => turn.channel).length, 2, 'Cy was never asked')
  })
})

test('a claim that names no workspace this world has is a reply, and no work begins', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, moves }) => {
    Object.assign(moves, { Ada: 'CLAIM: /etc\nI would start there.', Bo: 'CLAIM:', Cy: 'CLAIM: Docs' })
    await crew.sql`insert into workspaces (world_id, name) values ('elsewhere', 'Docs')`
    const post = await crew.channel.post({ text: 'Fix the footer' })
    await rest(crew, [ada, bo, cy])

    const now = await crew.channel.get(post.id)
    assert.deepEqual(outline(now), [
      ['Ada', 'replied', 'unplaced', 'I would start there.'],
      ['Bo', 'replied', 'unplaced', 'I can take this.'],
      ['Cy', 'replied', 'unplaced', 'I can take this.'],
    ])
    assert.equal(now.claim, null)
    assert.equal(crew.scripted.turns.filter((turn) => !turn.channel).length, 0)
  })
})

test('a world can limit how many answer, and those asked least recently go first', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, moves }) => {
    Object.assign(moves, { Ada: 'A.', Bo: 'B.', Cy: 'C.' })
    await crew.settings.update({ channelLimit: 2 })
    const first = await crew.channel.post({ text: 'One?' })
    await rest(crew, [ada, bo, cy])
    assert.deepEqual(outline(await crew.channel.get(first.id)), [['Ada', 'replied', null, 'A.'], ['Bo', 'replied', null, 'B.'], ['Cy', 'skipped', 'limit', '']])

    const second = await crew.channel.post({ text: 'Two?' })
    await rest(crew, [ada, bo, cy])
    assert.deepEqual((await crew.channel.get(second.id)).to.map((one) => [one.name, one.state]), [['Ada', 'replied'], ['Bo', 'skipped'], ['Cy', 'replied']])

    // The limit is on a post to everyone. Naming agents is asking for them.
    const named = await crew.channel.post({ text: '@Ada @Bo @Cy all of you?' })
    await rest(crew, [ada, bo, cy])
    assert.deepEqual((await crew.channel.get(named.id)).to.map((one) => one.state), ['replied', 'replied', 'replied'])
  })
})

test('an agent this server cannot run is skipped, and one that fails or is stopped is shown as such', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, moves }) => {
    const claw = await crew.roster.create({ name: 'Claw', runtime: 'openclaw' })
    Object.assign(moves, { Ada: [{ type: 'text', text: 'Starting.' }, { crash: 'The model is out of credit' }], Bo: LONG })
    const post = await crew.channel.post({ text: 'Anyone?' })
    assert.deepEqual(post.to.find((one) => one.agentId === claw.id).state, 'skipped')
    await crew.conversations.stop(bo.id)
    await rest(crew, [ada, bo, cy])
    assert.deepEqual(outline(await crew.channel.get(post.id)), [
      ['Ada', 'failed', 'The model is out of credit', ''],
      ['Bo', 'failed', 'stopped', ''],
      ['Cy', 'passed', null, ''],
      ['Claw', 'skipped', 'runtime', ''],
    ])
    const named = await crew.channel.post({ text: '@Claw you there?' })
    assert.deepEqual(outline(named), [['Claw', 'skipped', 'runtime', '']])
  })
})

test('releasing a claim stops the agent if it is still on it, and leaves the post with nobody', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, moves, tasks }) => {
    const untaken = await crew.channel.post({ text: 'Nothing to take' })
    await rest(crew, [ada, bo, cy])
    await assert.rejects(crew.channel.release(untaken.id), refused('no_claim'))

    tasks['Fix the footer'] = LONG
    moves.Ada = 'CLAIM: Site'
    const post = await crew.channel.post({ text: 'Fix the footer' })
    const claimed = await held(crew, post.id)
    await rest(crew, [bo, cy])
    assert.equal((await crew.conversations.statuses()).get(ada.id).status, 'working')

    const released = await crew.channel.release(post.id)
    assert.deepEqual([released.claim.agentId, released.claim.state, released.claim.reason, released.claim.conversationId], [ada.id, 'released', 'released', claimed.claim.conversationId])
    assert.deepEqual((await record(crew, claimed.claim.conversationId)).at(-1), ['interrupted', 'idle', {}])
    assert.deepEqual(posted(crew).at(-1).data, JSON.parse(JSON.stringify(released)))
    await assert.rejects(crew.channel.release(post.id), refused('no_claim'))
    await assert.rejects(crew.channel.release('nothing'), refused('unknown_post'))

    // An agent that has moved on to something else is not stopped by an old claim's release.
    moves.Ada = 'CLAIM: Site'
    tasks['Another thing'] = [{ type: 'finished', text: 'Done.' }]
    tasks.long = LONG
    const next = await crew.channel.post({ text: 'Another thing' })
    await rest(crew, [ada, bo, cy])
    await crew.conversations.send(ada.id, { text: 'long', workspaceId: site.id })
    await crew.channel.release(next.id)
    assert.equal((await crew.conversations.statuses()).get(ada.id).status, 'working')
  })
})

test('a post can be handed to an agent as its task, which takes it from whoever had it', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, api, moves, tasks }) => {
    tasks['Fix the footer'] = LONG
    Object.assign(moves, { Ada: slowly('CLAIM: Api'), Bo: 'It is in layout.css.' })
    const post = await crew.channel.post({ text: 'Fix the footer' })
    const first = await held(crew, post.id)
    await rest(crew, [bo, cy])

    // No workspace given: it goes where the claim it replaces was.
    const handed = await crew.channel.hand(post.id, { agentId: bo.id })
    assert.deepEqual([handed.claim.agentId, handed.claim.workspaceId, handed.claim.state], [bo.id, api.id, 'granted'])
    assert.notEqual(handed.claim.conversationId, first.claim.conversationId)
    assert.deepEqual(outline(handed), [['Ada', 'claimed', null, ''], ['Bo', 'claimed', null, 'It is in layout.css.'], ['Cy', 'passed', null, '']])
    assert.deepEqual((await record(crew, first.claim.conversationId)).at(-1), ['interrupted', 'idle', {}], 'Ada was stopped')
    assert.deepEqual((await record(crew, handed.claim.conversationId))[0], ['message', 'working', { text: 'Fix the footer', postId: post.id }])
    const claims = await crew.sql`select agent_id, reason, released_at is null as granted from channel_claims where post_id = ${post.id} order by granted_at`
    assert.deepEqual(claims.map((row) => [row.agentId, row.reason, row.granted]), [[ada.id, 'handed', false], [bo.id, null, true]])

    // A busy agent cannot be handed anything, and the post stays with whoever has it.
    await assert.rejects(crew.channel.hand(post.id, { agentId: bo.id }), refused('agent_busy'))
    assert.equal((await crew.channel.get(post.id)).claim.agentId, bo.id)

    // To an agent the post never went to, somewhere chosen.
    const dee = await crew.roster.create({ name: 'Dee', runtime: 'claude-code' })
    const again = await crew.channel.hand(post.id, { agentId: dee.id, workspaceId: site.id })
    assert.deepEqual([again.claim.agentId, again.claim.workspaceId], [dee.id, site.id])
    assert.deepEqual(outline(again).at(-1), ['Dee', 'claimed', null, ''])

    await assert.rejects(crew.channel.hand(post.id, { agentId: 'nobody' }), refused('unknown_agent'))
    await assert.rejects(crew.channel.hand(post.id, {}), refused('unknown_agent'))
    await assert.rejects(crew.channel.hand('nothing', { agentId: cy.id }), refused('unknown_post'))
    await assert.rejects(crew.channel.hand(post.id, { agentId: cy.id, workspaceId: 'nowhere' }), refused('unknown_workspace'))
    assert.equal((await crew.channel.get(post.id)).claim.agentId, dee.id)
  })
})

test('a reply is made a task for the agent that gave it, once it is known where', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, moves }) => {
    Object.assign(moves, { Ada: 'The docs say per workspace.' })
    const post = await crew.channel.post({ text: 'Which is right?' })
    await rest(crew, [ada, bo, cy])

    // Nobody claimed it and Ada is in no workspace: there is nowhere to put the work.
    await assert.rejects(crew.channel.hand(post.id, { agentId: ada.id }), refused('needs_workspace'))
    assert.equal((await crew.channel.get(post.id)).claim, null)

    const made = await crew.channel.hand(post.id, { agentId: ada.id, workspaceId: site.id })
    assert.deepEqual([made.claim.agentId, made.claim.workspaceId, made.claim.state], [ada.id, site.id, 'granted'])
    assert.deepEqual(outline(made)[0], ['Ada', 'claimed', null, 'The docs say per workspace.'])
    await rest(crew, [ada])

    // And now Ada is somewhere, the next can go there unasked.
    const next = await crew.channel.post({ text: '@Bo what about this?' })
    await rest(crew, [bo])
    const there = await crew.channel.hand(next.id, { agentId: ada.id })
    assert.equal(there.claim.workspaceId, site.id)
  })
})

test('a winner that cannot start has its claim released, with the reason', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, moves }) => {
    moves.Ada = 'CLAIM: Site\nI will do it.'
    const send = crew.conversations.send
    crew.conversations.send = async () => {
      throw new CrewError('agent_busy', 'Ada was given something else at the same moment', 409)
    }
    const post = await crew.channel.post({ text: 'Fix the footer' })
    await rest(crew, [ada, bo, cy])
    crew.conversations.send = send

    const now = await crew.channel.get(post.id)
    assert.deepEqual([now.claim.agentId, now.claim.state, now.claim.reason, now.claim.conversationId], [ada.id, 'released', 'Ada was given something else at the same moment', null])
    assert.deepEqual(outline(now)[0], ['Ada', 'claimed', null, 'I will do it.'])

    // A hand-over that cannot start says why to whoever asked, and holds nothing.
    crew.conversations.send = async () => {
      throw new CrewError('needs_workspace', 'That workspace has gone', 409)
    }
    await assert.rejects(crew.channel.hand(post.id, { agentId: bo.id }), refused('needs_workspace'))
    crew.conversations.send = send
    const after = await crew.channel.get(post.id)
    assert.deepEqual([after.claim.agentId, after.claim.state, after.claim.reason], [bo.id, 'released', 'That workspace has gone'])
  })
})

test('after a restart nothing is left answering, a claim that never started is let go, and a queued post is delivered', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy, site, moves }) => {
    moves.Cy = 'Here now.'
    // What a server that stopped leaves: Ada mid-answer, Bo granted a claim with no task yet,
    // and Cy with a post waiting for it.
    const [post] = await crew.sql`insert into channel_posts (world_id, text, named) values ('w', '@Ada @Bo @Cy fix it', true) returning id`
    const [talk] = await crew.sql`insert into conversations (world_id, agent_id, kind, post_id) values ('w', ${ada.id}, 'channel', ${post.id}) returning id`
    await crew.sql`insert into channel_deliveries (world_id, post_id, agent_id, state, conversation_id) values ('w', ${post.id}, ${ada.id}, 'answering', ${talk.id})`
    await crew.sql`insert into channel_deliveries (world_id, post_id, agent_id, state) values ('w', ${post.id}, ${bo.id}, 'claimed')`
    await crew.sql`insert into channel_deliveries (world_id, post_id, agent_id, state) values ('w', ${post.id}, ${cy.id}, 'queued')`
    await crew.sql`insert into channel_claims (world_id, post_id, agent_id, workspace_id) values ('w', ${post.id}, ${bo.id}, ${site.id})`

    await crew.conversations.recover()
    await crew.channel.recover()
    await rest(crew, [ada, bo, cy])

    const now = await crew.channel.get(post.id)
    assert.deepEqual(outline(now), [['Ada', 'failed', 'restart', ''], ['Bo', 'claimed', null, ''], ['Cy', 'replied', null, 'Here now.']])
    assert.deepEqual([now.claim.agentId, now.claim.state, now.claim.reason], [bo.id, 'released', 'restart'])
    assert.deepEqual(posted(crew).at(-1).data, JSON.parse(JSON.stringify(now)))
  })
})

test('a post waiting for an agent that is retired is not left waiting', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, site, tasks }) => {
    tasks.long = LONG
    await crew.conversations.send(ada.id, { text: 'long', workspaceId: site.id })
    const post = await crew.channel.post({ text: '@Ada when you are done' })
    await crew.roster.retire(ada.id)
    await crew.conversations.dismiss(ada.id)
    await crew.channel.forget(ada.id)
    await rest(crew, [ada, bo])
    assert.deepEqual(outline(await crew.channel.get(post.id)), [['Ada', 'skipped', 'retired', '']])
  })
})

test('the channel is read a page at a time, oldest first, with where the record stood', needsDb, async () => {
  await withChannel(async (crew, { ada, bo, cy }) => {
    assert.deepEqual(await crew.channel.list(), { posts: [], seq: 0 })
    const made = []
    for (const text of ['one', 'two', 'three', 'four', 'five']) made.push(await crew.channel.post({ text: `@Ada ${text}` }))
    await rest(crew, [ada, bo, cy])

    const all = await crew.channel.list()
    assert.deepEqual(all.posts.map((post) => post.text), ['@Ada one', '@Ada two', '@Ada three', '@Ada four', '@Ada five'])
    assert.equal(all.seq, await crew.events.head())
    assert.deepEqual(all.posts[0], await crew.channel.get(made[0].id))

    const latest = await crew.channel.list({ limit: 2 })
    assert.deepEqual(latest.posts.map((post) => post.text), ['@Ada four', '@Ada five'])
    const earlier = await crew.channel.list({ limit: 2, before: latest.posts[0].id })
    assert.deepEqual(earlier.posts.map((post) => post.text), ['@Ada two', '@Ada three'])

    await assert.rejects(crew.channel.get('nothing'), refused('unknown_post'))
    await assert.rejects(crew.channel.get(ada.id), refused('unknown_post'))
    await assert.rejects(crew.channel.list({ before: 'nothing' }), refused('bad_query'))
  })
})

test('a post in another world is not this world\'s to read or change', needsDb, async () => {
  await withChannel(async (crew, { ada }) => {
    const [theirs] = await crew.sql`insert into channel_posts (world_id, text) values ('elsewhere', 'Theirs') returning id`
    await assert.rejects(crew.channel.get(theirs.id), refused('unknown_post'))
    await assert.rejects(crew.channel.release(theirs.id), refused('unknown_post'))
    await assert.rejects(crew.channel.hand(theirs.id, { agentId: ada.id }), refused('unknown_post'))
    assert.deepEqual((await crew.channel.list()).posts, [])
  })
})
