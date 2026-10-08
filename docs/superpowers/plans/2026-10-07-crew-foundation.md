# Crew Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Worlds server a persistent roster of durable agents (standard and curated) and a set of workspaces, behind an HTTP API, stored in Postgres and a configured data directory.

**Architecture:** A new self-contained module, `server/crew/`, that the existing API middleware delegates `/api/crew` to. It is switched on by configuration: with no database URL the server stays today's read-only monitor and never loads the Postgres client. All state carries a world ID.

**Tech Stack:** Node 22.13 or later (ES modules, `node:test`), Postgres 18, the `postgres` client library (postgres.js 3.4), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-07-crew-chat-design.md`

This plan covers phases 1 and 2 of the spec's build order. Phases 3 to 8 (runtime contract, conversations, the agent card, the crew channel, world integration, Hermes) each get their own plan once this one has landed, because each depends on what the one before it settles.

## Global Constraints

- Tracking: epic NODEX-311. Every commit message ends with the child issue reference given in its task, for example `(NODEX-312)`. No `Co-authored-by` trailer and no text saying the code was machine generated.
- Never write an em dash anywhere: code, comments, docs, commit messages.
- Node `>=22.13`. Postgres 18. ES modules with the `.mjs` extension on the server, two-space indent, no semicolons, single quotes, matching the existing `server/` code.
- The server keeps nothing that matters outside two configured places: the data directory and the database.
- Every table row carries `world_id`. No query may omit it.
- With `WORLDS_DATABASE_URL` unset the server behaves exactly as it does today and must not import the `postgres` package (the desktop app runs this code with no database).
- Agent names are unique within a world, compared without regard to case. Curated template names are reserved in every world.
- A curated agent's name and role are fixed. A world has at most one agent per template. Curated agents do not use a standard slot.
- Tests that need Postgres read `WORLDS_TEST_DATABASE_URL` and are skipped with a stated reason when it is unset. The local value is `postgres://worlds:worlds-dev@127.0.0.1:55432/worlds`.
- Existing baseline: `npm test` reports 267 passing and 2 failing on a machine with Codex installed (`/api/open with via: terminal...` and `codex with no CLI installed...`). Those two are known and unrelated. No other test may fail.

## Review Focus

1. **Two creations racing at the limit.** With 5 of 6 agents, two simultaneous create requests must produce exactly one agent and one refusal. Pinned in Task 4.
2. **Names that differ only by case or padding.** `sophie`, `SOPHIE` and ` Sophie ` must all be refused when Sophie is a curated template, and `Ada` then `ada` must collide. Pinned in Tasks 3 and 4.
3. **A limit lowered below the current count.** A world with 6 agents whose limit drops to 4 keeps its agents, reports `6 of 4`, and refuses new ones. Pinned in Task 4.
4. **A git source that is really a command.** `--upload-pack=...`, `ext::sh -c ...` and `file:///etc` must be refused before git is ever run. Pinned in Task 5.
5. **The database going away after startup.** A request made while Postgres is unreachable must answer 503 with a plain message, not crash the server or hang. Pinned in Task 7.

## File Structure

| File | Responsibility |
| --- | --- |
| `server/crew/config.mjs` | Read and validate crew settings from the environment. No other imports. |
| `server/crew/errors.mjs` | `CrewError`: a refusal with a code, a message and an HTTP status. |
| `server/crew/store/db.mjs` | Open a Postgres connection pool. |
| `server/crew/store/migrate.mjs` | Apply the SQL files in `migrations/` once each, in order. |
| `server/crew/store/migrations/001_roster.sql` | The `agents` and `workspaces` tables. |
| `server/crew/names.mjs` | The friendly-name list, name validation and picking. |
| `server/crew/catalog.mjs` | Load and validate curated templates from `templates/`. |
| `server/crew/templates/quill.json` | One sample curated template that proves the mechanism. |
| `server/crew/roster.mjs` | Create, update, retire and count agents. |
| `server/crew/workspaces.mjs` | Create, update, archive and list workspaces and their folders. |
| `server/crew/index.mjs` | `createCrew(config)`: startup checks, migrations, assembles the parts. |
| `server/crew/boot.mjs` | One memoised crew per process, loaded only when configured. |
| `server/crew/http.mjs` | The `/api/crew` routes. |
| `server/lib/json-http.mjs` | `send` and `readJsonBody`, moved out of `server/api.mjs` to be shared. |
| `test/support/crew-db.mjs` | A throwaway Postgres schema per test. |
| `docs/crew-backend.md` | How to configure, run and test the crew backend. |

---

### Task 1: Configuration (NODEX-312)

**Files:**
- Create: `server/crew/config.mjs`
- Create: `server/crew/errors.mjs`
- Test: `test/crew-config.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadCrewConfig(env: object): CrewConfig | null`. Returns `null` when `WORLDS_DATABASE_URL` is unset. Throws `Error` with a plain message on a bad value.
  - `CrewConfig = { databaseUrl: string, schema: string, dataDir: string, worldId: string, agentLimit: number, entitled: string[] }`. `schema` is `''` when unset. `dataDir` is absolute.
  - `class CrewError extends Error { code: string; status: number }`, constructed as `new CrewError(code, message, status)`.

- [ ] **Step 1: Write the failing test**

```js
// test/crew-config.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { loadCrewConfig } from '../server/crew/config.mjs'
import { CrewError } from '../server/crew/errors.mjs'

const base = { WORLDS_DATABASE_URL: 'postgres://u:p@db:5432/worlds', WORLDS_DATA_DIR: '/var/lib/worlds' }

test('with no database the server is a monitor and there is no crew', () => {
  assert.equal(loadCrewConfig({}), null)
  assert.equal(loadCrewConfig({ WORLDS_DATA_DIR: '/data' }), null)
})

test('the defaults are one world of six agents with no specialists', () => {
  assert.deepEqual(loadCrewConfig(base), {
    databaseUrl: 'postgres://u:p@db:5432/worlds',
    schema: '',
    dataDir: '/var/lib/worlds',
    worldId: 'default',
    agentLimit: 6,
    entitled: [],
  })
})

test('everything can be set', () => {
  const config = loadCrewConfig({
    ...base,
    WORLDS_DATABASE_SCHEMA: 'acme',
    WORLDS_WORLD_ID: 'acme',
    WORLDS_AGENT_LIMIT: '12',
    WORLDS_CURATED_AGENTS: ' quill, sophie ,,',
  })
  assert.equal(config.schema, 'acme')
  assert.equal(config.worldId, 'acme')
  assert.equal(config.agentLimit, 12)
  assert.deepEqual(config.entitled, ['quill', 'sophie'])
})

test('a relative data directory is made absolute', () => {
  const config = loadCrewConfig({ ...base, WORLDS_DATA_DIR: 'data/crew' })
  assert.equal(config.dataDir, path.resolve('data/crew'))
})

test('a database with nowhere to keep files is refused, by name', () => {
  assert.throws(() => loadCrewConfig({ WORLDS_DATABASE_URL: base.WORLDS_DATABASE_URL }), /WORLDS_DATA_DIR/)
})

test('values that would be dangerous as identifiers are refused', () => {
  assert.throws(() => loadCrewConfig({ ...base, WORLDS_DATABASE_SCHEMA: 'a"; drop' }), /WORLDS_DATABASE_SCHEMA/)
  assert.throws(() => loadCrewConfig({ ...base, WORLDS_WORLD_ID: 'has space' }), /WORLDS_WORLD_ID/)
  assert.throws(() => loadCrewConfig({ ...base, WORLDS_DATABASE_URL: 'mysql://x' }), /WORLDS_DATABASE_URL/)
})

test('a limit has to be a whole number of agents, and zero is allowed', () => {
  assert.equal(loadCrewConfig({ ...base, WORLDS_AGENT_LIMIT: '0' }).agentLimit, 0)
  for (const bad of ['-1', '2.5', 'six']) {
    assert.throws(() => loadCrewConfig({ ...base, WORLDS_AGENT_LIMIT: bad }), /WORLDS_AGENT_LIMIT/)
  }
})

test('a refusal carries a code and a status', () => {
  const error = new CrewError('agent_limit', 'This world has 6 of 6 agents', 409)
  assert.equal(error.code, 'agent_limit')
  assert.equal(error.status, 409)
  assert.equal(error.message, 'This world has 6 of 6 agents')
  assert.ok(error instanceof Error)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/crew-config.test.mjs`
Expected: FAIL with `Cannot find module '.../server/crew/config.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// server/crew/errors.mjs
/**
 * Something the crew backend refuses to do, said in words a person can act on.
 *
 * `code` is for the page to branch on, `status` is the HTTP status the API answers with.
 * Anything that is not a CrewError is a fault, and is reported as one.
 */
export class CrewError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'CrewError'
    this.code = code
    this.status = status
  }
}
```

```js
// server/crew/config.mjs
import path from 'node:path'

/**
 * Where the crew backend keeps things, read once from the environment.
 *
 * Two places hold everything that has to survive a restart or an image update: a Postgres
 * database and one directory. Nothing else is written anywhere, which is what lets a
 * deployment mount a single persistent volume and point at a single database.
 *
 * With no database configured there is no crew at all: the server is the read-only monitor
 * it has always been, and the desktop app runs it that way.
 *
 * This module imports nothing from the rest of `server/crew/`, so reading the configuration
 * never loads the Postgres client.
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/
const WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{databaseUrl: string, schema: string, dataDir: string, worldId: string,
 *   agentLimit: number, entitled: string[]} | null}
 */
export function loadCrewConfig(env) {
  const databaseUrl = (env.WORLDS_DATABASE_URL || '').trim()
  if (!databaseUrl) return null
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error('WORLDS_DATABASE_URL must be a postgres:// address')
  }

  const dataDir = (env.WORLDS_DATA_DIR || '').trim()
  if (!dataDir) {
    throw new Error('WORLDS_DATA_DIR must be set when WORLDS_DATABASE_URL is: workspaces need somewhere to live')
  }

  const schema = (env.WORLDS_DATABASE_SCHEMA || '').trim()
  if (schema && !IDENTIFIER.test(schema)) {
    throw new Error('WORLDS_DATABASE_SCHEMA must be lower-case letters, digits and underscores')
  }

  const worldId = (env.WORLDS_WORLD_ID || 'default').trim()
  if (!WORLD_ID.test(worldId)) {
    throw new Error('WORLDS_WORLD_ID must be letters, digits, hyphens and underscores, at most 64')
  }

  const rawLimit = env.WORLDS_AGENT_LIMIT === undefined ? '6' : String(env.WORLDS_AGENT_LIMIT).trim()
  if (!/^\d+$/.test(rawLimit)) {
    throw new Error('WORLDS_AGENT_LIMIT must be a whole number of agents')
  }

  const entitled = (env.WORLDS_CURATED_AGENTS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return {
    databaseUrl,
    schema,
    dataDir: path.resolve(dataDir),
    worldId,
    agentLimit: Number(rawLimit),
    entitled,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/crew-config.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add server/crew/config.mjs server/crew/errors.mjs test/crew-config.test.mjs
git commit -m "feat: crew configuration from the environment (NODEX-312)"
```

---

### Task 2: Postgres store and migrations (NODEX-312)

**Files:**
- Modify: `package.json` (add the `postgres` dependency and a `test:crew` script)
- Create: `server/crew/store/db.mjs`
- Create: `server/crew/store/migrate.mjs`
- Create: `server/crew/store/migrations/001_roster.sql`
- Create: `test/support/crew-db.mjs`
- Test: `test/crew-store.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `connect(databaseUrl: string, options?: { schema?: string, max?: number }): Sql`. `Sql` is a postgres.js client: a tagged-template function with `.begin(fn)`, `.unsafe(text)` and `.end({ timeout })`. Result column names are camel-cased (`template_id` is read as `templateId`).
  - `migrate(sql: Sql, dir?: string): Promise<string[]>`. Returns the file names applied by this call.
  - `isUniqueViolation(error: unknown, constraint?: string): boolean`.
  - `isUnavailable(error: unknown): boolean`. True when the database could not be reached.
  - Test support: `needsDb` (an options object for `test()`), `withDb(run: (sql: Sql) => Promise<T>): Promise<T>`.
  - Tables `agents` and `workspaces` as defined in the SQL below. Constraint names later tasks rely on: `agents_name_key`, `agents_template_key`, `workspaces_name_key`.

- [ ] **Step 1: Add the dependency and the test script**

Run: `npm install postgres@^3.4.9`

Then add this line to the `scripts` block of `package.json`, after the `test` line:

```json
    "test:crew": "WORLDS_TEST_DATABASE_URL=${WORLDS_TEST_DATABASE_URL:-postgres://worlds:worlds-dev@127.0.0.1:55432/worlds} node --test \"test/crew-*.test.mjs\"",
