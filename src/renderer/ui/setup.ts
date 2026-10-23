import { description } from '../../../package.json'
import { APP_VERSION } from '../../shared/version'
import { DEFAULT_HOTKEY, hotkeyLabel } from '../../shared/hotkey'
import { forgetMemory } from './chat'
import { applyPetSound, speak } from '../pet/pet'
import { info, save, setInfo, update } from '../pet/store'
import { weatherNow } from '../pet/weather'
import { openFrame } from './box'
import './css/setup2.css'
import { button, div, typeable } from './dom'
import { setFaceClick } from './face'
import { readopt, setHidden } from './menu'
import { wakeFromHidden } from '../host-pause'
import { pageZoom, windowDirectionAvailable } from './viewport'
import { checkUpdate, ipcError, packReady } from './update'
import { windowView } from './window-view'
import { onCustodyChange } from '../pet/custody'
import { btn, check, cheatSection, refreshLive, sweetSection } from './setup-sections'

type Option = { label: string; title?: string } & (
  | { type: 'radio'; on: () => boolean; run: () => void }
  | { type: 'slider'; value: () => number; step: (d: number) => void }
  | { type: 'button'; run: () => void }
  | { type: 'see'; value: string; run?: () => void }
  | { type: 'input'; value: () => string; set: (v: string) => void }
  | { type: 'head' }
)

function webhookUrl(): string {
  return `http://127.0.0.1:${save.settings.webhookPort}/hook?token=${save.settings.webhookToken}`
}

function toggleWebhook(): void {
  const s = save.settings
  if (s.webhook) return update('settings', { webhook: false })
  update('settings', { webhook: true, webhookToken: s.webhookToken || crypto.randomUUID().replace(/-/g, '') })
  // The server binds a moment later; say so when the port is taken.
  window.setTimeout(() => {
    void window.qqpet.webhookState?.().then((r) => {
      if (r.error) windowView({ title: 'Webhook', msg: `启动失败：${r.error}，请换一个端口。` })
    })
  }, 600)
}

function webhookOptions(): Option[] {
  const s = save.settings
  const copy = (text: string, done: string): void => void navigator.clipboard.writeText(text).then(() => windowView({ title: 'Webhook', msg: done }))
  const opts: Option[] = [
    {
      type: 'radio',
      label: 'Webhook：接收外部消息（默认关）',
      title: '在本机 127.0.0.1 开一个 HTTP 接口，外部服务 POST 过来的消息会由宠物念出来，可带链接，点「打开链接」跳转。仅本机可访问，必须带 token；免打扰时不弹。',
      on: () => s.webhook,
      run: toggleWebhook,
    },
  ]
  if (!s.webhook) return opts
  return [
    ...opts,
    { type: 'input', label: 'Webhook 端口（1024-65535，改后立即生效）', value: () => String(s.webhookPort), set: (v) => { const n = Math.trunc(Number(v)); if (n >= 1024 && n <= 65535) update('settings', { webhookPort: n }) } },
    { type: 'button', label: '复制 Webhook 地址', title: webhookUrl(), run: () => copy(webhookUrl(), '地址已复制。POST JSON：{"text":"内容","title":"标题","url":"https://…","duration":30}，duration 为停留秒数（0=点击前一直显示）。') },
    { type: 'button', label: '重置 Webhook token', title: '旧地址立即失效', run: () => { update('settings', { webhookToken: crypto.randomUUID().replace(/-/g, '') }); windowView({ title: 'Webhook', msg: 'token 已重置，请重新复制地址。' }) } },
  ]
}

function setOpacity(v: number): void {
  const o = Math.round(Math.min(Math.max(v, 0.1), 1) * 10) / 10
  update('settings', { opacity: o })
  document.body.style.setProperty('--opacity', String(o))
}
document.body.style.setProperty('--opacity', String(save.settings.opacity))

/** High-resolution assets; open windows keep their frames until reopened. */
function setHd(on: boolean): void {
  update('settings', { hd: on })
  document.body.classList.toggle('hd', on)
}
document.body.classList.toggle('hd', save.settings.hd)

/** The main process zooms the page and reports the new zoom with the next cursor; the pet is rescaled there. */
function setZoom(v: number): void {
  update('settings', { zoom: Math.round(Math.min(Math.max(v, 1), 2) * 10) / 10 })
}

