/**
 * What a workspace's decks hold, and where each session goes.
 *
 * Sessions go up, not out. A deck has room on its floor for a building or a few, and for a
 * stack or a few; a stack is up to `STOREYS` high. So a session is either a building on a
 * floor or a storey of a stack, and a busy workspace is tall before it is wide.
 *
 * A session keeps the place it is given for as long as it lasts (the colony numbers its
 * places and remembers each session's number), so this only says what place a number is.
 */

/** How high a stack can be. */
export const STOREYS = 3

/** How many sessions a platform is counted as holding when ground is given out: a medium deck's worth. */
const PER_PLATFORM = 8

/** @param {{buildings: number, stacks: number}} deck */
export const capacityOf = (deck) => deck.buildings + deck.stacks * STOREYS

/** How many platforms a workspace with this many sessions is given. */
export const platformsFor = (sessions) => Math.max(1, Math.ceil(sessions / PER_PLATFORM))

/**
 * Every place a workspace's decks have, in the order they are filled: the floors first, deck
 * by deck, then the first storey of every stack, then the second, then the third. Filling
 * across before up keeps a workspace's stacks about level with each other as it grows.
 *
 * @param {Array<{buildings: number, stacks: number}>} decks
 * @returns {Array<{deck: number, kind: 'floor' | 'stack', spot: number, storey?: number}>}
 */
export function placesOf(decks) {
  const places = []
  decks.forEach((deck, d) => {
    for (let spot = 0; spot < deck.buildings; spot++) places.push({ deck: d, kind: 'floor', spot })
  })
  for (let storey = 0; storey < STOREYS; storey++) {
    decks.forEach((deck, d) => {
      for (let spot = 0; spot < deck.stacks; spot++) places.push({ deck: d, kind: 'stack', spot, storey })
    })
  }
  return places
}

/**
 * How high each stack stands: the number of its places that are taken. A stack closes up
 * when a session in the middle of it leaves, so it never shows a gap.
 *
 * @param {ReturnType<typeof placesOf>} places
 * @param {Set<number>} taken  the numbers of the places in use
 * @returns {number[][]} for each deck, the height of each of its stacks
 */
export function stackHeights(places, taken) {
  const heights = []
  places.forEach((place, n) => {
    const row = (heights[place.deck] ||= [])
    if (place.kind !== 'stack') return
    row[place.spot] = (row[place.spot] || 0) + (taken.has(n) ? 1 : 0)
  })
  return heights.map((row) => Array.from(row, (height) => height || 0))
}