```

- [ ] **Step 2: Write the failing test**

```js
// test/support/crew-db.mjs
import { randomUUID } from 'node:crypto'
import { connect } from '../../server/crew/store/db.mjs'
import { migrate } from '../../server/crew/store/migrate.mjs'

export const TEST_DB = process.env.WORLDS_TEST_DATABASE_URL || ''

/** Spread into `test(name, needsDb, fn)`: skips, and says why, where there is no Postgres. */
export const needsDb = TEST_DB ? {} : { skip: 'set WORLDS_TEST_DATABASE_URL to run the crew store tests' }

/**
 * Run against a schema of its own, migrated and then dropped, so tests never see each
 * other's rows and can run side by side.
 */
export async function withDb(run) {
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const admin = connect(TEST_DB, { max: 1 })
  await admin.unsafe(`create schema "${schema}"`)
  const sql = connect(TEST_DB, { schema })
  try {
    await migrate(sql)
    return await run(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin.unsafe(`drop schema "${schema}" cascade`)
    await admin.end({ timeout: 5 })
  }
}
```

```js
// test/crew-store.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { connect, isUniqueViolation, isUnavailable } from '../server/crew/store/db.mjs'
import { migrate } from '../server/crew/store/migrate.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

test('migrations run once, and a second run applies nothing', needsDb, async () => {
  await withDb(async (sql) => {
    assert.deepEqual(await migrate(sql), [])
    const [{ count }] = await sql`select count(*)::int as count from crew_migrations`
    assert.ok(count >= 1)
  })
})

test('two servers starting together do not both apply a migration', needsDb, async () => {
  await withDb(async (sql) => {
    await sql`delete from crew_migrations`
    await sql`drop table agents, workspaces`
    const results = await Promise.all([migrate(sql), migrate(sql)])
    assert.equal(results.flat().filter((name) => name === '001_roster.sql').length, 1)
  })
})

test('column names come back camel-cased', needsDb, async () => {
  await withDb(async (sql) => {
    const [row] = await sql`
      insert into agents (world_id, name, kind, runtime) values ('w', 'Ada', 'unit', 'claude-code')
      returning id, template_id, created_at`
    assert.ok('templateId' in row && 'createdAt' in row)
    assert.equal(row.templateId, null)
  })
})

test('a name is unique in its world whatever its case, and free again once retired', needsDb, async () => {
  await withDb(async (sql) => {
    const add = (world, name) =>
      sql`insert into agents (world_id, name, kind, runtime) values (${world}, ${name}, 'unit', 'claude-code') returning id`
    const [{ id }] = await add('w', 'Ada')
    await assert.rejects(add('w', 'ADA'), (error) => isUniqueViolation(error, 'agents_name_key'))
    await add('other', 'Ada')
    await sql`update agents set retired_at = now() where id = ${id}`
    await add('w', 'ada')
  })
})

test('a world holds one agent per curated template', needsDb, async () => {
  await withDb(async (sql) => {
    const add = (name) =>
      sql`insert into agents (world_id, name, kind, runtime, template_id) values ('w', ${name}, 'unit', 'hermes', 'quill')`
    await add('Quill')
    await assert.rejects(add('Quill2'), (error) => isUniqueViolation(error, 'agents_template_key'))
  })
})

test('a kind outside the two there are is refused by the database', needsDb, async () => {
  await withDb(async (sql) => {
    await assert.rejects(
      sql`insert into agents (world_id, name, kind, runtime) values ('w', 'Ada', 'dragon', 'hermes')`,
      /agents_kind_check/
    )
  })
})

test('a database that is not there is reported as unavailable, not as a fault', async () => {
  const sql = connect('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1 })
  try {
    await assert.rejects(sql`select 1`, (error) => isUnavailable(error))
  } finally {
    await sql.end({ timeout: 1 })
  }
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:crew`
Expected: FAIL with `Cannot find module '.../server/crew/store/db.mjs'`

- [ ] **Step 4: Write the migration**

```sql
-- server/crew/store/migrations/001_roster.sql
-- The roster and the workspaces. Every row belongs to a world.

create table agents (
  id          uuid primary key default uuidv7(),
  world_id    text not null,
  name        text not null,
  kind        text not null constraint agents_kind_check check (kind in ('unit', 'rock')),
  runtime     text not null,
  role        text not null default '',
  template_id text,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz
);

-- A retired agent gives its name back, so both rules apply to the living only.
create unique index agents_name_key on agents (world_id, lower(name)) where retired_at is null;
create unique index agents_template_key on agents (world_id, template_id)
  where template_id is not null and retired_at is null;
create index agents_world_idx on agents (world_id, created_at);

create table workspaces (
  id          uuid primary key default uuidv7(),
  world_id    text not null,
  name        text not null,
  description text not null default '',
  git_url     text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create unique index workspaces_name_key on workspaces (world_id, lower(name)) where archived_at is null;
create index workspaces_world_idx on workspaces (world_id, created_at);
```

- [ ] **Step 5: Write the store**

```js
// server/crew/store/db.mjs
import postgres from 'postgres'

/**
 * Open a pool on the crew database.
 *
 * `schema` puts every unqualified table name in that schema, which is how one Postgres can
 * hold several worlds' tables apart and how each test gets tables of its own.
 *
 * Column names are camel-cased on the way out (`template_id` is read as `templateId`). SQL
 * text is written in snake case as usual.
 *
 * @param {string} databaseUrl
 * @param {{schema?: string, max?: number}} [options]
 */
export function connect(databaseUrl, { schema = '', max = 10 } = {}) {
  return postgres(databaseUrl, {
    max,
    onnotice() {},
    connect_timeout: 5,
    transform: postgres.camel,
    connection: schema ? { search_path: schema } : {},
  })
}

/** Postgres refused a row because it would break a unique rule, optionally a named one. */
export function isUniqueViolation(error, constraint) {
  if (!error || error.code !== '23505') return false
  return constraint ? error.constraint_name === constraint : true
}

const UNREACHABLE = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  // The server is there and is not taking connections: starting up, shutting down, full.
  '57P01', '57P02', '57P03', '53300',
])

/** The database could not be reached at all, as opposed to answering with an error. */
export function isUnavailable(error) {
  if (!error) return false
  if (UNREACHABLE.has(error.code)) return true
  return Array.isArray(error.errors) && error.errors.some((inner) => UNREACHABLE.has(inner?.code))
}
```

```js
// server/crew/store/migrate.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Any fixed number: it only has to be the same in every server that migrates this database. */
const LOCK = 7311004

/**
 * Bring the schema up to date: every `.sql` file in `dir` that has not been applied, in name
 * order, each recorded in `crew_migrations`.
 *
 * All of it happens in one transaction behind an advisory lock, so two servers starting at
 * once take turns and the second finds nothing left to do, and a file that fails leaves the
 * database exactly as it was.
 *
 * A migration file is never edited once it has shipped. A change is a new file.
 *
 * @returns {Promise<string[]>} the files this call applied
 */
export async function migrate(sql, dir = MIGRATIONS) {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.sql')).sort()
  const applied = []
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK})`
    await tx`
      create table if not exists crew_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`
    const done = new Set((await tx`select name from crew_migrations`).map((row) => row.name))
    for (const file of files) {
      if (done.has(file)) continue
      await tx.unsafe(await fs.readFile(path.join(dir, file), 'utf8'))
      await tx`insert into crew_migrations (name) values (${file})`
      applied.push(file)
    }
  })
  return applied
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:crew`
Expected: PASS, with every test in `crew-store.test.mjs` run (none skipped)

Run: `node --test test/crew-store.test.mjs`
Expected: 6 tests skipped with the reason `set WORLDS_TEST_DATABASE_URL to run the crew store tests`, 1 passing

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/crew/store test/support/crew-db.mjs test/crew-store.test.mjs
git commit -m "feat: Postgres store and migrations for the crew (NODEX-312)"
```

---

### Task 3: Names and the curated catalog (NODEX-313)

**Files:**
- Create: `server/crew/names.mjs`
- Create: `server/crew/catalog.mjs`
- Create: `server/crew/templates/quill.json`
- Test: `test/crew-names.test.mjs`

**Interfaces:**
- Consumes: `CrewError` from Task 1.
- Produces:
  - `NAMES: string[]`, at least 60 distinct valid names.
  - `nameKey(name: string): string`. The form two names are compared in: trimmed and lower-cased.
  - `checkName(name: unknown): string`. Returns the trimmed name or throws `CrewError('bad_name', ..., 400)`.
  - `pickName(taken: Iterable<string>, rand?: () => number): string`. `taken` holds name keys. Throws `CrewError('no_names_left', ..., 409)` only if every candidate is taken.
  - `KINDS = ['unit', 'rock']`, `RUNTIMES = ['claude-code', 'hermes', 'openclaw']`.
  - `loadCatalog(dir?: string): Promise<Catalog>`.
  - `Catalog = { templates: Template[], byId: Map<string, Template>, reserved: Set<string> }`. `reserved` holds name keys.
  - `Template = { id: string, name: string, speciality: string, kind: 'unit' | 'rock', runtime: string, role: string, skills: string[] }`.

- [ ] **Step 1: Write the failing test**

```js
// test/crew-names.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NAMES, KINDS, RUNTIMES, checkName, nameKey, pickName } from '../server/crew/names.mjs'
import { loadCatalog } from '../server/crew/catalog.mjs'
import { CrewError } from '../server/crew/errors.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code

test('the name list is long enough, valid, and has no two alike', () => {
  assert.ok(NAMES.length >= 60)
  assert.equal(new Set(NAMES.map(nameKey)).size, NAMES.length)
  for (const name of NAMES) assert.equal(checkName(name), name)
})

test('a name is one word that can follow an @', () => {
  for (const good of ['Ada', 'ronnie', 'R2', 'Mary-Anne', 'big_al', 'Zoë']) assert.equal(checkName(good), good)
  for (const bad of ['', ' ', 'a', 'two words', '@ada', 'ada!', '9lives', '-ada', 'x'.repeat(25), null, 42, {}]) {
    assert.throws(() => checkName(bad), refused('bad_name'), `accepted ${JSON.stringify(bad)}`)
  }
})

test('padding is trimmed and case does not make a different name', () => {
  assert.equal(checkName('  Ada  '), 'Ada')
  assert.equal(nameKey(' ADA '), 'ada')
  assert.equal(nameKey('Zoë'), nameKey('ZOË'))
})

test('picking skips what is taken and never repeats itself into a corner', () => {
  const taken = new Set(NAMES.slice(1).map(nameKey))
  assert.equal(pickName(taken, () => 0.99), NAMES[0])
  assert.throws(() => pickName(new Set(NAMES.map(nameKey))), refused('no_names_left'))
})

test('the same roll gives the same name, so a test can know what it will get', () => {
  assert.equal(pickName(new Set(), () => 0), pickName(new Set(), () => 0))
  assert.notEqual(pickName(new Set(), () => 0), pickName(new Set(), () => 0.5))
})

test('the shipped catalog loads, and its names are reserved and not in the name list', async () => {
  const catalog = await loadCatalog()
  assert.ok(catalog.templates.length >= 1)
  const quill = catalog.byId.get('quill')
  assert.equal(quill.name, 'Quill')
  assert.ok(KINDS.includes(quill.kind) && RUNTIMES.includes(quill.runtime))
  assert.ok(quill.role.length > 20 && quill.speciality.length > 0)
  assert.ok(catalog.reserved.has('quill'))
  for (const name of NAMES) assert.ok(!catalog.reserved.has(nameKey(name)), `${name} is a specialist's name`)
})

async function catalogOf(...templates) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-catalog-'))
  await Promise.all(templates.map((t, i) => fs.writeFile(path.join(dir, `${i}.json`), JSON.stringify(t))))
  return dir
}
const sample = { id: 'sophie', name: 'Sophie', speciality: 'Social media', kind: 'rock', runtime: 'hermes', role: 'Runs social media campaigns end to end.', skills: [] }

test('a template that is missing something says which file and what', async () => {
  for (const [field, value] of [['name', 'two words'], ['kind', 'dragon'], ['runtime', 'gpt'], ['role', ''], ['id', 'Has Caps'], ['skills', 'none']]) {
    const dir = await catalogOf({ ...sample, [field]: value })
    await assert.rejects(loadCatalog(dir), new RegExp(`0\\.json.*${field}`))
  }
})

test('two templates cannot share an id or a name', async () => {
  await assert.rejects(loadCatalog(await catalogOf(sample, { ...sample, name: 'Other' })), /sophie/)
  await assert.rejects(loadCatalog(await catalogOf(sample, { ...sample, id: 'other', name: 'SOPHIE' })), /Sophie|SOPHIE/)
})

test('an empty catalog is allowed', async () => {
  const catalog = await loadCatalog(await catalogOf())
  assert.deepEqual(catalog.templates, [])
  assert.equal(catalog.reserved.size, 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/crew-names.test.mjs`
Expected: FAIL with `Cannot find module '.../server/crew/names.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// server/crew/names.mjs
import { CrewError } from './errors.mjs'

/** The two robots there are (see `src/agents/robots.js`). */
export const KINDS = ['unit', 'rock']

/** The runtimes an agent can be bound to. An adapter for each arrives in a later phase. */
export const RUNTIMES = ['claude-code', 'hermes', 'openclaw']

/**
 * What a new agent is called until somebody calls it something else. Short, friendly, easy
 * to type after an @, and none of them a curated specialist's name (a test holds that).
 */
export const NAMES = [
  'Ada', 'Alfie', 'Archie', 'Basil', 'Beans', 'Bertie', 'Biscuit', 'Bolt', 'Bramble', 'Buttons',
  'Chip', 'Clover', 'Cosmo', 'Daisy', 'Dash', 'Dexter', 'Dot', 'Ember', 'Fern', 'Fig',
  'Finn', 'Gizmo', 'Gus', 'Hazel', 'Hugo', 'Indy', 'Juno', 'Kit', 'Lenny', 'Lola',
  'Mabel', 'Maple', 'Milo', 'Mochi', 'Nell', 'Nico', 'Noodle', 'Olive', 'Otis', 'Pax',
  'Pepper', 'Pickle', 'Pip', 'Poppy', 'Remy', 'Rolo', 'Ronnie', 'Rusty', 'Sage', 'Scout',
  'Sprocket', 'Stella', 'Tansy', 'Tilly', 'Toby', 'Truffle', 'Vera', 'Waffle', 'Widget', 'Wren',
  'Ziggy', 'Zuzu',
]

/** A letter first, then letters, digits, hyphens or underscores: 2 to 24 characters, one word. */
const NAME = /^\p{L}[\p{L}\p{N}_-]{1,23}$/u

/** The form in which two names are the same name. */
export const nameKey = (name) => String(name).trim().toLowerCase()

/**
 * A name somebody typed, trimmed, or a refusal that says what a name has to be.
 * One word, because a crew member is addressed as `@name`.
 */
export function checkName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!NAME.test(trimmed)) {
    throw new CrewError(
      'bad_name',
      'A name is one word of 2 to 24 letters, digits, hyphens or underscores, starting with a letter',
      400
    )
  }
  return trimmed
}

/**
 * A name nobody in the world has. `taken` holds name keys, and should include the reserved
 * names as well as the ones in use.
 */
export function pickName(taken, rand = Math.random) {
  const used = taken instanceof Set ? taken : new Set(taken)
  const free = NAMES.filter((name) => !used.has(nameKey(name)))
  if (!free.length) throw new CrewError('no_names_left', 'Every ready-made name is in use: give this agent a name', 409)
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))]
}
```

```json
{
  "id": "quill",
  "name": "Quill",
  "speciality": "Research and briefings",
  "kind": "unit",
  "runtime": "hermes",
  "role": "You are Quill, a research specialist. Given a question, you find primary sources, weigh them against each other, and write a short briefing that states what is known, how well it is supported, and what is still open. You cite every claim and you say so plainly when the evidence is thin.",
  "skills": []
}
```

Save that as `server/crew/templates/quill.json`.

```js
// server/crew/catalog.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, RUNTIMES, checkName, nameKey } from './names.mjs'

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates')
const ID = /^[a-z][a-z0-9-]{1,39}$/

