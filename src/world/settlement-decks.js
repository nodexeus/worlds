/**
 * Which deck stands on each of a workspace's cells, and which way round.
 *
 * The decks are not hexagons (`design/campus/settlement.md`, "Decks of their own shape"). Each
 * has ports on some of its six sides, where a crossing can meet it, and some push a wing out
 * past their own cell. So a deck has to be chosen and turned to suit where it is: its ports
 * have to cover every side a crossing comes in on, and a wing may only point at a cell that
 * is kept empty for good.
 *
 * A workspace of several cells is covered by large decks, each one slab over two neighbouring
 * cells, and single decks for what is left over. Its decks are joined to each other by
 * gangways of their own.
 *
 * Pure: cells in, a list of what stands where out.
 */
import SHAPES from './deck-shapes.js'
import { HEX_DIRS, cellKey } from './plot-move.js'
import { hexToWorld } from './plots.js'
import { STOREYS } from './settlement-load.js'

export { onOutlines } from './outline.js'

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

/**
 * Which of a deck's six sides faces each neighbour, by the deck's own numbering: side k is
 * toward the edge midpoint at 30 + 60k degrees, measured so that an angle `a` points along
 * (cos a, -sin a) on the ground. `SIDE_OF[d]` is that number for the neighbour `HEX_DIRS[d]`.
 */
export const SIDE_OF = HEX_DIRS.map(([dq, dr]) => {
  const there = hexToWorld(dq, dr)
  const degrees = (Math.atan2(-there.z, there.x) * 180) / Math.PI
  return ((Math.round((degrees - 30) / 60) % 6) + 6) % 6
})
/** And back: the neighbour a side faces. */
const DIR_OF = SIDE_OF.reduce((out, side, d) => ((out[side] = d), out), [])

const SINGLES = Object.keys(SHAPES).filter((name) => SHAPES[name].cells === 1)
const LARGES = Object.keys(SHAPES).filter((name) => SHAPES[name].cells === 2)

/** How many sessions a deck holds: a building for each place on its floor, and its stacks full. */
export const holds = (name) => SHAPES[name].buildings.length + SHAPES[name].stacks.length * STOREYS

const turned = (side, turn) => (side + turn) % 6

/**
 * @typedef {object} Unit  one deck, where it stands
 * @property {string} deck    the kit part
 * @property {number} turn    in sixths of a turn
 * @property {Array<{q: number, r: number}>} cells  the cell at its origin first
 * @property {Array<{cell: {q: number, r: number}, side: number}>} gates  ports with nothing at them
 */

/**
 * @param {object} workspace
 * @param {string} workspace.id
 * @param {Array<{q: number, r: number}>} workspace.cells
 * @param {number} workspace.load   how many sessions it has to hold
 * @param {Array<{from: {q: number, r: number}, toward: {q: number, r: number}}>} workspace.doors
 *   where a crossing or a walkway comes in: a cell of this workspace and the neighbour it faces
 * @param {(cell: {q: number, r: number}) => boolean} isEmpty  whether a cell is kept empty for good
 * @param {Map<string, {deck: string, turn: number}>} [kept]  what stood on each origin cell
 *   before, kept wherever it still suits so that a workspace does not change shape for nothing
 * @returns {{units: Unit[], links: Array<{from: {q: number, r: number}, to: {q: number, r: number}}>}}
 */
