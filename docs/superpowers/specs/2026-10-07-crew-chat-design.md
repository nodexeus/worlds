# Crew chat: durable agents you can talk to inside the world

Tracking: NODEX-311. Status: design agreed in conversation on 2026-10-07, awaiting the
owner's review of this document. No implementation has started.

## Purpose

Worlds is the visual piece of the Nodexeus agent platform. Today, clicking a crew member
offers "open in terminal" or "open in desktop app". The terminal option starts a new
session instead of joining the live one, and neither option can exist on a server, where
the conversation lives on the server itself.

This work lets a person converse with agents from inside the world:

- message any crew member directly, read its output and questions, and answer in place;
- give an idle crew member a task;
- post to the whole crew at once, without disturbing anyone who is working.

## Product context this design depends on

- **Server first.** Each customer has one hosted world. Everything here is built for the
  server.
- **Desktop is the second offering.** Signed out, the desktop app stays what it is today:
  a local monitor of coding sessions, positioned as the free or demo tier. Signed in, it
  is a client of the customer's hosted world. It packages no database and no runtime.
- **Agents are durable.** Paid tiers limit how many agents a customer has, so an agent is
  a long-lived identity, not a conversation.
- **Runtimes are replaceable.** Hermes and OpenClaw are the expected runtimes. Letta, and
  driving a customer's own Claude or ChatGPT subscription, are possible later.
- **Memory is shared and separate.** All agents will share one memory and retrieval
  system (the Library, backed by Hindsight on Postgres). That is its own project. This
  design only leaves room for it.
- **Inference is configurable.** A customer brings their own key or uses Nodexeus
  inference through the shared LiteLLM gateway.

This is where the project departs furthest from upstream Bot Crossing. The rule in
`server/harnesses/README.md` that the app is read-only towards agents no longer holds for
the new module, and that document is rewritten as part of this work.

## Terms

| Term | Meaning |
| --- | --- |
| World | One customer's campus and everything in it. |
| Agent | A durable crew member: a name, a robot, a runtime, a role. Counted against the tier. |
| Runtime | The software that executes an agent: Claude Code, Hermes, OpenClaw. |
| Workspace | A named project with a description and its own folder. A plot on the campus. |
| Conversation | One agent working in one workspace: an ordered record of events. |
| Event | One item in a conversation: a message, tool activity, a question, a result. |
| Crew channel | The shared place where a person addresses every available agent. |
| Visitor | A locally scanned coding session shown view-only in the desktop app. |

## Architecture

One new, self-contained server module: `server/crew/`. It owns all new state and could
later be lifted into a platform service. It never reads local session files.

| Part | Responsibility |
| --- | --- |
| Store | Postgres access and versioned migrations. Every row carries a world ID. |
| Roster | Create, rename and retire agents. Enforces the agent limit. |
| Workspaces | Create a named workspace and its folder, optionally from a git URL. |
| Runtime contract | The interface every runtime adapter implements. |
| Conversations | Records events in order and derives each agent's status. |
| Channel | Fan-out, `@name` routing and the claim referee. |
| Settings | Autonomy level, inference gateway, channel answer limit. Per world. |
| Events hub | Pushes stored events to connected clients. |

**Transport.** Plain HTTP requests for actions. One server-sent event stream per world for
everything live. Each event has a per-world sequence number, and a reconnecting client
asks for everything after the last number it saw. The browser and the signed-in desktop
app use the same API.

**Sign-in** is outside this module. The server trusts an authenticated request from
whatever sits in front of it and needs only the world the request belongs to.

**Deployment shape.** One server instance per customer. A world being "unique to them"
comes from deployment, not from tenant logic in the code. The world ID on every row keeps
a later move to a shared service a deployment change.

## Storage

The server keeps nothing that matters outside two configured places.

- **Data directory**, one environment variable. Holds workspace folders, each agent's
  runtime state (for example a runtime home directory per agent) and logs. In Docker or
  Kubernetes this is the single path a persistent volume is mounted on.
- **Database URL**, one environment variable, pointing at Postgres wherever it runs.

The container image is disposable. At startup the server verifies that the data directory
is writable and the database is reachable, and refuses to start with a clear message if
either check fails.

