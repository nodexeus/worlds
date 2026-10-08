import { RUNTIMES } from '../names.mjs'
import { createScriptedRuntime } from './scripted.mjs'

let requests = 0

/** A sentence a few characters at a time, as a model sends one. */
const fragments = (text, pause) => {
  const steps = []
  for (const piece of text.match(/\S+\s*/g) ?? []) steps.push({ type: 'delta', text: piece }, { pause })
  return steps
}

/** Say something the way a runtime does: in fragments, then whole. */
const say = (text, pause) => [...fragments(text, pause), { type: 'text', text }]

const tool = (id, name, summary, pause, output) => [
  { type: 'tool', id, name, summary, status: 'started' },
  { pause },
  { type: 'tool', id, name, summary, status: 'finished', ...(output ? { output } : {}) },
]

/**
 * What an agent does in a demonstration: no model, no process, nothing touched. The message
 * decides which of a few shapes the reply takes, so each part of the interface can be seen:
 *
 *   - `question`: the agent asks one, and goes on once it is answered;
 *   - `approve`: it asks before running a command (unless the world lets it run unasked);
 *   - `fail`: the runtime falls over;
 *   - `long`: it works for a minute, to be stopped or to have messages queued behind it;
 *   - anything else: it reads, edits and answers.
 *
 * A post to the crew channel is answered in the channel's own three ways: one that ends in
 * a question mark gets a contribution, one that says `pass` is passed, and anything else is
 * claimed, in the world's first workspace, by every agent given it, so that only one of them
 * getting it can be seen.
 *
 * @param {{text: string, agent: {name: string}, channel?: {workspaces: string[]}}} input
 * @param {{pace?: number}} [options] `pace` scales the pauses. 0 for a test.
 */
export function demoScript({ text, agent, channel }, { pace = 1 } = {}) {
  const beat = 60 * pace
  const work = 700 * pace
  const said = text.trim().split('\n')[0].slice(0, 120)
  const lower = text.toLowerCase()

  if (channel) {
    // Not all at the same instant, as real agents would not be.
    const think = { pause: work * (1 + Math.random()) }
    const answer = (reply) => [think, { type: 'text', text: reply }, { type: 'finished', text: reply, durationMs: work, costUsd: 0 }]
    if (/\bpass\b/.test(lower)) return answer('PASS')
    if (text.trim().endsWith('?')) return answer(`${agent.name} here. I have not looked closely, but I would start with the README. (A demonstration: no model was asked.)`)
    const [place] = channel.workspaces ?? []
    if (!place) return answer('I would take this, but there is no workspace to do it in yet.')
    return answer(`CLAIM: ${place}\nI will take this one.`)
  }

  if (/\bfail/.test(lower)) {
    return [{ type: 'text', text: 'Starting on that.' }, { pause: work }, { crash: 'The demonstration was asked to fail' }]
  }

  if (/\blong\b/.test(lower)) {
    const steps = [{ type: 'text', text: 'This one will take me about a minute.' }]
    for (let minute = 1; minute <= 12; minute += 1) {
      steps.push(...tool(`long-${minute}`, 'Bash', `Bash: step ${minute} of 12`, 5000 * pace))
    }
    return [...steps, ...say('That is all twelve steps done.', beat), { type: 'finished', text: 'That is all twelve steps done.', durationMs: 60_000 * pace }]
  }

  if (/\bquestion\b/.test(lower)) {
    const requestId = `demo-${++requests}`
    const options = ['The README', 'The tests']
    return [
      { type: 'text', text: 'Before I start, one thing.' },
      { type: 'question', requestId, questions: [{ question: 'Which should I begin with?', options }] },
      {
        wait: requestId,
        allow: (answer) => {
          const chosen = answer.answers?.[0] ?? answer.text ?? options[0]
          const reply = `Then I will begin with: ${chosen}`
          return [...say(reply, beat), { type: 'finished', text: reply, durationMs: 2000 * pace }]
        },
      },
    ]
  }

  if (/\bapprove/.test(lower)) {
    const requestId = `demo-${++requests}`
    const command = 'rm -rf build/ dist/'
    return [
      { type: 'approval', requestId, tool: 'Bash', summary: command },
      {
        wait: requestId,
        allow: [
          ...tool(`${requestId}-run`, 'Bash', `Bash: ${command}`, work),
          ...say('The old build output is gone.', beat),
          { type: 'finished', text: 'The old build output is gone.', durationMs: work + 500 * pace },
        ],
        deny: [...say('Understood. I have left it as it was.', beat), { type: 'finished', text: 'Understood. I have left it as it was.' }],
      },
    ]
  }

  const reply =
    `Here is what I did for "${said}".\n\n` +
    '- Read `README.md` to see what was there.\n' +
    '- Rewrote the introduction and added an **Install** section.\n\n' +
    'This is a demonstration: nothing was really changed, and no model was called.'
  return [
    { type: 'text', text: 'I will look at what is there first.' },
    { pause: work },
    ...tool('read', 'Read', 'Read: README.md', work, '# Project\n\nA short description.'),
    ...tool('edit', 'Edit', 'Edit: README.md', work),
    ...say(reply, beat),
    { type: 'finished', text: reply, durationMs: 3 * work + 30 * beat, costUsd: 0 },
  ]
}

/**
 * The runtimes of a server that is only demonstrating. Whatever an agent is bound to, the one
 * scripted runtime plays it, so a specialist made for Hermes can be shown on a server that
 * has no Hermes.
 */
export function createDemoRuntimes() {
  const scripted = createScriptedRuntime(demoScript)
  return {
    get: () => scripted,
    available: () => [...RUNTIMES],
  }
}
