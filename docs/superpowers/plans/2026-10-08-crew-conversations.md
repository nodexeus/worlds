# Crew Conversations Implementation Plan

**Goal:** Record what agents say and do, derive each agent's status from that record, and push it live to every connected client.

**Architecture:** Three new parts in `server/crew/`. The events store appends to one per-world, gap-free sequence. The conversations service is the only thing that talks to a runtime: it turns messages, answers and stops into turns, and turns a turn's events into stored events. The hub hands every stored event to connected clients, which read them over one server-sent event stream and catch up by sequence number.

**Tech Stack:** Node 22.13 or later, `node:test`, Postgres 18 through postgres.js. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-crew-chat-design.md`, sections "Data model", "Behaviour" (direct message, giving a task, stopping, autonomy) and "Failure handling". This plan is phase 4 of its build order.

**Tracking:** NODEX-319 (conversations, events, status), NODEX-320 (stream and API). One branch, `nodex-319-crew-conversations`, one pull request.

**How this plan is written:** as the phase 3 plan was. It fixes the interfaces, the behaviour and the tests, and the code is written test-first against it.

## Global Constraints

- The foundation plan's constraints hold: no em dashes, no authorship trailers, `.mjs`, two-space indent, no semicolons, single quotes.
- Every new row carries the world id.
- A stored event is never changed or deleted.
- Sequence numbers in a world are gap free and in commit order, and events are published in that order.
- An agent's status is only ever written as part of an event.
- Nothing outside `conversations.mjs` calls `runtime.start`.
- The monitor-only server still never loads `postgres`. `hub.mjs` and `stream.mjs` import nothing from `store/`.
- Tests use the scripted runtime. None calls a model.

## Decisions this plan makes

| Question | Decision |
| --- | --- |
| How is "in order" guaranteed? | One counter row per world, bumped in the same statement that inserts the event, and one in-process append queue per world. |
| What is stored? | `message`, `text`, `tool`, `question`, `approval`, `answer`, `queue`, `finished`, `failed`, `interrupted`. `started` only saves the handle. `delta` is pushed live and never stored. |
| Where does status live? | On each stored event, as the agent's status after it. An agent's status is the status of the last event in its open conversation, or `idle`. |
| Status values | `idle`, `working`, `waiting`, `failed`. A failed agent takes messages exactly as an idle one does. |
| A message with a workspace | Starts a new task conversation there and closes the agent's previous one. Refused with `agent_busy` while the agent is working or waiting. |
| A message without a workspace | Continues the open conversation. With none open it is refused with `needs_workspace`. |
| A message to a busy agent | Stored with `queued: true`. When the turn finishes, everything queued is delivered together as the next turn. When the turn fails or is stopped, it is cancelled and the chat can show that. |
| Two servers on one world | Not supported: commands for an agent are ordered in memory. The spec has one instance per customer. |
| Agents choosing a workspace themselves | Not in this phase. Every turn carries a standing briefing that names the workspace, lists the others and tells the agent to stop and ask when the work belongs elsewhere or is unclear. The move itself comes with the crew channel. |
| Restart mid-turn | Claude Code turns die with the server. At start every conversation left `working` or `waiting` gets an `interrupted` event. |

## Data

`002_conversations.sql`:

- `settings`: `world_id` primary key, `autonomy` (`ask`, `workspace`, `autonomous`; default `autonomous`), `updated_at`.
- `conversations`: `id`, `world_id`, `agent_id`, `workspace_id`, `kind` (`task` or `channel`), `title`, `handle`, `predecessor_id`, `created_at`, `closed_at`. Unique on `(world_id, agent_id)` where `kind = 'task'` and `closed_at is null`.
- `event_counters`: `world_id` primary key, `seq`.
- `events`: `world_id`, `seq`, `conversation_id`, `agent_id`, `type`, `status`, `data` (jsonb), `created_at`. Primary key `(world_id, seq)`, index on `(conversation_id, seq)`.

An event as the rest of the server and the page see it:

    { seq, conversationId, agentId, type, status, at, data }

## Interfaces

```js
// settings.mjs
createSettings({ sql, worldId }) -> { get(): { autonomy }, update({ autonomy }): { autonomy } }

// hub.mjs
createHub() -> { publish(event), transient(item), subscribe(listener): unsubscribe, size }
// listener(kind: 'event' | 'delta', payload)

// events.mjs
createEvents({ sql, worldId, hub }) -> {
  append({ conversationId, agentId, type, status, data }): event,   // serialised, published after commit
  after(seq, limit): event[],                                       // the world's events, ascending
  page(conversationId, { after?, before?, limit? }): event[],       // one conversation, ascending
  head(): number,
  idle(): Promise<void>,                                            // resolves when nothing is waiting to be written
}

// briefing.mjs
briefing({ agent, workspace, others }) -> string    // the role a runtime is given, at most 32 000 characters

// conversations.mjs
createConversations({ sql, worldId, roster, workspaces, settings, runtimes, events, hub }) -> {
  send(agentId, { text, workspaceId? }): { conversation, event, queued },
  answer(conversationId, { requestId, ...answer }): { event },
  stop(agentId): { stopped: boolean },
  statuses(): Map<agentId, { status, conversationId, workspaceId }>,
  list(agentId): conversation[],
  get(conversationId): conversation,
  dismiss(agentId): void,          // an agent being retired: stop it and close its conversation
  recover(): number,               // at start: how many conversations were marked interrupted
  close(): void,                   // stop every running turn and wait for the record to be written
}