/**
 * The curated specialists this server knows how to make: one JSON file each in `templates/`.
 *
 * A template's name is its agent's name, fixed and reserved in every world whether or not
 * that world may use it. Which templates a world may use is configuration (`entitled`), not
 * something the catalog knows.
 *
 * A bad file stops the server from starting, and says which file and which field. A
 * specialist that half loads is worse than one that is plainly missing.
 */
export async function loadCatalog(dir = TEMPLATES) {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort()
  const templates = []
  const byId = new Map()
  const reserved = new Set()

  for (const file of files) {
    const fail = (field, why) => {
      throw new Error(`Curated template ${file}: ${field} ${why}`)
    }
    let raw
    try {
      raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))
    } catch (error) {
      fail('file', `is not valid JSON (${error.message})`)
    }
    if (typeof raw.id !== 'string' || !ID.test(raw.id)) fail('id', 'must be lower-case letters, digits and hyphens')
    let name
    try {
      name = checkName(raw.name)
    } catch (error) {
      fail('name', `is not a usable name: ${error.message}`)
    }
    if (!KINDS.includes(raw.kind)) fail('kind', `must be one of ${KINDS.join(', ')}`)
    if (!RUNTIMES.includes(raw.runtime)) fail('runtime', `must be one of ${RUNTIMES.join(', ')}`)
    if (typeof raw.speciality !== 'string' || !raw.speciality.trim()) fail('speciality', 'must say what this agent is for')
    if (typeof raw.role !== 'string' || !raw.role.trim()) fail('role', 'must hold the agent\'s instructions')
    if (!Array.isArray(raw.skills) || raw.skills.some((skill) => typeof skill !== 'string')) fail('skills', 'must be a list of names')
    if (byId.has(raw.id)) fail('id', `"${raw.id}" is used by another template`)
    if (reserved.has(nameKey(name))) fail('name', `"${name}" is used by another template`)

    const template = Object.freeze({
      id: raw.id,
      name,
      speciality: raw.speciality.trim(),
      kind: raw.kind,
      runtime: raw.runtime,
      role: raw.role.trim(),
      skills: Object.freeze([...raw.skills]),
    })
    templates.push(template)
    byId.set(template.id, template)
    reserved.add(nameKey(name))
  }
  return { templates, byId, reserved }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/crew-names.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add server/crew/names.mjs server/crew/catalog.mjs server/crew/templates test/crew-names.test.mjs
git commit -m "feat: friendly agent names and the curated catalog (NODEX-313)"
```

---

### Task 4: The roster (NODEX-313)

**Files:**
- Create: `server/crew/roster.mjs`
- Test: `test/crew-roster.test.mjs`

**Interfaces:**
- Consumes:
  - `Sql`, `isUniqueViolation` from Task 2.
  - `KINDS`, `RUNTIMES`, `checkName`, `nameKey`, `pickName` and `Catalog` from Task 3.
  - `CrewError` from Task 1.
- Produces `createRoster({ sql, worldId, catalog, limit, entitled, rand? }): Roster` where:
  - `Roster.list(): Promise<Agent[]>`, oldest first.
  - `Roster.get(id: string): Promise<Agent>`. Throws `CrewError('unknown_agent', ..., 404)`.
  - `Roster.create({ name?, kind?, runtime, role? }): Promise<Agent>`.
  - `Roster.createCurated(templateId: string): Promise<Agent>`.
  - `Roster.update(id, { name?, role? }): Promise<Agent>`.
  - `Roster.retire(id): Promise<void>`.
  - `Roster.counts(): Promise<{ standard: { used: number, limit: number }, curated: { used: number } }>`.
  - `Roster.specialists(): Promise<Array<Template & { entitled: boolean, agentId: string | null }>>`.
  - `Agent = { id, name, kind, runtime, role, curated: boolean, templateId: string | null, speciality: string | null, createdAt: Date }`.
  - Refusal codes: `agent_limit` 409, `name_taken` 409, `name_reserved` 409, `bad_name` 400, `bad_kind` 400, `bad_runtime` 400, `bad_role` 400, `unknown_template` 404, `not_entitled` 403, `already_added` 409, `name_fixed` 409, `role_fixed` 409, `unknown_agent` 404.

- [ ] **Step 1: Write the failing test**

```js
// test/crew-roster.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoster } from '../server/crew/roster.mjs'
import { loadCatalog } from '../server/crew/catalog.mjs'
import { NAMES } from '../server/crew/names.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code

/** A roster on a schema of its own. `options` overrides the world, limit and entitlements. */
const withRoster = (options, run) =>
  withDb(async (sql) => {
    const catalog = await loadCatalog()
    const make = (more = {}) =>
      createRoster({ sql, worldId: 'w', catalog, limit: 6, entitled: ['quill'], rand: () => 0, ...options, ...more })
    return run(make(), { sql, make })
  })

test('a new agent gets a friendly name, a robot and an empty role', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const agent = await roster.create({ runtime: 'claude-code' })
    assert.equal(agent.name, NAMES[0])
    assert.ok(['unit', 'rock'].includes(agent.kind))
    assert.equal(agent.role, '')
    assert.equal(agent.curated, false)
    assert.equal(agent.templateId, null)
    assert.equal(agent.speciality, null)
    assert.match(agent.id, /^[0-9a-f-]{36}$/)
    assert.deepEqual((await roster.list()).map((a) => a.id), [agent.id])
    assert.deepEqual(await roster.get(agent.id), agent)
  })
})

test('the second agent does not get the first one\'s name', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const a = await roster.create({ runtime: 'hermes' })
    const b = await roster.create({ runtime: 'hermes' })
    assert.notEqual(a.name, b.name)
  })
})

test('a chosen name, kind and role are kept as given', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const agent = await roster.create({ name: ' Ronnie ', kind: 'rock', runtime: 'openclaw', role: ' Reviews pull requests. ' })
    assert.equal(agent.name, 'Ronnie')
    assert.equal(agent.kind, 'rock')
    assert.equal(agent.runtime, 'openclaw')
    assert.equal(agent.role, 'Reviews pull requests.')
  })
})

test('what cannot be an agent is refused, and says why', needsDb, async () => {
  await withRoster({}, async (roster) => {
    await assert.rejects(roster.create({}), refused('bad_runtime'))
    await assert.rejects(roster.create({ runtime: 'gpt' }), refused('bad_runtime'))
    await assert.rejects(roster.create({ runtime: 'hermes', kind: 'dragon' }), refused('bad_kind'))
    await assert.rejects(roster.create({ runtime: 'hermes', name: 'two words' }), refused('bad_name'))
    await assert.rejects(roster.create({ runtime: 'hermes', role: 42 }), refused('bad_role'))
    await assert.rejects(roster.create({ runtime: 'hermes', role: 'x'.repeat(8001) }), refused('bad_role'))
    assert.deepEqual(await roster.list(), [])
  })
})

test('a name in use is taken whatever its case or padding', needsDb, async () => {
  await withRoster({}, async (roster) => {
    await roster.create({ name: 'Ada', runtime: 'hermes' })
    for (const again of ['Ada', 'ada', ' ADA ']) {
      await assert.rejects(roster.create({ name: again, runtime: 'hermes' }), refused('name_taken'))
    }
  })
})

test('a specialist\'s name is reserved, entitled or not, in any case', needsDb, async () => {
  await withRoster({ entitled: [] }, async (roster) => {
    for (const name of ['Quill', 'quill', ' QUILL ']) {
      await assert.rejects(roster.create({ name, runtime: 'hermes' }), refused('name_reserved'))
    }
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    await assert.rejects(roster.update(ada.id, { name: 'quill' }), refused('name_reserved'))
  })
})

test('the limit is the limit, and the refusal gives the count', needsDb, async () => {
  await withRoster({ limit: 2 }, async (roster) => {
    await roster.create({ runtime: 'hermes' })
    await roster.create({ runtime: 'hermes' })
    await assert.rejects(roster.create({ runtime: 'hermes' }), (error) => {
      assert.ok(refused('agent_limit')(error))
      assert.match(error.message, /2 of 2/)
      return true
    })
    assert.deepEqual((await roster.counts()).standard, { used: 2, limit: 2 })
  })
})

test('two creations racing for the last place: one agent, one refusal', needsDb, async () => {
  await withRoster({ limit: 3 }, async (roster) => {
    await roster.create({ runtime: 'hermes' })
    await roster.create({ runtime: 'hermes' })
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => roster.create({ runtime: 'hermes' }))
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    for (const r of results.filter((r) => r.status === 'rejected')) assert.ok(refused('agent_limit')(r.reason))
    assert.equal((await roster.list()).length, 3)
  })
})

