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

const AT = { x: 3, z: 2, turn: 0.7 }
const stackOf = (busy, id = 'stacked', stacks = [AT]) =>
  settlementParts([{ id, cells: [{ q: 0, r: 0 }], level: 2, busy, stacks }], [], WORLD)
const DECK = 0.45 + 2 * 1.35

test('a workspace has a stack where it has room for one, taller the more that is going on, and none with nobody there', () => {
  const heights = (busy) => Array.from({ length: 80 }, (_, n) => named(stackOf(busy, `ws-${busy}-${n}`), /^mod-/).length)
  const mean = (list) => list.reduce((sum, n) => sum + n, 0) / list.length
  const [quiet, some, busy] = [heights(1), heights(2), heights(6)]
  for (const list of [quiet, some, busy]) assert.ok(list.every((n) => n >= 1 && n <= 3))
  assert.ok(mean(quiet) < mean(some) && mean(some) < mean(busy), `${mean(quiet)}, ${mean(some)}, ${mean(busy)}`)
  assert.ok(Math.max(...quiet) <= 2, 'a single session never raises three storeys')
  assert.ok(Math.min(...busy) >= 2, 'and a busy workspace is never one')
  assert.equal(named(stackOf(0), /^mod-/).length, 0)
  assert.equal(named(stackOf(5, 'no-room', []), /^mod-/).length, 0)
})

test('a workspace of several platforms has a stack on each that has room', () => {
  const stacks = [AT, { x: 16, z: 2, turn: 2.1 }, { x: 9, z: 12, turn: 4.0 }]
  const parts = stackOf(9, 'wide', stacks)
  const ground = named(parts, /^mod-/).filter((m) => Math.abs(m.y - DECK) < 1e-6)
  assert.equal(ground.length, 3, 'one module on the deck for each')
})

test('what stands under a frame is squared up with it, so nothing comes through the braces', () => {
  for (let n = 0; n < 120; n++) {
    const parts = stackOf(6, `square-${n}`)
    const modules = named(parts, /^mod-/)
    const frames = named(parts, 'frame')
    assert.equal(frames.length, modules.length - 1, 'a frame over every storey but the top')
    frames.forEach((frame, k) => {
      const under = modules[k]
      assert.ok(Math.abs(frame.y - under.y) < 1e-6 && Math.abs(frame.turn - AT.turn) < 1e-9)
      // One way round or the other, and within a hand's width of the middle.
      const off = ((under.turn - frame.turn) % Math.PI + Math.PI) % Math.PI
      assert.ok(Math.min(off, Math.PI - off) < 1e-6, `storey ${k} is turned ${off} inside its frame`)
      assert.ok(Math.hypot(under.x - frame.x, under.z - frame.z) <= 0.081)
    })
    // Each a frame's height above the last.
    assert.deepEqual(modules.map((m) => +(m.y - DECK).toFixed(2)), modules.map((m, k) => +(k * 2.3).toFixed(2)))
  }
})

test('the top storey is turned off square and shifted, and no two storeys running are the same kind', () => {
  let turned = 0
  for (let n = 0; n < 120; n++) {
    const modules = named(stackOf(6, `top-${n}`), /^mod-/)
    const top = modules.at(-1)
    const off = ((top.turn - AT.turn) % Math.PI + Math.PI) % Math.PI
    if (Math.min(off, Math.PI - off) > 0.2) turned++
    assert.ok(Math.hypot(top.x - AT.x, top.z - AT.z) < 0.5, 'and still on its floor')
    for (let k = 1; k < modules.length; k++) {
      // A sign's cabin is the one exception that may repeat what is under it.
      if (k === modules.length - 1 && named(stackOf(6, `top-${n}`), /^sign-/).length) continue
      assert.notEqual(modules[k].part, modules[k - 1].part, `top-${n}: two ${modules[k].part} running`)
    }
  }
  assert.equal(turned, 120)
})

/** A campus of `count` single-platform workspaces in a row, each with room for a stack. */
const campus = (count) => Array.from({ length: count }, (_, n) => {
  const at = hexToWorld(n * 2, 0)
  return { id: `ws-${n}`, cells: [{ q: n * 2, r: 0 }], level: 1 + (n % 3), busy: 1 + (n % 6), stacks: [{ x: at.x + 3, z: at.z + 1, turn: n }] }
})

test('a campus has a handful of neon signs: about one workspace in nine, never none, and not all the same', () => {
  const signsIn = (count) => named(settlementParts(campus(count), [], WORLD), /^sign-[a-d]$/)
  assert.deepEqual([1, 5, 9, 20, 45, 90].map((count) => signsIn(count).length), [1, 1, 1, 2, 5, 10])
  assert.equal(new Set(signsIn(45).map((sign) => sign.part)).size, 4, 'all four kinds on a campus of 45')
  assert.equal(signsIn(0).length, 0)
})

