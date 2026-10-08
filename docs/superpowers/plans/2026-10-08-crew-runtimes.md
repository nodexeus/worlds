# Crew Runtimes Implementation Plan

**Goal:** Let the server run an agent: one contract every runtime adapter implements, a scripted runtime for tests, and a Claude Code adapter that runs the real CLI headless.

**Architecture:** `server/crew/runtimes/` holds the contract, the scripted runtime and one adapter per real runtime. An adapter turns its runtime's own output into one normalised event stream, and nothing outside it sees session ids, flags or wire formats. This plan does not store anything: recording events and deriving agent status is phase 4.

**Tech Stack:** Node 22.13 or later, `node:test`, `node:child_process`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-crew-chat-design.md`, section "Runtime contract". This plan is phase 3 of its build order.

**Tracking:** NODEX-317 (contract and scripted runtime), NODEX-318 (Claude Code adapter). One branch, `nodex-317-crew-runtimes`, one pull request.

**How this plan differs from the foundation plan:** the owner asked for this phase to be planned and executed without a review stop, and it is executed by its author in the same session. So this document fixes the interfaces, the behaviour and the tests, and the code is written test-first against it rather than copied out of it.

## Global Constraints

- Every rule in the foundation plan's Global Constraints still holds: no em dashes, no authorship trailers, `.mjs`, two-space indent, no semicolons, single quotes.
- Nothing under `server/crew/runtimes/` imports `postgres` or anything in `server/crew/store/`.
- An adapter never throws out of an event callback path and never leaves a child process running after its turn has ended.
- A turn ends exactly once, with exactly one of `finished`, `failed` or `interrupted`, and no event follows it.
- Runtime-specific values (session ids, flags, tool input shapes) never appear outside the adapter, except as the opaque `handle` string the caller stores and passes back.
- Tests never call a real model. A live check exists and runs only when `WORLDS_LIVE_RUNTIME` names a runtime.

## Verified facts about Claude Code (CLI 2.1.293, checked 2026-10-08)

- `claude -p --input-format stream-json --output-format stream-json --verbose` reads one JSON object per line on stdin and writes one per line on stdout, and exits when stdin closes after the result.
- A user message is `{"type":"user","message":{"role":"user","content":"..."}}`.
- A new conversation takes `--session-id <uuid>`; a later turn takes `--resume <uuid>`. The id is echoed as `session_id` in `system/init`.
- Output lines seen: `system` (`init`, `hook_started`, `hook_response`, `status`, `thinking_tokens`, `commands_changed`, `permission_denied`), `stream_event` (with `--include-partial-messages`; wraps API events such as `content_block_delta` with `text_delta`), `assistant` (content blocks `text`, `thinking`, `tool_use`), `user` (content blocks `tool_result` with `tool_use_id`, `content`, `is_error`), `rate_limit_event`, `result` (`subtype`, `is_error`, `result`, `total_cost_usd`, `duration_ms`, `permission_denials`).
- With `--permission-prompt-tool stdio`, a tool that needs approval produces `{"type":"control_request","request_id":"...","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{...},"description":"..."}}`, and the turn waits for `{"type":"control_response","response":{"subtype":"success","request_id":"...","response":{"behavior":"allow","updatedInput":{...}}}}` or `{"behavior":"deny","message":"..."}`. `--permission-prompts host` alone does not produce these.
- `--permission-mode` accepts `manual`, `acceptEdits`, `bypassPermissions` among others. `--append-system-prompt` adds the agent's role.
- Not yet verified, and checked by the live test: how the built-in question tool (`AskUserQuestion`) arrives and is answered headless. The adapter treats a `can_use_tool` request for that tool as a question.

## The contract

```js
// A runtime
{
  id: 'claude-code',
  describe(): { streaming: boolean, approvals: boolean, questions: boolean, resume: boolean },
  start(turn: TurnInput): Turn,
}

// TurnInput
{
  agent: { id: string, name: string, role: string },
  folder: string,              // absolute workspace folder: the turn's working directory
  text: string,                // what the person said
  handle: string | null,       // null starts a conversation, a handle continues one
  autonomy: 'ask' | 'workspace' | 'autonomous',
  onEvent: (event: Event) => void,
}

// Turn
{
  answer(requestId: string, answer: Answer): void,   // throws CrewError('unknown_request') if not open
  interrupt(): void,                                  // idempotent
  done: Promise<{ handle: string | null, outcome: 'finished' | 'failed' | 'interrupted' }>,  // never rejects
}

// Answer
{ allow: true } | { allow: false, message?: string }   // to an approval
{ text: string }                                       // to a question
```

Events, each a plain object with `type`:

| Type | Fields | Meaning |
| --- | --- | --- |
| `started` | `handle` | The runtime accepted the turn. Always first. |
| `delta` | `text` | A fragment of text as it is written. Never stored; `text` follows with the whole block. |
| `text` | `text` | A complete piece of what the agent said. |
| `tool` | `id`, `name`, `summary`, `status` (`started`, `finished`, `failed`), `output?` | The agent used a tool. One `started`, then one `finished` or `failed`, same `id`. |
| `approval` | `requestId`, `tool`, `summary` | The agent wants to do something it may not do unasked. The turn waits. |
| `question` | `requestId`, `questions: [{ question, options: string[] }]` | The agent is asking the person. The turn waits. |
| `finished` | `text`, `costUsd?`, `durationMs?` | The turn ended normally. |
| `failed` | `reason`, `code` (`auth`, `inference`, `runtime`, `crashed`) | The turn ended badly, in words a person can act on. |
| `interrupted` | | The turn was stopped by `interrupt()`. |

Autonomy, as each adapter must honour it:

- `ask`: every action that changes anything raises an `approval`.
- `workspace`: actions inside `folder` proceed; anything else raises an `approval`.
- `autonomous`: no `approval` is ever raised. A `question` still is.

## File Structure

| File | Responsibility |
| --- | --- |
| `server/crew/runtimes/contract.mjs` | `AUTONOMY`, `EVENT_TYPES`, `checkEvent`, `checkTurnInput`, and `turnController`, the one place that enforces "first is started, ends exactly once, nothing after". |
| `server/crew/runtimes/scripted.mjs` | `createScriptedRuntime(scripts)`: replays steps, waits for answers, honours interrupt. |
| `server/crew/runtimes/claude-code/parse.mjs` | Pure: one output line plus parser state in, contract events and control actions out. |
| `server/crew/runtimes/claude-code/index.mjs` | Spawns the CLI, pipes lines through the parser, writes answers back, ends the process. |
| `server/crew/runtimes/index.mjs` | `createRuntimes(options)`: the adapters this server has, by id. |
| `test/support/runtime-contract.mjs` | `runtimeContract(name, setup)`: the suite every adapter must pass. |
| `test/support/fake-claude.mjs` | A stand-in `claude` executable that plays a named scenario in the real wire format. |
| `test/crew-runtime-contract.test.mjs` | Contract unit tests, then the suite against the scripted runtime and the Claude Code adapter. |
| `test/crew-claude-parse.test.mjs` | The parser against lines in the shapes recorded above. |
| `test/crew-live.test.mjs` | On-demand checks against a real runtime. |

## Tasks

### Task 1: The contract (NODEX-317)

`contract.mjs`, tested in `test/crew-runtime-contract.test.mjs`.

- `checkTurnInput(input)` returns the input or throws `CrewError('bad_turn', ..., 400)`: `agent.id` and `agent.name` strings, `folder` an absolute path, `text` a non-empty string of at most 100 000 characters, `handle` null or a non-empty string, `autonomy` one of the three, `onEvent` a function.
- `checkEvent(event)` returns the event or throws a plain `Error` naming the field: the type is known and each type's fields have the right shape.
- `turnController(onEvent)` returns `{ emit(event), end(event, handle), ask(requestId), settle(requestId), isOpen(requestId), ended, done }`:
  - the first event emitted must be `started`; anything else first is an adapter bug and is reported as `failed` with code `runtime`;
  - `end` accepts only an ending type, emits it once, resolves `done` with `{ handle, outcome }`; later `emit` and `end` calls do nothing;
  - an `onEvent` that throws does not break the turn: the error is logged and the turn continues;
  - `ask`/`settle`/`isOpen` track which requests are waiting, so `answer` can refuse an unknown or already answered one.

Tests: each rule above, including an event after the end being dropped, two `end` calls resolving once, a throwing `onEvent`, and every malformed event shape.

### Task 2: The scripted runtime and the shared suite (NODEX-317)

`scripted.mjs`, `test/support/runtime-contract.mjs`.

- `createScriptedRuntime(scripts)`: `scripts` maps a message text to a list of steps. A step is an event (without `started`, which the runtime emits itself with a handle), `{ wait: requestId }` (pause until that request is answered, then continue; the answer is recorded), `{ pause: ms }`, or `{ crash: reason }`. A text with no script answers `finished` with the text echoed.
- The handle is `scripted:<n>` for a new conversation and the same handle when one is passed in. `runtime.turns` records every `TurnInput` and every answer, for assertions.
- `runtimeContract(name, setup)` registers these tests, where `setup()` returns `{ runtime, say }` and `say` maps a scenario name to the text that triggers it:
  1. a plain turn: `started` first, `text`, `finished` last, `done` resolves `finished` with a handle;
  2. a second turn with that handle reports the same handle;
  3. a tool turn: `tool started` then `tool finished` with the same id;
  4. an approval allowed: `approval` arrives, the turn waits, `answer(allow)` lets it finish;
  5. an approval denied: the turn still finishes, and the tool is reported `failed`;
  6. a question answered: `question` arrives, `answer({ text })` lets it finish;
  7. answering an unknown request throws `unknown_request`; answering twice throws;
  8. interrupt mid-turn: ends `interrupted`, exactly one ending, nothing after;
  9. interrupt while waiting on an approval: ends `interrupted`;
  10. a runtime failure: ends `failed` with a reason and a code;
  11. interrupt after the end does nothing; `done` never rejects.

### Task 3: The Claude Code parser (NODEX-318)

`claude-code/parse.mjs`, tested in `test/crew-claude-parse.test.mjs` with lines in the recorded shapes.

- `createParser()` returns `{ feed(line): Action[] }`. An action is `{ event }` (a contract event) or `{ autoAllow: { requestId, input } }`.
- Mapping:
  - `system/init` gives `started` with `handle` = `session_id`, once;
  - `stream_event` with `content_block_delta`/`text_delta` gives `delta`;
  - `assistant` `text` blocks give `text`; `thinking` blocks give nothing; `tool_use` blocks give `tool started` with a one-line `summary` built from the tool name and its most telling input (`command`, `file_path`, `pattern`, `url`, `description`), cut to 160 characters;
  - `user` `tool_result` blocks give `tool finished` or `tool failed` for the matching id, with `output` cut to 2 000 characters;
  - `control_request/can_use_tool` gives `question` when the tool is `AskUserQuestion`, otherwise `approval`, and remembers the request's `input`;
  - `result` gives `finished` when `is_error` is false, otherwise `failed`. The code is `auth` when the text mentions login, credentials or 401; `inference` for rate limits, overload, credit or 5xx; otherwise `runtime`;
  - every other line, and any line that is not JSON, gives nothing.
- `answerLine(parser, requestId, answer)` builds the `control_response` line: allow passes back the remembered `input`; a question's `{ text }` is passed as the answer to each question in `updatedInput.answers`; deny carries the message.

Tests: one per mapping, plus a hook line, a non-JSON line, a tool result for an unknown id, two text blocks in one message, a 5 000 character tool output, and each failure code.

### Task 4: The Claude Code adapter (NODEX-318)

`claude-code/index.mjs`, `test/support/fake-claude.mjs`.

- `createClaudeCodeRuntime({ command = 'claude', env = process.env, extraArgs = [] })`.
- Arguments: `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio`, then `--session-id <new uuid>` or `--resume <handle>`, `--permission-mode` (`manual` for `ask`, `acceptEdits` for `workspace`, `bypassPermissions` for `autonomous`), and `--append-system-prompt` with the agent's name and role when there is one. `cwd` is `folder`.
- The user message is written to stdin at once. Stdin is closed after the result line.
- Under `autonomous`, an `approval` action is never emitted: it is answered `allow` at once. A `question` is always emitted.
- `interrupt()` ends the turn `interrupted` and sends SIGTERM, then SIGKILL after 2 seconds if the process is still there.
- The process exiting before a result ends the turn `failed` with code `crashed` and the last line of stderr. A command that cannot be started ends it `failed` with code `runtime` and a message naming the command.
- A handle that is not a UUID is refused as `bad_turn` before anything is spawned, because it becomes a command-line argument.
- `fake-claude.mjs` is a Node script, run through a small wrapper so it is executable, that reads its scenario from the first user message, checks its own arguments, writes the scenario's lines in the real wire format, waits for control responses where the scenario has one, and for the `hang` scenario never finishes.

Tests: the shared suite against the adapter with the stand-in; then adapter-only tests for the argument list per autonomy level, `--session-id` versus `--resume`, the role prompt, `cwd`, auto-allow under `autonomous`, a missing command, a crash mid-turn, a bad handle, and no process left behind after interrupt.

### Task 5: Registry, live check and documentation (NODEX-318)

- `runtimes/index.mjs`: `createRuntimes({ scripted? })` returns a `Map` by id holding `claude-code`, plus `scripted` when a script table is passed. `hermes` and `openclaw` are named in the roster but have no adapter yet, and asking for one throws `CrewError('runtime_unavailable', ..., 501)`.
- `test/crew-live.test.mjs`: skipped unless `WORLDS_LIVE_RUNTIME=claude-code`. One plain turn, one resumed turn that recalls a word from the first, one approval under `ask`, and one question, each in a temporary folder with the cheapest model passed through `extraArgs`. A script `test:crew:live` runs it.
- `docs/crew-backend.md` gains a "Runtimes" section: the contract, the events, how autonomy maps, how to run the live check.
- `server/harnesses/README.md`: its "Read-only. No exceptions." rule is scoped to the session scanners, with a pointer to the crew runtimes as the place agents are driven from.

## Review Focus

1. **A child process that outlives its turn.** After interrupt, crash or a thrown callback, no `claude` process may remain. Pinned in Task 4.
2. **Output that arrives in pieces.** A JSON line split across two stdout chunks, or two lines in one chunk, must parse as whole lines. Pinned in Task 4 through the stand-in writing in fragments.
3. **A handle or role used as an argument.** A handle beginning with a hyphen, or a role containing quotes and newlines, must not change the command that runs. Pinned in Task 4.
4. **An answer that arrives after the turn ended.** It must be refused, not written to a closed pipe. Pinned in Task 2's suite.
5. **A model that says nothing.** A result with empty text must still end the turn `finished`. Pinned in Task 3.
