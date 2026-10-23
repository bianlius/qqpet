import { describe, type Good, type GoodType } from '../pet/data/goods'
import { toolbarScaleFor } from '../../shared/layout'
import { listGoods, onGoodsChange, pageOf, type Page } from '../pet/goods'
import { doctor, useItem } from '../pet/items'
import { describeStudy, describeWork, study, studyGoods, studyLessons, work, workGoods } from '../pet/jobs'
import { info, onInfoChange, petSize, save } from '../pet/store'
import { viewportSize } from './viewport'
import './css/control.css'
import { cardBadge } from './card-badge'
import { progressMark } from './progress-mark'
import { button, div, img, touch } from './dom'
import { openCommunity } from './community'
import { openEmail } from './email'
import { openFarm } from './farm'
import { openFishing } from './fishing'
import { openGames } from './games'
import { openMstx } from './mstx'
import { openPetInfo } from './petinfo'
import { progress } from './progress'
import { openSetup } from './setup'
import { openShop } from './shop'
import { openSignIn } from './signin'
import { setBubbleLift } from './talk'
import { openTask } from './task'
import { openTravel } from './travel'

const ICONS = 'pet/control/icons/'
const BAR_HEIGHT = 180
/** The goods panel, the bar's widest part. */
const BAR_WIDTH = 314
const EDGE = 10
/** Where the penguin's head and feet sit in the pet box; the swf leaves the rest transparent. */
const HEAD = 0.4
const FEET = 0.95
/** A finger needs longer than a mouse to find the next button. */
const HIDE_MS = touch ? 5000 : 1500
const PAGE = 4

type Stat = 'hunger' | 'clean' | 'health' | 'mood'

/** A list of goods to pick from, 4 per page. */
interface Panel {
  icon: string
  list: (page: number) => Page
  lines: (g: Good) => string[]
  /** Returns true when the panel should close. */
  use: (g: Good) => boolean
  /** Everyday panels: the inventory type shown, with the bar of the stat it restores and a shop link. */
  type?: GoodType
  stat?: Stat
  /** Bottom-right cue (study 4/9, bag count). Omit when there is no clear number. */
  mark?: (g: Good) => string | null | undefined
  /** Top-left label on the card face (study subject names). */
  tag?: (g: Good) => string | null | undefined
}

interface Entry {
  name: string
  icon: string
  run: () => void
}

const activeIcon = (n: number): string => `${ICONS}active/${n}.svg`

const inventory = (type: GoodType, icon: number, stat: Stat) => (): void =>
  openPanel({
    icon: activeIcon(icon),
    list: (page) => listGoods(type, page, PAGE),
    lines: (g) => [...describe(g), `数量：${g.num}`],
    use: (g) => {
      useItem(g)
      return false
    },
    type,
    stat,
    // Classic corner count on bag cards (not a fraction; still the same cue).
    mark: (g) => (g.num != null && g.num > 0 ? String(g.num) : null),
  })

const PANELS = {
  food: inventory('food', 18, 'hunger'),
  clean: inventory('clean', 20, 'clean'),
  medicine: inventory('medicine', 22, 'health'),
  toy: inventory('toy', 28, 'mood'),
}

/** A menu group opens its children on hover, or runs `run` on click. */
const MENU: { name: string; icon: string; children?: Entry[]; run?: () => void }[] = [
  {
    name: '日常',
    icon: 'richang.png',
    children: [
      { name: '食物', icon: 'weishi.png', run: PANELS.food },
      { name: '清洁', icon: 'qingjie.png', run: PANELS.clean },
      { name: '吃药', icon: 'zhibing.png', run: PANELS.medicine },
      { name: '玩具', icon: 'wanshua.png', run: PANELS.toy },
    ],
  },
  {
    name: '交互',
    icon: 'chongwu.png',
    children: [
      {
        name: '打工',
        icon: 'dagong.png',
        run: () => openPanel({ icon: activeIcon(26), list: (page) => pageOf(workGoods(), page, PAGE), lines: describeWork, use: work }),
      },
      {
        name: '学习',
        icon: 'xuexi.png',
        run: () =>
          openPanel({
            icon: activeIcon(24),
            list: (page) => pageOf(studyGoods(), page, PAGE),
            lines: describeStudy,
            use: study,
            tag: (g) => g.name || null,
            mark: (g) => progressMark(studyLessons(g), g.classNum ?? 0),
          }),
      },
      { name: '旅游', icon: 'lvyou.png', run: openTravel },
      { name: '看病', icon: 'zhibing.png', run: doctor },
    ],
  },
  {
    name: '工具',
    icon: 'renwu.png',
    children: [
      { name: '邮箱', icon: 'haoyou.png', run: openEmail },
      { name: '任务', icon: 'renwu1.png', run: openTask },
      { name: '签到', icon: 'juanzhou00.png', run: openSignIn },
      { name: '设置', icon: 'guanli.png', run: openSetup },
    ],
  },
  {
    name: '活动',
    icon: 'gonggao.png',
    children: [
      { name: '池塘', icon: 'fish01.png', run: openFishing },
      { name: '农场', icon: 'nongchang01.png', run: openFarm },
      { name: '游戏', icon: 'game.svg', run: openGames },
      { name: '密室', icon: 'mstx.png', run: openMstx },
      { name: '社区', icon: 'shequ.png', run: openCommunity },
    ],
  },
  { name: '档案', icon: 'dangan.png', run: openPetInfo },
]

