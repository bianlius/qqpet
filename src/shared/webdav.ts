// Minimal WebDAV client over a Fetch (Electron net.fetch / mobile native http).
// Prefers GET/PUT so Android & limited stacks work; MKCOL/PROPFIND when available.

import type { Fetch } from './ipc'
import type { SaveData } from './save'

export interface WebDavConfig {
  /** Base URL, e.g. https://cloud.example/remote.php/dav/files/user */
  url: string
  user: string
  pass: string
  /** Remote folder under the base, e.g. /QQPet or QQPet */
  path: string
}

export class WebDavError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'WebDavError'
    this.status = status
  }
}

/** Trim trailing slashes; keep scheme/host/path. */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Join base + remote folder + relative file; folder may be absolute under the DAV root. */
export function joinDav(base: string, folder: string, file = ''): string {
  const root = normalizeBase(base)
  const dir = folder
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  const name = file.replace(/^\/+/, '')
  const parts = [root, dir, name].filter(Boolean)
  return parts.join('/')
}

export function basicAuth(user: string, pass: string): string {
  // TextEncoder + btoa: works in Electron main/renderer and mobile bridges (no Buffer).
  const bytes = new TextEncoder().encode(`${user}:${pass}`)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return `Basic ${btoa(bin)}`
}

export function assertConfig(c: Partial<WebDavConfig>): WebDavConfig {
  const url = (c.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) throw new WebDavError('请填写以 http:// 或 https:// 开头的 WebDAV 地址')
  const user = (c.user ?? '').trim()
  if (!user) throw new WebDavError('请填写 WebDAV 用户名')
  const path = (c.path ?? '').trim() || 'QQPet'
  return { url, user, pass: c.pass ?? '', path }
}

async function dav(
  fetch: Fetch,
  cfg: WebDavConfig,
  method: string,
  file: string,
  body?: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const c = assertConfig(cfg)
  const target = joinDav(c.url, c.path, file)
  const headers: Record<string, string> = {
    Authorization: basicAuth(c.user, c.pass),
    ...extra,
  }
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream'
  let res: Response
  try {
    res = await fetch(target, { method, headers, body })
  } catch (e) {
    throw new WebDavError(`无法连接 WebDAV：${e instanceof Error ? e.message : String(e)}`)
  }
  const text = await res.text().catch(() => '')
  return { status: res.status, body: text }
}

/** Create the remote folder; 405/409/OK mean it already exists. 501 = client/stack cannot MKCOL — caller may still PUT. */
export async function ensureCollection(fetch: Fetch, cfg: WebDavConfig): Promise<void> {
  const { status, body } = await dav(fetch, cfg, 'MKCOL', '', undefined, {})
  if (status === 201 || status === 200 || status === 405 || status === 409 || status === 301 || status === 302) return
  // Mobile HTTP stacks often lack MKCOL; continue and let PUT fail with a clearer error if the folder is missing.
  if (status === 501 || status === 403) return
  if (status >= 400) throw new WebDavError(`创建远程目录失败（HTTP ${status}）${body ? `：${body.slice(0, 120)}` : ''}。请先在网盘（Nextcloud/群晖等）里建好该文件夹，并确认账号有写权限。`, status)
}

export async function getText(fetch: Fetch, cfg: WebDavConfig, file: string): Promise<string | null> {
  const { status, body } = await dav(fetch, cfg, 'GET', file)
  if (status === 404) return null
  if (status >= 400) throw new WebDavError(`下载 ${file} 失败（HTTP ${status}）`, status)
  return body
}

export async function putText(fetch: Fetch, cfg: WebDavConfig, file: string, text: string, contentType = 'application/octet-stream'): Promise<void> {
  const { status, body } = await dav(fetch, cfg, 'PUT', file, text, { 'Content-Type': contentType })
  if (status >= 200 && status < 300) return
  throw new WebDavError(`上传 ${file} 失败（HTTP ${status}）${body ? `：${body.slice(0, 120)}` : ''}`, status)
}

/** Depth-0 PROPFIND; returns true when the path exists. Optional — callers may use GET instead. */
export async function propfindExists(fetch: Fetch, cfg: WebDavConfig, file = ''): Promise<boolean> {
  const { status } = await dav(fetch, cfg, 'PROPFIND', file, undefined, { Depth: '0', 'Content-Type': 'application/xml' })
  if (status === 404) return false
  if (status === 207 || status === 200) return true
  if (status === 405 || status === 501) return false
  if (status >= 400) throw new WebDavError(`PROPFIND 失败（HTTP ${status}）`, status)
  return true
}

/** HTTPS-friendly smoke test: ensure folder, PUT+GET a tiny probe, delete not required. */
export async function testConnection(fetch: Fetch, cfg: WebDavConfig): Promise<void> {
  assertConfig(cfg)
  if (!/^https:\/\//i.test(cfg.url.trim()) && !/^http:\/\/(127\.|localhost)/i.test(cfg.url.trim())) {
    // Soft warning only via message — still attempt; UI copy prefers HTTPS.
  }
  await ensureCollection(fetch, cfg)
  const probe = `.qqpet-probe-${Date.now()}`
  const payload = `qqpet-ok ${Date.now()}`
  await putText(fetch, cfg, probe, payload, 'text/plain')
  const got = await getText(fetch, cfg, probe)
  if (got !== payload) throw new WebDavError('探测文件读写不一致，请检查 WebDAV 权限')
}

