import test from 'node:test'
import assert from 'node:assert/strict'
import { LIBRARY_CELL, CORE_CELLS, fits, componentsOf, isConnected, planMove } from '../src/world/plot-move.js'

const zones = entries => new Map(Object.entries(entries))

test('the gate and the Library stand outside every district: no workspace is given their ground or can be carried onto it', async () => {
  const { toFrame } = await import('../src/world/districts.js')
  const { inDistrict } = await import('../src/world/plot-move.js')
  assert.equal(CORE_CELLS.length, 2)
  for (const district of ['local', 'crew']) {
    for (const cell of toFrame(district, [...CORE_CELLS])) {
      assert.equal(inDistrict(cell), false)
      const layout = zones({ work: [{ q: 0, r: 0 }] })
      assert.equal(fits(layout, 'work', cell.q, cell.r), false)
      assert.equal(planMove(layout, 'work', cell.q, cell.r), null)
    }
  }
})

test('a workspace remembered on ground that is no longer a district\'s is moved, and the rest stay put', async () => {
  const { allocateCells } = await import('../src/world/plots.js')
  const { inDistrict } = await import('../src/world/plot-move.js')
  const previous = zones({ legacy: [{ q: -5, r: 0 }], stable: [{ q: 0, r: 0 }] })
  const projects = [{ id: 'legacy', size: 7 }, { id: 'stable', size: 7 }, { id: 'new', size: 20 }]
  const allocated = allocateCells(projects, previous)
  for (const cells of allocated.values()) for (const cell of cells) assert.ok(inDistrict(cell))
  assert.deepEqual(allocated.get('stable')[0], { q: 0, r: 0 })
  assert.deepEqual(previous.get('legacy'), [{ q: -5, r: 0 }], 'saved input is not mutated')
  assert.equal(isConnected(allocated), true)
  assert.deepEqual(allocateCells(projects, allocated), allocated, 'later polls keep the migrated layout')
})

test('the Library can be selected by its geometry and releases its resources', async () => {
  const THREE = await import('three')
  const { Library } = await import('../src/world/library.js')
  const scene = new THREE.Scene()
  const library = new Library(scene, new THREE.Vector3())
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 8, 16)
  camera.lookAt(0, 1.5, 0)
  camera.updateMatrixWorld()
  assert.equal(library.containsPointer(0, 0, camera), true)
  assert.equal(library.containsPointer(0.95, 0.95, camera), false)
  camera.lookAt(0, 8, 32)
  camera.updateMatrixWorld()
  assert.equal(library.containsPointer(0, 0, camera), false, 'a building behind the camera is not selectable')
  let disposed = 0
  library.meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => disposed++))
  library.dispose()
  assert.equal(scene.children.length, 0)
  assert.equal(disposed, library.meshes.length)
})

test('a place that says how many platforms it needs gets exactly that many, and gives one back at once', async () => {
  const { allocateCells } = await import('../src/world/plots.js')
  // By its sessions a project of this size would get one; it asks for three.
  const grown = allocateCells([{ id: 'crew', size: 0, cells: 3 }, { id: 'local', size: 3 }])
  assert.equal(grown.get('crew').length, 3)
  assert.equal(grown.get('local').length, 1)
  // A project gives ground back late, so it does not flicker; a place is told its size outright.
  const shrunk = allocateCells([{ id: 'crew', size: 0, cells: 2 }, { id: 'local', size: 3 }], grown)
  assert.deepEqual(shrunk.get('crew'), grown.get('crew').slice(0, 2), 'the root stays, the last platform claimed goes')
  assert.deepEqual(shrunk.get('local'), grown.get('local'))
})

test('the Library leaves a way round it on a platform that stands apart from its neighbours', async () => {
  const { walkRadius } = await import('../src/world/library.js')
  const { PLOT_APOTHEM } = await import('../src/world/plots.js')
  // The campus: a platform pulled in by this much on every outside edge, and a hall this wide.
  const gap = 1.38
  const blocked = walkRadius(4.6, PLOT_APOTHEM, gap)
  // What is left between the hall and the platform's rim is the only way from the gate to
  // every workspace, and has to be wide enough for the route finder's grid to see it.
  assert.ok(PLOT_APOTHEM - gap - blocked >= 1.2, `a lane of ${PLOT_APOTHEM - gap - blocked}`)
  assert.ok(blocked > 3, 'and the hall is still something to walk round')
  // On a world whose platforms touch there is ground all round, and nothing to give up.
  assert.equal(walkRadius(4.6, PLOT_APOTHEM, 0), 4.6)
})

test('the ground has no fixed size: it is as big as the campus needs, and never smaller than it was', async () => {
  const { groundFor } = await import('../src/world/planet.js')
  assert.equal(groundFor(0), 340)
  assert.equal(groundFor(90), 340)
  // A campus reaching 165 out, as one with two districts does, and one of hundreds of workspaces.
  assert.ok(groundFor(165) >= (165 + 70) * 2)
  assert.ok(groundFor(900) >= 1940)
  assert.equal(groundFor(165) % 170, 0, 'in steps, so it is not laid again for every newcomer')
})

test('the canals are a grid without end, and the campus is not inside them', async () => {
  const { onCanal, PLANETS } = await import('../src/world/planet.js')
  const campus = Object.values(PLANETS).find((planet) => planet.shape === 'foundry')
  // The first is 96 out on every side; then one every 192, on both axes, as far as you like.
  for (const at of [96, 288, 480, 1056]) {
    assert.equal(onCanal(at, 37, campus), true, `a canal at x = ${at}`)
    assert.equal(onCanal(-41, -at, campus), true)
  }
  for (const at of [0, 40, 150, 200, 380, 960]) assert.equal(onCanal(at, 12, campus), false, `floor at x = ${at}`)
})
