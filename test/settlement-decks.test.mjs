// test/settlement-decks.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import SHAPES from '../src/world/deck-shapes.js'
import { HEX_DIRS } from '../src/world/plot-move.js'
import { hexToWorld } from '../src/world/plots.js'
import { SIDE_OF, holds, mouth, onOutlines, placed, planDecks } from '../src/world/settlement-decks.js'

const nowhere = () => false
const anywhere = () => true
const toward = (cell, d) => ({ q: cell.q + HEX_DIRS[d][0], r: cell.r + HEX_DIRS[d][1] })
const HOME = { q: 2, r: -1 }

test('each side of a deck faces one neighbour, and all six are spoken for', () => {
  assert.deepEqual([...SIDE_OF].sort(), [0, 1, 2, 3, 4, 5])
  // Side k is toward the edge midpoint at 30 + 60k degrees, an angle a pointing along (cos a, -sin a).
  HEX_DIRS.forEach(([dq, dr], d) => {
    const there = hexToWorld(dq, dr)
    const a = ((30 + 60 * SIDE_OF[d]) * Math.PI) / 180
    const far = Math.hypot(there.x, there.z)
    assert.ok(Math.abs(there.x / far - Math.cos(a)) < 1e-6 && Math.abs(there.z / far + Math.sin(a)) < 1e-6)
  })
})

test('a deck is turned so that it has a port wherever a crossing comes in, whatever the sides', () => {
  for (let mask = 0; mask < 64; mask++) {
    const doors = [0, 1, 2, 3, 4, 5].filter((d) => mask & (1 << d)).map((d) => ({ from: HOME, toward: toward(HOME, d) }))
    const { units } = planDecks({ id: `ws-${mask}`, cells: [HOME], load: 2, doors }, nowhere)
    assert.equal(units.length, 1, `nothing suits doors ${mask.toString(2)}`)
    const [unit] = units
    const ports = new Set(SHAPES[unit.deck].ports.map((side) => (side + unit.turn) % 6))
    for (const door of doors) {
      const side = SIDE_OF[HEX_DIRS.findIndex(([dq, dr]) => HOME.q + dq === door.toward.q && HOME.r + dr === door.toward.r)]
      assert.ok(ports.has(side), `${unit.deck} at ${unit.turn} has no port toward a door`)
    }
    // Every port with nothing at it is gated, and no door is.
    assert.equal(unit.gates.length, ports.size - doors.length)
  }
})

test('a wing only ever points at a cell kept empty for good', () => {
  const winged = (name) => SHAPES[name].wings.length > 0
  let seen = 0
  for (let n = 0; n < 200; n++) {
    const empty = toward(HOME, n % 6)
    const isEmpty = (cell) => cell.q === empty.q && cell.r === empty.r
    const { units: [unit] } = planDecks({ id: `wing-${n}`, cells: [HOME], load: 4, doors: [{ from: HOME, toward: toward(HOME, (n + 3) % 6) }] }, isEmpty)
    if (!winged(unit.deck)) continue
    seen++
    for (const side of SHAPES[unit.deck].wings) {
      const d = SIDE_OF.indexOf((side + unit.turn) % 6)
      assert.deepEqual(toward(HOME, d), empty)
    }
  }
  assert.ok(seen > 10, 'and some decks with wings are used')
  // With nowhere kept empty, none is.
  for (let n = 0; n < 60; n++) {
    const { units: [unit] } = planDecks({ id: `none-${n}`, cells: [HOME], load: 4, doors: [] }, nowhere)
    assert.equal(winged(unit.deck), false)
  }
})

test('a busy workspace is given a deck that holds what it has, where one suits', () => {
  for (let n = 0; n < 40; n++) {
    const { units: [unit] } = planDecks({ id: `busy-${n}`, cells: [HOME], load: 8, doors: [{ from: HOME, toward: toward(HOME, 0) }] }, anywhere)
    assert.ok(holds(unit.deck) >= 8, `${unit.deck} holds ${holds(unit.deck)}`)
  }
  const sizes = new Set()
  for (let n = 0; n < 60; n++) sizes.add(SHAPES[planDecks({ id: `quiet-${n}`, cells: [HOME], load: 1, doors: [{ from: HOME, toward: toward(HOME, 0) }] }, anywhere).units[0].deck].size)
  assert.deepEqual([...sizes].sort(), ['medium', 'small'], 'a quiet one may be small or not')
})

test('two neighbouring cells of one workspace are one large deck, and odd cells are joined on by a gangway', () => {
  const second = toward(HOME, 0)
  const pair = planDecks({ id: 'pair', cells: [HOME, second], load: 12, doors: [] }, nowhere)
  assert.equal(pair.units.length, 1)
  assert.equal(SHAPES[pair.units[0].deck].cells, 2)
  assert.equal(pair.links.length, 0)
  // Its second cell is where the deck says it is: on side 0 of the first, turned with it.
  const [first, other] = pair.units[0].cells
  const d = HEX_DIRS.findIndex(([dq, dr]) => first.q + dq === other.q && first.r + dr === other.r)
  assert.equal(pair.units[0].turn, SIDE_OF[d])

  const third = toward(second, 0)
  const three = planDecks({ id: 'three', cells: [HOME, second, third], load: 18, doors: [] }, nowhere)
  assert.equal(three.units.length, 2)
  assert.equal(three.links.length, 1)
  assert.equal(three.units.reduce((n, unit) => n + unit.cells.length, 0), 3)
})

