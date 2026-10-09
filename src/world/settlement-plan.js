/**
 * Where every part of the settlement goes.
 *
 * A workspace on the campus stands on stilts: a deck for each of its platforms, legs under
 * each, a piece joining neighbouring platforms into one floor, something along every open
 * edge, and a gangway or a flight of stairs wherever it is joined to a neighbour. The parts
 * are the kit in `design/campus/settlement.md`; this says which part goes where, as a plain
 * list, and nothing is drawn here.
 *
 * Everything about a workspace is decided from its own name and cells, so it looks the same
 * every time it is seen and nothing about one workspace changes because another arrived. The
 * one thing a neighbour does decide is which of its edges a crossing meets.
 */
import { HEX_DIRS, cellKey } from './plot-move.js'
import { hexToWorld } from './plots.js'

const SIXTH = Math.PI / 3

/** FNV-1a, the hash the rest of the world uses to turn a name into a stable number. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Decks that look walked on, and decks that do not. See the kit's notes. */
const USED = ['deck-a', 'deck-c']
const CLEAN = ['deck-b', 'deck-d']

/** What stands along an open edge, most likely first: a rail, a bare kerb, a rail with a light. */
const EDGES = ['edge-rail', 'edge-rail', 'edge-rail', 'edge-kerb', 'edge-kerb', 'edge-rail-lit']
const LIT = /lit$/

/** What is stacked, and how far up one storey is: the height of the kit's frame. */
const MODULES = ['mod-cabin', 'mod-drum', 'mod-shed', 'mod-tank']
const FRAME = 2.3
/** How high the flat roof of a module is above its base, for those that have one. */
const ROOF = { 'mod-cabin': 1.89, 'mod-drum': 1.93 }
const FLAT = Object.keys(ROOF)
/** The neon signs: the first two are cyan, the last two magenta. */
const SIGNS = ['sign-a', 'sign-b', 'sign-c', 'sign-d']
/** One workspace in this many has one. */
const SIGN_EVERY = 9

/** The turn about Y that points a part's own +z along (dx, dz). */
const facing = (dx, dz) => Math.atan2(dx, dz)

/**
 * @typedef {object} Placed
 * @property {string} part   the kit part's name
 * @property {string} plot   the workspace it belongs to
 * @property {number} x
 * @property {number} y      the height of the part's origin: for most, the walking surface
 * @property {number} z
 * @property {number} turn   about Y, in radians
 */

/**
 * @param {Array<{id: string, cells: Array<{q: number, r: number}>, level: number}>} plots
 * @param {import('./crossings.js').Crossing[]} crossings
 * @param {object} world
 * @param {number} world.deckTop    height of a ground-level deck's top face
 * @param {number} world.levelStep  how far apart levels are
 * @param {number} world.apothem    from the middle of a platform to the middle of an edge
 * @returns {Placed[]}
 */
