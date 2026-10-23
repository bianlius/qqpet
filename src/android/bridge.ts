// window.qqpet on Android. The page runs in a WebView that fills the screen but
// sits inside an overlay window cut down to the visible content: Android cannot
// pass touches through transparent pixels, so everything outside the window
// reaches the apps below.
import { aiChat, aiModels } from '../shared/ai'
import { webSearch } from '../shared/websearch'
import { calendar } from '../shared/calendar'
import { abortReason, cloneJson } from '../shared/compat'
import { nextBounds } from '../mobile/bounds'
import { cover } from '../mobile/overlay'
import type { Fetch, Point, QQPetApi, TrayClick, TrayState } from '../shared/ipc'
import type { SaveData } from '../shared/save'
import { applyPatch, buried, petOf, startSave } from '../shared/save-logic'
import { TRAY_STATES, trayTip } from '../shared/tray'
import { latestRelease } from '../shared/update'
import { weather } from '../shared/weather'
import { webdavApi, touchWebdavProgress } from '../shared/webdav-host'

/** The `QQPetNative` JavaScript interface of PetService. Async calls answer through `__qqpet.resolve(id, value, error)`. */
interface Native {
  /** Both screen orientations are supported; absent on older shells. */
  rotatableScreen?(): boolean
  /** A file in the app's private storage. Missing is undefined: the WebView bridge turns Kotlin's null into undefined. */
  read(name: string): string | undefined
  write(name: string, text: string): void
  /** Resolves to `{"status": n, "body": "…"}` JSON. */
  http(id: number, method: string, url: string, headers: string, body: string | null): void
  /** Resolves to "true" once written, null when cancelled. */
  exportSave(id: number, name: string, text: string): void
  /** Resolves to the picked file's text, null when cancelled. */
  importSave(id: number): void
  openGame(swf: string): void
  quit(): void
  copyText(text: string): void
  openUrl(url: string): void
  setFocusable(on: boolean): void
  setAutoStart(on: boolean): void
  /** The notification standing in for the tray: an icon under pet/img_res/Tray/, and its text unless null. */
  setTray(icon: string, tip: string | null): void
  /** The pet is hidden: the notification offers 显示宠物. Absent on older shells. */
  setHidden?(on: boolean): void
  /** The overlay window's rectangle, in CSS pixels of a page `viewport` pixels wide. */
  setBounds(x: number, y: number, w: number, h: number, viewport: number): void
  /** "left,top,right,bottom" of the system bars and cutout, in CSS pixels of a page `viewport` pixels wide. */
  safeArea(viewport: number): string
}

interface Events {
  trayClick: TrayClick
  gamePlayed: number
  /** A touch landed outside the overlay window. */
  outside: void
  /** Text picked from another app's selection menu or share sheet. */
  clipboard: string
  /** Screen off, or the user unlocked it. */
  presence: boolean
}

declare global {
  interface Window {
    QQPetNative: Native
    __qqpet: {
      resolve(id: number, value: string | null, error: string | null): void
      emit<K extends keyof Events>(type: K, payload: Events[K]): void
    }
  }
}

const native = window.QQPetNative
// The real frame clock: the SWF player holds page animation frames while the host is paused (#119), and the window
// must still follow a menu or panel opened from the notification while the pet is hidden.
const frame = window.requestAnimationFrame.bind(window)

const pending = new Map<number, { resolve: (v: string | null) => void; reject: (e: Error) => void }>()
let seq = 0
const call = (start: (id: number) => void): Promise<string | null> =>
  new Promise((resolve, reject) => {
    pending.set(++seq, { resolve, reject })
    start(seq)
  })

const listeners: { [K in keyof Events]: ((p: Events[K]) => void)[] } = { trayClick: [], gamePlayed: [], outside: [], clipboard: [], presence: [] }

window.__qqpet = {
  resolve(id, value, error) {
    const p = pending.get(id)!
    pending.delete(id)
    if (error === null) p.resolve(value)
    else p.reject(new Error(error))
  },
  emit(type, payload) {
    for (const l of listeners[type]) l(payload)
  },
}

const nativeFetch: Fetch = (url, init = {}) =>
  new Promise((resolve, reject) => {
    const { signal } = init
    if (signal?.aborted) return reject(abortReason(signal))
    const abort = (): void => reject(abortReason(signal!))
    signal?.addEventListener('abort', abort, { once: true })
    call((id) => native.http(id, init.method ?? 'GET', url, JSON.stringify(init.headers ?? {}), (init.body as string | undefined) ?? null)).then((r) => {
      signal?.removeEventListener('abort', abort)
      try {
        const { status, body } = JSON.parse(r!)
        resolve(new Response(body, { status }))
      } catch (error) { reject(error) }
    }, (error) => { signal?.removeEventListener('abort', abort); reject(error) })
  })

const FILE = 'save.json'

