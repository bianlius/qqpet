import { app, clipboard, dialog, ipcMain, net, powerMonitor, session, shell } from 'electron'
import { IPC, type TrayMenuItem, type TrayState } from '../shared/ipc'
import type { SavePatch, Sex } from '../shared/save'
import { aiChat, aiModels } from '../shared/ai'
import { webSearch } from '../shared/websearch'
import { calendar } from '../shared/calendar'
import { latestRelease } from '../shared/update'
import { toShape, type ShapeRect } from '../shared/hit-shape'
import { weather } from '../shared/weather'
import { contentMissing } from './content'
import { openFirstRun, registerPackIpc } from './first-run'
import { relaunch, spawnSelf } from './relaunch'
import { handleScheme, registerScheme } from './protocol'
import { exportSave, getSave, importSave, loadSave, patchSave, resetSave } from './save'
import { createPetTray } from './tray'
import { frontName } from './front'
import { createPetWindow, openGameWindow } from './window'
import { LanNode, persistedLanId } from './lan'
import { WebhookServer } from './webhook'
import { VisitQueue } from './visit-queue'
import { addFacts, clearMemory, loadDialogueState, loadHistory, loadMemory, rewriteFacts, saveDialogueState, saveHistory, type HistoryTurn } from './memory'
import { DEFAULT_HOTKEY, parseHotkey, watchHotkey, type KeyWatcher } from './hotkey'
import { preloadAsr, transcribe } from './asr'
import { scheduleWebdavAuto, storeWebdavPass, webdavStatus, webdavSync, webdavSyncOnLaunch, webdavTest } from './webdav-sync'

// A test sidecar (QQPET_USER_DATA) runs beside the real pet: own save, own id, own lock.
if (process.env.QQPET_USER_DATA) app.setPath('userData', process.env.QQPET_USER_DATA)

// A click-through window on Wayland never learns where the cursor is, and its input region cannot be shaped, so
// nothing on the pet could ever be clicked (#45). Under XWayland, as on X11, an input shape does the hit testing.
// Electron picks the platform (and records it as the ozone-platform switch) before this script runs, so the app
// restarts itself with the switch before taking the single-instance lock (spawnSelf: an AppImage restarts through
// its own file). A platform the user chose on the command line stays.
const toX11 =
  process.platform === 'linux' && !!process.env.DISPLAY && app.commandLine.getSwitchValue('ozone-platform') === 'wayland' &&
  !process.argv.some((a) => a.startsWith('--ozone-platform'))
if (toX11) {
  spawnSelf(['--ozone-platform=x11'])
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) app.exit(0)

registerScheme()