Postgres was chosen over SQLite because Postgres is already required for memory, because
a database file on a network-mounted volume is the risky case for SQLite, and because the
signed-out desktop app does not need this store at all. The scanners' read-only use of
SQLite to read other tools' session stores is unchanged.

## Data model

All records carry a world ID.

- **Agent**: name (unique in the world), robot kind (plated or rock), runtime, role
  description, created and retired timestamps. Status is derived from events, never set
  by hand.
- **Workspace**: name, one-line description, folder under the data directory, optional
  git source.
- **Conversation**: agent, workspace, title, the runtime's own handle for resuming, kind
  (task or channel side conversation), and a link to a predecessor when work moved
  workspace. An agent has many conversations and at most one active task conversation.
- **Event**: conversation, sequence number, type, payload, timestamp. Types: person
  message, agent text, tool activity, question, approval request, answer, finished,
  failed, interrupted.
- **Channel post**: text, author, the agents it was delivered to, the agents skipped and
  why.
- **Channel reply**: post, agent, text or pass.
- **Claim**: post, agent, workspace, granted or released. At most one granted claim per
  post, enforced by the database.
- **Settings**: one row per world.

## Runtime contract

Each adapter implements five operations:

1. **Start** a conversation for an agent in a workspace folder with an opening message.
2. **Send** a further message into a conversation.
3. **Answer** an open question or approval request.
4. **Interrupt** the current turn.
5. **Describe** what the runtime supports (for example mid-turn messages, approvals).

Adapters emit one normalised event stream using the event types above. Nothing outside an
adapter sees a runtime's own formats, session IDs or files. An adapter may run one process
per turn or talk to a long-lived runtime service; the contract hides the difference.

Adapters, in order:

- **Scripted fake**: replays fixed event sequences. Used by most tests.
- **Claude Code**: the server runs the command-line tool headless, one process per turn,
  with streamed input and output and session resume.
- **Hermes**: second, to prove the contract is not shaped like Claude Code. Its real
  interface is confirmed when the install is finished, before this adapter is planned.
- **OpenClaw**: later, through its gateway service.

The autonomy setting and the inference gateway are passed to the adapter, which maps them
onto its runtime's own permission modes and model configuration.

## Behaviour

### Direct message

1. The person sends text to an agent. The server stores it as an event and returns.
2. If the agent is idle, the message goes to its adapter. If the agent is mid-task, the
   message is queued and delivered at the next point the runtime accepts input. The chat
   shows it as queued.
3. Adapter output is stored as events and pushed to every connected client.
4. Status follows from events: working while output flows, waiting while a question or
   approval is open, idle on finish, failed on error.
5. A question or approval stays open until answered in the chat. The answer is stored and
   passed to the runtime.

### Giving a task

The same flow, with a workspace. It starts a new conversation in that workspace and the
robot walks to that plot.

### Where work happens

- An agent's location follows the work. An agent standing in workspace A that takes a
  task about B works in B.
- When an agent takes a task it sees the list of workspaces with their descriptions and
  must name the one the task belongs to before work starts. A workspace named by the
  person wins.
- The server starts the work in that workspace's folder.
- If the task, or where it belongs, is unclear, the agent asks and no work begins until
  the person answers. This holds at every autonomy level.
- An agent never creates a workspace on its own. It asks.
- If an agent discovers mid-task that the work belongs elsewhere, it says so and moves:
  a new conversation in the right workspace, linked to the old one.
- A task spanning two workspaces has one home workspace, and the agent asks before
  touching the other. Proper multi-workspace tasks are out of scope.

### Autonomy

One setting per world with three levels. The default is the third.

1. Ask before every action.
2. Free inside the workspace folder, ask for anything beyond it.
3. Fully autonomous: ask only real questions about the task.

At level 3 the only wall around an agent is the customer's own instance, which is one
reason for one instance per customer.

### Stopping

Stopping interrupts the runtime. The conversation keeps everything received and the agent
returns to idle.

### Crew channel

- **`@name` present**: only the named agents receive the post. A named agent that is
  mid-task has the post queued, and the channel says so.
- **No name**: every agent that is idle at that moment receives it. Agents that are
  working or waiting are skipped, and the post shows who was skipped.
