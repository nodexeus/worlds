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