export function planDecks({ id, cells, load, doors }, isEmpty, kept = new Map()) {
  const mine = new Set(cells.map((cell) => cellKey(cell.q, cell.r)))
  const sideToward = (from, to) => SIDE_OF[HEX_DIRS.findIndex(([dq, dr]) => from.q + dq === to.q && from.r + dr === to.r)]
  const keyOf = (cell) => cellKey(cell.q, cell.r)
  const share = Math.ceil(load / Math.max(1, cells.length))
  /** Pairs of cells that are not to be one large deck, and sides a cell must have a port on, found out the hard way. */
  const banned = new Set()
  const forced = new Map()

  for (let attempt = 0; attempt < cells.length * 3 + 2; attempt++) {
    // Pair neighbouring cells off for large decks, in the order the workspace claimed them.
    const groups = []
    const used = new Set()
    for (const cell of cells) {
      if (used.has(keyOf(cell))) continue
      used.add(keyOf(cell))
      const mate = cells.find((other) => !used.has(keyOf(other)) && !banned.has(`${keyOf(cell)}|${keyOf(other)}`) &&
        HEX_DIRS.some(([dq, dr]) => cell.q + dq === other.q && cell.r + dr === other.r))
      if (mate) {
        used.add(keyOf(mate))
        groups.push([cell, mate])
      } else groups.push([cell])
    }
    const groupOf = new Map()
    groups.forEach((group, g) => group.forEach((cell) => groupOf.set(keyOf(cell), g)))

    // The sides each cell must have a port on: where a crossing or a walkway comes in.
    const needs = new Map(cells.map((cell) => [keyOf(cell), new Set(forced.get(keyOf(cell)) || [])]))
    for (const door of doors) needs.get(keyOf(door.from))?.add(sideToward(door.from, door.toward))

    const optionsFor = (g, extra = null) => {
      const group = groups[g]
      const need = (cell) => (extra && keyOf(extra.cell) === keyOf(cell) ? new Set([...needs.get(keyOf(cell)), extra.side]) : needs.get(keyOf(cell)))
      return group.length === 2 ? largeOptions(group, need, isEmpty, mine) : singleOptions(group[0], need(group[0]), isEmpty, mine)
    }
    const ban = (group) => {
      banned.add(`${keyOf(group[0])}|${keyOf(group[1])}`)
      banned.add(`${keyOf(group[1])}|${keyOf(group[0])}`)
    }

    // The first deck, then each of the rest joined on to one already chosen by a gangway
    // between two cells that touch, where both decks have a port. A deck is chosen knowing
    // the side it is to be joined on by; the one it joins must already have a port there.
    const chosen = new Map()
    const links = []
    const first = pick(id, groups[0][0], optionsFor(0), share * groups[0].length, kept)
    let retry = false
    if (!first) {
      if (groups[0].length === 2) ban(groups[0])
      else return { units: [], links: [] }
      continue
    }
    chosen.set(0, first)
    while (chosen.size < groups.length && !retry) {
      let joined = false
      let stuck = null
      for (const cell of cells) {
        const g = groupOf.get(keyOf(cell))
        if (!chosen.has(g)) continue
        for (const [dq, dr] of HEX_DIRS) {
          const other = { q: cell.q + dq, r: cell.r + dr }
          const h = groupOf.get(keyOf(other))
          if (h === undefined || chosen.has(h)) continue
          stuck ||= { g, h, cell, other }
          if (!portsOf(chosen.get(g), cell).has(sideToward(cell, other))) continue
          const option = pick(id, groups[h][0], optionsFor(h, { cell: other, side: sideToward(other, cell) }), share * groups[h].length, kept)
          if (!option) continue
          chosen.set(h, option)
          links.push({ from: { q: cell.q, r: cell.r }, to: other })
          joined = true
        }
      }
      if (joined) continue
      // Nothing more can be joined on as things stand. Loosen one thing and start again: a
      // large deck that is in the way becomes two singles, and failing that the deck already
      // standing is made to have a port on the side that is wanted.
      retry = true
      if (!stuck) return { units: [], links: [] }
      if (groups[stuck.h].length === 2) ban(groups[stuck.h])
      else if (groups[stuck.g].length === 2) ban(groups[stuck.g])
      else {
        const key = keyOf(stuck.cell)
        forced.set(key, new Set([...(forced.get(key) || []), sideToward(stuck.cell, stuck.other)]))
      }
    }
    if (retry) continue

    // What is at each port: a door, a link, or nothing, which gets a gate.
    const inUse = new Map(cells.map((cell) => [keyOf(cell), new Set()]))
    for (const door of doors) inUse.get(keyOf(door.from))?.add(sideToward(door.from, door.toward))
    for (const link of links) {
      inUse.get(keyOf(link.from)).add(sideToward(link.from, link.to))
      inUse.get(keyOf(link.to)).add(sideToward(link.to, link.from))
    }
    const units = groups.map((group, g) => {
      const option = chosen.get(g)
      const gates = []
      for (const cell of option.cells) for (const side of portsOf(option, cell)) if (!inUse.get(keyOf(cell)).has(side)) gates.push({ cell, side })
      // `sides`: for each of its cells, the sides it has a port on.
      return { deck: option.deck, turn: option.turn, cells: option.cells, gates, sides: option.ports.map((ports) => [...ports]) }
    })
    return { units, links }
  }
  return { units: [], links: [] }
}

/** The sides of one of its cells a chosen deck has a port on. */
function portsOf(option, cell) {
  const which = option.cells.findIndex((own) => own.q === cell.q && own.r === cell.r)
  return option.ports[which] || new Set()
}

/** Whether every wing of a deck, at this turn, points at a cell kept empty and not at one of the workspace's own. */
function wingsClear(wings, turn, cellOf, isEmpty, mine) {
  for (const wing of wings) {
    const [which, side] = Array.isArray(wing) ? wing : [0, wing]
    const from = cellOf(which)
    const [dq, dr] = HEX_DIRS[DIR_OF[turned(side, turn)]]
    const at = { q: from.q + dq, r: from.r + dr }
    if (mine.has(cellKey(at.q, at.r)) || !isEmpty(at)) return false
  }
  return true
}

