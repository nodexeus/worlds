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

/**
 * The form in which two names are the same name: no case, no accents, no difference between
 * a composed letter and a letter with a mark after it.
 *
 * It has to fold at least as much as the database's `lower(name)` does, or a name could get
 * past the reserved check here and still hold a specialist's name there. A capital I with a
 * dot is the case that proves it: Postgres lowers it to a plain i, JavaScript to an i with a
 * combining dot, and dropping marks brings the two back together.
 */
export const nameKey = (name) =>
  String(name).trim().toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * A name somebody typed, trimmed, or a refusal that says what a name has to be.
 * One word, because a crew member is addressed as `@name`.
 */
export function checkName(name) {
  // Composed first: a keyboard may send an accented letter as two code points, and that is
  // the same name to the person typing it.
  const trimmed = typeof name === 'string' ? name.trim().normalize('NFC') : ''
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
