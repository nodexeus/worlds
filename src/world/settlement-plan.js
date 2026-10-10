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
import SHAPES from './deck-shapes.js'
import { shadeOf } from './shades.js'

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

    // A workspace whose decks are of their own shape has them stood by `settlement-decks.js`:
    // here it has only its stacks.
    for (const cell of plot.shaped ? [] : plot.cells) {
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
      // As high as the sessions in it, where the workspace says; otherwise by how busy it is.
      const storeys = stack.storeys ?? (plot.busy >= 4 ? [3, 3, 2, 3, 2, 3][pick] : plot.busy >= 2 ? [2, 2, 3, 2, 1, 2][pick] : [1, 2, 1, 2, 2, 1][pick])
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
    if (/^deck-/.test(part.part) && !/^deck-(join|fill)$/.test(part.part)) deckOf.set(part.plot, part.y)
  }
  const raw = []
  const pools = { push: (pool) => raw.push(pool.color === 'amber' ? { ...pool, color: shadeOf(pool.plot) } : pool) }
  for (const part of parts) {
    const deck = deckOf.get(part.plot) ?? part.y
    // A deck of its own shape has its lit strips built in, and says where they are.
    const shape = SHAPES[part.part]
    if (shape) {
      const cos = Math.cos(part.turn)
      const sin = Math.sin(part.turn)
      for (const lit of shape.lit) {
        const turn = lit.turn + part.turn
        const x = part.x + lit.x * cos + lit.z * sin
        const z = part.z - lit.x * sin + lit.z * cos
        pools.push({ plot: part.plot, kind: 'band', color: 'amber', x: x - Math.sin(turn) * 1.1, y: part.y + PROUD, z: z - Math.cos(turn) * 1.1, turn, width: lit.length, depth: 2.6 })
      }
      continue
    }
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
  return raw
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
    const plate = NUMBER_PLATE[part.part] || SHAPES[part.part]?.number
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

/**
 * The leg to stand where the ground is `drop` lower than the floor: over a canal.
 *
 * A leg made for the floor stops in the air there. So a longer one is used, made for a deck
 * as many levels higher as it takes to reach, its foot in the bed; and where there is none
 * long enough, the longest is drawn out the rest of the way.
 *
 * @param {string} part   `post-N` or `legs-N`, for a deck on level N
 * @param {number} drop   how far below the floor the ground is there
 * @param {number} levelStep
 * @returns {{part: string, stretch: number}} `stretch` is how much longer it is drawn, downward from the deck
 */
export function reachDown(part, drop, levelStep) {
  const made = /^(post|legs)-(\d)$/.exec(part)
  if (!made || !(drop > 0.05)) return { part, stretch: 1 }
  const level = Number(made[2])
  const length = (n) => LEVEL_ONE + (n - 1) * levelStep
  const need = length(level) + drop
  let use = level
  while (use < 5 && length(use) < need) use++
  return { part: `${made[1]}-${use}`, stretch: Math.max(1, need / length(use)) }
}

/** How high the lowest deck stands above the floor: the length of the shortest leg. */
const LEVEL_ONE = 1.8

/**
 * Where lamps hang under a deck of its own shape, lighting its legs and the ground below.
 *
 * Under where a stack stands, since there is slab there whatever the deck's shape. Most decks
 * have one, some two, and some were never given any.
 *
 * @param {string} plot  the workspace's id
 * @param {{deck: string, at: {stacks: Array<{x: number, z: number}>}}} unit
 * @returns {Array<{x: number, z: number}>}
 */
export function underLamps(plot, unit) {
  const spots = unit.at.stacks
  if (!spots.length) return []
  const roll = hash(`${plot}/${unit.deck}/under`)
  if (roll % 4 === 0) return []
  const first = (roll >>> 4) % spots.length
  const lamps = [{ x: spots[first].x, z: spots[first].z }]
  if (spots.length > 1 && (roll >>> 8) % 3 === 0) {
    const other = spots[(first + 1) % spots.length]
    lamps.push({ x: other.x, z: other.z })
  }
  return lamps
}

/** How long a run is made, and how far it can be drawn or squeezed: see "Runs between stacks" in the kit's notes. */
const RUN = 6
const RUN_REACH = { lights: [3.6, 12], other: [3, 15] }
/** How high each module's roof is at its middle, and half a frame's length and width. */
const ROOF_HIGH = { 'mod-cabin': 1.89, 'mod-drum': 1.93, 'mod-shed': 1.73, 'mod-tank': 1.79 }
const FRAME_HALF = { along: 1.78, across: 1.18 }
/** The least a line's ends are above the higher of its two decks: over the heads of whoever is on it. */
const RUN_CLEAR = 1.7
/** How far each kind of run sags at its lowest, and how far above a deck that must stay: a robot and a hand. */
const RUN_SAG = { 'run-cable': 0.81, 'run-cable-b': 0.98, 'run-lights': 0.58, 'run-lights-b': 0.85, 'run-pipe': 0.12 }
const HEAD_ROOM = 1.15

/**
 * What is hung between stacks: cables, a string of lights, a bundle of pipes.
 *
 * A line is made fast to something that is there: the middle of the roof of whatever is on
 * top of a stack, or the edge of the floor a frame carries, on the side facing the other end.
 * Stacks near enough to each other are tied, some of them and not all, each end at whichever
 * of its places its own name picks, so the lines cross the campus at every height. None goes
 * to a stack that already has two, none passes through a third stack, none comes down to
 * where anybody walks on the higher of its two decks, and a pipe, being rigid, only where it
 * can run level.
 *
 * @param {Placed[]} parts  the settlement's parts; only its modules and frames are read
 * @returns {Array<Placed & {pitch: number, span: number}>} `pitch` tips the far end up (negative) or down, `span` draws it along its length
 */
export function settlementRuns(parts) {
  const stacks = []
  const stackAt = (part, reach) => {
    // The storeys of one stack stand a hand's width off each other: whatever is within a pace is the same stack.
    let stack = stacks.find((other) => other.plot === part.plot && Math.hypot(other.x - part.x, other.z - part.z) < reach)
    if (!stack) {
      stack = { key: `${part.x.toFixed(2)},${part.z.toFixed(2)}`, plot: part.plot, x: part.x, z: part.z, deck: part.y, places: [], top: null, runs: 0 }
      stacks.push(stack)
    }
    stack.deck = Math.min(stack.deck, part.y)
    return stack
  }
  // Frames first: a stack stands where its frames do, and what is on top of it is turned and shifted.
  for (const part of parts) {
    if (part.part === 'frame') stackAt(part, 0.01).places.push({ frame: part, y: part.y + FRAME })
  }
  for (const part of parts) {
    const high = ROOF_HIGH[part.part]
    if (!high) continue
    const stack = stackAt(part, 0.9)
    if (!stack.top || part.y > stack.top.y - high) stack.top = { x: part.x, z: part.z, y: part.y + high }
  }
  for (const stack of stacks) {
    if (stack.top) stack.places.push(stack.top)
    stack.places.sort((a, b) => a.y - b.y)
  }
  const all = stacks.filter((stack) => stack.places.length).sort((a, b) => (a.key < b.key ? -1 : 1))
  /** Where a line toward (tx, tz) is made fast at one of a stack's places. */
  const fast = (place, tx, tz) => {
    if (!place.frame) return { x: place.x, y: place.y, z: place.z }
    const { x, z, turn } = place.frame
    const dx = tx - x
    const dz = tz - z
    const far = Math.hypot(dx, dz) || 1
    // The way to the other end, in the frame's own length and width, out to its edge.
    const along = (dx * Math.cos(turn) - dz * Math.sin(turn)) / far
    const across = (dx * Math.sin(turn) + dz * Math.cos(turn)) / far
    const out = Math.min(FRAME_HALF.along / Math.max(Math.abs(along), 1e-6), FRAME_HALF.across / Math.max(Math.abs(across), 1e-6))
    return { x: x + (dx / far) * out, y: place.y, z: z + (dz / far) * out }
  }
  const pairs = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const far = Math.hypot(all[j].x - all[i].x, all[j].z - all[i].z)
      if (far >= RUN_REACH.other[0] && far <= RUN_REACH.other[1] + 3.6) pairs.push({ a: all[i], b: all[j], far })
    }
  }
  // Nearest first, so what is tied is what stands together.
  pairs.sort((p, q) => p.far - q.far || (p.a.key + p.b.key < q.a.key + q.b.key ? -1 : 1))
  const runs = []
  for (const { a, b, far } of pairs) {
    if (a.runs >= 2 || b.runs >= 2) continue
    const roll = hash(`${a.key}/${b.key}/run`)
    if (roll % 5 >= 4) continue
    const floor = Math.max(a.deck, b.deck) + RUN_CLEAR
    const pick = (stack, n) => {
      const high = stack.places.filter((place) => place.y >= floor)
      return high.length ? high[n % high.length] : null
    }
    const pa = pick(a, roll >>> 4)
    const pb = pick(b, roll >>> 9)
    if (!pa || !pb) continue
    const ux = (b.x - a.x) / far
    const uz = (b.z - a.z) / far
    // Not through another stack on the way.
    const through = all.some((other) => {
      if (other === a || other === b) return false
      const along = (other.x - a.x) * ux + (other.z - a.z) * uz
      const across = Math.abs((other.x - a.x) * -uz + (other.z - a.z) * ux)
      return along > 0 && along < far && across < 2.2
    })
    if (through) continue
    const from = fast(pa, b.x, b.z)
    const to = fast(pb, a.x, a.z)
    const flat = Math.hypot(to.x - from.x, to.z - from.z)
    const rise = to.y - from.y
    const length = Math.hypot(flat, rise)
    const pitch = -Math.atan2(rise, flat)
    if (Math.abs(pitch) > 0.45 || length < RUN_REACH.other[0] || length > RUN_REACH.other[1]) continue
    const lit = length >= RUN_REACH.lights[0] && length <= RUN_REACH.lights[1]
    const kind = (roll >>> 14) % 10
    // Whichever kinds hang clear of the heads of anybody on the higher deck, at their lowest.
    const room = Math.min(from.y, to.y) - Math.max(a.deck, b.deck) - HEAD_ROOM
    const hangs = (name) => RUN_SAG[name] <= room && (lit || !/lights/.test(name))
    const wanted = Math.abs(rise) < 0.01 && flat < 9 && kind === 0
      ? ['run-pipe']
      : lit && kind < 6
        ? (kind % 2 ? ['run-lights', 'run-lights-b'] : ['run-lights-b', 'run-lights'])
        : (kind % 2 ? ['run-cable', 'run-cable-b', 'run-lights'] : ['run-cable-b', 'run-cable', 'run-lights'])
    const part = wanted.find(hangs)
    if (!part) continue
    a.runs++
    b.runs++
    runs.push({ part, plot: a.plot, x: from.x, y: from.y, z: from.z, turn: Math.atan2(to.x - from.x, to.z - from.z), pitch, span: length / RUN })
  }
  return runs
}