const control = div('control')
control.dataset.hit = ''
document.body.appendChild(div('ui-control', control))

let shown = false
let hideTimer = 0
let introTimer = 0
let open: (Panel & { page: number }) | null = null

/**
 * Visible page box the bar must stay inside. Desktop uses the overlay size; when Android zooms the
 * layout viewport above what is shown, prefer the visual viewport so the panel is not clipped (#124 #103).
 */
function screenBox(): { left: number; top: number; width: number; height: number } {
  const base = touch ? { width: innerWidth, height: innerHeight } : viewportSize()
  const vv = window.visualViewport
  if (vv && vv.scale > 1.01) {
    return {
      left: vv.offsetLeft,
      top: vv.offsetTop,
      width: Math.min(vv.width, base.width),
      height: Math.min(vv.height, base.height),
    }
  }
  return { left: 0, top: 0, width: base.width, height: base.height }
}

/**
 * Centered under the pet's feet; when there is no room below, mirrored above its head. Kept on screen.
 * Native iPads use the original toolbar size; other touch hosts grow it with the pet.
 */
function place(): void {
  const size = petSize()
  const box = screenBox()
  const scale = toolbarScaleFor(size, (box.width - 2 * EDGE) / BAR_WIDTH, touch, window.qqpet.deviceKind)
  const height = BAR_HEIGHT * scale
  const half = (BAR_WIDTH * scale) / 2 + EDGE
  const feet = info.lastY + size * FEET
  const onTop = feet > box.top + box.height - EDGE - height
  control.classList.toggle('up', onTop)
  // Prefer the pet's center, then clamp so the 314px goods panel (scaled) stays fully visible (#124).
  const center = Math.min(Math.max(info.lastX + size / 2, box.left + half), box.left + box.width - half)
  control.style.left = `${center}px`
  control.style.top = `${onTop ? info.lastY + size * HEAD : feet}px`
  control.style.transform = `scale(${scale})`
  setBubbleLift(shown && onTop ? Math.max(height - size * HEAD, 0) : 0)
  // Tooltips and submenus can still stick out: nudge after layout if children overflow the visible box.
  requestAnimationFrame(() => {
    if (!shown) return
    let minL = center
    let maxR = center
    for (const child of control.children) {
      const r = (child as HTMLElement).getBoundingClientRect()
      if (r.width <= 0 && r.height <= 0) continue
      minL = Math.min(minL, r.left)
      maxR = Math.max(maxR, r.right)
    }
    let shift = 0
    if (maxR > box.left + box.width - EDGE) shift = box.left + box.width - EDGE - maxR
    if (minL + shift < box.left + EDGE) shift = box.left + EDGE - minL
    if (shift) control.style.left = `${center + shift}px`
    control.classList.toggle('nearRight', center + shift > box.left + box.width / 2)
  })
}

/** A tap leaves its menu hovered, children shown: on touch the bar goes once a child is picked, unless it opened a goods panel. */
function pick(run: () => void): void {
  run()
  if (touch && !open) hide()
}

const icons: HTMLElement[] = []
const menus = div(
  'menus fcc',
  ...MENU.map((g) => {
    const icon = div('menuItemIconBox', img('menuItemIcon', ICONS + g.icon))
    icons.push(icon)
    const item = div(
      'menuItem fcc focusPress',
      div('menuTip', g.name),
      icon,
      ...(g.children
        ? [div('childrenMenu', ...g.children.map((c) => button('childrenMenuItem fc', () => pick(c.run), img('childrenMenuItemIcon', ICONS + c.icon), ` ${c.name}`)))]
        : []),
    )
    if (g.run) item.addEventListener('click', g.run)
    item.addEventListener('mouseenter', () => {
      clearTimeout(introTimer)
      highlight(-1)
      clearTimeout(hideTimer)
    })
    item.addEventListener('mouseleave', scheduleHide)
    return item
  }),
)
control.appendChild(menus)

