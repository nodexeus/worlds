import { GENERATORS } from './synth.js'

/**
 * Every sound the colony can make, by name.
 *
 * A name is the whole contract between the world and the audio: planets ask for beds by
 * name, the integrator tags sources by name, `play` takes a name. Behind each one sits a
 * synth from `synth.js`, and optionally a real file from the manifest that overrides it. So
 * a sample can be dropped in or pulled out without touching any code that asks for sounds,
 * and the registry refuses to load at all if a name has no synth — there is no such thing
 * here as a sound that might be silent.
 *
 * `kind` decides how the engine treats it:
 *   bed    — loops forever as a planet's ambience layer
 *   event  — plays once and cleans itself up
 *   loop   — loops while a positional source exists (a site, the ship, a drone, a shore)
 * `gain` is a final trim on top of the synth's own level, so the mix can be balanced in
 * one place without touching the recipes.
 */

const TABLE = {
  // Beds — a planet stacks two or three of these.
  'wind-soft': { kind: 'bed', gain: 1 },
  'wind-desert': { kind: 'bed', gain: 1 },
  'wind-arctic': { kind: 'bed', gain: 1 },
  'wind-high': { kind: 'bed', gain: 1 },
  'surf': { kind: 'bed', gain: 1 },
  'surf-gentle': { kind: 'bed', gain: 1 },
  'ocean-swell': { kind: 'bed', gain: 1 },
  'jungle-insects': { kind: 'bed', gain: 1 },
  'jungle-birds': { kind: 'bed', gain: 1 },
  'rainforest-rain': { kind: 'bed', gain: 1 },
  'crickets': { kind: 'bed', gain: 1 },
  'meadow-birds': { kind: 'bed', gain: 1 },
  'lava-rumble': { kind: 'bed', gain: 1 },
  'volcanic-hiss': { kind: 'bed', gain: 1 },
  'snow-wind': { kind: 'bed', gain: 1 },
  'autumn-rustle': { kind: 'bed', gain: 1 },
  'cherry-breeze': { kind: 'bed', gain: 1 },
  /** Airless worlds: the inside of a helmet rather than wind. Nearly inaudible on purpose. */
  'lunar-silence': { kind: 'bed', gain: 1 },
  /** Thin, high and dusty — a tenth of an atmosphere does not carry a low rumble. */
  'mars-wind': { kind: 'bed', gain: 1 },
  'stream': { kind: 'bed', gain: 1 },
  /** The campus: a warm chord of pure tones that drifts. */
  'foundry-pad': { kind: 'bed', gain: 1 },

  // One-shots — environment events, and the handful of sounds the colony itself makes.
  'gull': { kind: 'event', gain: 0.8 },
  'parrot': { kind: 'event', gain: 0.8 },
  'crow': { kind: 'event', gain: 0.8 },
  'songbird': { kind: 'event', gain: 0.8 },
  'owl': { kind: 'event', gain: 0.8 },
  'thunder-distant': { kind: 'event', gain: 0.9 },
  'wind-gust': { kind: 'event', gain: 0.7 },
  'wave-crash': { kind: 'event', gain: 0.8 },
  'fish-splash': { kind: 'event', gain: 0.6 },
  'geyser': { kind: 'event', gain: 0.8 },
  'ember-pop': { kind: 'event', gain: 0.6 },
  'ice-crack': { kind: 'event', gain: 0.7 },
  /** A distant howl. */
  'coyote': { kind: 'event', gain: 0.6 },
  /** Whatever bird the planet has: pass `kind` (gull | parrot | crow | songbird | owl). */
  'bird-call': { kind: 'event', gain: 0.8 },
  /** A soft servo click and a thud — something small just landed. */
  'drone-drop': { kind: 'event', gain: 0.7 },
  /**
   * "Yes?" — what an astronaut says when you click it. Six of them, picked at random, so a
   * crowd does not answer in one voice. Little robot phrases: two or three chirps.
   */
  'select-1': { kind: 'event', gain: 0.55 },
  'select-2': { kind: 'event', gain: 0.55 },
  'select-3': { kind: 'event', gain: 0.55 },
  'select-4': { kind: 'event', gain: 0.55 },
  'select-5': { kind: 'event', gain: 0.55 },
  'select-6': { kind: 'event', gain: 0.55 },
  /**
   * "Somebody needs you." The only sound that is allowed to interrupt, so it is the one
   * that must never grate: two soft marimba notes a fifth apart, and nothing else.
   */
  'chime-attention': { kind: 'event', gain: 0.6 },
  /** A soft bell, a long way off across the campus. */
  'far-bell': { kind: 'event', gain: 0.5 },
  /**
   * What a robot says when you click it, in the voice of its kind: six phrases each. The rock
   * crew speak in low chords that slide and waver, and the sixth of theirs is a laugh; the
   * plated crew in runs of struck tones. See `CREW_VOICES`. Trimmed against each other by
   * measurement: a chord carries far more than a struck tone does at the same peak.
   */
  'rock-1': { kind: 'event', gain: 0.34 },
  'rock-2': { kind: 'event', gain: 0.34 },
  'rock-3': { kind: 'event', gain: 0.34 },
  'rock-4': { kind: 'event', gain: 0.34 },
  'rock-5': { kind: 'event', gain: 0.34 },
  'rock-6': { kind: 'event', gain: 0.34 },
  'unit-1': { kind: 'event', gain: 0.8 },
  'unit-2': { kind: 'event', gain: 0.8 },
  'unit-3': { kind: 'event', gain: 0.8 },
  'unit-4': { kind: 'event', gain: 0.8 },
  'unit-5': { kind: 'event', gain: 0.8 },
  'unit-6': { kind: 'event', gain: 0.8 },

  // Positional loops — attached to things in the world, heard from where they are.
  'work-hammer': { kind: 'loop', gain: 1 },
  'ship-hum': { kind: 'loop', gain: 1 },
  'drone-whine': { kind: 'loop', gain: 1 },
  'shore-lap': { kind: 'loop', gain: 1 },
}

/** name → { kind, gain, synth(ctx, dest, opts, noise) → Voice } */
export const SOUNDS = {}
for (const name of Object.keys(TABLE)) {
  const synth = GENERATORS[name]
  if (typeof synth !== 'function') throw new Error(`[audio] "${name}" is registered without a synth`)
  SOUNDS[name] = { kind: TABLE[name].kind, gain: TABLE[name].gain, synth }
}

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS))

/**
 * The voice each kind of crew answers in, and how many phrases it has: `<voice>-1` to
 * `<voice>-<phrases>`. `select` is the stock crew's.
 */
export const CREW_VOICES = Object.freeze({ select: 6, unit: 6, rock: 6 })

/** The bird kinds `bird-call` understands, for a planet preset to pick from. */
export const BIRD_KINDS = Object.freeze(['gull', 'parrot', 'crow', 'songbird', 'owl'])

export function isSound(name) {
  return Object.prototype.hasOwnProperty.call(SOUNDS, name)
}
