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

// ── stacks, and the light everything throws ───────────────────────────────────────────

import { settlementPools } from '../src/world/settlement-plan.js'

const stackOf = (busy, id = 'stacked') =>
  settlementParts([{ id, cells: [{ q: 0, r: 0 }], level: 2, busy, stackAt: { x: 3, z: 2 } }], [], WORLD)

test('every workspace with somebody at it has a stack of one to three storeys, and a busy one is never low', () => {
  const storeys = (busy, id) => named(stackOf(busy, id), /^mod-/).length
  const quiet = Array.from({ length: 60 }, (_, n) => storeys(1, `quiet-${n}`))
  assert.ok(quiet.every((n) => n >= 1 && n <= 3))
  // A campus of single sessions still has height: all three heights turn up, and most are over one.
  assert.deepEqual([...new Set(quiet)].sort(), [1, 2, 3])
  assert.ok(quiet.filter((n) => n > 1).length > quiet.length / 2, quiet.join(''))
  for (let n = 0; n < 40; n++) {
    assert.ok(storeys(3, `busy-${n}`) >= 2)
    assert.equal(storeys(5, `full-${n}`), 3)
    assert.equal(storeys(20, `full-${n}`), 3)
  }
  assert.equal(named(stackOf(0), /^mod-/).length, 0, 'nobody there, nothing stacked')
  assert.equal(named(settlementParts([{ id: 'full', cells: [{ q: 0, r: 0 }], level: 1, busy: 5, stackAt: null }], [], WORLD), /^mod-/).length, 0)
})

test('each storey stands on a frame over the one below, a frame\'s height up, and none is straight above the last', () => {
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const parts = stackOf(6, id)
    const modules = named(parts, /^mod-/)
    const frames = named(parts, 'frame')
    const deck = 0.45 + 2 * 1.35
    assert.deepEqual(modules.map((m) => +(m.y - deck).toFixed(2)), [0, 2.3, 4.6])
    assert.deepEqual(frames.map((f) => +(f.y - deck).toFixed(2)), [0, 2.3])
    for (let k = 1; k < modules.length; k++) {
      const shift = Math.hypot(modules[k].x - modules[k - 1].x, modules[k].z - modules[k - 1].z)
      const turned = Math.abs(modules[k].turn - modules[k - 1].turn) > 0.2
      assert.ok(shift > 0.15 || turned, `${id}: storey ${k} sits straight on the one below`)
      // Each frame stands where the stack does, and what is on it is within a pace of its middle.
      assert.ok(Math.hypot(modules[k].x - 3, modules[k].z - 2) < 0.7, 'and still stands on its frame')
    }
    assert.equal(named(parts, 'ladder').length, 1)
  }
})

test('light falls on the deck beside a lit edge and round every module, and a sign throws its own colour', () => {
  const parts = [
    ...stackOf(6),
    { part: 'sign-a', plot: 'stacked', x: 1, y: 3.15, z: 1, turn: 0 },
    { part: 'sign-c', plot: 'stacked', x: -1, y: 3.15, z: 1, turn: 0 },
  ]
  const pools = settlementPools(parts)
  const lit = named(parts, /lit$/).length
  assert.equal(pools.filter((pool) => pool.kind === 'band').length, lit)
  // Only what stands on a deck lights it: the storeys above light nothing below.
  assert.equal(pools.filter((pool) => pool.kind === 'round' && pool.color === 'amber').length, 1)
  // The first two signs are cyan and the last two magenta, and each throws its own.
  const thrown = named(parts, /^sign-[a-d]$/).map((sign) => (/[ab]$/.test(sign.part) ? 'cyan' : 'magenta')).sort()
  assert.ok(thrown.includes('cyan') && thrown.includes('magenta'))
  assert.deepEqual(pools.filter((pool) => pool.color !== 'amber').map((pool) => pool.color).sort(), thrown)
  for (const pool of pools) assert.ok(pool.y > 3.15 && pool.y < 3.25, 'just proud of the deck')
})

/** A campus of `count` single-platform workspaces in a row, each with a stack. */
const campus = (count) => Array.from({ length: count }, (_, n) => ({ id: `ws-${n}`, cells: [{ q: n * 2, r: 0 }], level: 1 + (n % 3), busy: 1 + (n % 6), stackAt: { x: hexToWorld(n * 2, 0).x + 3, z: 2 } }))

test('a campus has a handful of neon signs: about one workspace in nine, never none, and not all the same', () => {
  const signsIn = (count) => named(settlementParts(campus(count), [], WORLD), /^sign-[a-d]$/)
  assert.deepEqual([1, 5, 9, 20, 45, 90].map((count) => signsIn(count).length), [1, 1, 1, 2, 5, 10])
  assert.equal(new Set(signsIn(45).map((sign) => sign.part)).size, 4, 'all four kinds on a campus of 45')
  assert.equal(signsIn(0).length, 0)
})

test('a sign or a dish stands on the flat roof of the top storey, and nowhere else', () => {
  const roofs = { 'mod-cabin': 1.89, 'mod-drum': 1.93 }
  let signs = 0
  for (let n = 0; n < 300; n++) {
    // One workspace on its own always has the campus's one sign.
    const parts = stackOf(1 + (n % 6), `sign-${n}`)
    const top = named(parts, /^mod-/).at(-1)
    const things = named(parts, /^(sign-[a-d]|dish)$/)
    assert.equal(named(parts, /^sign-[a-d]$/).length, 1)
    for (const thing of things) {
      if (/^sign/.test(thing.part)) signs++
      assert.ok(roofs[top.part], `${thing.part} on a ${top.part}, which has no flat roof`)
      assert.ok(Math.abs(thing.y - (top.y + roofs[top.part])) < 1e-6, `${thing.part} is not on the roof`)
      assert.ok(Math.abs(thing.x - top.x) < 1e-6 && Math.abs(thing.z - top.z) < 1e-6)
    }
  }
  assert.equal(signs, 300)
})
