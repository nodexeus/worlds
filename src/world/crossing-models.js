import * as THREE from 'three'
import { model } from './kit.js'
import { DECK_TOP, hexToWorld } from './plots.js'

/**
 * The walkways and staircases themselves, built from whole MegaKit models.
 *
 * Nothing here is stretched: every kit part is scaled evenly, and the world's own numbers are
 * chosen to suit the parts. One flight of the kit's two-metre stair, scaled until it climbs
 * exactly one level, runs a little under three units; the gap between workspaces is set to
 * that run (see `plot.gap` on the campus world), and the walkway plate is scaled to span it.
 *
 * What is joined to what is decided in `crossings.js`. This only draws that list.
 */

/** The kit's own measurements, in its metres, for the parts used. */
const KIT = {
  plate: 4.0, // Platform_Metal is a 4 m square
  stairRise: 1.01, // Platform_Stairs_2 climbs this far...
  stairRun: 2.07, // ...over this run...
  stairWidth: 2.0, // ...and is this wide
}

/** How far a rail stands in from the edge of what it guards, in world units. */
const RAIL_INSET = 0.09

/**
 * How far apart two workspaces must stand for one flight to span the gap between them
 * exactly, on a world whose levels are `levelStep` apart. Half of it is the `gap` a plot pulls
 * its outside edges in by.
 */
export const gapForStairs = (levelStep) => (KIT.stairRun * levelStep) / KIT.stairRise

export class Crossings {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'crossings'
    scene.add(this.group)
    // The one thing here that is not a kit part: a plain beam under each walkway, because
    // the kit's floor plate has no thickness and would vanish seen from the side.
    this.beam = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.5, metalness: 0.7 })
    this.beams = []
  }

  /**
   * Draw `plan`, replacing whatever was drawn before. The kit must already be loaded.
   *
   * @param {import('./crossings.js').Crossing[]} plan
   * @param {object} world
   * @param {number} world.gap  how far each workspace pulls its outside edges in
   * @param {number} world.levelStep  how far apart levels are
   * @param {(id: string) => number} world.elevation  how high a workspace's deck stands
   */
  build(plan, { gap, levelStep, elevation, causeways = [] }) {
    this.clear()
    const span = gap * 2
    // The long walkways out from the square: the same plate and rails, end to end, and the
    // same flight at the far end where the district stands a level up.
    for (const way of causeways) {
      for (const plate of way.plates) {
        const piece = new THREE.Group()
        piece.position.set(plate.x, way.y, plate.z)
        piece.rotation.y = way.heading
        this._walkway(piece, plate.size)
        this.group.add(piece)
      }
      if (way.stair) {
        const piece = new THREE.Group()
        piece.position.set(way.stair.x, way.y, way.stair.z)
        piece.rotation.y = way.heading
        this._stair(piece, levelStep)
        this.group.add(piece)
      }
    }
    for (const crossing of plan) {
      const a = hexToWorld(crossing.from.q, crossing.from.r)
      const b = hexToWorld(crossing.to.q, crossing.to.r)
      const piece = new THREE.Group()
      piece.position.set((a.x + b.x) / 2, DECK_TOP + elevation(crossing.low), (a.z + b.z) / 2)
      // The piece's own +z runs from the lower workspace to the higher one.
      piece.rotation.y = Math.atan2(b.x - a.x, b.z - a.z)
      if (crossing.rise === 0) this._walkway(piece, span)
      else this._stair(piece, levelStep)
      this.group.add(piece)
    }
  }

  /** A square of the kit's floor plate across the gap, railed on both sides. */
  _walkway(piece, span) {
    const k = span / KIT.plate
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, span), this.beam)
    beam.position.y = -0.152
    beam.castShadow = true
    beam.receiveShadow = true
    this.beams.push(beam)
    const plate = model('Platform_Metal')
    plate.scale.setScalar(k)
    piece.add(beam, plate)
    for (const side of [-1, 1]) {
      const rail = model('Prop_Rail_4')
      rail.scale.setScalar(k)
      rail.position.x = side * (span / 2 - RAIL_INSET)
      piece.add(rail)
    }
  }

  /** One flight of the kit's stair, scaled until it climbs exactly one level, with its rails. */
  _stair(piece, levelStep) {
    const s = levelStep / KIT.stairRise
    const flight = new THREE.Group()
    // The kit's stair climbs toward its own -z; turned round, it climbs toward the higher deck.
    flight.rotation.y = Math.PI
    flight.scale.setScalar(s)
    flight.add(model('Platform_Stairs_2'))
    for (const [name, side] of [['Prop_Rail_Incline_Short_L', -1], ['Prop_Rail_Incline_Short_R', 1]]) {
      const rail = model(name)
      rail.position.x = side * (KIT.stairWidth / 2 - RAIL_INSET / s)
      flight.add(rail)
    }
    piece.add(flight)
  }

  /** Take everything down. Kit parts share their geometry and materials, so only beams go. */
  clear() {
    for (const beam of this.beams) beam.geometry.dispose()
    this.beams = []
    this.group.clear()
  }

  dispose() {
    this.clear()
    this.beam.dispose()
    this.group.removeFromParent()
  }
}