export function settlementParts(plots, crossings, { deckTop, levelStep, apothem }) {
  const owner = new Map()
  for (const plot of plots) for (const cell of plot.cells) owner.set(cellKey(cell.q, cell.r), plot)

  // Which edges a crossing meets, as "cell>neighbour", both ways round.
  const crossed = new Set()
  for (const crossing of crossings) {
    crossed.add(`${cellKey(crossing.from.q, crossing.from.r)}>${cellKey(crossing.to.q, crossing.to.r)}`)
    crossed.add(`${cellKey(crossing.to.q, crossing.to.r)}>${cellKey(crossing.from.q, crossing.from.r)}`)
  }

  // Which workspaces have a neon sign: about one in `SIGN_EVERY` of those with a stack, and
  // at least one, taken in an order their names decide, each with a different sign from the
  // last. Counted across the campus so that there is always a handful and never a dozen.
  const stacked = plots.filter((plot) => plot.stackAt && plot.busy > 0)
    .sort((a, b) => hash(`${a.id}/sign`) - hash(`${b.id}/sign`) || (a.id < b.id ? -1 : 1))
  const signOf = new Map()
  const wanted = stacked.length ? Math.max(1, Math.round(stacked.length / SIGN_EVERY)) : 0
  stacked.slice(0, wanted).forEach((plot, n) => signOf.set(plot.id, SIGNS[n % SIGNS.length]))

  const parts = []
  for (const plot of plots) {
    const y = deckTop + plot.level * levelStep
    const mine = new Set(plot.cells.map((cell) => cellKey(cell.q, cell.r)))
    const put = (part, x, z, turn = 0, at = y) => parts.push({ part, plot: plot.id, x, y: at, z, turn })
    const edges = []

    for (const cell of plot.cells) {
      const key = cellKey(cell.q, cell.r)
      const seed = hash(`${plot.id}/${key}`)
      const here = hexToWorld(cell.q, cell.r)
      const busy = HEX_DIRS.some(([dq, dr]) => crossed.has(`${key}>${cellKey(cell.q + dq, cell.r + dr)}`))
      // A deck with a crossing on it has been walked over; most others have not.
      const worn = busy || seed % 5 === 0
      put((worn ? USED : CLEAN)[(seed >>> 4) % 2], here.x, here.z, ((seed >>> 8) % 6) * SIXTH)
      // Level 0 is the ground and has no legs; nothing in the kit is asked for past the fifth.
      if (plot.level >= 1) put(`legs-${Math.min(plot.level, 5)}`, here.x, here.z, ((seed >>> 12) % 6) * SIXTH)
      if ((seed >>> 16) % 3 === 0) put('under-lamp', here.x, here.z)

      HEX_DIRS.forEach(([dq, dr], d) => {
        const other = { q: cell.q + dq, r: cell.r + dr }
        const otherKey = cellKey(other.q, other.r)
        const there = hexToWorld(other.q, other.r)
        const dx = there.x - here.x
        const dz = there.z - here.z
        const far = Math.hypot(dx, dz)
        if (mine.has(otherKey)) {
          // One join for the pair, laid by whichever of the two comes first.
          if (key < otherKey) put('deck-join', (here.x + there.x) / 2, (here.z + there.z) / 2, facing(dx, dz))
          return
        }
        if (crossed.has(`${key}>${otherKey}`)) return
        edges.push({ x: here.x + (dx / far) * apothem, z: here.z + (dz / far) * apothem, turn: facing(dx, dz), seed: hash(`${plot.id}/${key}/${d}`) })
      })

      // Where three of its platforms meet there is a hole the joins leave, and a piece for it.
      // Each such corner is found from all three sides; it is laid from the first.
      HEX_DIRS.forEach(([dq, dr], d) => {
        const [eq, er] = HEX_DIRS[(d + 1) % 6]
        const b = { q: cell.q + dq, r: cell.r + dr }
        const c = { q: cell.q + eq, r: cell.r + er }
        const keys = [key, cellKey(b.q, b.r), cellKey(c.q, c.r)]
        if (!mine.has(keys[1]) || !mine.has(keys[2]) || keys[0] !== [...keys].sort()[0]) return
        const pb = hexToWorld(b.q, b.r)
        const pc = hexToWorld(c.q, c.r)
        const mx = (here.x + pb.x + pc.x) / 3
        const mz = (here.z + pb.z + pc.z) / 3
        // As made, one corner of the piece points along -z; it is turned to point at this deck.
        put('deck-fill', mx, mz, Math.atan2(-(here.x - mx), -(here.z - mz)))
      })
    }

    // A stack: a module on the deck, and for a busier workspace one or two more above it, each
    // on a frame standing over the one below. No storey sits straight on the last: it is
    // shifted or turned, as things are when they are added one at a time by whoever needed
    // the room.
    if (plot.stackAt && plot.busy > 0) {
      const seed = hash(`${plot.id}/stack`)
      // How high: one, two or three storeys, by the workspace's own name, so that a campus of
      // quiet workspaces still has height to it; and never fewer than two where three or more
      // are at work, nor fewer than three where five are.
      const own = [1, 2, 2, 3, 2, 3, 1, 2, 3, 2][(seed >>> 9) % 10]
      const storeys = Math.max(own, plot.busy >= 5 ? 3 : plot.busy >= 3 ? 2 : 1)
      // Its frame lies along the edge of the platform it stands by, where the workspace says
      // which way that is, so that no corner of it reaches past the deck.
      const start = plot.stackTurn ?? (seed % 6) * SIXTH
      let px = plot.stackAt.x
      let pz = plot.stackAt.z
      let turn = start
      let last = null
      const sign = signOf.get(plot.id)
      for (let k = 0; k < storeys; k++) {
        const roll = hash(`${plot.id}/stack/${k}`)
        if (k > 0) {
          put('frame', plot.stackAt.x, plot.stackAt.z, start, y + (k - 1) * FRAME)
          // Somewhere between a hand's width and most of a pace off the storey below, and
          // usually turned a quarter or so as well.
          const way = ((roll >>> 3) % 360) * (Math.PI / 180)
          const far = 0.25 + ((roll >>> 12) % 40) / 100
          px = plot.stackAt.x + Math.cos(way) * far
          pz = plot.stackAt.z + Math.sin(way) * far
          turn += [Math.PI / 2, Math.PI / 6, -Math.PI / 3, Math.PI / 4][(roll >>> 20) % 4]
        }
        last = MODULES[(seed + k * 3 + (roll >>> 24)) % MODULES.length]
        // A sign needs a flat roof to stand on, so where there is to be one the top storey
        // is one of the two that have one.
        if (sign && k === storeys - 1 && !ROOF[last]) last = FLAT[(roll >>> 5) % FLAT.length]
        put(last, px, pz, turn, y + k * FRAME)
      }
      if (storeys > 1) put('ladder', plot.stackAt.x, plot.stackAt.z, start)
      // A sign or a dish stands on the roof of the top storey, and only on a roof that is
      // flat: on anything else it would hang in the air.
      // On the roof of the top storey: a neon sign for the few workspaces that have one, a
      // dish on some of the rest. Never on the deck, where there are buildings to stand in.
      const roof = ROOF[last]
      const top = y + (storeys - 1) * FRAME + (roof || 0)
      if (sign) put(sign, px, pz, turn, top)
      else if (roof && seed % 4 === 1) put('dish', px, pz, turn, top)
    }

    // Every open edge has something along it, and one or two of them are lit: enough to say
    // somebody is home, never an outline.
    const chosen = edges.map((edge) => EDGES[edge.seed % EDGES.length])
    const lit = () => chosen.filter((part) => LIT.test(part)).length
    const order = edges.map((edge, n) => n).sort((a, b) => edges[a].seed - edges[b].seed)
    for (const n of order) {
      if (lit() >= 1) break
      chosen[n] = 'edge-rail-lit'
    }
    for (const n of order) {
      if (lit() <= 2) break
      if (LIT.test(chosen[n])) chosen[n] = 'edge-rail'
    }
    edges.forEach((edge, n) => put(chosen[n], edge.x, edge.z, edge.turn))
  }

  // A crossing stands in the middle of the gap at the lower deck's height, its own +z running
  // from the lower platform to the higher. Two levels and more are not joined directly.
  for (const crossing of crossings) {
    if (crossing.rise > 1) continue
    const low = owner.get(cellKey(crossing.from.q, crossing.from.r))
    if (!low) continue
    const from = hexToWorld(crossing.from.q, crossing.from.r)
    const to = hexToWorld(crossing.to.q, crossing.to.r)
    parts.push({
      part: crossing.rise ? 'stair-1' : 'gangway',
      plot: crossing.low,
      x: (from.x + to.x) / 2,
      y: deckTop + low.level * levelStep,
      z: (from.z + to.z) / 2,
      turn: facing(to.x - from.x, to.z - from.z),
    })
  }
  return parts
}