/** Brings a lost pet back on screen. */
function homing(): void {
  setInfo('lastX', 100)
  setInfo('lastY', innerHeight * 0.6)
  // On start: an interrupted hide ends, and hides the pet, right before.
  wakeFromHidden()
  speak({ s: '[host],我在这里~', now: true }, 'appear', { start: () => setHidden(false) })
}

function toggleAutoStart(): void {
  if (window.qqpet.capabilities?.autoStart === false) {
    windowView({ title: '开机自启', msg: window.qqpet.capabilities.autoStartReason || '此平台不支持开机自启，请从应用图标启动宠物。' })
    return
  }
  const on = !save.settings.autoStart
  window.qqpet.setAutoStart(on)
  update('settings', { autoStart: on })
  speak({ c: 'startupSelf', s: on ? 'startupSelfOn' : 'startupSelfOff', now: true }, 'appear')
}

function toggleWatch(kind: 'clipboardWatch' | 'frontWatch', setting: 'clip' | 'watchApp'): void {
  const capabilities = window.qqpet.capabilities
  if (capabilities?.[kind] === false) {
    windowView({ title: setting === 'clip' ? '剪贴板播报' : '前台应用观察', msg: capabilities[kind === 'clipboardWatch' ? 'clipboardWatchReason' : 'frontWatchReason'] || '此宿主尚不提供该能力。' })
    return
  }
  update('settings', { [setting]: !save.settings[setting] })
}

let taps = 0
let tappedAt = 0
/** Five quick taps on the version show or hide the 作弊 tab, like Android's developer options. */
function tapVersion(): void {
  const now = Date.now()
  taps = now - tappedAt < 1000 ? taps + 1 : 1
  tappedAt = now
  if (taps < 5) return
  taps = 0
  update('settings', { cheatTab: !s.cheatTab })
  speak({ s: s.cheatTab ? '[host]，作弊页已显示在设置里~' : '[host]，作弊页已隐藏~', now: true }, 'appear')
}

async function exportSave(): Promise<void> {
  try {
    if (await window.qqpet.exportSave()) speak({ s: '[host],存档导出成功啦~', now: true }, 'speak')
  } catch (e) {
    windowView({ title: '导出存档', msg: `导出失败：${(e as Error).message}` })
  }
}

function importSave(): void {
  windowView({
    title: '导入存档',
    msg: '导入的存档会替换当前宠物（当前存档会备份为 save.json.bak），导入后自动重启，确定吗？',
    ok: (close) => {
      close()
      void window.qqpet.importSave().catch(() => windowView({ title: '导入存档', msg: '这不是有效的QQ宠物存档~' }))
    },
  })
}

async function importPack(): Promise<void> {
  try {
    const v = await window.qqpet.packs!.importPack()
    if (v) packReady(v)
  } catch (e) {
    windowView({ title: '导入内容包', msg: `无法导入：${ipcError(e)}` })
  }
}

function resetPacks(): void {
  void window.qqpet.packs!.info().then(({ content, shell, bundled }) =>
    windowView({
      title: '恢复内置内容',
      // A lite installer has no content of its own (#28): removing the packs brings back its first-run download.
      msg: !bundled
        ? `精简版程序不带宠物内容。将删除已安装的 v${content} 内容包并重启，之后需要重新下载或导入内容包，确定吗？`
        : content === shell
          ? `当前就是程序自带的 v${shell} 内容~`
          : `将删除已安装的 v${content} 内容包，回到程序自带的 v${shell} 内容并重启，确定吗？`,
      ok: bundled && content === shell ? undefined : () => void window.qqpet.packs!.reset().then(() => window.qqpet.packs!.relaunch()),
    }),
  )
}

function rebornAsOther(): void {
  windowView({
    title: '重生为另一个性别~',
    msg: '点击将会清空当前宠物数据，并重生为另一个性别的宠物，请慎重选择',
    ok: () => window.qqpet.resetPet(info.sex === 'GG' ? 'MM' : 'GG'),
  })
}

/** The pet reports the new city's weather right away, so a wrong name shows at once. */
function setCity(v: string): void {
  const city = v.trim()
  update('settings', { weatherCity: city })
  weatherNow().then(
    (t) => speak({ s: t, now: true }, 'speak'),
    () => speak({ s: `[host]，查不到「${city || '当前位置'}」的天气，换个写法试试吧~`, now: true }, 'speak'),
  )
}

