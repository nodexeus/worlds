# Agent Card Implementation Plan

**Goal:** Converse with a crew member from inside the page: open its card, read what it says and does as it happens, answer it, stop it, and give it a task.

**Architecture:** A new page module, `src/crew/`, split in two. The first half is plain logic with no DOM: an API client, the live stream, the crew state, and the functions that turn a conversation's events into what a card shows. It is tested in Node. The second half draws: a crew list panel and floating agent cards, written as thin views over the first half and checked by driving the real page in Electron. The server gains three small things the page needs.

**Tech Stack:** Vite, plain DOM (as `src/ui/hud.js`), `EventSource`, `node:test`, Electron for the interface check. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-crew-chat-design.md`, sections "On screen: Agent card", "Behaviour: Direct message, Giving a task, Stopping" and "Failure handling". This plan is phase 5 of its build order. The mockup approved on 2026-10-08 is the visual reference.

**Tracking:** NODEX-323 (the page's crew logic and the server additions), NODEX-324 (the crew list and the card). One branch, `nodex-323-agent-card`, one pull request.

**How this plan is written:** as the phase 3 and 4 plans were. It fixes the interfaces, the behaviour and the tests, and the code is written test-first against it.

## Global Constraints

- The foundation plan's constraints hold: no em dashes, no authorship trailers, two-space indent, no semicolons, single quotes.
- Nothing an agent or a person wrote reaches the page as HTML. Text is set as text, and links are only ever `http:` or `https:`.
- The crew interface exists only when `GET /api/crew` says `enabled: true`. A monitor-only server, which is what the desktop app runs signed out, shows nothing new.
- The card for scanned sessions (`.thread-pop`) and its "open in" buttons are not changed.
- The crew views touch the DOM only when something they show has changed, as the rest of the HUD does. Nothing here runs in the render loop.
- Files in `src/crew/` that are tested in Node import nothing that needs a browser at load.
- The monitor-only server still never loads `postgres`.

## Decisions this plan makes

| Question | Decision |
| --- | --- |
| How is a card opened, with no roster robots yet? | From a crew list panel. The card floats where it is put. Attaching it to a robot is phase 7 and changes only how it opens and where it first appears. |
| Where is the crew list? | Top left, under the campus bar and beside the rail. It collapses to its heading, and remembers that. |
| How are curated agents shown? | In the same list, in a Specialists section under the standard agents, each with its speciality. A specialist the world is entitled to but has not added is a dimmed row with Add. Ones it is not entitled to are not shown. |
| What does pinning do, with no robot to follow? | A pinned card is remembered: it comes back open, where and as large as it was, after a reload. An unpinned one is forgotten when closed or reloaded. Phase 7 adds that an unpinned card follows its robot. |
| Continue, or a new task? | For a free agent the footer shows workspace chips. With none chosen, the message continues the open conversation. Choosing one makes the message a new task there. An agent with no open conversation must have one chosen, and one is chosen for it when the world has exactly one workspace. |
| A message to a busy agent | Sent with no workspace, so the server queues it. The chips are hidden. |
| How does the page stay current? | The stream gives every event. An agent's status is the status on the latest event for it. The agent list is read at start, after a reconnect, after the page's own changes, when the window regains focus and every 20 seconds, because the roster itself is not on the stream. |
| A snapshot older than the stream | `GET /agents` says which event it is current to. A status from the stream that is newer than that is kept. |
| Text while it streams | Fragments build a draft per conversation. The stored `text` event replaces it. |
| Markdown | A small subset, built as DOM nodes: paragraphs, fenced and inline code, bold, italic, headings, list items, links. Anything else is shown as written. |
| Trying it without a model | `WORLDS_DEMO_RUNTIME=1` makes every agent play a script. The status route says so and the crew list is labelled Demo. |
| The world's autonomy | A select at the foot of the crew list. It is the only way to see an approval, which an autonomous agent never raises. |
| Renaming and retiring | Not in this phase. They come with the roster panel in phase 7. |
| A phone | The crew list and cards fit the width and nothing more is done. The docked layout is phase 7's. |

## Server additions

- `GET /api/crew` adds `runtimes` (ids this server can run) and `demo` (boolean).
- `GET /api/crew/agents` adds `seq`: the head of the record, read before the statuses.
- `loadCrewConfig` reads `WORLDS_DEMO_RUNTIME` (`1` or `true`) as `demoRuntime`.
- `createScriptedRuntime(scripts)` also takes a function `(input) => steps | undefined`.
- `runtimes/demo.mjs`: `demoScript(input)`, and `createDemoRuntimes()` whose `get(id)` gives the one scripted runtime for every known runtime id and whose `available()` lists them all. `createCrew` uses it when `config.demoRuntime`.

The demonstration script, by what the message contains: `question` asks one; `approve` raises an approval then runs a tool; `fail` crashes; `long` works for a minute; anything else reads, edits and answers, in fragments, over a few seconds.

## Interfaces

```js
// src/crew/api.js
class CrewApiError extends Error { code, status }
createCrewApi({ fetch?, base? }) -> {
  status(), agents(), workspaces(), specialists(), settings(),
  createAgent({ name?, runtime, role? }), addSpecialist(templateId),
  createWorkspace({ name, description?, gitUrl? }), setAutonomy(autonomy),
  send(agentId, { text, workspaceId? }), stop(agentId), answer(conversationId, answer),
  conversations(agentId), events(conversationId, { before?, after?, limit? }),
}

