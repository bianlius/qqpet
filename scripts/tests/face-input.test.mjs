import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { FACE } from '../../src/renderer/pet/data/face.ts'
import { pokeMoodGain } from '../../src/renderer/pet/mood.ts'
import { renderer } from './pet-drag.test.mjs'

const faceSource = readFileSync(new URL('../../src/renderer/ui/face.ts', import.meta.url), 'utf8')

// Only the target listeners and DOM operations used by face.ts are needed here;
// main.ts and the shared gesture sequencer come from the renderer fixture.
class Element extends EventTarget {
  children = []
  parentElement = null
  className = ''
  style = {}
  dataset = {}
  captured = new Set()
  classList = {
    contains: name => this.className.split(/\s+/).includes(name),
    toggle: (name, on) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean))
      if (on) names.add(name)
      else names.delete(name)
      this.className = [...names].join(' ')
    },
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child }
  append(...children) { children.forEach(child => this.appendChild(child)) }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentElement = null })
    this.children = []
    this.append(...children)
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)) }
  closest(selector) {
    return selector === '.point' && this.classList.contains('point') ? this : this.parentElement?.closest(selector) ?? null
  }
  getAttribute() { return null }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this)
    this.parentElement = null
  }
  setPointerCapture(id) { this.captured.add(id) }
  hasPointerCapture(id) { return this.captured.has(id) }
  releasePointerCapture(id) { this.captured.delete(id) }
  click() { this.dispatchEvent(new Event('click')) }
}

function faceFixture({ stage = 'Egg', sex = 'GG', touch = true, faceClick = 2, pose = 'normal', mood = 800 } = {}) {
  const pet = new Element(), body = new Element()
  const document = Object.assign(new EventTarget(), {
    body,
    documentElement: { dataset: {} },
    getElementById: () => pet,
    createElement: () => new Element(),
    elementFromPoint: () => null,
  })
  const plays = [], counts = [], floats = [], alerts = []
  const machine = { pose: { a: pose }, play: value => plays.push(value) }
  let face
  const app = renderer(144, { x: 0, y: 0 }, null, stage, {
    ui: {
      touch, document, machine,
      div: className => Object.assign(new Element(), { className }),
      clearFacePoints: () => face.clearFacePoints(),
      showFacePoints: () => face.showFacePoints(),
      showFacePointsAfterClick: () => face.showFacePointsAfterClick(),
    },
  })
  Object.assign(app.info, { sex, mood })
  app.save.settings.faceClick = faceClick
  app.save.gameSaveDatas = { ddw: 0 }
  let now = 0, nextTimer = 0
  const timers = new Map()
  const scope = {
    FACE, pokeMoodGain, document, machine, touch, info: app.info, save: app.save,
    stage: () => stage,
    mood: () => app.info.mood >= 800 ? 'happy' : app.info.mood >= 500 ? 'peaceful' : app.info.mood >= 200 ? 'upset' : 'sad',
    rand: (min, max) => min === 5 && max === 15 ? 10 : min,
    addCount: name => counts.push(name),
    update: (key, value) => Object.assign(app.save[key], value),
    setInfo: (key, value) => { app.info[key] = value },
    floatMood: value => { floats.push(value) },
    windowView: value => alerts.push(value),
    window: { setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, at: now + delay }); return nextTimer } },
    clearTimeout: id => timers.delete(id),
  }
  const source = stripTypeScriptTypes(faceSource).replace(/^import .*$/gm, '').replace(/^export /gm, '')
  runInNewContext(source + '\nthis.face = { showFacePoints, showFacePointsAfterClick, clearFacePoints }', scope)
  face = scope.face
  const layer = pet.children.find(child => child.className === 'face')
  const native = (phase, x = 550, y = 340) => app.nativeInput({ phase, id: 1, x, y })
  return {
    app, pet, body, machine, plays, counts, floats, alerts,
    points: () => layer.children,
    native,
    tap(source = 'native') {
      if (source === 'native') { native('begin'); native('end') }
      else { app.pointer('pointerdown', 550, 340, pet); app.pointer('pointerup', 550, 340, pet) }
    },
    advance(milliseconds) {
      now += milliseconds
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback() }
      }
    },
  }
}

test('native and DOM touch taps show the real Egg and Kid point sets for both sexes', () => {
  for (const source of ['native', 'dom']) for (const sex of ['GG', 'MM']) for (const stage of ['Egg', 'Kid']) {
    const f = faceFixture({ stage, sex })
    f.tap(source)
    assert.equal(f.points().length, stage === 'Egg' ? 4 : 10, `${source}/${sex}/${stage}`)
    assert.deepEqual(f.points().map(point => [point.style.left, point.style.top]),
      Object.values(FACE[sex][stage]).map(point => [point.left, point.top]))
    assert.equal(f.counts.length, 0, 'showing points does not count as amusement')
  }
})

