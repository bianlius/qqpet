// Save format of the original Arctic Penguin T800 (`petInfoData` in its
// config.json). Field names, including the misspelled `petComputedlInfo`, are
// kept verbatim so old saves load without translation.

export type Sex = 'GG' | 'MM'

export interface PetInfo {
  name: string
  host: string
  sex: Sex
  growth: number
  hunger: number
  clean: number
  /** 0 (dead) .. 5 (healthy) */
  health: number
  /** 0 .. 1000 */
  mood: number
  /** unix seconds */
  birthDay: number
  intel: number
  charm: number
  strong: number
  onLineTime: number
  lastX: number
  lastY: number
  /** 元宝 */
  yb: number
  /** 钻石: the free premium currency that stands in for the original's Q币 (#75). */
  diamond: number
  lastLoginTime: number
  onlineDataTime: number
  pinkDiamond: boolean
  PDgrowth: number
  PDgrowthValue: number
  PDgrowthValue_next: number
  PDiamondLevel: number
  PDiamondBeginDate: number
  PDiamondExpirationDate: number
  /** The running membership includes a yearly purchase. */
  PDiamondYear: boolean
  sweetHeart: boolean
  sweetHeartOverTime: number
}

export interface PetComputedInfo {
  level: number
  upGrowth: number
  nextGrowth: number
  hungerMax: number
  cleanMax: number
  healthMax: number
  moodMax: number
}

export interface StudyInfo {
  chinese: number
  mathematics: number
  politics: number
  music: number
  art: number
  manner: number
  pe: number
  labouring: number
  wushu: number
}

/** In-progress activity per kind, or null when idle. Shape is owned by the renderer. */
export type ActiveOption = Record<'work' | 'study' | 'trip' | 'ill' | 'die', unknown>

/** Inventory entries are encoded as `_<goodsId>*<count>`. */
export type SelfGoodDatas = Record<
  'food' | 'clean' | 'medicine' | 'background' | 'toy' | 'nums' | 'service' | 'work' | 'study' | 'trip',
  string[]
>

/** Timed goods in effect (`selfGoodUseOption` in the original's localStorage). */
export type SelfGoodUseOption = Record<'background' | 'food' | 'clean' | 'toy', { id: string; left: number } | null>

export interface GameSaveDatas {
  fishing_harvestfish: number
  /** Provinces visited and how often. */
  travel_china: { name: string; value: number }[]
  travel_china_num: number
  ddw: number
  yyds: number
}

