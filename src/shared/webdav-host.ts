// Wire WebDAV sync onto a host that already has save + optional extra files + Fetch.

import type { Fetch, QQPetApi } from './ipc'
import type { SaveData, SavePatch } from './save'
import {
  assertConfig,
  testConnection,
  WebDavError,
  formatSyncMessage,
  syncOnce,
  type WebDavConfig,
  type SyncBundle,
  type SyncStore,
} from './webdav'

export interface WebdavHostDeps {
  fetch: Fetch
  getSave: () => SaveData
  /** Merge patch into the live save and persist. */
  patchSave: (patch: SavePatch) => void
  /** Replace save after backing up (save.json.bak). */
  replaceSave: (save: SaveData) => void
  /** Read optional sidecar (memory.md / chat-history.json / …); missing → fallback. */
  readFile: (name: string, fallback: string) => string
  writeFile: (name: string, text: string) => void
  /** Stable per-install id; create once. */
  ensureDeviceId: () => string
  /** After a pull. */
  relaunch: () => void
  /** Optional: persist password outside save.json. */
  storePass?: (pass: string) => void
  loadPass?: (settingsPass: string) => string
}

function cfg(deps: WebdavHostDeps): WebDavConfig {
  const s = deps.getSave().settings
  const pass = deps.loadPass ? deps.loadPass(s.webdavPass) : s.webdavPass
  return assertConfig({ url: s.webdavUrl, user: s.webdavUser, pass, path: s.webdavPath || 'QQPet' })
}

function store(deps: WebdavHostDeps): SyncStore {
  return {
    loadBundle(): SyncBundle {
      return {
        save: deps.getSave(),
        memory: deps.readFile('memory.md', ''),
        history: deps.readFile('chat-history.json', '[]'),
        dialogue: deps.readFile('dialogue-state.json', '{"dialogue":[],"sinceMemo":0}'),
      }
    },
    applyBundle(bundle): void {
      deps.replaceSave(bundle.save)
      deps.writeFile('memory.md', bundle.memory)
      deps.writeFile('chat-history.json', bundle.history || '[]')
      deps.writeFile('dialogue-state.json', bundle.dialogue || '{"dialogue":[],"sinceMemo":0}')
    },
    deviceId: () => deps.ensureDeviceId(),
    localUpdatedAt: () => deps.getSave().settings.webdavTouchedAt || 0,
    touch(updatedAt, syncedAt): void {
      deps.patchSave({ settings: { webdavTouchedAt: updatedAt, webdavSyncedAt: syncedAt } })
    },
  }
}

/** Methods to spread onto window.qqpet. */
export function webdavApi(deps: WebdavHostDeps): Pick<QQPetApi, 'webdavSync' | 'webdavTest' | 'webdavStatus' | 'webdavSetPass'> {
  return {
    async webdavSync() {
      try {
        const s = deps.getSave().settings
        if (!s.webdav) return { ok: false, error: '请先开启 WebDAV 同步' }
        deps.ensureDeviceId()
        const result = await syncOnce(deps.fetch, cfg(deps), store(deps))
        const relaunch = result.action === 'pull'
        if (relaunch) setTimeout(() => deps.relaunch(), 400)
        return { ok: true, message: formatSyncMessage(result), relaunch }
      } catch (e) {
        return { ok: false, error: e instanceof WebDavError ? e.message : String(e) }
      }
    },
    async webdavTest() {
      try {
        await testConnection(deps.fetch, cfg(deps))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof WebDavError ? e.message : String(e) }
      }
    },
    async webdavStatus() {
      const s = deps.getSave().settings
      const pass = deps.loadPass ? deps.loadPass(s.webdavPass) : s.webdavPass
      return {
        enabled: s.webdav,
        syncedAt: s.webdavSyncedAt,
        touchedAt: s.webdavTouchedAt,
        hasSecret: !!pass,
        https: /^https:\/\//i.test(s.webdavUrl.trim()),
      }
    },
    webdavSetPass(pass: string) {
      if (deps.storePass) deps.storePass(pass)
      else deps.patchSave({ settings: { webdavPass: pass } })
    },
  }
}

/** Call after a meaningful pet progress patch when auto-sync is on. */
export function touchWebdavProgress(deps: Pick<WebdavHostDeps, 'getSave' | 'patchSave'>): void {
  if (!deps.getSave().settings.webdav) return
  deps.patchSave({ settings: { webdavTouchedAt: Date.now() } })
}
