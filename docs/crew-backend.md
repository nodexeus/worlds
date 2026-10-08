# The crew backend

The crew backend gives a world a roster of durable agents and a set of workspaces. It is the
foundation for conversing with agents inside Worlds (design:
`docs/superpowers/specs/2026-10-07-crew-chat-design.md`).

It is switched on by configuration. With no database configured the server is the read-only
monitor it has always been, which is how the desktop app runs it.

## What it keeps, and where

Two places hold everything that has to survive a restart or an update:

| Setting | Holds |
| --- | --- |
| `WORLDS_DATABASE_URL` | A Postgres 18 database: agents, workspaces, conversations and their events, settings. |
| `WORLDS_DATA_DIR` | A directory: one folder per workspace under `workspaces/`. |

Mount a persistent volume on the data directory and point the URL at a database that is
backed up. The container image holds nothing of value and can be replaced freely.

At start the server writes a file to the data directory and connects to the database. If
either fails it exits with a message naming the setting, and does not open its port.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORLDS_DATABASE_URL` | unset | `postgres://` address. Unset means monitor only. |
| `WORLDS_DATA_DIR` | none | Required when the database is set. |
| `WORLDS_DATABASE_SCHEMA` | unset | Put the tables in this schema, created if missing. |
| `WORLDS_WORLD_ID` | `default` | The world this server serves. Every row carries it. |
| `WORLDS_AGENT_LIMIT` | `6` | How many standard agents the world may have. |
| `WORLDS_CURATED_AGENTS` | empty | Comma-separated ids of the specialists the world may add. |
| `WORLDS_ALLOWED_HOSTS` | empty | Comma-separated host names that may reach the API. |

The agent limit and the specialist list are how a subscription tier reaches the server. This
backend only reads them.

## Agents

- A **standard agent** is the customer's to name and instruct. A new one is given a friendly
  name from `server/crew/names.mjs`, which can be changed. It counts against the limit.
- A **curated agent** is made from a template in `server/crew/templates/`. Its name and
  instructions are the template's and cannot be changed, a world has at most one of each,
  and it does not count against the limit. Template names are reserved in every world.
- A curated agent is retired at the next start if the world is no longer entitled to it, or
  the server no longer has its template.
- Names are one word, unique in a world whatever their case or accents.
- Agents are retired, never deleted. Retiring gives back the place and the name.

## Workspaces

A workspace is a name, a description and a folder named by the workspace's id. It can be
seeded from an `https://` or `ssh://` git address. Archiving removes it from the world and
keeps its files.

A workspace appears only once its folder is complete: a source is cloned into a folder
named `.incoming-<id>` and moved into place before the workspace is recorded. Anything a
creation cut short leaves behind is removed at the next start.

An `ssh://` source needs a key and a `known_hosts` entry for the user the server runs as.
The image ships the ssh client and nothing else: mount those yourself. A private `https://`
source needs credentials in the address, which are then stored with the workspace and
visible to anyone who can see it, so prefer a read-only deploy token.

## Runtimes

A runtime is what actually runs an agent. Each has an adapter in `server/crew/runtimes/`
that turns its own output into one stream of events, so nothing else in the server knows a
session id or a command-line flag.

    const turn = runtimes.get(agent.runtime).start({ agent, folder, text, handle, autonomy, onEvent })
    turn.answer(requestId, { allow: true })     // or { allow: false, message }
    turn.answer(requestId, { answers: ['Blue', 'Tomorrow'] })   // one per question; { text } for one
    turn.interrupt()
    await turn.done                             // { handle, outcome }, never rejects

`handle` is null to start a conversation. The `started` event gives the handle to pass back
for the next turn of the same one.

| Event | Meaning |
| --- | --- |
| `started` | The runtime accepted the turn. Carries the handle. |
| `delta` | A fragment of text as it is written. `text` follows with the whole piece. |
| `text` | Something the agent said. |
| `tool` | A tool call: `started`, then `finished` or `failed`, under one id. |
| `approval` | The agent wants to do something it may not do unasked. The turn waits. |
| `question` | The agent is asking the person. The turn waits. |
| `finished` | The turn ended normally. |
| `failed` | The turn ended badly. `code` is `auth`, `inference`, `runtime` or `crashed`. |
| `interrupted` | The turn was stopped. |

A turn ends exactly once and says nothing afterwards.

Autonomy is passed with each turn:

| Level | Meaning | Claude Code |
| --- | --- | --- |
| `ask` | Every action that changes something is an approval. | `--permission-mode manual` |
| `workspace` | File edits inside the workspace go ahead. Commands, and anything outside it, are an approval. | `--permission-mode acceptEdits` |
| `autonomous` | Never stopped for approval. Still asks real questions. | `--permission-mode bypassPermissions` |

Adapters today:

- **`claude-code`**: runs the `claude` CLI headless, one process per turn, in the workspace
  folder. It signs in as whoever the server runs as, and is otherwise kept apart from them:
  - it is not given the server's own settings (`WORLDS_*`, `DATABASE_URL`, `PG*`);
  - it does not load that user's Claude Code hooks, plugins or connected services
    (`--setting-sources local --strict-mcp-config`);
  - it does still read a `.claude/settings.local.json` inside the workspace, so a
    repository cloned into a workspace can carry settings of its own. Treat a workspace's
    source as trusted code.

  Each agent runs in a process group of its own. Stopping an agent, or the server, stops
  the agent and anything it started. An agent that says nothing for 30 minutes, while not
  waiting on a person, is given up on.
- **`scripted`**: plays fixed scripts. For tests and demonstrations; present only when the
  server is given scripts.

`hermes` and `openclaw` can be named on an agent but have no adapter yet, and starting a
turn on one is refused with `runtime_unavailable`.

Every adapter must pass the shared suite in `test/support/runtime-contract.mjs`. The suite
never calls a model. To check an adapter against the real thing, which does:

    npm run test:crew:live

## Conversations

A conversation is one agent working in one workspace. Only `server/crew/conversations.mjs`
talks to a runtime: it turns a person's message into a turn, and everything the runtime
says back into stored events.

- **A message with a workspace** is a new task: a new conversation there, and the agent's
  previous one is closed. It is refused with `agent_busy` while the agent is in a turn.
- **A message without one** continues the agent's open conversation. With none open it is
  refused with `needs_workspace`.
- **A message to an agent in a turn** is stored as queued. When the turn finishes,
  everything queued is delivered together as the next turn. When the turn fails or is
  stopped, it is cancelled, and a `queue` event says which.
- **An agent has one open task conversation at most.** The database enforces it.
- **Every turn carries a briefing** on top of the agent's role: the workspace it is in, the
  other workspaces, and the standing rules (work in this folder, stop and say so if the
  task belongs elsewhere, ask when unclear, never create a workspace).
- **Autonomy** is one setting for the world, read at the start of each turn. The default is
  `autonomous`.

### Events

Each stored event is `{ seq, conversationId, agentId, type, status, at, data }`. Events are
never changed or deleted.

| Type | `data` |
| --- | --- |
| `message` | `text`, and `queued: true` if the agent was busy. |
| `text` | `text`: something the agent said. |
| `tool` | `id`, `name`, `summary`, `status`, `output?`. |
| `question` | `requestId`, `questions`. |
| `approval` | `requestId`, `tool`, `summary`. |
| `answer` | `requestId`, and the answer as given. |
| `queue` | `of` (the sequence numbers of queued messages), `outcome`: `delivered` or `cancelled`. |
| `finished` | `text`, `costUsd?`, `durationMs?`. |
| `failed` | `reason`, `code`. |
| `interrupted` | `reason?`: `restart` when a stopped server left the turn behind, `lost` when its ending could not be recorded. |

A runtime's `started` event only saves the handle, and `delta` fragments are passed on live
and never stored.

`seq` numbers a world's events from 1, with no gaps, in the order they became visible. That
is what lets a client ask for "everything after 41" and get exactly what it missed.

### Status

`status` on an event is the agent's status once that event had happened: `idle`, `working`,
`waiting` (a question or approval is open) or `failed`. An agent's status is the status of
the last event in its open conversation, or `idle` with none. Nothing else sets it. A failed
agent takes a message exactly as an idle one does.

### When things go wrong

| What | Result |
| --- | --- |
| The runtime fails or cannot be started | A `failed` event with the reason. The next message works. |
| The database is briefly away mid-turn | Each write is tried three times. Nothing is lost. |
| The database stays away | The turn is stopped. Its ending is recorded as `failed` if that can be written, and otherwise put right as `interrupted` (`lost`) the next time anything is asked of the agent. |
| Stop is asked for as a turn finishes | Whatever was queued is cancelled, not delivered. |
| The server stops | Agents are stopped and the record completed, within three seconds. Anything left is marked `interrupted` (`restart`) at the next start. |