/** Menu and settings panel options (kept in the original's localStorage). */
export interface Settings {
  /** Pet, control bar and window opacity, 0..1. */
  opacity: number
  /** 企鹅岛社区 master volume (music and effects), 0..1; 0 mutes the community. */
  music: number
  /**
   * Pet voices: the edge-peek 嘿嘿嘿 and the face-poke lines. Only the pet is muted;
   * 企鹅岛社区 keeps its own `music`, and the game windows keep their own sound.
   */
  sound: boolean
  /** Face spots: 0 off, 1 on, 2 on and marked. */
  faceClick: 0 | 1 | 2
  /** Do-not-disturb: no speech bubbles. */
  quiet: boolean
  autoStart: boolean
  paused: boolean
  hidden: boolean
  /** High-resolution assets: @2x tray icons and SVG window frames. */
  hd: boolean
  /** Desktop page zoom, 1 to 2: the pet and every panel grow together. */
  zoom: number
  /** Narrow rotatable screens: maximise panel size automatically, or follow the screen's direction. */
  windowDirection: 'auto' | 'screen'
  /** The pet reads out text copied to the clipboard. */
  clip: boolean
  /** After the same desktop app stays in front for a while, idle talk may mention it. Off by default. */
  watchApp: boolean
  /** Randomly walk around the desktop. Off by default. */
  roam: boolean
  /** Friend LAN presence and visits; off by default. */
  lan: boolean
  /** Local webhook: external services POST to 127.0.0.1:webhookPort/hook?token=… and the pet speaks it. Desktop only; off by default. */
  webhook: boolean
  webhookPort: number
  /** Shared secret of the webhook; made when the webhook is first switched on. */
  webhookToken: string
  /** The talk key (double-tap left Alt, then hold) feeds local speech-to-text. */
  voice: boolean
  /** 对话记忆：跨重启记得主人说过的话，事实存本地 memory.md。 */
  memory: boolean
  /** 台词润色：闲聊/问候经 AI 改写；关闭则原版台词原样念。 */
  polish: boolean
  /** 联网搜索：聊天需要查证/实时信息时，先联网搜再据实回答。 */
  search: boolean
  /** 搜索后端：auto=免 key（DDG→Bing 兜底），tavily/brave=自填 key 的正规 API。 */
  searchBackend: 'auto' | 'tavily' | 'brave'
  /** 搜索 API Key（后端选 tavily/brave 时用；免 key 模式留空）。 */
  searchKey: string
  /** Pressing the pet shows the action bar. On by default. */
  petBar: boolean
  /** easy: 元宝 income as is (default); standard: income scaled down (see `earnYb`). */
  difficulty: 'easy' | 'standard'
  /** Chat cheats (元宝+N, 不要死, ...) are recognised. On by default. */
  chatCheat: boolean
  /** The settings' 作弊 tab is shown; tapping the version 5 times toggles it. Off by default. */
  cheatTab: boolean
  /** Chat cheat 不要死: the pet revives on the spot whenever it dies. */
  undying: boolean
  /** OpenAI-compatible endpoint; `aiModel` is set only once it passed the settings test, and AI is off while it is empty. */
  aiUrl: string
  aiKey: string
  aiModel: string
  /** City for weather news; empty locates by IP. */
  weatherCity: string
  /** Look for a new release once a day. On by default. */
  autoUpdate: boolean
  /** Unix seconds of the last automatic release check. */
  updateCheckedAt: number
  /** Desktop display holding the pet. Null starts on the primary display. */
  petDisplayId: number | null
  /** WebDAV 进度同步：跨设备接力同一只宠物（存档 + 对话记忆）。 */
  webdav: boolean
  /** WebDAV 根地址，建议 https://…（Nextcloud / 群晖等）。 */
  webdavUrl: string
  webdavUser: string
  /** 应用密码；上传存档时会抹掉，只留在本机。 */
  webdavPass: string
  /** 远程目录名，默认 QQPet。 */
  webdavPath: string
  /** 启动时自动同步；有实质存档变更后也会防抖上传。 */
  webdavAuto: boolean
  /** 本安装稳定 id，用于冲突决胜；不随拉取覆盖。 */
  webdavDeviceId: string
  /** 本机进度时间戳（毫秒），有实质变更时刷新。 */
  webdavTouchedAt: number
  /** 上次成功同步的 Unix 毫秒。 */
  webdavSyncedAt: number
}

export interface SaveData {
  havePet: boolean
  isBury: boolean
  saveNum: number
  nowTimeLine: number
  petInfo: PetInfo
  petComputedlInfo: PetComputedInfo
  studyInfo: StudyInfo
  activeOption: ActiveOption
  selfGoodDatas: SelfGoodDatas
  /** Minutes left per timed good. */
  selfGoodUseOption: SelfGoodUseOption
  gameSaveDatas: GameSaveDatas
  illustrated: unknown[]
  /** Feature-owned JSON blobs (email, task, signin, fishs), stored as strings. */
  saveJsonData: Record<string, string>
  settings: Settings
}

/** Object-valued groups are merged field by field; everything else is replaced. */
export type SavePatch = {
  [K in keyof SaveData]?: SaveData[K] extends unknown[] ? SaveData[K] : SaveData[K] extends object ? Partial<SaveData[K]> : SaveData[K]
}
