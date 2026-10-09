// test/settlement-plan.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { settlementParts } from '../src/world/settlement-plan.js'
import { hexToWorld } from '../src/world/plots.js'

const WORLD = { deckTop: 0.45, levelStep: 1.35, apothem: 5.146 }
const named = (parts, name) => parts.filter((part) => part.part === name || (name instanceof RegExp && name.test(part.part)))
const near = (a, b) => Math.abs(a - b) < 1e-6

test('every platform of a workspace gets a deck at its level and the legs for that height', () => {
  const parts = settlementParts([{ id: 'one', cells: [{ q: 2, r: 1 }], level: 3 }], [], WORLD)
  const [deck] = named(parts, /^deck-[a-d]$/)
  const at = hexToWorld(2, 1)
  assert.ok(near(deck.x, at.x) && near(deck.z, at.z))
  assert.ok(near(deck.y, 0.45 + 3 * 1.35), 'the deck top is the walking height')
  assert.deepEqual(named(parts, /^legs-/).map((part) => part.part), ['legs-3'])
  assert.ok(near(named(parts, 'legs-3')[0].y, deck.y))
  // A hexagon fits its place at any sixth of a turn, and at nothing else.
  assert.ok(near((deck.turn / (Math.PI / 3)) % 1, 0))
})

test('a platform on its own has something on all six edges, and one or two of them are lit', () => {
  for (const id of ['one', 'two', 'three', 'four', 'five', 'six', 'seven']) {
    const parts = settlementParts([{ id, cells: [{ q: 0, r: 0 }], level: 1 }], [], WORLD)
    const edges = named(parts, /^edge-/)
    assert.equal(edges.length, 6)
    const lit = edges.filter((edge) => edge.part.endsWith('lit')).length
    assert.ok(lit >= 1 && lit <= 2, `${id}: ${lit} lit edges`)
    for (const edge of edges) assert.ok(near(Math.hypot(edge.x, edge.z), 5.146), 'at the middle of an edge')
  }
})

test('two platforms of one workspace are joined into one floor, with no edge between them', () => {
  const parts = settlementParts([{ id: 'wide', cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], level: 2 }], [], WORLD)
  const joins = named(parts, 'deck-join')
  assert.equal(joins.length, 1)
  const a = hexToWorld(0, 0)
  const b = hexToWorld(1, 0)
  assert.ok(near(joins[0].x, (a.x + b.x) / 2) && near(joins[0].z, (a.z + b.z) / 2))
  assert.equal(named(parts, /^edge-/).length, 10, 'five open edges each')
  assert.equal(named(parts, /^deck-[a-d]$/).length, 2)
})

test('three platforms of one workspace that all touch get the piece that closes the hole between them', () => {
  const cells = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]
  const parts = settlementParts([{ id: 'tri', cells, level: 1 }], [], WORLD)
  assert.equal(named(parts, 'deck-join').length, 3)
  const [fill] = named(parts, 'deck-fill')
  const middle = cells.map((c) => hexToWorld(c.q, c.r)).reduce((sum, p) => ({ x: sum.x + p.x / 3, z: sum.z + p.z / 3 }), { x: 0, z: 0 })
  assert.ok(near(fill.x, middle.x) && near(fill.z, middle.z))
})

test('a crossing is a gangway on the level and one flight up a level, and the edges it meets are left open', () => {
  const plots = [
    { id: 'low', cells: [{ q: 0, r: 0 }], level: 1 },
    { id: 'high', cells: [{ q: 1, r: 0 }], level: 2 },
    { id: 'level', cells: [{ q: 0, r: 1 }], level: 1 },
  ]
  const crossings = [
    { low: 'low', high: 'high', from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, rise: 1 },
    { low: 'level', high: 'low', from: { q: 0, r: 1 }, to: { q: 0, r: 0 }, rise: 0 },
  ]
  const parts = settlementParts(plots, crossings, WORLD)
  const [stair] = named(parts, 'stair-1')
  const [gangway] = named(parts, 'gangway')
  assert.ok(near(stair.y, 0.45 + 1.35), 'a flight starts from the lower deck')
  const from = hexToWorld(0, 0)
  const to = hexToWorld(1, 0)
  assert.ok(near(stair.x, (from.x + to.x) / 2) && near(stair.z, (from.z + to.z) / 2))
  // Its own +z runs from the lower platform to the higher.
  assert.ok(near(Math.sin(stair.turn), (to.x - from.x) / 13.164) || Math.abs(Math.sin(stair.turn) - (to.x - from.x) / Math.hypot(to.x - from.x, to.z - from.z)) < 1e-6)
  assert.ok(gangway)
  // 'low' has two crossings, so four edges; the other two have one each, so five.
  const edgesOf = (id) => named(parts, /^edge-/).filter((edge) => edge.plot === id).length
  assert.deepEqual([edgesOf('low'), edgesOf('high'), edgesOf('level')], [4, 5, 5])
})

test('what is drawn for a workspace never changes unless the workspace does', () => {
  const plots = [{ id: 'same', cells: [{ q: 3, r: -1 }, { q: 3, r: 0 }], level: 4 }]
  assert.deepEqual(settlementParts(plots, [], WORLD), settlementParts(plots, [], WORLD))
  // And another workspace arriving beside it changes nothing of it.
  const before = settlementParts(plots, [], WORLD).filter((part) => part.plot === 'same')
  const after = settlementParts([...plots, { id: 'new', cells: [{ q: 5, r: 2 }], level: 1 }], [], WORLD).filter((part) => part.plot === 'same')
  assert.deepEqual(after, before)
})

test('a workspace with traffic over it stands on a used deck', () => {
  const plots = [{ id: 'busy', cells: [{ q: 0, r: 0 }], level: 1 }, { id: 'other', cells: [{ q: 1, r: 0 }], level: 1 }]
  const crossings = [{ low: 'busy', high: 'other', from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, rise: 0 }]
  const decks = named(settlementParts(plots, crossings, WORLD), /^deck-[a-d]$/)
  assert.ok(decks.every((deck) => deck.part === 'deck-a' || deck.part === 'deck-c'), decks.map((deck) => deck.part).join(' '))
})