test('a limit lowered below the count keeps the agents and refuses new ones', needsDb, async () => {
  await withRoster({ limit: 3 }, async (roster, { make }) => {
    for (let i = 0; i < 3; i++) await roster.create({ runtime: 'hermes' })
    const smaller = make({ limit: 1 })
    assert.equal((await smaller.list()).length, 3)
    assert.deepEqual((await smaller.counts()).standard, { used: 3, limit: 1 })
    await assert.rejects(smaller.create({ runtime: 'hermes' }), /3 of 1/)
  })
})

test('retiring an agent frees its place and its name', needsDb, async () => {
  await withRoster({ limit: 1 }, async (roster) => {
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    await roster.retire(ada.id)
    assert.deepEqual(await roster.list(), [])
    await assert.rejects(roster.get(ada.id), refused('unknown_agent'))
    await assert.rejects(roster.retire(ada.id), refused('unknown_agent'))
    const again = await roster.create({ name: 'ada', runtime: 'hermes' })
    assert.notEqual(again.id, ada.id)
  })
})

test('renaming keeps the agent, and its own name in another case is allowed', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const ada = await roster.create({ name: 'Ada', runtime: 'hermes' })
    const other = await roster.create({ name: 'Bolt', runtime: 'hermes' })
    assert.equal((await roster.update(ada.id, { name: 'ADA' })).name, 'ADA')
    const renamed = await roster.update(ada.id, { name: 'Grace', role: 'Writes docs.' })
    assert.deepEqual([renamed.id, renamed.name, renamed.role], [ada.id, 'Grace', 'Writes docs.'])
    await assert.rejects(roster.update(ada.id, { name: 'bolt' }), refused('name_taken'))
    await assert.rejects(roster.update(ada.id, { name: 'no good' }), refused('bad_name'))
    assert.equal((await roster.update(other.id, {})).name, 'Bolt')
    await assert.rejects(roster.update('00000000-0000-7000-8000-000000000000', { name: 'Zed' }), refused('unknown_agent'))
    await assert.rejects(roster.update('not-an-id', { name: 'Zed' }), refused('unknown_agent'))
  })
})

test('a specialist comes from its template and does not use a standard place', needsDb, async () => {
  await withRoster({ limit: 1 }, async (roster) => {
    await roster.create({ runtime: 'claude-code' })
    const quill = await roster.createCurated('quill')
    assert.equal(quill.name, 'Quill')
    assert.equal(quill.curated, true)
    assert.equal(quill.templateId, 'quill')
    assert.equal(quill.speciality, 'Research and briefings')
    assert.equal(quill.runtime, 'hermes')
    assert.match(quill.role, /research specialist/)
    assert.deepEqual(await roster.counts(), { standard: { used: 1, limit: 1 }, curated: { used: 1 } })
  })
})

test('there is never a second one, and its name and role cannot be changed', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const quill = await roster.createCurated('quill')
    await assert.rejects(roster.createCurated('quill'), refused('already_added'))
    await assert.rejects(roster.update(quill.id, { name: 'Feather' }), refused('name_fixed'))
    await assert.rejects(roster.update(quill.id, { role: 'Something else.' }), refused('role_fixed'))
    assert.equal((await roster.get(quill.id)).name, 'Quill')
  })
})

test('a specialist the world has not bought is refused by name, and one that does not exist is unknown', needsDb, async () => {
  await withRoster({ entitled: [] }, async (roster) => {
    await assert.rejects(roster.createCurated('quill'), (error) => {
      assert.ok(refused('not_entitled')(error))
      assert.match(error.message, /Quill/)
      return true
    })
    await assert.rejects(roster.createCurated('nobody'), refused('unknown_template'))
  })
})

test('a retired specialist can be added again', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const first = await roster.createCurated('quill')
    await roster.retire(first.id)
    const second = await roster.createCurated('quill')
    assert.notEqual(second.id, first.id)
  })
})

test('the specialists list says which the world may have and which it has', needsDb, async () => {
  await withRoster({}, async (roster) => {
    const before = (await roster.specialists()).find((s) => s.id === 'quill')
    assert.deepEqual([before.entitled, before.agentId, before.name], [true, null, 'Quill'])
    const quill = await roster.createCurated('quill')
    assert.equal((await roster.specialists()).find((s) => s.id === 'quill').agentId, quill.id)
  })
  await withRoster({ entitled: [] }, async (roster) => {
    assert.equal((await roster.specialists()).find((s) => s.id === 'quill').entitled, false)
  })
})

test('one world never sees another world\'s agents or names', needsDb, async () => {
  await withRoster({}, async (roster, { make }) => {
    const mine = await roster.create({ name: 'Ada', runtime: 'hermes' })
    const theirs = make({ worldId: 'other' })
    assert.deepEqual(await theirs.list(), [])
    await assert.rejects(theirs.get(mine.id), refused('unknown_agent'))
    await assert.rejects(theirs.retire(mine.id), refused('unknown_agent'))
    assert.equal((await theirs.create({ name: 'Ada', runtime: 'hermes' })).name, 'Ada')
    assert.equal((await roster.list()).length, 1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:crew`
Expected: FAIL with `Cannot find module '.../server/crew/roster.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// server/crew/roster.mjs
import { CrewError } from './errors.mjs'
import { KINDS, RUNTIMES, checkName, nameKey, pickName } from './names.mjs'
import { isUniqueViolation } from './store/db.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Long enough for real instructions, short enough that nobody stores a book in it. */
const ROLE_LIMIT = 8000

/**
 * A world's agents: who they are, how many there may be, and what they are called.
 *
 * Two kinds. A standard agent is the customer's own to name and instruct, and counts against
 * the world's limit. A curated agent is made from a catalog template the world is entitled
 * to: its name and instructions are the template's and stay that way, there is at most one
 * of each, and it does not use a standard place.
 *
 * An agent is durable. It is never deleted, only retired, which gives back its place and its
 * name and keeps its history.
 *
 * @param {{sql: any, worldId: string, catalog: {templates: any[], byId: Map<string, any>,
 *   reserved: Set<string>}, limit: number, entitled: string[], rand?: () => number}} options
 */
export function createRoster({ sql, worldId, catalog, limit, entitled, rand = Math.random }) {
  const allowed = new Set(entitled)

  /** What the rest of the server sees. A curated agent's role is read from its template. */
  const present = (row) => {
    const template = row.templateId ? catalog.byId.get(row.templateId) : null
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      runtime: row.runtime,
      role: template ? template.role : row.role,
      curated: Boolean(row.templateId),
      templateId: row.templateId,
      speciality: template ? template.speciality : null,
      createdAt: row.createdAt,
    }
  }

  /**
   * One creation at a time in a world. Counting and then inserting is two steps, and without
   * this two requests arriving together would both count five and both become the sixth.
   */
  const oneAtATime = (tx) => tx`select pg_advisory_xact_lock(hashtext(${'crew-roster:' + worldId}))`

  const living = (db) => db`
    select id, name, kind, runtime, role, template_id, created_at
    from agents where world_id = ${worldId} and retired_at is null
    order by created_at, id`

  const checkRole = (role) => {
    if (role === undefined) return ''
    if (typeof role !== 'string' || role.length > ROLE_LIMIT) {
      throw new CrewError('bad_role', `A role is text of at most ${ROLE_LIMIT} characters`, 400)
    }
    return role.trim()
  }

  /** A name somebody asked for: well formed, not a specialist's, not in use. */
  const checkFree = (name, rows, exceptId) => {
    const wanted = checkName(name)
    const key = nameKey(wanted)
    if (catalog.reserved.has(key)) {
      throw new CrewError('name_reserved', `"${wanted}" is the name of a Nodexeus specialist`, 409)
    }
    if (rows.some((row) => row.id !== exceptId && nameKey(row.name) === key)) {
      throw new CrewError('name_taken', `There is already an agent called ${wanted}`, 409)
    }
    return wanted
  }

  const taken = (error) =>
    isUniqueViolation(error, 'agents_name_key')
      ? new CrewError('name_taken', 'There is already an agent with that name', 409)
      : error

  async function list() {
    return (await living(sql)).map(present)
  }

  async function get(id) {
    const unknown = new CrewError('unknown_agent', 'There is no such agent in this world', 404)
    if (typeof id !== 'string' || !UUID.test(id)) throw unknown
    const [row] = await sql`
      select id, name, kind, runtime, role, template_id, created_at
      from agents where id = ${id} and world_id = ${worldId} and retired_at is null`
    if (!row) throw unknown
    return present(row)
  }

  async function create({ name, kind, runtime, role } = {}) {
    if (!RUNTIMES.includes(runtime)) {
      throw new CrewError('bad_runtime', `A runtime is one of ${RUNTIMES.join(', ')}`, 400)
    }
    if (kind !== undefined && !KINDS.includes(kind)) {
      throw new CrewError('bad_kind', `A robot is one of ${KINDS.join(', ')}`, 400)
    }
    const text = checkRole(role)

    try {
      return await sql.begin(async (tx) => {
        await oneAtATime(tx)
        const rows = await living(tx)
        const used = rows.filter((row) => !row.templateId).length
        if (used >= limit) {
          throw new CrewError('agent_limit', `This world has ${used} of ${limit} agents`, 409)
        }
        const chosen = name === undefined
          ? pickName(new Set([...rows.map((row) => nameKey(row.name)), ...catalog.reserved]), rand)
          : checkFree(name, rows)
        const robot = kind ?? KINDS[Math.min(KINDS.length - 1, Math.floor(rand() * KINDS.length))]
        const [row] = await tx`
          insert into agents (world_id, name, kind, runtime, role)
          values (${worldId}, ${chosen}, ${robot}, ${runtime}, ${text})
          returning id, name, kind, runtime, role, template_id, created_at`
        return present(row)
      })
    } catch (error) {
      throw taken(error)
    }
  }

  async function createCurated(templateId) {
    const template = typeof templateId === 'string' ? catalog.byId.get(templateId) : null
    if (!template) throw new CrewError('unknown_template', 'There is no such specialist', 404)
    if (!allowed.has(template.id)) {
      throw new CrewError('not_entitled', `${template.name} is an upgrade this world does not have`, 403)
    }
    const already = new CrewError('already_added', `${template.name} is already in this world`, 409)
    try {
      return await sql.begin(async (tx) => {
        await oneAtATime(tx)
        const rows = await living(tx)
        if (rows.some((row) => row.templateId === template.id)) throw already
        const [row] = await tx`
          insert into agents (world_id, name, kind, runtime, role, template_id)
          values (${worldId}, ${template.name}, ${template.kind}, ${template.runtime}, '', ${template.id})
          returning id, name, kind, runtime, role, template_id, created_at`
        return present(row)
      })
    } catch (error) {
      if (isUniqueViolation(error, 'agents_template_key')) throw already
      throw taken(error)
    }
  }

  async function update(id, { name, role } = {}) {
    const current = await get(id)
    if (current.curated && name !== undefined) {
      throw new CrewError('name_fixed', `${current.name} is a specialist and keeps its name`, 409)
    }
    if (current.curated && role !== undefined) {
      throw new CrewError('role_fixed', `${current.name} is a specialist and keeps its role`, 409)
    }
    if (name === undefined && role === undefined) return current
    const text = role === undefined ? current.role : checkRole(role)

    try {
      return await sql.begin(async (tx) => {
        await oneAtATime(tx)
        const rows = await living(tx)
        const chosen = name === undefined ? current.name : checkFree(name, rows, id)
        const [row] = await tx`
          update agents set name = ${chosen}, role = ${text}
          where id = ${id} and world_id = ${worldId} and retired_at is null
          returning id, name, kind, runtime, role, template_id, created_at`
        if (!row) throw new CrewError('unknown_agent', 'There is no such agent in this world', 404)
        return present(row)
      })
    } catch (error) {
      throw taken(error)
    }
  }

  async function retire(id) {
    await get(id)
    const rows = await sql`
      update agents set retired_at = now()
      where id = ${id} and world_id = ${worldId} and retired_at is null
      returning id`
    if (!rows.length) throw new CrewError('unknown_agent', 'There is no such agent in this world', 404)
  }

  async function counts() {
    const rows = await living(sql)
    const curated = rows.filter((row) => row.templateId).length
    return { standard: { used: rows.length - curated, limit }, curated: { used: curated } }
  }

  async function specialists() {
    const rows = await living(sql)
    return catalog.templates.map((template) => ({
      ...template,
      entitled: allowed.has(template.id),
      agentId: rows.find((row) => row.templateId === template.id)?.id ?? null,
    }))
  }

  return { list, get, create, createCurated, update, retire, counts, specialists }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:crew`
Expected: PASS, all of `crew-roster.test.mjs` (17 tests) and everything from Tasks 1 to 3

- [ ] **Step 5: Commit**

```bash
git add server/crew/roster.mjs test/crew-roster.test.mjs
git commit -m "feat: a roster of durable agents, standard and curated (NODEX-313)"
```

---

### Task 5: Workspaces (NODEX-314)

**Files:**
- Create: `server/crew/workspaces.mjs`
- Test: `test/crew-workspaces.test.mjs`

**Interfaces:**
- Consumes: `Sql`, `isUniqueViolation` from Task 2; `CrewError` from Task 1.
- Produces:
  - `checkGitUrl(url: unknown): string`. Returns the trimmed address or throws `CrewError('bad_git_url', ..., 400)`.
  - `createWorkspaces({ sql, worldId, dataDir, clone? }): Workspaces`. `clone` is `(url: string, folder: string) => Promise<void>` and defaults to running `git clone`.
  - `Workspaces.list(): Promise<Workspace[]>`, oldest first.
  - `Workspaces.get(id): Promise<Workspace>`. Throws `CrewError('unknown_workspace', ..., 404)`.
  - `Workspaces.create({ name, description?, gitUrl? }): Promise<Workspace>`.
  - `Workspaces.update(id, { name?, description? }): Promise<Workspace>`.
  - `Workspaces.archive(id): Promise<void>`. The folder is kept on disk.
  - `Workspaces.folderOf(id: string): string`. Absolute path `<dataDir>/workspaces/<id>`.
  - `Workspace = { id, name, description, gitUrl: string | null, folder: string, createdAt: Date }`.
  - Refusal codes: `bad_workspace_name` 400, `bad_description` 400, `bad_git_url` 400, `workspace_name_taken` 409, `clone_failed` 422, `unknown_workspace` 404.

- [ ] **Step 1: Write the failing test**

```js
// test/crew-workspaces.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checkGitUrl, createWorkspaces } from '../server/crew/workspaces.mjs'
import { CrewError } from '../server/crew/errors.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code
const exists = (file) => fs.access(file).then(() => true, () => false)

const withWorkspaces = (run, options = {}) =>
  withDb(async (sql) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-ws-'))
    const cloned = []
    const clone = async (url, folder) => {
      cloned.push([url, folder])
      await fs.writeFile(path.join(folder, 'README.md'), `from ${url}`)
    }
    const make = (more = {}) => createWorkspaces({ sql, worldId: 'w', dataDir, clone, ...options, ...more })
    try {
      return await run(make(), { sql, dataDir, cloned, make })
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })

test('an address git would treat as a command or a local path is refused before git runs', () => {
  for (const good of ['https://github.com/nodexeus/worlds.git', 'ssh://git@github.com/nodexeus/worlds.git', 'git@github.com:nodexeus/worlds.git', '  https://example.com/a.git  ']) {
    assert.equal(checkGitUrl(good), good.trim())
  }
  for (const bad of [
    '--upload-pack=touch /tmp/owned', '-oProxyCommand=evil', 'ext::sh -c evil', 'file:///etc', '/etc/passwd',
    '../other', 'http://insecure.example/a.git', 'https://exa mple.com/a.git', 'https://example.com/a.git\n--config', '', 42, null,
  ]) {
    assert.throws(() => checkGitUrl(bad), refused('bad_git_url'), `accepted ${JSON.stringify(bad)}`)
  }
})

test('a workspace is a row and an empty folder under the data directory', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    const site = await workspaces.create({ name: ' Marketing site ', description: ' The public website. ' })
    assert.equal(site.name, 'Marketing site')
    assert.equal(site.description, 'The public website.')
    assert.equal(site.gitUrl, null)
    assert.equal(site.folder, path.join(dataDir, 'workspaces', site.id))
    assert.equal(workspaces.folderOf(site.id), site.folder)
    assert.deepEqual(await fs.readdir(site.folder), [])
    assert.deepEqual(await workspaces.list(), [site])
    assert.deepEqual(await workspaces.get(site.id), site)
  })
})

test('the folder is named by the id, never by anything a person typed', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    const sneaky = await workspaces.create({ name: '../../escape' })
    assert.ok(sneaky.folder.startsWith(path.join(dataDir, 'workspaces') + path.sep))
    assert.match(path.basename(sneaky.folder), /^[0-9a-f-]{36}$/)
    assert.ok(!(await exists(path.join(dataDir, '..', 'escape'))))
  })
})

