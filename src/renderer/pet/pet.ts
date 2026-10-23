import { PetSwf } from '../swf/pet-swf'
import { setBackgroundPeeking } from '../ui/background'
import { openEmail } from '../ui/email'
import { floatMood } from '../ui/float'
import { say } from '../ui/talk'
import { emitSaid } from './said'
import { DEAD, illOf } from './data/ills'
import { TALK, type Line } from './data/talk'
import { advanceTask, stopTask } from './activity'
import { chooseCare } from './care'
import { care, tickCustody } from './custody'
import { careTick, logCare, restock } from './sweetcare'
import { IDLE, rephrase } from './ai'
import { dateTalk, festival, greeting, loadCalendar } from './calendar'
import { listGoods, tickTimed } from './goods'
import { doctor, useItem, useItemQuietly } from './items'
import { deliverMails } from './mail'
import { Machine, type Pose } from './machine'
import { moodDecayPerMinute } from './mood'
import { rand } from './rand'
import { lookUrl, restPlan, SINGLE_FRAME_HOLD, walkUrl } from './router'
import {
  activity,
  addInfo,
  applyEdge,
  busy,
  edgeSide,
  fatigue,
  growthPerMinute,
  info,
  mood,
  onInfoChange,
  petSize,
  playingDesk,
  refreshTray,
  save,
  setActivity,
  setInfo,
  setTray,
  stage,
  syncLevel,
  update,
} from './store'
import { harvestNews } from './harvest'
import { resetSignIn, tickGift } from './signin'
import { resetTasks, rollDaily } from './tasks'
import { dayStart, newDay } from './vip'
import { weatherNews, weatherStrain } from './weather'

let idleTimer = 0

const petSwf = new PetSwf(document.getElementById('pet')!)

/** Applies the 宠物音效 setting to the players already on screen; every load re-applies it too. */
export const applyPetSound = (): void => petSwf.applySound()

export const machine = new Machine(petSwf, (over, next) => {
  clearTimeout(idleTimer)
  // Anything else (drag, click, a queued action) ends the rest.
  if (next.a !== 'liedown' && next.a !== 'lying') endRest()
  if (next.a === 'normal' || next.a === 'hideleft' || next.a === 'hideright') {
    idleTimer = window.setTimeout(idle, Math.trunc(Math.random() * 40000 + 20000))
  }
  over.e?.()
  next.s?.()
  const wasPeek = over.a === 'hideleft' || over.a === 'hideright'
  const nowPeek = next.a === 'hideleft' || next.a === 'hideright'
  if (wasPeek !== nowPeek) setBackgroundPeeking(nowPeek)
})

/** Answering the pet's small talk cheers it up. */
function cheer(): void {
  const v = rand(5, 15)
  void floatMood(v)
  setInfo('mood', Math.min(info.mood + v, 1000))
}

/** Official lead cooldown (`operatereffecttime="3600"`). Session-only; a restart may show it once. */
const LEAD_CD = 3600
let lastLead = 0
/** Sickness is serious: the pet brings it up far more often than hunger, with the doctor one tap away. */
const SICK_CD = 600
let lastSick = 0
let walkTick = 0
let walkDir: 'left' | 'right' = 'left'

const peeking = (): boolean => machine.pose.a === 'hideleft' || machine.pose.a === 'hideright'

/** Hungry / dirty / poor, same order as the official lead package. */
function leadOf(): 'hungry' | 'dirty' | 'poor' | null {
  if (info.hunger < 300) return 'hungry'
  if (info.clean < 300) return 'dirty'
  if (info.yb < 200) return 'poor'
  return null
}

/** Adult official pack only shipped poor; hungry/dirty fall back to a speak clip. */
function leadClip(kind: 'hungry' | 'dirty' | 'poor'): string {
  if (kind !== 'poor' && stage() === 'Adult') return 'speak'
  return kind
}

/** A peeking pet only shows the bubble: the sick clip draws the full body and would walk it off the edge. */
function complain(): void {
  lastSick = Date.now() / 1000
  speak({ s: illOf(activity('ill')! + info.health).tolk, b: '带你看病', now: true }, peeking() ? 'speak' : 'sick', { ok: doctor })
}

/** Checked every minute, so a peeking pet (no idle timer) still brings it up. */
function nag(): void {
  if (!info.health || info.health === 5 || busy() || Date.now() / 1000 - lastSick < SICK_CD) return
  if (machine.pose.a === 'normal' || peeking()) complain()
}

