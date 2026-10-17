import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/shared/model.ts'
import { launchMedia, streamArguments } from '../src/main/moonlight.ts'
import { probeSunshine } from '../src/main/probe.ts'
import { removeTestDirectory } from './temp.ts'
import { deviceFixture } from './fixtures.ts'

test('Moonlight uses discrete arguments and leaves the remote app running after disconnect', () => {
  const config = defaultConfig()
  const device = deviceFixture({ appName: 'Desktop with spaces' })
  const args = streamArguments(device, config.settings)
  assert.deepEqual(args.slice(0, 3), ['stream', 'linux1.local', 'Desktop with spaces'])
  assert.equal(args[args.indexOf('--resolution') + 1], '3840x2160')
  assert.equal(args[args.indexOf('--bitrate') + 1], '60000')
  assert.equal(args[args.indexOf('--fps') + 1], '30')
  assert.ok(args.includes('--no-quit-after'))
  assert.ok(args.includes('--no-background-gamepad'))
  assert.ok(args.includes('--no-mute-on-focus-loss'))
  assert.ok(args.includes('--audio-on-host'))
  assert.ok(args.includes('--no-performance-overlay'))
  const overlay = streamArguments(device, { ...config.settings, showPerformanceOverlay: true })
  assert.ok(overlay.includes('--performance-overlay'))
  assert.ok(!overlay.includes('--no-performance-overlay'))
  assert.equal(args[args.indexOf('--capture-system-keys') + 1], 'never')
})

test('TCP probe describes reachability without claiming a paired or authenticated stream', async () => {
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const result = await probeSunshine('127.0.0.1', address.port)
    assert.equal(result.reachable, true)
    assert.match(result.message, /pairing and streaming still need/)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
  const unavailable = await probeSunshine('127.0.0.1', address.port)
  assert.equal(unavailable.reachable, false)
})

test('native adapter stops its own child and reports a missing executable', async () => {
  const child = await launchMedia(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  assert.ok(child.pid > 0)
  try {
    await child.stop()
    const exit = await child.closed
    assert.ok(exit.code !== null || exit.signal !== null)
  } finally {
    await child.stop()
  }
  await assert.rejects(
    launchMedia('C:/lanto-nonexistent-test-fixture/absent.exe', []),
    /Cannot start/
  )
})

test('native renderer overrides reach only the owned child and leave its parent unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-media-env-'))
  const previous = process.env.LANTO_MEDIA_TEST_ENV
  try {
    const script = 'process.stderr.write(process.env.LANTO_MEDIA_TEST_ENV ?? "unset")'
    const overrideFile = join(directory, 'override.log')
    const child = await launchMedia(process.execPath, ['-e', script], overrideFile, {
      LANTO_MEDIA_TEST_ENV: 'child-only'
    })
    assert.equal((await child.closed).code, 0)
    assert.equal(await readFile(overrideFile, 'utf8'), 'child-only')
    assert.equal(process.env.LANTO_MEDIA_TEST_ENV, previous)
    const defaultFile = join(directory, 'default.log')
    const next = await launchMedia(process.execPath, ['-e', script], defaultFile)
    assert.equal((await next.closed).code, 0)
    assert.equal(await readFile(defaultFile, 'utf8'), previous ?? 'unset')
  } finally {
    await removeTestDirectory(directory, 'lanto-media-env-')
  }
})
