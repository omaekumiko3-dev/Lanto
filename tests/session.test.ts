import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SessionManager } from '../src/main/session-manager.ts'
import type { MediaAdapter, MediaExit, MediaHandle } from '../src/main/session-manager.ts'
import { defaultConfig } from '../src/shared/model.ts'
import type { Device, SessionState } from '../src/shared/model.ts'
import { deviceFixture } from './fixtures.ts'

const defaults = defaultConfig()
const first: Device = deviceFixture()
const second: Device = deviceFixture({ name: 'Test Mac', host: 'mac.local', platform: 'macos' })

function handle(
  pid: number
): MediaHandle & { exit(code: number): void; stops: number; failStop: boolean } {
  let resolve: (exit: MediaExit) => void = () => {}
  const value = {
    pid,
    stops: 0,
    failStop: false,
    closed: new Promise<MediaExit>((done) => {
      resolve = done
    }),
    exit(code: number) {
      resolve({ code, signal: null })
    },
    async stop() {
      value.stops++
      if (value.failStop) throw new Error('stop failed')
      value.exit(0)
    }
  }
  return value
}

test('switch closes the previous process before launching the next; stale exits cannot clear it', async () => {
  const handles = [handle(100), handle(101)]
  const order: string[] = []
  const states: SessionState[] = []
  let index = 0
  const manager = new SessionManager(
    {
      async start(device) {
        if (index === 1) assert.equal(handles[0]!.stops, 1)
        order.push(device.id)
        return handles[index++]!
      }
    },
    (state) => states.push(state),
    () => {}
  )
  await manager.connect(first, defaults.settings)
  await manager.connect(first, defaults.settings)
  assert.equal(index, 1)
  await manager.connect(second, defaults.settings)
  handles[0]!.exit(1)
  await Promise.resolve()
  assert.equal(manager.state.deviceId, second.id)
  assert.equal(manager.state.pid, 101)
  assert.deepEqual(order, [first.id, second.id])
  assert.ok(states.some((state) => state.phase === 'stopping'))
  await manager.disconnect()
  assert.equal(manager.state.phase, 'idle')
  assert.equal(handles[1]!.stops, 1)
})

test('a return requested during launch closes the process as soon as it is created', async () => {
  const pending = handle(102)
  let finish: (handle: MediaHandle) => void = () => {}
  const adapter: MediaAdapter = {
    start: () =>
      new Promise((resolve) => {
        finish = resolve
      })
  }
  const manager = new SessionManager(
    adapter,
    () => {},
    () => {}
  )
  const connecting = manager.connect(first, defaults.settings)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const returning = manager.disconnect()
  finish(pending)
  await Promise.all([connecting, returning])
  assert.equal(pending.stops, 1)
  assert.equal(manager.state.phase, 'idle')
})

test('launch failure does not poison the queue; an unexpected exit is not reported as connected', async () => {
  let fail = true
  const process = handle(103)
  const manager = new SessionManager(
    {
      async start() {
        if (fail) throw new Error('missing executable')
        return process
      }
    },
    () => {},
    () => {}
  )
  await assert.rejects(manager.connect(first, defaults.settings), /missing executable/)
  assert.equal(manager.state.phase, 'failed')
  fail = false
  await manager.connect(first, defaults.settings)
  process.exit(7)
  await Promise.resolve()
  assert.equal(manager.state.phase, 'failed')
  assert.equal(manager.state.pid, null)
  await manager.disconnect()
  assert.equal(manager.state.phase, 'idle')
})

test('an unclosed process blocks replacement rather than allowing two input owners', async () => {
  const process = handle(104)
  process.failStop = true
  let starts = 0
  const manager = new SessionManager(
    {
      async start() {
        starts++
        return process
      }
    },
    () => {},
    () => {}
  )
  await manager.connect(first, defaults.settings)
  await assert.rejects(manager.connect(second, defaults.settings), /stop failed/)
  assert.equal(starts, 1)
  assert.equal(manager.state.pid, 104)
  process.failStop = false
  await manager.disconnect()
  assert.equal(manager.state.pid, null)
})

test('volume only targets the current device and unsupported clients report failure', async () => {
  const applied: number[] = []
  const client = {
    ...handle(105),
    async setAudio(audio: { volume: number }) {
      applied.push(audio.volume)
    }
  }
  const manager = new SessionManager(
    {
      async start() {
        return client
      }
    },
    () => {},
    () => {}
  )
  await manager.setAudio(first.id, { volume: 10, muted: false })
  await manager.connect(first, defaults.settings)
  await manager.setAudio(second.id, { volume: 20, muted: true })
  await manager.setAudio(first.id, { volume: 35, muted: false })
  assert.deepEqual(applied, [35])
  await manager.disconnect()
  await manager.setAudio(first.id, { volume: 70, muted: false })
  assert.deepEqual(applied, [35])
  const unsupported = new SessionManager(
    {
      async start() {
        return handle(106)
      }
    },
    () => {},
    () => {}
  )
  await unsupported.connect(first, defaults.settings)
  await assert.rejects(
    unsupported.setAudio(first.id, { volume: 40, muted: false }),
    /volume control is not supported/
  )
  await unsupported.disconnect()
})