test('what cannot be a workspace is refused and leaves nothing behind', needsDb, async () => {
  await withWorkspaces(async (workspaces, { dataDir }) => {
    for (const name of [undefined, '', '   ', 'x'.repeat(49), 'line\nbreak', 42]) {
      await assert.rejects(workspaces.create({ name }), refused('bad_workspace_name'))
    }
    await assert.rejects(workspaces.create({ name: 'A', description: 'x'.repeat(201) }), refused('bad_description'))
    await assert.rejects(workspaces.create({ name: 'A', description: 42 }), refused('bad_description'))
    await assert.rejects(workspaces.create({ name: 'A', gitUrl: 'file:///etc' }), refused('bad_git_url'))
    assert.deepEqual(await workspaces.list(), [])
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'workspaces')).catch(() => []), [])
  })
})

test('a name in use is taken whatever its case', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    await workspaces.create({ name: 'Billing' })
    await assert.rejects(workspaces.create({ name: 'billing' }), refused('workspace_name_taken'))
  })
})

test('a git source is cloned into the folder', needsDb, async () => {
  await withWorkspaces(async (workspaces, { cloned }) => {
    const repo = await workspaces.create({ name: 'Repo', gitUrl: 'https://example.com/a.git' })
    assert.equal(repo.gitUrl, 'https://example.com/a.git')
    assert.deepEqual(cloned, [['https://example.com/a.git', repo.folder]])
    assert.equal(await fs.readFile(path.join(repo.folder, 'README.md'), 'utf8'), 'from https://example.com/a.git')
  })
})

test('a clone that fails leaves no workspace and no folder, and says what git said', needsDb, async () => {
  await withWorkspaces(
    async (workspaces, { dataDir }) => {
      await assert.rejects(workspaces.create({ name: 'Repo', gitUrl: 'https://example.com/a.git' }), (error) => {
        assert.ok(refused('clone_failed')(error))
        assert.match(error.message, /repository not found/)
        return true
      })
      assert.deepEqual(await workspaces.list(), [])
      assert.deepEqual(await fs.readdir(path.join(dataDir, 'workspaces')), [])
      assert.equal((await workspaces.create({ name: 'Repo' })).name, 'Repo')
    },
    { clone: async () => { throw new Error('fatal: repository not found') } }
  )
})

test('renaming and describing keep the workspace and its folder', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    const a = await workspaces.create({ name: 'Alpha' })
    await workspaces.create({ name: 'Beta' })
    const b = await workspaces.update(a.id, { name: 'Gamma', description: 'Now described.' })
    assert.deepEqual([b.id, b.name, b.description, b.folder], [a.id, 'Gamma', 'Now described.', a.folder])
    assert.equal((await workspaces.update(a.id, { name: 'GAMMA' })).name, 'GAMMA')
    assert.equal((await workspaces.update(a.id, {})).name, 'GAMMA')
    await assert.rejects(workspaces.update(a.id, { name: 'beta' }), refused('workspace_name_taken'))
    await assert.rejects(workspaces.update(a.id, { name: '' }), refused('bad_workspace_name'))
    await assert.rejects(workspaces.update('not-an-id', { name: 'X' }), refused('unknown_workspace'))
  })
})

test('archiving takes it off the list, frees the name, and keeps the files', needsDb, async () => {
  await withWorkspaces(async (workspaces) => {
    const a = await workspaces.create({ name: 'Alpha' })
    await fs.writeFile(path.join(a.folder, 'work.txt'), 'kept')
    await workspaces.archive(a.id)
    assert.deepEqual(await workspaces.list(), [])
    await assert.rejects(workspaces.get(a.id), refused('unknown_workspace'))
    await assert.rejects(workspaces.archive(a.id), refused('unknown_workspace'))
    assert.equal(await fs.readFile(path.join(a.folder, 'work.txt'), 'utf8'), 'kept')
    assert.notEqual((await workspaces.create({ name: 'alpha' })).id, a.id)
  })
})

test('one world never sees another world\'s workspaces', needsDb, async () => {
  await withWorkspaces(async (workspaces, { make }) => {
    const mine = await workspaces.create({ name: 'Alpha' })
    const theirs = make({ worldId: 'other' })
    assert.deepEqual(await theirs.list(), [])
    await assert.rejects(theirs.get(mine.id), refused('unknown_workspace'))
    await assert.rejects(theirs.archive(mine.id), refused('unknown_workspace'))
    assert.equal((await theirs.create({ name: 'Alpha' })).name, 'Alpha')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:crew`
Expected: FAIL with `Cannot find module '.../server/crew/workspaces.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// server/crew/workspaces.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { CrewError } from './errors.mjs'
import { isUniqueViolation } from './store/db.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_LIMIT = 48
const DESCRIPTION_LIMIT = 200

/** https, ssh, or the `user@host:path` short form. Nothing local and nothing git runs. */
const GIT_URL = /^(https:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[^\s\u0000-\u001f]+$/

/**
 * A git address that is safe to hand to `git clone`.
 *
 * Git treats some things that look like addresses as instructions: an argument starting with
 * a hyphen is an option, `ext::` runs a command, and `file://` or a bare path reads the
 * server's own disk. All of those are refused here, before git is ever started.
 */
export function checkGitUrl(url) {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  if (!trimmed || !GIT_URL.test(trimmed)) {
    throw new CrewError('bad_git_url', 'A git source is an https:// or ssh:// address', 400)
  }
  return trimmed
}

/** Clone without ever stopping to ask for a password: there is nobody to answer. */
function gitClone(url, folder) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['clone', '--', url, folder],
      { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, _stdout, stderr) => {
        if (!error) return resolve()
        const said = String(stderr || error.message).trim().split('\n').pop()
        reject(new Error(said || 'git clone failed'))
      }
    )
  })
}

/**
 * A world's workspaces: named projects, each with a folder of its own on the data volume.
 *
 * The folder is named by the workspace's id and nothing else, so no name anybody types can
 * reach outside the data directory, and renaming a workspace moves nothing on disk.
 *
 * Archiving takes a workspace off the campus and frees its name. Its files stay where they
 * are: work is never deleted by a click.
 *
 * @param {{sql: any, worldId: string, dataDir: string,
 *   clone?: (url: string, folder: string) => Promise<void>}} options
 */
export function createWorkspaces({ sql, worldId, dataDir, clone = gitClone }) {
  const root = path.join(dataDir, 'workspaces')
  const folderOf = (id) => path.join(root, id)

  const present = (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    gitUrl: row.gitUrl,
    folder: folderOf(row.id),
    createdAt: row.createdAt,
  })

  const checkName = (name) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed || trimmed.length > NAME_LIMIT || /[\u0000-\u001f]/.test(trimmed)) {
      throw new CrewError('bad_workspace_name', `A workspace name is 1 to ${NAME_LIMIT} characters on one line`, 400)
    }
    return trimmed
  }

  const checkDescription = (description) => {
    if (description === undefined) return ''
    if (typeof description !== 'string' || description.trim().length > DESCRIPTION_LIMIT) {
      throw new CrewError('bad_description', `A description is text of at most ${DESCRIPTION_LIMIT} characters`, 400)
    }
    return description.trim()
  }

  const taken = (error) =>
    isUniqueViolation(error, 'workspaces_name_key')
      ? new CrewError('workspace_name_taken', 'There is already a workspace with that name', 409)
      : error

  async function list() {
    const rows = await sql`
      select id, name, description, git_url, created_at
      from workspaces where world_id = ${worldId} and archived_at is null
      order by created_at, id`
    return rows.map(present)
  }

  async function get(id) {
    const unknown = new CrewError('unknown_workspace', 'There is no such workspace in this world', 404)
    if (typeof id !== 'string' || !UUID.test(id)) throw unknown
    const [row] = await sql`
      select id, name, description, git_url, created_at
      from workspaces where id = ${id} and world_id = ${worldId} and archived_at is null`
    if (!row) throw unknown
    return present(row)
  }

  async function create({ name, description, gitUrl } = {}) {
    const chosen = checkName(name)
    const about = checkDescription(description)
    const source = gitUrl === undefined || gitUrl === null ? null : checkGitUrl(gitUrl)

    let row
    try {
      ;[row] = await sql`
        insert into workspaces (world_id, name, description, git_url)
        values (${worldId}, ${chosen}, ${about}, ${source})
        returning id, name, description, git_url, created_at`
    } catch (error) {
      throw taken(error)
    }

    const folder = folderOf(row.id)
    try {
      await fs.mkdir(folder, { recursive: true })
      if (source) await clone(source, folder)
    } catch (error) {
      // Nothing half made: a workspace with no folder, or a folder with no workspace, would
      // each be found later by somebody with no idea how it got there.
      await sql`delete from workspaces where id = ${row.id}`
      await fs.rm(folder, { recursive: true, force: true })
      if (source) throw new CrewError('clone_failed', `Could not clone that source: ${error.message}`, 422)
      throw error
    }
    return present(row)
  }

  async function update(id, { name, description } = {}) {
    const current = await get(id)
    if (name === undefined && description === undefined) return current
    const chosen = name === undefined ? current.name : checkName(name)
    const about = description === undefined ? current.description : checkDescription(description)
    try {
      const [row] = await sql`
        update workspaces set name = ${chosen}, description = ${about}
        where id = ${id} and world_id = ${worldId} and archived_at is null
        returning id, name, description, git_url, created_at`
      if (!row) throw new CrewError('unknown_workspace', 'There is no such workspace in this world', 404)
      return present(row)
    } catch (error) {
      throw taken(error)
    }
  }

  async function archive(id) {
    await get(id)
    const rows = await sql`
      update workspaces set archived_at = now()
      where id = ${id} and world_id = ${worldId} and archived_at is null
      returning id`
    if (!rows.length) throw new CrewError('unknown_workspace', 'There is no such workspace in this world', 404)
  }

  return { list, get, create, update, archive, folderOf }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:crew`
Expected: PASS, all of `crew-workspaces.test.mjs` (10 tests) and everything before it

- [ ] **Step 5: Commit**

```bash
git add server/crew/workspaces.mjs test/crew-workspaces.test.mjs
git commit -m "feat: workspaces with a folder each on the data volume (NODEX-314)"
```

---

### Task 6: Starting the crew, and refusing to start without storage (NODEX-315)

**Files:**
- Create: `server/crew/index.mjs`
- Create: `server/crew/boot.mjs`
- Modify: `server/serve.mjs`
- Test: `test/crew-boot.test.mjs`

**Interfaces:**
- Consumes: `loadCrewConfig`, `CrewConfig` (Task 1); `connect`, `migrate` (Task 2); `loadCatalog` (Task 3); `createRoster` (Task 4); `createWorkspaces` (Task 5).
- Produces:
  - `createCrew(config: CrewConfig): Promise<Crew>`. Rejects with a plain `Error` naming the setting at fault when the data directory cannot be written or the database cannot be reached.
  - `Crew = { worldId: string, roster: Roster, workspaces: Workspaces, catalog: Catalog, close(): Promise<void> }`.
  - `bootCrew(env?: object): Promise<Crew | null>`. One per process: later calls return the same promise. Resolves `null` when no database is configured.
  - `resetCrewForTests(): Promise<void>`. Closes and forgets the process's crew.

- [ ] **Step 1: Write the failing test**

```js
// test/crew-boot.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createCrew } from '../server/crew/index.mjs'
import { bootCrew, resetCrewForTests } from '../server/crew/boot.mjs'
import { connect } from '../server/crew/store/db.mjs'
import { TEST_DB, needsDb } from './support/crew-db.mjs'

