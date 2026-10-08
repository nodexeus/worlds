import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { CrewError } from '../../errors.mjs'
import { ENDINGS, checkTurnInput, failure, turnController } from '../contract.mjs'
import { createParser as realParser, failureCode, oneLine } from './parse.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How each level of autonomy is said to Claude Code. */
const PERMISSION_MODE = { ask: 'manual', workspace: 'acceptEdits', autonomous: 'bypassPermissions' }

/**
 * What an agent must not be handed from the server's own environment: where the server
 * keeps its data, and the credentials to it. An agent runs commands. Anything in its
 * environment it can print.
 */
const SERVER_ONLY = /^WORLDS_|^DATABASE_URL$|^PG[A-Z]+$/

/**
 * Every agent process running now, so that none outlives the server. Each is the leader of
 * a process group of its own, which is what lets a tool the agent started be stopped with it.
 *
 * @type {Set<import('node:child_process').ChildProcess>}
 */
const running = new Set()

/** Signal an agent and everything it started. A group that has already gone is not an error. */
function signal(child, name) {
  if (!child.pid) return
  try {
    process.kill(-child.pid, name)
  } catch {
    try {
      child.kill(name)
    } catch {
      // Already gone.
    }
  }
}

// The last thing the server does. `exit` handlers cannot wait, so this is not a request.
process.on('exit', () => {
  for (const child of running) signal(child, 'SIGKILL')
})

/**
 * Claude Code as a crew runtime: the server runs the CLI headless, one process per turn, in
 * the workspace folder.
 *
 * A conversation is a Claude Code session. Its id is the handle: chosen here for a new
 * conversation (`--session-id`) and passed back for a later turn (`--resume`).
 *
 * The person's message goes in on stdin and events come out on stdout, a JSON object per
 * line each way. When the agent needs permission, or asks a question, the CLI says so on
 * stdout and waits for the answer on stdin (`--permission-prompt-tool stdio`).
 *
 * Nothing is run through a shell, so a role or a message is one argument or one line
 * whatever it contains.
 *
 * By default an agent is kept apart from whoever the server runs as: it is not given the
 * server's own settings, and it does not load that user's Claude Code hooks, plugins or
 * connected services (`--setting-sources local --strict-mcp-config`). It still uses that
 * user's sign-in.
 *
 * @param {object} [options]
 * @param {string} [options.command] the executable
 * @param {NodeJS.ProcessEnv} [options.env] the agent's environment, less the server's own settings
 * @param {string[]} [options.extraArgs] appended to the adapter's own: a model, for instance
 * @param {boolean} [options.isolated] false lets the server user's Claude Code setup in
 * @param {number} [options.killAfterMs] how long a process is given to leave before it is made to
 * @param {number} [options.stallAfterMs] how long an agent may say nothing before it is given up on
 * @param {number} [options.maxLineBytes] the longest single line of output that is read
 * @param {() => ReturnType<typeof realParser>} [options.createParser] for tests
 */
