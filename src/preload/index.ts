import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type QQPetApi } from '../shared/ipc'

const send =
  (channel: string) =>
  (arg?: unknown): void =>
    ipcRenderer.send(channel, arg)

const api: QQPetApi = {
  load: () => ipcRenderer.invoke(IPC.load),
  save: send(IPC.save),
  resetPet: send(IPC.resetPet),
  exportSave: () => ipcRenderer.invoke(IPC.exportSave),
  importSave: () => ipcRenderer.invoke(IPC.importSave),
  openGame: send(IPC.openGame),
  calendar: () => ipcRenderer.invoke(IPC.calendar),
  aiModels: (c) => ipcRenderer.invoke(IPC.aiModels, c),
  aiChat: (c, messages) => ipcRenderer.invoke(IPC.aiChat, c, messages),
  webSearch: (query) => ipcRenderer.invoke(IPC.webSearch, query),
  weather: (city) => ipcRenderer.invoke(IPC.weather, city),
  latestRelease: () => ipcRenderer.invoke(IPC.latestRelease),
  packs: {
    info: () => ipcRenderer.invoke(IPC.packInfo),
    importPack: () => ipcRenderer.invoke(IPC.importPack),
    reset: () => ipcRenderer.invoke(IPC.resetPacks),
    find: () => ipcRenderer.invoke(IPC.findPack),
    findFull: (mirror) => ipcRenderer.invoke(IPC.findFullPack, mirror),
    download: (mirror) => ipcRenderer.invoke(IPC.downloadPack, mirror),
    onProgress: (listener) => {
      ipcRenderer.removeAllListeners(IPC.packProgress)
      ipcRenderer.on(IPC.packProgress, (_e, p) => listener(p))
    },
    relaunch: () => ipcRenderer.send(IPC.relaunch),
  },
  quit: send(IPC.quit),
  copyText: send(IPC.copyText),
  openUrl: send(IPC.openUrl),
  setClickThrough: send(IPC.setClickThrough),
  ...(process.platform === 'linux' && { setHitShape: send(IPC.setHitShape) }),
  setAlwaysOnTop: send(IPC.setAlwaysOnTop),
  setFocusable: send(IPC.setFocusable),
  setAutoStart: send(IPC.setAutoStart),
  setTrayState: send(IPC.setTrayState),
  ...(process.platform === 'darwin' && {
    popupTrayMenu: send(IPC.trayMenu),
    onTrayMenuAction: (listener: (action: number) => void) => ipcRenderer.on(IPC.trayMenuAction, (_e, action) => listener(action)),
  }),
  setDragging: (on) => ipcRenderer.invoke(IPC.setDragging, on),
  onCursor: (listener) => ipcRenderer.on(IPC.cursor, (_e, p) => listener(p)),
  onTrayClick: (listener) => ipcRenderer.on(IPC.trayClick, (_e, c) => listener(c)),
  onTrayHoverLeave: (listener) => {
    ipcRenderer.removeAllListeners(IPC.trayHoverLeave)
    ipcRenderer.on(IPC.trayHoverLeave, () => listener())
  },
  onGamePlayed: (listener) => ipcRenderer.on(IPC.gamePlayed, (_e, m) => listener(m)),
  onClipboard: (listener) => ipcRenderer.on(IPC.clipboard, (_e, text) => listener(text)),
  onPresence: (listener) => ipcRenderer.on(IPC.presence, (_e, away) => listener(away)),
  onFront: (listener) => ipcRenderer.on(IPC.front, (_e, name) => listener(name)),
  // The preload outlives page reloads: replace per channel, never stack.
  onLanOnline: (listener) => {
    ipcRenderer.removeAllListeners(IPC.lanOnline)
    ipcRenderer.on(IPC.lanOnline, (_e, p) => listener(p))
  },
  onLanOffline: (listener) => {
    ipcRenderer.removeAllListeners(IPC.lanOffline)
    ipcRenderer.on(IPC.lanOffline, (_e, p) => listener(p))
  },
  onLanMessage: (listener) => {
    ipcRenderer.removeAllListeners(IPC.lanMessage)
    ipcRenderer.on(IPC.lanMessage, (_e, fromId, body) => listener(fromId, body))
  },
  onWebhook: (listener) => {
    ipcRenderer.removeAllListeners(IPC.webhook)
    ipcRenderer.on(IPC.webhook, (_e, m) => listener(m))
  },
  webhookState: () => ipcRenderer.invoke(IPC.webhookState),
  lanSend: (toId, body) => ipcRenderer.invoke(IPC.lanSend, toId, body),
  lanPeers: () => ipcRenderer.invoke(IPC.lanPeers),
  memLoad: () => ipcRenderer.invoke(IPC.memLoad),
  memFacts: (lines) => ipcRenderer.send(IPC.memFacts, lines),
  memRewrite: (lines) => ipcRenderer.send(IPC.memRewrite, lines),
  memDialogueLoad: () => ipcRenderer.invoke(IPC.memDialogueLoad),
  memDialogueSave: (state) => ipcRenderer.send(IPC.memDialogueSave, state),
  memHistory: (turns) => ipcRenderer.send(IPC.memHistory, turns),
  memClear: () => ipcRenderer.send(IPC.memClear),
  voiceAudio: (samples) => ipcRenderer.send(IPC.voiceAudio, samples),
  voicePart: (samples) => ipcRenderer.send(IPC.voicePart, samples),
  onVoicePartial: (listener) => {
    ipcRenderer.removeAllListeners(IPC.voicePartial)
    ipcRenderer.on(IPC.voicePartial, (_e, text) => listener(text))
  },
  onVoiceStart: (listener) => {
    ipcRenderer.removeAllListeners(IPC.voiceStart)
    ipcRenderer.on(IPC.voiceStart, () => listener())
  },
  onVoiceStop: (listener) => {
    ipcRenderer.removeAllListeners(IPC.voiceStop)
    ipcRenderer.on(IPC.voiceStop, () => listener())
  },
  onVoiceText: (listener) => {
    ipcRenderer.removeAllListeners(IPC.voiceText)
    ipcRenderer.on(IPC.voiceText, (_e, text) => listener(text))
  },
  onVoiceError: (listener) => {
    ipcRenderer.removeAllListeners(IPC.voiceError)
    ipcRenderer.on(IPC.voiceError, (_e, message) => listener(message))
  },
  webdavSync: () => ipcRenderer.invoke(IPC.webdavSync),
  webdavTest: () => ipcRenderer.invoke(IPC.webdavTest),
  webdavStatus: () => ipcRenderer.invoke(IPC.webdavStatus),
  webdavSetPass: (pass) => ipcRenderer.send(IPC.webdavSetPass, pass),
}

contextBridge.exposeInMainWorld('qqpet', api)