// src/crew/stream.js
connectStream({ url?, after?, EventSource?, setTimeout?, onHello, onEvent, onDelta, onState })
  -> { close(), get seq() }
// onState('live' | 'retrying'). After a refusal or a closed source it retries, 1s doubling
// to 30s, asking for everything after the last event it was given.

// src/crew/transcript.js
transcript(events, { draft? }) -> item[]
// item.kind: 'message' { seq, text, state: 'sent' | 'queued' | 'cancelled' }
//            'text' { seq, text } | 'draft' { text }
//            'tool' { id, name, summary, state: 'running' | 'done' | 'failed' | 'stopped', output? }
//            'request' { seq, type: 'approval' | 'question', requestId, state: 'open' | 'answered' | 'lapsed',
//                        tool?, summary?, questions?, answer? }
//            'ending' { seq, type: 'finished' | 'failed' | 'interrupted', note, retry? }
openRequest(items) -> the earliest open request, or null
endingNote(event) -> string

// src/crew/markdown.js
parseMarkdown(text) -> block[]
// block: { type: 'p' | 'h' | 'li' | 'code', spans?: span[], text?, lang?, level?, marker? }
// span: { type: 'text' | 'code' | 'b' | 'i' | 'link', text, href? }

// src/crew/compose.js
composer({ agent, workspaces, picked, runtimes }) -> {
  mode: 'continue' | 'task' | 'queue' | 'choose' | 'no-workspace' | 'unavailable',
  chips: { id, name, current, on }[], placeholder, hint, canSend,
}
payload(mode, { text, picked }) -> { text, workspaceId? }
answerFor(request, choice) -> the body for POST .../answers

// src/crew/store.js
createCrewStore() -> {
  state,                         // { enabled, demo, runtimes, agents, workspaces, counts, specialists, autonomy, link }
  subscribe(listener) -> unsubscribe,
  setStatus(reply), setRoster({ agents, counts, seq }), setWorkspaces(list), setSpecialists(list), setAutonomy(a),
  setLink(state),
  applyEvent(event), applyDelta(delta),
  watch(conversationId), unwatch(conversationId), addEvents(conversationId, events),
  eventsOf(conversationId), draftOf(conversationId),
  agent(id), workspace(id), needsRoster(),   // true once an event names an agent or conversation it does not know
}