/**
 * Of the decks that suit, the one to stand there. What stood there before stays if it still
 * suits and has not been outgrown. Otherwise one that holds enough: the kind of deck is chosen
 * first, by the workspace's own name, and then which way round, so that a deck with a port
 * on every side, which suits any turn, is not what nearly everybody gets.
 */
function pick(id, origin, options, wanted, kept) {
  if (!options.length) return null
  const before = kept.get(cellKey(origin.q, origin.r))
  const same = before && options.find((option) => option.deck === before.deck && option.turn === before.turn)
  if (same && (holds(same.deck) >= wanted || !options.some((option) => holds(option.deck) > holds(same.deck)))) return same
  const most = Math.max(...options.map((option) => holds(option.deck)))
  const enough = options.filter((option) => holds(option.deck) >= Math.min(wanted, most))
  let kinds = [...new Set(enough.map((option) => option.deck))].sort()
  // A deck with a port on every side suits anything, and holds least: only when nothing else does.
  const particular = kinds.filter((kind) => SHAPES[kind].ports.length < 6 * SHAPES[kind].cells)
  if (particular.length) kinds = particular
  const seed = hash(`${id}/deck/${origin.q},${origin.r}`)
  const kind = kinds[seed % kinds.length]
  const turns = enough.filter((option) => option.deck === kind)
  return turns[(seed >>> 8) % turns.length]
}

function singleOptions(cell, needed, isEmpty, mine) {
  const options = []
  for (const deck of SINGLES) {
    const shape = SHAPES[deck]
    for (let turn = 0; turn < 6; turn++) {
      const ports = new Set(shape.ports.map((side) => turned(side, turn)))
      if (![...needed].every((side) => ports.has(side))) continue
      if (!wingsClear(shape.wings, turn, () => cell, isEmpty, mine)) continue
      options.push({ deck, turn, ports: [ports], cells: [cell] })
    }
  }
  return options
}

function largeOptions(pair, need, isEmpty, mine) {
  const options = []
  // Either cell can be the one at the deck's origin; its second cell is on its side 0.
  for (const [first, second] of [pair, [pair[1], pair[0]]]) {
    const turn = SIDE_OF[HEX_DIRS.findIndex(([dq, dr]) => first.q + dq === second.q && first.r + dr === second.r)]
    const cellOf = (which) => (which ? second : first)
    for (const deck of LARGES) {
      const shape = SHAPES[deck]
      const ports = [new Set(), new Set()]
      for (const [which, side] of shape.ports) ports[which].add(turned(side, turn))
      const fits = [first, second].every((cell, which) => [...need(cell)].every((side) => ports[which].has(side)))
      if (!fits || !wingsClear(shape.wings, turn, cellOf, isEmpty, mine)) continue
      options.push({ deck, turn, ports, cells: [first, second] })
    }
  }
  return options
}

/**
 * A deck's own measurements put where it stands: its outline, the places on it, its posts,
 * its lit strips and its number, all on the ground of the campus.
 *
 * @param {Unit} unit
 * @returns {{outline: Array<{x: number, z: number}>, buildings: Array<{x: number, z: number}>,
 *   stacks: Array<{x: number, z: number, turn: number}>, posts: Array<{x: number, z: number}>,
 *   lit: Array<{x: number, z: number, turn: number, length: number}>, number: {x: number, z: number, turn: number} | null,
 *   x: number, z: number, turn: number}}
 */
export function placed(unit) {
  const shape = SHAPES[unit.deck]
  const origin = hexToWorld(unit.cells[0].q, unit.cells[0].r)
  const turn = unit.turn * SIXTH
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const at = ([x, z]) => ({ x: origin.x + x * cos + z * sin, z: origin.z - x * sin + z * cos })
  const there = (thing) => ({ ...thing, ...at([thing.x, thing.z]), turn: thing.turn + turn })
  return {
    x: origin.x, z: origin.z, turn,
    outline: shape.outline.map(at),
    buildings: shape.buildings.map(at),
    stacks: shape.stacks.map(there),
    posts: shape.posts.map(at),
    lit: shape.lit.map(there),
    number: shape.number ? there(shape.number) : null,
  }
}

/** Where a side of a cell meets its neighbour: the middle of that edge, and the turn that faces out through it. */
export function mouth(cell, side, apothem) {
  const [dq, dr] = HEX_DIRS[DIR_OF[side]]
  const here = hexToWorld(cell.q, cell.r)
  const there = hexToWorld(cell.q + dq, cell.r + dr)
  const dx = there.x - here.x
  const dz = there.z - here.z
  const far = Math.hypot(dx, dz)
  return { x: here.x + (dx / far) * apothem, z: here.z + (dz / far) * apothem, turn: Math.atan2(dx, dz) }
}