/** How far above a deck a pool of light is laid, so it does not fight the deck for the same depth. */
const PROUD = 0.03

/**
 * The light the settlement's lamps throw on its decks.
 *
 * A lit strip in the app glows and lights nothing. So where one is, a pool of its colour is
 * laid on the deck beside it: a band along a lit edge, a round pool about a module standing
 * on the deck, and a small one in a sign's own colour. They are pictures from the kit, laid
 * flat; this says where.
 *
 * @param {Placed[]} parts
 * @returns {Array<{kind: 'round' | 'band', color: 'amber' | 'cyan' | 'magenta', x: number,
 *   y: number, z: number, turn: number, width: number, depth: number}>}
 */
export function settlementPools(parts) {
  // The deck each workspace's parts stand on: the lowest thing it has is on it.
  const deckOf = new Map()
  for (const part of parts) {
    if (/^deck-[a-z]$/.test(part.part)) deckOf.set(part.plot, part.y)
  }
  const pools = []
  for (const part of parts) {
    const deck = deckOf.get(part.plot) ?? part.y
    if (/lit$/.test(part.part)) {
      // Inboard of the edge: the strip is on the inside of the kerb and shines across the deck.
      const inx = -Math.sin(part.turn)
      const inz = -Math.cos(part.turn)
      pools.push({ plot: part.plot, kind: 'band', color: 'amber', x: part.x + inx * 1.1, y: part.y + PROUD, z: part.z + inz * 1.1, turn: part.turn, width: 5.4, depth: 2.6 })
    } else if (/^mod-/.test(part.part) && Math.abs(part.y - deck) < 0.01) {
      pools.push({ plot: part.plot, kind: 'round', color: 'amber', x: part.x, y: deck + PROUD, z: part.z, turn: part.turn, width: 6.2, depth: 6.2 })
    } else if (/^sign-[ab]$/.test(part.part) || /^sign-[cd]$/.test(part.part)) {
      const color = /^sign-[ab]$/.test(part.part) ? 'cyan' : 'magenta'
      pools.push({ plot: part.plot, kind: 'round', color, x: part.x, y: deck + PROUD, z: part.z, turn: part.turn, width: 4.2, depth: 4.2 })
    }
  }
  return pools
}
