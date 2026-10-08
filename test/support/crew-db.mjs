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