- Each receiving agent gets the post with a standing instruction and one of three moves:
  reply with a contribution, claim the task, or pass.
- **The referee**: a claim is a database write only one agent can win. The winner is told
  it owns the task; the others are told it is taken and stop. The work becomes a normal
  task conversation, linked from the post, in the workspace decided by the rule above.
- **Corrections**: the person can release a claim, hand the task to a specific agent, or
  turn a reply into a task for that agent.
- **Isolation**: each channel exchange is its own short side conversation, so an agent's
  task conversation never contains crew chatter unless it claimed the task.
- **Cost**: one model call per receiving agent. Reply length is capped by the standing
  instruction, and a world setting limits how many agents answer an open post (default:
  all).

## On screen

### Agent card

Replaces today's card and its two "open in" buttons.

- Header: name, robot kind, status, current workspace, and a stop button while working.
- Body: the conversation. Tool activity is folded into single expandable lines. Questions
  and approval requests are cards with their answer buttons inline.
- Footer: the message box. For an idle agent it includes a workspace picker, so asking
  and giving a task share one box.
- A history control lists that agent's earlier conversations.
- The card floats beside the robot, can be dragged, resized and pinned, and several can
  be open at once.

### Crew channel

Docked bottom right, collapsed to one bar with an unread count. Open, it shows posts with
each agent's reply under its name, claim status and the correction controls.

### In the world

- The campus draws agents from the roster.
- Robots show status with the existing eye states. Waiting on the person also raises the
  existing attention marker, and clicking it opens the card at the open question.
- A roster panel lists agents, shows the count against the limit, and is where agents are
  created, renamed and retired.
- Creating a workspace adds a plot. Creating an agent brings a robot in through the gate.
- **Visitors** (desktop only): scanned local sessions, drawn visibly differently, with a
  view-only card that keeps today's "open in" buttons. They do not count against the
  limit and cannot be messaged.

### Settings

Autonomy level, inference gateway and key, channel answer limit.

## Failure handling

| Failure | Result |
| --- | --- |
| Runtime crashes or stalls | A failed event with the reason, agent returns to idle, retry from the card. Output received so far is kept. |
| Server restarts mid-task | On startup, conversations marked working are checked with their runtime and either resumed or marked interrupted. |
| Client disconnects | Reconnect and replay from the last sequence number. Nothing lost or duplicated. |
| Inference fails | A plain message naming the cause: bad key, no credit or gateway unreachable. |
| Agent limit reached | Creation refused with the count and the limit. |
| Two simultaneous claims | The database grants exactly one. |
| Data directory or database unavailable at start | The server refuses to start with a clear message. |

## Testing

- The scripted fake runtime drives most tests: fast, free and repeatable.
- Contract tests that every adapter must pass: start, send, question and answer,
  interrupt, failure.
- Store and referee tests against real Postgres 18, including simultaneous claims and
  replay by sequence number.
- One end-to-end check per real runtime, run on demand because it costs model calls.
- Interface checks in the packaged app, scripted as the visual work has been.

Development uses a local Postgres 18 container. A Postgres service is added to
`docker-compose.yml` for the server deployment.

## Build order

Each phase is usable or verifiable on its own and becomes one or more tracked issues.

1. Foundation: storage configuration, Postgres store, migrations.
2. Roster and workspaces.
3. Runtime contract, scripted fake runtime, Claude Code adapter.
4. Conversations and the live event stream.
5. Agent card: direct chat and giving a task.
6. Crew channel and claims.
7. World integration: roster-driven crew, visitors on desktop.
8. Hermes adapter.

## Out of scope

- Shared memory, retrieval and the Library's contents.
- Customer accounts, sign-in, billing and how a tier sets the agent limit. This design
  only reads a configured limit.
- Multi-tenancy inside one server process.
- A dispatcher that assigns channel tasks on the person's behalf.
- Tasks that span several workspaces.
- Connecting a workspace to an external provider beyond seeding from a git URL.
- Driving a customer's own Claude or ChatGPT subscription, and a Letta adapter.
- Sandboxing agents beyond the customer's own instance.

## Related items

- NODEX-309: workspace names on physical signs.
- NODEX-310: remove the remaining "Bot Crossing" names, including the desktop data folder.
