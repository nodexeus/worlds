// test/support/crew-channel.mjs
import { withTalk } from './crew-talk.mjs'

const said = (text) => [{ type: 'text', text }, { type: 'finished', text }]

/**
 * A crew with a channel, three agents (Ada, Bo, Cy) and two workspaces (Site, Api).
 *
 * What each agent says to a post is `moves[name]`: text, or a script's steps. An agent with
 * no move passes. A task is `tasks[text]`, or a line saying it is done.
 *
 * `run` is given the crew, with `crew.channel`, and the agents and workspaces by name.
 */
export const withChannel = (run, { moves = {}, tasks = {}, ...options } = {}) =>
  withTalk(async (crew) => {
    const ada = await crew.roster.create({ name: 'Ada', runtime: 'claude-code', role: 'Writes the docs.' })
    const bo = await crew.roster.create({ name: 'Bo', runtime: 'claude-code' })
    const cy = await crew.roster.create({ name: 'Cy', runtime: 'hermes' })
    const site = await crew.workspaces.create({ name: 'Site', description: 'The public website.' })
    const api = await crew.workspaces.create({ name: 'Api' })
    try {
      return await run(crew, { ada, bo, cy, site, api, moves, tasks })
    } finally {
      for (const agent of [ada, bo, cy]) await crew.conversations.stop(agent.id).catch(() => {})
      await crew.channel.settled()
    }
  }, {
    scripts: (input) => {
      if (!input.channel) return tasks[input.text] ?? said('Done.')
      const move = moves[input.agent.name] ?? 'PASS'
      return typeof move === 'string' ? said(move) : move
    },
    ...options,
  })

/** Everything about the channel and every agent has come to rest. */
export async function rest(crew, agents) {
  for (let round = 0; round < 3; round += 1) {
    await crew.channel.settled()
    for (const agent of agents) await crew.conversations.settled(agent.id)
  }
  await crew.channel.settled()
}

/** A post as a test compares it: each agent's name, what became of the post for it, and why. */
export const outline = (post) => post.to.map((one) => [one.name, one.state, one.reason, one.text])

/** The `post` events the hub has sent, oldest first. */
export const posted = (crew) => crew.sent.filter(([kind, payload]) => kind === 'event' && payload.type === 'post').map(([, payload]) => payload)

/** Wait until the post is as `test` wants it, and give it back. */
export async function until(crew, postId, test, ms = 5000) {
  const deadline = Date.now() + ms
  for (;;) {
    const post = await crew.channel.get(postId)
    if (test(post)) return post
    if (Date.now() > deadline) throw new Error(`the post never came to that: ${JSON.stringify(post)}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Wait for the post to be held by an agent whose task has begun. */
export const held = (crew, postId) => until(crew, postId, (post) => post.claim?.state === 'granted' && post.claim.conversationId)

/** Wait for an agent to have had its say on a post. */
export const answeredBy = (crew, postId, name) =>
  until(crew, postId, (post) => !['queued', 'answering'].includes(post.to.find((one) => one.name === name)?.state))
