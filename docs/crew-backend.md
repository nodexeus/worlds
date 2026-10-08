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
| `WORLDS_DATA_DIR` | A directory: one folder per workspace under `workspaces/`, and an empty `channel/` that agents in no workspace answer the crew channel from. |

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
| `WORLDS_DEMO_RUNTIME` | off | `1` or `true`: a demonstration. See below. |

The agent limit and the specialist list are how a subscription tier reaches the server. This
backend only reads them.

### A demonstration

With `WORLDS_DEMO_RUNTIME=1` no agent runs anything. Whatever runtime it is bound to, it
plays a script: no model is called, no process is started and no file is touched. It is for
showing the interface and for testing it. The page labels the crew list "Demo".

The script (`server/crew/runtimes/demo.mjs`) is chosen by what the message contains:

| The message says | The agent |
| --- | --- |
| `question` | asks one, and goes on when it is answered |
| `approve` | asks before running a command, unless the world is fully autonomous |
| `fail` | fails, as a runtime that fell over |
| `long` | works for a minute, to be stopped or to have messages queued behind it |
| anything else | reads, edits and answers, over a few seconds |

A post to the crew channel is answered the channel's way: one ending in `?` gets a
contribution from each agent, one saying `pass` is passed by all, and anything else is
claimed by every agent it reached, in the world's first workspace, so that only one of them
getting it can be seen.

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
never changed or deleted. What concerns the crew channel also carries `postId`: see
"The crew channel".

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
agent takes a message exactly as an idle one does. An agent answering the crew channel is
`working` until its answer ends, and is then whatever it was before.

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

## The crew channel

One place to say something to the whole crew, or to some of it by name
(`server/crew/channel.mjs`).

- **Who gets a post.** With `@name` in it, the agents named, and nobody else. One that is
  busy has the post queued and is given it when it has nothing under way, after anything
  queued for its task. With no name, every agent that is free at that moment (`idle` or
  `failed`): the busy are skipped, and the post says who and why. A name nobody has refuses
  the post.
- **The limit.** `channelLimit` in the world's settings is how many agents answer a post
  that names nobody. Null, the default, is all of them. When more are free than the limit,
  those asked least recently go first.
- **How an agent answers.** Once, in a conversation of its own (`kind: channel`), so its
  task never contains channel chatter. It is told, after its own role, the three things it
  can do, and its first line decides which:

  | It says | That is |
  | --- | --- |
  | `PASS`, or nothing | a pass |
  | `CLAIM: <workspace name>` | a claim on the post as its task, in that workspace |
  | anything else | a contribution, kept to 1500 characters |

- **Nothing is changed by answering.** An answer runs at the `ask` level whatever the world
  has chosen, and the server refuses every approval it raises and answers every question
  with "nobody can answer here". It runs in the folder of the workspace the agent is in, so
  it can read what it is asked about, or in the empty `channel/` folder.
- **The referee.** A claim is a row that only one agent can hold for a post
  (`channel_claims_granted_key`). However many claim together, one is granted. The others
  are shown as passed, "taken". Agents still answering are stopped, and those queued are
  not asked. A claim naming no workspace this world has is not a claim: it is shown as a
  reply, marked `unplaced`, and no work begins.
- **The winner's task** is an ordinary one: a new conversation in the workspace it named,
  whose first message is the post (`data.postId` says which). If it cannot start, the claim
  is released with the reason.
- **Corrections.** Releasing a claim stops the agent if it is still in that task. Handing a
  post to an agent releases whatever claim stands, grants one to that agent and starts the
  task. The workspace is the one given, else the last claim's, else the one the agent is
  in. Making a reply into a task is the same hand-over.

A post, as every route and every event gives it:

    { id, text, at, named,
      to: [{ agentId, name, state, reason, text, conversationId }],
      claim: null | { agentId, name, workspaceId, conversationId, state, reason } }

| `to[].state` | Means | `reason` |
| --- | --- | --- |
| `queued` | Waiting to be given to the agent. | |
| `answering` | The agent has it and has not answered. | |
| `replied` | It contributed: `text`. | `unplaced` when it wanted the task and named no workspace here. |
| `passed` | It passed. | `taken` when another agent got the task first. |
| `claimed` | It took the post: `text` is what it said it would do. | |
| `failed` | Its answer failed or was stopped. | The runtime's reason, `stopped`, or `restart`. |
| `skipped` | It was not asked. | `working`, `waiting`, `limit`, `runtime`, `taken` or `retired`. |

