import assert from 'node:assert/strict'
import test from 'node:test'
import {
  basicAuth,
  joinDav,
  normalizeBase,
  assertConfig,
  WebDavError,
  buildManifest,
  decideSync,
  parseManifest,
  parseRemoteSave,
  redactSave,
  restoreLocalSecrets,
  syncOnce,
  SECRET_SETTING_KEYS,
} from '../../src/shared/webdav.ts'
import { startSave } from '../../src/shared/save-logic.ts'

test('joinDav and auth helpers', () => {
  assert.equal(normalizeBase('https://a/b/'), 'https://a/b')
  assert.equal(joinDav('https://cloud/dav', '/QQPet/', 'save.json'), 'https://cloud/dav/QQPet/save.json')
  assert.equal(joinDav('https://cloud/dav/', 'QQPet', 'manifest.json'), 'https://cloud/dav/QQPet/manifest.json')
  assert.match(basicAuth('u', 'p'), /^Basic /)
  assert.throws(() => assertConfig({ url: 'ftp://x', user: 'a', pass: '', path: '' }), WebDavError)
})

test('redact secrets and restore after pull', () => {
  const local = startSave({ havePet: true, settings: { webdavPass: 'secret', aiKey: 'k', webdavDeviceId: 'dev-a' } })
  const remote = startSave({
    havePet: true,
    petInfo: { ...(local.petInfo), name: '远程宝' },
    settings: { webdavPass: '', aiKey: '', webdavDeviceId: 'dev-b' },
  })
  const redacted = redactSave(local)
  for (const k of SECRET_SETTING_KEYS) assert.equal(redacted.settings[k], '')
  const merged = restoreLocalSecrets(remote, local)
  assert.equal(merged.settings.webdavPass, 'secret')
  assert.equal(merged.settings.aiKey, 'k')
  assert.equal(merged.settings.webdavDeviceId, 'dev-a', 'device id stays local')
  assert.equal(merged.petInfo.name, '远程宝')
})

test('LWW decideSync', () => {
  const a = { version: 1, updatedAt: 100, deviceId: 'aaa' }
  const b = { version: 1, updatedAt: 200, deviceId: 'bbb' }
  assert.equal(decideSync(a, null).action, 'push')
  assert.equal(decideSync(a, b).action, 'pull')
  assert.equal(decideSync(b, a).action, 'push')
  assert.equal(decideSync(a, { ...a }).action, 'noop')
  assert.equal(decideSync(a, { version: 1, updatedAt: 100, deviceId: 'zzz' }).action, 'pull')
  assert.equal(decideSync(a, { version: 1, updatedAt: 100, deviceId: '000' }).action, 'push')
})

test('parseManifest and refuse empty pet', () => {
  assert.equal(parseManifest(null), null)
  const man = buildManifest(1, 'd', {
    save: startSave({ havePet: true }),
    memory: '- fact\n',
    history: '[]',
    dialogue: '{}',
  })
  assert.deepEqual(parseManifest(JSON.stringify(man)).deviceId, 'd')
  assert.throws(() => parseRemoteSave(JSON.stringify({ havePet: false })), /没有宠物/)
})

test('syncOnce push then pull with mock fetch', async () => {
  const remote = new Map()
  const fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(url).split('/').pop()
    if (method === 'MKCOL') return new Response('', { status: 201 })
    if (method === 'PUT') {
      remote.set(path, init.body ?? '')
      return new Response('', { status: 201 })
    }
    if (method === 'GET') {
      if (!remote.has(path)) return new Response('', { status: 404 })
      return new Response(remote.get(path), { status: 200 })
    }
    if (method === 'PROPFIND') return new Response('', { status: 207 })
    return new Response('nope', { status: 405 })
  }

  let save = startSave({ havePet: true, petInfo: { name: '甲' } })
  save.petInfo.name = '甲'
  let memory = '- 喜欢苹果\n'
  let touched = 1000
  const deviceId = 'device-1'
  const store = {
    loadBundle: () => ({ save, memory, history: '[]', dialogue: '{"dialogue":[],"sinceMemo":0}' }),
    applyBundle: (b) => {
      save = b.save
      memory = b.memory
    },
    deviceId: () => deviceId,
    localUpdatedAt: () => touched,
    touch: (u) => {
      touched = u
    },
  }
  const cfg = { url: 'https://example/dav', user: 'u', pass: 'p', path: 'QQPet' }

  const pushed = await syncOnce(fetch, cfg, store)
  assert.equal(pushed.action, 'push')
  assert.ok(remote.has('save.json'))
  assert.ok(remote.has('manifest.json'))
  const uploaded = JSON.parse(remote.get('save.json'))
  assert.equal(uploaded.settings.webdavPass, '', 'password not uploaded')

  // Second device with older stamp pulls.
  let save2 = startSave({ havePet: true, petInfo: { name: '乙' }, settings: { webdavPass: 'keep-me', webdavDeviceId: 'device-2' } })
  save2.petInfo.name = '乙'
  let memory2 = ''
  let touched2 = 500
  const store2 = {
    loadBundle: () => ({ save: save2, memory: memory2, history: '[]', dialogue: '{"dialogue":[],"sinceMemo":0}' }),
    applyBundle: (b) => {
      save2 = b.save
      memory2 = b.memory
    },
    deviceId: () => 'device-2',
    localUpdatedAt: () => touched2,
    touch: (u) => {
      touched2 = u
    },
  }
  const pulled = await syncOnce(fetch, cfg, store2)
  assert.equal(pulled.action, 'pull')
  assert.equal(save2.petInfo.name, '甲')
  assert.equal(save2.settings.webdavPass, 'keep-me')
  assert.equal(memory2, '- 喜欢苹果\n')
})

test('empty local memory does not wipe remote on push', async () => {
  const remote = new Map([
    ['memory.md', '- 远程事实\n'],
    ['chat-history.json', '[]'],
    ['dialogue-state.json', '{"dialogue":[],"sinceMemo":0}'],
    [
      'manifest.json',
      JSON.stringify({ version: 1, updatedAt: 1, deviceId: 'old' }),
    ],
    ['save.json', JSON.stringify(startSave({ havePet: true, petInfo: { name: '旧' } }))],
  ])
  // Fix save to have name
  const base = startSave({ havePet: true })
  base.petInfo.name = '旧'
  remote.set('save.json', JSON.stringify(base))

  const fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(url).split('/').pop()
    if (method === 'MKCOL') return new Response('', { status: 201 })
    if (method === 'PUT') {
      remote.set(path, init.body ?? '')
      return new Response('', { status: 201 })
    }
    if (method === 'GET') {
      if (!remote.has(path)) return new Response('', { status: 404 })
      return new Response(remote.get(path), { status: 200 })
    }
    return new Response('', { status: 405 })
  }

  const save = startSave({ havePet: true })
  save.petInfo.name = '手机宝'
  let touched = 9999
  await syncOnce(
    fetch,
    { url: 'https://example/dav', user: 'u', pass: 'p', path: 'QQPet' },
    {
      loadBundle: () => ({ save, memory: '', history: '', dialogue: '' }),
      applyBundle: () => {},
      deviceId: () => 'phone',
      localUpdatedAt: () => touched,
      touch: (u) => {
        touched = u
      },
    },
  )
  assert.equal(remote.get('memory.md'), '- 远程事实\n')
  assert.equal(JSON.parse(remote.get('save.json')).petInfo.name, '手机宝')
})