// --- sync pack / conflict / once ---

export const SYNC_VERSION = 1 as const

export const REMOTE_FILES = {
  manifest: 'manifest.json',
  save: 'save.json',
  memory: 'memory.md',
  history: 'chat-history.json',
  dialogue: 'dialogue-state.json',
} as const

/** Secrets kept local: never uploaded, restored after a pull when remote blanks them. */
export const SECRET_SETTING_KEYS = ['webdavPass', 'aiKey', 'searchKey', 'webhookToken'] as const

export interface SyncManifest {
  version: typeof SYNC_VERSION
  updatedAt: number
  deviceId: string
  /** Optional byte lengths for sanity checks. */
  files?: Partial<Record<keyof typeof REMOTE_FILES, number>>
}

export interface SyncBundle {
  save: SaveData
  /** Raw memory.md text (may be empty). */
  memory: string
  /** Raw chat-history.json text. */
  history: string
  /** Raw dialogue-state.json text. */
  dialogue: string
}

export type SyncAction = 'push' | 'pull' | 'noop'

export interface SyncDecision {
  action: SyncAction
  reason: string
}

export interface SyncResult {
  action: SyncAction
  reason: string
  remote?: SyncManifest
  localUpdatedAt: number
}

export function redactSave(save: SaveData): SaveData {
  const clone = JSON.parse(JSON.stringify(save)) as SaveData
  for (const k of SECRET_SETTING_KEYS) clone.settings[k] = ''
  return clone
}

/** After pull: keep local secrets / WebDAV password when remote cleared them. */
export function restoreLocalSecrets(remote: SaveData, local: SaveData): SaveData {
  const out = JSON.parse(JSON.stringify(remote)) as SaveData
  for (const k of SECRET_SETTING_KEYS) {
    const loc = local.settings[k]
    if ((!out.settings[k] || out.settings[k] === '') && loc) out.settings[k] = loc
  }
  // Device id is per install — never take the other machine's.
  if (local.settings.webdavDeviceId) out.settings.webdavDeviceId = local.settings.webdavDeviceId
  return out
}

export function buildManifest(updatedAt: number, deviceId: string, bundle: SyncBundle): SyncManifest {
  const saveText = JSON.stringify(redactSave(bundle.save))
  return {
    version: SYNC_VERSION,
    updatedAt,
    deviceId,
    files: {
      save: saveText.length,
      memory: bundle.memory.length,
      history: bundle.history.length,
      dialogue: bundle.dialogue.length,
    },
  }
}

export function parseManifest(text: string | null): SyncManifest | null {
  if (text == null || !text.trim()) return null
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new WebDavError('远程 manifest.json 不是合法 JSON')
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new WebDavError('远程 manifest 格式错误')
  const o = v as Record<string, unknown>
  if (o.version !== SYNC_VERSION) throw new WebDavError(`不支持的同步版本：${String(o.version)}`)
  if (typeof o.updatedAt !== 'number' || !Number.isFinite(o.updatedAt)) throw new WebDavError('manifest 缺少 updatedAt')
  if (typeof o.deviceId !== 'string' || !o.deviceId) throw new WebDavError('manifest 缺少 deviceId')
  return {
    version: SYNC_VERSION,
    updatedAt: o.updatedAt,
    deviceId: o.deviceId,
    files: typeof o.files === 'object' && o.files && !Array.isArray(o.files) ? (o.files as SyncManifest['files']) : undefined,
  }
}

/**
 * Last-write-wins: higher updatedAt wins; equal timestamps break ties by deviceId
 * (lexicographic — deterministic, no silent flip-flop).
 */
export function decideSync(local: SyncManifest, remote: SyncManifest | null): SyncDecision {
  if (!remote) return { action: 'push', reason: '远程尚无存档，上传本机' }
  if (remote.updatedAt > local.updatedAt) return { action: 'pull', reason: '远程更新，拉取覆盖本机（已备份）' }
  if (local.updatedAt > remote.updatedAt) return { action: 'push', reason: '本机更新，上传覆盖远程' }
  if (remote.deviceId === local.deviceId) return { action: 'noop', reason: '已与远程一致' }
  // Same clock, different device: deterministic LWW by deviceId.
  if (remote.deviceId > local.deviceId) return { action: 'pull', reason: '时间戳相同，按 deviceId 采用远程' }
  return { action: 'push', reason: '时间戳相同，按 deviceId 上传本机' }
}

export function parseRemoteSave(text: string): SaveData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new WebDavError('远程 save.json 不是合法 JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WebDavError('远程 save.json 格式错误')
  const save = raw as SaveData
  if (save.havePet !== true) throw new WebDavError('远程存档没有宠物，已拒绝覆盖本机（避免误清空）')
  return save
}