/** Plays the official need animation (and the unused `state.eat` / `state.clean` lines). */
function maybeLead(): boolean {
  if (machine.pose.a !== 'normal' || busy() || info.health < 5 || save.settings.paused) return false
  if (Date.now() / 1000 - lastLead < LEAD_CD) return false
  const kind = leadOf()
  if (!kind) return false
  lastLead = Date.now() / 1000
  const talk = kind === 'hungry' ? 'eat' : kind === 'dirty' ? 'clean' : 'poor'
  speak({ c: 'state', s: talk, now: true }, leadClip(kind))
  return true
}

function stopWalk(): void {
  clearInterval(walkTick)
  walkTick = 0
  if (machine.pose.a !== 'walk') return
  // walkstop is a 1-frame clip; the machine treats those as a hold, so it stuck on the same pose.
  // GG may look around first; holdMs ends that single-frame clip.
  const edge = applyEdge()
  const look = !edge && Math.random() < 0.5 ? lookUrl(info.sex, stage(), walkDir) : null
  machine.play(look ? { a: 'look', opt: { url: look, opt: { opt: { holdMs: SINGLE_FRAME_HOLD } } } } : { a: edge ?? 'normal' })
}

/** Move only after the walk pose is on screen. play() is async; starting the timer earlier suicides. */
function startWalkMove(speed: number, until: number): void {
  clearInterval(walkTick)
  walkTick = window.setInterval(() => {
    if (machine.pose.a !== 'walk') {
      clearInterval(walkTick)
      walkTick = 0
      return
    }
    const next = info.lastX + speed
    const max = innerWidth - petSize()
    if (Date.now() > until || next <= 0 || next >= max) {
      setInfo('lastX', Math.min(Math.max(next, 0), max))
      stopWalk()
      return
    }
    setInfo('lastX', next)
  }, 1000 / 12)
}

/** In-place walk cycle; we move the box at the official 8 px / 12 fps, scaled to pet size. */
function walk(): boolean {
  if (!save.settings.roam || busy() || playingDesk() || info.health < 5) return false
  if (machine.pose.a !== 'normal' || edgeSide()) return false
  const s = petSize()
  const roomL = info.lastX
  const roomR = innerWidth - info.lastX - s
  if (roomL < 48 && roomR < 48) return false
  const dir: 'left' | 'right' = roomL < 80 ? 'right' : roomR < 80 ? 'left' : Math.random() < 0.5 ? 'left' : 'right'
  walkDir = dir
  const speed = 8 * (s / 144) * (dir === 'left' ? -1 : 1)
  machine.play({
    a: 'walk',
    opt: { url: walkUrl(info.sex, stage(), dir), opt: {} },
    s: () => startWalkMove(speed, Date.now() + rand(2000, 5000)),
  })
  return true
}

const REST_POSES = ['liedown', 'lying']
let restTimer = 0
const resting = (): boolean => REST_POSES.includes(machine.pose.a)

function endRest(): void {
  clearTimeout(restTimer)
  restTimer = 0
}

/** Lies down for 20-60 s (or until interrupted), then gets up. False when this pet cannot. */
export function rest(): boolean {
  if (busy() || playingDesk() || info.health < 5 || resting()) return false
  if (machine.pose.a !== 'normal' && machine.pose.a !== 'walk') return false
  const plan = restPlan(info.sex, stage())
  if (!plan) return false
  stopWalk()
  const lying: Pose = { a: 'lying', opt: { url: plan.lying.url, opt: { opt: { overCurrentFrame: plan.lying.freeze } } } }
  // play() clears the queue when it starts, so the lying pose is queued once lying down is on screen.
  if (plan.down) machine.play({ a: 'liedown', opt: { url: plan.down, opt: {} }, s: () => machine.add(lying) })
  else machine.play(lying)
  endRest()
  restTimer = window.setTimeout(() => {
    restTimer = 0
    if (!resting()) return
    machine.play(plan.up ? { a: 'getup', opt: { url: plan.up, opt: {} } } : { a: 'normal' })
  }, rand(20000, 60000))
  return true
}

