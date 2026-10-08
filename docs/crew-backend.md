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
| `WORLDS_DATABASE_URL` | A Postgres 18 database: agents and workspaces. |
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

## API

All under `/api/crew`, JSON in and out. A refusal answers `{ error, code }` with a 4xx
status. `GET /api/crew` answers `{ enabled: false }` on a monitor-only server.

| Method and path | Purpose |
| --- | --- |
| `GET /api/crew` | Whether the backend is on, the world, the counts. |
| `GET /api/crew/agents` | The roster and the counts. |
| `POST /api/crew/agents` | Add a standard agent, or a specialist with `{ "templateId": "..." }`. |
| `PATCH /api/crew/agents/:id` | Rename, or change the role. |
| `DELETE /api/crew/agents/:id` | Retire. |
| `GET /api/crew/specialists` | The catalog, with what the world may add and has added. |
| `GET /api/crew/workspaces` | The workspaces. |
| `POST /api/crew/workspaces` | Add one. |
| `PATCH /api/crew/workspaces/:id` | Rename or describe. |
| `DELETE /api/crew/workspaces/:id` | Archive. |

No request waits for ever. A query is cancelled by Postgres after 10 seconds, and a request
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