app.whenReady().then(() => {
  handleScheme()
  registerPackIpc()
  // A lite installer's first run: get the pet's content before there is a pet (#28).
  if (contentMissing()) return void openFirstRun()
  app.dock?.hide()
  loadSave()
  // The talk key records locally; nothing else asks for permissions here.
  // The talk key records in the pet window only, and only sound: a game or community page never gets the microphone
  // or the camera. Every other permission keeps Electron's default (granted), as before voice existed.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (permission !== 'media') return cb(true)
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    cb(wc === win.webContents && types.length > 0 && types.every((t) => t === 'audio'))
  })
  // CSS keeps decoded images per stylesheet, so @2x bitmaps follow the hd setting as of launch only.
  if (getSave().settings.hd) {
    session.defaultSession.webRequest.onBeforeSendHeaders((d, cb) => cb({ requestHeaders: { ...d.requestHeaders, 'X-HD': '1' } }))
  }

  const win = createPetWindow()
  const petInit = (): { name: string; host: string; sex: 'GG' | 'MM'; level: number } => {
    const s = getSave()
    return { name: s.petInfo.name, host: s.petInfo.host, sex: s.petInfo.sex, level: s.petComputedlInfo.level }
  }
  const lan = new LanNode(
    { id: persistedLanId(app.getPath('userData')), ...petInit() },
    {
      online: (p) => {
        console.log(`[lan] ${p.name}(${p.host}) 出来玩了`)
        win.webContents.send(IPC.lanOnline, p)
      },
      linked: (id) => {
        // The pet that sat by the door sets off once the path is open.
        for (const body of visits.take(id)) if (!lan.send(id, body)) visits.add(id, body)
      },
      offline: (p) => {
        console.log(`[lan] ${p.name}(${p.host}) 回家了`)
        win.webContents.send(IPC.lanOffline, p)
      },
      message: (fromId, body) => win.webContents.send(IPC.lanMessage, fromId, body),
    },
  )
  // Discovery failing (port taken, firewall) must never take the pet down.
  // The LAN is opt-in (settings.lan), and an unadopted egg stays invisible.
  const visits = new VisitQueue(app.getPath('userData'))
  ipcMain.handle(IPC.lanSend, (_e, toId: string, body: { t?: string }) => {
    // Everything visit-shaped queues while the path is down: a lost visitNo or
    // visitEnd would leave the sender's pet away until the timeout.
    if (body?.t?.startsWith('visit')) {
      if (lan.send(toId, body)) return 'sent' as const
      visits.add(toId, body)
      return 'queued' as const
    }
    lan.send(toId, body)
    return 'sent' as const
  })
  ipcMain.handle(IPC.lanPeers, () => lan.peersList())
  // 对话记忆：渲染层的模型负责提炼，这里只当忠实的本地保管员
  ipcMain.handle(IPC.memLoad, () => ({ memory: loadMemory(), history: loadHistory() }))
  ipcMain.on(IPC.memFacts, (_e, lines: string[]) => {
    if (Array.isArray(lines)) addFacts(lines)
  })
  ipcMain.on(IPC.memRewrite, (_e, lines: string[]) => {
    if (Array.isArray(lines)) rewriteFacts(lines)
  })
  ipcMain.handle(IPC.memDialogueLoad, () => loadDialogueState())
  ipcMain.on(IPC.memDialogueSave, (_e, state) => {
    if (state && Array.isArray(state.dialogue)) saveDialogueState(state)
  })
  ipcMain.on(IPC.memHistory, (_e, turns: HistoryTurn[]) => {
    if (Array.isArray(turns)) saveHistory(turns)
  })
  ipcMain.on(IPC.memClear, () => clearMemory())
  ipcMain.handle(IPC.webdavSync, async () => {
    const r = await webdavSync()
    if (r.ok && r.relaunch) setTimeout(() => relaunch(), 400)
    return r.ok ? { ok: true as const, message: r.message, relaunch: r.relaunch } : r
  })
  ipcMain.handle(IPC.webdavTest, () => webdavTest())
  ipcMain.handle(IPC.webdavStatus, () => webdavStatus())
  ipcMain.on(IPC.webdavSetPass, (_e, pass: string) => {
    if (typeof pass === 'string') storeWebdavPass(pass)
  })
  // 语音：说话键（双击左Alt后按住）→ 渲染层录音 → 本地识别 → 聊天管线
  ipcMain.on(IPC.voiceAudio, (_e, samples: Float32Array) => {
    void transcribe(samples)
      .then((text) => win.webContents.send(IPC.voiceText, text))
      .catch((e: unknown) => win.webContents.send(IPC.voiceError, String((e as Error).message)))
  })
  // 边说边译：每段音频到一半就试译一次，只保一发在途，慢了就跳过这一拍。
  let partBusy = false
  ipcMain.on(IPC.voicePart, (_e, samples: Float32Array) => {
    if (partBusy) return
    partBusy = true
    void transcribe(samples)
      .then((text) => {
        if (text) win.webContents.send(IPC.voicePartial, text)
      })
      .catch(() => {
        /* partials are best-effort; the final pass reports errors */
      })
      .finally(() => (partBusy = false))
  })
  let talkKey: KeyWatcher | undefined
  const startVoice = (): void => {
    if (talkKey) return
    const hot = parseHotkey(DEFAULT_HOTKEY)
    if (!hot) return
    void watchHotkey(hot, (down) => {
      if (!win.isDestroyed()) win.webContents.send(down ? IPC.voiceStart : IPC.voiceStop)
    }).then((w) => {
      if (typeof w === 'string') return console.error('[voice]', w)
      talkKey = w
      preloadAsr()
    })
  }
  const stopVoice = (): void => {
    talkKey?.stop()
    talkKey = undefined
  }
  if (getSave().settings.voice) startVoice()
  let lanOn = false
  const startLan = (): void => {
    if (lanOn || !getSave().settings.lan || !getSave().havePet) return
    lanOn = true
    void lan.start().catch((e) => console.error('lan start failed:', e))
  }
  startLan()
  let webhookError: string | undefined
  const webhook = new WebhookServer((m) => win.webContents.send(IPC.webhook, m))
  const syncWebhook = (): void => {
    const s = getSave().settings
    webhook.stop()
    webhookError = undefined
    if (!s.webhook || !s.webhookToken || !getSave().havePet) return
    webhook.start(s.webhookPort, s.webhookToken).catch((e: NodeJS.ErrnoException) => {
      webhookError = e.code === 'EADDRINUSE' ? `端口 ${s.webhookPort} 已被占用` : String(e.message)
      console.error('webhook start failed:', e)
    })
  }
  syncWebhook()
  ipcMain.handle(IPC.webhookState, () => ({ running: webhook.running, error: webhookError }))
  const tray = createPetTray((click) => {
    let focusTaken = false
    if (process.platform === 'win32' && click.kind === 'state' && getSave().havePet) {
      focusTaken = !win.isFocusable()
      if (focusTaken) win.setFocusable(true)
      win.focus()
    }
    const b = win.getBounds()
    const z = getSave().settings.zoom
    const message = { ...click, focusTaken }
    win.webContents.send(IPC.trayClick, click.x === undefined ? message : { ...message, x: (click.x - b.x) / z, y: (click.y! - b.y) / z })
  }, () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.trayHoverLeave)
  })
  app.on('before-quit', () => {
    tray.destroy()
    lan.stop()
    webhook.stop()
  })
  ipcMain.on(IPC.trayMenu, (event, items: TrayMenuItem[]) => {
    if (event.sender !== win.webContents) return
    tray.popupMenu(items, (action) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.trayMenuAction, action)
    })
  })

  let copied = ''
  void clipboard.readText().then((t) => (copied = t))
  setInterval(async () => {
    const text = await clipboard.readText()
    if (text === copied) return
    copied = text
    if (text.trim() && getSave().settings.clip) win.webContents.send(IPC.clipboard, text)
  }, 500)

  ipcMain.handle(IPC.load, () => getSave())
  ipcMain.on(IPC.save, (_e, patch: SavePatch) => {
    patchSave(patch)
    if (
      patch.petInfo ||
      patch.selfGoodDatas ||
      patch.selfGoodUseOption ||
      patch.studyInfo ||
      patch.gameSaveDatas ||
      patch.saveJsonData ||
      patch.activeOption ||
      patch.petComputedlInfo ||
      patch.havePet !== undefined ||
      patch.illustrated
    ) {
      scheduleWebdavAuto()
    }
    if (patch.petInfo) {
      tray.retip(getSave().petInfo)
      lan.setIdentity(petInit())
      startLan()
    }
    if (patch.settings?.hd !== undefined) tray.setState(getSave())
    if (patch.settings?.zoom !== undefined) win.webContents.setZoomFactor(getSave().settings.zoom)
    if (patch.settings?.watchApp !== undefined) watchFront(getSave().settings.watchApp)
    if (patch.settings?.lan !== undefined) {
      if (patch.settings.lan) startLan()
      else {
        // stop() says goodbye on the way out, so friends hear 回家啦 at once.
        lan.stop()
        lanOn = false
      }
    }
    const hook = patch.settings
    if (hook && (hook.webhook !== undefined || hook.webhookPort !== undefined || hook.webhookToken !== undefined)) syncWebhook()
    if (patch.settings?.voice !== undefined) (patch.settings.voice ? startVoice : stopVoice)()
  })
  ipcMain.on(IPC.resetPet, (_e, sex?: Sex) => {
    resetSave(sex)
    relaunch()
  })
  ipcMain.handle(IPC.exportSave, async () => {
    const day = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(win, { defaultPath: `QQPet-${day}.json`, filters: [{ name: 'QQ宠物存档', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return false
    exportSave(r.filePath)
    return true
  })
  ipcMain.handle(IPC.importSave, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'QQ宠物存档', extensions: ['json'] }] })
    if (r.canceled) return
    importSave(r.filePaths[0])
    relaunch()
  })
  ipcMain.handle(IPC.calendar, () => calendar(net.fetch))
  ipcMain.handle(IPC.aiModels, (_e, c) => aiModels(net.fetch, c))
  ipcMain.handle(IPC.aiChat, (_e, c, messages) => aiChat(net.fetch, c, messages))
  ipcMain.handle(IPC.webSearch, (_e, query: string) => webSearch(net.fetch, query, 6, getSave().settings.searchBackend, getSave().settings.searchKey))
  ipcMain.handle(IPC.weather, (_e, city: string) => weather(net.fetch, city))
  ipcMain.handle(IPC.latestRelease, () => latestRelease(net.fetch))
  // A focusable pet window holds a full panel (社区, 密室...) that would cover a normal game window.
  let panel = false
  ipcMain.on(IPC.openGame, (_e, swf: string) => {
    const start = Date.now()
    // Quitting with a game open closes the pet window first.
    openGameWindow(swf, panel ? win : undefined).on('closed', () => win.isDestroyed() || win.webContents.send(IPC.gamePlayed, (Date.now() - start) / 60000))
  })
  ipcMain.on(IPC.quit, () => app.quit())
  ipcMain.on(IPC.copyText, (_e, text: string) => clipboard.writeText(text))
  ipcMain.on(IPC.openUrl, (_e, url: string) => /^https?:\/\//.test(url) && void shell.openExternal(url))
  // Linux shapes the window's input instead: ignoring the mouse would also hide the cursor from the pet (#45).
  ipcMain.on(IPC.setClickThrough, (_e, on: boolean) => process.platform === 'linux' || win.setIgnoreMouseEvents(on))
  ipcMain.on(IPC.setHitShape, (e, rects: ShapeRect[]) => {
    if (process.platform !== 'linux' || e.sender !== win.webContents || !Array.isArray(rects)) return
    const { width, height } = win.getContentBounds()
    win.setShape(toShape(rects, win.webContents.getZoomFactor(), width, height))
  })
  // Panels that stay open for long (社区) lower the window so other apps can be raised over it.
  let lowered = false
  ipcMain.on(IPC.setAlwaysOnTop, (_e, on: boolean) => {
    lowered = !on
    win.setAlwaysOnTop(on, 'screen-saver')
  })
  ipcMain.on(IPC.setFocusable, (_e, on: boolean) => {
    panel = on
    win.setFocusable(on)
    // macOS draws IME candidates below screen-saver level; drop under them while a panel takes typing.
    if (process.platform === 'darwin') win.setAlwaysOnTop(!lowered, on ? 'floating' : 'screen-saver')
    // The window is born unfocusable; setFocusable alone does not make it key, so IME stays on the previous app.
    if (on) {
      if (process.platform === 'darwin') app.focus({ steal: true })
      win.focus()
    }
  })
  ipcMain.on(IPC.setAutoStart, (_e, on: boolean) => app.setLoginItemSettings({ openAtLogin: on }))
  ipcMain.on(IPC.setTrayState, (_e, state: TrayState) => tray.setState(getSave(), state))

  const AWAY_S = 300
  let away = false
  const presence = (on: boolean): void => {
    if (on === away) return
    away = on
    win.webContents.send(IPC.presence, away)
  }
  setInterval(() => presence(powerMonitor.getSystemIdleTime() >= AWAY_S), 5000)
  powerMonitor.on('lock-screen', () => presence(true))
  powerMonitor.on('unlock-screen', () => presence(false))
  powerMonitor.on('suspend', () => presence(true))
  powerMonitor.on('resume', () => presence(false))

  let frontTimer: ReturnType<typeof setInterval> | undefined
  let lastFront = ''
  const watchFront = (on: boolean): void => {
    clearInterval(frontTimer)
    frontTimer = undefined
    lastFront = ''
    if (!on) return
    const tick = (): void => {
      void frontName().then((name) => {
        if (!name || name === lastFront) return
        lastFront = name
        win.webContents.send(IPC.front, name)
      })
    }
    tick()
    frontTimer = setInterval(tick, 15_000)
  }
  watchFront(getSave().settings.watchApp)
  void webdavSyncOnLaunch().then((need) => {
    if (need) relaunch()
  })
})

app.on('window-all-closed', () => app.quit())
