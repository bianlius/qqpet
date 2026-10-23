import type { Good } from './data/goods'

/**
 * Trophy / 属性丹 foods often set hunger/clean to 1 so they can be "eaten" for attrs.
 * Auto-care must not treat that as a real fill — otherwise 大衍飞升丹 is eaten every minute forever.
 */
export const CARE_STAT_MIN = 2

/** True when the good restores enough of `stat` to be useful for 贴心宝贝 auto-care. */
export function careUseful<G extends Pick<Good, 'hunger' | 'clean' | 'mood'>>(g: G, stat: 'hunger' | 'clean' | 'mood'): boolean {
  return (g[stat] ?? 0) >= CARE_STAT_MIN
}

/**
 * The good that wastes least of its effect on `stat` with `deficit` points missing: the biggest one that still
 * fits, otherwise the one that overflows least. Goods that do nothing useful for the stat are never picked.
 */
export function pickCare<G extends Pick<Good, 'hunger' | 'clean' | 'mood'>>(goods: G[], stat: 'hunger' | 'clean' | 'mood', deficit: number): G | undefined {
  let fit: G | undefined
  let over: G | undefined
  for (const g of goods) {
    const v = g[stat] ?? 0
    if (!careUseful(g, stat)) continue
    if (v <= deficit) {
      if (!fit || v > (fit[stat] ?? 0)) fit = g
    } else if (!over || v < (over[stat] ?? 0)) over = g
  }
  return fit ?? over
}

/** 贴心宝贝自动照顾 (#116): below `<stat>`% the pet tends itself, with the chosen good (`''` picks the least wasteful). */
export interface CareConfig {
  on: boolean
  hunger: number
  clean: number
  mood: number
  food: string
  cleanGood: string
  toy: string
  /** Sick: see the doctor and take the right cure (bought when not owned). */
  heal: boolean
  /** Dead: use or buy 还魂丹 right away. */
  revive: boolean
  /** Out of a needed good: buy the cheapest suitable one in the shop, within `budget` 元宝 a day. */
  restock: boolean
  budget: number
  /** Pass the exam by itself when a school's lessons are done (outside custody too). */
  exam: boolean
  /** Go to work by itself when 元宝 fall below `workBelow` and nothing else is going on. */
  work: boolean
  workBelow: number
  /** Say what it did in a bubble; the log keeps it either way. */
  notify: boolean
  /** Closed farm: harvest, water/weed/kill, clear wilted, plant from the bag. */
  farm: boolean
  /** Fish pond: collect ripe fish. */
  fish: boolean
  /** Fish pond: also feed growing fish to shorten their growth (10 元宝 an hour each, within the daily budget). */
  fishFeed: boolean
}

export const DEFAULT_CARE: CareConfig = {
  on: true,
  hunger: 60,
  clean: 60,
  mood: 60,
  food: '',
  cleanGood: '',
  toy: '',
  heal: true,
  revive: true,
  restock: true,
  budget: 500,
  exam: true,
  work: false,
  workBelow: 200,
  notify: true,
  farm: false,
  fish: false,
  fishFeed: false,
}

export function parseCare(raw: string | undefined): CareConfig {
  let o: Partial<CareConfig> = {}
  try {
    o = (JSON.parse(raw || '{}') as Partial<CareConfig>) ?? {}
  } catch {
    /* defaults */
  }
  if (!o || typeof o !== 'object') o = {}
  const d = DEFAULT_CARE
  const pct = (v: unknown, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : dv)
  const yb = (v: unknown, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1e7, Math.round(v))) : dv)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const b = (v: unknown, dv: boolean) => (typeof v === 'boolean' ? v : dv)
  return {
    on: b(o.on, d.on),
    hunger: pct(o.hunger, d.hunger),
    clean: pct(o.clean, d.clean),
    mood: pct(o.mood, d.mood),
    food: str(o.food),
    cleanGood: str(o.cleanGood),
    toy: str(o.toy),
    heal: b(o.heal, d.heal),
    revive: b(o.revive, d.revive),
    restock: b(o.restock, d.restock),
    budget: yb(o.budget, d.budget),
    exam: b(o.exam, d.exam),
    work: b(o.work, d.work),
    workBelow: yb(o.workBelow, d.workBelow),
    notify: b(o.notify, d.notify),
    farm: b(o.farm, d.farm),
    fish: b(o.fish, d.fish),
    fishFeed: b(o.fishFeed, d.fishFeed),
  }
}

/** 元宝 spent by 贴心宝贝 on `day` (a 06:00 day start). */
export interface Spent {
  day: number
  yb: number
}

/** Whether `cost` fits today's budget and what is spent then; a new day starts from zero. */
export function spend(s: Spent, day: number, cost: number, budget: number, wallet: number): { ok: boolean; spent: Spent } {
  const cur = s.day === day ? s : { day, yb: 0 }
  if (cost > wallet || cur.yb + cost > budget) return { ok: false, spent: cur }
  return { ok: true, spent: { day, yb: cur.yb + cost } }
}

export interface LogEntry {
  /** unix seconds */
  t: number
  s: string
}

/** Newest first, at most `max` entries; the same line within a minute is folded into a count. */
export function pushLog(log: LogEntry[], e: LogEntry, max = 50): LogEntry[] {
  const top = log[0]
  if (top && e.t - top.t < 60 && top.s.replace(/ ×\d+$/, '') === e.s) {
    const n = Number(/ ×(\d+)$/.exec(top.s)?.[1] ?? 1) + 1
    return [{ t: e.t, s: `${e.s} ×${n}` }, ...log.slice(1)]
  }
  return [e, ...log].slice(0, max)
}

export function parseLog(raw: string | undefined): LogEntry[] {
  try {
    const a = JSON.parse(raw || '[]') as unknown
    return Array.isArray(a) ? a.filter((e): e is LogEntry => !!e && typeof e.t === 'number' && typeof e.s === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}

/** The cheapest good in the shop that does something for `stat`, among those the pet may buy. */
export function cheapest<G extends Pick<Good, 'hunger' | 'clean' | 'mood' | 'price'>>(goods: G[], stat: 'hunger' | 'clean' | 'mood'): G | undefined {
  let best: G | undefined
  for (const g of goods) {
    if (!careUseful(g, stat) || !(g.price! > 0)) continue
    // Value for money: points per 元宝, then the cheaper one.
    if (!best || g[stat]! / g.price! > best[stat]! / best.price! || (g[stat]! / g.price! === best[stat]! / best.price! && g.price! < best.price!)) best = g
  }
  return best
}

/** The best paid job the pet qualifies for: most 元宝 per minute. */
export function bestJob<J extends Pick<Good, 'yb' | 'useTime'>>(jobs: J[], qualifies: (j: J) => boolean): J | undefined {
  let best: J | undefined
  for (const j of jobs) {
    if (!j.yb || !j.useTime || !qualifies(j)) continue
    if (!best || j.yb / j.useTime > best.yb! / best.useTime!) best = j
  }
  return best
}

/** The chosen good when the pet still has it, otherwise the least wasteful one. */
export function chooseCare<G extends Pick<Good, 'hunger' | 'clean' | 'mood'> & { id: string }>(
  goods: G[],
  stat: 'hunger' | 'clean' | 'mood',
  deficit: number,
  chosen: string,
): G | undefined {
  const c = chosen && goods.find((g) => g.id === chosen && careUseful(g, stat))
  return c || pickCare(goods, stat, deficit)
}
