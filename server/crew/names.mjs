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