const highlight = (n: number): void => icons.forEach((icon, i) => icon.classList.toggle('hoverMenuItemIcon', i === n))

/** Lights the menu icons up one after another when the bar appears. */
function intro(n = 0): void {
  highlight(n)
  if (n < icons.length) introTimer = window.setTimeout(() => intro(n + 1), 150)
}

/** Pressing the pet shows the bar. */
export function showControl(): void {
  if (save.isBury) return
  clearTimeout(hideTimer)
  if (shown) return
  shown = true
  control.classList.add('showControl')
  place()
  intro()
}

/** Shows the bar with an everyday goods panel open. */
export function openGoods(type: keyof typeof PANELS): void {
  showControl()
  PANELS[type]()
}

/** The bar hides 1.5 s (5 s on touch screens) after the pointer leaves it, unless an inventory panel is open. */
export function scheduleHide(): void {
  clearTimeout(hideTimer)
  if (open) return
  hideTimer = window.setTimeout(hide, HIDE_MS)
}

function hide(): void {
  shown = false
  control.classList.remove('showControl')
  place()
}

let list: HTMLElement | null = null
/** The stat bar of the open panel, updated in place so a tick does not rebuild the goods under a finger. */
let bar: HTMLElement | null = null
/** The good a touch already previewed; it survives rebuilds of the same panel (a count change, a page turn). */
let picked: string | null = null

function openPanel(p: Panel, page = 1): void {
  if (open?.type !== p.type || open?.icon !== p.icon) picked = null
  open = { ...p, page }
  bar = null
  menus.style.display = 'none'
  const { list: goods, totalPage } = p.list(page)
  const turn = (d: number) => (): void => {
    if (page + d >= 1 && page + d <= totalPage) openPanel(p, page + d)
  }
  const items = goods.map((g: Good) => {
    const tag = p.tag?.(g)
    const mark = p.mark?.(g)
    return div(
      'goodItem',
      div(
        'goodItemIconBox fcc',
        div('goodInfo', div('goodName', g.name), ...p.lines(g).map((l) => div('goodDatas', l))),
        Object.assign(img('goodItemIcon', g.url), {
          onclick: () => {
            // A tap hovers what it touches: the first one shows the good's info, the next uses it.
            if (touch && picked !== g.id) return void (picked = g.id)
            picked = null
            if (p.use(g)) closePanel()
          },
        }),
        ...(tag ? [cardBadge(tag, 'tl')] : []),
        ...(mark ? [cardBadge(mark, 'br')] : []),
      ),
    )
  })
  const next = div(
    'goodList focusPress',
    img('goodTypeIcon', p.icon),
    ...(p.stat ? [button('toShoppingMall', openShop, '去购物')] : []),
    button('goodClose', closePanel),
    div(
      'goodListMain fcc',
      button('toLeft', turn(-1)),
      div(
        'goods f1 fC h100',
        div('fc f1', ...(items.length ? items : [div('goodsNone tc w100', ' 空空如也~~ ')])),
        ...(p.stat ? [(bar = div('progress', progress(info[p.stat], save.petComputedlInfo[`${p.stat}Max`])))] : []),
      ),
      button('toRight', turn(1)),
    ),
  )
  if (list) list.replaceWith(next)
  else control.appendChild(next)
  list = next
  place()
}

function closePanel(): void {
  open = null
  list?.remove()
  list = null
  bar = null
  picked = null
  menus.style.display = ''
  scheduleHide()
}

onInfoChange((key) => {
  if (key === 'lastX' || key === 'lastY' || key === 'growth') place()
  // 只换进度条：整块重建会丢掉手指刚点过的预览，第二下又变成预览，物品用不出去
  if (open?.stat && key === open.stat && bar) {
    const next = div('progress', progress(info[open.stat], save.petComputedlInfo[`${open.stat}Max`]))
    bar.replaceWith(next)
    bar = next
  }
})
onGoodsChange((type) => {
  if (open?.type === type) openPanel(open, Math.min(open.page, Math.max(open.list(1).totalPage, 1)))
})
