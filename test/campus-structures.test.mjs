import test from 'node:test'
import assert from 'node:assert/strict'
import { LIBRARY_CELL, CORE_CELLS, fits, componentsOf, isConnected, planMove } from '../src/world/plot-move.js'

const zones = entries => new Map(Object.entries(entries))

test('the Library reserves its cell against direct and planned workspace moves', () => {
  const layout = zones({ work: [{ q: 0, r: 0 }] })
  assert.equal(fits(layout, 'work', LIBRARY_CELL.q, LIBRARY_CELL.r), false)
  assert.equal(planMove(layout, 'work', LIBRARY_CELL.q, LIBRARY_CELL.r), null)
  assert.equal(CORE_CELLS.length, 2)
})

test('core campus ground connects workspaces without becoming a workspace', () => {
  const layout = zones({ west: [{ q: -3, r: 1 }], east: [{ q: -1, r: 2 }] })
  assert.equal(isConnected(layout), true)
  assert.deepEqual([...componentsOf(layout)[0]].sort(), ['east', 'west'])
})

test('allocation protects both core structures and relocates a legacy occupant', async () => {
  const { allocateCells } = await import('../src/world/plots.js')
  const previous = zones({ legacy: [LIBRARY_CELL], stable: [{ q: 0, r: 0 }] })
  const projects = [{ id: 'legacy', size: 7 }, { id: 'stable', size: 7 }, { id: 'new', size: 20 }]
  const allocated = allocateCells(projects, previous)
  for (const cells of allocated.values()) {
    for (const cell of cells) assert.ok(!CORE_CELLS.some(core => core.q === cell.q && core.r === cell.r))
  }
  assert.deepEqual(allocated.get('stable')[0], { q: 0, r: 0 })
  assert.deepEqual(previous.get('legacy'), [LIBRARY_CELL], 'saved input is not mutated')
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
