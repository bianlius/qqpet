import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Keep the real goods state transitions; replace only the disk-backed store and DOM.
const save = {
  selfGoodUseOption: { background: null, food: null, clean: null, toy: null },
}

function makeEl(id = '') {
  const el = {
    id,
    className: '',
    style: { backgroundImage: '' },
    children: [],
    parentElement: null,
    offsetWidth: 1,
    classList: {
      contains(name) { return el.className.split(/\s+/).filter(Boolean).includes(name) },
      add(name) {
        const names = new Set(el.className.split(/\s+/).filter(Boolean))
        names.add(name)
        el.className = [...names].join(' ')
      },
      remove(name) {
        const names = new Set(el.className.split(/\s+/).filter(Boolean))
        names.delete(name)
        el.className = [...names].join(' ')
      },
      toggle(name, on) {
        if (on === undefined) on = !el.classList.contains(name)
        if (on) el.classList.add(name)
        else el.classList.remove(name)
      },
    },
    prepend(child) {
      child.parentElement = el
      el.children.unshift(child)
      return child
    },
    querySelector(sel) {
      if (sel === ':scope > .petBg' || sel === '.petBg') {
        return el.children.find(c => c.className.split(/\s+/).filter(Boolean).includes('petBg')) ?? null
      }
      return null
    },
  }
  return el
}

globalThis.backgroundTestSave = save
const pet = makeEl('pet')
globalThis.document = {
  getElementById: () => pet,
  createElement: (tag = 'div') => {
    const el = makeEl()
    if (tag === 'canvas') {
      el.width = 0
      el.height = 0
      el.getContext = () => ({
        clearRect() {},
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      })
    }
    return el
  },
}
globalThis.HTMLCanvasElement = class {
  getContext() { return {} }
}

/** Scene bitmap lives on #pet > .petBg after the fade-layer change. */
const bgImage = () => pet.querySelector('.petBg')?.style.backgroundImage ?? ''

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+(?:\?|$)/i.test(specifier)) specifier += '.ts'
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/pet/store.ts')) return {
      format: 'module', shortCircuit: true,
      source: 'export const save = globalThis.backgroundTestSave; export const update = (key, value) => Object.assign(save[key], value)',
    }
    if (url.endsWith('/pet/data/goods.json')) return {
      format: 'module', shortCircuit: true,
      source: `export default ${readFileSync(new URL(url), 'utf8')}`,
    }
    return nextLoad(url, context)
  },
})

const { goodOf } = await import('../../src/renderer/pet/data/goods.ts')
const { startTimed, tickTimed } = await import('../../src/renderer/pet/goods.ts')
const { cover } = await import('../../src/mobile/overlay.ts')

test('desktop background restores, switches, expires and supports 无背景', async () => {
  await import('../../src/renderer/ui/background.ts')
  assert.equal(bgImage(), '')

  startTimed(goodOf('background', 'b0000001'))
  assert.equal(bgImage(), 'url("./pet/img_res/background/b0000001.gif")')
  assert.equal(save.selfGoodUseOption.background.left, 60)
  tickTimed(1)
  assert.equal(bgImage(), 'url("./pet/img_res/background/b0000001.gif")')

  startTimed(goodOf('background', 'b0000002'))
  assert.equal(bgImage(), 'url("./pet/img_res/background/b0000002.gif")')
  assert.deepEqual(tickTimed(120), ['background'])
  assert.equal(bgImage(), '')

  startTimed(goodOf('background', 'b0000001'))
  startTimed(goodOf('background', 'b0000000'))
  assert.equal(bgImage(), '')

  // Re-loading the renderer must draw the equipped background before any goods event.
  save.selfGoodUseOption.background = { id: 'b0000002', left: 15 }
  await import('../../src/renderer/ui/background.ts?restored')
  assert.equal(bgImage(), 'url("./pet/img_res/background/b0000002.gif")')
  save.selfGoodUseOption.background.left = 0
  await import('../../src/renderer/ui/background.ts?expired')
  assert.equal(bgImage(), '')
})

test('mobile cropping includes the scene, releases it when removed, and ignores hidden pets', () => {
  const box = { left: 100, top: 80, right: 260, bottom: 240, width: 160, height: 160 }
  const computed = { visibility: 'visible', display: 'block', opacity: '1' }
  Object.assign(pet, {
    getBoundingClientRect: () => box,
    ownerDocument: { defaultView: { getComputedStyle: () => computed } },
    parentElement: null,
    getRootNode: () => ({ host: null }),
    closest: () => pet,
    matches: () => false,
  })
  startTimed(goodOf('background', 'b0000001'))
  assert.equal(cover(pet), box)
  startTimed(goodOf('background', 'b0000000'))
  assert.equal(cover(pet), null)
  startTimed(goodOf('background', 'b0000001'))
  computed.opacity = '0'
  assert.equal(cover(pet), null)
})
