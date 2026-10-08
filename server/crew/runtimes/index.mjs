import { CrewError } from '../errors.mjs'
import { createClaudeCodeRuntime } from './claude-code/index.mjs'
import { createScriptedRuntime } from './scripted.mjs'

/**
 * The runtimes this server can run an agent on, by id.
 *
 * An agent may be bound to a runtime that has no adapter here yet (the roster knows the
 * names Hermes and OpenClaw). Asking for one is refused in words, so the page can say
 * "not available on this server" and not just fail. The words never name the runtime.
 *
 * @param {{claudeCode?: object, scripted?: Record<string, object[]>}} [options]
 *   `claudeCode` is passed to the Claude Code adapter. `scripted`, when given, adds the
 *   scripted runtime playing those scripts: for tests and demonstrations only.
 */
export function createRuntimes({ claudeCode = {}, scripted } = {}) {
  const adapters = new Map([['claude-code', createClaudeCodeRuntime(claudeCode)]])
  if (scripted) adapters.set('scripted', createScriptedRuntime(scripted))

  return {
    /** @param {string} id */
    get(id) {
      const runtime = adapters.get(id)
      if (!runtime) {
        // In words that do not say what it runs on: the person is never told that.
        throw new CrewError('runtime_unavailable', 'This agent cannot be run on this server yet', 501)
      }
      return runtime
    },
    available: () => [...adapters.keys()],
  }
}