function readSave(): Record<string, any> | null {
  const text = native.read(FILE)
  if (text === undefined) return null
  try {
    return JSON.parse(text)
  } catch (e) {
    // Keep the broken file for manual recovery instead of silently losing the pet.
    native.write(`${FILE}.corrupt-${Date.now()}`, text)
    console.error('save file is corrupt, kept a copy:', e)
    return null
  }
}

let save: SaveData = startSave(readSave())
// Set while reloading into another save: the renderer's pending write must not land on it.
let leaving = false
const write = (): void => native.write(FILE, JSON.stringify(save))
write()

// The notification shows the first frame only: reposting it for every frame of the animation would be throttled.
let tray: TrayState = 'leave'
let posted = ''
function showTray(): void {
  const pet = save.petInfo
  const icon = `${pet.sex}/${TRAY_STATES[tray].frames ? `${tray}/1` : tray}.png`
  const tip = trayTip(tray, pet) ?? null
  if (posted === icon + tip) return
  posted = icon + tip
  native.setTray(icon, tip)
}

function relaunch(): void {
  leaving = true
  location.reload()
}

const cursorListeners: ((p: Point) => void)[] = []
const cursor = (p: Point): void => {
  for (const l of cursorListeners) l(p)
}
for (const type of ['pointerdown', 'pointermove'] as const) document.addEventListener(type, (e) => cursor({ x: e.clientX, y: e.clientY }), true)

// While a finger drags, the window covers the screen so the dragged pet or frame is never cut off.
// A tap leaves the window alone: every resize risks a frame where the page and window disagree.
const DRAG_PX = 6
let press: Point | null = null
let dragging = false
document.addEventListener('pointerdown', (e) => (press = { x: e.clientX, y: e.clientY }), true)
document.addEventListener('pointermove', (e) => (dragging ||= press !== null && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX), true)
for (const type of ['pointerup', 'pointercancel'] as const)
  document.addEventListener(
    type,
    () => {
      press = null
      dragging = false
    },
    true,
  )

let bounds = { x: 0, y: 0, w: 0, h: 0 }
// Measuring every element each frame kept the phone busy while nothing changed (#119): right after a touch or a
// window change the window follows every frame, otherwise a few times a second (a bubble or an animation that
// outgrows the window catches up within IDLE_MS).
const BUSY_MS = 2000
const IDLE_MS = 200
const PAUSED_MS = 1000
let busyUntil = 0
let measured = 0
for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) document.addEventListener(type, () => (busyUntil = performance.now() + BUSY_MS), true)
// A bubble, menu or panel appearing changes the page: the window follows it in the next frame, not IDLE_MS later.
// The notification offers 显示宠物 while the pet is hidden.
let hiddenSent: boolean | undefined
const sendHidden = (): void => {
  const on = document.body.classList.contains('petHidden')
  if (on !== hiddenSent) native.setHidden?.((hiddenSent = on))
}
new MutationObserver(sendHidden).observe(document.body, { attributes: true, attributeFilter: ['class'] })
sendHidden()
new MutationObserver(() => (busyUntil = performance.now() + BUSY_MS)).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
function track(now: number): void {
  frame(track)
  // A resize under a resting finger skews the next events (a long press reads as a drag); it waits for the lift.
  if (press && !dragging) return
  // Paused (pet hidden, or the owner away) the page rarely changes: measure seldom, but at once after a change.
  if (!dragging && now >= busyUntil && now - measured < (window.__qqpetHostPaused ? PAUSED_MS : IDLE_MS)) return
  measured = now
  let x = innerWidth
  let y = innerHeight
  let r = 0
  let b = 0
  if (dragging) [x, y, r, b] = [0, 0, innerWidth, innerHeight]
  else
    for (const el of document.body.querySelectorAll('*')) {
      const box = cover(el)
      if (!box) continue
      x = Math.min(x, box.left)
      y = Math.min(y, box.top)
      r = Math.max(r, box.right)
      b = Math.max(b, box.bottom)
    }
  const next = nextBounds(bounds, r > x && b > y ? { left: x, top: y, right: r, bottom: b } : null, innerWidth, innerHeight)
  if (next.x !== bounds.x || next.y !== bounds.y || next.w !== bounds.w || next.h !== bounds.h) {
    native.setBounds(next.x, next.y, next.w, next.h, innerWidth)
    busyUntil = now + BUSY_MS
  }
  bounds = next
}
frame(track)

// The page spans the whole screen, under the status and navigation bars; frames keep clear of them (box.ts).
function safeArea(): void {
  const [left, top, right, bottom] = native.safeArea(innerWidth).split(',')
  const s = document.documentElement.style
  for (const [side, v] of Object.entries({ left, top, right, bottom })) s.setProperty(`--safe-${side}`, `${v}px`)
}
safeArea()
addEventListener('resize', safeArea)