/** The AI tab's model list and last result; `redraw` repaints the open panel once a request finishes. */
let models: string[] = []
let draftModel = ''
let aiStatus = ''
let redraw = (): void => {}

const reason = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

async function loadModels(): Promise<void> {
  aiStatus = '正在获取模型列表…'
  redraw()
  try {
    models = await window.qqpet.aiModels({ url: s.aiUrl, key: s.aiKey })
    aiStatus = models.length ? '选择一个模型，选中后会自动测试，通过才会启用' : '接口没有返回模型，请手动填写后点「测试并启用」'
  } catch (e) {
    models = []
    aiStatus = `获取失败：${reason(e)}。请手动填写模型名称后点「测试并启用」`
  }
  redraw()
}

/** A model is saved, and AI turned on, only if it answers. */
async function testModel(name: string): Promise<void> {
  const model = name.trim()
  if (!model) {
    aiStatus = '请先填写模型名称'
    redraw()
    return
  }
  draftModel = model
  update('settings', { aiModel: '' })
  aiStatus = `正在测试 ${model}…`
  redraw()
  try {
    const reply = await window.qqpet.aiChat({ url: s.aiUrl, key: s.aiKey, model }, [{ role: 'user', content: '你好，用一句话打个招呼。' }])
    update('settings', { aiModel: model })
    aiStatus = `测试通过，已启用。回复：${reply.slice(0, 60)}`
  } catch (e) {
    aiStatus = `测试失败：${reason(e)}`
  }
  redraw()
}

/** Changing where to connect turns AI off until a model passes the test again. The typed name stays. */
const setAi = (patch: { aiUrl?: string; aiKey?: string }): void => {
  if (!draftModel) draftModel = s.aiModel
  update('settings', { ...patch, aiModel: '' })
  models = []
  aiStatus = ''
}

function closeAi(): void {
  draftModel = ''
  models = []
  aiStatus = ''
  update('settings', { aiModel: '' })
}

const aiOptions = (): Option[] => [
  { type: 'input', label: '接口地址（OpenAI 兼容，以 /v1 结尾）', value: () => s.aiUrl, set: (v) => setAi({ aiUrl: v.trim() }) },
  { type: 'input', label: 'API Key（本地服务可不填）', value: () => s.aiKey, set: (v) => setAi({ aiKey: v.trim() }) },
  { type: 'input', label: '模型名称（不支持列表的接口请直接填写）', value: () => draftModel, set: (v) => { draftModel = v.trim() } },
  { type: 'button', label: '获取模型列表', run: () => void loadModels() },
  { type: 'button', label: '测试并启用', run: () => void testModel(draftModel) },
  ...models.map((m): Option => ({ type: 'radio', label: m, on: () => s.aiModel === m, run: () => void testModel(m) })),
  { type: 'see', label: '状态', value: aiStatus || (s.aiModel ? `已启用：${s.aiModel}` : '未启用') },
  ...(s.aiModel ? [{ type: 'button' as const, label: '关闭 AI', run: closeAi }] : []),
  // 联网搜索是 AI 能力的一部分，放 AI 设置里
  { type: 'radio', label: '联网搜索（问它"查一下"时联网搜）', title: '聊天时它需要查证或实时信息，会先联网搜再据实回答；都搜不到就老实说没搜到。', on: () => s.search, run: () => update('settings', { search: !s.search }) },
  { type: 'radio', label: '搜索后端：免 key（DuckDuckGo→Bing 兜底）', title: '不需要任何 key，开箱即用；但可能被限流、结果质量一般。', on: () => s.searchBackend === 'auto', run: () => update('settings', { searchBackend: 'auto' }) },
  { type: 'radio', label: '搜索后端：Tavily', title: '正规搜索 API，质量高、稳定，需在下方填 API Key。', on: () => s.searchBackend === 'tavily', run: () => update('settings', { searchBackend: 'tavily' }) },
  { type: 'radio', label: '搜索后端：Brave', title: 'Brave 搜索 API，需在下方填 API Key。', on: () => s.searchBackend === 'brave', run: () => update('settings', { searchBackend: 'brave' }) },
  { type: 'input', label: '搜索 API Key（免 key 模式留空）', value: () => s.searchKey, set: (v) => update('settings', { searchKey: v.trim() }) },
]

