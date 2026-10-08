import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { CrewError } from '../../errors.mjs'
import { ENDINGS, checkTurnInput, turnController } from '../contract.mjs'
import { createParser } from './parse.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How each level of autonomy is said to Claude Code. */
const PERMISSION_MODE = { ask: 'manual', workspace: 'acceptEdits', autonomous: 'bypassPermissions' }

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
 * @param {{command?: string, env?: NodeJS.ProcessEnv, extraArgs?: string[], killAfterMs?: number}} [options]
 *   `command` is the executable; `extraArgs` are appended to the adapter's own (a model, for
 *   instance); `killAfterMs` is how long a process is given to leave before it is made to.
 */
export function createClaudeCodeRuntime({ command = 'claude', env = process.env, extraArgs = [], killAfterMs = 2000 } = {}) {
  function start(input) {
    checkTurnInput(input)
    // The handle becomes a command-line argument. Only something that is a session id may.
    if (input.handle !== null && !UUID.test(input.handle)) {
      throw new CrewError('bad_turn', 'That is not a Claude Code conversation', 400)
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
      ...(input.handle ? ['--resume', session] : ['--session-id', session]),
      '--append-system-prompt', `You are ${input.agent.name}, a member of the crew.${role ? `\n\n${role}` : ''}`,
      ...extraArgs,
    ]

    const turn = turnController(input.onEvent)
    const parser = createParser()
    let child
    let gone = false
    let lastWords = ''

    const write = (line) => {
      if (gone || !child?.stdin?.writable) return
      child.stdin.write(line + '\n')
    }

    /** Close its input, give it a moment to leave, then make it. */
    const dismiss = (grace) => {
      if (gone || !child) return
      child.stdin?.end()
      const term = setTimeout(() => {
        if (gone) return
        child.kill('SIGTERM')
        setTimeout(() => !gone && child.kill('SIGKILL'), killAfterMs).unref()
      }, grace)
      term.unref()
    }

    const finish = (event, grace) => {
      if (turn.ended) return
      turn.end(event)
      dismiss(grace)
    }

    try {
      child = spawn(command, args, { cwd: input.folder, env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      queueMicrotask(() => finish({ type: 'failed', reason: `Claude Code could not be started (${command}): ${error.message}`, code: 'runtime' }, 0))
      return { answer: (requestId, answer) => void turn.settle(requestId, answer), interrupt() {}, done: turn.done }
    }

    child.on('error', (error) => {
      gone = true
      const why = error.code === 'ENOENT'
        ? `Claude Code could not be started: ${command} was not found, or the workspace folder is missing`
        : `Claude Code could not be started (${command}): ${error.message}`
      finish({ type: 'failed', reason: why, code: 'runtime' }, 0)
    })
    // A pipe to a process that has gone errors on write. The exit is what gets reported.
    child.stdin.on('error', () => {})
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      lastWords = (lastWords + chunk).slice(-4000)
    })

    createInterface({ input: child.stdout }).on('line', (line) => {
      for (const event of parser.feed(line)) {
        if (ENDINGS.includes(event.type)) {
          finish(event, killAfterMs)
        } else if (event.type === 'approval' && input.autonomy === 'autonomous') {
          // An autonomous agent is not stopped to be asked. Its questions still are.
          write(parser.answerLine(event.requestId, { allow: true }))
        } else {
          turn.emit(event)
        }
      }
    })

    child.on('close', (code, signal) => {
      gone = true
      if (turn.ended) return
      const said = lastWords.trim().split('\n').filter(Boolean).pop()
      const how = signal ? `signal ${signal}` : `exit code ${code}`
      turn.end({ type: 'failed', reason: said || `Claude Code stopped before finishing (${how})`, code: 'crashed' })
    })

    write(JSON.stringify({ type: 'user', message: { role: 'user', content: input.text } }))

    return {
      answer(requestId, answer) {
        turn.settle(requestId, answer)
        const line = parser.answerLine(requestId, answer)
        if (line) write(line)
      },
      interrupt() {
        finish({ type: 'interrupted' }, 0)
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
