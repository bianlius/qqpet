import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { atomicWrite } from './atomic-write'
import { join } from 'node:path'
import type { SaveData, SavePatch, Sex } from '../shared/save'
import { applyPatch, buried, petOf, startSave } from '../shared/save-logic'

// Resolved lazily: a test sidecar swaps userData before the first use, and a
// module-level const would freeze the path from before that swap.
const saveFile = (): string => join(app.getPath('userData'), 'save.json')
// Arctic Penguin T800 kept the same data under `petInfoData` in electron-store.
const LEGACY_FILE = join(app.getPath('appData'), 'Arctic Penguin', 'config.json')

const readJson = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8'))

function read(): Record<string, any> | null {
  const file = saveFile()
  if (existsSync(file)) {
    try {
      return readJson(file)
    } catch (e) {
      // Keep the broken file for manual recovery instead of silently losing the pet.
      const backup = `${file}.corrupt-${Date.now()}`
      renameSync(file, backup)
      console.error(`save file is corrupt, moved to ${backup}:`, e)
      return null
    }
  }
  if (existsSync(LEGACY_FILE)) {
    console.log(`migrating save from ${LEGACY_FILE}`)
    return petOf(readJson(LEGACY_FILE))
  }
  return null
}

function write(data: Record<string, any>): void {
  atomicWrite(saveFile(), JSON.stringify(data))
}

let retry: ReturnType<typeof setTimeout> | undefined
/** A save the file still refuses after the retries stays in memory and is written again shortly, never crashing the app. */
function writeLater(): void {
  clearTimeout(retry)
  retry = undefined
  try {
    write(save)
  } catch (e) {
    console.error('save file is busy, retrying:', e)
    retry = setTimeout(writeLater, 1000)
  }
}

let save: SaveData

export function loadSave(): SaveData {
  save = startSave(read())
  write(save)
  return save
}

export function getSave(): SaveData {
  return save
}

export function patchSave(patch: SavePatch): void {
  applyPatch(save, patch)
  writeLater()
}

export function exportSave(file: string): void {
  writeFileSync(file, JSON.stringify(save, null, 2))
}

/**
 * Replaces the save with the pet in `file`, keeping the current one as save.json.bak;
 * the next launch repairs it. Throws when the file holds no pet.
 */
export function importSave(file: string): void {
  const pet = petOf(readJson(file))
  if (pet.havePet !== true) throw new Error('no pet in this file')
  copyFileSync(saveFile(), `${saveFile()}.bak`)
  write(pet)
}

/** Buries the pet: the next launch starts with egg selection, or with a newborn of `sex`. */
export function resetSave(sex?: Sex): void {
  save = buried(save, sex)
  write(save)
}

/**
 * Replaces the in-memory save and writes it; caller should have copied save.json.bak.
 * Used by WebDAV pull and keeps the same shape as importSave without reading a file.
 */
export function replaceSaveData(data: SaveData): void {
  save = startSave(data as unknown as Record<string, unknown>)
  write(save)
}