/** A real configuration on a schema and a data directory of its own, both removed after. */
async function withConfig(run) {
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-boot-'))
  const config = { databaseUrl: TEST_DB, schema, dataDir, worldId: 'w', agentLimit: 2, entitled: ['quill'] }
  try {
    return await run(config)
  } finally {
    const admin = connect(TEST_DB, { max: 1 })
    await admin.unsafe(`drop schema if exists "${schema}" cascade`)
    await admin.end({ timeout: 5 })
    await fs.rm(dataDir, { recursive: true, force: true })
  }
}

test('a crew starts on an empty database: schema made, tables made, parts wired', needsDb, async () => {
  await withConfig(async (config) => {
    const crew = await createCrew(config)
    try {
      assert.equal(crew.worldId, 'w')
      const agent = await crew.roster.create({ runtime: 'hermes' })
      const space = await crew.workspaces.create({ name: 'Alpha' })
      assert.ok(space.folder.startsWith(config.dataDir))
      assert.deepEqual((await crew.roster.counts()).standard, { used: 1, limit: 2 })
      assert.equal((await crew.roster.createCurated('quill')).name, 'Quill')
      assert.ok(crew.catalog.byId.has('quill'))
      assert.equal((await crew.roster.get(agent.id)).id, agent.id)
    } finally {
      await crew.close()
    }
  })
})

test('what was made survives a restart', needsDb, async () => {
  await withConfig(async (config) => {
    const first = await createCrew(config)
    const agent = await first.roster.create({ name: 'Ada', runtime: 'hermes' })
    await first.close()
    const second = await createCrew(config)
    try {
      assert.deepEqual((await second.roster.list()).map((a) => [a.id, a.name]), [[agent.id, 'Ada']])
    } finally {
      await second.close()
    }
  })
})

test('a data directory that cannot be written stops the start, and names the setting', needsDb, async () => {
  await withConfig(async (config) => {
    const file = path.join(config.dataDir, 'not-a-directory')
    await fs.writeFile(file, '')
    await assert.rejects(createCrew({ ...config, dataDir: path.join(file, 'inside') }), /WORLDS_DATA_DIR/)
  })
})