test('a sign or a dish stands on a cabin\'s roof, at the height of the roof itself, to one side', () => {
  let seen = 0
  for (let n = 0; n < 200; n++) {
    const parts = stackOf(1 + (n % 6), `sign-${n}`)
    const top = named(parts, /^mod-/).at(-1)
    for (const thing of named(parts, /^(sign-[a-d]|dish)$/)) {
      seen++
      assert.equal(top.part, 'mod-cabin', `${thing.part} on a ${top.part}`)
      // The roof is 1.60 above the cabin's base; 1.89 is the top of what stands on it.
      assert.ok(Math.abs(thing.y - (top.y + 1.6)) < 1e-6, `${thing.part} is ${(thing.y - top.y).toFixed(2)} up`)
      const out = Math.hypot(thing.x - top.x, thing.z - top.z)
      assert.ok(out > 0.5 && out < 1.3, 'on the roof, and not in the middle of it')
    }
  }
  assert.ok(seen >= 200, 'every one of these has the campus\'s one sign')
})

test('a stack\'s frame stays on its platform: no corner of it reaches past the deck', () => {
  // As the campus places one: 3.5 out from the middle toward a corner, its length pointing outward.
  const FRAME_HALF = { along: 3.56 / 2, across: 2.36 / 2 }
  const apothem = 5.146
  for (let k = 0; k < 6; k++) {
    const way = k * (Math.PI / 3)
    const out = { x: Math.cos(way), z: Math.sin(way) }
    const turn = Math.atan2(out.x, out.z) + Math.PI / 2
    const parts = stackOf(6, `rim-${k}`, [{ x: out.x * 3.5, z: out.z * 3.5, turn }])
    const frames = named(parts, 'frame')
    assert.ok(frames.length > 0)
    for (const frame of frames) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          // The frame's own x runs along its length: at `turn`, that is (cos, -sin) on the ground.
          const cx = frame.x + sx * FRAME_HALF.along * Math.cos(turn) + sz * FRAME_HALF.across * Math.sin(turn)
          const cz = frame.z - sx * FRAME_HALF.along * Math.sin(turn) + sz * FRAME_HALF.across * Math.cos(turn)
          for (let e = 0; e < 6; e++) {
            const normal = Math.PI / 6 + e * (Math.PI / 3)
            const reach = cx * Math.cos(normal) + cz * Math.sin(normal)
            assert.ok(reach <= apothem + 0.03, `a corner is ${reach.toFixed(2)} out, past the rim at ${apothem}`)
          }
        }
      }
    }
  }
})

test('light falls on the deck beside a lit edge and round a module standing on it, and a sign throws its own colour', () => {
  const parts = stackOf(6)
  const pools = settlementPools(parts)
  assert.equal(pools.filter((pool) => pool.kind === 'band').length, named(parts, /lit$/).length)
  // Only what stands on a deck lights it: the storeys above light nothing below.
  assert.equal(pools.filter((pool) => pool.kind === 'round' && pool.color === 'amber').length, 1)
  const thrown = named(parts, /^sign-[a-d]$/).map((sign) => (/[ab]$/.test(sign.part) ? 'cyan' : 'magenta'))
  assert.equal(thrown.length, 1)
  assert.deepEqual(pools.filter((pool) => pool.color !== 'amber').map((pool) => pool.color), thrown)
  for (const pool of pools) assert.ok(pool.y > DECK && pool.y < DECK + 0.1, 'just proud of the deck')
})

import { settlementNumbers } from '../src/world/settlement-plan.js'

test('every deck carries a two-digit number of its own, painted where its kind of deck has a plate for one', () => {
  const plots = campus(30)
  const parts = settlementParts(plots, [], WORLD)
  const digits = settlementNumbers(parts)
  const decks = named(parts, /^deck-[a-d]$/)
  assert.equal(digits.length, decks.length * 2, 'two digits a deck')
  for (const digit of digits) assert.ok(Number.isInteger(digit.digit) && digit.digit >= 0 && digit.digit <= 9)
  // Far more than the four numbers there used to be.
  const numbers = new Set()
  for (let n = 0; n < digits.length; n += 2) numbers.add(`${digits[n].digit}${digits[n + 1].digit}`)
  assert.ok(numbers.size >= 20, `${numbers.size} different numbers on 30 decks`)
  // And the same number on the same deck every time.
  assert.deepEqual(settlementNumbers(settlementParts(plots, [], WORLD)), digits)
})

test('a number lies on its deck, its two digits side by side along the way it reads', () => {
  const deck = { part: 'deck-a', plot: 'one', x: 10, y: 1.8, z: -4, turn: 0 }
  const [tens, units] = settlementNumbers([deck])
  // deck-a's plate is at (2.542, -1.468) and reads at 30 degrees: along (cos 30, -sin 30).
  const mid = { x: (tens.x + units.x) / 2, z: (tens.z + units.z) / 2 }
  assert.ok(Math.abs(mid.x - (10 + 2.542)) < 1e-6 && Math.abs(mid.z - (-4 - 1.468)) < 1e-6)
  assert.ok(Math.abs(Math.hypot(units.x - tens.x, units.z - tens.z) - 0.678) < 1e-6)
  assert.ok(Math.abs((units.x - tens.x) / 0.678 - Math.cos(Math.PI / 6)) < 1e-6)
  assert.ok(Math.abs((units.z - tens.z) / 0.678 + Math.sin(Math.PI / 6)) < 1e-6)
  assert.ok(tens.y > 1.8 && tens.y < 1.85)
  // Turned with its deck, a sixth of a turn at a time.
  const [turned] = settlementNumbers([{ ...deck, turn: Math.PI / 3 }])
  assert.ok(Math.abs(turned.turn - (Math.PI / 6 + Math.PI / 3)) < 1e-9)
})