/** After 20-60 s of standing: walk / play / talk, same timer. Walk only if roam is on. */
function idle(): void {
  if (peeking() || playingDesk()) return
  if (maybeLead()) return
  if (Math.random() < 0.1 && rest()) return
  if (save.settings.roam) {
    const n = Math.trunc(Math.random() * 3)
    if (n === 0 && walk()) return
    if (n !== 2) return machine.add({ a: 'play' })
  } else if (Math.random() < 0.8) {
    return machine.add({ a: 'play' })
  }
  const date = Math.random() < 0.3 ? dateTalk() : null
  speak(date ? { s: date, ai: IDLE } : { c: 'smallTalk', ai: IDLE }, 'speak', { ok: cheer })
}

function line(c: string, s?: string): Line | null {
  let lines = TALK[c] ?? []
  if (s && !Array.isArray(lines)) lines = lines[s] ?? []
  return Array.isArray(lines) && lines.length ? lines[rand(0, lines.length - 1)] : null
}

interface Say {
  /** Dialog category in TALK, with `s` as sub key; otherwise `s` is the literal text. */
  c?: string
  s?: string
  /** Button label. */
  b?: string
  /** Preempt the current animation instead of queueing. */
  now?: boolean
  /**
   * While AI is on: a prompt to rewrite the line (shown first, then replaced),
   * `IDLE` waits for the model (the stock line is only a hint), `false` keeps the text.
   */
  ai?: string | false
}

/** Shows a bubble, optionally together with an action that it waits for. Do-not-disturb drops only the bubble, never one whose button the caller waits for. */
/** How long a pinned bubble (`wait`) stays up. */
const WAIT_MS = 180_000

export function speak(t: Say, action?: string, hooks: { start?: () => void; end?: () => void; ok?: () => void; wait?: boolean } = {}): void {
  let text = t.s ?? ''
  let button = t.b ?? '好的'
  if (t.c) {
    const l = line(t.c, t.s)
    text = l?.tolk ?? `${t.c}-${t.s}聊天数据丢失，请联系管理员处理`
    button = l?.submitText ?? '好的'
  }
  text = text.replace(/\[host]/g, info.host)
  const onOk = hooks.ok ? [hooks.ok] : []
  const show = (): void => {
    // 免打扰只挡闲聊；带确认回调的气泡（如升学考试「我要考试」）是唯一入口，必须显示 (#106)
    if (!save.settings.quiet || hooks.ok) {
      // 「台词润色」关 = 原版台词原样念；开 = 等 AI 生成/润色完再开口（动作已先播，只有气泡等）
      const polish = save.settings.polish && t.ai !== false
      const blurt = (s: string): void => {
        // 入账的是它真正说出口的那句
        emitSaid(s)
        // 钉住的气泡（如「我要考试」）是唯一入口：留 3 分钟、不被别的气泡顶掉，直到被点掉
        void say(s, [button], onOk, hooks.wait ? WAIT_MS : undefined, hooks.wait)
      }
      if (!polish) blurt(text)
      else void rephrase(text, t.ai || undefined).then((s) => blurt(s ?? text))
    }
    hooks.start?.()
  }
  if (!action || (!info.health && action !== 'bury')) return show()
  // Peek is a sliver SWF; speak/play would draw the full body and walk it off the edge.
  if ((action === 'speak' || action === 'play') && (machine.pose.a === 'hideleft' || machine.pose.a === 'hideright')) return show()
  const pose: Pose = { a: action, s: show, e: hooks.end }
  if (t.now) machine.play(pose)
  else machine.add(pose)
}

let reviving = false
export function revive(done?: () => void): void {
  if (reviving) return
  reviving = true
  machine.play({
    a: 'revival',
    e: () => {
      speak({ s: '[host]，再次见到你很高兴~~ ', b: '我也很高兴~' })
      setInfo('health', 5)
      done?.()
      reviving = false
      burying = false
    },
  })
}

let burying = false
export function bury(done?: () => void): void {
  if (burying) return
  burying = true
  update('isBury', true)
  setTray('bury')
  speak({ c: 'state', s: 'bury' }, 'bury', { start: done })
}

let lastMood = mood()
onInfoChange((key, prev) => {
  if (key === 'growth') {
    const before = syncLevel()
    const now = save.petComputedlInfo.level
    if (now === before) return
    const first = (now === 5 && before === 4) || (now === 10 && before === 9)
    speak({ c: first ? `first${now === 5 ? 1 : 2}` : 'levUp', now: true }, first ? 'first' : 'levUp')
  } else if (key === 'health') {
    healthChanged(prev as number)
  } else if (key === 'mood' && mood() !== lastMood) {
    lastMood = mood()
    if (stage() === 'Adult') speak({ c: 'mood', s: lastMood, now: true }, 'speak')
  } else if (key === 'hunger' || key === 'clean' || key === 'yb') {
    maybeLead()
  }
})