const FACE_TIP = '使用互动动作：鼠标放入宠物范围0.3s后（手机上点一下宠物），开启点位可进行点击~'
const s = save.settings

type Tab = { label: string; options: Option[]; render?: (redraw: () => void) => HTMLElement[] }
const head = (label: string): Option => ({ type: 'head', label })


let draftWebdavPass = ''
let webdavPassSet = false

function webdavSyncedLabel(): string {
  const t = s.webdavSyncedAt
  if (!t) return '尚未同步'
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

async function runWebdavTest(): Promise<void> {
  if (!window.qqpet.webdavTest) return
  const r = await window.qqpet.webdavTest()
  windowView({ title: 'WebDAV', msg: r.ok ? '连接成功。探测文件已读写。建议使用 https:// 与网盘应用密码。' : `连接失败：${r.error}` })
}

async function runWebdavSync(): Promise<void> {
  if (!window.qqpet.webdavSync) return
  const r = await window.qqpet.webdavSync()
  if (!r.ok) {
    windowView({ title: 'WebDAV', msg: `同步失败：${r.error}` })
    return
  }
  windowView({ title: 'WebDAV', msg: r.message })
}

function webdavOptions(): Option[] {
  if (!window.qqpet.webdavSync) return []
  const opts: Option[] = [
    head('WebDAV 同步'),
    {
      type: 'radio',
      label: '开启 WebDAV 进度同步（跨设备接力）',
      title: '把存档与对话记忆同步到 Nextcloud / 群晖等 WebDAV。建议 https://，并用应用密码。拉取前会备份本机 save.json.bak。',
      on: () => s.webdav,
      run: () => update('settings', { webdav: !s.webdav }),
    },
  ]
  if (!s.webdav) return opts
  return [
    ...opts,
    {
      type: 'input',
      label: 'WebDAV 地址（建议 https://…/remote.php/dav/files/用户）',
      value: () => s.webdavUrl,
      set: (v) => update('settings', { webdavUrl: v.trim() }),
    },
    {
      type: 'input',
      label: '用户名',
      value: () => s.webdavUser,
      set: (v) => update('settings', { webdavUser: v.trim() }),
    },
    {
      type: 'input',
      label: '密码 / 应用密码（仅存本机，不同步到网盘）',
      value: () => draftWebdavPass || (webdavPassSet || s.webdavPass ? '••••••••' : ''),
      set: (v) => {
        if (v === '••••••••') return
        draftWebdavPass = v
        if (v) {
          webdavPassSet = true
          if (window.qqpet.webdavSetPass) window.qqpet.webdavSetPass(v)
          else update('settings', { webdavPass: v })
          draftWebdavPass = ''
        }
      },
    },
    {
      type: 'input',
      label: '远程目录（默认 QQPet，请先在网盘建好）',
      value: () => s.webdavPath || 'QQPet',
      set: (v) => update('settings', { webdavPath: v.trim() || 'QQPet' }),
    },
    {
      type: 'radio',
      label: '自动同步（启动时 + 存档变更后）',
      title: '启动时若远程更新则拉取并重启；平时有实质进度变更约 20 秒后上传。',
      on: () => s.webdavAuto,
      run: () => update('settings', { webdavAuto: !s.webdavAuto }),
    },
    { type: 'see', label: '上次同步', value: webdavSyncedLabel() },
    { type: 'button', label: '测试连接', title: '创建探测文件并读回，确认账号与目录可写', run: () => void runWebdavTest() },
    { type: 'button', label: '立即同步', title: '按时间戳与设备 ID 决胜；拉取会先备份本机存档', run: () => void runWebdavSync() },
  ]
}

function archiveOptions(): Option[] {
  return [
    head('存档'),
    { type: 'button', label: '导出存档', title: '把当前宠物保存成一个文件，可用于备份或换电脑', run: exportSave },
    { type: 'button', label: '导入存档（支持原版 config.json）', title: '用存档文件替换当前宠物，导入后自动重启', run: importSave },
    {
      type: 'button',
      label: '清除宠物的记忆',
      title: '清空 memory.md 里的长期记忆；对话历史一并清除',
      run: () => {
        forgetMemory()
        void window.qqpet.memHistory?.([])
        speak({ s: '[host]，我把以前的事都忘掉啦~', now: true, ai: false }, 'speak')
      },
    },
    ...webdavOptions(),
    ...(window.qqpet.packs
      ? ([
          head('内容包'),
          { type: 'button', label: '导入内容包…', title: '安装 .qqpetpack 内容包（新素材），不用重装程序；导入后重启生效', run: importPack },
          { type: 'button', label: '恢复内置内容', title: '删除已导入或下载的内容包，回到程序自带的素材，重启后生效', run: resetPacks },
        ] satisfies Option[])
      : []),
  ]
}


const TABS: Tab[] = [
  {
    label: '全局设置',
    get options(): Option[] {
      return [
        head('宠物'),
        { type: 'button', label: '宠物不见了？点我试试', run: homing },
        { type: 'radio', label: '开机自启', title: '仅 Windows、macOS 和 Android 有效', on: () => s.autoStart, run: toggleAutoStart },
        { type: 'radio', label: '开启免打扰模式', on: () => s.quiet, run: () => update('settings', { quiet: !s.quiet }) },
        { type: 'input', label: '天气城市（留空按网络位置自动定位）', value: () => s.weatherCity, set: setCity },
        { type: 'button', label: '重生~~~（注意数据丢失）', run: readopt },
        { type: 'button', label: '重生为另一个性别~~~（注意数据丢失）', run: rebornAsOther },
        head('显示'),
        { type: 'slider', label: '透明度', value: () => s.opacity, step: (d) => setOpacity(s.opacity + d) },
        // Only the desktop host zooms the page; touch hosts already fit the screen.
        ...(pageZoom() === null
          ? []
          : [{ type: 'slider', label: '界面缩放（宠物和所有窗口一起放大）', value: () => s.zoom - 1, step: (d) => setZoom(s.zoom + d) } satisfies Option]),
        ...(windowDirectionAvailable() ? [
          { type: 'radio', label: '窗口方向：跟随屏幕', title: '保持窗口朝向与屏幕一致，空间不足时缩小', on: () => s.windowDirection === 'screen', run: () => update('settings', { windowDirection: 'screen' }) },
          { type: 'radio', label: '窗口方向：自动选择最大显示方向', title: '选择窗口能显示得更大的方向（默认）', on: () => s.windowDirection === 'auto', run: () => update('settings', { windowDirection: 'auto' }) },
        ] satisfies Option[] : []),
        { type: 'radio', label: '开启高清画质', title: '高清托盘图标与窗口边框，新打开的窗口生效；高清界面素材重启后生效', on: () => s.hd, run: () => setHd(!s.hd) },
        head('互动与玩法'),
        {
          type: 'radio',
          label: '是否开启互动动作(开启后会导致点击位置不可进行宠物移动~)',
          title: FACE_TIP,
          on: () => s.faceClick > 0,
          run: () => setFaceClick(s.faceClick ? 0 : 1),
        },
        { type: 'radio', label: '是否开启互动动作指示器', title: FACE_TIP, on: () => s.faceClick === 2, run: () => setFaceClick(s.faceClick === 2 ? 1 : 2) },
        {
          type: 'radio',
          label: '标准难度（元宝收入降为 40%，默认关=轻松）',
          title: '轻松：保持现有的元宝收入；标准：打工、小游戏、钓鱼、农场、邮件礼物等收入只有 40%（至少 1），物价不变。作弊获得的不受影响。',
          on: () => s.difficulty === 'standard',
          run: () => update('settings', { difficulty: s.difficulty === 'standard' ? 'easy' : 'standard' }),
        },
        {
          type: 'radio',
          label: '点宠物时显示动作栏',
          title: '关掉后点宠物不再弹出日常、交互、工具等按钮，不挡视野；功能仍可从右键/长按宠物或托盘（手机通知栏「菜单」）打开',
          on: () => s.petBar,
          run: () => update('settings', { petBar: !s.petBar }),
        },
        { type: 'radio', label: '随机走动（默认关，贴边不走）', title: '站立闲着时，走动、问候、动画三者随机抽。贴边探头不走。', on: () => s.roam, run: () => update('settings', { roam: !s.roam }) },
        {
          type: 'radio',
          label: '局域网联机（默认关）',
          title: '同一局域网（含 Radmin 等虚拟局域网）内的好友宠物自动互相发现，上线下线互相播报；之后的串门传话也走这里。关闭后完全隐身，不收发任何消息。',
          on: () => s.lan,
          run: () => update('settings', { lan: !s.lan }),
        },
        head('联网'),
        ...(window.qqpet.onWebhook ? webhookOptions() : []),
        head('对话与声音'),
        {
          type: 'radio',
          label: '语音对话',
          title: '松开后本地识别（Paraformer 模型随包，全程离线），识别结果当作聊天内容走同一套对话。',
          on: () => s.voice,
          run: () => update('settings', { voice: !s.voice }),
        },
        { type: 'see', label: '说话键', value: `${hotkeyLabel(DEFAULT_HOTKEY)}后按住说话` },
        {
          type: 'radio',
          label: '对话记忆（重启后仍记得你说过的话）',
          title: '记忆存在本地 memory.md 与 chat-history.json，可随时清除；关闭后既不学习也不使用记忆。',
          on: () => s.memory,
          run: () => update('settings', { memory: !s.memory }),
        },
        {
          type: 'radio',
          label: '台词润色（关 = 原版台词原汁原味）',
          title: '开启时闲置闲聊由 AI 发挥、日常台词经 AI 润色；关闭后全部念原版台词库。聊天对话不受影响。',
          on: () => s.polish,
          run: () => update('settings', { polish: !s.polish }),
        },
        {
          type: 'radio',
          label: '开启宠物音效（贴边探头、点脸逗它）',
          title: '关掉只是宠物不出声：贴边探头的「嘿嘿嘿」、点脸逗它的语音等。企鹅岛社区的背景音乐不受影响，游戏窗口自己的音效也不受影响。',
          on: () => s.sound,
          run: () => {
            update('settings', { sound: !s.sound })
            applyPetSound()
          },
        },
        {
          type: 'slider',
          label: `社区音量：${Math.round(s.music * 100)}%（0静音）`,
          title: '调整企鹅岛社区的背景音乐和音效，立即生效并自动保存。',
          value: () => s.music,
          step: (d) => update('settings', { music: Math.round(Math.min(1, Math.max(0, s.music + d)) * 10) / 10 }),
        },
      ]
    },
  },
  { label: '贴心宝贝', options: [], render: sweetSection },
  {
    label: '存档',
    get options() {
      return archiveOptions()
    },
  },
  {
    label: '工具',
    options: [
      { type: 'radio', label: '实时监听播报剪切板', title: '复制文字后，宠物会把它念出来', on: () => s.clip, run: () => toggleWatch('clipboardWatch', 'clip') },
      { type: 'radio', label: '留意前台在用的软件（仅电脑，默认关）', title: '同一软件开太久，闲聊时可能会提起。不读窗口内容。', on: () => s.watchApp, run: () => toggleWatch('frontWatch', 'watchApp') },
    ],
  },
  { label: '作弊', options: [], render: cheatSection },
  {
    label: 'AI',
    get options() {
      return aiOptions()
    },
  },
  {
    label: '关于',
    options: [
      { type: 'see', label: '软件', value: `QQPet v${APP_VERSION}`, run: tapVersion },
      { type: 'button', label: '检查更新', title: '有新版本时打开 GitHub 下载页', run: () => void checkUpdate(true) },
      { type: 'radio', label: '每天自动检查更新', on: () => s.autoUpdate, run: () => update('settings', { autoUpdate: !s.autoUpdate }) },
      { type: 'see', label: '简介', value: description },
      { type: 'see', label: '作者', value: 'Ankio' },
      { type: 'see', label: '邮箱', value: 'ankio@ankio.net' },
      { type: 'see', label: '项目地址', value: 'https://github.com/AnkioTomas/qqpet' },
      { type: 'see', label: '声明', value: 'QQ 宠物相关素材版权归腾讯所有，本项目仅供学习交流，请勿用于商业用途' },
    ],
  },
]

function option(o: Option, redraw: () => void): HTMLElement {
  const act = (f: () => void) => (): void => {
    f()
    redraw()
  }
  let el: HTMLElement
  if (o.type === 'head') return div('sh3', o.label)
  if (o.type === 'radio') el = check(o.label, o.on(), act(o.run))
  else if (o.type === 'slider') {
    const fill = div('fill')
    fill.style.width = `${Math.round(o.value() * 100)}%`
    el = div('sslider', div('t', o.label), div('line', btn('−', act(() => o.step(-0.1)), false, 'mini'), div('track', fill), btn('+', act(() => o.step(0.1)), false, 'mini')))
  } else if (o.type === 'button') el = div('sbuttonrow', btn(o.label, o.run))
  else if (o.type === 'input') {
    const input = typeable(Object.assign(document.createElement('input'), { className: 'sinput', value: o.value() }))
    input.addEventListener(
      'change',
      act(() => o.set(input.value)),
    )
    el = div('sfield wide', div('k', o.label), input)
  } else {
    el = div('ssee', div('k', o.label), div('v', o.value))
    if (o.run) el.addEventListener('click', act(o.run))
  }
  if (o.title) {
    el.title = o.title
    // Touch has no hover: the tip shows under the option.
    el.append(div('stip', o.title))
  }
  return el
}

let close = (): void => {}

export function openSetup(): void {
  close()
  if (!draftModel) draftModel = s.aiModel
  void window.qqpet.webdavStatus?.().then((st) => {
    if (st.hasSecret) webdavPassSet = true
  })
  // By label: showing the 作弊 tab shifts the tabs after it.
  let tab = TABS[0].label
  const nav = div('snav')
  const title = div('shead')
  const body = div('sbody')
  let root: HTMLElement | undefined
  // Pink with 粉钻 like openBox's vip skin, gold otherwise; re-checked on every draw (作弊) and live tick (expiry).
  const skin = (): void => void root?.classList.toggle('vip', Boolean(info.pinkDiamond))
  const draw = (): void => {
    skin()
    const tabs = TABS.filter((t) => t.label !== '作弊' || s.cheatTab)
    const current = tabs.find((t) => t.label === tab) ?? tabs[0]
    tab = current.label
    const pick = (label: string) => (): void => {
      tab = label
      body.scrollTop = 0
      draw()
    }
    nav.replaceChildren(...tabs.map((t) => button(t === current ? 'stab focusPress on' : 'stab focusPress', pick(t.label), t.label)))
    title.textContent = current.label
    const scroll = body.scrollTop
    body.replaceChildren(...(current.render ? current.render(draw) : current.options.map((o) => option(o, draw))))
    body.scrollTop = scroll
  }
  draw()
  redraw = draw
  // Custody and the stats move on their own: refresh the live lines, and the whole 贴心宝贝 page when its queue moves.
  const offCustody = onCustodyChange(() => {
    if (tab === '贴心宝贝' && !body.querySelector('.ssel.open')) draw()
  })
  // The care log grows on its own too; redraw the page for it unless the user is mid-edit.
  let seenLog = save.saveJsonData.careLog
  const timer = window.setInterval(() => {
    refreshLive()
    skin()
    if (save.saveJsonData.careLog === seenLog) return
    seenLog = save.saveJsonData.careLog
    const busy = body.querySelector('.ssel.open') || body.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT'
    if (tab === '贴心宝贝' && !busy) draw()
  }, 3000)
  let directionChoice = windowDirectionAvailable()
  const refreshDirection = (): void => {
    const next = windowDirectionAvailable()
    if (next === directionChoice) return
    directionChoice = next
    if (tab === TABS[0].label) draw()
  }
  addEventListener('resize', refreshDirection)
  const orientation = window.screen.orientation
  orientation?.addEventListener('change', refreshDirection)
  // A title bar with the window's name and the same close button as the 宠物资料 window.
  const bar = div('stbar', div('stname', '系统设置'), button('sclose focusPress', () => close(), ''))
  const panel = div('spanel', bar, div('srow', nav, div('smain', title, body)))
  // Windows sends the mouse wheel to the focused window only; the pet window is born unfocusable, and focus() at open
  // time loses to the foreground lock. A click in the panel is the user's own input, so focusing then is allowed.
  panel.addEventListener('pointerdown', () => window.qqpet.setFocusable(true))
  root = div('ui-setup2', panel)
  skin()
  const remove = openFrame(root)
  // The AI tab re-draws its option list (and its live input) while requests run; keep the
  // window a keyboard target for the whole panel so typing survives those re-draws.
  window.qqpet.setFocusable(true)
  close = (): void => {
    removeEventListener('resize', refreshDirection)
    orientation?.removeEventListener('change', refreshDirection)
    offCustody()
    window.clearInterval(timer)
    window.qqpet.setFocusable(false)
    remove()
    close = () => {}
  }
}
