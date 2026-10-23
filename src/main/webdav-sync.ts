// Desktop host for WebDAV progress sync: reads/writes userData files beside save.json.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Fetch } from '../shared/ipc'
import {
  assertConfig,
  testConnection,
  WebDavError,
  formatSyncMessage,
  syncOnce,
  type WebDavConfig,
  type SyncBundle,
  type SyncResult,
  type SyncStore,
} from '../shared/webdav'
import { atomicWrite } from './atomic-write'
import { getSave, patchSave, replaceSaveData } from './save'

const fetchNet: Fetch = (url, init) => net.fetch(url, init)

const memFile = (): string => join(app.getPath('userData'), 'memory.md')
const histFile = (): string => join(app.getPath('userData'), 'chat-history.json')
const dialogueFile = (): string => join(app.getPath('userData'), 'dialogue-state.json')
const saveFile = (): string => join(app.getPath('userData'), 'save.json')
const secretFile = (): string => join(app.getPath('userData'), 'webdav.secret')

function readOr(path: string, fallback: string): string {
  try {
    if (!existsSync(path)) return fallback
    return readFileSync(path, 'utf8')
  } catch {
    return fallback
  }
}

/** Prefer OS-encrypted secret file when safeStorage works; fall back to settings.webdavPass. */
export function loadWebdavPass(settingsPass: string): string {
  try {
    if (safeStorage.isEncryptionAvailable() && existsSync(secretFile())) {
      const buf = readFileSync(secretFile())
      const text = safeStorage.decryptString(buf)
      if (text) return text
    }
  } catch (e) {
    console.error('webdav secret read failed:', e)
  }
  return settingsPass
}

export function storeWebdavPass(pass: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(secretFile(), safeStorage.encryptString(pass))
      // Clear plaintext copy from the save when we have a vault.
      if (getSave().settings.webdavPass) patchSave({ settings: { webdavPass: '' } })
      return
    }
  } catch (e) {
    console.error('webdav secret write failed:', e)
  }
  patchSave({ settings: { webdavPass: pass } })
}

function ensureDeviceId(): string {
  const s = getSave().settings
  if (s.webdavDeviceId) return s.webdavDeviceId
  const id = randomUUID()
  patchSave({ settings: { webdavDeviceId: id } })
  return id
}

function configFromSave(): WebDavConfig {
  const s = getSave().settings
  return assertConfig({
    url: s.webdavUrl,
    user: s.webdavUser,
    pass: loadWebdavPass(s.webdavPass),
    path: s.webdavPath || 'QQPet',
  })
}

function store(): SyncStore {
  return {
    loadBundle(): SyncBundle {
      return {
        save: getSave(),
        memory: readOr(memFile(), ''),
        history: readOr(histFile(), '[]'),
        dialogue: readOr(dialogueFile(), '{"dialogue":[],"sinceMemo":0}'),
      }
    },
    applyBundle(bundle: SyncBundle): void {
      // Keep previous pet as save.json.bak — same pattern as importSave.
      if (existsSync(saveFile())) copyFileSync(saveFile(), `${saveFile()}.bak`)
      replaceSaveData(bundle.save)
      atomicWrite(memFile(), bundle.memory)
      atomicWrite(histFile(), bundle.history || '[]')
      atomicWrite(dialogueFile(), bundle.dialogue || '{"dialogue":[],"sinceMemo":0}')
    },
    deviceId: () => ensureDeviceId(),
    localUpdatedAt: () => getSave().settings.webdavTouchedAt || 0,
    touch(updatedAt: number, syncedAt: number): void {
      patchSave({ settings: { webdavTouchedAt: updatedAt, webdavSyncedAt: syncedAt } })
    },
  }
}

export async function webdavTest(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await testConnection(fetchNet, configFromSave())
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof WebDavError ? e.message : String(e) }
  }
}

export async function webdavSync(): Promise<{ ok: true; result: SyncResult; message: string; relaunch: boolean } | { ok: false; error: string }> {
  try {
    const s = getSave().settings
    if (!s.webdav) return { ok: false, error: '请先开启 WebDAV 同步' }
    ensureDeviceId()
    const result = await syncOnce(fetchNet, configFromSave(), store())
    return {
      ok: true,
      result,
      message: formatSyncMessage(result),
      relaunch: result.action === 'pull',
    }
  } catch (e) {
    return { ok: false, error: e instanceof WebDavError ? e.message : String(e) }
  }
}

/** Bump local progress stamp so the next sync pushes. */
export function markWebdavTouched(): void {
  const s = getSave().settings
  if (!s.webdav) return
  patchSave({ settings: { webdavTouchedAt: Date.now() } })
}

let autoTimer: ReturnType<typeof setTimeout> | undefined
let autoBusy = false

/** Debounced push after a meaningful save (not for display-only tweaks). */
export function scheduleWebdavAuto(): void {
  const s = getSave().settings
  if (!s.webdav || !s.webdavAuto) return
  markWebdavTouched()
  clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    void runAuto('change')
  }, 20_000)
}

async function runAuto(_why: string): Promise<void> {
  if (autoBusy) return
  const s = getSave().settings
  if (!s.webdav || !s.webdavAuto) return
  autoBusy = true
  try {
    const r = await webdavSync()
    if (r.ok) console.log(`[webdav] auto ${r.result.action}: ${r.result.reason}`)
    else console.error('[webdav] auto failed:', r.error)
  } finally {
    autoBusy = false
  }
}

/** Launch-time sync; returns whether the caller should relaunch after a pull. */
export async function webdavSyncOnLaunch(): Promise<boolean> {
  const s = getSave().settings
  if (!s.webdav || !s.webdavAuto) return false
  if (!s.webdavUrl.trim() || !s.webdavUser.trim()) return false
  const r = await webdavSync()
  if (!r.ok) {
    console.error('[webdav] launch sync failed:', r.error)
    return false
  }
  console.log(`[webdav] launch ${r.result.action}: ${r.result.reason}`)
  return r.relaunch
}

export function webdavStatus(): {
  enabled: boolean
  syncedAt: number
  touchedAt: number
  hasSecret: boolean
  https: boolean
} {
  const s = getSave().settings
  return {
    enabled: s.webdav,
    syncedAt: s.webdavSyncedAt,
    touchedAt: s.webdavTouchedAt,
    hasSecret: !!(loadWebdavPass(s.webdavPass) || s.webdavPass),
    https: /^https:\/\//i.test(s.webdavUrl.trim()),
  }
}