`claim.state` is `granted` or `released`. A released claim's `reason` is `released`,
`handed`, `restart`, or why its task could not start.

Every time anything about a post changes, an event of type `post` goes on the world's
record with the whole post as its `data`, `postId` set, and no conversation, agent or
status. A client replaces what it has. The events of an agent's answer are ordinary events
in its side conversation, and carry `postId` too, so a client knows not to take that
conversation for the agent's task.

After a restart, answers that were under way are marked `failed` (`restart`), a claim whose
task had not begun is released (`restart`), and posts still queued are delivered.

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
| `GET /api/crew` | Whether the backend is on, the world, the counts, the `runtimes` this server can run and whether it is a `demo`. |
| `GET /api/crew/agents` | The roster and the counts. Each agent has `status`, `conversationId` and `workspaceId`. `seq` is the event the statuses are current to. |
| `POST /api/crew/agents` | Add a standard agent, or a specialist with `{ "templateId": "..." }`. |
| `PATCH /api/crew/agents/:id` | Rename, or change the role. |
| `DELETE /api/crew/agents/:id` | Retire, stopping whatever it was doing. |
| `POST /api/crew/agents/:id/messages` | `{ text, workspaceId? }`. Answers 202 with the conversation, the stored message and `queued`. |
| `POST /api/crew/agents/:id/stop` | Stop the agent's turn. Answers `{ stopped }`. |
| `GET /api/crew/agents/:id/conversations` | That agent's tasks, newest first. Its answers to the crew channel are not among them. |
| `GET /api/crew/conversations/:id` | One conversation. |
| `GET /api/crew/conversations/:id/events` | Its events, oldest first: the latest 200, or `?before=`, `?after=`, `?limit=` (up to 500). |
| `POST /api/crew/conversations/:id/answers` | `{ requestId }` with `allow` (and `message`), `answers` or `text`. |
| `GET /api/crew/events` | The live stream. |
| `GET /api/crew/channel` | `{ posts, seq }`: the latest 30 posts, oldest first, or `?before=<post id>`, `?limit=` (up to 100). `seq` is the event they are current to. |
| `POST /api/crew/channel` | `{ text }`, at most 4000 characters. Answers 202 with the post. |
| `GET /api/crew/channel/:id` | One post. |
| `POST /api/crew/channel/:id/release` | Take the post back from the agent that has it. 409 `no_claim` when nobody has. |
| `POST /api/crew/channel/:id/hand` | `{ agentId, workspaceId? }`. Make the post that agent's task. |
| `GET /api/crew/settings` | The world's settings: `{ autonomy, channelLimit }`. |
| `PATCH /api/crew/settings` | Change either, or both. |
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

## In the page

On a server with a crew backend the page draws a crew list and, from it, a card for each
agent: its conversation as it happens, and one box to continue it, queue a message behind a
busy agent, or start a new task in a workspace. All of it is `src/crew/`:

| File | What it is |
| --- | --- |
| `api.js` | The calls above. A refusal is thrown with the server's code and wording. |
| `stream.js` | The live stream: each stored event once, in order, across drops and refusals. |
| `store.js` | What the page knows: agents, workspaces, the events of conversations on show. |
| `transcript.js` | A conversation's events as a card shows them. |
| `compose.js` | What the message box is for, given the agent and the workspace chosen. |
| `markdown.js` | The markdown agents write, as data. Never HTML. |
| `panel.js`, `card.js`, `render.js` | The crew list, a card, and an item of a transcript, as elements. |
| `index.js` | Puts it together, and draws nothing on a monitor-only server. |

The first six touch no DOM and are tested in Node. Nothing an agent or a person wrote is
ever parsed as HTML: it is set as text, and a link is a link only when it is `http` or
`https`.

An agent's status in the page is the status on the latest event about it. The roster itself
(who exists, what they are called) is not on the stream, so the page asks for it again
after its own changes, after a reconnect, when the window regains focus and every 20
seconds. `seq` on the agent list is what lets it tell a snapshot that is behind the stream
from one that is ahead.

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

    npm run test:crew:ui

builds the page and drives it in Electron, with no window shown, against a real server in
demonstration mode on a schema of its own: making a workspace and an agent, giving a task,
queueing, stopping, answering a question and an approval, reading history, a server restart.
Set `CREW_UI_SHOTS` to a directory to keep the screenshots it takes.

## Changing the schema

Add a new numbered file to `server/crew/store/migrations/`. Never edit one that has shipped.
Migrations run at start, each once, in a transaction, behind a lock, so several servers
starting together are safe.
