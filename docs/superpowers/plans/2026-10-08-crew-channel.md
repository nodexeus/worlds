# Crew Channel Implementation Plan

**Goal:** Post once to the whole crew, or to agents by name, and have each agent that receives it contribute, take the task, or pass, with exactly one agent able to take it.

**Architecture:** A new server module, `server/crew/channel.mjs`, owns posts, who each was delivered to, and claims. It asks agents through the conversation engine, which gains one thing: a turn "aside" from an agent's task, in a conversation of its own, in which nothing can be changed. A post's whole state goes out on the world's numbered record every time it changes, so the page follows the channel exactly as it follows conversations. The page half is a dock drawn from that state.

**Tech Stack:** Node, Postgres 18, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-crew-chat-design.md`, sections "Behaviour: Crew channel", "Data model" (channel post, channel reply, claim), "On screen: Crew channel" and the failure table's "Two simultaneous claims". This plan is phase 6 of its build order.

**Tracking:** NODEX-325 (the server), NODEX-326 (the page). Two branches and two pull requests: the server does not depend on how the channel looks, and the page waits on the owner's view of the mockup shown on 2026-10-08.

**How this plan is written:** as the phase 3 to 5 plans were. It fixes the interfaces, the behaviour and the tests, and the code is written test-first against it.

## Global Constraints

- The foundation plan's constraints hold: no em dashes, no authorship trailers, two-space indent, no semicolons, single quotes.
- A migration file is never edited once shipped. This phase adds `003_channel.sql`.
- An agent does one thing at a time. A channel answer is a turn on the agent's own line, like any other.
- An agent's task conversation never contains channel chatter. Only a claim reaches it, as its first message.
- Answering the channel changes nothing on disk: an answer is run at the `ask` level and anything it asks leave for is refused by the server at once.
- The monitor-only server still never loads `postgres`.
- Nothing an agent wrote is trusted as a command. A claim is recognised only by its exact first line, and the workspace it names must exist.

## Decisions this plan makes

| Question | Decision |
| --- | --- |
| Who is "idle"? | An agent with no turn under way: status `idle` or `failed`. `working` and `waiting` are busy. |
| A name that matches nobody | The post is refused, naming the name. A typo should not silently become a post to nobody. |
| No name, and everyone is busy | The post is kept, with everyone skipped. The page says so. |
| How does an agent make its move? | By what it says. First line exactly `PASS`: it passes. First line `CLAIM: <workspace name>`: it claims, and the rest is shown as its reply. Anything else is a contribution. Nothing at all is a pass. This needs nothing from a runtime that the contract does not already give. |
| A claim that names no workspace this world has | Not a claim. It is shown as a reply saying the agent would take it and where it thought it belonged, and the person can make it a task with a workspace. The spec: when where it belongs is unclear, no work begins. |
| Where does an answer run? | In the folder of the workspace the agent is in, if it is in one, so it can read what it is asked about. Otherwise in an empty folder, `channel/`, under the data directory. |
| Can an answer change anything? | No. It runs at `ask` whatever the world's level, and every approval it raises is refused by the server, every question answered with "nobody can answer here". Work happens in the task a claim starts. |
| What do the others see when one claims? | Those still answering are stopped and shown as passed, "taken". Those queued are skipped, "taken". Those who already replied keep their reply. |
| What does the winner get? | A normal task: a new conversation in the workspace it named, whose first message is the post. The claim links to it. |
| Releasing a claim | Marks it released and, if the agent's turn is still in that claim's conversation, stops it. |
| Handing over, and "make this a task" | One operation: release whatever claim stands, grant one to the named agent, start the task. The workspace is the one given, else the released claim's, else the one the agent is in. With none of those it is refused as needing a workspace. A busy agent is refused. |
| The answer limit | `settings.channelLimit`: null for all (the default), or 1 to 50. When more are free than the limit, those asked least recently go first. |
| How does the page follow a post? | An event of type `post` on the world's record whose data is the whole post as it now stands. A client replaces what it has. No patching, so nothing can be applied out of order within one post. |
| Does an answering agent look busy? | Yes: `working`. The events of its side conversation carry its status as any do, and are marked with the post's id so a page does not mistake the side conversation for the agent's task. When the answer ends the agent's status is what it was before. |
| A restart | Answers under way are marked failed, "restart". Posts queued for named agents are delivered. |
| Retiring an agent | Its queued posts are skipped, "retired". |
| The demonstration | An agent given a post that ends in `?` contributes. One containing the word `pass` passes. Anything else is claimed, in the world's first workspace, so the referee can be seen. |

## Schema: `003_channel.sql`

```sql
alter table settings add column channel_limit int
  constraint settings_channel_limit_check check (channel_limit between 1 and 50);

create table channel_posts (id uuid pk default uuidv7(), world_id text, text text, named boolean, created_at timestamptz);

alter table conversations alter column workspace_id drop not null;
alter table conversations add column post_id uuid references channel_posts (id);
-- a task conversation always has a workspace
alter table conversations add constraint conversations_place_check check (kind = 'channel' or workspace_id is not null);

