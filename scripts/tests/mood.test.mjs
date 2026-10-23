import assert from 'node:assert/strict'
import test from 'node:test'
import { moodDecayPerMinute, pokeMoodGain } from '../../src/renderer/pet/mood.ts'

test('face poke mood follows classic bands (#131)', () => {
  assert.equal(pokeMoodGain(1000), 5)
  assert.equal(pokeMoodGain(900), 5)
  assert.equal(pokeMoodGain(899), 10)
  assert.equal(pokeMoodGain(800), 10)
  assert.equal(pokeMoodGain(799), 30)
  assert.equal(pokeMoodGain(500), 30)
  assert.equal(pokeMoodGain(499), 50)
  assert.equal(pokeMoodGain(200), 50)
  assert.equal(pokeMoodGain(199), 70)
  assert.equal(pokeMoodGain(0), 70)
})

test('mood decays 1/min idle and 2/min while busy (#131)', () => {
  assert.equal(moodDecayPerMinute(false), 1)
  assert.equal(moodDecayPerMinute(true), 2)
})