export interface SyncStore {
  /** Current local bundle (save already in memory). */
  loadBundle(): SyncBundle
  /**
   * Apply a pulled bundle. Must backup local save first (save.json.bak pattern).
   * `save` is already secret-merged.
   */
  applyBundle(bundle: SyncBundle): void | Promise<void>
  deviceId(): string
  /** Local progress stamp (settings.webdavTouchedAt). */
  localUpdatedAt(): number
  /** Persist stamp + syncedAt after a successful push/pull. */
  touch(updatedAt: number, syncedAt: number): void
}

async function pushAll(fetch: Fetch, cfg: WebDavConfig, bundle: SyncBundle, man: SyncManifest): Promise<void> {
  await ensureCollection(fetch, cfg)
  const saveText = JSON.stringify(redactSave(bundle.save))
  await putText(fetch, cfg, REMOTE_FILES.save, saveText, 'application/json')
  // Empty local memory (e.g. mobile shells without the chat-memory feature) must not wipe a desktop's facts.
  const keep = async (local: string, file: string, fallback: string): Promise<string> => {
    if (local.trim()) return local
    return (await getText(fetch, cfg, file)) ?? fallback
  }
  const memory = await keep(bundle.memory, REMOTE_FILES.memory, '')
  const history = await keep(bundle.history, REMOTE_FILES.history, '[]')
  const dialogue = await keep(bundle.dialogue, REMOTE_FILES.dialogue, '{"dialogue":[],"sinceMemo":0}')
  await putText(fetch, cfg, REMOTE_FILES.memory, memory, 'text/markdown; charset=utf-8')
  await putText(fetch, cfg, REMOTE_FILES.history, history, 'application/json')
  await putText(fetch, cfg, REMOTE_FILES.dialogue, dialogue, 'application/json')
  const manOut = buildManifest(man.updatedAt, man.deviceId, { ...bundle, memory, history, dialogue })
  await putText(fetch, cfg, REMOTE_FILES.manifest, JSON.stringify(manOut, null, 2), 'application/json')
}

async function pullAll(fetch: Fetch, cfg: WebDavConfig, local: SyncBundle): Promise<SyncBundle> {
  const saveText = await getText(fetch, cfg, REMOTE_FILES.save)
  if (saveText == null) throw new WebDavError('远程缺少 save.json')
  const remoteSave = restoreLocalSecrets(parseRemoteSave(saveText), local.save)
  // Refuse wiping a living local pet with empty-looking remote was already checked in parseRemoteSave.
  if (local.save.havePet && !remoteSave.havePet) throw new WebDavError('远程无宠物，已拒绝覆盖本机')
  const memory = (await getText(fetch, cfg, REMOTE_FILES.memory)) ?? ''
  const history = (await getText(fetch, cfg, REMOTE_FILES.history)) ?? '[]'
  const dialogue = (await getText(fetch, cfg, REMOTE_FILES.dialogue)) ?? '{"dialogue":[],"sinceMemo":0}'
  return { save: remoteSave, memory, history, dialogue }
}

/** One sync round: compare manifests, push or pull. */
export async function syncOnce(fetch: Fetch, cfg: WebDavConfig, store: SyncStore): Promise<SyncResult> {
  assertConfig(cfg)
  const bundle = store.loadBundle()
  if (!bundle.save.havePet) throw new WebDavError('本机还没有宠物，无法同步')
  const localMan: SyncManifest = {
    version: SYNC_VERSION,
    updatedAt: store.localUpdatedAt() || 0,
    deviceId: store.deviceId(),
  }
  await ensureCollection(fetch, cfg)
  const remoteMan = parseManifest(await getText(fetch, cfg, REMOTE_FILES.manifest))
  // First-time local stamp: treat as "now" so we push rather than looking ancient.
  if (!localMan.updatedAt) localMan.updatedAt = Date.now()
  const decision = decideSync(localMan, remoteMan)
  if (decision.action === 'noop') {
    store.touch(localMan.updatedAt, Date.now())
    return { action: 'noop', reason: decision.reason, remote: remoteMan ?? undefined, localUpdatedAt: localMan.updatedAt }
  }
  if (decision.action === 'pull') {
    const pulled = await pullAll(fetch, cfg, bundle)
    await store.applyBundle(pulled)
    const at = remoteMan!.updatedAt
    store.touch(at, Date.now())
    return { action: 'pull', reason: decision.reason, remote: remoteMan!, localUpdatedAt: at }
  }
  // push
  const at = Math.max(localMan.updatedAt, Date.now())
  const man = buildManifest(at, localMan.deviceId, bundle)
  await pushAll(fetch, cfg, bundle, man)
  store.touch(at, Date.now())
  return { action: 'push', reason: decision.reason, remote: man, localUpdatedAt: at }
}

export function formatSyncMessage(r: SyncResult): string {
  const when = new Date(r.localUpdatedAt).toLocaleString('zh-CN', { hour12: false })
  if (r.action === 'push') return `已上传到 WebDAV（${r.reason}）。进度时间：${when}`
  if (r.action === 'pull') return `已从 WebDAV 拉取（${r.reason}）。进度时间：${when}。将重启以加载。`
  return `已与 WebDAV 同步（${r.reason}）。`
}
