/**
 * The names the world asks the audio for. A name with nothing behind it is silence where a
 * sound was meant, and nothing else would notice.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { ROBOT_VOICES } from '../src/agents/robots.js'
import { CREW_VOICES, SOUNDS, isSound } from '../src/audio/sounds.js'
import { PLANETS } from '../src/world/planet.js'

test('every sound a world asks for exists, and is the kind of sound it is asked for as', () => {
  for (const planet of Object.values(PLANETS)) {
    const audio = planet.audio || {}
    for (const bed of audio.beds || []) {
      assert.ok(isSound(bed.sound), `${planet.id}: no sound "${bed.sound}"`)
      assert.equal(SOUNDS[bed.sound].kind, 'bed', `${planet.id}: "${bed.sound}" is not a bed`)
    }
    for (const event of audio.events || []) {
      assert.ok(isSound(event.sound), `${planet.id}: no sound "${event.sound}"`)
      assert.equal(SOUNDS[event.sound].kind, 'event', `${planet.id}: "${event.sound}" is not an event`)
    }
    for (const loop of [audio.gate, audio.drone]) {
      if (!loop) continue
      assert.ok(isSound(loop), `${planet.id}: no sound "${loop}"`)
      assert.equal(SOUNDS[loop].kind, 'loop', `${planet.id}: "${loop}" is not a loop`)
    }
  }
})

test('every voice the crew can answer in has all of its phrases', () => {
  for (const [voice, phrases] of Object.entries(CREW_VOICES)) {
    assert.ok(phrases >= 2, `${voice} needs two phrases at least, or it repeats itself`)
    for (let n = 1; n <= phrases; n++) {
      assert.ok(isSound(`${voice}-${n}`), `no sound "${voice}-${n}"`)
      assert.equal(SOUNDS[`${voice}-${n}`].kind, 'event')
    }
  }
})

test('each kind of robot has a voice, and no two kinds share one', () => {
  for (const voice of ROBOT_VOICES) assert.ok(CREW_VOICES[voice], `no voice "${voice}"`)
  assert.equal(new Set(ROBOT_VOICES).size, ROBOT_VOICES.length)
  assert.ok(!ROBOT_VOICES.includes('select'), 'the stock crew keep the stock voice to themselves')
})

test('the campus has left the hum behind', () => {
  const audio = PLANETS.campus.audio
  assert.ok(!audio.beds.some((bed) => bed.sound === 'lunar-silence'))
  assert.ok(audio.beds.length >= 2 && audio.events.length >= 2)
  assert.equal(audio.gate, 'gate-hum')
  assert.equal(audio.drone, 'drone-whir')
  // And the worlds that had it keep it.
  assert.ok(PLANETS.moon.audio.beds.some((bed) => bed.sound === 'lunar-silence'))
})
