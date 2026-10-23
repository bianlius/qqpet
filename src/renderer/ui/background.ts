import { goodOf } from '../pet/data/goods'
import { onGoodsChange } from '../pet/goods'
import { save } from '../pet/store'

const petEl = document.getElementById('pet')!

/** Keep in step with the .petBg transition in style.css. */
const FADE_MS = 280

/**
 * Peek SWFs only draw a sliver; the original hid the scene so just the pet peeks from the edge.
 * It sits on its own layer under the pet so it can fade instead of vanishing, and the bitmap is
 * dropped only after it is invisible — until then it has to stay on screen to fade.
 */
const petBg = document.createElement('div')
petBg.className = 'petBg'
petEl.prepend(petBg)

let peeking = false
let unloadTimer = 0

/** The equipped scene sits behind the transparent action players and moves with the pet. */
const urlOf = (): string => {
  const bg = save.selfGoodUseOption.background
  return bg && bg.left > 0 && bg.id !== 'b0000000' ? `url("${goodOf('background', bg.id).url}")` : ''
}

function draw(): void {
  clearTimeout(unloadTimer)
  petBg.style.backgroundImage = peeking ? '' : urlOf()
  petBg.classList.toggle('hide', peeking)
}

/** Hide or restore the equipped scene when the pet slips into or out of an edge peek. */
export function setBackgroundPeeking(on: boolean): void {
  if (peeking === on) return
  peeking = on
  clearTimeout(unloadTimer)
  if (on) {
    petBg.classList.add('hide')
    unloadTimer = window.setTimeout(() => {
      if (peeking) petBg.style.backgroundImage = ''
    }, FADE_MS + 20)
    return
  }
  // Load it back while still transparent, then let it fade in.
  petBg.style.backgroundImage = urlOf()
  void petBg.offsetWidth
  petBg.classList.remove('hide')
}

draw()
onGoodsChange((type) => {
  if (type === 'background') draw()
})
