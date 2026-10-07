import { SOUNDS } from './sounds.js'
import { createNoiseBuffers } from './synth.js'

/**
 * Render one sound to samples, off line and faster than real time.
 *
 * Every sound here is synthesised, so there is no file to open and listen to, and the only
 * way to hear a recipe is to run it. This runs one on its own, with nothing else in the mix,
 * into a buffer: for checking a level or a spectrum by number, and for writing a clip out
 * that someone can play.
 *
 * A bed or a loop is driven the way the engine drives it, its `update` called ten times a
 * second, so anything that swells or wanders does so here too.
 *
 * @param {string} name  a name from the sound table
 * @param {number} [seconds]  how long to render; an event is rendered to its own end if less
 * @param {object} [opts]  passed to the recipe, as `play` would
 * @returns {Promise<{samples: Float32Array, sampleRate: number}>} mono, at the table's trim
 */
export async function audition(name, seconds = 4, opts = {}) {
  const def = SOUNDS[name]
  if (!def) throw new Error(`[audio] no sound named "${name}"`)
  const sampleRate = 44100
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate)
  const out = ctx.createGain()
  out.gain.value = def.gain
  out.connect(ctx.destination)
  const voice = def.synth(ctx, out, opts, createNoiseBuffers(ctx))

  const STEP = 0.1
  for (let t = STEP; t < seconds; t += STEP) {
    ctx.suspend(t).then(() => {
      voice.update(STEP, t)
      ctx.resume()
    })
  }
  const buffer = await ctx.startRendering()
  return { samples: buffer.getChannelData(0), sampleRate }
}