// src/crew/index.js
installCrew(hudEl, { toast }) -> Promise<{ store, open(agentId), close() } | null>   // null on a monitor-only server
```

## Tasks

### Task 1: Server additions (NODEX-323)

`config.mjs`, `runtimes/scripted.mjs`, `runtimes/demo.mjs`, `index.mjs`, `http.mjs`, `test/support/crew-talk.mjs`. Tests in `test/crew-config.test.mjs`, `test/crew-runtime-contract.test.mjs` or a new `test/crew-demo.test.mjs`, `test/crew-http.test.mjs`.

- The demonstration setting is read, and anything but `1` or `true` is off.
- A scripted runtime given a function plays what it returns, and echoes when it returns nothing.
- The demonstration runtimes answer for every runtime id, list them all, and pass the runtime contract tests.
- Each demonstration script ends, and the `question` and `approve` ones wait for their answer.
- The status route gives `runtimes` and `demo`. The agent list gives `seq`, and it is not behind the statuses it carries.

### Task 2: The API client and the stream (NODEX-323)

`src/crew/api.js`, `src/crew/stream.js`. Tests in `test/crew-ui-api.test.mjs`, `test/crew-ui-stream.test.mjs`, with a fake `fetch` and a fake `EventSource`.

- Each call asks the right address with the right method and body, and gives back the reply.
- A refusal throws `CrewApiError` with the server's code, wording and status. A reply that is not JSON, and a network failure, throw one too, coded `unreachable`.
- The stream reports hello, events and fragments, and tracks the last sequence number.
- A source that closes is replaced after a delay that doubles up to 30 seconds and resets once an event arrives. The new address asks for everything after the last event seen.
- An event numbered at or below the last one seen is dropped. A frame that is not JSON is dropped and the stream goes on.
- A hello whose head is behind the last event seen (a restored database) resets the count and reports it.
- `close` stops the source and any retry.

### Task 3: Transcript, markdown and the composer (NODEX-323)

`src/crew/transcript.js`, `src/crew/markdown.js`, `src/crew/compose.js`. Tests in `test/crew-ui-transcript.test.mjs`, `test/crew-ui-markdown.test.mjs`, `test/crew-ui-compose.test.mjs`.

- Transcript: a message; a queued message becomes sent on `queue: delivered` and cancelled on `queue: cancelled`; a tool's events fold into one item by id, in the place it started; a tool left running when the turn ended is `stopped`; a request is open until its `answer`, and `lapsed` if the turn ended first; an answered request carries what was answered; each ending has its note (duration and cost when given, the reason for a failure, "stopped", "interrupted by a server restart"); the last failed ending offers a retry with the last message's text; a draft is the last item; events given out of order or twice come out the same.
- Markdown: each block and span type; an unclosed fence takes the rest; `javascript:` and other schemes are not links; markup characters in text survive as text; a 200 000 character input returns promptly.
- Composer: each mode for each of idle with a conversation, idle without, failed, working, waiting, no workspaces, one workspace, a runtime this server cannot run; `payload` adds the workspace only for a task; `answerFor` an approval, a single question by option and by text, and a request with several questions.

### Task 4: The crew store (NODEX-323)

`src/crew/store.js`, tested in `test/crew-ui-store.test.mjs`.

- A roster snapshot sets agents, counts and statuses. Listeners are told once per change and not at all when nothing changed.
- An event sets its agent's status and conversation. An older event does not undo a newer one.
- A snapshot behind an agent's latest event keeps the event's status. One level with or ahead of it wins.
- An event for an unknown agent, or a conversation the agent was not in, sets `needsRoster`.
- Events of a watched conversation are kept in order with none twice. Events of an unwatched one are not kept.
- A fragment extends its conversation's draft. A `text` event or an ending clears it.
- A listener that throws does not stop the others.

### Task 5: The crew list (NODEX-324)

`src/crew/panel.js`, `src/crew/crew.css`, `src/crew/index.js`, one line in `src/main.js`.

- The list, its counts, the Specialists section, the Demo label, the link state when the stream is retrying.
- "+ Agent": name (blank for a random one), role, and runtime when the server can run more than one. "+ Workspace": name, description, git address. A refusal is shown in the form in the server's words, and what was typed is kept.
- The autonomy select.
- Collapsed state remembered.

### Task 6: The agent card (NODEX-324)

`src/crew/card.js`, `src/crew/render.js` (items to DOM), `src/crew/cards.js` (the open cards: position, size, order, pins).

- Everything under "Agent card" in the issue.
- The body stays at the bottom while it was at the bottom, and stays put while the person has scrolled up.
- "Earlier" at the top loads the page before the first event shown.
- Keys typed in a card never reach the world's shortcuts. Enter sends, Shift+Enter is a new line, Escape closes the card.

### Task 7: The interface check, documentation (NODEX-324)

- `test/crew-ui-smoke.mjs`, run by `npm run test:crew:ui` under Electron: start the real server in demonstration mode on a schema and a data directory of its own, load the page, and drive it as the issue's acceptance says, asserting on the DOM and saving screenshots.
- `docs/crew-backend.md`: the demonstration mode, the new reply fields. `docs/HANDOFF.md`: the map rows for `src/crew/`. `server/harnesses/README.md` if it still says the app is read-only towards agents.

## Review Focus

1. **Text from an agent that is markup.** `<img onerror>`, a `javascript:` link, a code fence never closed. It must appear as text and run nothing. Pinned in Task 3 and checked in Task 7.
2. **The stream dropping mid-turn.** After it returns the card must show every event once, and the status must be right. Pinned in Tasks 2 and 4.
3. **Two things at once on one card.** Sending twice quickly, answering a request twice, stopping while a send is in flight. One request each, and a refusal shown, never a stuck button. Pinned in Task 7.
4. **A card left open while its agent changes under it.** Given a new task from another client, retired, or its workspace archived. The card must follow or say so. Pinned in Task 4, checked in Task 7.
5. **A long conversation.** Thousands of events, a 20 000 character message, a tool with a megabyte of output. The card must open, scroll and stay responsive. Pinned in Task 3 by size limits on what is drawn.
