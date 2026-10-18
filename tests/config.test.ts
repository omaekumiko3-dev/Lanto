import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from '../src/main/config-store.ts'
import { defaultConfig } from '../src/shared/model.ts'
import { configSchema, deviceInputSchema, deviceAudioSchema } from '../src/shared/validation.ts'
import { removeTestDirectory } from './temp.ts'
import { deviceFixture } from './fixtures.ts'

test('configuration persists a NAS-independent local profile across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-config-'))
  try {
    const store = new ConfigStore(directory)
    const original = await store.load()
    assert.deepEqual(original, defaultConfig())
    assert.equal(original.devices.length, 0)
    original.devices.push(deviceFixture())
    original.settings.resolution = '3840x2160'
    original.settings.fps = 30
    original.settings.bitrateMbps = 75
    await store.save(original)
    assert.deepEqual(await new ConfigStore(directory).load(), original)
    original.devices[0]!.name = 'New name'
    await store.save(original)
    assert.equal((await store.load()).devices[0]!.name, 'New name')
    // New defaults must not overwrite an existing lower-bandwidth profile.
    original.settings.resolution = '1920x1080'
    original.settings.fps = 60
    original.settings.bitrateMbps = 20
    await store.save(original)
    assert.deepEqual((await new ConfigStore(directory).load()).settings, original.settings)
  } finally {
    await removeTestDirectory(directory, 'lanto-config-')
  }
})

test('per-device resolutions survive restart and can return to the global setting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-config-'))
  try {
    const store = new ConfigStore(directory)
    const config = defaultConfig()
    config.devices = [
      deviceFixture({ platform: 'macos', resolution: '3840x2160' }),
      deviceFixture({ platform: 'windows', resolution: '2560x1440' }),
      deviceFixture()
    ]
    await store.save(config)
    const restored = await new ConfigStore(directory).load()
    assert.deepEqual(
      restored.devices.map((device) => device.resolution),
      ['3840x2160', '2560x1440', undefined]
    )
    delete restored.devices[1]!.resolution
    await store.save(restored)
    assert.equal((await new ConfigStore(directory).load()).devices[1]!.resolution, undefined)
    assert.equal(
      deviceInputSchema.safeParse({ ...config.devices[0], resolution: '--help' }).success,
      false
    )
  } finally {
    await removeTestDirectory(directory, 'lanto-config-')
  }
})

test('corrupt configuration is preserved and never silently overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-corrupt-'))
  try {
    const store = new ConfigStore(directory)
    await writeFile(store.file, '{broken config')
    await assert.rejects(store.load(), /original file was preserved/)
    assert.equal(await readFile(store.file, 'utf8'), '{broken config')
  } finally {
    await removeTestDirectory(directory, 'lanto-corrupt-')
  }
})

test('legacy default shortcut migrates once while custom shortcuts and input preferences survive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-config-'))
  try {
    const store = new ConfigStore(directory)
    const { lockInput, ...settings } = defaultConfig().settings
    const legacy = {
      ...defaultConfig(),
      settings: { ...settings, returnShortcut: 'Control+Alt+F12' }
    }
    await writeFile(store.file, JSON.stringify(legacy))
    const migrated = await store.load()
    assert.equal(migrated.settings.returnShortcut, 'Control+`')
    assert.equal(migrated.settings.lockInput, true)
    await writeFile(
      store.file,
      JSON.stringify({ ...legacy, settings: { ...legacy.settings, minimizeOnBlur: false } })
    )
    const oldMinimize = await store.load()
    assert.equal(oldMinimize.settings.returnShortcut, 'Control+Alt+F12')
    assert.equal(oldMinimize.settings.lockInput, true)
    assert.equal('minimizeOnBlur' in oldMinimize.settings, false)
    legacy.settings.returnShortcut = 'Control+Alt+F10'
    await writeFile(store.file, JSON.stringify(legacy))
    assert.equal((await store.load()).settings.returnShortcut, 'Control+Alt+F10')
    migrated.settings.returnShortcut = 'Control+Alt+F12'
    migrated.settings.lockInput = false
    await store.save(migrated)
    assert.deepEqual((await store.load()).settings, migrated.settings)
  } finally {
    await removeTestDirectory(directory, 'lanto-config-')
  }
})

test('existing devices migrate to full volume and audio values are strictly bounded', () => {
  const { volume, muted, ...legacy } = deviceFixture()
  const migrated = configSchema.parse({ ...defaultConfig(), devices: [legacy] }).devices[0]!
  assert.equal(migrated.volume, 100)
  assert.equal(migrated.muted, false)
  for (const invalid of [-1, 101, 20.5, NaN, Infinity, '30'])
    assert.equal(
      deviceAudioSchema.safeParse({ id: legacy.id, volume: invalid, muted: false }).success,
      false
    )
  assert.equal(deviceAudioSchema.safeParse({ id: legacy.id, volume: 0, muted: true }).success, true)
})

test('device input accepts LAN addresses and rejects CLI flags, URLs and shell text', () => {
  const base = { name: 'Dev', platform: 'linux', appName: 'Desktop' }
  for (const host of [
    '',
    'linux1',
    'linux1.local',
    '192.168.1.20',
    '::1',
    '[fe80::1]',
    'fe80::1%eth0'
  ]) {
    assert.equal(deviceInputSchema.safeParse({ ...base, host }).success, true, host)
  }
  for (const host of [
    '--help',
    'host; calc.exe',
    'https://host',
    'host:47989',
    'user@host',
    '[oops]',
    'host\n--quit-after'
  ]) {
    assert.equal(deviceInputSchema.safeParse({ ...base, host }).success, false, host)
  }
  assert.equal(
    deviceInputSchema.safeParse({ ...base, host: 'linux1', appName: '--quit-after' }).success,
    false
  )
  assert.equal(deviceInputSchema.safeParse({ ...base, host: 'linux1', shell: true }).success, false)
})

test('duplicate device identities and unsupported config versions fail validation', () => {
  const config = defaultConfig()
  config.devices.push(deviceFixture())
  config.devices.push({ ...config.devices[0]! })
  assert.equal(configSchema.safeParse(config).success, false)
  assert.equal(configSchema.safeParse({ ...defaultConfig(), schemaVersion: 2 }).success, false)
})