create table channel_deliveries (
  post_id, agent_id, world_id, state, reason text, text text default '', conversation_id uuid, updated_at,
  primary key (post_id, agent_id),
  state in ('queued','answering','replied','passed','claimed','failed','skipped'));

create table channel_claims (id, world_id, post_id, agent_id, workspace_id, conversation_id, reason, granted_at, released_at);
create unique index channel_claims_granted_key on channel_claims (post_id) where released_at is null;

alter table events alter column conversation_id drop not null, alter column agent_id drop not null, alter column status drop not null;
alter table events add column post_id uuid references channel_posts (id);
alter table events add constraint events_subject_check check (conversation_id is not null or post_id is not null);
```

## Interfaces

```js
// server/crew/events.mjs: an event may carry `postId`. It is presented only when set.
append({ conversationId?, agentId?, type, status?, data?, postId? })

// server/crew/conversations.mjs
conversations.aside(agentId, { text, title, postId, instruction, channel, onEnd })
  -> { started: true, conversation } | { started: false, status }   // busy: nothing was begun
// onEnd({ type: 'finished' | 'failed' | 'interrupted', data, said }) is called, not awaited,
// once the turn is over, the agent is free and anything waiting on its task has been dealt with.
conversations.stopAside(agentId, conversationId) -> { stopped }       // only that turn, never a task
conversations.send(agentId, { text, workspaceId, postId })           // postId is kept on the message
createConversations({ ..., asideDir, onFree })                       // onFree(agentId): it has nothing under way
// list(agentId) gives task conversations only. statuses() says `working` for an agent mid-answer.

// server/crew/channel.mjs
parseMove(said) -> { move: 'pass' } | { move: 'reply', text } | { move: 'claim', workspace, text }
mentions(text) -> string[]                                            // the names after an @, as typed
createChannel({ sql, worldId, roster, workspaces, settings, conversations, runtimes, events, log })
  -> { post({ text }), list({ before?, limit? }), get(postId), release(postId), hand(postId, { agentId, workspaceId? }),
       freed(agentId), forget(agentId), recover(), settled() }

// A post, as every route and every `post` event gives it:
{ id, text, at, named,
  to: [{ agentId, name, state, reason, text, conversationId }],      // in the order agents joined
  claim: null | { agentId, name, workspaceId, conversationId, state: 'granted' | 'released', reason } }
```

Routes:

| Route | Does |
| --- | --- |
| `GET /api/crew/channel?before=<postId>&limit=` | `{ posts, seq }`: the latest posts, oldest first, and the record's head read before them. |
| `POST /api/crew/channel` `{ text }` | 202 `{ post }`. |
| `POST /api/crew/channel/:postId/release` | `{ post }`. 409 `no_claim` when nothing is granted. |
| `POST /api/crew/channel/:postId/hand` `{ agentId, workspaceId? }` | `{ post }`. |
| `PATCH /api/crew/settings` | Also takes `channelLimit`. Either field may be given alone. |

## Tasks

1. **Schema, settings and events.** `003_channel.sql`; `settings` reads and writes `channelLimit`; `events.append` takes `postId` and events with no conversation. Tests: `crew-store`, `crew-settings`, `crew-events`.
2. **A turn aside.** `aside`, `stopAside`, `onFree`, the read-only rule, status during and after, messages sent to the agent meanwhile, recovery of a side conversation left open, history without side conversations. Tests: `crew-aside.test.mjs`.
3. **The channel.** `parseMove`, `mentions`, posting, delivery, queueing for a named busy agent, the limit, replies and passes, the referee, the winner's task, release and hand-over, recovery, retirement. Tests: `crew-channel.test.mjs`.
4. **Routes, wiring and the demonstration.** `http.mjs`, `index.mjs`, `demo.mjs`, the page store ignoring what is not about an agent's task. Tests: `crew-http`, `crew-demo`, `crew-ui-store`, `crew-end-to-end`.
5. **Docs.** `docs/crew-backend.md`, `docs/HANDOFF.md`.
6. **The page** (NODEX-326), planned in detail once the mockup is agreed: `src/crew/channel.js` (state and what a post shows, tested in Node), `src/crew/dock.js` (the view), the answer limit beside the autonomy level, the interface check.

## Review Focus

- **Two agents claim at the same moment.** Exactly one is granted, the other is shown as passed, and only one task starts.
- **A message, a stop or a retirement while an agent is answering.** The message is not lost or left waiting, the stop ends only the answer, and the post never shows that agent as answering for ever.
- **The winner cannot start.** It was given something else in the instant between its answer and its task, or its workspace was archived. The claim is released with the reason, so the post is not stuck as taken by an agent that is not doing it.
- **The server stops mid-answer or mid-claim.** After a restart no post shows an agent still answering, and a queued post is still delivered.
- **What an agent says is hostile or odd.** `CLAIM:` naming another world's workspace, a path, or nothing; `PASS` followed by a page of text; a megabyte of reply. None becomes a task anywhere it should not, and a reply is cut to a length the page can show.