// stream.mjs
serveEvents(req, res, url, { events, hub }, { heartbeatMs?, maxBufferedBytes?, maxClients? })
```

## API added under `/api/crew`

| Method and path | Purpose |
| --- | --- |
| `GET /events?after=N` | The stream. `Last-Event-ID` is honoured when `after` is absent. |
| `POST /agents/:id/messages` | `{ text, workspaceId? }`. Answers 202 with the conversation and the stored message. |
| `POST /agents/:id/stop` | Stop the running turn. |
| `GET /agents/:id/conversations` | That agent's conversations, newest first. |
| `GET /conversations/:id` | One conversation. |
| `GET /conversations/:id/events?after=&before=&limit=` | A page of its events. With neither bound, the latest. |
| `POST /conversations/:id/answers` | `{ requestId, allow?, message?, answers?, text? }`. |
| `GET /settings`, `PATCH /settings` | The world's autonomy level. |

`GET /agents` gains `status`, `conversationId` and `workspaceId` on each agent. `DELETE /agents/:id` also stops the agent.

Stream format: `event: hello` with `{ seq }` (the head when the client connected), then each stored event as `id: <seq>`, `event: event`, `data: <json>`, fragments as `event: delta` with no id, and a comment line as a heartbeat.

## Tasks

### Task 1: Schema, settings and the hub (NODEX-319)

`002_conversations.sql`, `settings.mjs`, `hub.mjs`. Tests in `test/crew-settings.test.mjs` and `test/crew-hub.test.mjs`.

- Settings: a world with no row reads as `autonomous`; an update is kept; an unknown level is refused as `bad_autonomy`; two worlds do not see each other's.
- Hub: a subscriber receives events and fragments in order; an unsubscribed one receives nothing; a subscriber that throws does not stop the others or the publisher.
- Schema: a second open task conversation for one agent is refused by the database.

### Task 2: The events store (NODEX-319)

`events.mjs`, tested in `test/crew-events.test.mjs`.

- Appends number from 1 with no gaps, per world.
- Fifty appends started together come out numbered 1 to 50 and are published in that order.
- A payload comes back exactly as it went in, including keys with underscores.
- `after` returns only later events, ascending, limited. `page` gives the latest by default, and pages either way.
- An append that fails rejects, and the next one still works and takes the next number.

### Task 3: The conversations service (NODEX-319)

`briefing.mjs`, `conversations.mjs`, tested in `test/crew-conversations.test.mjs` with the scripted runtime.

- A message with a workspace makes a conversation, stores the message, runs the turn in that workspace's folder with the agent's briefing and the world's autonomy, stores what the runtime says, and leaves the agent `idle`.
- A second message continues the same conversation with the handle the runtime gave.
- A message with no workspace and no open conversation is refused as `needs_workspace`. An unknown agent, an archived workspace, an empty or oversized text and a runtime with no adapter are each refused before anything is stored.
- A question makes the agent `waiting`; the answer is stored and passed on; a wrong or repeated answer is refused and nothing is stored.
- A message to a working agent is queued, delivered when the turn finishes, and cancelled when it fails or is stopped.
- A new task for a working agent is refused as `agent_busy`. For an idle agent it closes the old conversation and opens a new one.
- Stopping stores `interrupted` and leaves the agent `idle`. Stopping an idle agent does nothing.
- A failed turn leaves the agent `failed`, and the next message works.
- Fragments reach the hub and are never stored.
- `recover` marks conversations left working as interrupted, once.
- `dismiss` stops the agent and closes its conversation. `close` stops every turn and leaves nothing unwritten.

### Task 4: The stream and the routes (NODEX-320)

`stream.mjs`, `http.mjs`, `index.mjs`, tests in `test/crew-stream.test.mjs` and `test/crew-http.test.mjs`.

- The stream replays everything after `after`, then stays live, with no event twice and none missed when events are being written during the replay.
- `Last-Event-ID` works as `after`. A bad `after` is refused with 400.
- A client that stops reading is disconnected once its backlog passes the limit. More clients than the limit are refused with 503.
- Each route in the table above, including its refusals.
- The stream is not subject to the request deadline. A monitor-only server answers it 404 `crew_disabled`.

### Task 5: Wiring and documentation (NODEX-320)

- `createCrew` builds the settings, hub, events store, runtimes and conversations, runs `recover` at start, and `close` stops running turns before the pool closes. `createCrew(config, { runtimes })` lets a test supply its own.
- `docs/crew-backend.md`: conversations, statuses, queueing, the stream and the new routes. `docs/HANDOFF.md` map rows.
- An end-to-end test through `createCrew` and the real HTTP handler with a scripted runtime.

## Review Focus

1. **A turn that ends while a message is being queued.** The message must be delivered or cancelled, never left queued for ever. Pinned in Task 3.
2. **A client that connects while events are being written.** It must see each event once. Pinned in Task 4.
3. **The database failing mid-turn.** The turn must stop, the agent must not stay `working` for ever, and the next message must work. Pinned in Task 3.
4. **Two messages for one agent arriving together.** One starts the turn and the other is queued; there are never two turns. Pinned in Task 3.
5. **A listener or client that is slow or broken.** It must not hold up the record or other clients. Pinned in Tasks 1 and 4.
