import type { Good } from './data/goods'

/**
 * goods.json 没有单独的「属性丹」类型：奖杯/徽章/飞升丹仍是 type food|clean。
 * 可辨字段只有 hunger|clean|mood 与 charm|intel|strong；price:-1 真零食也常用，不能当闸。
 *
 * 贴心宝贝只吃「能填缺口」的补给。token 填值（0/1）吃完仍低于阈值，会每分钟狂吃
 * （大衍飞升丹、黄金奖杯、愚人怪怪饼、泥浆沐浴露…）。属性字段单独做闸也不行——
 * 愚人怪怪饼 attrs=0 仍会循环。因此：
 * 1) CARE_STAT_MIN：care 值至少 2
 * 2) CARE_ATTR_TRINKET_MAX：带属性加成且 care 值仍像饰品（≤10，如圣战令牌）也排除
 * 表里带属性的正经食物 hunger 从 180 起跳；清爽冰花等低 hunger 真零食 attrs=0，不受 2) 影响。
 */
export const CARE_STAT_MIN = 2
/** Attr trophy / 令牌 still counted as a care fill below this (圣战令牌 hunger=10). */
export const CARE_ATTR_TRINKET_MAX = 10

/** 魅力+智力+武力；仅作属性丹/饰品判定，不当主闸。 */
export function careAttrBonus<G extends Partial<Pick<Good, 'charm' | 'intel' | 'strong'>>>(g: G): number {
  return (g.charm ?? 0) + (g.intel ?? 0) + (g.strong ?? 0)
}

/** True when the good restores enough of `stat` to be useful for 贴心宝贝 auto-care. */
export function careUseful<
  G extends Pick<Good, 'hunger' | 'clean' | 'mood'> & Partial<Pick<Good, 'charm' | 'intel' | 'strong'>>,
>(g: G, stat: 'hunger' | 'clean' | 'mood'): boolean {
  const v = g[stat] ?? 0
  if (v < CARE_STAT_MIN) return false
  if (careAttrBonus(g) > 0 && v <= CARE_ATTR_TRINKET_MAX) return false
  return true
}

/**
 * The good that wastes least of its effect on `stat` with `deficit` points missing: the biggest one that still
 * fits, otherwise the one that overflows least. Goods that do nothing useful for the stat are never picked.
 */
export function pickCare<G extends Pick<Good, 'hunger' | 'clean' | 'mood'> & Partial<Pick<Good, 'charm' | 'intel' | 'strong'>>>(goods: G[], stat: 'hunger' | 'clean' | 'mood', deficit: number): G | undefined {
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
export function cheapest<G extends Pick<Good, 'hunger' | 'clean' | 'mood' | 'price'> & Partial<Pick<Good, 'charm' | 'intel' | 'strong'>>>(goods: G[], stat: 'hunger' | 'clean' | 'mood'): G | undefined {
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
export function chooseCare<G extends Pick<Good, 'hunger' | 'clean' | 'mood'> & Partial<Pick<Good, 'charm' | 'intel' | 'strong'>> & { id: string }>(
  goods: G[],
  stat: 'hunger' | 'clean' | 'mood',
  deficit: number,
  chosen: string,
): G | undefined {
  const c = chosen && goods.find((g) => g.id === chosen && careUseful(g, stat))
  return c || pickCare(goods, stat, deficit)
}
