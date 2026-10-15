import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from '../src/main/config-store.ts'
import { defaultConfig } from '../src/shared/model.ts'
import { configSchema, deviceInputSchema } from '../src/shared/validation.ts'
import { removeTestDirectory } from './temp.ts'

test('configuration persists a NAS-independent local profile across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-config-'))
  try {
    const store = new ConfigStore(directory)
    const original = await store.load()
    assert.deepEqual(original, defaultConfig())
    original.devices[0]!.host = 'linux1.local'
    original.settings.bitrateMbps = 35
    await store.save(original)
    assert.deepEqual(await new ConfigStore(directory).load(), original)
    original.devices[0]!.name = 'New name'
    await store.save(original)
    assert.equal((await store.load()).devices[0]!.name, 'New name')
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
  config.devices.push({ ...config.devices[0]! })
  assert.equal(configSchema.safeParse(config).success, false)
  assert.equal(configSchema.safeParse({ ...defaultConfig(), schemaVersion: 2 }).success, false)
})