// A touch outside the window means the cursor rests on the desktop: report a viewport corner the window does not cover.
listeners.outside.push(() => {
  const corners = [
    { x: 0, y: 0 },
    { x: innerWidth - 1, y: 0 },
    { x: 0, y: innerHeight - 1 },
    { x: innerWidth - 1, y: innerHeight - 1 },
  ]
  const free = corners.find((p) => p.x < bounds.x || p.y < bounds.y || p.x >= bounds.x + bounds.w || p.y >= bounds.y + bounds.h)
  if (free) cursor(free)
})

const api: QQPetApi = {
  capabilities: { rotatableScreen: native.rotatableScreen?.() ?? false },
  load: async () => cloneJson(save),
  save(patch) {
    if (leaving) return
    applyPatch(save, cloneJson(patch))
    write()
    if (patch.petInfo) showTray()
    if (
      patch.petInfo ||
      patch.selfGoodDatas ||
      patch.selfGoodUseOption ||
      patch.studyInfo ||
      patch.gameSaveDatas ||
      patch.saveJsonData ||
      patch.activeOption ||
      patch.petComputedlInfo ||
      patch.havePet !== undefined ||
      patch.illustrated
    ) {
      touchWebdavProgress({ getSave: () => save, patchSave: (p) => { applyPatch(save, cloneJson(p)); write() } })
    }
  },
  resetPet(sex) {
    save = buried(save, sex)
    write()
    relaunch()
  },
  async exportSave() {
    const day = new Date().toISOString().slice(0, 10)
    return (await call((id) => native.exportSave(id, `QQPet-${day}.json`, JSON.stringify(save, null, 2)))) !== null
  },
  async importSave() {
    const text = await call((id) => native.importSave(id))
    if (text === null) return
    const pet = petOf(JSON.parse(text))
    if (pet.havePet !== true) throw new Error('no pet in this file')
    native.write(`${FILE}.bak`, JSON.stringify(save))
    native.write(FILE, JSON.stringify(pet))
    relaunch()
  },
  openGame: (swf) => native.openGame(swf),
  calendar: () => calendar(nativeFetch),
  aiModels: (c) => aiModels(nativeFetch, c),
  aiChat: (c, messages) => aiChat(nativeFetch, c, messages),
  webSearch: (query) => webSearch(nativeFetch, query),
  weather: (city) => weather(nativeFetch, city),
  latestRelease: () => latestRelease(nativeFetch),
  quit: () => native.quit(),
  copyText: (text) => native.copyText(text),
  openUrl: (url) => native.openUrl(url),
  // The overlay window follows the content instead.
  setClickThrough() {},
  // Overlay windows are always on top.
  setAlwaysOnTop() {},
  setFocusable: (on) => native.setFocusable(on),
  setAutoStart: (on) => native.setAutoStart(on),
  setTrayState(state) {
    tray = state
    showTray()
  },
  onCursor: (l) => void cursorListeners.push(l),
  // The notification has no position; its panels open mid-screen, not under the status bar.
  onTrayClick: (l) => void listeners.trayClick.push((c) => l({ ...c, x: innerWidth / 2, y: innerHeight / 2 })),
  onGamePlayed: (l) => void listeners.gamePlayed.push(l),
  // Android only lets the focused app read the clipboard; text arrives through the selection menu and share sheet instead.
  onClipboard: (l) => void listeners.clipboard.push(l),
  onPresence: (l) => void listeners.presence.push(l),
  onFront() {},
}


const webdav = webdavApi({
  fetch: nativeFetch,
  getSave: () => save,
  patchSave: (patch) => {
    applyPatch(save, cloneJson(patch))
    write()
  },
  replaceSave: (next) => {
    native.write(`${FILE}.bak`, JSON.stringify(save))
    save = startSave(JSON.parse(JSON.stringify(next)) as Record<string, unknown>)
    write()
  },
  readFile: (name, fallback) => native.read(name) ?? fallback,
  writeFile: (name, text) => native.write(name, text),
  ensureDeviceId: () => {
    if (save.settings.webdavDeviceId) return save.settings.webdavDeviceId
    const id = crypto.randomUUID()
    applyPatch(save, { settings: { webdavDeviceId: id } })
    write()
    return id
  },
  relaunch,
})

Object.assign(api, webdav)

window.qqpet = api
if (save.settings.webdav && save.settings.webdavAuto && save.settings.webdavUrl.trim()) {
  void api.webdavSync?.().then((r) => {
    if (r && r.ok) console.log("[webdav]", r.message)
    else if (r && !r.ok) console.error("[webdav]", r.error)
  })
}

// Ruffle's "复制错误详情" calls navigator.clipboard.writeText and ticks without waiting for it; the overlay
// WebView is not focused, so the web clipboard refuses and nothing is copied (#18). Copy natively instead.
{
  const writeText = (text: string): Promise<void> => {
    native.copyText(String(text))
    return Promise.resolve()
  }
  if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: writeText })
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}
