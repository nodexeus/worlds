import { ENDINGS, checkTurnInput, turnController } from './contract.mjs'

/**
 * A runtime that plays a script. No model, no process, no cost: for testing everything built
 * on top of a runtime, and for showing the interface without one.
 *
 * `scripts` maps what the person says to the steps of the reply. A step is one of:
 *
 *   - an event (`text`, `tool`, `approval`, `question`, or an ending). `started` is not in
 *     the script: the runtime sends it itself, with the conversation's handle;
 *   - `{ wait: requestId, allow?: Step[], deny?: Step[] }`: stop until that request is
 *     answered, then play `deny` if an approval was refused and `allow` otherwise;
 *   - `{ pause: ms }`: take that long;
 *   - `{ crash: reason }`: fail as if the runtime had fallen over.
 *
 * A script that runs out without an ending finishes. A message with no script is echoed.
 *
 * `runtime.turns` holds every turn it was given, with the answers each received.
 *
 * @param {Record<string, object[]>} [scripts]
 */
export function createScriptedRuntime(scripts = {}) {
  let conversations = 0
  const turns = []

  function start(input) {
    checkTurnInput(input)
    const record = { ...input, answers: [] }
    delete record.onEvent
    turns.push(record)

    const turn = turnController(input.onEvent)
    const handle = input.handle ?? `scripted:${++conversations}`
    /** What the script is stopped on: a request's answer, or a pause. */
    let waiting = null

    const play = async (steps) => {
      for (const step of steps) {
        if (turn.ended) return
        if ('wait' in step) {
          const answer = await new Promise((resolve) => {
            waiting = { requestId: step.wait, resolve }
          })
          waiting = null
          if (turn.ended) return
          await play((answer.allow === false ? step.deny : step.allow) ?? [])
        } else if ('pause' in step) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, step.pause)
            waiting = { resolve: () => (clearTimeout(timer), resolve()) }
          })
          waiting = null
        } else if ('crash' in step) {
          turn.end({ type: 'failed', reason: step.crash, code: 'crashed' })
        } else if (ENDINGS.includes(step.type)) {
          turn.end(step)
        } else {
          turn.emit(step)
        }
      }
    }

    // Asynchronously, as a real runtime is: the caller has its turn in hand before any event.
    queueMicrotask(async () => {
      turn.emit({ type: 'started', handle })
      const steps = scripts[input.text] ?? [{ type: 'text', text: input.text }, { type: 'finished', text: input.text }]
      await play(steps)
      turn.end({ type: 'finished', text: '' })
    })

    return {
      answer(requestId, answer) {
        turn.settle(requestId, answer)
        record.answers.push({ requestId, answer })
        if (waiting?.requestId === requestId) waiting.resolve(answer)
      },
      interrupt() {
        if (turn.ended) return
        turn.end({ type: 'interrupted' })
        waiting?.resolve({})
      },
      done: turn.done,
    }
  }

  return {
    id: 'scripted',
    describe: () => ({ streaming: true, approvals: true, questions: true, resume: true }),
    start,
    turns,
  }
}