export function createClaudeCodeRuntime({
  command = 'claude',
  env = process.env,
  extraArgs = [],
  isolated = true,
  killAfterMs = 2000,
  stallAfterMs = 30 * 60_000,
  maxLineBytes = 16 * 1024 * 1024,
  createParser = realParser,
} = {}) {
  const agentEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !SERVER_ONLY.test(key)))

  function start(input) {
    checkTurnInput(input)
    // The handle becomes a command-line argument. Only something that is a session id may.
    if (input.handle !== null && !UUID.test(input.handle)) {
      throw new CrewError('bad_turn', 'That is not a conversation this agent can continue', 400)
    }
    const session = input.handle ?? randomUUID()
    const role = input.agent.role?.trim()
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool', 'stdio',
      '--permission-mode', PERMISSION_MODE[input.autonomy],
      ...(isolated ? ['--setting-sources', 'local', '--strict-mcp-config'] : []),
      ...(input.handle ? ['--resume', session] : ['--session-id', session]),
      '--append-system-prompt', `You are ${input.agent.name}, a member of the crew.${role ? `\n\n${role}` : ''}`,
      ...extraArgs,
    ]

    const turn = turnController(input.onEvent)
    const parser = createParser()
    let child = null
    let gone = false
    let lastWords = ''
    let stall = null

    const write = (line) => {
      if (gone || !line || !child?.stdin?.writable) return
      child.stdin.write(line + '\n')
    }

    /** Close its input, give it a moment to leave, then make it, and whatever it started. */
    const dismiss = (grace) => {
      clearTimeout(stall)
      if (gone || !child) return
      child.stdin?.end()
      setTimeout(() => {
        if (gone) return
        signal(child, 'SIGTERM')
        setTimeout(() => signal(child, 'SIGKILL'), killAfterMs).unref()
      }, grace).unref()
    }

    // However the turn ends, and whoever ends it, the process goes with it. The turn can be
    // ended from outside this file (the controller fails a turn whose adapter misbehaves),
    // so this hangs on the turn itself and not on the places here that end it.
    turn.done.then(({ outcome }) => dismiss(outcome === 'finished' ? killAfterMs : 0))

    /** Given up on if it says nothing for too long, unless it is the person it is waiting for. */
    const heard = () => {
      clearTimeout(stall)
      if (turn.ended) return
      stall = setTimeout(() => {
        if (turn.waiting) return heard()
        const waited = `nothing from it in ${Math.round(stallAfterMs / 1000)} seconds`
        turn.end(failure('runtime', `Claude Code stopped responding: ${waited}`, `This agent stopped responding: ${waited}`))
      }, stallAfterMs)
      stall.unref()
    }

    const read = (line) => {
      if (turn.ended) return
      heard()
      const events = parser.feed(line)
      for (const reply of parser.takeReplies()) write(reply)
      for (const event of events) {
        if (turn.ended) return
        if (ENDINGS.includes(event.type)) {
          turn.end(event)
        } else if (event.type === 'approval' && input.autonomy === 'autonomous') {
          // An autonomous agent is not stopped to be asked. Its questions still are.
          write(parser.answerLine(event.requestId, { allow: true }))
        } else {
          turn.emit(event)
        }
      }
    }

    const failedToStart = (error) => failure(
      'runtime',
      error.code === 'ENOENT'
        ? `Claude Code could not be started: ${command} was not found, or the workspace folder is missing`
        : `Claude Code could not be started (${command}): ${error.message}`,
      'This agent could not be started on this server')

    try {
      // `detached` makes it the leader of its own process group. It is still this server's
      // child: nothing is unref'd, and the group is what gets signalled.
      child = spawn(command, args, { cwd: input.folder, env: agentEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    } catch (error) {
      queueMicrotask(() => turn.end(failedToStart(error)))
      return { answer: (requestId, answer) => void turn.settle(requestId, answer), interrupt() {}, done: turn.done }
    }
    running.add(child)

    /** The process is no more: say so, once, if the turn had not already ended. */
    const over = (code, sig) => {
      if (gone) return
      gone = true
      running.delete(child)
      clearTimeout(stall)
      // Anything it started and left behind goes too.
      signal(child, 'SIGKILL')
      if (turn.ended) return
      const said = lastWords.trim().split('\n').filter(Boolean).pop()
      const how = sig ? `signal ${sig}` : `exit code ${code}`
      const detail = said || `Claude Code stopped before finishing (${how})`
      const kind = failureCode(detail)
      turn.end(failure(kind === 'runtime' ? 'crashed' : kind, detail))
    }

    child.on('error', (error) => {
      // Only a failure to start means there is no process. Any other error leaves one.
      if (child.pid !== undefined) return
      gone = true
      running.delete(child)
      turn.end(failedToStart(error))
    })
    // A pipe to a process that has gone errors on write. The exit is what gets reported.
    child.stdin.on('error', () => {})
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      lastWords = (lastWords + chunk).slice(-4000)
    })

    // Lines are split here, on a newline and nothing else. Node's readline also breaks at
    // U+2028 and U+2029, which are legal inside a JSON string and would cut a line in two.
    const decoder = new StringDecoder('utf8')
    let pending = ''
    const take = (chunk) => {
      pending += chunk
      let at
      while ((at = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        read(line)
      }
      if (pending.length > maxLineBytes) {
        pending = ''
        turn.end(failure('runtime', 'Claude Code sent too much output without ending a line', 'This agent sent more than could be read'))
      }
    }
    child.stdout.on('data', (chunk) => take(decoder.write(chunk)))
    child.stdout.on('end', () => {
      take(decoder.end())
      if (pending) read(pending)
      pending = ''
    })

    // `close` waits for the output pipes, which a process the agent started can hold open
    // long after the agent has died. So an exit is reported shortly after it happens, with
    // just enough of a pause for the last of its own output to be read.
    child.on('exit', (code, sig) => setTimeout(() => over(code, sig), 300).unref())
    child.on('close', (code, sig) => over(code, sig))

    write(oneLine({ type: 'user', message: { role: 'user', content: input.text } }))
    heard()

    return {
      answer(requestId, answer) {
        turn.settle(requestId, answer)
        write(parser.answerLine(requestId, answer))
        heard()
      },
      interrupt() {
        turn.end({ type: 'interrupted' })
      },
      done: turn.done,
    }
  }

  return {
    id: 'claude-code',
    describe: () => ({ streaming: true, approvals: true, questions: true, resume: true }),
    start,
  }
}