function healthChanged(prev: number): void {
  const h = info.health
  if (h < 0 || Number.isNaN(h)) return setInfo('health', 0)
  if (h > 5) return setInfo('health', 5)
  if (h === 5) {
    if (prev === 0) revive()
    setActivity('ill', null)
    return setTray('normal')
  }
  if (h === 0) {
    if (save.settings.undying) return setInfo('health', 5)
    speak({ s: DEAD.tolk, now: true }, 'dying', { start: () => machine.add({ a: 'die' }) })
    return setTray('dead')
  }
  if (!activity('ill')) setActivity('ill', `${rand(0, 2)}-`)
  complain()
  setTray('ill')
}

/** Last accounted time; null makes the next tick only start the clock (start-up, or after a pause). */
let lastTick: number | null = null

/** 作弊: stats don't decay. */
export const frozen = (): boolean => save.saveJsonData.freeze === '1'
export const setFrozen = (on: boolean): void => update('saveJsonData', { freeze: on ? '1' : '0' })

/** 作弊: lets `minutes` of growth time pass at once (activities, decay, 贴心宝贝 included). */
export function skipTime(minutes: number): void {
  if (lastTick === null) return
  lastTick -= Math.max(0, Math.min(minutes, 2880)) * 60
  tick()
}

const MOOD_OUT = { work: 'stopWorkFoMood0', study: 'stopStudyFoMood0', trip: 'overTripUpFoMood0' }

/** Per-minute accounting: online time, stat decay and growth for the elapsed minutes. */
function tick(): void {
  const now = Math.floor(Date.now() / 1000)
  const today = dayStart(now)
  if (save.nowTimeLine <= today) {
    setInfo('onlineDataTime', 0)
    newDay(today)
    resetTasks()
    resetSignIn()
    void daily()
  }
  if (lastTick !== null) {
    const minutes = +((now - lastTick) / 60).toFixed(5)
    addInfo('onlineDataTime', minutes)
    addInfo('onLineTime', minutes)
    tickGift(minutes)
    // A long gap (locked screen, sleep) is replayed in minute steps so a sweetheart pet keeps tending itself meanwhile.
    const steps = info.sweetHeart ? Math.min(Math.max(Math.ceil(minutes), 1), 2880) : 1
    const dt = minutes / steps
    let grown = 0
    for (let i = 0; i < steps; i++) {
      // Work, study and travel wear the pet out faster.
      const extra = busy() ? 1 : 0
      const moodRate = moodDecayPerMinute(Boolean(extra))
      // Growth only counts the minutes the mood lasted; an activity stops when it runs out.
      const g = Math.min(dt, info.mood / moodRate)
      if (g < dt) {
        const stopped = stopTask()
        if (stopped) speak({ c: 'state', s: MOOD_OUT[stopped], now: true }, 'speak')
      }
      // 作弊「冻结状态」: hunger, cleanliness and mood stay put.
      if (!frozen()) {
        setInfo('mood', Math.max(info.mood - moodRate * dt, 0))
        setInfo('hunger', Math.max(info.hunger - (rand(2, 3) + extra) * dt, 0))
        setInfo('clean', Math.max(info.clean - (rand(2, 3) + extra) * dt, 0))
      }
      addInfo('growth', +(growthPerMinute() * g).toFixed(8))
      grown += g
      if (info.sweetHeart) selfCare(i < steps - 1)
    }
    for (const type of tickTimed(grown)) speak({ c: 'state', s: `${type}Over`, now: true }, 'speak')
    advanceTask(grown)
    tickCustody()
    careTick()
  }
  lastTick = now
  update('nowTimeLine', now)
}

/** The first need under 60% (food before cleaning before play), with the words the pet says. */
const NEEDS = [
  { stat: 'hunger', type: 'food', act: '吃东西' },
  { stat: 'clean', type: 'clean', act: '洗白白' },
  { stat: 'mood', type: 'toy', act: '玩玩具' },
] as const