test('a database that cannot be reached stops the start, and names the setting', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-boot-'))
  try {
    await assert.rejects(
      createCrew({ databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none', schema: '', dataDir, worldId: 'w', agentLimit: 6, entitled: [] }),
      /WORLDS_DATABASE_URL/
    )
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('a specialist the world is entitled to but the server does not have stops the start', needsDb, async () => {
  await withConfig(async (config) => {
    await assert.rejects(createCrew({ ...config, entitled: ['nobody'] }), /WORLDS_CURATED_AGENTS.*nobody/)
  })
})

test('with no database there is no crew, and nothing is loaded to find that out', async () => {
  await resetCrewForTests()
  assert.equal(await bootCrew({}), null)
  await resetCrewForTests()
})

test('the process has one crew, however many times it is asked for', needsDb, async () => {
  await withConfig(async (config) => {
    await resetCrewForTests()
    const env = {
      WORLDS_DATABASE_URL: config.databaseUrl,
      WORLDS_DATABASE_SCHEMA: config.schema,
      WORLDS_DATA_DIR: config.dataDir,
    }
    const [a, b] = await Promise.all([bootCrew(env), bootCrew(env)])
    assert.equal(a, b)
    assert.equal(a.worldId, 'default')
    await resetCrewForTests()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:crew`
Expected: FAIL with `Cannot find module '.../server/crew/index.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// server/crew/index.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { connect } from './store/db.mjs'
import { migrate } from './store/migrate.mjs'
import { loadCatalog } from './catalog.mjs'
import { createRoster } from './roster.mjs'
import { createWorkspaces } from './workspaces.mjs'

/**
 * Prove the data directory can be written by writing to it. Asking the filesystem whether
 * a write would work is not the same thing: a read-only mount and a full volume both say yes.
 */
async function checkDataDir(dataDir) {
  const probe = path.join(dataDir, `.write-check-${randomUUID()}`)
  try {
    await fs.mkdir(path.join(dataDir, 'workspaces'), { recursive: true })
    await fs.writeFile(probe, '')
    await fs.rm(probe, { force: true })
  } catch (error) {
    throw new Error(
      `WORLDS_DATA_DIR (${dataDir}) cannot be written to: ${error.message}. ` +
        'Workspaces would be lost on restart, so the server will not start.'
    )
  }
}

/**
 * Bring a world's crew backend up: check both places it keeps things, bring the schema up to
 * date, and wire the parts together.
 *
 * It refuses to start if either place is not usable. A server that started anyway would
 * accept work it could not keep.
 *
 * @param {{databaseUrl: string, schema: string, dataDir: string, worldId: string,
 *   agentLimit: number, entitled: string[]}} config
 */
export async function createCrew(config) {
  const catalog = await loadCatalog()
  const missing = config.entitled.filter((id) => !catalog.byId.has(id))
  if (missing.length) {
    throw new Error(`WORLDS_CURATED_AGENTS names specialists this server does not have: ${missing.join(', ')}`)
  }

  await checkDataDir(config.dataDir)

  const sql = connect(config.databaseUrl, { schema: config.schema })
  try {
    if (config.schema) await sql.unsafe(`create schema if not exists "${config.schema}"`)
    await migrate(sql)
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {})
    throw new Error(`WORLDS_DATABASE_URL could not be used: ${error.message || error.code || error}`)
  }

  return {
    worldId: config.worldId,
    catalog,
    roster: createRoster({
      sql,
      worldId: config.worldId,
      catalog,
      limit: config.agentLimit,
      entitled: config.entitled,
    }),
    workspaces: createWorkspaces({ sql, worldId: config.worldId, dataDir: config.dataDir }),
    close: () => sql.end({ timeout: 5 }),
  }
}
```

```js
// server/crew/boot.mjs
import { loadCrewConfig } from './config.mjs'

/**
 * The process's one crew backend, started the first time anything asks for it.
 *
 * `./index.mjs` is imported only once a database is configured. Without one the server is
 * the read-only monitor, which the desktop app ships, and it must never need the Postgres
 * client to be installed or loaded.
 */
let booted = null

/** @returns {Promise<import('./index.mjs').createCrew extends (...a: any) => Promise<infer C> ? C | null : never>} */
export function bootCrew(env = process.env) {
  booted ??= start(env)
  return booted
}

async function start(env) {
  const config = loadCrewConfig(env)
  if (!config) return null
  const { createCrew } = await import('./index.mjs')
  return createCrew(config)
}

/** Close and forget, so each test can start from nothing. */
export async function resetCrewForTests() {
  const was = booted
  booted = null
  const crew = await was?.catch(() => null)
  await crew?.close()
}
```

Then make the server start the crew before it listens, so a bad configuration is seen at start and not on the first request. Replace the whole of `server/serve.mjs` with:

```js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './http-server.mjs'
import { bootCrew } from './crew/boot.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT) || 5274
const host = process.env.BOT_CROSSING_HOST || '127.0.0.1'

// Started before the port opens: a server that cannot keep its agents and workspaces must
// not look healthy to whatever is watching it.
let crew
try {
  crew = await bootCrew()
} catch (error) {
  console.error(`Nodexeus Worlds cannot start: ${error.message}`)
  process.exit(1)
}

const server = createAppServer({ distDir: path.join(here, '..', 'dist') })

server.listen(port, host, () => {
  console.log(`Nodexeus Worlds → http://${host}:${port}`)
  console.log(crew ? `Crew backend ready for world "${crew.worldId}"` : 'No database configured: running as a monitor only')
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:crew`
Expected: PASS, all of `crew-boot.test.mjs` (7 tests) and everything before it

- [ ] **Step 5: Check both ways of starting by hand**

Run: `PORT=5299 node server/serve.mjs` (stop it with Ctrl-C once it prints)
Expected: `No database configured: running as a monitor only`

Run: `PORT=5299 WORLDS_DATABASE_URL=postgres://worlds:worlds-dev@127.0.0.1:55432/worlds WORLDS_DATABASE_SCHEMA=dev WORLDS_DATA_DIR=/nonexistent/readonly node server/serve.mjs; echo "exit $?"`
Expected: `Nodexeus Worlds cannot start: WORLDS_DATA_DIR (/nonexistent/readonly) cannot be written to: ...` and `exit 1`

- [ ] **Step 6: Commit**

```bash
git add server/crew/index.mjs server/crew/boot.mjs server/serve.mjs test/crew-boot.test.mjs
git commit -m "feat: the crew backend starts with the server, or stops it (NODEX-315)"
```

---

### Task 7: The HTTP API (NODEX-315)

**Files:**
- Create: `server/lib/json-http.mjs`
- Create: `server/crew/http.mjs`
- Modify: `server/api.mjs` (import the shared helpers, delegate `/api/crew`, allow configured hosts)
- Test: `test/crew-http.test.mjs`

**Interfaces:**
- Consumes: `Crew` (Task 6), `bootCrew` (Task 6), `CrewError` (Task 1), `isUnavailable` (Task 2).
- Produces:
  - `send(res, status, body)` and `readJsonBody(req, limit?)` in `server/lib/json-http.mjs`, with the behaviour they have today in `server/api.mjs`.
  - `handleCrew(req, res, url: URL, crew: Crew | null): Promise<void>`.
  - Routes, all answering JSON:

| Method and path | Body | Answers |
| --- | --- | --- |
| `GET /api/crew` | | `{ enabled, worldId?, counts? }`. `{ enabled: false }` with no crew. |
| `GET /api/crew/agents` | | `{ agents, counts }` |
| `POST /api/crew/agents` | `{ name?, kind?, runtime, role? }` or `{ templateId }` | 201 `{ agent }` |
| `PATCH /api/crew/agents/:id` | `{ name?, role? }` | `{ agent }` |
| `DELETE /api/crew/agents/:id` | | `{ ok: true }` |
| `GET /api/crew/specialists` | | `{ specialists }` |
| `GET /api/crew/workspaces` | | `{ workspaces }` |
| `POST /api/crew/workspaces` | `{ name, description?, gitUrl? }` | 201 `{ workspace }` |
| `PATCH /api/crew/workspaces/:id` | `{ name?, description? }` | `{ workspace }` |
| `DELETE /api/crew/workspaces/:id` | | `{ ok: true }` |

  - A refusal answers its `CrewError` status with `{ error, code }`. An unreachable database answers 503 `{ error, code: 'store_unavailable' }`. A body that is not JSON answers 400 `{ code: 'bad_json' }`. With no crew, every route but `GET /api/crew` answers 404 `{ code: 'crew_disabled' }`.
  - `WORLDS_ALLOWED_HOSTS`: a comma-separated list of host names that may reach the API as well as the machine's own.

- [ ] **Step 1: Move the two helpers so both modules can use them**

Create `server/lib/json-http.mjs` with the two functions exactly as they are in `server/api.mjs` today:

```js
// server/lib/json-http.mjs
/** Answer with JSON, never cached: every reply here is the state of something that moves. */
export function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** The request body as JSON. An empty body is `{}`; one over `limit` bytes is refused. */
export function readJsonBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
```

In `server/api.mjs`, delete the `function send(res, status, body) { ... }` definition and the `function readJsonBody(req, limit = 4 * 1024 * 1024) { ... }` definition, and add this import after the `./scan.mjs` import block:

```js
import { readJsonBody, send } from './lib/json-http.mjs'
```

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 267` plus the crew tests that do not need a database, and `fail 2` (the two known ones). Nothing else may change.

- [ ] **Step 2: Write the failing test**

```js
// test/crew-http.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { handleCrew } from '../server/crew/http.mjs'
import { createRoster } from '../server/crew/roster.mjs'
import { createWorkspaces } from '../server/crew/workspaces.mjs'
import { loadCatalog } from '../server/crew/catalog.mjs'
import { needsDb, withDb } from './support/crew-db.mjs'
import { withEnv } from './support/env.mjs'

/** Serve `crew` (or no crew) on a loopback port and hand back a JSON caller. */
async function serving(crew, run) {
  const server = http.createServer((req, res) => handleCrew(req, res, new URL(req.url, 'http://localhost'), crew))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, route, body) => {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    return await run(call)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const withCrew = (run, options = {}) =>
  withDb(async (sql) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-http-'))
    const catalog = await loadCatalog()
    const crew = {
      worldId: 'w',
      catalog,
      roster: createRoster({ sql, worldId: 'w', catalog, limit: 2, entitled: ['quill'], rand: () => 0, ...options }),
      workspaces: createWorkspaces({ sql, worldId: 'w', dataDir, clone: async () => {} }),
    }
    try {
      return await serving(crew, (call) => run(call, { sql, crew }))
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })

test('with no crew the server says so, and every other route is switched off', async () => {
  await serving(null, async (call) => {
    assert.deepEqual(await call('GET', '/api/crew'), { status: 200, body: { enabled: false } })
    for (const [method, route] of [['GET', '/api/crew/agents'], ['POST', '/api/crew/agents'], ['GET', '/api/crew/workspaces']]) {
      const res = await call(method, route, method === 'POST' ? {} : undefined)
      assert.equal(res.status, 404)
      assert.equal(res.body.code, 'crew_disabled')
    }
  })
})

test('the status route gives the world and the counts', needsDb, async () => {
  await withCrew(async (call) => {
    assert.deepEqual(await call('GET', '/api/crew'), {
      status: 200,
      body: { enabled: true, worldId: 'w', counts: { standard: { used: 0, limit: 2 }, curated: { used: 0 } } },
    })
  })
})

test('agents can be made, listed, changed and retired', needsDb, async () => {
  await withCrew(async (call) => {
    const made = await call('POST', '/api/crew/agents', { name: 'Ada', kind: 'rock', runtime: 'hermes', role: 'Writes docs.' })
    assert.equal(made.status, 201)
    const { agent } = made.body
    assert.deepEqual([agent.name, agent.kind, agent.runtime, agent.role, agent.curated], ['Ada', 'rock', 'hermes', 'Writes docs.', false])

    const listed = await call('GET', '/api/crew/agents')
    assert.deepEqual(listed.body.agents.map((a) => a.id), [agent.id])
    assert.deepEqual(listed.body.counts.standard, { used: 1, limit: 2 })

    const changed = await call('PATCH', `/api/crew/agents/${agent.id}`, { name: 'Grace' })
    assert.deepEqual([changed.status, changed.body.agent.name, changed.body.agent.id], [200, 'Grace', agent.id])

    assert.deepEqual(await call('DELETE', `/api/crew/agents/${agent.id}`), { status: 200, body: { ok: true } })
    assert.deepEqual((await call('GET', '/api/crew/agents')).body.agents, [])
  })
})

test('a specialist is made from its template id', needsDb, async () => {
  await withCrew(async (call) => {
    const before = await call('GET', '/api/crew/specialists')
    assert.deepEqual(before.body.specialists.map((s) => [s.id, s.entitled, s.agentId]), [['quill', true, null]])
    const made = await call('POST', '/api/crew/agents', { templateId: 'quill' })
    assert.deepEqual([made.status, made.body.agent.name, made.body.agent.curated], [201, 'Quill', true])
    assert.equal((await call('GET', '/api/crew/specialists')).body.specialists[0].agentId, made.body.agent.id)
  })
})

test('a refusal answers with its status, its code and its words', needsDb, async () => {
  await withCrew(async (call) => {
    await call('POST', '/api/crew/agents', { name: 'Ada', runtime: 'hermes' })
    await call('POST', '/api/crew/agents', { name: 'Bolt', runtime: 'hermes' })
    const cases = [
      [await call('POST', '/api/crew/agents', { runtime: 'hermes' }), 409, 'agent_limit'],
      [await call('POST', '/api/crew/agents', { runtime: 'gpt' }), 400, 'bad_runtime'],
      [await call('POST', '/api/crew/agents', { templateId: 'nobody' }), 404, 'unknown_template'],
      [await call('PATCH', '/api/crew/agents/not-an-id', { name: 'Zed' }), 404, 'unknown_agent'],
      [await call('DELETE', '/api/crew/agents/00000000-0000-7000-8000-000000000000'), 404, 'unknown_agent'],
      [await call('POST', '/api/crew/workspaces', { name: '' }), 400, 'bad_workspace_name'],
      [await call('POST', '/api/crew/workspaces', { name: 'A', gitUrl: '--upload-pack=x' }), 400, 'bad_git_url'],
    ]
    for (const [res, status, code] of cases) {
      assert.deepEqual([res.status, res.body.code], [status, code])
      assert.ok(res.body.error.length > 5)
    }
    assert.match(cases[0][0].body.error, /2 of 2/)
  })
})

test('workspaces can be made, listed, changed and archived', needsDb, async () => {
  await withCrew(async (call) => {
    const made = await call('POST', '/api/crew/workspaces', { name: 'Billing', description: 'Invoices and payments.' })
    assert.equal(made.status, 201)
    const { workspace } = made.body
    assert.deepEqual([workspace.name, workspace.description, workspace.gitUrl], ['Billing', 'Invoices and payments.', null])
    assert.equal('folder' in workspace, false, 'a path on the server is not the page\'s business')

    assert.deepEqual((await call('GET', '/api/crew/workspaces')).body.workspaces.map((w) => w.id), [workspace.id])
    const changed = await call('PATCH', `/api/crew/workspaces/${workspace.id}`, { description: 'Money.' })
    assert.deepEqual([changed.status, changed.body.workspace.description], [200, 'Money.'])
    assert.deepEqual(await call('DELETE', `/api/crew/workspaces/${workspace.id}`), { status: 200, body: { ok: true } })
    assert.deepEqual((await call('GET', '/api/crew/workspaces')).body.workspaces, [])
  })
})

test('what is not a route, a method or JSON is refused without a fault', needsDb, async () => {
  await withCrew(async (call) => {
    assert.equal((await call('GET', '/api/crew/nothing')).status, 404)
    assert.equal((await call('PUT', '/api/crew/agents', {})).status, 405)
    assert.equal((await call('DELETE', '/api/crew/agents')).status, 405)
    const broken = await call('POST', '/api/crew/agents', '{not json')
    assert.deepEqual([broken.status, broken.body.code], [400, 'bad_json'])
    const list = await call('POST', '/api/crew/agents', '[1,2]')
    assert.deepEqual([list.status, list.body.code], [400, 'bad_json'])
  })
})

test('a database that has gone away is a 503 that says so, and the server lives', needsDb, async () => {
  await withCrew(async (call, { sql }) => {
    await sql.end({ timeout: 1 })
    const res = await call('GET', '/api/crew/agents')
    assert.deepEqual([res.status, res.body.code], [503, 'store_unavailable'])
    assert.match(res.body.error, /database/i)
    assert.equal((await call('GET', '/api/crew/nothing')).status, 404)
  })
})

test('a host named in WORLDS_ALLOWED_HOSTS may reach the API, and no other may', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-hosts-'))
  try {
    await withEnv({ BOT_CROSSING_DATA: dir, WORLDS_ALLOWED_HOSTS: ' worlds.example.com , Other.Example.com ', WORLDS_DATABASE_URL: undefined }, async () => {
      const { apiMiddleware } = await import(`../server/api.mjs?hosts-${Date.now()}`)
      const server = http.createServer((req, res) => apiMiddleware(req, res, null))
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = server.address().port
      /** `fetch` will not let a test set Host, so this one is made by hand. */
      const get = (host, origin) =>
        new Promise((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port, path: '/api/crew', method: 'GET', headers: { Host: host, ...(origin ? { Origin: origin } : {}) } },
            (res) => {
              res.resume()
              res.on('end', () => resolve(res.statusCode))
            }
          )
          req.on('error', reject)
          req.end()
        })
      try {
        assert.equal(await get('worlds.example.com', 'https://worlds.example.com'), 200)
        assert.equal(await get('other.example.com'), 200)
        assert.equal(await get('evil.example.com'), 403)
        assert.equal(await get('worlds.example.com', 'https://evil.example.com'), 403)
        assert.equal(await get(`127.0.0.1:${port}`), 200)
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:crew`
Expected: FAIL with `Cannot find module '.../server/crew/http.mjs'`

- [ ] **Step 4: Write the routes**

```js
// server/crew/http.mjs
import { CrewError } from './errors.mjs'
import { readJsonBody, send } from '../lib/json-http.mjs'

/**
 * A database error, without loading the Postgres client to recognise one: this file is
 * imported by the monitor-only server too. Kept in step with `isUnavailable` in
 * `store/db.mjs`, which a test holds it to.
 */
const UNREACHABLE = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  '57P01', '57P02', '57P03', '53300',
])
const unavailable = (error) =>
  Boolean(error) &&
  (UNREACHABLE.has(error.code) || (Array.isArray(error.errors) && error.errors.some((inner) => UNREACHABLE.has(inner?.code))))

/** The page is told what a workspace is, not where on the server's disk it lives. */
const publicWorkspace = ({ folder, ...rest }) => rest

/** A JSON object body, or a refusal: a list or a bare value is not a request. */
async function body(req) {
  let parsed
  try {
    parsed = await readJsonBody(req, 64 * 1024)
  } catch {
    throw new CrewError('bad_json', 'The request body must be a JSON object', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CrewError('bad_json', 'The request body must be a JSON object', 400)
  }
  return parsed
}

const notAllowed = () => new CrewError('method_not_allowed', 'That is not something this address does', 405)

/**
 * Everything under `/api/crew`.
 *
 * `crew` is null on a server with no database: the monitor. It still answers `GET /api/crew`
 * so the page can ask what it is talking to, and says plainly that the rest is switched off.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {any | null} crew
 */
export async function handleCrew(req, res, url, crew) {
  try {
    const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3)
    const [collection, id, extra] = parts
    const { method } = req

    if (!collection) {
      if (method !== 'GET') throw notAllowed()
      if (!crew) return send(res, 200, { enabled: false })
      return send(res, 200, { enabled: true, worldId: crew.worldId, counts: await crew.roster.counts() })
    }
    if (!crew) {
      throw new CrewError('crew_disabled', 'This server is a monitor only: no crew backend is configured', 404)
    }
    if (extra !== undefined) throw new CrewError('not_found', 'Unknown endpoint', 404)

    if (collection === 'agents') {
      const { roster } = crew
      if (id === undefined) {
        if (method === 'GET') return send(res, 200, { agents: await roster.list(), counts: await roster.counts() })
        if (method === 'POST') {
          const input = await body(req)
          const agent = 'templateId' in input ? await roster.createCurated(input.templateId) : await roster.create(input)
          return send(res, 201, { agent })
        }
        throw notAllowed()
      }
      if (method === 'PATCH') {
        const { name, role } = await body(req)
        return send(res, 200, { agent: await roster.update(id, { name, role }) })
      }
      if (method === 'DELETE') {
        await roster.retire(id)
        return send(res, 200, { ok: true })
      }
      throw notAllowed()
    }

    if (collection === 'specialists') {
      if (id !== undefined) throw new CrewError('not_found', 'Unknown endpoint', 404)
      if (method !== 'GET') throw notAllowed()
      return send(res, 200, { specialists: await crew.roster.specialists() })
    }

    if (collection === 'workspaces') {
      const { workspaces } = crew
      if (id === undefined) {
        if (method === 'GET') return send(res, 200, { workspaces: (await workspaces.list()).map(publicWorkspace) })
        if (method === 'POST') {
          const { name, description, gitUrl } = await body(req)
          return send(res, 201, { workspace: publicWorkspace(await workspaces.create({ name, description, gitUrl })) })
        }
        throw notAllowed()
      }
      if (method === 'PATCH') {
        const { name, description } = await body(req)
        return send(res, 200, { workspace: publicWorkspace(await workspaces.update(id, { name, description })) })
      }
      if (method === 'DELETE') {
        await workspaces.archive(id)
        return send(res, 200, { ok: true })
      }
      throw notAllowed()
    }

    throw new CrewError('not_found', 'Unknown endpoint', 404)
  } catch (error) {
    if (error instanceof CrewError) return send(res, error.status, { error: error.message, code: error.code })
    if (unavailable(error)) {
      return send(res, 503, { error: 'The database cannot be reached right now. Nothing was changed.', code: 'store_unavailable' })
    }
    console.error('crew:', error)
    return send(res, 500, { error: 'Something went wrong on the server', code: 'fault' })
  }
}
```

Add this test to `test/crew-store.test.mjs`, so the two lists of "the database is not there" codes cannot drift apart:

```js
test('the API and the store agree on what "the database is not there" looks like', async () => {
  const fs = await import('node:fs/promises')
  const codes = async (file) => {
    const text = await fs.readFile(new URL(file, import.meta.url), 'utf8')
    const block = text.slice(text.indexOf('const UNREACHABLE = new Set(['), text.indexOf('])', text.indexOf('const UNREACHABLE = new Set([')))
    return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]).sort()
  }
  assert.deepEqual(await codes('../server/crew/http.mjs'), await codes('../server/crew/store/db.mjs'))
})
```

- [ ] **Step 5: Delegate `/api/crew` from the API middleware, and allow configured hosts**

In `server/api.mjs`, add these imports beside the `./lib/json-http.mjs` import:

```js
import { bootCrew } from './crew/boot.mjs'
import { handleCrew } from './crew/http.mjs'
```

Find the loop that begins `for (const addrs of Object.values(os.networkInterfaces())) {` and add this directly after the loop's closing brace:

```js

// A server deployment is reached by a name of its own, through whatever proxy signs people
// in. Naming that host here lets its page drive the API; every other host is still refused,
// so the DNS rebinding and CSRF checks below keep their meaning.
for (const host of (process.env.WORLDS_ALLOWED_HOSTS || '').split(',')) {
  if (host.trim()) LOCAL_HOSTS.add(host.trim().toLowerCase())
}
```

In `apiMiddleware`, find these lines:

```js
  try {
    if (url.pathname === '/api/threads' && req.method === 'GET') {
```

and replace them with:

```js
  try {
    if (url.pathname === '/api/crew' || url.pathname.startsWith('/api/crew/')) {
      return await handleCrew(req, res, url, await bootCrew())
    }

    if (url.pathname === '/api/threads' && req.method === 'GET') {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:crew`
Expected: PASS, all of `crew-http.test.mjs` (9 tests) and everything before it

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)|^✖"`
Expected: the same two known failures and no others. Crew tests that need a database are counted as skipped.

- [ ] **Step 7: Commit**

```bash
git add server/lib/json-http.mjs server/crew/http.mjs server/api.mjs test/crew-http.test.mjs test/crew-store.test.mjs
git commit -m "feat: an HTTP API for the roster and workspaces (NODEX-315)"
```

---

### Task 8: Deployment and documentation (NODEX-316)

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Create: `docs/crew-backend.md`
- Modify: `docs/HANDOFF.md` (the "Documentation map" and "Current scope and next decisions" sections)
- Modify: `electron-builder.yml` (keep the Postgres client out of the desktop app)

**Interfaces:**
- Consumes: the environment variables from Task 1 and `WORLDS_ALLOWED_HOSTS` from Task 7.
- Produces: a Compose stack in which the server and Postgres 18 each keep their state on a named volume.

- [ ] **Step 1: Give the runtime image its one dependency**

In `Dockerfile`, replace these lines:

```dockerfile
# The server uses only Node built-ins; frontend dependencies are bundled in dist.
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /app/data && chown node:node /app/data
```

with:

```dockerfile
# Frontend dependencies are bundled in dist. The server needs its own few at run time:
# the Postgres client for the crew backend, and git to seed a workspace from a repository.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /app/data /var/lib/worlds && chown node:node /app/data /var/lib/worlds
```

- [ ] **Step 2: Add Postgres and the data volume to Compose**

In `docker-compose.yml`, replace this block:

```yaml
    environment:
      BOT_CROSSING_CLAUDE_ACTIVITY: transcript
```

with:

```yaml
    environment:
      BOT_CROSSING_CLAUDE_ACTIVITY: transcript
      # The crew backend. Both of these hold state that has to outlive the container, so
      # both point at volumes. See docs/crew-backend.md.
      WORLDS_DATABASE_URL: postgres://worlds:${WORLDS_DB_PASSWORD:-worlds-dev}@db:5432/worlds
      WORLDS_DATA_DIR: /var/lib/worlds
      WORLDS_WORLD_ID: ${WORLDS_WORLD_ID:-default}
      WORLDS_AGENT_LIMIT: ${WORLDS_AGENT_LIMIT:-6}
      WORLDS_CURATED_AGENTS: ${WORLDS_CURATED_AGENTS:-}
      WORLDS_ALLOWED_HOSTS: ${WORLDS_ALLOWED_HOSTS:-}
    depends_on:
      db:
        condition: service_healthy
```

Replace this line under the service's `volumes:`:

```yaml
      - colony-data:/app/data
```

with:

```yaml
      - colony-data:/app/data
      - worlds-data:/var/lib/worlds
```

Add this service after the `bot-crossing` service's `healthcheck` block and before the top-level `volumes:` key:

```yaml
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: worlds
      POSTGRES_PASSWORD: ${WORLDS_DB_PASSWORD:-worlds-dev}
      POSTGRES_DB: worlds
    volumes:
      # Postgres 18 keeps each major version in its own directory under this path.
      - worlds-db:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U worlds -d worlds"]
      interval: 5s
      timeout: 3s
      retries: 20
```

Replace the final block:

```yaml
volumes:
  colony-data:
```

with:

```yaml
volumes:
  colony-data:
  worlds-data:
  worlds-db:
```

- [ ] **Step 3: Keep the Postgres client out of the desktop app**

The desktop app is a monitor and never configures a database, so it should not carry the client. In `electron-builder.yml`, add this entry at the end of the `files:` list:

```yaml
  - "!node_modules/postgres/**"
```

- [ ] **Step 4: Verify the stack**

Run: `docker compose config --quiet && echo ok`
Expected: `ok`

Run: `docker compose up -d --build && docker compose ps --format '{{.Service}} {{.Health}}'`
Expected, once both have started: `bot-crossing healthy` and `db healthy`

Run: `curl -s http://127.0.0.1:5274/api/crew`
Expected: `{"enabled":true,"worldId":"default","counts":{"standard":{"used":0,"limit":6},"curated":{"used":0}}}`

Run:

```bash
curl -s -X POST http://127.0.0.1:5274/api/crew/agents -H 'Origin: http://127.0.0.1:5274' -H 'Content-Type: application/json' -d '{"runtime":"hermes"}'
docker compose down && docker compose up -d
curl -s http://127.0.0.1:5274/api/crew/agents
```

Expected: the agent made by the first command is still listed after the restart.

Run: `docker compose down`
(The volumes are kept. `docker compose down -v` would delete them, and with them the data.)

Run: `npm run desktop:package && git checkout public/assets/megakit.glb && ls "release/mac-arm64/Nodexeus Worlds.app/Contents/Resources/"`
Expected: the build succeeds. Then start the packaged app once and confirm it opens as before (it logs `No database configured` only when run from `server/serve.mjs`, so the check here is simply that the campus loads).

- [ ] **Step 5: Write the documentation**

Create `docs/crew-backend.md`:

```markdown
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
- Names are one word, unique in a world whatever their case.
- Agents are retired, never deleted. Retiring gives back the place and the name.

## Workspaces

A workspace is a name, a description and a folder named by the workspace's id. It can be
seeded from an `https://` or `ssh://` git address. Archiving removes it from the world and
keeps its files.

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
```

In `docs/HANDOFF.md`, add this line to the list under `## Documentation map`:

```markdown
- `docs/crew-backend.md`: the roster, workspaces, storage settings and API of the crew backend.
```

and replace this sentence in `## Current scope and next decisions`:

```markdown
There is no memory ingestion, RAG service, workflow execution,
customer account system, billing, or platform-runtime lifecycle adapter yet.
```

with:

```markdown
A crew backend (durable agents and workspaces in Postgres, see `docs/crew-backend.md`) is
present when a database is configured. There is no memory ingestion, RAG service, workflow
execution, customer account system, billing, or platform-runtime lifecycle adapter yet, and
agents cannot yet be conversed with: see the crew chat design for the order of that work.
```

- [ ] **Step 6: Run everything once more**

Run: `npm run test:crew 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `fail 0`, `skipped 0`

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Expected: only the two known failures

Run: `git grep -nP "\x{2014}" -- server/crew docs/crew-backend.md "test/crew-*.test.mjs" test/support/crew-db.mjs`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml electron-builder.yml docs/crew-backend.md docs/HANDOFF.md
git commit -m "chore: run the crew backend in Compose with persistent volumes, and document it (NODEX-316)"
```

---

## Tracking

Child issues of NODEX-311, created when this plan is approved, each with its own branch and pull request:

| Issue | Tasks | Branch |
| --- | --- | --- |
| NODEX-312 Storage foundation | 1, 2 | `nodex-312-crew-storage` |
| NODEX-313 Roster, names and curated agents | 3, 4 | `nodex-313-crew-roster` |
| NODEX-314 Workspaces | 5 | `nodex-314-crew-workspaces` |
| NODEX-315 Startup and HTTP API | 6, 7 | `nodex-315-crew-api` |
| NODEX-316 Deployment and docs | 8 | `nodex-316-crew-deploy` |

The issue numbers above are the next free ones at the time of writing. If Linear assigns different numbers, use the assigned ones in branch names and commit messages.

The tasks are in dependency order, so the branches merge in the order of the table. Each pull request closes its issue and states how it was verified.