test('a deck that still suits is kept, so a workspace does not change shape for nothing', () => {
  const doors = [{ from: HOME, toward: toward(HOME, 2) }]
  const first = planDecks({ id: 'same', cells: [HOME], load: 2, doors }, anywhere).units[0]
  const kept = new Map([[`${HOME.q},${HOME.r}`, { deck: 'deck-m1', turn: 0 }]])
  // Kept where it suits, even though the name alone would have chosen otherwise.
  const m1 = planDecks({ id: 'same', cells: [HOME], load: 2, doors: [{ from: HOME, toward: toward(HOME, SIDE_OF.indexOf(0)) }] }, anywhere, kept).units[0]
  assert.deepEqual([m1.deck, m1.turn], ['deck-m1', 0])
  assert.deepEqual(planDecks({ id: 'same', cells: [HOME], load: 2, doors }, anywhere).units[0], first)
})

test('a deck\'s own measurements are put where it stands, turned with it', () => {
  const unit = { deck: 'deck-m1', turn: 2, cells: [HOME] }
  const there = placed(unit)
  const origin = hexToWorld(HOME.q, HOME.r)
  assert.equal(there.outline.length, SHAPES['deck-m1'].outline.length)
  assert.equal(there.buildings.length, 2)
  assert.equal(there.stacks.length, 2)
  // Turning keeps everything as far from the middle as it was.
  SHAPES['deck-m1'].posts.forEach(([x, z], n) => {
    assert.ok(Math.abs(Math.hypot(there.posts[n].x - origin.x, there.posts[n].z - origin.z) - Math.hypot(x, z)) < 1e-9)
  })
  // Every port's mouth is on the floor, and a step past it is not.
  for (const side of SHAPES['deck-m1'].ports) {
    const at = mouth(HOME, (side + 2) % 6, 5.146)
    const inward = { x: at.x - Math.sin(at.turn) * 0.4, z: at.z - Math.cos(at.turn) * 0.4 }
    const outward = { x: at.x + Math.sin(at.turn) * 0.4, z: at.z + Math.cos(at.turn) * 0.4 }
    assert.equal(onOutlines([there.outline], inward.x, inward.z), true, `side ${side}: inside the mouth`)
    assert.equal(onOutlines([there.outline], outward.x, outward.z), false)
    assert.equal(onOutlines([there.outline], outward.x, outward.z, -0.6), true, 'unless the edge is taken a little wide')
  }
  for (const spot of [...there.buildings, ...there.stacks, ...there.posts]) assert.equal(onOutlines([there.outline], spot.x, spot.z, 0.3), true)
})

test('a workspace of many cells is mostly large decks, every deck joined to the rest at ports both have', () => {
  // Six cells in a clump, as the campus grows them.
  const cells = [HOME, toward(HOME, 0), toward(HOME, 1), toward(HOME, 2), toward(toward(HOME, 0), 1), toward(toward(HOME, 1), 2)]
  for (let n = 0; n < 30; n++) {
    const doors = [{ from: cells[n % 6], toward: toward(cells[n % 6], 4) }].filter((door) => !cells.some((cell) => cell.q === door.toward.q && cell.r === door.toward.r))
    const { units, links } = planDecks({ id: `clump-${n}`, cells, load: 31, doors }, n % 2 ? anywhere : nowhere)
    assert.equal(units.reduce((sum, unit) => sum + unit.cells.length, 0), 6, 'every cell has a deck')
    assert.equal(links.length, units.length - 1, 'joined into one')
    assert.ok(units.filter((unit) => unit.cells.length === 2).length >= 1, `clump-${n}: no large deck at all`)
    const portOn = (cell, other) => {
      const unit = units.find((u) => u.cells.some((own) => own.q === cell.q && own.r === cell.r))
      const which = unit.cells.findIndex((own) => own.q === cell.q && own.r === cell.r)
      const d = HEX_DIRS.findIndex(([dq, dr]) => cell.q + dq === other.q && cell.r + dr === other.r)
      const shape = SHAPES[unit.deck]
      const sides = shape.cells === 2 ? shape.ports.filter(([w]) => w === which).map(([, side]) => side) : shape.ports
      return sides.some((side) => (side + unit.turn) % 6 === SIDE_OF[d])
    }
    for (const link of links) assert.ok(portOn(link.from, link.to) && portOn(link.to, link.from), 'a link with no port at one end')
    for (const door of doors) assert.ok(portOn(door.from, door.toward))
  }
})

test('a deck with a port on every side is the last resort, not the usual', () => {
  let all = 0
  for (let n = 0; n < 200; n++) {
    const { units: [unit] } = planDecks({ id: `usual-${n}`, cells: [HOME], load: 1 + (n % 3), doors: [{ from: HOME, toward: toward(HOME, n % 6) }] }, n % 3 ? nowhere : anywhere)
    if (unit.deck === 'deck-m4') all++
  }
  assert.ok(all < 60, `${all} of 200`)
})