/** Sweetheart: the pet tends its first low need it has a good for, with the good that wastes least (#40). */
function selfCare(quiet = false): void {
  const cfg = care()
  if (!cfg.on) return
  for (const need of NEEDS) {
    const max = save.petComputedlInfo[`${need.stat}Max`]
    if (info[need.stat] / max >= cfg[need.stat] / 100) continue
    const chosen = { food: cfg.food, clean: cfg.cleanGood, toy: cfg.toy }[need.type]
    const g = chooseCare(listGoods(need.type, 1, Number.MAX_SAFE_INTEGER).list, need.stat, max - info[need.stat], chosen) ?? restock(need.type, need.stat)
    if (!g) continue
    logCare(`自己${need.act}：${g.name}`, false)
    if (quiet) useItemQuietly(g)
    else useItem(g, false, `[host]，我可以自己${need.act}哦！~~使用了：${g.name}`)
    return
  }
}

/**
 * Per minute, by fatigue squared: a well-kept pet never falls ill, a badly neglected one (fatigue 7) in about a day and
 * a half; each point of harsh weather adds the base chance once more. The original fell ill within about 2 hours at fatigue 1.
 */
const ILL_RATE = 1 / 100_000

/** Illness for a run-down pet, and further health loss once ill. */
function healthRoll(): void {
  const f = fatigue()
  if (!f) return
  if (info.health !== 5) {
    // 8x slower than the original: at its rate an unattended Lv1 pet died within one night (median ~9.5 h).
    if (rand(0, (700 - f * 50) * 8) < 5) setInfo('health', info.health - 1)
    return
  }
  const harsh = weatherStrain()
  if (Math.random() < f * f * (1 + harsh) * ILL_RATE) {
    // Weather brings a cold; neglect any of the three.
    setActivity('ill', `${harsh ? 1 : rand(0, 2)}-`)
    setInfo('health', 4)
  }
}

/** A dead or paused pet does not age; the minutes in between are never accounted. */
function grow(): void {
  if (info.health <= 0 || save.settings.paused) {
    lastTick = null
    // 贴心宝贝 still watches over a dead pet: its revive lives in careTick, which tick() no longer reaches.
    if (info.health <= 0 && !save.settings.paused) careTick()
    return
  }
  tick()
  refreshTray()
  healthRoll()
  nag()
  void harvestNews().then((n) => n && speak({ s: n.s, b: '去看看' }, 'speak', { ok: n.ok }))
}

/** At start-up and at 06:00: the day's tasks, the holiday greeting and the day's mail. */
const weatherTalk = (launch: boolean): Promise<void> => weatherNews(launch).then((s) => void (s && speak({ s }, 'speak')))

/** Day daily() last ran for; a launch on a new day reaches it from both startPet and tick. */
let dailyDay = 0

async function daily(): Promise<void> {
  if (dailyDay === dayStart()) return
  dailyDay = dayStart()
  const today = await loadCalendar()
  rollDaily(today)
  const f = festival()
  if (f) speak({ s: f }, 'speak')
  void weatherTalk(true)
  if (deliverMails(today)) speak({ s: '[host]，邮箱里来了新邮件，快去看看吧~', b: '这就去' }, 'speak', { ok: openEmail })
}

let growthTimer: ReturnType<typeof setInterval> | null = null

function startGrowth(): void {
  if (growthTimer !== null) return
  grow()
  // A task resumed after a restart may be due already.
  advanceTask(0)
  growthTimer = setInterval(grow, 60_000)
}

export function startPet(): void {
  refreshTray()
  if (save.isBury) {
    bury()
    setTray('dead')
  } else if (info.health === 0) {
    speak({ s: DEAD.tolk, b: '别走~' })
    machine.play({ a: 'dying', s: () => machine.add({ a: 'die' }) })
    setTray('dead')
  } else {
    if (info.health < 5) setTray('ill')
    const a = info.growth === 0 ? 'first' : 'enter'
    // Half the launches greet by the time of day instead of the original enter lines.
    const g = a === 'enter' && Math.random() < 0.5 ? greeting() : null
    machine.play({ a, s: () => speak(g ? { s: g.tolk, b: g.submitText } : { c: a }) })
    if (info.growth === 0) addInfo('growth', 1)
    void daily()
    // Bad weather can turn up later in the day.
    setInterval(() => void weatherTalk(false), 3600_000)
  }
  // Visual poses can be replaced before they run, especially when a mobile
  // host resumes. Accounting must not depend on an animation's exit callback.
  if (!save.isBury) startGrowth()
  machine.start()
}
