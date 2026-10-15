import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { defaultConfig } from '../src/shared/model.ts'
import { launchMedia, streamArguments } from '../src/main/moonlight.ts'
import { probeSunshine } from '../src/main/probe.ts'

test('Moonlight uses discrete arguments and leaves the remote app running after disconnect', () => {
  const config = defaultConfig()
  const device = { ...config.devices[0]!, host: 'linux1.local', appName: 'Desktop with spaces' }
  const args = streamArguments(device, config.settings)
  assert.deepEqual(args.slice(0, 3), ['stream', 'linux1.local', 'Desktop with spaces'])
  assert.equal(args[args.indexOf('--bitrate') + 1], '20000')
  assert.equal(args[args.indexOf('--fps') + 1], '30')
  assert.ok(args.includes('--no-quit-after'))
  assert.ok(args.includes('--no-background-gamepad'))
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
    assert.match(result.message, /pairing and streaming still require/)
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
  await assert.rejects(launchMedia('C:/lanto-nonexistent-test-fixture/absent.exe', []), /unable to start/)
})
