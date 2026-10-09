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
/**
 * Where on a cabin's roof something can stand: how high the roof itself is above the cabin's
 * base (1.60, measured off the model; the 1.89 in the kit's notes is the top of what is on
 * the roof), and a clear spot on it, to one side.
 */
const ROOF = { x: -0.95, y: 1.6, z: 0.45 }
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
  const stacked = plots.filter((plot) => plot.stacks?.length && plot.busy > 0)
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

    // Stacks: one to a platform, where the workspace says there is room. A module on the deck,
    // and one or two more above it for a workspace with more going on, each on the floor of
    // a frame that stands over the one below.
    //
    // What stands inside a frame is squared up with it, or its corners would come through
    // the frame's braces. The top storey has nothing over it and is the one that is turned
    // and shifted, as things are when they are added by whoever needed the room. No two
    // storeys of a stack are the same kind of module.
    const stacks = plot.busy > 0 ? plot.stacks || [] : []
    stacks.forEach((stack, at) => {
      const seed = hash(`${plot.id}/stack/${at}`)
      const pick = (seed >>> 9) % 6
      const storeys = plot.busy >= 4 ? [3, 3, 2, 3, 2, 3][pick] : plot.busy >= 2 ? [2, 2, 3, 2, 1, 2][pick] : [1, 2, 1, 2, 2, 1][pick]
      const sign = at === 0 ? signOf.get(plot.id) : null
      const step = 1 + (seed % 3)
      const cos = Math.cos(stack.turn)
      const sin = Math.sin(stack.turn)
      // Along the frame's own length (its x) and across it (its z), on the ground.
      const place = (along, across) => ({ x: stack.x + along * cos + across * sin, z: stack.z - along * sin + across * cos })
      let top = null
      for (let k = 0; k < storeys; k++) {
        const roll = hash(`${plot.id}/stack/${at}/${k}`)
        let kind = MODULES[(seed + k * step) % MODULES.length]
        const last = k === storeys - 1
        // A sign or a dish needs the cabin's flat roof.
        if (last && sign) kind = 'mod-cabin'
        let spot
        let turn
        if (!last) {
          // Under a frame: squared up with it, one way round or the other, a hand's width off centre.
          put('frame', stack.x, stack.z, stack.turn, y + k * FRAME)
          spot = place((((roll >>> 3) % 5) - 2) * 0.04, 0)
          turn = stack.turn + ((roll >>> 8) % 2) * Math.PI
        } else {
          // On top, or alone on the deck: turned off square and shifted, but not off its floor.
          const off = [0.22, -0.3, 0.45, -0.5, 1.2, -1.0][(roll >>> 3) % 6]
          spot = place((((roll >>> 8) % 7) - 3) * 0.1, (((roll >>> 12) % 5) - 2) * 0.08)
          turn = stack.turn + off + ((roll >>> 16) % 2) * Math.PI
        }
        put(kind, spot.x, spot.z, turn, y + k * FRAME)
        if (last) top = { kind, spot, turn, y: y + k * FRAME }
      }
      if (storeys > 1) put('ladder', stack.x, stack.z, stack.turn)
      // On the cabin's roof, to one side of what is already up there: a neon sign for the
      // few workspaces that have one, a dish on some of the rest.
      if (top && top.kind === 'mod-cabin' && (sign || seed % 4 === 1)) {
        const c = Math.cos(top.turn)
        const n = Math.sin(top.turn)
        put(sign || 'dish', top.spot.x + ROOF.x * c + ROOF.z * n, top.spot.z - ROOF.x * n + ROOF.z * c, top.turn, top.y + ROOF.y)
      }
    })

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

/**
 * Where each kind of deck has a plate for a number: its middle in the deck's own space, and
 * the turn it reads at. From the kit's notes (`design/campus/settlement.md`, "Deck numbers").
 * At a turn t a number reads along (cos t, -sin t) on the ground.
 */
const NUMBER_PLATE = {
  'deck-a': { x: 2.542, z: -1.468, turn: Math.PI / 6 },
  'deck-b': { x: -2.3, z: 0.363, turn: Math.PI / 2 },
  'deck-c': { x: -3.775, z: -0.101, turn: (Math.PI * 5) / 6 },
  'deck-d': { x: 2.0, z: -2.792, turn: Math.PI / 2 },
}
/** One painted digit, how far apart two are, and how far above the plate they are laid. */
const DIGIT = { width: 0.885, height: 1.327, pitch: 0.678, proud: 0.02 }

/**
 * The number painted on each deck.
 *
 * Two digits from the workspace's name and the deck's place in it, so a campus carries dozens
 * of different numbers, each deck keeps its own, and nothing about them is baked into a deck.
 *
 * @param {Placed[]} parts
 * @returns {Array<{plot: string, digit: number, x: number, y: number, z: number, turn: number, width: number, height: number}>}
 *   two for each deck, tens then units
 */
export function settlementNumbers(parts) {
  const digits = []
  const nth = new Map()
  for (const part of parts) {
    const plate = NUMBER_PLATE[part.part]
    if (!plate) continue
    const n = nth.get(part.plot) || 0
    nth.set(part.plot, n + 1)
    const number = hash(`${part.plot}/number/${n}`) % 100
    // The plate's place, turned with the deck; and the way the number reads, turned with it too.
    const cos = Math.cos(part.turn)
    const sin = Math.sin(part.turn)
    const cx = part.x + plate.x * cos + plate.z * sin
    const cz = part.z - plate.x * sin + plate.z * cos
    const turn = part.turn + plate.turn
    const along = { x: Math.cos(turn), z: -Math.sin(turn) }
    ;[Math.floor(number / 10), number % 10].forEach((digit, place) => {
      const off = (place - 0.5) * DIGIT.pitch
      digits.push({
        plot: part.plot, digit, x: cx + along.x * off, y: part.y + DIGIT.proud, z: cz + along.z * off,
        turn, width: DIGIT.width, height: DIGIT.height,
      })
    })
  }
  return digits
}