test('clicking a real point counts amusement, cheers the pet and selects its stage interaction', () => {
  for (const sex of ['GG', 'MM']) for (const stage of ['Egg', 'Kid', 'Adult']) {
    const f = faceFixture({ sex, stage, mood: 995 })
    f.tap()
    const points = stage === 'Adult' ? FACE[sex].Adult.happy : FACE[sex][stage]
    const [key, point] = Object.entries(points)[0]
    f.points()[0].click()
    assert.equal(f.points().length, 0)
    assert.deepEqual(f.counts, ['Amusing'])
    assert.equal(f.app.save.gameSaveDatas.ddw, 1)
    assert.equal(f.app.info.mood, 1000, 'mood is capped even when the reward exceeds the remaining room')
    assert.deepEqual(f.floats, [5], '兴奋档逗宠只加 5，995+5 正好封顶')
    assert.equal(f.alerts.length, 1, 'the first poke unlocks the achievement')
    assert.equal(f.plays.at(-1).a, 'faceActive')
    assert.equal(f.plays.at(-1).opt.url,
      `pet/Action/${sex}/${stage === 'Adult' ? 'Adult/happy' : stage}/interact/${key}${point.s ?? 1}.swf`)
    f.tap()
    f.points()[0].click()
    assert.equal(f.app.save.gameSaveDatas.ddw, 2)
    assert.deepEqual(f.counts, ['Amusing', 'Amusing'])
    assert.equal(f.alerts.length, 1, 'later pokes do not unlock the achievement again')
  }
})

test('a new native press clears old points, and a drag or cancellation does not reopen them', () => {
  for (const ending of ['drag', 'cancel']) {
    const f = faceFixture()
    f.tap()
    assert.equal(f.points().length, 4)
    f.native('begin')
    assert.equal(f.points().length, 0)
    if (ending === 'drag') { f.native('move', 590, 360); f.native('end', 590, 360) }
    else f.native('cancel')
    assert.equal(f.points().length, 0, ending)
    assert.equal(f.counts.length, 0)
  }
})

test('disabled interaction and non-normal poses do not expose points after a touch tap', () => {
  const disabled = faceFixture({ faceClick: 0 })
  disabled.tap()
  assert.equal(disabled.points().length, 0)
  for (const pose of ['enter', 'play', 'drag', 'hideleft', 'hideright']) {
    const f = faceFixture({ pose })
    f.tap()
    assert.equal(f.points().length, 0, pose)
  }
  const invisible = faceFixture({ faceClick: 1 })
  invisible.tap()
  assert.equal(invisible.points().length, 4, 'unmarked points remain interactive')
  assert.equal(invisible.body.classList.contains('faceHint'), false)
})

test('touch pointerenter leaves existing point nodes intact until their click', () => {
  const f = faceFixture()
  f.tap()
  const point = f.points()[0]
  f.pet.dispatchEvent(new Event('pointerenter'))
  f.advance(300)
  assert.equal(f.points()[0], point, 'hover timing must not replace a point under a held finger')
  point.click()
  assert.deepEqual(f.counts, ['Amusing'])
})

test('desktop hover still waits 300ms and leaving cancels or clears the points', () => {
  const f = faceFixture({ touch: false })
  f.pet.dispatchEvent(new Event('pointerenter'))
  f.advance(299)
  assert.equal(f.points().length, 0)
  f.advance(1)
  assert.equal(f.points().length, 4)
  f.pet.dispatchEvent(new Event('pointerleave'))
  assert.equal(f.points().length, 0)
  f.pet.dispatchEvent(new Event('pointerenter'))
  f.pet.dispatchEvent(new Event('pointerleave'))
  f.advance(300)
  assert.equal(f.points().length, 0)
  f.tap('dom')
  assert.equal(f.points().length, 4, 'a desktop click on the pet brings the spots back for the next click (#113)')
})

test('a desktop click that did not lift brings back the hover points it hid (#113)', () => {
  const f = faceFixture({ touch: false })
  f.pet.dispatchEvent(new Event('pointerenter'))
  f.advance(300)
  assert.equal(f.points().length, 4)
  f.tap('dom')
  assert.equal(f.points().length, 4, 'still hovering: the spots return for the next click')
})