One server runs a world. An agent's messages, answers and runtime events are put in order
in that server's memory, so two servers on one world's database are not supported.

## The live stream

`GET /api/crew/events` is one long reply of server-sent events for the whole world:

    event: hello
    data: {"seq":41}

    id: 42
    event: event
    data: {"seq":42,"conversationId":"...","agentId":"...","type":"text","status":"working","at":"...","data":{"text":"Done."}}

    event: delta
    data: {"conversationId":"...","agentId":"...","text":"Do"}

- `hello` gives the number of the world's latest event at the moment of connecting.
- `?after=<seq>`, or the `Last-Event-ID` header a browser sends when it reconnects, replays
  everything after that number and then stays live. When both are given the later one is
  used. With neither, the stream starts from now.
- A client whose number is ahead of `hello` (the database was restored) should start again.
- A comment line is sent every 15 seconds to keep the connection open.
- Catching up is sent at the client's own pace. Once live, a client more than 4 MB behind
  is disconnected and catches up when it reconnects. At most
  100 clients are served at once; one more is refused with 503 `too_many_clients`.
- A proxy in front of the server must not buffer this reply.

## API

All under `/api/crew`, JSON in and out. A refusal answers `{ error, code }` with a 4xx
status. `GET /api/crew` answers `{ enabled: false }` on a monitor-only server.

| Method and path | Purpose |
| --- | --- |
| `GET /api/crew` | Whether the backend is on, the world, the counts. |
| `GET /api/crew/agents` | The roster and the counts. Each agent has `status`, `conversationId` and `workspaceId`. |
| `POST /api/crew/agents` | Add a standard agent, or a specialist with `{ "templateId": "..." }`. |
| `PATCH /api/crew/agents/:id` | Rename, or change the role. |
| `DELETE /api/crew/agents/:id` | Retire, stopping whatever it was doing. |
| `POST /api/crew/agents/:id/messages` | `{ text, workspaceId? }`. Answers 202 with the conversation, the stored message and `queued`. |
| `POST /api/crew/agents/:id/stop` | Stop the agent's turn. Answers `{ stopped }`. |
| `GET /api/crew/agents/:id/conversations` | That agent's conversations, newest first. |
| `GET /api/crew/conversations/:id` | One conversation. |
| `GET /api/crew/conversations/:id/events` | Its events, oldest first: the latest 200, or `?before=`, `?after=`, `?limit=` (up to 500). |
| `POST /api/crew/conversations/:id/answers` | `{ requestId }` with `allow` (and `message`), `answers` or `text`. |
| `GET /api/crew/events` | The live stream. |
| `GET /api/crew/settings` | The world's settings: `{ autonomy }`. |
| `PATCH /api/crew/settings` | Change them. |
| `GET /api/crew/specialists` | The catalog, with what the world may add and has added. |
| `GET /api/crew/workspaces` | The workspaces. |
| `POST /api/crew/workspaces` | Add one. |
| `PATCH /api/crew/workspaces/:id` | Rename or describe. |
| `DELETE /api/crew/workspaces/:id` | Archive. |

No request but the stream waits for ever. A query is cancelled by Postgres after 10 seconds, and a request
the database never answers gets a 503 `store_timeout` after 15 seconds (150 for creating a
workspace, which may be cloning). After a timed-out change, look before repeating it.

State-changing requests need an `Origin` header naming this server, as the rest of the API
does. From a terminal: `-H 'Origin: http://127.0.0.1:5274'`.

## Running it

With Docker Compose, which starts Postgres 18 alongside the server:

    docker compose up -d --build

Against a Postgres of your own:

    WORLDS_DATABASE_URL=postgres://user:password@host:5432/worlds \
    WORLDS_DATA_DIR=/var/lib/worlds \
    npm start

## Testing

    npm run test:crew

runs the crew tests against `WORLDS_TEST_DATABASE_URL`, which defaults to the local
development database at `127.0.0.1:55432`. Each test makes and drops a schema of its own.
Under plain `npm test` the tests that need a database are skipped and say why.

## Changing the schema

Add a new numbered file to `server/crew/store/migrations/`. Never edit one that has shipped.
Migrations run at start, each once, in a transaction, behind a lock, so several servers
starting together are safe.
